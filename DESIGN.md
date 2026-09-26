# Aframe-nft — Design & Improvement Plan

> Status: **Implemented.** Phase 2 (jsartoolkitNFT + Vite) is the current codebase; multi-target
> tracking and runtime-added targets followed with jsartoolkitNFT 1.13.0 (section 10).
> This document keeps the design history and the reasons behind the decisions. Sections 1–9
> describe the plan as written on 2026-07-01, so parts of them (for example "single marker
> per scene") have since been superseded. For how to *use* the library, see the
> [README](README.md).

## 1. Understanding Summary

- **What:** An A-Frame ↔ NFT (natural-feature / image-target) AR library exposing a
  declarative `<a-nft url name>` primitive and an `arnft` system.
- **Why:** The current `@webarkit/ar-nft` (ARnft) integration places the mesh
  incorrectly (visible **mesh-shift**) and drives the loop through `window` events
  registered on every frame. Direct control of the pose pipeline is wanted.
- **Who:** Web developers embedding marker-less AR in a page via HTML tags.
- **Two phases:**
  - **Phase 1** — fix the existing ARnft integration on branch `feat-regular-arnft`.
  - **Phase 2** — rewrite internals on **jsartoolkitNFT directly** on a new branch
    (`feat-jsartoolkit-nft`), preserving the public API.

## 2. Assumptions

1. Phase 2 is a separate branch; Phase 1 is not blocked on it.
2. **Single marker** per scene for now (multi-marker = non-goal).
3. Browsers with `getUserMedia` (desktop + mobile); no native AR.
4. **Tests are in scope** — a smoke/harness setup is a first-class deliverable, not optional.
5. Mesh-shift root cause = `postMatrix` position math + per-frame listener registration
   (to be confirmed empirically during implementation).
6. `examples/DataNFT/pinball.{fset,fset3,iset}` + `examples/config.json` exist, so both
   phases are verifiable with a camera against the `pinball` target.

## 3. Public API Decision

**Keep existing tags, add optional attributes only** (backward compatible):

```html
<a-scene arnft="videoWidth: 1280; videoHeight: 720">
  <a-nft url="examples/DataNFT/pinball" name="pinball"
         smoothing="0.3"        <!-- NEW, optional: pose interpolation 0..1 -->
         confidence="0.5">      <!-- NEW, optional: min tracking confidence -->
    <a-box color="#4CC3D9"></a-box>
  </a-nft>
  <a-camera position="0 0 0" look-controls="enabled: false"></a-camera>
</a-scene>
```

Existing `examples/basic.html` keeps working unchanged.

## 4. Clean-Code Findings (current code)

| # | Severity | Location | Issue | Fix |
|---|----------|----------|-------|-----|
| 1 | 🔴 Critical | `src/registerSystemARnft.js:114-115` | `position.x = markerWidth/2`, `position.y = markerWidth/2 + (markerHeight-markerWidth)/2` offsets mesh by half the marker's **pixel** size → **mesh-shift**. | Center the mesh on the marker origin; derive offset from marker real size, not raw pixels. Make `scaleFactor` explicit/consistent. |
| 2 | 🔴 Critical | `src/registerSystemARnft.js:124-158` | `tick()` calls `window.addEventListener` **every frame** → listener leak + handler runs N× per frame → jitter/perf collapse. | Register all listeners **once in `init`**; `tick()` should only read latest pose and apply it. |
| 3 | 🟡 | `src/utils.js` (whole file) | `setMatrix` unused (import commented out). | Delete file + import. |
| 4 | 🟡 | `registerSystemARnft.js:87-88` | `mesh`/`root` confusion, `console.log(this.root)` logs undefined. | Single clear reference to `this.el.object3D`. |
| 5 | 🟡 | `registerSystemARnft.js` many lines | Large blocks of commented-out dead code. | Remove; rely on git history. |
| 6 | 🟡 | `registerSystemARnft.js:23` | Hard-coded `'./config.json'` path; example uses `examples/config.json`. | Make config path a system schema attribute. |
| 7 | 🟢 | `registerSystemARnft.js:136-148` | Verbose manual 16-element matrix copy. | Use `Array.isArray` + `.map(Number)` branch only; simplify. |
| 8 | 🟢 | `cameraViewRenderer.js:58` | `targetFrameRate` may be `undefined` → `1000/undefined = NaN` gate. | Default `targetFrameRate` in constructor. |

## 5. Design Approaches Considered (Phase 2 pose pipeline)

- **A. Worker-based jsartoolkitNFT in one A-Frame `system` (CHOSEN).** System owns video +
  NFT worker + camera projection; component consumes a clean pose event and writes
  `object3D.matrix`. Listeners bound once. Off-main-thread detection.
- **B. Main-thread jsartoolkitNFT.** Simpler, but detection blocks render loop → mobile jank. Rejected (debug-only fallback).
- **C. Keep ARnft, swap only matrix math.** Smallest diff, but keeps event indirection and
  doesn't deliver the requested ownership. Rejected.

## 6. Target Architecture (Phase 2)

```
<a-scene arnft>                 arnft SYSTEM
  ├─ video capture  ───────────►  cameraViewRenderer (crop/scale frames)
  ├─ NFT worker (jsartoolkitNFT)   ├─ loads .fset/.fset3/.iset
  │                                ├─ per frame: detect → RH matrix + confidence
  │                                └─ emits ONE 'nft-pose' event {name, matrixGL_RH, conf}
  └─ camera projection ───────────► sets a-camera fov/near/far ONCE on load

<a-nft> COMPONENT (nft-anchor)
  ├─ init(): bind listeners ONCE (pose, lost, projection)
  ├─ on pose: convert RH→A-Frame, optional smoothing, apply to object3D.matrix
  └─ tick(): only apply cached latest matrix (no listener registration)
```

Key math fix: the mesh is centered at the marker origin. Offsets are computed from the
marker's **real-world** dimensions (width/dpi → cm), not raw pixel counts, and applied
consistently with `scaleFactor`.

## 7. Testing Strategy (in scope)

- **Unit (Jest/Vitest, jsdom):**
  - `cameraViewRenderer.prepareImage()` geometry (crop/scale/offsets) with fixed inputs.
  - RH-matrix → A-Frame matrix conversion + postMatrix composition (pin the mesh-shift fix
    with a golden expected matrix).
  - `targetFrameRate` default / NaN-gate guard.
- **Component (A-Frame test utils):** `<a-nft>` registers listeners exactly once; `tick`
  registers zero new listeners across N frames (regression test for finding #2).
- **Manual verification harness:** a documented `npm start` flow pointing a camera at the
  `pinball` target; a checklist confirming the mesh sits centered and stable.
- Wire a real `npm test` (replace the stub) and run it in the build.

## 8. Decision Log

| Decision | Alternatives | Why |
|----------|--------------|-----|
| Phase both: fix ARnft now, migrate to jsartoolkitNFT on new branch | Fix-only; rewrite-only | User wants working demo now + full ownership later without destabilizing Phase 1. |
| Keep public API, add optional attrs | Identical API; full redesign | Backward compatible with `basic.html`, room for smoothing/confidence to fight jitter. |
| Worker-based system (Approach A) | Main-thread; ARnft wrapper | Off-main-thread perf + single clear pose pipeline. |
| Bind listeners once in `init` | Keep in `tick` | Fixes listener leak (finding #2), a primary shift/jitter cause. |
| Offset from real-world marker size, mesh centered | Pixel-based offset (current) | Fixes mesh-shift (finding #1). |
| Tests are first-class | Manual-only | User confirmed tests should be set up. |
| Single marker scope | Multi-marker | YAGNI for now; keeps both phases small. |
| Phase 2 branches from the arnft branch (not main) | Branch from near-empty `main` | `main` has only LICENSE/README; branching from `feat-regular-arnft` keeps the working example, NFT assets, tests, and Phase 1 fixes as a baseline. |
| Vite replaces webpack (Phase 2) | Keep webpack; Rollup direct | Faster dev/HMR, native ESM, one config shared with Vitest, fewer deps. Example loads `../src/index.js` as a module in dev; `vite build` still emits `dist/AframeNft.js` (IIFE global). |

## 9. Implementation Sequencing

**Phase 1 (branch `feat-regular-arnft`):**
1. **Set up test tooling (Vitest + jsdom) FIRST** — wire real `npm test`, add
   characterization tests for camera geometry + matrix conversion (red/pin before fixes).
2. Remove dead code (`utils.js`, commented blocks) — findings #3–5.
3. Move all listener registration from `tick()` into `init()` — finding #2.
4. Fix `postMatrix` centering/offset math — finding #1.
5. Guard `targetFrameRate`; make config path a schema attr — findings #6, #8.
6. Run tests + manual verify against `pinball`.

**Phase 2 (branch `feat-jsartoolkit-nft`) — IMPLEMENTED:**
1. ✅ Replaced `@webarkit/ar-nft` with `@webarkit/jsartoolkit-nft` (1.10.1); replaced
   webpack with Vite (dev server + IIFE lib build).
2. ✅ `arnft` system owns the camera + `ARControllerNFT` (main thread) and runs the
   per-frame `process()` loop; components register markers and receive pose callbacks.
3. ✅ `nft-anchor` consumes the pose, centers via `nftMath.computeCenterOffset`, lifts
   the mesh onto the plane, applies scale.
4. ✅ Camera alignment mirrors AR.js `ArToolkitSource`: video + WebGL canvas are sized
   to the same "cover" box (source aspect) so the overlay registers with the video for
   **any** `camera_para` — no per-device nudge. Uses `<a-scene embedded>`.
5. ✅ Tests still green (nftMath). Verified live against `pinball`.

Decisions made during Phase 2 (see also Decision Log):
- Main thread instead of the worker (Approach A) — single marker performs fine; worker
  deferred as a future optimization.
- Centering formula matches the canonical jsartoolkitNFT threejs example verbatim
  (`x = width/2 mm`, `y = height/2 mm`); proven camera-independent once the canvas is
  sized like the video.

## 10. Known Items / Future Work

- ✅ **Mesh lift — now correct + optional.** The mesh is lifted by its real bounding-box
  height (works for any mesh, not just a unit cube) via `computeLiftZ`; a `lift` attribute
  (default true) can disable it to center the mesh on the plane. Any residual "lean" on a
  tall mesh is correct perspective parallax.
- ✅ **Constant overlay shift — RESOLVED: it was a mis-printed marker, not our code.**
  The overlay drifted right by a constant amount. Ruled out, one at a time: parallax from the
  mesh lift, CSS/layout offset (measured `dx = 0` between the video and canvas rects), canvas
  and video sizing, capture resolution/FOV (identical at 640×480 and 1280×720), and the
  camera's principal point. The actual cause was the **printed target**: an A4 "Fit to Page"
  print squashes the aspect ratio, so the physical marker no longer matches the dimensions the
  descriptor declares and the fitted pose overshoots one side. Confirmed by displaying the
  source image on a screen at 1:1 — the overlay lands correctly. Same diagnosis as
  [webarkit/jsfeatNext#142](https://github.com/webarkit/jsfeatNext/issues/142).
  Documented in the README (print at 100%; `pinball` = 189.0 × 236.4 mm).
  **Lesson:** a constant, direction-specific error that is immune to every camera-side change
  points at the physical target, not the camera model. Principal-point "correction" knobs were
  prototyped and removed — they only masked the mismatch.
- ✅ **Pose smoothing (`OneEuroFilter`) — done.** Optional 1€ filter on the pose matrix,
  exposed via `smooth` / `smoothMinCutoff` / `smoothBeta` on `nft-anchor` (on by default).
  Implemented as a tested module (`src/oneEuroFilter.js`).
- ✅ **Multi-marker — `<a-nft>` per target, visibility derived locally.** Several `<a-nft>`
  elements each anchor their own target. Three upstream constraints originally shaped this;
  **jsartoolkitNFT 1.13.0 lifts all three**:
  - `lostNFTMarker` was single-marker
    ([jsartoolkitNFT#611](https://github.com/webarkit/jsartoolkitNFT/issues/611)). It is
    per-marker since 1.13.0, but we still derive visibility from pose timestamps
    (`lostTimeout`): it is tunable where the upstream timeout is fixed at 200 ms, and it
    behaves the same on any library version.
  - `addNFTMarkers` was single-call
    ([#612](https://github.com/webarkit/jsartoolkitNFT/issues/612)). Fixed in 1.13.0 (#666):
    ids continue across calls and earlier markers stay loaded. Markers now load **one call
    per marker, at any time** (`src/markerLoader.js`) — an `<a-nft>` added after tracking
    started is loaded on the spot, and a bad `url` fails only its own `<a-nft>`.
  - Only one marker could be tracked at a time
    ([#613](https://github.com/webarkit/jsartoolkitNFT/issues/613)). 1.13.0 (#658) tracks
    every loaded marker at once; the `continuousDetection` / `detectionInterval` system
    attributes expose its detection policy.

  jsartoolkitNFT cannot unload a marker and holds at most 20, so a removed `<a-nft>` parks
  its tracker id in `MarkerRegistry`, and re-adding the same `url` reuses it.
- ✅ **`getImage()` returns the captured frame instead of a per-call copy** (#6) — safe
  because `process()` copies the pixels into the WASM heap synchronously.
- Worker-based detection (Approach A) as a perf optimization (#7). Re-evaluate against
  jsartoolkitNFT's threaded build (`@webarkit/jsartoolkit-nft/td`), which since 1.13.0 runs
  detection off the main thread but uses pthreads (SharedArrayBuffer, so the page must be
  cross-origin isolated with COOP/COEP headers).
- Optional tracking-confidence threshold (not yet implemented).

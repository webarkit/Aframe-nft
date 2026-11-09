# Aframe-nft — Design & Improvement Plan

> Status: **Implemented.** Phase 2 (jsartoolkitNFT + Vite) is the current codebase; multi-target
> tracking and runtime-added targets followed with jsartoolkitNFT 1.13.0, and the tracker API with
> 1.16.0 (section 10).
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
  exposed via `smooth` / `smoothMinCutoff` / `smoothBeta` / `smoothRotationBeta` on `nft-anchor`
  (on by default).
  First implemented in-house; now `src/poseFilter.js` wraps WebARKit's
  `@webarkit/oneeurofilter-ts`, converting the Hz cutoffs to the package's per-millisecond
  units. It filters the rotation on its tangent space (`src/so3.js`) and the translation as a
  vector, so the pose stays rigid, as jsartoolkitNFT 1.16 does for its own filter
  ([jsartoolkitNFT#766](https://github.com/webarkit/jsartoolkitNFT/issues/766)). Filtering the 16
  values one by one, as earlier versions did, gave the rotation scale and shear.
  `test/poseFilter.test.js` pins the translation to the earlier output.

  Rotation and translation share `smoothMinCutoff`, a frequency, but each has its own beta, because
  beta is per unit of the signal. One value drove both at first, and the 0.01 that suits millimetres
  barely opens the cutoff for radians: rotation ran 2.6 s behind on a hand-held motion, against
  0.3 s for translation. `smoothRotationBeta` defaults to 2, which brings rotation to the same delay
  and leaves translation exactly as it was. A shared 1 Hz / 0.01 was the alternative: it needs no new
  attribute and has lower error on the move, because it speeds up translation too, but its fixed
  low-pass also applies at rest, with 2.4 times the shake at 30 fps and 3.8 times at 15 fps. Measured
  on real tracker poses with a synthetic camera. This is where `src/poseFilter.js` differs from
  jsartoolkitNFT's `oneEuro.ts`, in which one pair still drives both.
- ✅ **Multi-marker — `<a-nft>` per target, visibility derived locally.** Several `<a-nft>`
  elements each anchor their own target. Three upstream constraints originally shaped this;
  **jsartoolkitNFT 1.13.0 lifts all three**:
  - `lostNFTMarker` was single-marker
    ([jsartoolkitNFT#611](https://github.com/webarkit/jsartoolkitNFT/issues/611)). It is
    per-marker since 1.13.0. We first derived visibility from pose timestamps instead,
    because its timeout was fixed at 200 ms; since 1.16.0 the tracker API's `lost` transitions
    do this, with a tunable `lostTimeout` (see below).
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
- ✅ **Tracker API (jsartoolkitNFT 1.16.0).** `createNFTTracker` replaces `ARControllerNFT`, which
  has no `dispose()` ([#780](https://github.com/webarkit/jsartoolkitNFT/issues/780)). Targets load
  through `addNFTTargets`, whose per-source results say why a load failed. `process()` returns the
  poses and debounced `lost` transitions, so the pose-timestamp bookkeeping is gone: its rule is the
  same, more than `lostTimeout` ms untracked. `found` is not used, because a re-added `<a-nft>` can
  adopt a target already tracked, which fires no new `found`. `tracker.configure()` applies runtime
  changes (#13). The smoothing stack is unchanged: the tracker's `'native'` filter plus the per-anchor
  1€ filter, because the tracker's own `filter` setting is per tracker and cannot express per-`<a-nft>`
  settings. Checked when migrating: in Chromium on the default build, controller and tracker gave
  identical poses over 40 frames (maximum absolute difference 0), and the camera matrix is identical.
- ✅ **Camera through `@webarkit/camera-view`.** `CameraView` replaces the private
  `cameraViewRenderer`, with the same frame geometry. `projectionFor` replaces the hand scaling of
  the camera matrix, and gives exactly the same numbers. `videoWidth` / `videoHeight` stay `ideal`
  capture sizes through its `deps.mediaDevices`, because it only sends a width range. Its `getImage()`
  returns a new copy on every call, which partly undoes the fix for #6 (one `ImageData` reused between
  captures). That is accepted: repeated frames skip `process()` (#12), so the cost is one 307 KB copy,
  tiny next to a detection pass, and a fresh copy is what a Worker needs anyway. The frame counter
  follows the frame-rate gate, not the camera, so a camera slower than `targetFrameRate` can still
  have a picture processed twice. Teardown (#16) hangs on an internal `arnft-lifecycle` component on
  the scene, because A-Frame never calls `remove()` on a system. That component does not run before
  the scene has loaded, so a `MutationObserver` covers that time.
- ✅ **Tracking in a Worker, on request (#7).** `arnft="worker: true"` uses jsartoolkitNFT's own Worker
  through `createNFTTrackerWorker`, which supersedes the protocol #7 proposed. `build: 'auto'` picks
  `td` on a cross-origin isolated page and `simd` otherwise. One bundle, and the four Worker files are
  copied next to it at build time. **Ticket #7's off-thread goal is met only on request (`worker: true`),
  and the default stays `false` whatever the desktop numbers say: changing it is a separate decision.**
  A Worker requires the four Worker files to be served from the page's origin (with `workerBase` when the
  bundle is loaded from a CDN or as an ES module), downloads the tracker's WASM twice, adds a frame of
  pose latency, and phone measurements have not been taken yet. If the Worker cannot start within 30 s,
  the page tracks on the same thread with a warning and caches that fallback so later frame-size restarts
  stay on the same thread; missing files reject at once. A Worker that fails while running hides the content once
  and stops, with no restart on the same thread, to keep one recovery path. That includes a rejected
  `addNFTTargets`, which reports a failed load in its result and so only rejects when the tracker
  itself failed. There is no watchdog for a Worker that hangs with no error: nothing suggests it
  happens. A restart waits for the old Worker to go, at most 2 s by the package's `dispose()`. A start
  overtaken by a restart is not waited for: it is disposed when it resolves, and does not fall back if
  it fails, so on a frame-size change during start-up two Workers can overlap for the length of that
  start. Under `npm run dev`, Vite transforms the Worker files (inline source maps take
  them from 716 KB to 2 MB), and they still run, so the dev server needs nothing special.

  Measured on a desktop only, not a phone: 8 threads, headless Chromium with software GL, a fake camera,
  320×240 frames, two targets, medians over about 400 frames. The tracker's build differs between the
  columns, as it will in use: `default` on the same thread, `simd` in the Worker.

  | Desktop | Same thread | Worker |
  |---|---|---|
  | Searching, `processMs` (p95) | 41 ms (59) | 142 ms (661) |
  | Searching, time between page frames | 50 ms | 16.7 ms |
  | Tracking, `processMs` (p95) | 2.9 ms (10) | 9.9 ms (38) |
  | Tracking, time between page frames | 16.7 ms | 16.7 ms |
  | 80×60 canvas, so software GL costs little: searching, `processMs` (p95) | 40 ms (45) | 83 ms (175) |
  | 80×60 canvas: tracking, `processMs` (p95) | 2.7 ms (3.8) | 3.5 ms (4.1) |

  The search no longer holds up the page, which is what the Worker is for, but each search takes about
  twice as long in the Worker even with little else running. The cause was not investigated. Elsewhere
  the larger Worker numbers come at least partly from the page now rendering at full rate on the same
  CPU, because they mostly go away with the small canvas. Pose latency with the small canvas is 3.7 ms
  in the Worker against 2.8 ms on the same thread. Phone numbers: not measured yet.
- Optional tracking-confidence threshold (not yet implemented).

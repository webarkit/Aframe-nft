# Aframe-nft — Design & Improvement Plan

> Status: **Design (brainstorming)** — not yet implemented.
> Produced with the `brainstorming` + `clean-code` skills.
> Date: 2026-07-01

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

## 9. Implementation Sequencing

**Phase 1 (branch `feat-regular-arnft`):**
1. **Set up test tooling (Vitest + jsdom) FIRST** — wire real `npm test`, add
   characterization tests for camera geometry + matrix conversion (red/pin before fixes).
2. Remove dead code (`utils.js`, commented blocks) — findings #3–5.
3. Move all listener registration from `tick()` into `init()` — finding #2.
4. Fix `postMatrix` centering/offset math — finding #1.
5. Guard `targetFrameRate`; make config path a schema attr — findings #6, #8.
6. Run tests + manual verify against `pinball`.

**Phase 2 (branch `feat-jsartoolkit-nft`):**
1. Add jsartoolkitNFT dependency + NFT worker loader.
2. Reimplement `arnft` system to own worker + emit single `nft-pose` event.
3. Reimplement `nft-anchor` to consume pose (optional smoothing/confidence).
4. Port tests; manual verify; document migration.

## 10. Open Questions

- None blocking. Confidence-threshold default and smoothing default to be tuned empirically.

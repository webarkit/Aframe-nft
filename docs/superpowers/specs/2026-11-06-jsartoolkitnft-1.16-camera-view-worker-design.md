# jsartoolkitNFT 1.16, camera-view and the tracker Worker: design

Date: 2026-11-06. Base branch: `dev`.

## Intent

Bring Aframe-nft up to date with the current WebARKit packages and clear the open issues:

1. upgrade `@webarkit/jsartoolkit-nft` from 1.13.0 to 1.16.0, first and with priority over
   everything else;
2. replace the private `src/cameraViewRenderer.js` with the shared `@webarkit/camera-view`;
3. offer tracking in a Web Worker through the new tracker API (`createNFTTracker`,
   `createNFTTrackerWorker`);
4. resolve the open issues: #7, #11, #12, #13, #14, #15, #16, #17.

Assumed reason, not stated by the maintainer: stop carrying private copies of what WebARKit
now provides, and take the main-thread cost of detection off the render loop.

## Goals

- `dist/AframeNft.js` stays a single script that works when dropped into a page.
- The `<a-nft>` API and every existing `arnft` / `nft-anchor` attribute and default keep
  working. New attributes are optional.
- On the same-thread path, poses and overlay alignment are unchanged by the migration.
- Worker tracking is available as an opt-in, with a fallback to the same thread.
- Each of the eight issues is closed or has a stated reason why it stays open.

## Non-goals

- Making the Worker the default. That is decided after measuring on a phone (PR 3), and is a
  separate change.
- A second, Worker-only bundle using `@webarkit/jsartoolkit-nft/client`. See "Approaches".
- Rigid 1€ smoothing in `src/poseFilter.js`. It filters the 16 pose values one by one, the
  defect jsartoolkitNFT 1.16 fixed for its own filter (webarkit/jsartoolkitNFT#766). Separate
  follow-up.
- Pass-through attributes for `rotatePortrait`, `cameraLabel` and `probeZFT`. They become easy
  after this work, but nobody has asked for them.
- Publishing to npm, and the `0.3.0` release itself. The release follows the usual flow
  (`release-X.Y.Z` into `dev`, `dev` into `main`, tag on `main`), and that is where
  `CHANGELOG.md` is updated.

## Anti-goals

These would make the work a failure even if it technically runs:

- one Worker or one WASM instance per `<a-nft>` (the constraint in #7);
- a hand-written Worker protocol, now that upstream ships one;
- the overlay shifting relative to the video: this project already spent a long time on that;
- a page that loads only `AframeNft.js`, from any origin, no longer tracking.

## Constraints

- Branches are always new and from `dev`. PRs target `dev` and are squash-merged.
- Dependencies are pinned to exact versions.
- `dist/` is committed, and CI fails when it differs from a fresh build.
- Logic lives in DOM-free modules with a Vitest suite under `test/`. The A-Frame glue in
  `src/registerNFT.js` is verified with the examples on a real camera, plus the existing
  stubbed-`AFRAME` tests.
- Code style and commit conventions as in the repository. Commits end with the attribution
  trailer the session specifies.

## Facts this design rests on

Checked for this design, against the published packages and `node_modules`:

**jsartoolkitNFT 1.16.0** (latest; its release notes declare no breaking changes)

- `createNFTTracker(config)` and `createNFTTrackerWorker(config, opts)` share one API:
  `addNFTTargets`, `process(frame, timestampMs)`, `projectionFor`, `configure`, `dispose`,
  `cameraMatrix`. The Worker version returns Promises, except `projectionFor`, which runs on the
  page with no round trip.
- `config` takes `width`, `height`, `cameraParam`, `logLevel`, `continuousDetection`,
  `detectionInterval`, `lostTimeout` and `filter`. `logLevel` at creation also governs the
  start-up lines (webarkit/jsartoolkitNFT#677), though the camera parameter table still prints
  at every level.
- `process()` returns `{ time, processMs, targets: [{ id, found, pose, error }], transitions:
  [{ type, id }] }`. `pose` equals `matrixGL_RH` under the default `filter: 'native'`, for a
  controller with `internalLuma = true`, which is what `registerNFT.js` creates today.
- `lost` fires once a target is untracked for strictly more than `lostTimeout` ms of the
  `timestampMs` clock, the same rule as `MarkerRegistry.collectStale`.
- `addNFTTargets` resolves one result per source and does not reject for a load failure:
  `{ status: 'loaded', info }`, or `{ status: 'error', url, reason, message }` with `reason`
  `network`, `format`, `capacity` or `unknown`. `info` has `id`, `widthPx`, `heightPx`, `dpi`,
  `widthMm`, `heightMm`. Concurrent calls are supported.
- The tracker has no `getNFTData()`, so anything needing a target's size later must keep `info`.
- `process()` throws `RangeError` when the frame size differs from the config's.
- In the Worker, `process()` transfers the frame. A call made while another is in flight
  resolves `{ skipped: true }` and sends nothing.
- `filter` is one setting per tracker, so it cannot express today's per-`<a-nft>` smoothing.
- `ARControllerNFT` has no `dispose()` (webarkit/jsartoolkitNFT#780).
- `tracker.cameraMatrix` equals `ARControllerNFT.getCameraMatrix()` exactly for
  `examples/Data/camera_para.dat` at 320×240, and `projectionFor({ width: vw, height: vh },
  geometry)` equals today's hand scaling exactly for 640×480, 1280×720 and 480×640 (run on the Node
  build, maximum absolute difference 0).
- The defect fixed by webarkit/jsartoolkitNFT#766 is in the JS `oneEuro` filter only. The 1.16 notes
  say `'native'` is unchanged, and the 1.14 notes say tracking output is bit-for-bit identical to the
  build before that refactor. Pose equality between the controller and the tracker is still to be
  checked (see Verification).
- Create, load, `dispose` repeated 25 times on the Node build: every tracker's first id is 0, no
  `capacity` error appears (the limit is 20), `process()` afterwards throws "disposed", and RSS goes
  from 60 MB to 67 MB with forced GC. On the threaded build `dispose()` skips the native teardown
  (webarkit/jsartoolkitNFT#695), but the same-thread path uses the default build, and the Worker path
  terminates its Worker.
- From reading the client source, not run: the Worker's `error` and `messageerror` events reject
  every pending call and all later ones, so missing Worker files reject promptly instead of waiting
  for the start bound. A Worker that hangs with no error event leaves `process()` pending for ever.
- `build: 'auto'` picks `td` on a cross-origin isolated page, otherwise `simd`, otherwise
  `default`. The Worker needs four files next to each other: `NFTTracker.worker.js`,
  `NFTTracker_simd.worker.js`, `NFTTracker_td.worker.js`, `NFTTracker_td.pthread.js` (2.9 MB).

**`/client` inside our IIFE** (throwaway Vite builds in a scratch folder, run in Node with a fake
`document` and `Worker`; no real Worker started)

| Entry point in the IIFE | Size | Worker URL with no `workerBase` |
|---|---|---|
| `/client` only | 6 KB | `TypeError: Invalid URL` (`import.meta` becomes `{}`) |
| main entry + `/client` | 775 KB | as above, plus a build warning |
| main entry only | 769 KB | next to `AframeNft.js`, also when served from a CDN |

The main entry finds its folder through `document.currentScript`, falling back to the last
`<script>` with an http(s) `src`. Under the Vite dev server the script is a module, so that
fallback points at the wrong folder and `workerBase` must be set.

**A-Frame 1.8.0**

- A system has `init`, `update`, `tick`, `tock`, `play` and `pause`. It has no `remove`, and
  nothing calls one, so the fix suggested in #16 would never run.
- When a scene is disconnected, `disconnectedCallback` calls `removeComponent(name, false)` for
  the scene's own components, which runs their `remove()`.
- A system's constructor calls `init()` then `update({})`, before any tracker exists.
- `a-scene.setAttribute(attr, value, third)` drops `third` for systems, and a system's data is
  rebuilt from the value passed, with missing keys back at their defaults. From reading the
  source, so `setAttribute('arnft', 'detectionInterval', 0)`, the form quoted in #13, does not
  set that value, and a partial string resets the other keys. Confirm this when implementing.

**`@webarkit/camera-view` 0.1.0** (same license family, no runtime dependencies)

- `CameraView` provides `initialize`, `geometry`, `getImage`, `getImageBitmap`, `frame`,
  `destroy`, and the events `geometrychange` and `ended`. Its geometry math with `floor = true`
  matches `prepareImage()` in `cameraViewRenderer.js`.
- `geometry` maps directly onto `FrameGeometry` for `projectionFor`.
- `getImage()` returns a new `ImageData` on **every** call, also when the frame-rate gate did
  not capture a new frame. So transferring it to a Worker is safe, but it partly undoes the fix
  for #6 (0.2.0 reused one `ImageData`).
- `frame` only increases when `getImage()` really captured. The gate is time-based: `frame` advances
  when `targetFrameRate` allows a capture, not when the camera delivers a new picture.
- It accepts `width: { min, max }` only. `height` is not sent to `getUserMedia`. Today's
  `videoWidth` / `videoHeight` are sent as `ideal` values on both axes.
- Device choice: on a phone the last camera, with no retry if it fails; on a desktop the default
  camera. Today's code tries the last camera everywhere and retries without `deviceId`. The
  desktop change keeps the Meta Quest Link virtual cameras out of the way, as the retry did.
- `geometrychange` fires on video resize, for example a phone rotating. The frame size can change
  too (`320×240` to `318×239` on some portrait streams).
- After the track ends, `getImage()` throws `STREAM_ENDED`.
- `deps.mediaDevices` is a documented injection point.

## Approaches

**Route for the upgrade**

- A. Bump only, keep `ARControllerNFT`. Smallest diff, but #16 stays blocked (no `dispose()`) and
  the code gets rewritten again for the Worker.
- B. Bump and move to `createNFTTracker` on the same thread, then camera, then Worker.
  **Chosen:** it uses the API the maintainer named, needs no packaging decision yet, and turns the
  Worker into a small swap.
- C. Go straight to the Worker in the upgrade PR. Mixes the upgrade with packaging and async
  changes, against "the upgrade comes first".

**Packaging the Worker** (chosen by the maintainer)

1. **One bundle, Worker on request. Chosen.** The bundle keeps the same-thread tracker;
   `arnft="worker: true"` uses the Worker, falling back if it cannot start. Cost: four more files
   in `dist/`, and a Worker page downloads the WASM twice.
2. One bundle, Worker by default. Poses arrive about a frame later for everyone, and pages without
   the Worker files see a 404 before the fallback. A small change from option 1 if the
   measurements support it.
3. Worker only, through `/client`. Bundle about 1.3 MB (estimate), but no same-thread path, and
   a Worker script cannot load from another origin, so CDN use breaks.

**Import** (chosen by the maintainer): both functions come from the main entry. With option 1,
`/client` saves nothing and would require us to compute `workerBase` ourselves.

## Design

Four PRs, in order, each on a new branch from `dev` once the previous one is merged. Each leaves
the project fully working.

| PR | Branch | Scope | Issues |
|---|---|---|---|
| 1. Upgrade | `feat-jsartoolkitnft-1.16` | 1.16.0 and `createNFTTracker`, same thread; also holds this document and the plan | #13, #14 |
| 2. Camera | `feat-camera-view` | `@webarkit/camera-view`, `projectionFor`, frame gate, teardown | #12, #16 |
| 3. Worker | `feat-nft-worker` | Measurements, `createNFTTrackerWorker`, Worker files in `dist/` | #7 |
| 4. Lifecycle | `fix-marker-lifecycle` | Duplicate targets, `url` change, re-append, hidden until first pose | #11, #15, #17 |

### PR 1: upgrade to 1.16.0 and the tracker API

Start with the bump alone in its own commit, with `ARControllerNFT` still in place and the tests
and build passing, so a later regression can be bisected to the library or to our migration.

Then, in `src/registerNFT.js`:

- `ARControllerNFT.initWithDimensions(...)` becomes `createNFTTracker({ width, height,
  cameraParam, logLevel, continuousDetection, detectionInterval, lostTimeout })`. The field
  `controller` becomes `tracker`. `filter` stays at its default, `'native'`.
- The `getNFTMarker` listener and `collectStale` go. A per-frame handler routes the result: for
  each entry in `targets` with a `pose`, call `onPose(pose, result.time)` on the registered record;
  for each `lost` in `transitions`, call `onLost()`. `found` transitions are not used, because a
  re-added `<a-nft>` can adopt a target already being tracked, which fires no new `found`.
  Keep this routing in a DOM-free function so it can be unit-tested.
- `nft-anchor.onPose` takes the time from its caller instead of `performance.now()`. `poseFilter.js`
  and the per-anchor filter stay as they are, on top of the native filter, which is today's stack.
- `_setupCamera` reads `tracker.cameraMatrix`, with the existing `pw / w`, `ph / h` scaling
  unchanged in this PR.
- Add a system `update(oldData)`. If there is no tracker yet, return. Otherwise send
  `tracker.configure(patch)` with whichever of `continuousDetection`, `detectionInterval`,
  `lostTimeout` and `logLevel` changed, and log a rejected patch instead of throwing. Document in
  the README the form that works at runtime (see the A-Frame facts).

`src/markerRegistry.js`: drop `markSeen`, `collectStale`, `lastSeen` and `visible`. Records and
parked ids keep the target's size, because a re-added `<a-nft>` needs `onData` and the tracker has
no `getNFTData()`.

`src/markerLoader.js`: one `addNFTTargets([url], { origin: 'corner' })` per pending marker, as
today one load per marker, so a slow target does not delay the others. The failure message comes
from `reason` and `message`. `MAX_MARKERS` and the no-id branch go. `onData` still receives
`{ width, height, dpi }`, mapped from `info`, so `nftMath` and the centring stay as they are.

#14, point by point:

1. Fixed: `reason` says what actually happened.
2. A warning after 30 s, chosen by the maintainer when Qodo flagged the gap on the PR. Since 1.15
   network failures report instead of hanging, so this only concerns a connection that stays open
   without answering. The tracker API has no per-target signal, so that load cannot be cancelled and
   may still finish: it warns instead of failing, and the closure keeps the component until the
   request ends.
3. Update the README limitation. The `.zft` probe is asynchronous now, but on the same thread the
   KPM build still stalls briefly. PR 3 adds that the Worker avoids it.

Docs: README badge, banner sample, API notes about `logLevel` and #13, "How it works" diagram and
steps; DESIGN.md section 10.

### PR 2: `@webarkit/camera-view`

Add `@webarkit/camera-view` pinned to `0.1.0`. Delete `src/cameraViewRenderer.js` and
`test/cameraViewRenderer.test.js`, whose subject is now tested upstream. The system uses
`new CameraView(video, deps)` and `view.initialize({ facingMode: 'environment', targetFrameRate: 60 })`.

- **Capture size (my call).** Keep `videoWidth` / `videoHeight` as `ideal` values through
  `deps.mediaDevices`: a small DOM-free wrapper whose `getUserMedia` adds them to the constraints,
  and whose `enumerateDevices` delegates. Mapping to `{ min, max }` would drop `videoHeight`, so
  cameras could deliver 16:9 and tracking would see a smaller letterboxed picture. Remove the
  wrapper if camera-view gains `ideal` support.
- **Projection.** `_setupCamera` becomes `tracker.projectionFor({ width: g.videoWidth, height:
  g.videoHeight }, view.geometry)`. With the viewport at the video's exact aspect there is no extra
  scaling, and the result equals today's hand-written scaling (see the facts above). `_resize` and
  the cover box stay as they are.
- **Frame gate (#12).** In `tick`, skip `process()` when no registered record has a tracker id.
  Then compare `view.frame` before and after `getImage()`, and skip when it did not change, as #12
  suggests. A repeated frame still costs one copy of 307 KB, tiny next to a detection pass (my
  call). This closes #12 as written, which is about the frame-rate gate. A 30 fps camera on a 60 Hz
  display still processes some pictures twice: state that limit when closing the issue. `video.currentTime`
  or `requestVideoFrameCallback` could address it later if measurements justify it; a browser where
  `currentTime` does not advance would stop tracking silently, so it is not used now.
- **`geometrychange` (my call).** With the same frame size, recompute the projection. With a
  different size, dispose the tracker and start again, reloading targets, because the frame size
  is fixed at creation and `camera_para` is scaled to it. Restarting is safe (see the facts) and rare:
  640×480, 480×640, 1280×720 and 720×1280 all give a 320×240 frame. This also fixes rotation on
  phones, where today's code keeps the stale geometry.
- **`ended`.** Stop processing, hide all content, and warn. No automatic reopening.
- **Teardown (#16, my call).** The system adds a small internal component to the scene, whose
  `remove()` calls `system._teardown()`: `view.destroy()`, `tracker.dispose()`, and no further
  processing. A tracker or camera that resolves after teardown is disposed at once, and
  `CameraViewError('DESTROYED')` is not reported as a failure. Re-attaching a removed scene is not
  supported.

Accepted behaviour changes, to be listed in the PR and later the changelog: no retry when a phone's
last camera fails to open, and a desktop uses the default camera instead of the last one.

Docs: README troubleshooting table (`CameraViewError`), module table, diagram, credits.

### PR 3: tracking in a Worker

Order inside the PR, following the second comment in #7:

1. **Measure.** Same-thread `processMs` while searching and while tracking, at the real frame size.
   Use an uncommitted patch. The builder measures on the desktop; the maintainer measures on a
   phone, over HTTPS. Record the numbers in the PR and in DESIGN.md.
2. **Worker files.** A small Vite plugin in `vite.config.js` copies the four files from the package
   into `dist/`, next to the bundle, with no new dependency. CI's `dist/` check then covers them.
3. **Attributes.** `worker` (boolean, default `false`) and `workerBase` (string, default empty,
   meaning next to the bundle).
4. **Creation.** A DOM-free module with injected factories, importing nothing from the package
   itself: with `worker: true`, call `createNFTTrackerWorker(config, { signal:
   AbortSignal.timeout(30000), workerBase })`. On rejection, warn and use `createNFTTracker`. The 30 s
   bound is a constant (my call), generous because compiling WASM on a slow phone takes seconds.
5. **Tick.** `process()` may return a result or a Promise. While a call is in flight, return before
   capturing a frame, so no copy is wasted. Results go through the same routing as PR 1, ignoring
   `skipped`. A late result is harmless after a target's removal, because routing looks up the id;
   after teardown it is dropped.
6. **Worker failure while running (my call).** A rejection other than "disposed" logs one error and
   hides all content. It does not restart on the same thread, to keep one recovery path. There is no
   watchdog for a Worker that hangs without an error: nothing suggests it happens, and it can be
   added if it is ever observed.
7. **Example.** `examples/worker.html` with `arnft="worker: true; workerBase: ../dist/"`, added to the
   examples index. Check whether the Vite dev server serves those worker files untransformed. If it
   does not, serve them another way in dev; this is untested.

Marker bookkeeping, projection and visibility stay on the main thread, and there is exactly one
Worker per scene. `/td` needs no attribute of its own: `build: 'auto'` uses it on an isolated page.

Docs: README section on the Worker (files to serve, same-origin rule, cross-origin isolation, about
one frame of pose latency), Known limitations, DESIGN.md section 10. #7 closes with a comment stating
that its protocol and suggested order were superseded by the upstream Worker.

The default stays off whatever the numbers say. Changing it is a later, separate decision.

### PR 4: marker lifecycle

- **#11.** As the issue suggests: in-flight loads are kept by url so a new record can adopt one, and
  `id → Set<record>` routes one tracker id to several `<a-nft>`, each with its own filter.
- **#15.** On `markerUrl` change, unregister and register again. On re-append, register again on the
  entity's `loaded` event when `this.marker` is `null`, and write the pose matrix in `onPose` because
  the component `tick` does not resume. Remove the matching README caveats.
- **#17.** `mesh.visible = false` in `init()`.

## Verification

For every PR:

- `npm test` and `npm run build`, with the `dist/` check passing in CI.
- New logic has unit tests. A bug fix has a test that fails without it.
- A local smoke run in Chromium with a fake camera file showing a target, on `basic.html` and
  `dynamic.html`, and on `worker.html` from PR 3. The harness stays out of the repository. It can show
  that tracking runs and that nothing throws, but not how it feels.
- The maintainer checks real-camera behaviour on desktop and phone before merging, since this
  project's conventions rely on that for the glue code.

Specific checks:

- **Poses (PR 1).** One install of 1.16.0, in Chromium on the browser default build, because the Node
  controller has no `internalLuma` parameter: feed the same frames to `ARControllerNFT` and to
  `createNFTTracker`, with `Date.now` pinned because AR2 seeds `rand` from the time. Poses must be
  exactly equal. A difference blocks PR 1 and goes to the maintainer. There is
  no 1.13 against 1.16 rig: that step rests on upstream's statements and on the maintainer's camera
  check, which also judges whether smoothing still feels the same.
- **Projection (PR 2).** Numbers unchanged, as already shown on the Node build.
- **Teardown (PR 2).** The camera light goes off after removing the scene. A tracker restart caused by a
  frame-size change reloads every target (unit test with a fake tracker).
- **Worker (PR 3), in a real browser.** It starts and tracks. With the Worker files missing, the page
  falls back within seconds and not after 30 s. No Worker remains after dispose.

## Calls to check

Made by the author of this document, not by the maintainer:

- capture size kept through a `deps.mediaDevices` wrapper, rather than adding `ideal` to camera-view
  first (PR 2);
- accepting one copy per repeated frame, rather than asking camera-view for a no-copy check;
- closing #12 as written, leaving duplicate pictures from a camera slower than `targetFrameRate`;
- restarting the tracker when the frame size changes;
- the internal scene component for teardown;
- the 30 s Worker start bound, no restart if a running Worker dies, and no watchdog for a hung Worker;
- `found` transitions unused, with visibility coming from poses and `lost`;
- a pose difference between controller and tracker blocks PR 1, and 1.13 against 1.16 is not compared
  directly;
- `@webarkit/oneeurofilter-ts` stays at 0.2.0 until the rigid-smoothing follow-up.

## Left to the builder

Module and function names, test layout, commit boundaries beyond those stated, the smoke-test harness,
and README wording.

# jsartoolkitNFT 1.16, camera-view and the tracker Worker: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Aframe-nft to jsartoolkitNFT 1.16.0 and its tracker API, replace `cameraViewRenderer` with `@webarkit/camera-view`, offer opt-in Worker tracking, and resolve issues #7, #11, #12, #13, #14, #15, #16 and #17.

**Architecture:** The `arnft` system keeps owning the camera, one tracker per scene and the frame loop. `createNFTTracker` replaces `ARControllerNFT`, `CameraView` replaces the private renderer, and the Worker is a second factory behind the same tracker interface. Routing of tracker results and other logic live in DOM-free modules; `src/registerNFT.js` stays glue.

**Tech Stack:** A-Frame 1.8.0, `@webarkit/jsartoolkit-nft` 1.16.0, `@webarkit/camera-view` 0.1.0, Vite 8, Vitest 5 + jsdom.

**Spec:** `docs/superpowers/specs/2026-11-06-jsartoolkitnft-1.16-camera-view-worker-design.md`. Read it first: its "Facts" section explains why the code below takes this shape.

## Global Constraints

- Four PRs, in order. Each is a new branch from an up-to-date `origin/dev`, created once the previous PR is merged. Each PR targets `dev` and is squash-merged.
- Branches: `feat-jsartoolkitnft-1.16`, `feat-camera-view`, `feat-nft-worker`, `fix-marker-lifecycle`.
- Before cutting each later branch, re-check its section against the current `dev` and package releases. For example, if camera-view gains `ideal` support, Task 7 goes away.
- Exact pins: `@webarkit/jsartoolkit-nft` `1.16.0`, `@webarkit/camera-view` `0.1.0`. `@webarkit/oneeurofilter-ts` stays `0.2.0` and `aframe` stays `1.8.0`.
- Import both tracker functions from `@webarkit/jsartoolkit-nft`, never from `/client`.
- Every existing `arnft` / `nft-anchor` / `<a-nft>` attribute and default keeps working. The only new attributes are `worker` (boolean, default `false`) and `workerBase` (string, default empty).
- `filter` is never passed to the tracker, so it stays `'native'`. Targets load with `origin: 'corner'`.
- One tracker and at most one Worker per scene.
- Rebuild `dist/` with `npm run build` before the last commit of each PR. On Windows `git status` can show `dist/AframeNft.js` modified when `git diff` is empty (line endings with `autocrlf`): restore it with `git checkout`, do not commit it.
- Style: ES modules, 4-space indent, single quotes, semicolons; extensionless imports in `src/`, `.js` imports in `test/`; JSDoc on exports; comments explain why and cite upstream as `webarkit/jsartoolkitNFT#NNN`.
- Commits use conventional prefixes and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. PR bodies end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- Harnesses and measurement patches are never committed. Comments on GitHub issues are drafted in the PR body and posted only with the maintainer's OK.
- The maintainer checks each PR on a real camera, desktop and phone, before merging.

## Review Focus

Most likely to bite first. Each line has its test in the owning task.

1. A load that finishes after the tracker was replaced or the `<a-nft>` removed must not fail a newer load or call a gone component (Task 9).
2. A bad runtime value such as `detectionInterval: NaN` must log an error, leave the tracker as it was, and raise no unhandled rejection (Task 5).
3. A scene removed while the camera or tracker is still starting must stop the camera and dispose the late tracker, with no error reported (Task 10).
4. A camera unplugged mid-session must hide the content and stop reading frames, not throw `STREAM_ENDED` from the render loop (Task 9).
5. With `worker: true` and missing Worker files, the page must track on the same thread within seconds; a Worker that dies later must hide the content once and stop (Tasks 13 and 14).

## Smoke harness (scratch, never committed)

Build this once, in a folder outside the repository. It shows that tracking runs and nothing throws. It does not replace the maintainer's camera check.

- Download `https://raw.githubusercontent.com/webarkit/jsartoolkitNFT/master/examples/node/pinball-demo.jpg` into its own empty folder. Install `sharp` and `playwright` in another, and run `npx playwright install chromium`.
- `frames.mjpeg`: encode the photo with sharp at 640×480 as JPEG and concatenate those bytes 30 times. If no target is detected at that size, crop the photo around the pinball target.
- `smoke.mjs <url>`: launch Chromium with `--use-fake-ui-for-media-stream`, `--use-fake-device-for-media-stream`, `--use-file-for-fake-video-capture=<frames.mjpeg>`; open the URL; wait up to 60 s for `document.querySelector('a-nft').object3D.matrixAutoUpdate === false`, which means a pose was applied. Fail on any `pageerror` or any console error starting with `arnft:`.
- Serve the examples with `BROWSER=none npm run dev` and use `http://localhost:8080/examples/basic.html`.

---

## PR 1: upgrade and tracker API (`feat-jsartoolkitnft-1.16`, closes #13, #14)

- [ ] **Before Task 1: commit the docs.** In the existing worktree on `feat-jsartoolkitnft-1.16`, commit the spec and this plan as `docs: add jsartoolkitNFT 1.16 design and plan`.

### Task 1: Bump to 1.16.0 alone

So that a later regression can be bisected to the library or to our migration.

**Files:**
- Modify: `package.json`, `package-lock.json`, `dist/AframeNft.js`

- [ ] **Step 1:** Run `npm install --save-exact @webarkit/jsartoolkit-nft@1.16.0`.
- [ ] **Step 2:** Run `npm test`. Expected: 71 tests pass, as before the bump.
- [ ] **Step 3:** Run `npm run build`, then the smoke harness on `basic.html`. Expected: pass, and the console shows `Aframe-nft 0.2.0 (jsartoolkitNFT 1.16.0)`.
- [ ] **Step 4:** Commit as `chore: bump jsartoolkitNFT to 1.16.0`.

### Task 2: Check that controller and tracker give the same poses

A one-off check with no repository change. It runs in Chromium on the browser default build, because the Node controller has no `internalLuma` parameter (its fourth argument is `options`) and so may not use the luma path the tracker uses. A difference found this way stops PR 1 and goes to the maintainer.

- [ ] **Step 1:** Write a scratch page and a Playwright script, served by a small static server from the repository root. The page loads `node_modules/@webarkit/jsartoolkit-nft/dist/ARToolkitNFT.js` with a `<script>` tag. Pin `Date.now = () => 1700000000000` with `page.addInitScript`, because AR2 seeds `rand` from the time. Draw the photo into a canvas at natural size and read one `ImageData`, shared by both runs.
  - Controller run: `ARControllerNFT.initWithDimensions(w, h, 'examples/Data/camera_para.dat', true)`, `addEventListener('getNFTMarker', ...)`, load `examples/DataNFT/pinball`, `trackNFTMarkerId(id)`, then 40 × `ar.process(image)`. Keep a copy of each `matrixGL_RH`.
  - Tracker run, in a fresh page: `createNFTTracker({ width: w, height: h, cameraParam: 'examples/Data/camera_para.dat' })`, `addNFTTargets(['examples/DataNFT/pinball'])`, then 40 × `process(image, i * 33)`. Keep a copy of each non-null `pose`.
- [ ] **Step 2:** Compare the two sequences. Expected: same length, at least one pose, maximum absolute difference `0`.
- [ ] **Step 3:** Save the result for the PR description.

### Task 3: Add the DOM-free tracker helpers

Additive: nothing uses them until Task 4.

**Files:**
- Create: `src/trackerSettings.js`, `src/frames.js`
- Test: `test/trackerSettings.test.js`, `test/frames.test.js`

**Interfaces:**
- Produces: `trackerConfig(data, size: {width, height}, cameraParam: string) → NFTTrackerConfig`
- Produces: `runtimePatch(oldData, data) → NFTTrackerPatch | null`
- Produces: `routeFrameResult(registry, result: FrameResult) → void`. Uses `registry.get(id)` and `component.onPose(pose, time)` / `component.onLost()`.

- [ ] **Step 1: Write the failing tests**

```js
// test/trackerSettings.test.js
const data = { logLevel: 'warn', continuousDetection: true, detectionInterval: 300, lostTimeout: 200, videoWidth: 640 };

it('builds the tracker config, with the log level as a number and no filter', () => {
    const config = trackerConfig(data, { width: 320, height: 240 }, 'http://x/cam.dat');
    expect(config).toEqual({
        width: 320, height: 240, cameraParam: 'http://x/cam.dat',
        logLevel: 2, continuousDetection: true, detectionInterval: 300, lostTimeout: 200,
    });
});
it('returns only the runtime keys that changed', () => {
    expect(runtimePatch(data, { ...data, detectionInterval: 0 })).toEqual({ detectionInterval: 0 });
    expect(runtimePatch(data, { ...data, lostTimeout: 500, continuousDetection: false }))
        .toEqual({ lostTimeout: 500, continuousDetection: false });
});
it('maps a changed logLevel to its number', () => {
    expect(runtimePatch(data, { ...data, logLevel: 'debug' })).toEqual({ logLevel: 0 });
});
it('returns null when no runtime key changed', () => {
    expect(runtimePatch(data, { ...data, videoWidth: 1280 })).toBeNull();
});

// test/frames.test.js. A fake registry: new Map([[0, record]]), get: (id) => map.get(id) ?? null.
it('sends a pose and the frame time to its record', () => {
    routeFrameResult(registry, { time: 42, targets: [{ id: 0, found: true, pose }], transitions: [] });
    expect(component.onPose).toHaveBeenCalledWith(pose, 42);
});
it('skips a target with no pose (the grace window before lost)', () => {
    routeFrameResult(registry, { time: 42, targets: [{ id: 0, found: false, pose: null }], transitions: [] });
    expect(component.onPose).not.toHaveBeenCalled();
});
it('ignores an id with no record: a target whose <a-nft> was removed', () => {
    expect(() => routeFrameResult(registry, { time: 42, targets: [{ id: 9, found: true, pose }], transitions: [{ type: 'lost', id: 9 }] })).not.toThrow();
});
it('calls onLost for a lost transition and ignores found', () => {
    routeFrameResult(registry, { time: 42, targets: [], transitions: [{ type: 'found', id: 0 }, { type: 'lost', id: 0 }] });
    expect(component.onLost).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2:** Run `npx vitest run test/trackerSettings.test.js test/frames.test.js`. Expected: FAIL, modules not found.
- [ ] **Step 3:** Implement both modules. `trackerSettings.js` uses `toARLogLevel` from `./logLevel`. Runtime keys: `continuousDetection`, `detectionInterval`, `lostTimeout`, `logLevel`.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit as `feat: add tracker settings and frame routing helpers`.

### Task 4: Move the system, registry and loader to the tracker API

One commit, because `registerNFT.js` cannot work with the old loader or the new one half done.

**Files:**
- Modify: `src/registerNFT.js`, `src/markerRegistry.js`, `src/markerLoader.js`
- Test: `test/markerRegistry.test.js`, `test/markerLoader.test.js`, `test/arnftSystem.test.js`, `test/nftAnchor.test.js`, `test/index.test.js`

**Interfaces:**
- Consumes: Task 3.
- Produces: `MarkerRegistry.setLoaded(marker, id, data: NFTData) → record | null`, replacing `setId`. Records gain `data`; parked entries are `{ id, data }`.
- Produces: `loadPendingMarkers(tracker, registry, { onLoaded(marker, data), onFailed(marker, reason) })`.
- Produces: system field `tracker` (was `controller`) and method `_onTrackerReady(tracker)` (was `_onControllerReady`). `nft-anchor.onPose(pose, time)`.

- [ ] **Step 1: Update the tests first.**
  - `test/markerRegistry.test.js`: delete the `MarkerRegistry visibility` block and the `markSeen` / `collectStale` lines in the removal block. Replace `setId(x, n)` with `setLoaded(x, n, size)`, where `const size = { width: 1, height: 2, dpi: 3 }`. Add:

  ```js
  it('gives a re-added marker the size of the parked target', () => {
      const r = new MarkerRegistry();
      r.remove(r.setLoaded(r.add(marker('a')), 0, size));
      expect(r.add(marker('a')).data).toEqual(size);
  });
  ```

  - `test/markerLoader.test.js`: rewrite the fake and the assertions. Each test resolves the request it wants.

  ```js
  function fakeTracker() {
      return {
          requests: [],
          addNFTTargets(sources, opts) {
              return new Promise((resolve, reject) => this.requests.push({ sources, opts, resolve, reject }));
          },
      };
  }
  const loaded = (id) => [{ status: 'loaded', info: { id, widthPx: 100, heightPx: 200, dpi: 72 } }];

  it('issues one addNFTTargets call per unloaded marker, with corner origin', () => {
      loadPendingMarkers(tracker, registry, handlers);
      expect(tracker.requests.map((r) => r.sources)).toEqual([['DataNFT/a'], ['DataNFT/b']]);
      expect(tracker.requests[0].opts).toEqual({ origin: 'corner' });
  });
  it('maps the target info to the size onData expects', async () => {
      loadPendingMarkers(tracker, registry, handlers);
      tracker.requests[0].resolve(loaded(0));
      await flush();
      expect(a.id).toBe(0);
      expect(handlers.onLoaded).toHaveBeenCalledWith(a, { width: 100, height: 200, dpi: 72 });
  });
  it('reports the reason a load failed (#14)', async () => {
      loadPendingMarkers(tracker, registry, handlers);
      tracker.requests[0].resolve([{ status: 'error', url: 'DataNFT/a', reason: 'capacity', message: 'full' }]);
      await flush();
      expect(a.failed).toBe(true);
      expect(handlers.onFailed).toHaveBeenCalledWith(a, 'capacity: full');
  });
  ```

  Keep the existing cases for no repeat while loading, a marker added later, one marker failing alone, a rejected load, and removal during a load. Drop the three-errors case, the no-id case and `MAX_MARKERS`.

  - `test/arnftSystem.test.js`: mock `@webarkit/jsartoolkit-nft` as `{ createNFTTracker: vi.fn() }`, in `test/nftAnchor.test.js` and `test/index.test.js` too. Replace `startTracking` with a test that `_onTrackerReady(tracker)` runs `_setupCamera` before `_loadPendingMarkers`, and keep the `warn` default test. Add this helper block, which later tasks reuse, with `import { createNFTTracker } from '@webarkit/jsartoolkit-nft'` and `MarkerRegistry`:

  ```js
  const base = { cameraParam: 'cam.dat', logLevel: 'warn', continuousDetection: true, detectionInterval: 300, lostTimeout: 200 };
  const size = { width: 1, height: 2, dpi: 3 };
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  // A hand-built arnft system: init() is not run, so tests set what they need.
  const system = (overrides = {}) => Object.assign(Object.create(definitions.arnft), {
      data: base, registry: new MarkerRegistry(), tracker: null, starting: false, _generation: 0, stopped: false,
      _resize() {}, _applyProjection() {},
  }, overrides);
  ```

  - `test/nftAnchor.test.js`: add a stub `multiply() { return this; }` to `THREE.Matrix4`, and:

  ```js
  it('filters with the frame time it is given, not the clock', () => {
      const anchor = startedAnchor();
      const filter = vi.spyOn(anchor.filter, 'filter');
      anchor.onPose(new Float64Array(16), 1234);
      expect(filter.mock.calls[0][0]).toBe(1234);
  });
  ```

- [ ] **Step 2:** Run `npm test`. Expected: FAIL in those files.
- [ ] **Step 3: Implement `markerRegistry.js` and `markerLoader.js`.** The registry drops `markSeen`, `collectStale`, `lastSeen` and `visible`. The loader calls `registry.markLoading(marker)`, then `tracker.addNFTTargets([marker.url], { origin: 'corner' })`, with a `.catch` into the same failure path. Failure text is `` `${reason}: ${message}` ``, and a rejection passes its error through. Remove `MAX_MARKERS`. Update the module comments to 1.16's behaviour.
- [ ] **Step 4: Implement `registerNFT.js`.**
  - Import `createNFTTracker`, and call it in `_maybeStart` with `trackerConfig(this.data, { width: this.camV.pw, height: this.camV.ph }, resolveUrl(this.data.cameraParam))`.
  - `_onTrackerReady(tracker)`: set `this.tracker`, `_setupCamera()`, `_loadPendingMarkers()`. Remove `setLogLevel`, the detection setters and the event listener.
  - `_setupCamera`: `Array.from(this.tracker.cameraMatrix)`, with the scaling unchanged.
  - `registerMarker`: for an already loaded record call `onData(record.data)`.
  - `tick`: `routeFrameResult(this.registry, this.tracker.process(this.camV.getImage(), performance.now()))`.
  - `nft-anchor.onPose(pose, time)`: pass `time` to the filter.
  - Update the comments on `logLevel` and on visibility: found/lost now comes from the tracker's `transitions`.
- [ ] **Step 5:** Run `npm test`. Expected: PASS.
- [ ] **Step 6:** Run `npm run build` and the smoke harness on `basic.html` and `dynamic.html`. Expected: pass.
- [ ] **Step 7:** Commit as `feat: move to the jsartoolkitNFT tracker API`.

### Task 5: Apply runtime settings (#13)

**Files:**
- Modify: `src/registerNFT.js`, `README.md`
- Test: `test/arnftSystem.test.js`

- [ ] **Step 1: Write the failing tests**

```js
it('does nothing before the tracker exists: the constructor calls update({})', () => {
    expect(() => system({ tracker: null }).update({})).not.toThrow();
});
it('sends only what changed to configure()', () => {
    const tracker = { configure: vi.fn(() => Promise.resolve()) };
    const s = system({ tracker, data: { ...base, detectionInterval: 0 } });
    s.update({ ...base });
    expect(tracker.configure).toHaveBeenCalledWith({ detectionInterval: 0 });
});
it('does not call configure() when no runtime key changed', () => {
    const tracker = { configure: vi.fn() };
    system({ tracker, data: { ...base } }).update({ ...base });
    expect(tracker.configure).not.toHaveBeenCalled();
});
it('logs a rejected patch instead of throwing (bad value)', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const tracker = { configure: vi.fn(() => Promise.reject(new TypeError('detectionInterval'))) };
    system({ tracker, data: { ...base, detectionInterval: NaN } }).update({ ...base });
    await flush();
    expect(error.mock.calls[0][0]).toContain('arnft:');
    error.mockRestore();
});
```

- [ ] **Step 2:** Run `npx vitest run test/arnftSystem.test.js`. Expected: FAIL.
- [ ] **Step 3:** Add `update(oldData)` to the system, using `runtimePatch`.
- [ ] **Step 4:** Confirm in a browser console on the dev server what the spec read from the source: `setAttribute('arnft', 'detectionInterval', 0)` leaves `detectionInterval` unset and returns other keys to their defaults, and `setAttribute('arnft', 'videoWidth: 640; videoHeight: 480; detectionInterval: 0')` applies it. Document the working form in the README and say that omitted keys return to their defaults. If the browser disagrees, document what it does and tell the maintainer.
- [ ] **Step 5:** Run `npm test`. Expected: PASS.
- [ ] **Step 6:** Commit as `fix: apply arnft settings changed at runtime` with `Fixes #13`.

### Task 6: Docs, bundle and PR 1

**Files:**
- Modify: `README.md`, `DESIGN.md`, `dist/AframeNft.js`

- [ ] **Step 1: README.** Badge and banner sample to 1.16.0. Remove the `logLevel` caveat about jsartoolkitNFT#677, and say that the camera parameter table still prints at every level. "How it works": diagram and steps use `createNFTTracker`, `addNFTTargets` and `process()` results. Module table: add `src/trackerSettings.js`, `src/frames.js`. Known limitations: runtime adds still stall briefly while the KPM set builds, though the `.zft` check no longer blocks.
- [ ] **Step 2: DESIGN.md section 10.** Replace the visibility and marker-load notes with the tracker API. Record the pose check result.
- [ ] **Step 3:** Run `npm run build` and `npm test`. Commit as `docs: update for jsartoolkitNFT 1.16`, with the rebuilt bundle.
- [ ] **Step 4:** Push and open a PR into `dev`. The body lists `Fixes #13`, `Fixes #14`, the Task 2 result, and a draft comment for #14: point 1 fixed by `reason`; point 2 answered with a warning after 30 s, because failures now report and the tracker has no per-target signal to cancel a load that stays open with no answer; point 3 documented.
- [ ] **Step 5:** Ask the maintainer for the real-camera check. Stop until merged.

---

## PR 2: `@webarkit/camera-view` (`feat-camera-view`, closes #12, #16)

Start from a new worktree and branch off the updated `origin/dev`.

### Task 7: Keep the capture size through `deps.mediaDevices`

**Files:**
- Create: `src/cameraConstraints.js`
- Test: `test/cameraConstraints.test.js`
- Modify: `package.json`, `package-lock.json`

**Interfaces:**
- Produces: `withIdealSize(mediaDevices, { width, height }) → { getUserMedia, enumerateDevices } | undefined`

- [ ] **Step 1:** Run `npm install --save-exact @webarkit/camera-view@0.1.0`.
- [ ] **Step 2: Write the failing tests**

```js
const fake = () => ({ getUserMedia: vi.fn(async () => 'stream'), enumerateDevices: vi.fn(async () => ['cam']) });

it('adds the ideal size and keeps the constraints camera-view chose', async () => {
    const devices = fake();
    await withIdealSize(devices, { width: 640, height: 480 })
        .getUserMedia({ audio: false, video: { facingMode: 'environment', deviceId: { exact: 'x' } } });
    expect(devices.getUserMedia).toHaveBeenCalledWith({
        audio: false,
        video: { facingMode: 'environment', deviceId: { exact: 'x' }, width: { ideal: 640 }, height: { ideal: 480 } },
    });
});
it('leaves out a size of 0', async () => {
    const devices = fake();
    await withIdealSize(devices, { width: 0, height: 0 }).getUserMedia({ video: { facingMode: 'user' } });
    expect(devices.getUserMedia).toHaveBeenCalledWith({ video: { facingMode: 'user' } });
});
it('delegates enumerateDevices', async () => {
    expect(await withIdealSize(fake(), { width: 640, height: 480 }).enumerateDevices()).toEqual(['cam']);
});
it('returns undefined with no mediaDevices, so camera-view reports NOT_SUPPORTED', () => {
    expect(withIdealSize(undefined, { width: 640, height: 480 })).toBeUndefined();
});
```

- [ ] **Step 3:** Run `npx vitest run test/cameraConstraints.test.js`. Expected: FAIL.
- [ ] **Step 4:** Implement it. The comment says camera-view sends `width: { min, max }` only and never `height`, and that this goes away if camera-view gains `ideal`.
- [ ] **Step 5:** Run the same command. Expected: PASS.
- [ ] **Step 6:** Commit as `feat: keep the requested capture size with camera-view`.

### Task 8: Replace `cameraViewRenderer` and use `projectionFor`

**Files:**
- Delete: `src/cameraViewRenderer.js`, `test/cameraViewRenderer.test.js`
- Modify: `src/registerNFT.js`
- Test: `test/arnftSystem.test.js`

**Interfaces:**
- Produces: system field `view` (was `camV`) and field `_frameSize: {width, height}`, set when a tracker is created.

- [ ] **Step 1: Write the failing test**

```js
it('takes the projection from projectionFor, at the exact video aspect', () => {
    const geometry = { frameWidth: 320, frameHeight: 240, videoWidth: 1280, videoHeight: 720 };
    const tracker = { projectionFor: vi.fn(() => new Float64Array(16)) };
    const s = system({
        tracker, view: { geometry }, _resize() {}, _applyProjection() {},
        el: { querySelector: () => ({ getObject3D: () => ({}) }) },
    });
    s._setupCamera();
    expect(tracker.projectionFor).toHaveBeenCalledWith({ width: 1280, height: 720 }, geometry);
});
```

- [ ] **Step 2:** Run `npx vitest run test/arnftSystem.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `init`: `this.view = new CameraView(this.video, { mediaDevices: withIdealSize(navigator.mediaDevices, { width: this.data.videoWidth, height: this.data.videoHeight }) })`, then `view.initialize({ facingMode: 'environment', targetFrameRate: 60 })`.
  - `_maybeStart`: size from `view.geometry.frameWidth` / `frameHeight`, stored in `_frameSize`.
  - `_setupCamera`: `Array.from(tracker.projectionFor({ width: g.videoWidth, height: g.videoHeight }, g))`. Remove the hand scaling and its comment.
  - `tick`: `view.getImage()`.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5:** Run `npm run build` and the smoke harness on both examples. Expected: pass.
- [ ] **Step 6:** Commit as `refactor: use @webarkit/camera-view for the camera`.

### Task 9: Frame gate, tracker restart and a lost camera (#12)

**Files:**
- Modify: `src/frames.js`, `src/markerRegistry.js`, `src/markerLoader.js`, `src/registerNFT.js`
- Test: `test/frames.test.js`, `test/markerRegistry.test.js`, `test/markerLoader.test.js`, `test/arnftSystem.test.js`

**Interfaces:**
- Produces: `nextFrame(view) → ImageData | null`.
- Produces: `MarkerRegistry.hasLoaded() → boolean`, `resetLoadState() → void`, field `generation: number`.
- Produces: system methods `_stopTracker()`, `_restartTracker()`, `_hideAll()`, `_onGeometryChange(g)`, `_onCameraEnded()`, and field `_generation: number`.

- [ ] **Step 1: Write the failing tests**

```js
// frames.test.js
it('returns the frame only when camera-view really captured one', () => {
    const view = { frame: 5, getImage() { this.frame++; return 'new'; } };
    expect(nextFrame(view)).toBe('new');
    const repeated = { frame: 5, getImage: () => 'copy of the last frame' };
    expect(nextFrame(repeated)).toBeNull();
});

// markerRegistry.test.js
it('hasLoaded is false until a registered record has an id', () => {
    const r = new MarkerRegistry();
    const a = r.add(marker('a'));
    expect(r.hasLoaded()).toBe(false);
    r.setLoaded(a, 0, size);
    expect(r.hasLoaded()).toBe(true);
    r.remove(a);
    expect(r.hasLoaded()).toBe(false);
});
it('resetLoadState offers every record for loading again, parked ids forgotten', () => {
    const r = new MarkerRegistry();
    const a = r.setLoaded(r.add(marker('a')), 0, size);
    r.remove(r.setLoaded(r.add(marker('b')), 1, size));
    const before = r.generation;
    r.resetLoadState();
    expect(r.generation).toBe(before + 1);
    expect(a.id).toBeNull();
    expect(r.get(0)).toBeNull();
    expect(r.unloaded()).toEqual([a]);
    expect(r.add(marker('b')).id).toBeNull();
});

// markerLoader.test.js
it('ignores a load that finishes after resetLoadState', async () => {
    loadPendingMarkers(tracker, registry, handlers);
    registry.resetLoadState();
    tracker.requests[0].resolve(loaded(0));
    tracker.requests[1].reject(new Error('NFTTracker: disposed'));
    await flush();
    expect(a.id).toBeNull();
    expect(b.failed).toBe(false);
    expect(handlers.onLoaded).not.toHaveBeenCalled();
    expect(handlers.onFailed).not.toHaveBeenCalled();
});

// arnftSystem.test.js
it('skips process() when no target is loaded', () => {
    const tracker = { process: vi.fn() };
    system({ tracker, videoReady: true, view: { frame: 0, getImage: vi.fn() } }).tick();
    expect(tracker.process).not.toHaveBeenCalled();
});
it('skips process() on a repeated frame', () => { /* a loaded record, a view whose frame does not change */ });
it('re-projects on a geometry change with the same frame size', () => {
    const s = system({ tracker: {}, _frameSize: { width: 320, height: 240 }, _setupCamera: vi.fn(), _restartTracker: vi.fn() });
    s._onGeometryChange({ frameWidth: 320, frameHeight: 240 });
    expect(s._setupCamera).toHaveBeenCalled();
    expect(s._restartTracker).not.toHaveBeenCalled();
});
it('restarts the tracker when the frame size changes', () => { /* 318x239: _restartTracker called once */ });
it('a restart hides the content, disposes the old tracker and loads every target on the new one', async () => {
    const old = { dispose: vi.fn() };
    const fresh = { cameraMatrix: new Float64Array(16), addNFTTargets: vi.fn(() => new Promise(() => {})) };
    createNFTTracker.mockResolvedValueOnce(fresh);
    const onLost = vi.fn();
    const s = system({ tracker: old, videoReady: true, _setupCamera() {}, view: { geometry: { frameWidth: 318, frameHeight: 239 } } });
    s.registry.setLoaded(s.registry.add({ name: 'a', url: 'a', component: { onLost } }), 0, size);
    s._restartTracker();
    await flush();
    expect(onLost).toHaveBeenCalledTimes(1);
    expect(old.dispose).toHaveBeenCalled();
    expect(createNFTTracker.mock.lastCall[0]).toMatchObject({ width: 318, height: 239 });
    expect(fresh.addNFTTargets).toHaveBeenCalledWith(['a'], { origin: 'corner' });
});
it('hides the content and stops reading frames when the camera ends', () => {
    const onLost = vi.fn();
    const getImage = vi.fn(() => { throw new Error('STREAM_ENDED'); });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const s = system({ tracker: { process: vi.fn() }, videoReady: true, view: { frame: 0, getImage } });
    s.registry.setLoaded(s.registry.add({ name: 'a', url: 'a', component: { onLost } }), 0, size);
    s._onCameraEnded();
    expect(onLost).toHaveBeenCalledTimes(1);
    expect(() => s.tick()).not.toThrow();
    expect(getImage).not.toHaveBeenCalled();
    warn.mockRestore();
});
```

- [ ] **Step 2:** Run `npm test`. Expected: FAIL in those files.
- [ ] **Step 3: Implement.**
  - `nextFrame`: compare `view.frame` before and after `view.getImage()`.
  - `resetLoadState`: bump `generation`, clear `_byId` and `_parked`, and set every record to `id = null`, `data = null`, `loading = false`, `failed = false`.
  - `loadPendingMarkers`: capture `registry.generation` when a load starts; ignore the outcome, success or failure, if it changed.
  - `tick`: after `_resize` / `_applyProjection`, return unless `registry.hasLoaded()`; `const frame = nextFrame(this.view)`; return if null.
  - `_stopTracker`: bump `_generation`, set `tracker = null`, `starting = false`, call `registry.resetLoadState()`, dispose the old tracker.
  - `_restartTracker`: `_hideAll()`, `_stopTracker()`, `_maybeStart()`.
  - `_maybeStart`: capture `_generation`. If it changed when the creation settles, a resolved tracker is disposed and a rejection is ignored, so an old start cannot touch `starting` or `tracker` of a newer one.
  - `_maybeStart` also keeps the `cameraParam` of the first start and reuses it on a restart: a partial `setAttribute('arnft', 'key: value')` resets `this.data.cameraParam` to its default, so a restart that read it could load the wrong file. Add a test for this.
  - Guard `process()` in `tick`: an error must not repeat on every frame. As built, it logs once, hides the content and stops tracking. camera-view changes the frame size and dispatches `geometrychange` in the same step, so a size mismatch cannot reach `process()`.
  - `init`: `view.addEventListener('geometrychange', (e) => this._onGeometryChange(e.detail))` and `'ended'` to `_onCameraEnded`, which sets `videoReady = false`, calls `_hideAll()` and warns.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit as `feat: skip repeated frames and follow camera changes` with `Fixes #12`.

### Task 10: Teardown when the scene is removed (#16)

A-Frame never calls a system `remove()`, so the system adds an internal component to the scene. The scene's `disconnectedCallback` runs that component's `remove()`.

**Files:**
- Modify: `src/registerNFT.js`
- Test: `test/arnftSystem.test.js`

**Interfaces:**
- Produces: component `arnft-lifecycle`, system methods `_teardown()` and `_onCameraError(err)`, field `stopped: boolean`.

- [ ] **Step 1: Write the failing tests**

```js
it('the scene component tears the system down', () => {
    const _teardown = vi.fn();
    definitions['arnft-lifecycle'].remove.call({ el: { systems: { arnft: { _teardown } } } });
    expect(_teardown).toHaveBeenCalledTimes(1);
});
it('teardown stops the camera, disposes the tracker and blocks a restart', () => {
    const tracker = { dispose: vi.fn() };
    const view = { destroy: vi.fn() };
    const s = system({ tracker, view, videoReady: true });
    s._teardown();
    expect(view.destroy).toHaveBeenCalled();
    expect(tracker.dispose).toHaveBeenCalled();
    expect(s.tracker).toBeNull();
    s.registerMarker({ name: 'a', url: 'a', component: {} });
    expect(createNFTTracker).not.toHaveBeenCalled();
});
it('disposes a tracker that resolves after teardown', async () => {
    const late = { dispose: vi.fn() };
    createNFTTracker.mockResolvedValueOnce(late);
    const s = system({ videoReady: true, view: { destroy() {}, geometry: { frameWidth: 320, frameHeight: 240 } } });
    s.registry.add({ name: 'a', url: 'a', component: {} });
    s._maybeStart();
    s._teardown();
    await flush();
    expect(late.dispose).toHaveBeenCalled();
    expect(s.tracker).toBeNull();
});
it('does not report a camera start cancelled by teardown, but reports other errors', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const s = system();
    s._onCameraError(Object.assign(new Error('destroyed'), { code: 'DESTROYED' }));
    expect(error).not.toHaveBeenCalled();
    s._onCameraError(new Error('NotAllowedError'));
    expect(error.mock.calls[0][0]).toContain('arnft: camera init failed');
    error.mockRestore();
});
```

- [ ] **Step 2:** Run `npx vitest run test/arnftSystem.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement.** `init` calls `this.el.setAttribute('arnft-lifecycle', '')`. `_teardown` sets `stopped = true` and `videoReady = false`, calls `_stopTracker()` and `view.destroy()`. `_maybeStart` returns when `stopped`. The camera `.catch` calls `_onCameraError`.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5:** Extend the smoke harness: after tracking starts, run `document.querySelector('a-scene').remove()`, then assert `document.getElementById('video').srcObject === null` and that no page error followed. Run it on `basic.html`. Expected: pass.
- [ ] **Step 6:** Commit as `fix: stop the camera and tracker when the scene is removed` with `Fixes #16`.

### Task 11: Docs, bundle and PR 2

**Files:**
- Modify: `README.md`, `DESIGN.md`, `dist/AframeNft.js`

- [ ] **Step 1: README.** Troubleshooting: add `CameraViewError` codes; the virtual-camera sentence changes because a desktop now uses the default camera. Module table: remove `cameraViewRenderer`, add `src/cameraConstraints.js`. Diagram and steps use `CameraView`. Credits add camera-view. Say that removing the scene stops the camera, and that re-attaching a removed scene is not supported.
- [ ] **Step 2: DESIGN.md section 10.** Note that #6 is partly undone by `getImage()` copying, and why that is accepted.
- [ ] **Step 3:** Run `npm run build` and `npm test`. Commit as `docs: update for camera-view`, with the rebuilt bundle.
- [ ] **Step 4:** Push and open a PR into `dev`. The body lists the accepted behaviour changes: no retry when a phone's last camera fails, and a desktop uses the default camera. It includes a draft comment for #12 stating the limit: a camera slower than `targetFrameRate` still has some pictures processed twice.
- [ ] **Step 5:** Ask the maintainer for the real-camera check, including rotating a phone and removing the scene with the camera light in view. Stop until merged.

---

## PR 3: tracking in a Worker (`feat-nft-worker`, closes #7)

Start from a new worktree and branch off the updated `origin/dev`.

### Task 12: Measure first, then ship the Worker files

**Files:**
- Modify: `vite.config.js`, `dist/`

- [ ] **Step 1: Measure.** With an uncommitted patch in `tick`, collect `result.processMs` split by whether any target has `found: true`, and log the medians every 300 frames. Run on the desktop with the smoke harness and record the numbers. Ask the maintainer to run the same patch on a phone over HTTPS. Revert the patch with `git checkout -- src/registerNFT.js`. Coding can continue, but PR 3 does not merge without the phone numbers.
- [ ] **Step 2:** Add a plugin to `vite.config.js` whose `closeBundle` copies `NFTTracker.worker.js`, `NFTTracker_simd.worker.js`, `NFTTracker_td.worker.js` and `NFTTracker_td.pthread.js` from `node_modules/@webarkit/jsartoolkit-nft/dist/` to `dist/`, with `fs.copyFileSync` and no new dependency. A missing file then fails the build, which is what we want if upstream renames one.
- [ ] **Step 3:** Run `npm run build`, then `git status --short dist/`. Expected: the four files are listed as new.
- [ ] **Step 4:** Commit as `build: ship the tracker Worker files in dist/`.

### Task 13: Choose the tracker, with a fallback

**Files:**
- Create: `src/trackerFactory.js`
- Test: `test/trackerFactory.test.js`
- Modify: `src/registerNFT.js`

**Interfaces:**
- Produces: `createTracker(config, { worker: boolean, workerBase: string }, { createNFTTracker, createNFTTrackerWorker }) → Promise<tracker>`
- Produces: `WORKER_START_TIMEOUT_MS = 30000`
- Consumes: the system schema gains `worker` and `workerBase`.

- [ ] **Step 1: Write the failing tests**

```js
const config = { width: 320, height: 240, cameraParam: 'c' };
const factories = () => ({ createNFTTracker: vi.fn(async () => 'same'), createNFTTrackerWorker: vi.fn(async () => 'worker') });

it('uses the same thread by default', async () => {
    const f = factories();
    expect(await createTracker(config, { worker: false, workerBase: '' }, f)).toBe('same');
    expect(f.createNFTTrackerWorker).not.toHaveBeenCalled();
});
it('uses the Worker on request, bounding its start', async () => {
    // Spied so no real 30 s timer outlives the test; check jsdom exposes it when this runs.
    const signal = new AbortController().signal;
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(signal);
    const f = factories();
    expect(await createTracker(config, { worker: true, workerBase: '' }, f)).toBe('worker');
    const [, opts] = f.createNFTTrackerWorker.mock.calls[0];
    expect(timeout).toHaveBeenCalledWith(30000);
    expect(opts.signal).toBe(signal);
    expect(opts).not.toHaveProperty('workerBase'); // empty: next to the bundle
    timeout.mockRestore();
});
it('passes workerBase when set', async () => {
    const f = factories();
    await createTracker(config, { worker: true, workerBase: '/nft/' }, f);
    expect(f.createNFTTrackerWorker.mock.calls[0][1].workerBase).toBe('/nft/');
});
it('falls back to the same thread and warns when the Worker cannot start', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const f = factories();
    f.createNFTTrackerWorker.mockRejectedValue(new Error('the worker failed to start'));
    expect(await createTracker(config, { worker: true, workerBase: '' }, f)).toBe('same');
    expect(warn.mock.calls[0][0]).toContain('arnft:');
    warn.mockRestore();
});
```

- [ ] **Step 2:** Run `npx vitest run test/trackerFactory.test.js`. Expected: FAIL.
- [ ] **Step 3:** Implement the module, importing nothing from the package. In `registerNFT.js`, import both functions from `@webarkit/jsartoolkit-nft`, add the two schema entries, and have `_maybeStart` call `createTracker`. The three test files that mock the package also mock `createNFTTrackerWorker`.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit as `feat: create the tracker in a Worker on request`.

### Task 14: Asynchronous frames

**Files:**
- Modify: `src/registerNFT.js`, `src/frames.js`
- Test: `test/arnftSystem.test.js`, `test/frames.test.js`

**Interfaces:**
- Produces: system fields `_inFlight: boolean`, method `_onTrackerFailure(err)`. `routeFrameResult` ignores `{ skipped: true }`.

- [ ] **Step 1: Write the failing tests**

```js
// frames.test.js
it('ignores a skipped frame', () => {
    expect(() => routeFrameResult(registry, { skipped: true })).not.toThrow();
});

// arnftSystem.test.js. Helper: a loaded record, a view whose frame always advances,
// and a tracker whose process() returns a promise the test resolves.
it('captures no frame while a process() is in flight', () => {
    const { s, view } = asyncSetup();
    s.tick();
    s.tick();
    expect(view.getImage).toHaveBeenCalledTimes(1);
});
it('routes the result when it arrives, then accepts the next frame', async () => {
    const { s, view, onPose, finish } = asyncSetup();
    s.tick();
    finish({ time: 1, targets: [{ id: 0, found: true, pose: POSE }], transitions: [] });
    await flush();
    expect(onPose).toHaveBeenCalledWith(POSE, 1);
    s.tick();
    expect(view.getImage).toHaveBeenCalledTimes(2);
});
it('drops a result that arrives after the tracker was stopped', async () => {
    const { s, onPose, finish } = asyncSetup();
    s.tick();
    s._stopTracker();
    finish({ time: 1, targets: [{ id: 0, found: true, pose: POSE }], transitions: [] });
    await flush();
    expect(onPose).not.toHaveBeenCalled();
});
it('logs once, hides the content and stops when a running Worker fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { s, onLost, fail } = asyncSetup();
    s.tick();
    fail(new Error('NFTTracker worker: crashed'));
    await flush();
    expect(error).toHaveBeenCalledTimes(1);
    expect(onLost).toHaveBeenCalledTimes(1);
    expect(s.stopped).toBe(true);
    error.mockRestore();
});
it('still routes a same-thread result synchronously', () => { /* process returns a plain result: onPose called within tick() */ });
```

- [ ] **Step 2:** Run `npm test`. Expected: FAIL in those files.
- [ ] **Step 3: Implement.** In `tick`, return early if `_inFlight`, before `nextFrame`. If `process()` returns a thenable, set `_inFlight`, and when it settles clear `_inFlight` and act only if `this.tracker` is still that tracker. A plain result is routed at once. `_onTrackerFailure` logs, calls `_hideAll()`, `_stopTracker()` and sets `stopped = true`. `_stopTracker` now returns `Promise.resolve(tracker?.dispose())`, and `_restartTracker` waits for it before `_maybeStart()`, so no new tracker runs beside the old Worker. Update the Task 9 restart test to match.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit as `feat: process frames asynchronously in the Worker`.

### Task 15: Example, real-browser check, docs and PR 3

**Files:**
- Create: `examples/worker.html`
- Modify: `examples/index.html`, `README.md`, `DESIGN.md`, `dist/AframeNft.js`

- [ ] **Step 1:** Add `examples/worker.html`, a copy of `basic.html` with `arnft="videoWidth: 640; videoHeight: 480; worker: true; workerBase: ../dist/"`, and a `<li>` in `examples/index.html`.
- [ ] **Step 2:** Run `npm run build`, then the smoke harness on `worker.html` through the dev server. If Vite's transform breaks the Worker files, serve them to the dev server another way and record how. This path is untested so far.
- [ ] **Step 3:** Serve the repository root with a small static server in the scratch folder, and test a scratch page that loads `dist/AframeNft.js` with a plain `<script src>`:
  - `worker: true` with no `workerBase`: tracking runs and the Worker URL is next to the bundle;
  - `workerBase: /nope/`: a warning, then tracking on the same thread within seconds, not after 30 s;
  - no `worker` attribute: tracking on the same thread and no Worker requested;
  - with `worker: true`, removing the scene leaves no Worker running.
- [ ] **Step 4: README.** A section on the Worker: the four files to serve next to the bundle, the same-origin rule, `workerBase`, `td` on cross-origin isolated pages, about one frame of pose latency, and that a Worker page downloads the WASM twice. Known limitations: replace the main-thread entry, and say the Worker avoids the runtime-add stall. Module table: add `src/trackerFactory.js`. API table: add `worker` and `workerBase`.
- [ ] **Step 5: DESIGN.md section 10.** Record the measurements. State that the default stays off and is a separate decision.
- [ ] **Step 6:** Run `npm run build` and `npm test`. Commit as `docs: add the Worker example and documentation`, with the rebuilt bundle.
- [ ] **Step 7:** Push and open a PR into `dev` with `Fixes #7`, the measurements, and a draft comment for #7 saying that the upstream Worker supersedes its protocol and suggested order.
- [ ] **Step 8:** Ask the maintainer for the real-camera check of `worker.html`. Stop until merged.

---

## PR 4: marker lifecycle (`fix-marker-lifecycle`, closes #11, #15, #17)

Start from a new worktree and branch off the updated `origin/dev`.

### Task 16: `nft-anchor` lifecycle (#15, #17)

**Files:**
- Modify: `src/registerNFT.js`, `README.md`
- Test: `test/nftAnchor.test.js`

**Interfaces:**
- Produces: `nft-anchor` no longer has `tick` or `latestMatrix`; `onPose` writes the matrix. Method `_register()`.

- [ ] **Step 1: Write the failing tests**

```js
it('hides the mesh until the first pose (#17)', () => {
    expect(startedAnchor().mesh.visible).toBe(false);
});
it('writes the pose in onPose, because tick does not resume after a re-append (#15)', () => {
    const anchor = startedAnchor();
    anchor.onPose(new Float64Array(16), 1);
    expect(anchor.mesh.visible).toBe(true);
    expect(anchor.mesh.matrixAutoUpdate).toBe(false);
    expect(anchor.mesh.matrix.copy).toHaveBeenCalled();
});
it('registers the new target when markerUrl changes (#15)', () => {
    const anchor = startedAnchor();
    const { arnft } = anchor.el.sceneEl.systems;
    const old = anchor.marker;
    const oldData = { ...anchor.data };
    anchor.data.markerUrl = 'DataNFT/other';
    anchor.update(oldData);
    expect(arnft.unregisterMarker).toHaveBeenCalledWith(old);
    expect(arnft.registerMarker.mock.lastCall[0].url).toBe('DataNFT/other');
    expect(anchor.mesh.visible).toBe(false);
});
it('registers again on loaded after a re-append (#15)', () => {
    const anchor = startedAnchor();
    anchor.remove();
    anchor.el.emit('loaded');
    expect(anchor.marker).not.toBeNull();
});
it('does not register again once nft-anchor was removed for good', () => {
    const anchor = startedAnchor();
    anchor.remove();
    anchor.el.components['nft-anchor'] = undefined;
    anchor.el.emit('loaded');
    expect(anchor.marker).toBeNull();
});
```

The `startedAnchor` stub gains: `el.addEventListener`, a small `emit`, `el.components = { 'nft-anchor': anchor }`, a `mesh` with `matrix: { copy: vi.fn() }`, and `registerMarker` / `unregisterMarker` spies. Update the existing `remove()` test to drop `latestMatrix`.

- [ ] **Step 2:** Run `npx vitest run test/nftAnchor.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement.** `init`: `mesh.visible = false`, `_register()`, and listen for `loaded`, registering when `this.marker === null` and `this.el.components['nft-anchor'] === this`. `update`: on a changed `markerUrl` with a record, unregister, `onLost()`, `_register()`; skip this on the first call, where `oldData` is `{}`. `onPose`: write straight into `mesh.matrix` with `matrixAutoUpdate = false`. Delete `tick`.
- [ ] **Step 4:** Remove the README caveats and limitation about `url` changes and re-appending, and the matching code comments.
- [ ] **Step 5:** Run `npm test`. Expected: PASS.
- [ ] **Step 6:** Run `npm run build`, then the smoke harness with a step on `dynamic.html` that removes and re-appends the same `<a-nft>` element. Expected: pass.
- [ ] **Step 7:** Commit as `fix: follow url changes and re-appended <a-nft>, hide until the first pose` with `Fixes #15` and `Fixes #17`.

### Task 17: One target per url (#11)

**Files:**
- Modify: `src/markerRegistry.js`, `src/markerLoader.js`, `src/frames.js`
- Test: `test/markerRegistry.test.js`, `test/markerLoader.test.js`, `test/frames.test.js`

**Interfaces:**
- Produces: `MarkerRegistry.markLoading(marker) → boolean`, true when the caller must start the load, false when one is already in flight for that url.
- Produces: `finishLoad(url, id, data) → MarkerRecord[]`, `failLoad(url) → MarkerRecord[]`, `recordsFor(id) → MarkerRecord[]`. These replace `setLoaded`, `markLoadFailed` and `get`.
- `loadPendingMarkers` handlers now run once per record returned.

- [ ] **Step 1: Write the failing tests**

```js
// markerRegistry.test.js
it('gives two live records with the same url the same id, with no second load', () => {
    const r = new MarkerRegistry();
    const a = r.add(marker('a'));
    const a2 = r.add(marker('a'));
    expect(r.markLoading(a)).toBe(true);
    expect(r.markLoading(a2)).toBe(false);
    expect(r.finishLoad(a.url, 0, size)).toEqual([a, a2]);
    expect(r.recordsFor(0)).toEqual([a, a2]);
    expect(a2.id).toBe(0);
});
it('a record added during a load joins it (add, remove, add)', () => {
    const r = new MarkerRegistry();
    const first = r.add(marker('a'));
    r.markLoading(first);
    r.remove(first);
    const second = r.add(marker('a'));
    expect(r.unloaded()).toEqual([]);
    expect(r.finishLoad(first.url, 0, size)).toEqual([second]);
    expect(second.id).toBe(0);
});
it('a load with nobody waiting keeps the target for the next record', () => {
    const r = new MarkerRegistry();
    const a = r.add(marker('a'));
    r.markLoading(a);
    r.remove(a);
    expect(r.finishLoad(a.url, 3, size)).toEqual([]);
    expect(r.add(marker('a')).id).toBe(3);
});
it('a failure reaches every record waiting on that url', () => {
    const r = new MarkerRegistry();
    const a = r.add(marker('a'));
    const a2 = r.add(marker('a'));
    r.markLoading(a);
    r.markLoading(a2);
    expect(r.failLoad(a.url)).toEqual([a, a2]);
    expect(a2.failed).toBe(true);
});
it('keeps routing to the records that remain', () => {
    const r = new MarkerRegistry();
    const a = r.add(marker('a'));
    const a2 = r.add(marker('a'));
    r.markLoading(a);
    r.markLoading(a2);
    r.finishLoad(a.url, 0, size);
    r.remove(a);
    expect(r.recordsFor(0)).toEqual([a2]);
    expect(r.hasLoaded()).toBe(true);
});

// markerLoader.test.js
it('asks the tracker only once for two <a-nft> with the same url', () => {
    // setup with two markers on one url
    loadPendingMarkers(tracker, registry, handlers);
    expect(tracker.requests).toHaveLength(1);
});

// frames.test.js
it('routes one target to every record on it', () => {
    routeFrameResult(registry, { time: 1, targets: [{ id: 0, found: true, pose }], transitions: [{ type: 'lost', id: 0 }] });
    expect(first.onPose).toHaveBeenCalledWith(pose, 1);
    expect(second.onPose).toHaveBeenCalledWith(pose, 1);
    expect(second.onLost).toHaveBeenCalledTimes(1);
});
```

Rewrite the "hands each parked id out only once" test: two records on one url now share one id. The fake registry in `test/frames.test.js` switches from `get(id)` to `recordsFor(id)`.

- [ ] **Step 2:** Run `npm test`. Expected: FAIL in those files.
- [ ] **Step 3: Implement.** Replace the parked map with `_targets: Map<url, { id, data }>`, kept for the tracker's lifetime; `_byId: Map<id, Set<record>>`; `_inFlight: Map<url, Set<record>>`. An entry in `_inFlight` survives its records being removed, so a later `add` can join it. `add` adopts `_targets`, or joins `_inFlight`, setting `loading = true`. `resetLoadState` clears all three. The loader keeps its `generation` check. Each record keeps its own filter, in `nft-anchor`.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit as `fix: load each NFT target only once` with `Fixes #11`.

### Task 18: Docs, bundle and PR 4

**Files:**
- Modify: `README.md`, `DESIGN.md`, `dist/AframeNft.js`

- [ ] **Step 1:** Update the README "Adding and removing targets" section and the module table, and DESIGN.md section 10: one target per url, and several `<a-nft>` may share it.
- [ ] **Step 2:** Run `npm run build` and `npm test`, then the smoke harness on all examples. Expected: pass. Commit as `docs: update for the marker lifecycle fixes`, with the rebuilt bundle.
- [ ] **Step 3:** Push and open a PR into `dev`. Ask the maintainer for the real-camera check. Stop until merged.
- [ ] **Step 4:** Tell the maintainer that all eight issues are addressed. They close when `dev` reaches `main`, the default branch, and the `0.3.0` release is a separate step through the usual flow.

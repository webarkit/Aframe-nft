# jsartoolkitNFT 1.13.0 — Multi-NFT Follow-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade to jsartoolkitNFT 1.13.0 and use what it unblocks: simultaneous multi-target tracking (#8), `<a-nft>` elements added/removed at runtime (#5), plus the per-frame `getImage()` copy (#6).

**Architecture:** The `arnft` system keeps owning the single `ARControllerNFT`. Marker loading moves out of `registerNFT.js` into a DOM-free `src/markerLoader.js` that loads **one marker per `loadNFTMarker()` call, at any time** (safe since 1.13.0). `MarkerRegistry` learns removal: a removed `<a-nft>` parks its tracker id by url so a re-added one reuses the loaded dataset (the tracker cannot unload and holds at most 20). Visibility stays timestamp-based (`lostTimeout`), unchanged.

**Tech Stack:** A-Frame 1.7.1, `@webarkit/jsartoolkit-nft` 1.13.0 (default WASM build), Vite 6, Vitest 3 + jsdom.

**Spec:** No design doc — the spec is the open issues plus the upstream release:
- webarkit/Aframe-nft#5 — dynamically added `<a-nft>` cannot be tracked (was blocked by jsartoolkitNFT#612)
- webarkit/Aframe-nft#6 — `getImage()` allocates and copies the full buffer on every call
- webarkit/Aframe-nft#8 — multiple `<a-nft>` targets with per-marker visibility (implemented by PR #9 on `dev`; this plan completes its acceptance with simultaneous tracking)
- webarkit/Aframe-nft#7 — **out of scope here** (separate plan; see "Out of scope")
- jsartoolkitNFT 1.13.0 release notes: https://github.com/webarkit/jsartoolkitNFT/releases/tag/1.13.0 (PRs #658, #666)

## Upstream facts (verified in the published 1.13.0 package)

Read these before touching code — every design choice below rests on them.

- `ARControllerNFT` public API is unchanged except two new setters:
  `setContinuousDetection(enabled: boolean)` (default `true`) and `setDetectionInterval(ms: number)` (default `300`; `0` = every frame).
- **Every loaded marker is tracked at once.** `process()` dispatches one `getNFTMarker` event per tracked marker per frame, each with its **own fresh** `matrixGL_RH` array. `ev.data.index` is the marker id.
- **`loadNFTMarker(url, onSuccess(id), onError(err))` can be called any number of times.** Ids continue `0, 1, 2…` across calls; earlier markers stay loaded and detectable. It is an `async` function returning a Promise.
- **Limit: 20 markers in total (`PAGES_MAX`).** A load past the limit does **not** call `onError`: it calls `onSuccess` with no id (`loadNFTMarker` passes `ids[0]`, i.e. `undefined`).
- **`onError` fires once per failed descriptor file** (`.fset`, `.iset`, `.fset3`), so one missing marker can report up to 3 times. A network error (XHR `onerror`) never calls back at all.
- **No unload API.** Once loaded, a marker stays in the tracker for the controller's lifetime.
- `getNFTData(index)` takes **only** the index and returns `{ width, height, dpi }`. (Current code passes a stray second argument `getNFTData(id, 0)`; it is ignored, but remove it.)
- `process(image)` copies `image.data` into the WASM heap **synchronously** (`passVideoData` → `HEAPU8.set`) and keeps no reference — so reusing one `ImageData` across frames (#6) is safe for the default build.
- `lostNFTMarker` is now per-marker, but its timeout is hard-coded to 200 ms. We keep deriving visibility ourselves (`lostTimeout`, tunable).
- Package entry points are identical to 1.10.1 (`main: dist/ARToolkitNFT.js`, same `exports`); `canvas`/`sharp` are no longer dependencies.

## Before you start

The local checkout may be on `feat-regular-arnft` — a **stale** pre-Vite branch whose remote was deleted. Do not base work on it. Work starts from `origin/dev`:

```bash
git fetch origin
git switch -c feat-jsartoolkitnft-1.13 origin/dev
npm ci
npm test
```

Expected: `npm test` is green (the existing `markerRegistry`, `nftMath`, `oneEuroFilter` suites). If you use a worktree, copy this plan file into it and commit it first:

```bash
git add docs/superpowers/plans/2026-09-25-jsartoolkitnft-1.13-multi-nft.md
git commit -m "docs: add jsartoolkitNFT 1.13 multi-NFT plan" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

## Global Constraints

- Base branch `dev`; the PR targets `dev`, not `main`.
- `@webarkit/jsartoolkit-nft` pinned **exactly** to `1.13.0` (the repo pins exact versions); `aframe` stays `1.7.1`.
- Default build only: `import { ARControllerNFT } from '@webarkit/jsartoolkit-nft'`. Do **not** switch to `/simd` or `/td`.
- Public API stays backward compatible: `<a-nft url name>` and every existing attribute/default unchanged. New attributes are optional with defaults matching upstream (`continuousDetection: true`, `detectionInterval: 300`).
- Convention: logic lives in DOM-free modules under `src/` with a Vitest suite `test/<module>.test.js`; A-Frame glue in `src/registerNFT.js` is verified by `npm run build` + a manual checklist (no A-Frame test harness exists — do not add one).
- Style: ES modules, 4-space indent, single quotes, semicolons (`src/cameraViewRenderer.js` uses double quotes — keep that file's style). Extensionless imports inside `src/`, `.js` imports in `test/`. Comments explain *why*, citing upstream issues as `webarkit/jsartoolkitNFT#NNN`.
- Commits: conventional prefixes (`feat:`, `fix:`, `perf:`, `docs:`, `chore:`), each ending with the `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` trailer.
- `dist/AframeNft.js` is tracked. Rebuild and commit it **only in Task 6**; if an earlier `npm run build` touches it, run `git restore dist/AframeNft.js`.
- Steps marked **(human)** need a camera and printed targets — hand them to your human partner; do not claim them as passed.

## Review Focus

The inputs most likely to bite a user that the issues imply but don't spell out, each pinned by a test in the owning task:

1. **A marker `url` that 404s** — the other `<a-nft>` elements still load, and the failure is reported once, not three times. → Task 3: `fails only the marker whose load failed`, `reports a failure once even when every descriptor file fails`.
2. **More than 20 targets** — the 21st is reported as a clear failure, never recorded under an `undefined` id. → Task 3: `treats a load that returns no id as a failure (tracker full)`.
3. **An `<a-nft>` removed and added again** (toggled content) — reuses the loaded dataset instead of loading a duplicate, which would exhaust the 20-marker limit after a few toggles. → Task 2: `reuses the id of a removed marker when the same url is added again`, `hands each parked id out only once`.
4. **An `<a-nft>` removed while its target is still loading** — no `onData` on the dead component, and the dataset is kept for reuse. → Task 2: `parks the id when a marker is removed while its load is in flight`; Task 3: `does not hand data to a marker removed while it was loading`.
5. **An `<a-nft>` removed while its mesh is visible** — its poses stop being routed and it never receives `onLost` afterwards. → Task 2: `stops routing poses to a removed marker`, `never reports a removed marker as stale`.

## Out of scope

- **#7 (Web Worker detection)** — separate plan. It should first re-evaluate jsartoolkitNFT's own threaded build (`@webarkit/jsartoolkit-nft/td`), which in 1.13.0 already runs detection off the main thread but uses pthreads (SharedArrayBuffer → cross-origin isolation, COOP/COEP headers). The correction comment on #7 ("`addMarker` cannot be incremental (yet)") is obsolete as of 1.13.0.
- Changing `url` on an existing `<a-nft>` at runtime (remove and re-add the element instead).
- Two `<a-nft>` elements active at the same time with the **same** `url` (each loads its own copy, as today).
- Load timeouts for requests that never answer (upstream never calls back on a network error; only that one marker stays unloaded).

---

### Task 1: Upgrade `@webarkit/jsartoolkit-nft` to 1.13.0

**Files:**
- Modify: `package.json` (`dependencies`)
- Modify: `package-lock.json` (regenerated by npm)

**Interfaces:**
- Consumes: nothing.
- Produces: `ARControllerNFT` 1.13.0 — `loadNFTMarker(url, onSuccess(id), onError(err)) → Promise`, `setContinuousDetection(bool)`, `setDetectionInterval(ms)`, `getNFTData(index) → { width, height, dpi }`, `trackNFTMarkerId(id)`.

- [ ] **Step 1: Confirm the installed version is the old one**

Run: `npm ls @webarkit/jsartoolkit-nft`
Expected: `@webarkit/jsartoolkit-nft@1.10.1`

- [ ] **Step 2: Install 1.13.0, pinned exactly**

Run: `npm install --save-exact @webarkit/jsartoolkit-nft@1.13.0`

- [ ] **Step 3: Verify the version and the API later tasks depend on**

Run: `npm ls @webarkit/jsartoolkit-nft`
Expected: `@webarkit/jsartoolkit-nft@1.13.0`

Run: `grep -cE "setContinuousDetection|setDetectionInterval" node_modules/@webarkit/jsartoolkit-nft/types/src/ARControllerNFT.d.ts`
Expected: `2`

Check `package.json` reads exactly `"@webarkit/jsartoolkit-nft": "1.13.0"` (no caret).

- [ ] **Step 4: Run the tests and the build**

Run: `npm test`
Expected: PASS, same suites as the baseline.

Run: `npm run build`
Expected: build succeeds and writes `dist/AframeNft.js`. Then run `git restore dist/AframeNft.js` (dist is committed in Task 6 only).

- [ ] **Step 5 (human): Smoke test on camera**

Run `npm run dev`, open `http://localhost:8080/examples/basic.html`.
Expected: pointing at `pinball` shows the blue box exactly as before. With `pinball` and `kuva` both in view, **both** meshes now appear together (1.13.0 tracks every loaded marker at once — no code change needed for that).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: upgrade @webarkit/jsartoolkit-nft to 1.13.0" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `MarkerRegistry` — removal and dataset reuse

**Files:**
- Modify: `src/markerRegistry.js`
- Test: `test/markerRegistry.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces (used by Tasks 3 and 4):
  - `add(marker) → record` — unchanged signature (`marker` is `{ name, url, component }`). **New:** if a removed marker parked an id for the same `url`, the record comes back **already loaded** (`record.id !== null`).
  - `has(marker) → boolean`
  - `remove(marker) → void` — no-op for an unregistered marker.
  - `setId(marker, id) → record | null` — **changed:** returns `null` (and parks the id by url) when `marker` was removed before its load finished.

- [ ] **Step 1: Write the failing tests**

Append to the end of `test/markerRegistry.test.js`:

```js
describe('MarkerRegistry removal', () => {
    it('stops routing poses to a removed marker', () => {
        const r = new MarkerRegistry();
        const a = r.setId(r.add(marker('a')), 0);
        r.remove(a);
        expect(r.has(a)).toBe(false);
        expect(r.get(0)).toBeNull();
        expect(r.markSeen(0, 1000)).toBeNull();
    });

    it('never reports a removed marker as stale', () => {
        // A removed <a-nft> must not receive onLost after it is gone.
        const r = new MarkerRegistry();
        const a = r.setId(r.add(marker('a')), 0);
        r.markSeen(0, 1000);
        r.remove(a);
        expect(r.collectStale(1300, 200)).toEqual([]);
    });

    it('ignores removing a marker that is not registered', () => {
        const r = new MarkerRegistry();
        r.add(marker('a'));
        r.remove(marker('x'));
        expect(r.markers).toHaveLength(1);
    });

    it('reuses the id of a removed marker when the same url is added again', () => {
        // jsartoolkitNFT cannot unload a marker and holds at most 20, so a
        // re-added <a-nft> must not load its target a second time.
        const r = new MarkerRegistry();
        r.remove(r.setId(r.add(marker('a')), 0));
        const again = r.add(marker('a'));
        expect(again.id).toBe(0);
        expect(r.get(0)).toBe(again);
        expect(r.unloaded()).toEqual([]);
    });

    it('does not reuse an id for a different url', () => {
        const r = new MarkerRegistry();
        r.remove(r.setId(r.add(marker('a')), 0));
        const b = r.add(marker('b'));
        expect(b.id).toBeNull();
        expect(r.unloaded()).toEqual([b]);
    });

    it('hands each parked id out only once', () => {
        // Two <a-nft> with the same url, both loaded, then both removed.
        const r = new MarkerRegistry();
        const first = r.setId(r.add(marker('a')), 0);
        const second = r.setId(r.add(marker('a')), 1);
        r.remove(first);
        r.remove(second);
        const ids = [r.add(marker('a')).id, r.add(marker('a')).id, r.add(marker('a')).id];
        expect(ids).toEqual([0, 1, null]);
    });

    it('parks the id when a marker is removed while its load is in flight', () => {
        const r = new MarkerRegistry();
        const a = r.add(marker('a'));
        r.markLoading(a);
        r.remove(a);
        expect(r.setId(a, 3)).toBeNull();
        expect(r.get(3)).toBeNull();
        expect(r.add(marker('a')).id).toBe(3);
    });
});
```

Also update the comment in the existing test `treats a load failure as terminal and does not offer it for retry` — the #612 rationale no longer holds. Replace its two comment lines with:

```js
        // Retrying the same url would only fail again; re-adding the <a-nft>
        // registers a fresh record, which is loaded anew.
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/markerRegistry.test.js`
Expected: the 7 new tests FAIL with `r.remove is not a function` / `r.has is not a function`; the existing 14 still PASS.

- [ ] **Step 3: Implement removal and reuse**

In `src/markerRegistry.js`, replace the header comment (lines 1–14) with:

```js
// Bookkeeping for the NFT markers registered by <a-nft> components.
//
// Holds the state the `arnft` system needs and that is easy to get subtly
// wrong:
//
//   1. Load state — a marker may be registered before the tracker exists (the
//      common case) or after it is already running (a dynamically added
//      <a-nft>). Both must end up loaded exactly once.
//   2. Visibility — each marker is stamped when a pose arrives and treated as
//      gone once it goes stale, rather than relying on jsartoolkitNFT's
//      `lostNFTMarker` (single-marker before 1.13.0,
//      webarkit/jsartoolkitNFT#611, and with a fixed 200 ms timeout since).
//   3. Removal — jsartoolkitNFT cannot unload a marker and holds at most 20,
//      so when an <a-nft> goes away its tracker id is parked by url and handed
//      to the next <a-nft> added with the same url, instead of loading the
//      target again.
//
// Kept free of A-Frame / THREE / DOM so it can be unit-tested in isolation.
```

Replace the constructor and `add()` with:

```js
    constructor() {
        this.markers = [];
        this._byId = new Map();
        // url -> tracker ids left loaded by removed markers, oldest first.
        this._parked = new Map();
    }

    // `marker` is { name, url, component }. Returns the stored record. If a
    // removed marker left a loaded dataset for the same url, the record reuses
    // its id and comes back already loaded (`id !== null`).
    add(marker) {
        marker.id = null;
        marker.loading = false;
        marker.failed = false;
        marker.lastSeen = 0;
        marker.visible = false;
        this.markers.push(marker);

        const parked = this._parked.get(marker.url);
        if (parked) {
            this.setId(marker, parked.shift());
            if (parked.length === 0) {
                this._parked.delete(marker.url);
            }
        }
        return marker;
    }

    has(marker) {
        return this.markers.includes(marker);
    }

    // The <a-nft> went away: its poses are no longer routed and it is never
    // reported stale. If it was loaded, its id is parked for reuse by url.
    remove(marker) {
        const index = this.markers.indexOf(marker);
        if (index === -1) {
            return;
        }
        this.markers.splice(index, 1);
        marker.visible = false;
        if (marker.id !== null) {
            this._byId.delete(marker.id);
            this._park(marker.url, marker.id);
        }
    }
```

Replace the `markLoadFailed` comment block (the one citing #612) with:

```js
    // Load failure is TERMINAL for this record — retrying the same url would
    // only fail again. Re-adding the <a-nft> registers a fresh record.
```

Replace `setId()` with, and add `_park()` after it:

```js
    // Called once the tracker has assigned this marker an id. Returns the
    // record, or null when the marker was removed while it was loading — the
    // id is then parked so a re-added <a-nft> with the same url reuses it.
    setId(marker, id) {
        marker.loading = false;
        if (!this.has(marker)) {
            this._park(marker.url, id);
            return null;
        }
        marker.id = id;
        this._byId.set(id, marker);
        return marker;
    }

    _park(url, id) {
        const ids = this._parked.get(url) || [];
        ids.push(id);
        this._parked.set(url, ids);
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/markerRegistry.test.js`
Expected: PASS, 21 tests.

Run: `npm test`
Expected: PASS (all suites).

- [ ] **Step 5: Commit**

```bash
git add src/markerRegistry.js test/markerRegistry.test.js
git commit -m "feat: let MarkerRegistry remove markers and reuse their loaded ids" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `markerLoader` — one incremental load per marker

**Files:**
- Create: `src/markerLoader.js`
- Test: `test/markerLoader.test.js`

**Interfaces:**
- Consumes (Task 2): `registry.unloaded()`, `registry.markLoading(marker)`, `registry.markLoadFailed(marker)`, `registry.setId(marker, id) → record | null`. Controller (Task 1): `ar.loadNFTMarker(url, onSuccess(id), onError(err)) → Promise`, `ar.trackNFTMarkerId(id)`, `ar.getNFTData(id) → { width, height, dpi }`.
- Produces (used by Task 4):
  - `loadPendingMarkers(ar, registry, { onLoaded, onFailed }) → void` — `onLoaded(marker, data)` with `data = { width, height, dpi }`; `onFailed(marker, reason)` called **at most once** per marker.
  - `MAX_MARKERS` — `20`.

- [ ] **Step 1: Write the failing tests**

Create `test/markerLoader.test.js`:

```js
import { describe, it, expect, vi } from 'vitest';
import { MarkerRegistry } from '../src/markerRegistry.js';
import { loadPendingMarkers, MAX_MARKERS } from '../src/markerLoader.js';

const marker = (name) => ({ name, url: `DataNFT/${name}`, component: {} });

// Stand-in for jsartoolkitNFT 1.13.0's ARControllerNFT. loadNFTMarker only
// records the request, so each test decides how (and whether) the tracker
// answers, through the recorded callbacks.
function fakeController() {
    return {
        requests: [],
        tracked: [],
        loadNFTMarker(url, onSuccess, onError) {
            this.requests.push({ url, onSuccess, onError });
            return Promise.resolve([]);
        },
        trackNFTMarkerId(id) {
            this.tracked.push(id);
        },
        getNFTData(id) {
            return { width: 100 + id, height: 200 + id, dpi: 72 };
        },
    };
}

function setup(...names) {
    const ar = fakeController();
    const registry = new MarkerRegistry();
    const markers = names.map((name) => registry.add(marker(name)));
    const handlers = { onLoaded: vi.fn(), onFailed: vi.fn() };
    return { ar, registry, markers, handlers };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('loadPendingMarkers', () => {
    it('issues one loadNFTMarker call per unloaded marker', () => {
        const { ar, registry, handlers } = setup('a', 'b');
        loadPendingMarkers(ar, registry, handlers);
        expect(ar.requests.map((req) => req.url)).toEqual(['DataNFT/a', 'DataNFT/b']);
    });

    it('does not request a marker again while it is loading', () => {
        const { ar, registry, handlers } = setup('a');
        loadPendingMarkers(ar, registry, handlers);
        loadPendingMarkers(ar, registry, handlers);
        expect(ar.requests).toHaveLength(1);
    });

    it('records the id, tracks it and hands the marker data to onLoaded', () => {
        const { ar, registry, markers: [a], handlers } = setup('a');
        loadPendingMarkers(ar, registry, handlers);
        ar.requests[0].onSuccess(0);
        expect(a.id).toBe(0);
        expect(registry.get(0)).toBe(a);
        expect(ar.tracked).toEqual([0]);
        expect(handlers.onLoaded).toHaveBeenCalledWith(a, { width: 100, height: 200, dpi: 72 });
    });

    it('loads a marker added after others are already loaded (#5)', () => {
        const { ar, registry, markers: [a], handlers } = setup('a');
        loadPendingMarkers(ar, registry, handlers);
        ar.requests[0].onSuccess(0);

        const late = registry.add(marker('late'));
        loadPendingMarkers(ar, registry, handlers);
        expect(ar.requests.map((req) => req.url)).toEqual(['DataNFT/a', 'DataNFT/late']);
        ar.requests[1].onSuccess(1);
        expect(late.id).toBe(1);
        expect(a.id).toBe(0);
    });

    it('fails only the marker whose load failed', () => {
        const { ar, registry, markers: [a, b], handlers } = setup('a', 'b');
        loadPendingMarkers(ar, registry, handlers);
        ar.requests[0].onError(404);
        ar.requests[1].onSuccess(0);
        expect(a.failed).toBe(true);
        expect(b.id).toBe(0);
        expect(handlers.onFailed).toHaveBeenCalledWith(a, 404);
        expect(handlers.onLoaded).toHaveBeenCalledTimes(1);
    });

    it('reports a failure once even when every descriptor file fails', () => {
        // Upstream calls onError once per failed file: .fset, .iset and .fset3.
        const { ar, registry, handlers } = setup('a');
        loadPendingMarkers(ar, registry, handlers);
        ar.requests[0].onError(404);
        ar.requests[0].onError(404);
        ar.requests[0].onError(404);
        expect(handlers.onFailed).toHaveBeenCalledTimes(1);
    });

    it('treats a load that returns no id as a failure (tracker full)', () => {
        // Past MAX_MARKERS the tracker answers onSuccess with no id instead of
        // calling onError.
        const { ar, registry, markers: [a], handlers } = setup('a');
        loadPendingMarkers(ar, registry, handlers);
        ar.requests[0].onSuccess(undefined);
        expect(a.failed).toBe(true);
        expect(a.id).toBeNull();
        expect(handlers.onLoaded).not.toHaveBeenCalled();
        expect(handlers.onFailed.mock.calls[0][1]).toContain(String(MAX_MARKERS));
    });

    it('treats a rejected load as a failure', async () => {
        const { ar, registry, markers: [a], handlers } = setup('a');
        ar.loadNFTMarker = () => Promise.reject(new Error('boom'));
        loadPendingMarkers(ar, registry, handlers);
        await flush();
        expect(a.failed).toBe(true);
        expect(handlers.onFailed).toHaveBeenCalledTimes(1);
    });

    it('does not hand data to a marker removed while it was loading', () => {
        const { ar, registry, markers: [a], handlers } = setup('a');
        loadPendingMarkers(ar, registry, handlers);
        registry.remove(a);
        ar.requests[0].onSuccess(0);
        expect(handlers.onLoaded).not.toHaveBeenCalled();
        // The dataset is kept for the next <a-nft> with the same url.
        expect(registry.add(marker('a')).id).toBe(0);
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/markerLoader.test.js`
Expected: FAIL — `Failed to resolve import "../src/markerLoader.js"`.

- [ ] **Step 3: Implement the loader**

Create `src/markerLoader.js`:

```js
// Hands the markers registered by <a-nft> components to the jsartoolkitNFT
// controller.
//
// Since jsartoolkitNFT 1.13.0, loadNFTMarker() can be called at any time and
// as often as needed: ids continue across calls and markers loaded earlier
// stay loaded and detectable (webarkit/jsartoolkitNFT#612, fixed in #666).
// Loading one marker per call means a bad url fails only its own <a-nft>; in
// a single batch it would fail every marker in the scene.
//
// Kept free of A-Frame / THREE / DOM so it can be unit-tested with a fake
// controller.

// jsartoolkitNFT holds at most this many markers in total (PAGES_MAX).
export const MAX_MARKERS = 20;

// Request every registered marker that is not loaded or loading yet.
// `onLoaded(marker, data)` receives the marker's real-world size
// ({ width, height, dpi }); `onFailed(marker, reason)` is called at most once
// per marker.
export function loadPendingMarkers(ar, registry, { onLoaded, onFailed }) {
    for (const marker of registry.unloaded()) {
        loadMarker(ar, registry, marker, onLoaded, onFailed);
    }
}

function loadMarker(ar, registry, marker, onLoaded, onFailed) {
    registry.markLoading(marker);

    // Upstream calls onError once per descriptor file that fails (.fset,
    // .iset, .fset3), so a missing marker can report up to three times.
    const fail = (reason) => {
        if (marker.failed) {
            return;
        }
        registry.markLoadFailed(marker);
        onFailed(marker, reason);
    };

    const onSuccess = (id) => {
        // Past the tracker's limit the load is refused by calling back with
        // no id, not through onError.
        if (!Number.isInteger(id) || id < 0) {
            fail(`the tracker returned no id — it holds at most ${MAX_MARKERS} markers`);
            return;
        }
        ar.trackNFTMarkerId(id);
        // null when the <a-nft> was removed while loading: the registry keeps
        // the id for reuse, and there is no component left to notify.
        if (registry.setId(marker, id)) {
            onLoaded(marker, ar.getNFTData(id));
        }
    };

    // loadNFTMarker is async, so anything it throws arrives as a rejection.
    Promise.resolve(ar.loadNFTMarker(marker.url, onSuccess, fail)).catch(fail);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/markerLoader.test.js`
Expected: PASS, 9 tests.

Run: `npm test`
Expected: PASS (all suites).

- [ ] **Step 5: Commit**

```bash
git add src/markerLoader.js test/markerLoader.test.js
git commit -m "feat: load NFT markers incrementally, one call per marker" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Wire the `arnft` system — runtime add/remove and detection policy

**Files:**
- Modify: `src/registerNFT.js`
- Create: `examples/dynamic.html`

**Interfaces:**
- Consumes (Task 2): `registry.add(marker) → record` (`record.id !== null` ⇒ already loaded), `registry.remove(record)`. (Task 3): `loadPendingMarkers(ar, registry, { onLoaded, onFailed })`. (Task 1): `ar.setContinuousDetection(bool)`, `ar.setDetectionInterval(ms)`, `ar.getNFTData(id)`.
- Produces:
  - `arnft` system: `registerMarker({ name, url, component }) → record` (url resolved against the page), `unregisterMarker(record)`.
  - New `arnft` schema attributes: `continuousDetection` (boolean, `true`), `detectionInterval` (number, `300`).
  - `nft-anchor` component: stores `this.marker` (the record); new `remove()` handler.

- [ ] **Step 1: Import the loader**

In `src/registerNFT.js`, after `import { MarkerRegistry } from './markerRegistry';` add:

```js
import { loadPendingMarkers } from './markerLoader';
```

- [ ] **Step 2: Add the detection-policy attributes to the system schema**

In the `arnft` system `schema`, after the `lostTimeout` entry add:

```js
        // Detection policy (jsartoolkitNFT 1.13.0): while some markers are
        // tracked and others are not, look for the missing ones at most every
        // `detectionInterval` ms (0 = every frame). continuousDetection: false
        // stops looking while anything is tracked — cheapest, but a second
        // target entering the view is not found.
        continuousDetection: { type: 'boolean', default: true },
        detectionInterval: { type: 'number', default: 300 },
```

- [ ] **Step 3: Replace `registerMarker` and add `unregisterMarker`**

Replace the whole `registerMarker` function (its leading comment included) with:

```js
    // Called by nft-anchor components during their own init(). Returns the
    // registry record, which the component hands back to unregisterMarker().
    //
    // Markers can be registered at any time: since jsartoolkitNFT 1.13.0 they
    // load incrementally (webarkit/jsartoolkitNFT#612), so an <a-nft> added
    // after tracking has started is loaded on the spot.
    registerMarker: function (marker) {
        const record = this.registry.add({
            name: marker.name,
            // Resolved here so the registry can recognise a re-added url.
            url: resolveUrl(marker.url),
            component: marker.component,
        });
        if (record.id !== null) {
            // A re-added <a-nft>: its target is still loaded in the tracker.
            record.component.onData(this.controller.getNFTData(record.id));
        } else if (this.controller) {
            this._loadPendingMarkers();
        } else {
            this._maybeStart();
        }
        return record;
    },

    // Called by nft-anchor components when they are removed. jsartoolkitNFT
    // cannot unload a marker, so its target stays loaded and is reused if an
    // <a-nft> with the same url is added again.
    unregisterMarker: function (record) {
        this.registry.remove(record);
    },
```

- [ ] **Step 4: Apply the detection policy and update the `lostNFTMarker` rationale**

In `_onControllerReady`, replace the lines from `this._setupCamera();` up to (not including) `ar.addEventListener('getNFTMarker', ...` with:

```js
        this._setupCamera();

        // jsartoolkitNFT 1.13.0 tracks every loaded marker at once; these set
        // how often it looks for the ones not tracked yet.
        ar.setContinuousDetection(this.data.continuousDetection);
        ar.setDetectionInterval(this.data.detectionInterval);

        // There is deliberately no 'lostNFTMarker' listener: visibility is
        // derived from pose timestamps in tick() instead. That behaves the same
        // on any jsartoolkitNFT version (before 1.13.0 the event was
        // single-marker, webarkit/jsartoolkitNFT#611), and `lostTimeout` stays
        // tunable where upstream's timeout is fixed at 200 ms.
```

- [ ] **Step 5: Replace `_loadPendingMarkers`**

Replace the whole `_loadPendingMarkers` function (its leading comment block about the single batch included) with:

```js
    // Hand every marker that is not loaded yet to the tracker, one call per
    // marker. Safe to call at any time — see markerLoader.js.
    _loadPendingMarkers: function () {
        const ar = this.controller;
        if (!ar) {
            return;
        }
        loadPendingMarkers(ar, this.registry, {
            onLoaded: (marker, data) => marker.component.onData(data),
            onFailed: (marker, reason) =>
                console.error(
                    `arnft: failed to load NFT marker "${marker.name}" (${marker.url}); ` +
                        'it will not be tracked',
                    reason,
                ),
        });
    },
```

- [ ] **Step 6: Keep the record in `nft-anchor` and unregister on removal**

In the `nft-anchor` component's `init`, replace:

```js
        const system = this.el.sceneEl.systems.arnft;
        system.registerMarker({
            name: this.data.entityName,
            url: this.data.markerUrl,
            component: this,
        });
    },
```

with:

```js
        this.marker = this.el.sceneEl.systems.arnft.registerMarker({
            name: this.data.entityName,
            url: this.data.markerUrl,
            component: this,
        });
    },

    // The entity was removed or detached: stop routing poses to it.
    remove: function () {
        this.el.sceneEl.systems.arnft.unregisterMarker(this.marker);
    },
```

- [ ] **Step 7: Add the runtime add/remove example**

Create `examples/dynamic.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Aframe-nft dynamic example</title>
    <meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=0.5, maximum-scale=1"/>
    <link rel="stylesheet" href="css/nft-style.css"/>
    <style>
        body {
            margin: 0;
        }

        .example-container {
            overflow: hidden;
            position: absolute;
            width: 100%;
            height: 100%;
        }

        #toggle {
            position: absolute;
            top: 12px;
            left: 12px;
            z-index: 200;
            padding: 8px 12px;
            font: 16px sans-serif;
        }
    </style>
</head>
<body>
<div id="app">
    <video loop autoplay muted playsinline id="video"></video>
    <canvas id="canvas"></canvas>
</div>
<button id="toggle" type="button">Add kuva</button>
<script type="module" src="../src/index.js"></script>
<div class="example-container">
    <a-scene embedded arnft="videoWidth: 640; videoHeight: 480">

        <!-- pinball is declared up front. kuva is added and removed at runtime
             with the button: it loads while tracking is already running, and
             re-adding it reuses the target that is still loaded. -->
        <a-nft name="pinball" url="DataNFT/pinball">
            <a-box color="#4CC3D9"></a-box>
        </a-nft>

        <a-camera position="0 0 0" look-controls="enabled: false"></a-camera>

    </a-scene>
</div>
<script>
    const button = document.getElementById('toggle');
    let kuva = null;

    button.addEventListener('click', () => {
        if (kuva) {
            kuva.remove();
            kuva = null;
            button.textContent = 'Add kuva';
            return;
        }
        kuva = document.createElement('a-nft');
        kuva.setAttribute('name', 'kuva');
        kuva.setAttribute('url', 'DataNFT/kuva');
        kuva.innerHTML = '<a-sphere color="#E4572E"></a-sphere>';
        document.querySelector('a-scene').appendChild(kuva);
        button.textContent = 'Remove kuva';
    });
</script>
</body>
</html>
```

- [ ] **Step 8: Verify tests and build**

Run: `npm test`
Expected: PASS (all suites).

Run: `npm run build`
Expected: build succeeds. Then `git restore dist/AframeNft.js`.

Run: `grep -n "getNFTData(id, 0)\|was added after tracking started" src/registerNFT.js`
Expected: no output (the stray argument and the old late-registration warning are gone).

- [ ] **Step 9 (human): Manual check with `examples/dynamic.html`**

Run `npm run dev`, open `http://localhost:8080/examples/dynamic.html`, DevTools console open.
1. Point at `pinball` → blue box appears.
2. Click **Add kuva** → console logs `add nft marker ids:  [1]` and **no** `arnft:` warning. Point at `kuva` → orange sphere appears.
3. Both targets in view → both meshes at once.
4. Click **Remove kuva** → sphere gone; pinball unaffected.
5. Click **Add kuva** again → **no** new `add nft marker ids` log (the loaded target is reused), and the sphere tracks again.
6. Temporarily edit the button handler's url to `DataNFT/missing`, click **Add kuva** → the Network tab shows 404 for `missing.fset` / `.iset` / `.fset3`, the console shows exactly **one** `arnft: failed to load NFT marker "kuva"` error, and pinball keeps tracking. Revert the edit. (If the Network tab shows 200 instead, the dev server answered with an HTML fallback page — upstream cannot parse that, so skip this item and report it; the 404 path is covered by the Task 3 unit tests.)

- [ ] **Step 10: Commit**

```bash
git add src/registerNFT.js examples/dynamic.html
git commit -m "feat: track <a-nft> elements added or removed at runtime" -m "Closes #5." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `getImage()` without a per-call copy (#6)

Independent of Tasks 2–4; can run in parallel with them.

**Files:**
- Modify: `src/cameraViewRenderer.js`
- Test: `test/cameraViewRenderer.test.js` (new)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `cameraViewRenderer#getImage() → ImageData` — returns the **same instance** until the frame-rate gate captures a new frame. Callers must not mutate it (`ARControllerNFT.process()` only reads it, synchronously).

- [ ] **Step 1: Write the failing tests**

Create `test/cameraViewRenderer.test.js`:

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cameraViewRenderer } from '../src/cameraViewRenderer.js';

// jsdom has no 2D canvas, so stand one in. Like the real API, getImageData
// hands back a new ImageData-shaped object on every call.
function fakeContext() {
    return {
        fillStyle: '',
        fillRect: vi.fn(),
        drawImage: vi.fn(),
        getImageData: vi.fn((x, y, w, h) => ({
            data: new Uint8ClampedArray(w * h * 4),
            width: w,
            height: h,
        })),
    };
}

describe('cameraViewRenderer.getImage', () => {
    let ctx;
    let getContext;

    beforeEach(() => {
        ctx = fakeContext();
        getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx);
        vi.useFakeTimers();
        vi.setSystemTime(10_000);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    // 640x480 video -> 320x240 processing frame.
    const renderer = () => {
        const r = new cameraViewRenderer({ videoWidth: 640, videoHeight: 480 });
        r.prepareImage();
        return r;
    };

    it('asks for a canvas optimised for per-frame readback', () => {
        renderer();
        expect(getContext).toHaveBeenCalledWith('2d', { alpha: false, willReadFrequently: true });
    });

    it('captures a frame on the first call', () => {
        const r = renderer();
        const image = r.getImage();
        expect(ctx.getImageData).toHaveBeenCalledTimes(1);
        expect(image.width).toBe(320);
        expect(image.height).toBe(240);
        expect(r.getFrame()).toBe(1);
    });

    it('returns the same instance, uncopied, until the frame-rate gate opens', () => {
        const r = renderer();
        const first = r.getImage();
        vi.advanceTimersByTime(5); // under 1000 / 60 ms
        expect(r.getImage()).toBe(first);
        expect(ctx.getImageData).toHaveBeenCalledTimes(1);
        expect(r.getFrame()).toBe(1);
    });

    it('captures a new frame once the gate opens', () => {
        const r = renderer();
        const first = r.getImage();
        vi.advanceTimersByTime(20); // over 1000 / 60 ms
        const second = r.getImage();
        expect(second).not.toBe(first);
        expect(ctx.getImageData).toHaveBeenCalledTimes(2);
        expect(r.getFrame()).toBe(2);
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/cameraViewRenderer.test.js`
Expected: FAIL — at least `asks for a canvas optimised for per-frame readback` (no `willReadFrequently`) and `returns the same instance…` (a new `ImageData` per call). Some tests may instead fail with `ReferenceError: ImageData is not defined`, because jsdom only provides `ImageData` with the optional `canvas` package — also a valid red: the fixed code no longer constructs `ImageData`.

- [ ] **Step 3: Return the captured frame instead of copying it**

In `src/cameraViewRenderer.js`, change the context creation in the constructor to:

```js
        // willReadFrequently: getImageData() runs every captured frame, which
        // is much faster on a CPU-backed canvas.
        this.context_process = this.canvas_process.getContext("2d", { alpha: false, willReadFrequently: true });
```

and add, next to `this.lastCache = 0;`:

```js
        this.imageData = null;
```

Replace `getImage()` with:

```js
    // Returns the latest processing frame. The same ImageData is returned until
    // the frame-rate gate captures a new one, instead of a fresh copy per call:
    // ARControllerNFT.process() copies the pixels into the WASM heap
    // synchronously (passVideoData -> HEAPU8.set) and keeps no reference.
    // Callers must not mutate it.
    getImage() {
        const now = Date.now();
        if (now - this.lastCache > 1000 / this.targetFrameRate) {
            this.context_process.drawImage(this._video, 0, 0, this.vw, this.vh, this.ox, this.oy, this.w, this.h);
            this.imageData = this.context_process.getImageData(0, 0, this.pw, this.ph);
            this.lastCache = now;
            this._frame++;
        }
        return this.imageData;
    }
```

Run: `grep -n "imageDataCache" src/`
Expected: no output.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/cameraViewRenderer.test.js`
Expected: PASS, 4 tests.

Run: `npm test`
Expected: PASS (all suites).

- [ ] **Step 5 (human): Smoke test**

`npm run dev` → `examples/basic.html`: tracking works as before, and Chrome no longer logs the "Multiple readback operations using getImageData are faster with the willReadFrequently attribute" warning.

- [ ] **Step 6: Commit**

```bash
git add src/cameraViewRenderer.js test/cameraViewRenderer.test.js
git commit -m "perf: return the captured frame from getImage() instead of a copy" -m "Closes #6." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Docs, example comment, `dist` rebuild, acceptance

**Files:**
- Modify: `examples/basic.html:30-33`
- Modify: `README.md`
- Modify: `DESIGN.md:169-191`
- Modify: `dist/AframeNft.js` (rebuilt)

**Interfaces:**
- Consumes: attribute names from Task 4 (`continuousDetection`, `detectionInterval`) and the existing `lostTimeout`; `examples/dynamic.html` from Task 4.
- Produces: nothing consumed by code.

- [ ] **Step 1: Update the multi-target comment in `examples/basic.html`**

Replace the comment above the two `<a-nft>` elements (lines 30–33, "One <a-nft> per target. Both are loaded, but jsartoolkitNFT tracks only one at a time…") with:

```html
        <!-- One <a-nft> per target. All of them are tracked at once: point the
             camera at both and both meshes appear. See dynamic.html for adding
             and removing <a-nft> elements while the scene runs. -->
```

- [ ] **Step 2: Update `README.md`**

a) In **Features**, after the "Declarative `<a-nft>` primitive" bullet add:

```markdown
- Multiple targets — one `<a-nft>` per image target, all tracked at the same time. `<a-nft>`
  elements can be added or removed while the scene runs.
```

b) In **Requirements**, change "The repo ships a `pinball` target and camera file" to "The repo ships `pinball` and `kuva` targets and a camera file".

c) After the paragraph that starts "`url` points at the descriptor set **without** file extension", add:

````markdown
### Multiple targets

Declare one `<a-nft>` per image target. Every target is tracked independently and at the
same time, each with its own pose:

```html
<a-nft name="pinball" url="DataNFT/pinball"><a-box color="#4CC3D9"></a-box></a-nft>
<a-nft name="kuva" url="DataNFT/kuva"><a-sphere color="#E4572E"></a-sphere></a-nft>
```

`<a-nft>` elements can also be added or removed at runtime with ordinary DOM calls — see
[`examples/dynamic.html`](examples/dynamic.html).
````

d) Replace the `arnft` system attribute table with:

```markdown
| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `videoWidth` | number | `640` | Requested capture width |
| `videoHeight` | number | `480` | Requested capture height |
| `cameraParam` | string | `Data/camera_para.dat` | ARToolKit camera parameter file |
| `lostTimeout` | number | `200` | How long (ms) a target may go unseen before its mesh is hidden |
| `continuousDetection` | boolean | `true` | Keep looking for untracked targets while others are tracked. `false` is cheapest, but a second target entering the view is not found |
| `detectionInterval` | number | `300` | Minimum time (ms) between searches for untracked targets while others are tracked; `0` searches every frame |
```

e) In **Roadmap / known limitations**, replace the first two bullets ("One target tracked at a time" and "Targets must be declared up front") with:

```markdown
- **At most 20 targets per page.** jsartoolkitNFT holds at most 20 markers and cannot unload
  one, so a removed `<a-nft>` keeps its target loaded; adding an `<a-nft>` with the same `url`
  again reuses it rather than loading it twice.
```

- [ ] **Step 3: Update `DESIGN.md` section 10**

Replace lines 169–191 (from `- ✅ **Multi-marker — ` to the end of the file) with:

```markdown
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
```

- [ ] **Step 4: Rebuild `dist` and run everything**

Run: `npm test`
Expected: PASS — `markerRegistry` (21), `markerLoader` (9), `cameraViewRenderer` (4), `nftMath`, `oneEuroFilter`.

Run: `npm run build`
Expected: build succeeds; `dist/AframeNft.js` changes (keep it this time).

- [ ] **Step 5 (human): Final acceptance on camera**

`npm run dev`:
- **#8** — `examples/basic.html`: both targets in view → both meshes together. Move one target out of view → only its mesh hides, within ~200 ms; the other is unaffected; no mesh stays frozen on screen. `pinball` alone behaves exactly as before.
- **#5** — `examples/dynamic.html`: repeat Task 4 Step 9, items 1–5.
- **#6** — tracking unchanged; no `willReadFrequently` warning in the console.

- [ ] **Step 6: Commit**

```bash
git add examples/basic.html README.md DESIGN.md dist/AframeNft.js
git commit -m "docs: document simultaneous and runtime-added targets; rebuild dist" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Finish the branch**

Use superpowers:finishing-a-development-branch. The PR targets **`dev`**; its body should say it closes #5 and #6, completes #8's acceptance (simultaneous tracking), and that #7 gets its own plan. Note that GitHub auto-closes issues only when `dev` reaches `main`.

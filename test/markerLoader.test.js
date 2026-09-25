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

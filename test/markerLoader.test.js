import { describe, it, expect, vi } from 'vitest';
import { MarkerRegistry } from '../src/markerRegistry.js';
import { loadPendingMarkers } from '../src/markerLoader.js';

const marker = (name) => ({ name, url: `DataNFT/${name}`, component: {} });

// Stand-in for jsartoolkitNFT's tracker. addNFTTargets only records the request,
// so each test decides how (and whether) the tracker answers.
function fakeTracker() {
    return {
        requests: [],
        addNFTTargets(sources, opts) {
            return new Promise((resolve, reject) => this.requests.push({ sources, opts, resolve, reject }));
        },
    };
}

const loaded = (id, url = 'DataNFT/a') => [
    {
        status: 'loaded',
        info: { id, url, widthPx: 100, heightPx: 200, dpi: 72, widthMm: 35.3, heightMm: 70.5, origin: 'corner' },
    },
];
const size = { width: 100, height: 200, dpi: 72 };

function setup(...names) {
    const tracker = fakeTracker();
    const registry = new MarkerRegistry();
    const markers = names.map((name) => registry.add(marker(name)));
    const handlers = { onLoaded: vi.fn(), onFailed: vi.fn() };
    return { tracker, registry, markers, handlers };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('loadPendingMarkers', () => {
    it('issues one addNFTTargets call per unloaded marker, with corner origin', () => {
        const { tracker, registry, handlers } = setup('a', 'b');
        loadPendingMarkers(tracker, registry, handlers);
        expect(tracker.requests.map((req) => req.sources)).toEqual([['DataNFT/a'], ['DataNFT/b']]);
        expect(tracker.requests[0].opts).toEqual({ origin: 'corner' });
    });

    it('does not request a marker again while it is loading', () => {
        const { tracker, registry, handlers } = setup('a');
        loadPendingMarkers(tracker, registry, handlers);
        loadPendingMarkers(tracker, registry, handlers);
        expect(tracker.requests).toHaveLength(1);
    });

    it('records the id and maps the target info to the size onData expects', async () => {
        const { tracker, registry, markers: [a], handlers } = setup('a');
        loadPendingMarkers(tracker, registry, handlers);
        tracker.requests[0].resolve(loaded(0));
        await flush();
        expect(a.id).toBe(0);
        expect(registry.get(0)).toBe(a);
        expect(handlers.onLoaded).toHaveBeenCalledWith(a, size);
    });

    it('loads a marker added after others are already loaded (#5)', async () => {
        const { tracker, registry, markers: [a], handlers } = setup('a');
        loadPendingMarkers(tracker, registry, handlers);
        tracker.requests[0].resolve(loaded(0));
        await flush();

        const late = registry.add(marker('late'));
        loadPendingMarkers(tracker, registry, handlers);
        expect(tracker.requests.map((req) => req.sources)).toEqual([['DataNFT/a'], ['DataNFT/late']]);
        tracker.requests[1].resolve(loaded(1, 'DataNFT/late'));
        await flush();
        expect(late.id).toBe(1);
        expect(a.id).toBe(0);
    });

    it('fails only the marker whose load failed', async () => {
        const { tracker, registry, markers: [a, b], handlers } = setup('a', 'b');
        loadPendingMarkers(tracker, registry, handlers);
        tracker.requests[0].resolve([{ status: 'error', url: 'DataNFT/a', reason: 'network', message: '404' }]);
        tracker.requests[1].resolve(loaded(0, 'DataNFT/b'));
        await flush();
        expect(a.failed).toBe(true);
        expect(b.id).toBe(0);
        expect(handlers.onLoaded).toHaveBeenCalledTimes(1);
        expect(handlers.onFailed).toHaveBeenCalledTimes(1);
    });

    it('reports the reason a load failed (#14)', async () => {
        const { tracker, registry, markers: [a], handlers } = setup('a');
        loadPendingMarkers(tracker, registry, handlers);
        tracker.requests[0].resolve([{ status: 'error', url: 'DataNFT/a', reason: 'capacity', message: 'full' }]);
        await flush();
        expect(a.failed).toBe(true);
        expect(a.id).toBeNull();
        expect(handlers.onLoaded).not.toHaveBeenCalled();
        expect(handlers.onFailed).toHaveBeenCalledWith(a, 'capacity: full');
    });

    it('treats a rejected load as a failure, passing the error on', async () => {
        const { tracker, registry, markers: [a], handlers } = setup('a');
        const error = new Error('boom');
        loadPendingMarkers(tracker, registry, handlers);
        tracker.requests[0].reject(error);
        await flush();
        expect(a.failed).toBe(true);
        expect(handlers.onFailed).toHaveBeenCalledWith(a, error);
    });

    it('does not hand data to a marker removed while it was loading', async () => {
        const { tracker, registry, markers: [a], handlers } = setup('a');
        loadPendingMarkers(tracker, registry, handlers);
        registry.remove(a);
        tracker.requests[0].resolve(loaded(0));
        await flush();
        expect(handlers.onLoaded).not.toHaveBeenCalled();
        // The dataset is kept for the next <a-nft> with the same url.
        const again = registry.add(marker('a'));
        expect(again.id).toBe(0);
        expect(again.data).toEqual(size);
    });
});

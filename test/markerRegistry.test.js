import { describe, it, expect } from 'vitest';
import { MarkerRegistry } from '../src/markerRegistry.js';

const marker = (name) => ({ name, url: `${name}.fset`, component: {} });

describe('MarkerRegistry load state', () => {
    it('reports newly added markers as unloaded', () => {
        const r = new MarkerRegistry();
        r.add(marker('a'));
        expect(r.unloaded().map((m) => m.name)).toEqual(['a']);
    });

    it('does not report a marker that is mid-load', () => {
        const r = new MarkerRegistry();
        const a = r.add(marker('a'));
        r.markLoading(a);
        expect(r.unloaded()).toEqual([]);
    });

    it('does not report a marker once it has an id', () => {
        const r = new MarkerRegistry();
        const a = r.add(marker('a'));
        r.markLoading(a);
        r.setId(a, 0);
        expect(r.unloaded()).toEqual([]);
    });

    it('treats a load failure as terminal and does not offer it for retry', () => {
        // Retrying the same url would only fail again; re-adding the <a-nft>
        // registers a fresh record, which is loaded anew.
        const r = new MarkerRegistry();
        const a = r.add(marker('a'));
        r.markLoading(a);
        r.markLoadFailed(a);
        expect(a.failed).toBe(true);
        expect(r.unloaded()).toEqual([]);
    });

    it('reports only the new marker when one is added after others loaded', () => {
        // The #5 case: a marker registered after the tracker is already running.
        const r = new MarkerRegistry();
        const a = r.add(marker('a'));
        r.setId(a, 0);
        r.add(marker('b'));
        expect(r.unloaded().map((m) => m.name)).toEqual(['b']);
    });

    it('looks markers up by tracker id', () => {
        const r = new MarkerRegistry();
        const a = r.add(marker('a'));
        r.setId(a, 7);
        expect(r.get(7)).toBe(a);
        expect(r.get(99)).toBeNull();
    });
});

describe('MarkerRegistry visibility', () => {
    const seeded = () => {
        const r = new MarkerRegistry();
        const a = r.setId(r.add(marker('a')), 0);
        const b = r.setId(r.add(marker('b')), 1);
        return { r, a, b };
    };

    it('markSeen stamps the marker and makes it visible', () => {
        const { r, a } = seeded();
        expect(r.markSeen(0, 1000)).toBe(a);
        expect(a.visible).toBe(true);
        expect(a.lastSeen).toBe(1000);
    });

    it('markSeen returns null for an unknown id', () => {
        const { r } = seeded();
        expect(r.markSeen(42, 1000)).toBeNull();
    });

    it('does not report a marker that is still fresh', () => {
        const { r } = seeded();
        r.markSeen(0, 1000);
        expect(r.collectStale(1100, 200)).toEqual([]);
    });

    it('reports a marker once it goes stale', () => {
        const { r, a } = seeded();
        r.markSeen(0, 1000);
        expect(r.collectStale(1300, 200)).toEqual([a]);
        expect(a.visible).toBe(false);
    });

    it('reports each stale marker exactly once', () => {
        const { r } = seeded();
        r.markSeen(0, 1000);
        expect(r.collectStale(1300, 200)).toHaveLength(1);
        expect(r.collectStale(1400, 200)).toEqual([]);
    });

    it('never reports a marker that has not been seen yet', () => {
        // Guards against hiding meshes (and spurious onLost) before first detection.
        const { r } = seeded();
        expect(r.collectStale(99999, 200)).toEqual([]);
    });

    it('expires markers independently — the #8 ghost-mesh case', () => {
        // Both visible; only `a` leaves the frame. `b` must be untouched.
        const { r, a, b } = seeded();
        r.markSeen(0, 1000);
        r.markSeen(1, 1000);
        r.markSeen(1, 1250); // b keeps being seen

        expect(r.collectStale(1300, 200)).toEqual([a]);
        expect(a.visible).toBe(false);
        expect(b.visible).toBe(true);
    });

    it('becomes visible again when a stale marker is re-acquired', () => {
        const { r, a } = seeded();
        r.markSeen(0, 1000);
        r.collectStale(1300, 200);
        r.markSeen(0, 1400);
        expect(a.visible).toBe(true);
        expect(r.collectStale(1450, 200)).toEqual([]);
    });
});

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

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

    it('returns a marker to the unloaded pool when its load fails', () => {
        const r = new MarkerRegistry();
        const a = r.add(marker('a'));
        r.markLoading(a);
        r.markLoadFailed(a);
        expect(r.unloaded()).toEqual([a]);
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

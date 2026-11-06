import { describe, it, expect } from 'vitest';
import { MarkerRegistry } from '../src/markerRegistry.js';

const marker = (name) => ({ name, url: `${name}.fset`, component: {} });
const size = { width: 1, height: 2, dpi: 3 };

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
        r.setLoaded(a, 0, size);
        expect(r.unloaded()).toEqual([]);
    });

    it('keeps the size of a loaded target on its record', () => {
        const r = new MarkerRegistry();
        const a = r.setLoaded(r.add(marker('a')), 0, size);
        expect(a.data).toEqual(size);
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
        r.setLoaded(a, 0, size);
        r.add(marker('b'));
        expect(r.unloaded().map((m) => m.name)).toEqual(['b']);
    });

    it('looks markers up by tracker id', () => {
        const r = new MarkerRegistry();
        const a = r.add(marker('a'));
        r.setLoaded(a, 7, size);
        expect(r.get(7)).toBe(a);
        expect(r.get(99)).toBeNull();
    });
});

describe('MarkerRegistry removal', () => {
    it('stops routing poses to a removed marker', () => {
        const r = new MarkerRegistry();
        const a = r.setLoaded(r.add(marker('a')), 0, size);
        r.remove(a);
        expect(r.has(a)).toBe(false);
        expect(r.get(0)).toBeNull();
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
        r.remove(r.setLoaded(r.add(marker('a')), 0, size));
        const again = r.add(marker('a'));
        expect(again.id).toBe(0);
        expect(r.get(0)).toBe(again);
        expect(r.unloaded()).toEqual([]);
    });

    it('gives a re-added marker the size of the parked target', () => {
        // The tracker has no getNFTData(), so the size must survive the removal.
        const r = new MarkerRegistry();
        r.remove(r.setLoaded(r.add(marker('a')), 0, size));
        expect(r.add(marker('a')).data).toEqual(size);
    });

    it('does not reuse an id for a different url', () => {
        const r = new MarkerRegistry();
        r.remove(r.setLoaded(r.add(marker('a')), 0, size));
        const b = r.add(marker('b'));
        expect(b.id).toBeNull();
        expect(b.data).toBeNull();
        expect(r.unloaded()).toEqual([b]);
    });

    it('hands each parked id out only once', () => {
        // Two <a-nft> with the same url, both loaded, then both removed.
        const r = new MarkerRegistry();
        const first = r.setLoaded(r.add(marker('a')), 0, size);
        const second = r.setLoaded(r.add(marker('a')), 1, size);
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
        expect(r.setLoaded(a, 3, size)).toBeNull();
        expect(r.get(3)).toBeNull();
        const again = r.add(marker('a'));
        expect(again.id).toBe(3);
        expect(again.data).toEqual(size);
    });
});

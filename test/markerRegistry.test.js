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
        r.finishLoad(a.url, 0, size);
        expect(r.unloaded()).toEqual([]);
    });

    it('keeps the size of a loaded target on its record', () => {
        const r = new MarkerRegistry();
        const a = r.add(marker('a'));
        r.markLoading(a);
        r.finishLoad(a.url, 0, size);
        expect(a.data).toEqual(size);
    });

    it('treats a load failure as terminal and does not offer it for retry', () => {
        // Retrying the same url would only fail again; re-adding the <a-nft>
        // registers a fresh record, which is loaded anew.
        const r = new MarkerRegistry();
        const a = r.add(marker('a'));
        r.markLoading(a);
        r.failLoad(a.url);
        expect(a.failed).toBe(true);
        expect(r.unloaded()).toEqual([]);
    });

    it('reports only the new marker when one is added after others loaded', () => {
        // The #5 case: a marker registered after the tracker is already running.
        const r = new MarkerRegistry();
        const a = r.add(marker('a'));
        r.markLoading(a);
        r.finishLoad(a.url, 0, size);
        r.add(marker('b'));
        expect(r.unloaded().map((m) => m.name)).toEqual(['b']);
    });

    it('looks markers up by tracker id', () => {
        const r = new MarkerRegistry();
        const a = r.add(marker('a'));
        r.markLoading(a);
        r.finishLoad(a.url, 7, size);
        expect(r.recordsFor(7)).toEqual([a]);
        expect(r.recordsFor(99)).toEqual([]);
    });
});

describe('MarkerRegistry for a new tracker', () => {
    it('hasLoaded is false until a registered record has an id', () => {
        const r = new MarkerRegistry();
        const a = r.add(marker('a'));
        expect(r.hasLoaded()).toBe(false);
        r.markLoading(a);
        r.finishLoad(a.url, 0, size);
        expect(r.hasLoaded()).toBe(true);
        r.remove(a);
        expect(r.hasLoaded()).toBe(false);
    });

    it('resetLoadState offers every record for loading again, parked ids forgotten', () => {
        // Ids belong to one tracker: on the next one they would mean other targets.
        const r = new MarkerRegistry();
        const a = r.add(marker('a'));
        r.markLoading(a);
        r.finishLoad(a.url, 0, size);
        const b = r.add(marker('b'));
        r.markLoading(b);
        r.finishLoad(b.url, 1, size);
        r.remove(b);
        const before = r.generation;
        r.resetLoadState();
        expect(r.generation).toBe(before + 1);
        expect(a.id).toBeNull();
        expect(a.data).toBeNull();
        expect(r.recordsFor(0)).toEqual([]);
        expect(r.unloaded()).toEqual([a]);
        expect(r.add(marker('b')).id).toBeNull();
    });

    it('resetLoadState also offers a record that was loading or had failed', () => {
        const r = new MarkerRegistry();
        const loading = r.add(marker('a'));
        r.markLoading(loading);
        const failed = r.add(marker('b'));
        r.markLoading(failed);
        r.failLoad(failed.url);
        r.resetLoadState();
        expect(r.unloaded()).toEqual([loading, failed]);
    });
});

describe('MarkerRegistry removal and shared targets (#11)', () => {
    it('stops routing poses to a removed marker', () => {
        const r = new MarkerRegistry();
        const a = r.add(marker('a'));
        r.markLoading(a);
        r.finishLoad(a.url, 0, size);
        r.remove(a);
        expect(r.has(a)).toBe(false);
        expect(r.recordsFor(0)).toEqual([]);
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
        const a = r.add(marker('a'));
        r.markLoading(a);
        r.finishLoad(a.url, 0, size);
        r.remove(a);
        const again = r.add(marker('a'));
        expect(again.id).toBe(0);
        expect(r.recordsFor(0)).toEqual([again]);
        expect(r.unloaded()).toEqual([]);
    });

    it('gives a re-added marker the size of the loaded target', () => {
        // The tracker has no getNFTData(), so the size must survive the removal.
        const r = new MarkerRegistry();
        const a = r.add(marker('a'));
        r.markLoading(a);
        r.finishLoad(a.url, 0, size);
        r.remove(a);
        expect(r.add(marker('a')).data).toEqual(size);
    });

    it('does not reuse an id for a different url', () => {
        const r = new MarkerRegistry();
        const a = r.add(marker('a'));
        r.markLoading(a);
        r.finishLoad(a.url, 0, size);
        r.remove(a);
        const b = r.add(marker('b'));
        expect(b.id).toBeNull();
        expect(b.data).toBeNull();
        expect(r.unloaded()).toEqual([b]);
    });

    it('gives two live records with the same url the same id, with no second load', () => {
        const r = new MarkerRegistry();
        const a = r.add(marker('a'));
        const a2 = r.add(marker('a'));
        expect(r.markLoading(a)).toBe(true);
        expect(r.markLoading(a2)).toBe(false);
        expect(r.finishLoad(a.url, 0, size)).toEqual([a, a2]);
        expect(r.recordsFor(0)).toEqual([a, a2]);
        expect(a2.id).toBe(0);
        expect(a2.data).toEqual(size);
    });

    it('gives a record added after a target loaded the same id at once', () => {
        const r = new MarkerRegistry();
        const a = r.add(marker('a'));
        r.markLoading(a);
        r.finishLoad(a.url, 0, size);
        const a2 = r.add(marker('a'));
        expect(a2.id).toBe(0);
        expect(a2.data).toEqual(size);
        expect(r.recordsFor(0)).toEqual([a, a2]);
        expect(r.unloaded()).toEqual([]);
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
        expect(r.recordsFor(3)).toEqual([]);
        const again = r.add(marker('a'));
        expect(again.id).toBe(3);
        expect(again.data).toEqual(size);
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

    it('keeps routing to the records that remain when one of several is removed', () => {
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
});

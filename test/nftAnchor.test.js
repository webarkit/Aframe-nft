import { describe, it, expect, vi, beforeAll } from 'vitest';

vi.mock('aframe', () => ({}));
vi.mock('@webarkit/jsartoolkit-nft', () => ({ ARControllerNFT: {} }));

// Records every PoseFilter construction. Each one means an extra
// "OneEuroFilter: <version>" console line from the package, and a reset of
// the smoothing state.
const createdFilters = vi.hoisted(() => []);
vi.mock('../src/poseFilter.js', () => ({
    PoseFilter: class {
        constructor(options) {
            createdFilters.push(options);
        }
        filter(t, values) {
            return values;
        }
        reset() {}
    },
}));

// registerNFT.js registers everything on the AFRAME global. Capture the
// definitions instead of running A-Frame, so the component's methods can be
// called on a hand-built instance.
const definitions = {};

beforeAll(async () => {
    globalThis.AFRAME = {
        registerSystem: (name, definition) => {
            definitions[name] = definition;
        },
        registerComponent: (name, definition) => {
            definitions[name] = definition;
        },
        registerPrimitive: () => {},
        primitives: { getMeshMixin: () => ({}) },
        utils: { extendDeep: (target, ...sources) => Object.assign(target, ...sources) },
        THREE: { Matrix4: class {} },
    };
    await import('../src/registerNFT.js');
});

// An nft-anchor that has been tracking: registered, visible, mid-pose.
function trackingAnchor() {
    const system = { unregisterMarker: vi.fn() };
    const anchor = Object.assign(Object.create(definitions['nft-anchor']), {
        el: { sceneEl: { systems: { arnft: system } } },
        mesh: { visible: true },
        marker: { name: 'kuva' },
        latestMatrix: {},
        filter: { reset: vi.fn() },
    });
    return { system, anchor };
}

describe('nft-anchor remove()', () => {
    it('unregisters its marker once', () => {
        const { system, anchor } = trackingAnchor();
        const record = anchor.marker;
        anchor.remove();
        expect(system.unregisterMarker).toHaveBeenCalledWith(record);
        expect(anchor.marker).toBeNull();
    });

    it('hides the mesh instead of leaving it frozen at its last pose (#8)', () => {
        // After removal no pose and no onLost will ever arrive, so a mesh left
        // visible would stay on screen as a ghost.
        const { anchor } = trackingAnchor();
        anchor.remove();
        expect(anchor.mesh.visible).toBe(false);
        expect(anchor.latestMatrix).toBeNull();
        expect(anchor.filter.reset).toHaveBeenCalled();
    });
});

describe('nft-anchor smoothing filter', () => {
    const smoothing = { smooth: true, smoothMinCutoff: 0.0001, smoothBeta: 0.01 };

    // A fresh anchor, as A-Frame creates it: init(), then update({}).
    function startedAnchor(data = {}) {
        const anchor = Object.assign(Object.create(definitions['nft-anchor']), {
            el: {
                object3D: {},
                sceneEl: { systems: { arnft: { registerMarker: () => ({}) } } },
            },
            data: { entityName: 'kuva', markerUrl: 'DataNFT/kuva', scaleFactor: 150, ...smoothing, ...data },
        });
        anchor.init();
        anchor.update({});
        return anchor;
    }

    it('builds one filter per <a-nft> across init() and the first update()', () => {
        createdFilters.length = 0;
        startedAnchor();
        expect(createdFilters).toEqual([{ minCutoff: 0.0001, beta: 0.01 }]);
    });

    it('keeps the filter, and its state, when an unrelated property changes', () => {
        const anchor = startedAnchor();
        const filter = anchor.filter;
        const oldData = { ...anchor.data };
        anchor.data.scaleFactor = 100;
        anchor.update(oldData);
        expect(anchor.filter).toBe(filter);
    });

    it('rebuilds the filter when a smoothing property changes', () => {
        const anchor = startedAnchor();
        const filter = anchor.filter;
        const oldData = { ...anchor.data };
        anchor.data.smoothBeta = 0.5;
        anchor.update(oldData);
        expect(Object.is(anchor.filter, filter)).toBe(false);
        expect(createdFilters.at(-1)).toEqual({ minCutoff: 0.0001, beta: 0.5 });
    });

    it('drops the filter when smoothing is turned off', () => {
        const anchor = startedAnchor();
        const oldData = { ...anchor.data };
        anchor.data.smooth = false;
        anchor.update(oldData);
        expect(anchor.filter).toBeNull();
    });
});

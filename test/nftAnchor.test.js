import { describe, it, expect, vi, beforeAll } from 'vitest';
import { routeFrameResult } from '../src/frames.js';
import { MarkerRegistry } from '../src/markerRegistry.js';

vi.mock('aframe', () => ({}));
vi.mock('@webarkit/jsartoolkit-nft', () => ({ createNFTTracker: vi.fn() }));

// Records every PoseFilter construction. Each one means a reset of the
// smoothing state.
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
        THREE: {
            Matrix4: class {
                multiply() {
                    return this;
                }
                compose() {
                    return this;
                }
                copy(matrix) {
                    this.elements = matrix.elements;
                    return this;
                }
            },
            Vector3: class {},
            Quaternion: class {},
            Box3: class {},
        },
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
        filter: { reset: vi.fn() },
    });
    return { system, anchor };
}

const smoothing = { smooth: true, smoothMinCutoff: 0.0001, smoothBeta: 0.01 };

// A fresh anchor, as A-Frame creates it: init(), then update({}). Its object3D
// starts the way A-Frame's does: visible, with its matrix built from its own
// position, rotation and scale.
function startedAnchor(data = {}, arnft = { registerMarker: () => ({}) }) {
    const anchor = Object.assign(Object.create(definitions['nft-anchor']), {
        el: {
            object3D: {
                visible: true,
                matrixAutoUpdate: true,
                matrix: new AFRAME.THREE.Matrix4(),
                traverse() {},
            },
            sceneEl: { systems: { arnft } },
        },
        data: { entityName: 'kuva', markerUrl: 'DataNFT/kuva', scaleFactor: 150, ...smoothing, ...data },
    });
    anchor.init();
    anchor.update({});
    return anchor;
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
        expect(anchor.filter.reset).toHaveBeenCalled();
    });
});

describe('nft-anchor visibility', () => {
    const pose = Float64Array.from({ length: 16 }, (_, i) => i + 1);
    const size = { width: 893, height: 1117, dpi: 120 };

    it('hides the mesh until the first pose (#17)', () => {
        const anchor = startedAnchor();
        expect(anchor.mesh.visible).toBe(false);
        // Loaded, but not seen yet.
        anchor.onData(size);
        expect(anchor.mesh.visible).toBe(false);
        anchor.onPose(pose, 1);
        expect(anchor.mesh.visible).toBe(true);
    });

    it('stays hidden when the first pose is invalid', () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const anchor = startedAnchor();
        anchor.onPose(null, 1);
        expect(anchor.mesh.visible).toBe(false);
        error.mockRestore();
    });

    it('has the pose in place when it shows the mesh', () => {
        // A-Frame ticks components, then systems, then renders. onPose runs in the
        // system's tick, so a matrix written any later would draw the content at
        // its authored position for the frame that first shows it.
        const anchor = startedAnchor();
        anchor.onPose(pose, 1);
        expect(anchor.mesh.matrixAutoUpdate).toBe(false);
        expect(anchor.mesh.matrix.elements).toEqual(Array.from(pose));
    });

    it('shows a re-added <a-nft> that adopts a target already tracked', () => {
        const arnft = Object.assign(Object.create(definitions.arnft), { registry: new MarkerRegistry() });
        const first = startedAnchor({}, arnft);
        arnft.registry.setLoaded(first.marker, 0, size);
        first.onData(size);
        first.remove();

        const second = startedAnchor({}, arnft);
        expect(second.marker.id).toBe(0);
        expect(second.mesh.visible).toBe(false);

        // The target never left the view, so the tracker fires no new `found`.
        routeFrameResult(arnft.registry, { time: 2, targets: [{ id: 0, found: true, pose }], transitions: [] });
        expect(second.mesh.visible).toBe(true);
    });
});

describe('nft-anchor smoothing filter', () => {
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

    it('filters with the frame time it is given, not the clock', () => {
        // In a Worker a result arrives after its frame, so the clock would be wrong.
        const anchor = startedAnchor();
        const filter = vi.spyOn(anchor.filter, 'filter');
        anchor.onPose(new Float64Array(16), 1234);
        expect(filter.mock.calls[0][0]).toBe(1234);
    });

    it('drops the filter when smoothing is turned off', () => {
        const anchor = startedAnchor();
        const oldData = { ...anchor.data };
        anchor.data.smooth = false;
        anchor.update(oldData);
        expect(anchor.filter).toBeNull();
    });
});

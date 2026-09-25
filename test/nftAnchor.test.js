import { describe, it, expect, vi, beforeAll } from 'vitest';

vi.mock('aframe', () => ({}));
vi.mock('@webarkit/jsartoolkit-nft', () => ({ ARControllerNFT: {} }));

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

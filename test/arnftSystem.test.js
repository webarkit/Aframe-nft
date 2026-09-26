import { describe, it, expect, vi, beforeAll } from 'vitest';

vi.mock('aframe', () => ({}));
vi.mock('@webarkit/jsartoolkit-nft', () => ({ ARControllerNFT: {} }));

// registerNFT.js registers everything on the AFRAME global. Capture the
// definitions instead of running A-Frame.
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

// Run _onControllerReady against a fake tracker and record, in order, every
// call that makes jsartoolkitNFT log something.
function startTracking(data = {}) {
    const calls = [];
    const ar = {
        setLogLevel: (level) => calls.push(['setLogLevel', level]),
        setContinuousDetection: (on) => calls.push(['setContinuousDetection', on]),
        setDetectionInterval: (ms) => calls.push(['setDetectionInterval', ms]),
        addEventListener: () => {},
    };
    const system = Object.assign(Object.create(definitions.arnft), {
        data: { logLevel: 'warn', continuousDetection: true, detectionInterval: 300, ...data },
        _setupCamera: () => {},
        _loadPendingMarkers: () => calls.push(['loadMarkers']),
    });
    system._onControllerReady(ar);
    return calls;
}

describe('arnft log level', () => {
    it('defaults to warn', () => {
        expect(definitions.arnft.schema.logLevel.default).toBe('warn');
    });

    it('is applied before the detection settings and the marker loads log anything', () => {
        const calls = startTracking();
        expect(calls[0]).toEqual(['setLogLevel', 2]);
        expect(calls.map(([name]) => name)).toEqual([
            'setLogLevel',
            'setContinuousDetection',
            'setDetectionInterval',
            'loadMarkers',
        ]);
    });

    it('passes the chosen level to the tracker', () => {
        expect(startTracking({ logLevel: 'debug' })[0]).toEqual(['setLogLevel', 0]);
    });
});

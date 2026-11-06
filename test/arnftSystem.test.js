import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { createNFTTracker } from '@webarkit/jsartoolkit-nft';
import { MarkerRegistry } from '../src/markerRegistry.js';

vi.mock('aframe', () => ({}));
vi.mock('@webarkit/jsartoolkit-nft', () => ({ createNFTTracker: vi.fn() }));

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

beforeEach(() => {
    createNFTTracker.mockReset();
});

const base = {
    cameraParam: 'cam.dat',
    logLevel: 'warn',
    continuousDetection: true,
    detectionInterval: 300,
    lostTimeout: 200,
};
const size = { width: 1, height: 2, dpi: 3 };
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// A hand-built arnft system: init() is not run, so tests set what they need.
const system = (overrides = {}) =>
    Object.assign(
        Object.create(definitions.arnft),
        {
            data: base,
            registry: new MarkerRegistry(),
            tracker: null,
            starting: false,
            _resize() {},
            _applyProjection() {},
        },
        overrides,
    );

describe('arnft log level', () => {
    it('defaults to warn', () => {
        expect(definitions.arnft.schema.logLevel.default).toBe('warn');
    });
});

describe('arnft tracker start-up', () => {
    it('creates the tracker at the processing frame size, once a target is registered', async () => {
        createNFTTracker.mockResolvedValue({ cameraMatrix: new Float64Array(16) });
        const s = system({
            videoReady: true,
            camV: { pw: 320, ph: 240 },
            _setupCamera() {},
            _loadPendingMarkers() {},
        });
        s._maybeStart();
        expect(createNFTTracker).not.toHaveBeenCalled();

        s.registry.add({ name: 'a', url: 'a', component: {} });
        s._maybeStart();
        expect(createNFTTracker).toHaveBeenCalledTimes(1);
        expect(createNFTTracker.mock.lastCall[0]).toMatchObject({
            width: 320,
            height: 240,
            logLevel: 2,
            continuousDetection: true,
            detectionInterval: 300,
            lostTimeout: 200,
        });
    });

    it('sets up the camera before loading targets, as loading needs nothing else first', () => {
        const calls = [];
        const tracker = {};
        const s = system({
            _setupCamera() {
                calls.push(['camera', this.tracker]);
            },
            _loadPendingMarkers() {
                calls.push(['load', this.tracker]);
            },
        });
        s._onTrackerReady(tracker);
        expect(calls).toEqual([
            ['camera', tracker],
            ['load', tracker],
        ]);
    });

    it('allows another start after a failed one', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        createNFTTracker.mockRejectedValue(new Error('no camera file'));
        const s = system({ videoReady: true, camV: { pw: 320, ph: 240 } });
        s.registry.add({ name: 'a', url: 'a', component: {} });
        s._maybeStart();
        await flush();
        expect(s.starting).toBe(false);
        expect(error.mock.calls[0][0]).toContain('arnft: tracker init failed');
        error.mockRestore();
    });
});

describe('arnft per-frame work', () => {
    it('routes what process() found in the current frame to the components', () => {
        const pose = new Float64Array(16);
        const image = { width: 320, height: 240 };
        const component = { onPose: vi.fn(), onLost: vi.fn() };
        const tracker = {
            process: vi.fn((frame, time) => ({
                time,
                targets: [{ id: 0, found: true, pose }],
                transitions: [],
            })),
        };
        const s = system({ tracker, videoReady: true, camV: { getImage: () => image } });
        s.registry.setLoaded(s.registry.add({ name: 'a', url: 'a', component }), 0, size);

        s.tick();

        const [frame, time] = tracker.process.mock.calls[0];
        expect(frame).toBe(image);
        expect(component.onPose).toHaveBeenCalledWith(pose, time);
    });

    it('does not process before the tracker exists', () => {
        const getImage = vi.fn();
        system({ videoReady: true, camV: { getImage } }).tick();
        expect(getImage).not.toHaveBeenCalled();
    });
});

describe('arnft registerMarker', () => {
    it('hands a re-added <a-nft> the size kept from its first load', () => {
        const s = system({ tracker: {}, _loadPendingMarkers: vi.fn() });
        s.unregisterMarker(s.registry.setLoaded(s.registry.add({ name: 'a', url: new URL('a', document.baseURI).href, component: {} }), 0, size));

        const onData = vi.fn();
        s.registerMarker({ name: 'a', url: 'a', component: { onData } });

        expect(onData).toHaveBeenCalledWith(size);
        expect(s._loadPendingMarkers).not.toHaveBeenCalled();
    });
});

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
            stopped: false,
            _generation: 0,
            _resize() {},
            _applyProjection() {},
        },
        overrides,
    );

// A view whose every getImage() really captures a new frame.
const capturingView = (image = 'frame') => {
    const view = {
        frame: 0,
        getImage: vi.fn(() => {
            view.frame++;
            return image;
        }),
    };
    return view;
};

describe('arnft log level', () => {
    it('defaults to warn', () => {
        expect(definitions.arnft.schema.logLevel.default).toBe('warn');
    });
});

describe('arnft projection', () => {
    it('takes the projection from projectionFor, at the exact video aspect', () => {
        const geometry = { frameWidth: 320, frameHeight: 240, videoWidth: 1280, videoHeight: 720 };
        const matrix = Float64Array.from({ length: 16 }, (_, i) => i);
        const tracker = { projectionFor: vi.fn(() => matrix) };
        const s = system({
            tracker,
            view: { geometry },
            el: { querySelector: () => ({ getObject3D: () => ({}) }) },
        });
        s._setupCamera();
        expect(tracker.projectionFor).toHaveBeenCalledWith({ width: 1280, height: 720 }, geometry);
        expect(s.projArray).toEqual(Array.from(matrix));
    });
});

describe('arnft tracker start-up', () => {
    it('creates the tracker at the processing frame size, once a target is registered', async () => {
        createNFTTracker.mockResolvedValue({ cameraMatrix: new Float64Array(16) });
        const s = system({
            videoReady: true,
            view: { geometry: { frameWidth: 320, frameHeight: 240 } },
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
        const s = system({ videoReady: true, view: { geometry: { frameWidth: 320, frameHeight: 240 } } });
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
        const s = system({ tracker, videoReady: true, view: capturingView(image) });
        s.registry.setLoaded(s.registry.add({ name: 'a', url: 'a', component }), 0, size);

        s.tick();

        const [frame, time] = tracker.process.mock.calls[0];
        expect(frame).toBe(image);
        expect(component.onPose).toHaveBeenCalledWith(pose, time);
    });

    it('does not process before the tracker exists', () => {
        const view = capturingView();
        system({ videoReady: true, view }).tick();
        expect(view.getImage).not.toHaveBeenCalled();
    });

    it('reads no frame and skips process() when no target is loaded (#12)', () => {
        const tracker = { process: vi.fn() };
        const view = capturingView();
        system({ tracker, videoReady: true, view }).tick();
        expect(view.getImage).not.toHaveBeenCalled();
        expect(tracker.process).not.toHaveBeenCalled();
    });

    it('skips process() on a repeated frame (#12)', () => {
        const tracker = { process: vi.fn() };
        const view = { frame: 3, getImage: vi.fn(() => 'copy of the last frame') };
        const s = system({ tracker, videoReady: true, view });
        s.registry.setLoaded(s.registry.add({ name: 'a', url: 'a', component: {} }), 0, size);
        s.tick();
        expect(view.getImage).toHaveBeenCalledTimes(1);
        expect(tracker.process).not.toHaveBeenCalled();
    });

    it('logs once, hides the content and stops when process() throws', () => {
        // In the render loop the same error would otherwise repeat on every frame.
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const onLost = vi.fn();
        const tracker = {
            dispose: vi.fn(),
            process: vi.fn(() => {
                throw new RangeError('wrong frame size');
            }),
        };
        const s = system({ tracker, videoReady: true, view: capturingView() });
        s.registry.setLoaded(s.registry.add({ name: 'a', url: 'a', component: { onLost } }), 0, size);

        expect(() => s.tick()).not.toThrow();
        s.tick();

        expect(error).toHaveBeenCalledTimes(1);
        expect(error.mock.calls[0][0]).toContain('arnft:');
        expect(onLost).toHaveBeenCalledTimes(1);
        expect(tracker.process).toHaveBeenCalledTimes(1);
        expect(s.stopped).toBe(true);
        error.mockRestore();
    });
});

describe('arnft camera changes', () => {
    const loadedSystem = (overrides = {}) => {
        const onLost = vi.fn();
        const s = system(overrides);
        s.registry.setLoaded(s.registry.add({ name: 'a', url: 'a', component: { onLost } }), 0, size);
        return { s, onLost };
    };

    it('re-projects on a geometry change with the same frame size', () => {
        const s = system({
            tracker: {},
            _frameSize: { width: 320, height: 240 },
            _setupCamera: vi.fn(),
            _restartTracker: vi.fn(),
        });
        s._onGeometryChange({ frameWidth: 320, frameHeight: 240 });
        expect(s._setupCamera).toHaveBeenCalledTimes(1);
        expect(s._restartTracker).not.toHaveBeenCalled();
    });

    it('restarts the tracker when the frame size changes', () => {
        const s = system({
            tracker: {},
            _frameSize: { width: 320, height: 240 },
            _setupCamera: vi.fn(),
            _restartTracker: vi.fn(),
        });
        s._onGeometryChange({ frameWidth: 318, frameHeight: 239 });
        expect(s._restartTracker).toHaveBeenCalledTimes(1);
        expect(s._setupCamera).not.toHaveBeenCalled();
    });

    it('restarts when the frame size changes while the tracker is starting', () => {
        const s = system({ starting: true, _frameSize: { width: 320, height: 240 }, _restartTracker: vi.fn() });
        s._onGeometryChange({ frameWidth: 318, frameHeight: 239 });
        expect(s._restartTracker).toHaveBeenCalledTimes(1);
    });

    it('ignores a geometry change before any start: the start reads the geometry', () => {
        const s = system({ _setupCamera: vi.fn(), _restartTracker: vi.fn() });
        s._onGeometryChange({ frameWidth: 318, frameHeight: 239 });
        expect(s._setupCamera).not.toHaveBeenCalled();
        expect(s._restartTracker).not.toHaveBeenCalled();
    });

    it('a restart hides the content, disposes the old tracker and loads every target on the new one', async () => {
        const old = { dispose: vi.fn() };
        const fresh = { addNFTTargets: vi.fn(() => new Promise(() => {})) };
        createNFTTracker.mockResolvedValueOnce(fresh);
        const { s, onLost } = loadedSystem({
            tracker: old,
            videoReady: true,
            _setupCamera() {},
            view: { geometry: { frameWidth: 318, frameHeight: 239 } },
        });

        s._restartTracker();
        await flush();

        expect(onLost).toHaveBeenCalledTimes(1);
        expect(old.dispose).toHaveBeenCalled();
        expect(createNFTTracker.mock.lastCall[0]).toMatchObject({ width: 318, height: 239 });
        expect(s.tracker).toBe(fresh);
        expect(fresh.addNFTTargets).toHaveBeenCalledWith(['a'], { origin: 'corner' });
    });

    it('a restart keeps the first cameraParam, which a partial setAttribute resets', async () => {
        createNFTTracker.mockResolvedValue({ dispose() {}, addNFTTargets: () => new Promise(() => {}) });
        const s = system({
            videoReady: true,
            data: { ...base, cameraParam: 'my/cam.dat' },
            _setupCamera() {},
            view: { geometry: { frameWidth: 320, frameHeight: 240 } },
        });
        s.registry.add({ name: 'a', url: 'a', component: { onLost() {} } });
        s._maybeStart();
        await flush();

        s.data = { ...base, cameraParam: 'Data/camera_para.dat' };
        s._restartTracker();
        await flush();

        expect(createNFTTracker.mock.lastCall[0].cameraParam).toBe(new URL('my/cam.dat', document.baseURI).href);
    });

    it('disposes a tracker from a start that a restart overtook', async () => {
        let finishOld;
        const late = { dispose: vi.fn() };
        const fresh = { addNFTTargets: () => new Promise(() => {}) };
        createNFTTracker.mockImplementationOnce(() => new Promise((resolve) => (finishOld = resolve)));
        createNFTTracker.mockResolvedValueOnce(fresh);
        const s = system({
            videoReady: true,
            _setupCamera() {},
            view: { geometry: { frameWidth: 320, frameHeight: 240 } },
        });
        s.registry.add({ name: 'a', url: 'a', component: { onLost() {} } });
        s._maybeStart();
        s._restartTracker();
        await flush();
        finishOld(late);
        await flush();

        expect(late.dispose).toHaveBeenCalled();
        expect(s.tracker).toBe(fresh);
    });

    it('ignores a failure from a start that a restart overtook', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        let failOld;
        createNFTTracker.mockImplementationOnce(() => new Promise((_, reject) => (failOld = reject)));
        createNFTTracker.mockImplementationOnce(() => new Promise(() => {}));
        const s = system({ videoReady: true, view: { geometry: { frameWidth: 320, frameHeight: 240 } } });
        s.registry.add({ name: 'a', url: 'a', component: { onLost() {} } });
        s._maybeStart();
        s._restartTracker();
        failOld(new Error('old start failed'));
        await flush();

        expect(s.starting).toBe(true);
        expect(error).not.toHaveBeenCalled();
        error.mockRestore();
    });

    it('hides the content and stops reading frames when the camera ends', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const view = {
            frame: 0,
            getImage: vi.fn(() => {
                throw new Error('STREAM_ENDED');
            }),
        };
        const tracker = { process: vi.fn() };
        const { s, onLost } = loadedSystem({ tracker, videoReady: true, view });

        s._onCameraEnded();

        expect(onLost).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toContain('arnft:');
        expect(() => s.tick()).not.toThrow();
        expect(view.getImage).not.toHaveBeenCalled();
        warn.mockRestore();
    });
});

describe('arnft runtime settings (#13)', () => {
    it('does nothing before the tracker exists: the constructor calls update({})', () => {
        expect(() => system({ tracker: null }).update({})).not.toThrow();
    });

    it('sends only what changed to configure()', () => {
        const tracker = { configure: vi.fn(() => Promise.resolve()) };
        const s = system({ tracker, data: { ...base, detectionInterval: 0 } });
        s.update({ ...base });
        expect(tracker.configure).toHaveBeenCalledWith({ detectionInterval: 0 });
    });

    it('does not call configure() when no runtime key changed', () => {
        const tracker = { configure: vi.fn() };
        system({ tracker, data: { ...base } }).update({ ...base });
        expect(tracker.configure).not.toHaveBeenCalled();
    });

    it("keeps its settings and warns on setAttribute('arnft', key, value)", () => {
        // A-Frame drops the third argument for systems and turns this.data into
        // the bare string, which would break any later use of the settings.
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const tracker = { configure: vi.fn() };
        const s = system({ tracker, data: 'detectionInterval' });
        s.update(base);
        expect(s.data).toBe(base);
        expect(tracker.configure).not.toHaveBeenCalled();
        expect(warn.mock.calls[0][0]).toContain('arnft:');
        warn.mockRestore();
    });

    it('also keeps its settings when that happens before the tracker exists', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const s = system({ tracker: null, data: 'detectionInterval' });
        s.update(base);
        expect(s.data).toBe(base);
        warn.mockRestore();
    });

    it('applies a setting changed while the tracker was starting', async () => {
        // The config is built when the start begins, and update() has no tracker
        // to talk to until it ends, so the change would otherwise be lost.
        const tracker = { configure: vi.fn(() => Promise.resolve()) };
        createNFTTracker.mockResolvedValue(tracker);
        const s = system({
            videoReady: true,
            view: { geometry: { frameWidth: 320, frameHeight: 240 } },
            _setupCamera() {},
            _loadPendingMarkers() {},
        });
        s.registry.add({ name: 'a', url: 'a', component: {} });
        s._maybeStart();
        s.data = { ...base, detectionInterval: 0 };
        s.update(base);
        await flush();
        expect(s.tracker).toBe(tracker);
        expect(tracker.configure).toHaveBeenCalledWith({ detectionInterval: 0 });
    });

    it('logs a rejected patch instead of throwing (bad value)', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const tracker = { configure: vi.fn(() => Promise.reject(new TypeError('detectionInterval'))) };
        system({ tracker, data: { ...base, detectionInterval: NaN } }).update({ ...base });
        await flush();
        expect(error.mock.calls[0][0]).toContain('arnft:');
        error.mockRestore();
    });
});

describe('arnft teardown when the scene is removed (#16)', () => {
    it('the scene component tears the system down', () => {
        const _teardown = vi.fn();
        definitions['arnft-lifecycle'].remove.call({ el: { systems: { arnft: { _teardown } } } });
        expect(_teardown).toHaveBeenCalledTimes(1);
    });

    it('stops the camera, disposes the tracker and blocks a restart', () => {
        const tracker = { dispose: vi.fn() };
        const view = { destroy: vi.fn() };
        const s = system({ tracker, view, videoReady: true });

        s._teardown();

        expect(view.destroy).toHaveBeenCalledTimes(1);
        expect(tracker.dispose).toHaveBeenCalledTimes(1);
        expect(s.tracker).toBeNull();
        expect(s.videoReady).toBe(false);

        s.registerMarker({ name: 'a', url: 'a', component: {} });
        expect(createNFTTracker).not.toHaveBeenCalled();
    });

    it('disposes a tracker that resolves after teardown', async () => {
        const late = { dispose: vi.fn() };
        createNFTTracker.mockResolvedValueOnce(late);
        const s = system({
            videoReady: true,
            view: { destroy() {}, geometry: { frameWidth: 320, frameHeight: 240 } },
        });
        s.registry.add({ name: 'a', url: 'a', component: {} });

        s._maybeStart();
        s._teardown();
        await flush();

        expect(late.dispose).toHaveBeenCalledTimes(1);
        expect(s.tracker).toBeNull();
    });

    it('does not report a camera start cancelled by teardown, but reports other errors', () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const s = system();
        s._onCameraError(Object.assign(new Error('destroyed'), { code: 'DESTROYED' }));
        expect(error).not.toHaveBeenCalled();

        const denied = new Error('NotAllowedError');
        s._onCameraError(denied);
        expect(error).toHaveBeenCalledWith('arnft: camera init failed', denied);
        error.mockRestore();
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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cameraViewRenderer } from '../src/cameraViewRenderer.js';

// jsdom has no 2D canvas, so stand one in. Like the real API, getImageData
// hands back a new ImageData-shaped object on every call.
function fakeContext() {
    return {
        fillStyle: '',
        fillRect: vi.fn(),
        drawImage: vi.fn(),
        getImageData: vi.fn((x, y, w, h) => ({
            data: new Uint8ClampedArray(w * h * 4),
            width: w,
            height: h,
        })),
    };
}

describe('cameraViewRenderer.getImage', () => {
    let ctx;
    let getContext;

    beforeEach(() => {
        ctx = fakeContext();
        getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx);
        vi.useFakeTimers();
        vi.setSystemTime(10_000);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    // 640x480 video -> 320x240 processing frame.
    const renderer = () => {
        const r = new cameraViewRenderer({ videoWidth: 640, videoHeight: 480 });
        r.prepareImage();
        return r;
    };

    it('asks for a canvas optimised for per-frame readback', () => {
        renderer();
        expect(getContext).toHaveBeenCalledWith('2d', { alpha: false, willReadFrequently: true });
    });

    it('captures a frame on the first call', () => {
        const r = renderer();
        const image = r.getImage();
        expect(ctx.getImageData).toHaveBeenCalledTimes(1);
        expect(image.width).toBe(320);
        expect(image.height).toBe(240);
        expect(r.getFrame()).toBe(1);
    });

    it('returns the same instance, uncopied, until the frame-rate gate opens', () => {
        const r = renderer();
        const first = r.getImage();
        vi.advanceTimersByTime(5); // under 1000 / 60 ms
        expect(r.getImage()).toBe(first);
        expect(ctx.getImageData).toHaveBeenCalledTimes(1);
        expect(r.getFrame()).toBe(1);
    });

    it('captures a new frame once the gate opens', () => {
        const r = renderer();
        const first = r.getImage();
        vi.advanceTimersByTime(20); // over 1000 / 60 ms
        const second = r.getImage();
        // Object.is rather than .not.toBe: toBe deep-compares two different
        // objects (here two 300 KB frames) to build its hint, which takes ~2 s.
        expect(Object.is(second, first)).toBe(false);
        expect(ctx.getImageData).toHaveBeenCalledTimes(2);
        expect(r.getFrame()).toBe(2);
    });
});

// A desktop with a real webcam listed first and a virtual camera listed last,
// as with Meta Quest Link installed: its cameras fail with NotReadableError
// when no headset is connected. `failures` maps a deviceId to the error name
// getUserMedia rejects with when that device is requested.
function fakeMediaDevices(failures = {}) {
    const stream = { id: 'stream' };
    return {
        stream,
        enumerateDevices: async () => [
            { kind: 'videoinput', deviceId: 'webcam', label: 'Trust Webcam' },
            { kind: 'audioinput', deviceId: 'mic', label: 'Microphone' },
            { kind: 'videoinput', deviceId: 'quest', label: 'Meta Quest Pro' },
        ],
        getUserMedia: vi.fn(async (constraints) => {
            const requested = constraints.video.deviceId && constraints.video.deviceId.exact;
            if (requested && failures[requested]) {
                throw new DOMException('Could not start video source', failures[requested]);
            }
            return stream;
        }),
    };
}

describe('cameraViewRenderer.initialize', () => {
    let devices;

    const start = async (failures) => {
        devices = fakeMediaDevices(failures);
        vi.stubGlobal('navigator', { mediaDevices: devices });
        const video = { readyState: 1, videoWidth: 640, videoHeight: 480, srcObject: null };
        const r = new cameraViewRenderer(video);
        await r.initialize({ facingMode: 'environment', width: 640, height: 480 });
        return video;
    };

    beforeEach(() => {
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fakeContext());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('asks for the last camera first (the back camera on most phones)', async () => {
        // Characterisation: guards the existing mobile behaviour.
        const video = await start();
        expect(devices.getUserMedia).toHaveBeenCalledTimes(1);
        expect(devices.getUserMedia.mock.calls[0][0].video.deviceId).toEqual({ exact: 'quest' });
        expect(video.srcObject).toBe(devices.stream);
    });

    it('falls back to facingMode when the last camera cannot start', async () => {
        const video = await start({ quest: 'NotReadableError' });
        expect(devices.getUserMedia).toHaveBeenCalledTimes(2);
        const retry = devices.getUserMedia.mock.calls[1][0].video;
        expect(retry.deviceId).toBeUndefined();
        expect(retry.facingMode).toBe('environment');
        expect(video.srcObject).toBe(devices.stream);
    });

    it('does not retry when camera permission is denied', async () => {
        await expect(start({ quest: 'NotAllowedError' })).rejects.toMatchObject({ name: 'NotAllowedError' });
        expect(devices.getUserMedia).toHaveBeenCalledTimes(1);
    });
});

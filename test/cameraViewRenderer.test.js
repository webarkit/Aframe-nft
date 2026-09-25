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
        expect(second).not.toBe(first);
        expect(ctx.getImageData).toHaveBeenCalledTimes(2);
        expect(r.getFrame()).toBe(2);
    });
});

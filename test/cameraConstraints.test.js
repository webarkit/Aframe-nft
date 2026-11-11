import { describe, it, expect, vi } from 'vitest';
import { withIdealSize } from '../src/cameraConstraints.js';

const fake = () => ({
    getUserMedia: vi.fn(async () => 'stream'),
    enumerateDevices: vi.fn(async () => ['cam']),
});

describe('withIdealSize', () => {
    it('adds the ideal size and keeps the constraints camera-view chose', async () => {
        const devices = fake();
        const stream = await withIdealSize(devices, { width: 640, height: 480 }).getUserMedia({
            audio: false,
            video: { facingMode: 'environment', deviceId: { exact: 'x' } },
        });
        expect(stream).toBe('stream');
        expect(devices.getUserMedia).toHaveBeenCalledWith({
            audio: false,
            video: {
                facingMode: 'environment',
                deviceId: { exact: 'x' },
                width: { ideal: 640 },
                height: { ideal: 480 },
            },
        });
    });

    it('leaves out a size of 0', async () => {
        const devices = fake();
        await withIdealSize(devices, { width: 0, height: 0 }).getUserMedia({ video: { facingMode: 'user' } });
        expect(devices.getUserMedia).toHaveBeenCalledWith({ video: { facingMode: 'user' } });
    });

    it('delegates enumerateDevices', async () => {
        expect(await withIdealSize(fake(), { width: 640, height: 480 }).enumerateDevices()).toEqual(['cam']);
    });

    it('returns undefined with no mediaDevices, so camera-view reports NOT_SUPPORTED', () => {
        expect(withIdealSize(undefined, { width: 640, height: 480 })).toBeUndefined();
    });
});

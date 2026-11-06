import { describe, it, expect } from 'vitest';
import { trackerConfig, runtimePatch } from '../src/trackerSettings.js';

const data = {
    logLevel: 'warn',
    continuousDetection: true,
    detectionInterval: 300,
    lostTimeout: 200,
    videoWidth: 640,
};

describe('trackerConfig', () => {
    it('builds the tracker config, with the log level as a number and no filter', () => {
        const config = trackerConfig(data, { width: 320, height: 240 }, 'http://x/cam.dat');
        expect(config).toEqual({
            width: 320,
            height: 240,
            cameraParam: 'http://x/cam.dat',
            logLevel: 2,
            continuousDetection: true,
            detectionInterval: 300,
            lostTimeout: 200,
        });
    });
});

describe('runtimePatch', () => {
    it('returns only the runtime keys that changed', () => {
        expect(runtimePatch(data, { ...data, detectionInterval: 0 })).toEqual({ detectionInterval: 0 });
        expect(runtimePatch(data, { ...data, lostTimeout: 500, continuousDetection: false })).toEqual({
            lostTimeout: 500,
            continuousDetection: false,
        });
    });

    it('maps a changed logLevel to its number', () => {
        expect(runtimePatch(data, { ...data, logLevel: 'debug' })).toEqual({ logLevel: 0 });
    });

    it('returns null when no runtime key changed', () => {
        expect(runtimePatch(data, { ...data, videoWidth: 1280 })).toBeNull();
    });

    it('passes a bad value on, so the tracker refuses it and names the key', () => {
        expect(runtimePatch(data, { ...data, detectionInterval: NaN })).toEqual({ detectionInterval: NaN });
    });
});

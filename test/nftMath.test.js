import { describe, it, expect } from 'vitest';
import {
    pxToMm,
    computeCenterOffset,
    toMatrixElements,
    computeLiftZ,
} from '../src/nftMath.js';

describe('pxToMm', () => {
    it('converts pixels to millimetres via dpi', () => {
        // 72 px at 72 dpi = 1 inch = 25.4 mm
        expect(pxToMm(72, 72)).toBeCloseTo(25.4, 5);
    });
});

describe('computeCenterOffset (mesh-shift fix)', () => {
    it('centers the mesh using real-world size, not raw pixels', () => {
        const dpi = 72;
        const offset = computeCenterOffset(288, 216, dpi); // 4in x 3in
        expect(offset.x).toBeCloseTo(pxToMm(288, 72) / 2, 5); // ~50.8 mm
        expect(offset.y).toBeCloseTo(pxToMm(216, 72) / 2, 5); // ~38.1 mm
        expect(offset.z).toBe(0);
    });

    it('does NOT return the raw-pixel offset that caused the shift', () => {
        // Regression guard: the buggy code returned markerWidth/2 (e.g. 144),
        // which is ~4x the correct millimetre offset for 72 dpi.
        const offset = computeCenterOffset(288, 216, 72);
        expect(offset.x).not.toBeCloseTo(144, 1);
    });
});

describe('computeLiftZ', () => {
    it('lifts a centered unit cube by half its scaled height (bottom on the plane)', () => {
        // unit cube: bboxMinZ = -0.5, scaleFactor 150 -> lift 75
        expect(computeLiftZ(-0.5, 150, true)).toBe(75);
    });

    it('lifts an arbitrary mesh by its real scaled bottom extent', () => {
        // a mesh whose bottom is at z = -0.2 in local space
        expect(computeLiftZ(-0.2, 150, true)).toBeCloseTo(30, 6);
    });

    it('returns 0 when lift is disabled (mesh centered on the plane)', () => {
        expect(computeLiftZ(-0.5, 150, false)).toBe(0);
    });
});

describe('toMatrixElements', () => {
    it('accepts a 16-length array of numbers', () => {
        const arr = Array.from({ length: 16 }, (_, i) => i);
        expect(toMatrixElements(arr)).toEqual(arr);
    });

    it('accepts an object with numeric string values', () => {
        const obj = {};
        for (let i = 0; i < 16; i++) obj[i] = String(i);
        expect(toMatrixElements(obj)).toEqual(Array.from({ length: 16 }, (_, i) => i));
    });

    it('rejects wrong-length input', () => {
        expect(toMatrixElements([1, 2, 3])).toBeNull();
    });

    it('rejects null / undefined', () => {
        expect(toMatrixElements(null)).toBeNull();
        expect(toMatrixElements(undefined)).toBeNull();
    });

    it('rejects non-numeric values', () => {
        const arr = Array.from({ length: 16 }, () => 'x');
        expect(toMatrixElements(arr)).toBeNull();
    });
});

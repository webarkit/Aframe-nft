import { describe, it, expect } from 'vitest';
import { pxToMm, computeCenterOffset, toMatrixElements } from '../src/nftMath.js';

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

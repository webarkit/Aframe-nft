import { describe, it, expect } from 'vitest';
import { expSO3, logSO3, polarStep } from '../src/so3.js';

const vec = (x, y, z) => Float64Array.of(x, y, z);
const mat = () => new Float64Array(9);

const expectClose = (actual, wanted, digits = 12) => {
    expect(actual).toHaveLength(wanted.length);
    actual.forEach((v, i) => expect(v).toBeCloseTo(wanted[i], digits));
};

/** Largest entry of mᵀm − I: how far `m` is from having orthonormal columns. */
function orthoError(m) {
    let worst = 0;
    for (let a = 0; a < 3; a++) {
        for (let b = 0; b < 3; b++) {
            const dot = m[a * 3] * m[b * 3] + m[a * 3 + 1] * m[b * 3 + 1] + m[a * 3 + 2] * m[b * 3 + 2];
            worst = Math.max(worst, Math.abs(dot - (a === b ? 1 : 0)));
        }
    }
    return worst;
}

// Column-major rotations about each axis, written out by hand.
const aboutX = (a) => [1, 0, 0, 0, Math.cos(a), Math.sin(a), 0, -Math.sin(a), Math.cos(a)];
const aboutY = (a) => [Math.cos(a), 0, -Math.sin(a), 0, 1, 0, Math.sin(a), 0, Math.cos(a)];
const aboutZ = (a) => [Math.cos(a), Math.sin(a), 0, -Math.sin(a), Math.cos(a), 0, 0, 0, 1];

describe('expSO3', () => {
    // 1e-5 is below the threshold of the series, 1.2 above it.
    it.each([1e-5, 1.2])('builds the rotation of %f rad about each axis', (a) => {
        expectClose(expSO3(vec(a, 0, 0), mat()), aboutX(a));
        expectClose(expSO3(vec(0, a, 0), mat()), aboutY(a));
        expectClose(expSO3(vec(0, 0, a), mat()), aboutZ(a));
    });

    it('is the identity for a zero vector', () => {
        expect(Array.from(expSO3(vec(0, 0, 0), mat()))).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    });
});

describe('logSO3', () => {
    // Small angle, below π/2, and from π/2 up to just under π.
    it.each([1e-8, 0.5, 2.5, 3.14])('finds %f rad about each axis, with its sign', (a) => {
        expectClose(logSO3(Float64Array.from(aboutX(a)), vec(0, 0, 0)), [a, 0, 0], 10);
        expectClose(logSO3(Float64Array.from(aboutY(-a)), vec(0, 0, 0)), [0, -a, 0], 10);
        expectClose(logSO3(Float64Array.from(aboutZ(a)), vec(0, 0, 0)), [0, 0, a], 10);
    });

    it.each([
        [0.3, -0.2, 0.5],
        [1.2, 1.4, -0.7],
        [-1.5, 2.0, 1.5],
    ])('undoes expSO3 for the off-axis vector (%f, %f, %f)', (x, y, z) => {
        expectClose(logSO3(expSO3(vec(x, y, z), mat()), vec(0, 0, 0)), [x, y, z], 10);
    });

    it('keeps the axis at exactly π, where the sine is zero', () => {
        const halfTurnAboutY = Float64Array.of(-1, 0, 0, 0, 1, 0, 0, 0, -1);
        expectClose(logSO3(halfTurnAboutY, vec(0, 0, 0)), [0, Math.PI, 0]);
    });

    it('stays finite for a matrix that is not a rotation', () => {
        const broken = new Float64Array(9).fill(NaN);
        expect(Array.from(logSO3(broken, vec(1, 2, 3)))).toEqual([0, 0, 0]);
    });
});

describe('polarStep', () => {
    it('leaves a rotation where it is', () => {
        const m = Float64Array.from(aboutZ(0.7));
        expectClose(polarStep(m), aboutZ(0.7), 14);
    });

    it('takes most of the scale and shear out of a nearly rigid matrix', () => {
        const m = Float64Array.from(aboutX(0.7));
        m[0] *= 1.01;
        m[3] += 0.005;
        expect(orthoError(m)).toBeGreaterThan(0.01);
        expect(orthoError(polarStep(m))).toBeLessThan(1e-3);
    });

    it('leaves a singular matrix as it is', () => {
        const zero = new Float64Array(9);
        expect(Array.from(polarStep(zero))).toEqual(Array.from(new Float64Array(9)));
    });
});

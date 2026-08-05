import { describe, it, expect } from 'vitest';
import { OneEuroFilter, smoothingAlpha } from '../src/oneEuroFilter.js';

describe('smoothingAlpha', () => {
    it('is between 0 and 1 and rises with cutoff', () => {
        const dt = 1 / 60;
        const low = smoothingAlpha(0.1, dt);
        const high = smoothingAlpha(10, dt);
        expect(low).toBeGreaterThan(0);
        expect(high).toBeLessThan(1);
        expect(high).toBeGreaterThan(low);
    });
});

describe('OneEuroFilter', () => {
    it('returns the first sample unchanged', () => {
        const f = new OneEuroFilter();
        expect(f.filter(0, [1, 2, 3])).toEqual([1, 2, 3]);
    });

    it('does not mutate the input array', () => {
        const f = new OneEuroFilter();
        const input = [1, 2, 3];
        f.filter(0, input);
        expect(input).toEqual([1, 2, 3]);
    });

    it('converges toward a constant signal', () => {
        const f = new OneEuroFilter({ minCutoff: 1, beta: 0.01 });
        let out;
        for (let i = 0; i < 200; i++) {
            out = f.filter(i * 16, [10]);
        }
        expect(out[0]).toBeCloseTo(10, 3);
    });

    it('reduces noise around a steady value (output variance < input variance)', () => {
        const f = new OneEuroFilter({ minCutoff: 0.5, beta: 0.001 });
        const inputs = [];
        const outputs = [];
        for (let i = 0; i < 300; i++) {
            const noisy = 5 + Math.sin(i * 12.9898) * 0.5; // deterministic pseudo-noise
            inputs.push(noisy);
            outputs.push(f.filter(i * 16, [noisy])[0]);
        }
        const variance = (arr) => {
            const m = arr.reduce((a, b) => a + b, 0) / arr.length;
            return arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length;
        };
        // Compare the settled tail to avoid the warm-up transient.
        expect(variance(outputs.slice(100))).toBeLessThan(variance(inputs.slice(100)));
    });

    it('guards against equal/backwards timestamps (no NaN)', () => {
        const f = new OneEuroFilter();
        f.filter(100, [1]);
        const out = f.filter(100, [2]); // dt = 0
        expect(Number.isNaN(out[0])).toBe(false);
    });

    it('reset() clears state so the next sample passes through', () => {
        const f = new OneEuroFilter();
        f.filter(0, [1]);
        f.filter(16, [5]);
        f.reset();
        expect(f.filter(32, [9])).toEqual([9]);
    });
});

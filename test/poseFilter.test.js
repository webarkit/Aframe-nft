import { describe, it, expect } from 'vitest';
import { PoseFilter } from '../src/poseFilter.js';

// Samples at uneven frame intervals: a step, a ramp, a hold, then a jump.
const times = [1000, 1016, 1033, 1050, 1066, 1100];
const samples = [
    [0, 0, 0],
    [1, 0, -1],
    [1, 0.5, -1],
    [2, 1, -2],
    [2, 1, -2],
    [10, -5, 3],
];

// Outputs of the in-house 1€ filter this wrapper replaces (Hz cutoffs,
// millisecond timestamps). The wrapper must reproduce them, so switching to
// @webarkit/oneeurofilter-ts does not change how poses are smoothed.
const expected = {
    defaults: [
        [0, 0, 0],
        [0.00571672903917354, 0, -0.00571672903917354],
        [0.0170690042834754, 0.00151663823387801, -0.0170690042834754],
        [0.0606266525614794, 0.0102309288339337, -0.0606266525614794],
        [0.117733819416157, 0.0231365227515674, -0.117733819416157],
        [1.49857084755126, -0.134799349230823, -0.0606682004978362],
    ],
    responsive: [
        [0, 0, 0],
        [0.279283542140379, 0, -0.279283542140379],
        [0.549780152321504, 0.102671743534914, -0.549780152321504],
        [1.27227668180523, 0.408028438184691, -1.27227668180523],
        [1.64794674955388, 0.634631595692942, -1.64794674955388],
        [8.89004437998307, -3.35227468997864, 0.777747519682249],
    ],
};

const run = (filter) => times.map((t, i) => filter.filter(t, samples[i]));

const expectClose = (actual, wanted) => {
    expect(actual).toHaveLength(wanted.length);
    actual.forEach((row, i) => {
        expect(row).toHaveLength(wanted[i].length);
        row.forEach((v, j) => expect(v).toBeCloseTo(wanted[i][j], 12));
    });
};

describe('PoseFilter', () => {
    it('smooths like the previous in-house filter with the nft-anchor defaults', () => {
        expectClose(run(new PoseFilter({ minCutoff: 0.0001, beta: 0.01 })), expected.defaults);
    });

    it('smooths like the previous in-house filter with responsive settings', () => {
        expectClose(run(new PoseFilter({ minCutoff: 1, beta: 0.5 })), expected.responsive);
    });

    it('defaults to the nft-anchor schema defaults', () => {
        expectClose(run(new PoseFilter()), expected.defaults);
    });

    it('returns plain arrays and leaves its input untouched', () => {
        const f = new PoseFilter();
        f.filter(1000, [0, 0]);
        const input = [1, 2];
        const out = f.filter(1016, input);
        expect(Array.isArray(out)).toBe(true);
        expect(out).toHaveLength(2);
        expect(out.every(Number.isFinite)).toBe(true);
        expect(input).toEqual([1, 2]);
    });

    it('passes the first sample after reset() through unchanged', () => {
        const f = new PoseFilter();
        f.filter(1000, [0, 0]);
        f.filter(1016, [5, 5]);
        f.reset();
        expect(f.filter(1033, [7, 8])).toEqual([7, 8]);
    });
});

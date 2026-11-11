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

// Outputs of a plain 1€ filter on `samples`, one component at a time (Hz cutoffs,
// millisecond timestamps). They come from the in-house filter this project
// started with, and they are what the translation, and a rotation about one axis,
// must still produce.
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
    // The same filter at 0.0001 Hz and a beta of 2: the rotation's defaults. Worked
    // out apart from the package and PoseFilter, with formulas that also give the two
    // tables above. The last sample is left out: its jump to 10 rad would wrap around.
    rotationDefaults: [
        [0, 0, 0],
        [0.5344330998808964, 0, -0.5344330998808964],
        [0.8254058796248591, 0.18874026186715787, -0.8254058796248591],
        [1.7011362426676555, 0.6795588212640402, -1.7011362426676555],
        [1.922352520481473, 0.8803318479374815, -1.922352520481473],
    ],
};

const settings = {
    defaults: { minCutoff: 0.0001, beta: 0.01 },
    responsive: { minCutoff: 1, beta: 0.5 },
};

// What makes the rotation match each `expected` table. `beta` stays at its default in
// all of them: it belongs to the translation.
const rotationSettings = {
    rotationDefaults: {},
    defaults: { minCutoff: 0.0001, rotationBeta: 0.01 },
    responsive: { minCutoff: 1, rotationBeta: 0.5 },
};

/** A column-major pose: the rotation Rz · Ry · Rx (radians), then a translation. */
function pose(rx, ry, rz, tx = 0, ty = 0, tz = 0) {
    const [cx, sx] = [Math.cos(rx), Math.sin(rx)];
    const [cy, sy] = [Math.cos(ry), Math.sin(ry)];
    const [cz, sz] = [Math.cos(rz), Math.sin(rz)];
    return [
        cz * cy, sz * cy, -sy, 0,
        cz * sy * sx - sz * cx, sz * sy * sx + cz * cx, cy * sx, 0,
        cz * sy * cx + sz * sx, sz * sy * cx - cz * sx, cy * cx, 0,
        tx, ty, tz, 1,
    ];
}

/** A repeatable hand-held camera: a slow sway plus jitter on every axis. */
function handHeld(frames) {
    let seed = 1;
    const jitter = (size) => {
        seed = (seed * 16807) % 2147483647;
        return (seed / 2147483647 - 0.5) * size;
    };
    let t = 1000;
    return Array.from({ length: frames }, (_, i) => {
        t += 16 + (i % 3);
        return {
            t,
            pose: pose(
                0.4 * Math.sin(i / 40) + jitter(0.02),
                0.3 * Math.sin(i / 55) + jitter(0.02),
                0.5 * Math.sin(i / 70) + jitter(0.02),
                100 + jitter(2),
                -50 + jitter(2),
                -300 + jitter(2),
            ),
        };
    });
}

const expectClose = (actual, wanted, digits = 12) => {
    expect(actual).toHaveLength(wanted.length);
    actual.forEach((v, i) => expect(v).toBeCloseTo(wanted[i], digits));
};

/** The angle between the rotations of two poses, in degrees. */
const degreesBetween = (a, b) => {
    let trace = 0;
    for (const c of [0, 1, 2]) {
        for (const r of [0, 1, 2]) {
            trace += a[c * 4 + r] * b[c * 4 + r];
        }
    }
    return (Math.acos(Math.min(1, Math.max(-1, (trace - 1) / 2))) * 180) / Math.PI;
};

/** Orthonormal columns, determinant +1, and a bottom row of 0 0 0 1. */
const expectRigid = (m) => {
    const column = (c) => [m[c * 4], m[c * 4 + 1], m[c * 4 + 2]];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const [x, y, z] = [column(0), column(1), column(2)];
    expect(Math.abs(dot(x, x) - 1)).toBeLessThan(1e-12);
    expect(Math.abs(dot(y, y) - 1)).toBeLessThan(1e-12);
    expect(Math.abs(dot(z, z) - 1)).toBeLessThan(1e-12);
    expect(Math.abs(dot(x, y))).toBeLessThan(1e-12);
    expect(Math.abs(dot(y, z))).toBeLessThan(1e-12);
    expect(Math.abs(dot(z, x))).toBeLessThan(1e-12);
    const cross = [
        x[1] * y[2] - x[2] * y[1],
        x[2] * y[0] - x[0] * y[2],
        x[0] * y[1] - x[1] * y[0],
    ];
    expect(Math.abs(dot(cross, z) - 1)).toBeLessThan(1e-12);
    expect([m[3], m[7], m[11], m[15]]).toEqual([0, 0, 0, 1]);
};

describe('PoseFilter', () => {
    describe('translation', () => {
        const translationOf = (filter) =>
            times.map((t, i) => {
                const [x, y, z] = samples[i];
                return filter.filter(t, pose(0, 0, 0, x, y, z)).slice(12, 15);
            });

        it.each(['defaults', 'responsive'])('is smoothed like a plain 1€ filter with the %s settings', (name) => {
            const outputs = translationOf(new PoseFilter(settings[name]));
            outputs.forEach((row, i) => expectClose(row, expected[name][i]));
        });

        it('uses the nft-anchor schema defaults when no options are given', () => {
            const outputs = translationOf(new PoseFilter());
            outputs.forEach((row, i) => expectClose(row, expected.defaults[i]));
        });

        it('is not changed by rotationBeta, which belongs to the rotation', () => {
            const outputs = translationOf(new PoseFilter({ rotationBeta: 0.5 }));
            outputs.forEach((row, i) => expectClose(row, expected.defaults[i]));
        });
    });

    it('smooths the rotation and the translation of one pose each at its own rate', () => {
        const filter = new PoseFilter();
        times.slice(0, 5).forEach((t, i) => {
            const [x, y, z] = samples[i];
            const out = filter.filter(t, pose(0, 0, x, x, y, z));
            expect(Math.atan2(out[1], out[0])).toBeCloseTo(expected.rotationDefaults[i][0], 12);
            expectClose(out.slice(12, 15), expected.defaults[i]);
        });
    });

    describe('rotation', () => {
        // About one axis the tangent step is the difference of the angles, so the
        // angle must be filtered like the plain 1€ filter. The last sample is left
        // out: its jump to 10 rad would wrap around.
        const axes = [
            { axis: 'x', column: 2, build: (a) => pose(a, 0, 0), angleOf: (m) => Math.atan2(m[6], m[5]) },
            { axis: 'y', column: 1, build: (a) => pose(0, a, 0), angleOf: (m) => Math.atan2(m[8], m[0]) },
            { axis: 'z', column: 0, build: (a) => pose(0, 0, a), angleOf: (m) => Math.atan2(m[1], m[0]) },
        ];

        describe.each(Object.keys(rotationSettings))('with the %s settings', (name) => {
            it.each(axes)('about $axis is smoothed like its angle', ({ column, build, angleOf }) => {
                const filter = new PoseFilter(rotationSettings[name]);
                times.slice(0, 5).forEach((t, i) => {
                    const out = filter.filter(t, build(samples[i][column]));
                    expect(angleOf(out)).toBeCloseTo(expected[name][i][column], 12);
                });
            });

            it('stays rigid on a hand-held camera', () => {
                const filter = new PoseFilter(rotationSettings[name]);
                for (const { t, pose: p } of handHeld(300)) {
                    expectRigid(filter.filter(t, p));
                }
            });

            it('stays rigid through jumps of more than 90 degrees', () => {
                const filter = new PoseFilter(rotationSettings[name]);
                const jumps = [pose(0, 0, 0), pose(2.2, 0.5, -1), pose(-1, 2.5, 0.5), pose(0.3, -0.2, 3.1)];
                jumps.forEach((p, i) => expectRigid(filter.filter(1000 + i * 16, p)));
            });
        });

        it('is not changed by beta, which belongs to the translation', () => {
            const filter = new PoseFilter({ beta: 0.5 });
            times.slice(0, 5).forEach((t, i) => {
                const out = filter.filter(t, pose(0, 0, samples[i][0]));
                expect(Math.atan2(out[1], out[0])).toBeCloseTo(expected.rotationDefaults[i][0], 12);
            });
        });

        it('closes a 20 degree jump within half a second at the defaults', () => {
            // The lag this setting exists for: with a rotationBeta of 0.01, 16 degrees
            // are still left at this point.
            const filter = new PoseFilter();
            const target = pose(0, 0, (20 * Math.PI) / 180);
            filter.filter(1000, pose(0, 0, 0));
            let out;
            for (let frame = 1; frame <= 15; frame++) {
                out = filter.filter(1000 + (frame * 1000) / 30, target);
            }
            expect(degreesBetween(out, target)).toBeLessThan(1);
        });

        it('keeps the shake out of a still pose at the defaults', () => {
            // What stops rotationBeta from simply being large: it opens the filter to
            // noise as well. This noise is about the raw tracker's on a still camera.
            let seed = 1;
            const noise = () => {
                seed = (seed * 16807) % 2147483647;
                return (seed / 2147483647 - 0.5) * 0.014;
            };
            const noisy = () => pose(0.2 + noise(), -0.1 + noise(), 0.4 + noise(), 10, 20, -300);
            const filter = new PoseFilter();
            const steps = { input: [], output: [] };
            let previous = null;
            for (let frame = 0; frame < 300; frame++) {
                const input = noisy();
                const output = filter.filter(1000 + (frame * 1000) / 30, input);
                if (previous && frame > 30) {
                    steps.input.push(degreesBetween(input, previous.input));
                    steps.output.push(degreesBetween(output, previous.output));
                }
                previous = { input, output };
            }
            const mean = (v) => v.reduce((sum, x) => sum + x, 0) / v.length;
            expect(mean(steps.output)).toBeLessThan(mean(steps.input) / 10);
        });

        it('reaches the input when the cutoff is very high, on any axis and through any jump', () => {
            const filter = new PoseFilter({ minCutoff: 1e12, beta: 0 });
            const poses = [
                pose(0.1, 0.2, 0.3),
                pose(0.12, 0.17, 0.33),
                pose(2.2, 0.5, -1),
                pose(-1, 2.5, 0.5),
                pose(0.3, -0.2, 3.1),
            ];
            poses.forEach((p, i) => expectClose(filter.filter(1000 + i * 16, p), p, 9));
        });

        it('takes the rounding out of poses that are rigid only to single precision', () => {
            const rounded = (...angles) => Array.from(Float32Array.from(pose(...angles)));
            const filter = new PoseFilter();
            // The first pose passes through as it is, so it is not rigid yet.
            expect(() => expectRigid(filter.filter(1000, rounded(0.5, -0.3, 1.2)))).toThrow();
            expectRigid(filter.filter(1016, rounded(0.51, -0.29, 1.21)));
        });

        it('holds still when the pose does not change', () => {
            const filter = new PoseFilter();
            const p = pose(0.7, -0.4, 1.9, 10, 20, -300);
            for (let i = 0; i < 300; i++) {
                expectClose(filter.filter(1000 + i * 16, p), p);
            }
        });
    });

    describe('first sample', () => {
        // Rounded to single precision, so not exactly rigid: nothing may touch it.
        const input = Array.from(Float32Array.from(pose(0.5, -0.3, 1.2, 11, 22, -33)));

        it('passes through unchanged', () => {
            expect(new PoseFilter().filter(1000, input)).toEqual(input);
        });

        it('passes through unchanged after reset()', () => {
            const filter = new PoseFilter();
            filter.filter(1000, pose(0, 0, 0));
            filter.filter(1016, pose(0.2, 0.2, 0.2, 5, 5, 5));
            filter.reset();
            expect(filter.filter(1033, input)).toEqual(input);
        });
    });

    it('forgets the speed of the rotation and the translation on reset()', () => {
        const run = (filter) => handHeld(20).map(({ t, pose: p }) => filter.filter(t + 5000, p));
        const used = new PoseFilter();
        // Moves fast, so both filtered speeds end up far from zero.
        used.filter(1000, pose(0, 0, 0));
        used.filter(1016, pose(1, 1, 1, 500, 500, 500));
        used.reset();
        expect(run(used)).toEqual(run(new PoseFilter()));
    });

    describe('a timestamp that does not increase', () => {
        const start = (filter) => {
            filter.filter(1000, pose(0, 0, 0));
            return filter.filter(1016, pose(0.2, 0.1, -0.1, 5, 6, 7));
        };

        it.each([
            ['repeated', 1016],
            ['earlier', 900],
            ['NaN', NaN],
        ])('returns the previous output when %s, and changes no state', (_name, t) => {
            const refused = new PoseFilter();
            const control = new PoseFilter();
            const previous = start(refused);
            start(control);

            expect(refused.filter(t, pose(1, 1, 1, 50, 50, 50))).toEqual(previous);

            const next = pose(0.3, 0.2, 0, 8, 9, 10);
            expect(refused.filter(1033, next)).toEqual(control.filter(1033, next));
        });
    });

    it('returns a new plain array each time and leaves its input untouched', () => {
        const filter = new PoseFilter();
        filter.filter(1000, pose(0, 0, 0));
        const input = pose(0.2, 0.1, -0.1, 5, 6, 7);
        const copy = [...input];

        const out = filter.filter(1016, input);
        expect(Array.isArray(out)).toBe(true);
        expect(out).toHaveLength(16);
        expect(input).toEqual(copy);

        // nft-anchor multiplies the post-matrix into the array it gets back.
        const kept = [...out];
        out.fill(0);
        const refused = filter.filter(1016, input);
        expect(refused).toEqual(kept);
        refused.fill(0);
        expect(filter.filter(1016, input)).toEqual(kept);
    });
});

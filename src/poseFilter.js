/**
 * 1€ pose smoothing for `nft-anchor`, built on WebARKit's
 * [`@webarkit/oneeurofilter-ts`](https://github.com/webarkit/OneEuroFilter-ts).
 *
 * The 1€ filter (Casiez, Roussel and Vogel, CHI 2012,
 * https://gery.casiez.net/1euro/) is an adaptive low-pass filter. Slow movement
 * is smoothed hard (low jitter), fast movement little (low lag). Each of the 16
 * pose-matrix elements is filtered independently.
 *
 * This wrapper adapts the package to the component:
 * - **Units.** The package measures time in the timestamps' own unit, here
 *   milliseconds, so its frequencies are per millisecond. The `nft-anchor`
 *   cutoffs are in Hz and are divided by 1000. `beta` needs no conversion, and
 *   the package's fixed derivative cutoff (0.001 per ms) is 1 Hz. Smoothing is
 *   therefore identical to the in-house filter this replaced
 *   (`test/poseFilter.test.js` pins that).
 * - **Arrays.** The package works on typed arrays; the component uses plain
 *   arrays.
 *
 * @module poseFilter
 */
import { OneEuroFilter } from '@webarkit/oneeurofilter-ts';

export class PoseFilter {
    /**
     * @param {object} [options]
     * @param {number} [options.minCutoff=0.0001] Baseline cutoff in Hz. Lower
     *     is smoother at rest, with more lag.
     * @param {number} [options.beta=0.01] Speed coefficient. Higher reduces lag
     *     while moving.
     */
    constructor({ minCutoff = 0.0001, beta = 0.01 } = {}) {
        this._filter = new OneEuroFilter(minCutoff / 1000, beta);
    }

    /**
     * Filter one sample. The first sample, and the first after
     * {@link PoseFilter#reset}, passes through unchanged.
     *
     * @param {number} t Timestamp in milliseconds; must increase between calls.
     * @param {ArrayLike<number>} values Sample, e.g. 16 matrix elements.
     * @returns {number[]} A new array with the filtered values.
     */
    filter(t, values) {
        return Array.from(this._filter.filter(t, Float64Array.from(values)));
    }

    /** Forget all state; the next sample passes through unchanged. */
    reset() {
        this._filter.reset();
    }
}

/**
 * 1€ pose smoothing for `nft-anchor`, built on WebARKit's
 * [`@webarkit/oneeurofilter-ts`](https://github.com/webarkit/OneEuroFilter-ts).
 *
 * The 1€ filter (Casiez, Roussel and Vogel, CHI 2012,
 * https://gery.casiez.net/1euro/) is an adaptive low-pass filter. Slow movement
 * is smoothed hard (low jitter), fast movement little (low lag).
 *
 * The pose is a column-major matrix: the rotation R in elements 0–2, 4–6 and 8–10,
 * the translation in 12–14. The two parts are filtered apart, so the pose stays
 * rigid. This follows `oneEuro.ts` in jsartoolkitNFT 1.16
 * (webarkit/jsartoolkitNFT#766):
 * - **Rotation**, on its tangent space: the step `ω = log(R̂ᵀR)`, smoothed by the
 *   package's `filterStep()`, then `R̂ ← R̂ · exp(ω̂)`. Smoothing the 9 entries of R
 *   one by one gives R scale and shear. ω is expressed in R̂'s own frame; with one
 *   α per component the result depends on that frame (the package README's note).
 * - **Translation**, as a vector, with the package's `filter()`. The result is the
 *   same as filtering those three elements on their own, as before.
 *
 * **Settings.** `minCutoff` is a frequency, so one value suits both parts. `beta` is
 * per unit of the signal, so each part has its own: the same number barely opens the
 * cutoff for radians while it suits millimetres. A point on the content moves about
 * `angle × lever`, with a lever of 100 to 300 mm, so the rotation needs 100 to 300
 * times the translation's `beta`. At the defaults both lag by about the same time.
 * This is where the wrapper differs from `oneEuro.ts`, where one pair drives both.
 *
 * **Units.** The package measures time in the timestamps' own unit, here
 * milliseconds, so its frequencies are per millisecond. The `nft-anchor` cutoffs
 * are in Hz and are divided by 1000. `beta` needs no conversion, and the package's
 * fixed derivative cutoff (0.001 per ms) is 1 Hz.
 *
 * @module poseFilter
 */
import { OneEuroFilter } from '@webarkit/oneeurofilter-ts';
import { expSO3, logSO3, polarStep } from './so3';

export class PoseFilter {
    /**
     * @param {object} [options]
     * @param {number} [options.minCutoff=0.0001] Baseline cutoff in Hz, for the
     *     rotation and the translation. Lower is smoother at rest, with more lag.
     * @param {number} [options.beta=0.01] The translation's speed coefficient, per
     *     millimetre. Higher reduces lag while moving.
     * @param {number} [options.rotationBeta=2] The rotation's speed coefficient, per
     *     radian. Higher reduces lag while moving.
     */
    constructor({ minCutoff = 0.0001, beta = 0.01, rotationBeta = 2 } = {}) {
        // One package instance per method: filter() and filterStep() share the
        // filtered speed.
        this._rotation = new OneEuroFilter(minCutoff / 1000, rotationBeta);
        this._translation = new OneEuroFilter(minCutoff / 1000, beta);
        // Scratch arrays, created once.
        this._r = new Float64Array(9);
        this._rHat = new Float64Array(9);
        this._rel = new Float64Array(9);
        this._dR = new Float64Array(9);
        this._next = new Float64Array(9);
        this._w = new Float64Array(3);
        this._wStep = new Float64Array(3);
        this._alpha = new Float64Array(3);
        this._t = new Float64Array(3);
        this._tHat = new Float64Array(3);
        this._output = new Float64Array(16);
        this._previousTime = 0;
        this._started = false;
    }

    /**
     * Filter one pose. The first pose, and the first after
     * {@link PoseFilter#reset}, passes through unchanged. A timestamp that does not
     * increase returns the previous output and changes no state.
     *
     * @param {number} time Timestamp in milliseconds.
     * @param {ArrayLike<number>} pose The 16 pose-matrix elements, column-major.
     *     Its rotation should be a rotation, as a tracked pose's is.
     * @returns {number[]} A new array with the filtered pose. `nft-anchor` writes
     *     into it, so it is never kept here.
     */
    filter(time, pose) {
        const { _r: r, _rHat: rHat, _t: t, _tHat: tHat } = this;
        for (let c = 0; c < 3; c++) {
            for (let row = 0; row < 3; row++) {
                r[c * 3 + row] = pose[c * 4 + row];
            }
            t[c] = pose[12 + c];
        }
        if (!this._started) {
            rHat.set(r);
            this._translation.filter(time, t, tHat);
            this._started = true;
        } else {
            const elapsed = time - this._previousTime;
            // Not `elapsed <= 0`: a NaN time must be refused too.
            if (!(elapsed > 0)) {
                return Array.from(this._output);
            }
            this._stepRotation(elapsed);
            this._translation.filter(time, t, tHat);
        }
        this._previousTime = time;
        return this._write();
    }

    /** Forget all state; the next pose passes through unchanged. */
    reset() {
        this._rotation.reset();
        this._translation.reset();
        this._started = false;
    }

    /**
     * Move R̂ towards R by the smoothed tangent step.
     *
     * @param {number} elapsed Milliseconds since the previous pose; positive.
     * @private
     */
    _stepRotation(elapsed) {
        const { _r: r, _rHat: rHat, _rel: rel, _dR: dR, _next: next, _w: w, _wStep: wStep } = this;
        // rel = R̂ᵀ R, the rotation from the filtered pose to the new one, in R̂'s frame.
        for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 3; j++) {
                rel[j * 3 + i] =
                    rHat[i * 3] * r[j * 3] + rHat[i * 3 + 1] * r[j * 3 + 1] + rHat[i * 3 + 2] * r[j * 3 + 2];
            }
        }
        this._rotation.filterStep(elapsed, logSO3(rel, w), wStep, this._alpha);
        expSO3(wStep, dR);
        // next = R̂ · dR
        for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 3; j++) {
                next[j * 3 + i] = rHat[i] * dR[j * 3] + rHat[3 + i] * dR[j * 3 + 1] + rHat[6 + i] * dR[j * 3 + 2];
            }
        }
        rHat.set(next);
        // Rounding would otherwise accumulate into scale and shear over a long run.
        polarStep(rHat);
    }

    /**
     * Compose the output from R̂ and the filtered translation.
     *
     * @returns {number[]} A copy of the output, which stays here for a refused
     *     timestamp.
     * @private
     */
    _write() {
        const { _output: out, _rHat: rHat, _tHat: tHat } = this;
        for (let c = 0; c < 3; c++) {
            for (let row = 0; row < 3; row++) {
                out[c * 4 + row] = rHat[c * 3 + row];
            }
            out[c * 4 + 3] = 0;
            out[12 + c] = tHat[c];
        }
        out[15] = 1;
        return Array.from(out);
    }
}

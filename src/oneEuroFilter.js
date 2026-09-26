/**
 * 1€ filter: an adaptive low-pass filter that trades jitter for lag based on
 * how fast the signal moves. Slow movement is smoothed hard (low jitter); fast
 * movement is smoothed little (low lag). Used here to de-noise the raw NFT
 * pose, filtering each of the 16 matrix elements independently.
 *
 * Casiez, Roussel and Vogel, "1€ Filter: A Simple Speed-based Low-pass Filter
 * for Noisy Input in Interactive Systems", CHI 2012.
 * https://gery.casiez.net/1euro/
 *
 * Kept dependency-free and DOM-free so it can be unit-tested in isolation.
 *
 * @module oneEuroFilter
 */

/**
 * Exponential-smoothing factor for a cutoff frequency and a time step.
 *
 * @param {number} cutoff Cutoff frequency in Hz.
 * @param {number} dt Time since the previous sample, in seconds.
 * @returns {number} Factor in (0, 1). Higher values follow the input more closely.
 */
export function smoothingAlpha(cutoff, dt) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
}

/**
 * Stateful 1€ filter over arrays of numbers, such as the 16 elements of a
 * pose matrix.
 */
export class OneEuroFilter {
    /**
     * @param {object} [options]
     * @param {number} [options.minCutoff=0.0001] Baseline cutoff in Hz. Lower
     *     is smoother at rest, with more lag.
     * @param {number} [options.beta=0.01] Speed coefficient. Higher reduces lag
     *     while moving.
     * @param {number} [options.dCutoff=1.0] Cutoff in Hz for the derivative
     *     (speed) estimate.
     */
    constructor({ minCutoff = 0.0001, beta = 0.01, dCutoff = 1.0 } = {}) {
        this.minCutoff = minCutoff;
        this.beta = beta;
        this.dCutoff = dCutoff;
        this.reset();
    }

    /** Forget all state; the next sample passes through unchanged. */
    reset() {
        this.xPrev = null;
        this.dxPrev = null;
        this.tPrev = null;
    }

    /**
     * Filter one sample. The first call after construction or {@link reset}
     * seeds the state and returns a copy of the input.
     *
     * @param {number} t Timestamp in milliseconds.
     * @param {number[]} x Sample. Its length must stay the same between calls.
     * @returns {number[]} A new array with the filtered values.
     */
    filter(t, x) {
        if (this.xPrev === null) {
            this.xPrev = x.slice();
            this.dxPrev = x.map(() => 0);
            this.tPrev = t;
            return x.slice();
        }

        let dt = (t - this.tPrev) / 1000;
        if (!(dt > 0)) {
            dt = 1 / 60; // guard against equal/backwards timestamps
        }

        const out = new Array(x.length);
        const aD = smoothingAlpha(this.dCutoff, dt);
        for (let i = 0; i < x.length; i++) {
            const dx = (x[i] - this.xPrev[i]) / dt;
            const dxHat = aD * dx + (1 - aD) * this.dxPrev[i];
            const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);
            const a = smoothingAlpha(cutoff, dt);
            const xHat = a * x[i] + (1 - a) * this.xPrev[i];
            out[i] = xHat;
            this.xPrev[i] = xHat;
            this.dxPrev[i] = dxHat;
        }
        this.tPrev = t;
        return out;
    }
}

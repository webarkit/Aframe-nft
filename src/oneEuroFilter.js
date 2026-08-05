// 1€ filter (Casiez et al.) — an adaptive low-pass filter that trades lag for
// jitter based on signal speed: slow movement is smoothed hard (low jitter),
// fast movement is smoothed little (low lag). Used here to de-noise the raw NFT
// pose matrix, filtering each of the 16 elements independently.
//
// Kept dependency-free and DOM-free so it can be unit-tested in isolation.

// Smoothing factor for a given cutoff frequency (Hz) and time delta (seconds).
export function smoothingAlpha(cutoff, dt) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
}

export class OneEuroFilter {
    // minCutoff: baseline smoothing (lower = smoother/more lag at rest).
    // beta: speed coefficient (higher = less lag while moving).
    // dCutoff: cutoff for the derivative estimate.
    constructor({ minCutoff = 0.0001, beta = 0.01, dCutoff = 1.0 } = {}) {
        this.minCutoff = minCutoff;
        this.beta = beta;
        this.dCutoff = dCutoff;
        this.reset();
    }

    reset() {
        this.xPrev = null;
        this.dxPrev = null;
        this.tPrev = null;
    }

    // Filter an array of numbers at timestamp t (milliseconds). Returns a new
    // array; the first call seeds state and returns a copy of the input.
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

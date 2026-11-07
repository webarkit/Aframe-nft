/**
 * Creates the tracker on the same thread or in a Worker, with a fallback from the
 * second to the first. Tracking in a Worker is an optimisation, so a page that
 * asked for it and cannot have it still tracks.
 *
 * The factories are injected: this module imports nothing from the package and can
 * be unit-tested with fakes.
 *
 * @module trackerFactory
 */

/**
 * How long a Worker may take to start before the same thread is used instead.
 * Generous, because compiling the WASM takes seconds on a slow phone. Missing Worker
 * files do not wait for this: they reject at once.
 */
export const WORKER_START_TIMEOUT_MS = 30000;

/**
 * Create a tracker.
 *
 * @param {import('@webarkit/jsartoolkit-nft').NFTTrackerConfig} config
 * @param {object} options
 * @param {boolean} options.worker Track in a Worker.
 * @param {string} options.workerBase Folder of the Worker files. Empty: next to the
 *     bundle. It is left out in that case, because the package would read an empty
 *     string as the page's own folder.
 * @param {object} factories
 * @param {function(object): Promise<object>} factories.createNFTTracker
 * @param {function(object, object): Promise<object>} factories.createNFTTrackerWorker
 * @returns {Promise<import('@webarkit/jsartoolkit-nft').NFTTracker>}
 */
export async function createTracker(config, { worker, workerBase }, { createNFTTracker, createNFTTrackerWorker }) {
    if (!worker) {
        return createNFTTracker(config);
    }
    const options = { signal: AbortSignal.timeout(WORKER_START_TIMEOUT_MS) };
    if (workerBase) {
        options.workerBase = workerBase;
    }
    try {
        return await createNFTTrackerWorker(config, options);
    } catch (err) {
        console.warn('arnft: could not start the tracking Worker; tracking on the same thread instead', err);
        return createNFTTracker(config);
    }
}

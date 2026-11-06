/**
 * Turns the `arnft` system's attributes into jsartoolkitNFT tracker settings: the
 * config a tracker is created with, and the patch for a change made while it runs.
 *
 * `filter` is deliberately left out, so the tracker keeps its `'native'` default.
 * Its filter setting is per tracker, while `nft-anchor` smooths per `<a-nft>`.
 *
 * Kept free of A-Frame / THREE / DOM so it can be unit-tested in isolation.
 *
 * @module trackerSettings
 */
import { toARLogLevel } from './logLevel';

/** The `arnft` attributes that `tracker.configure()` can change at runtime. */
const RUNTIME_KEYS = ['continuousDetection', 'detectionInterval', 'lostTimeout', 'logLevel'];

/**
 * The value of a runtime key, as the tracker expects it.
 *
 * @param {string} key One of {@link RUNTIME_KEYS}.
 * @param {*} value The attribute's value.
 * @returns {*}
 */
function toTrackerValue(key, value) {
    return key === 'logLevel' ? toARLogLevel(value) : value;
}

/**
 * Build the config for `createNFTTracker()`.
 *
 * @param {object} data The `arnft` system's data.
 * @param {{width: number, height: number}} size Processing frame size.
 * @param {string} cameraParam Resolved camera parameter url.
 * @returns {import('@webarkit/jsartoolkit-nft').NFTTrackerConfig}
 */
export function trackerConfig(data, size, cameraParam) {
    const config = { width: size.width, height: size.height, cameraParam };
    for (const key of RUNTIME_KEYS) {
        config[key] = toTrackerValue(key, data[key]);
    }
    return config;
}

/**
 * The patch for `tracker.configure()` after the attributes changed.
 *
 * @param {object} oldData Previous `arnft` data.
 * @param {object} data Current `arnft` data.
 * @returns {import('@webarkit/jsartoolkit-nft').NFTTrackerPatch|null} Only the
 *     runtime keys that changed, or `null` when there are none.
 */
export function runtimePatch(oldData, data) {
    const patch = {};
    for (const key of RUNTIME_KEYS) {
        if (data[key] !== oldData[key]) {
            patch[key] = toTrackerValue(key, data[key]);
        }
    }
    return Object.keys(patch).length > 0 ? patch : null;
}

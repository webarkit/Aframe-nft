/**
 * Hands the markers registered by `<a-nft>` components to the jsartoolkitNFT
 * tracker.
 *
 * `addNFTTargets()` can be called at any time and as often as needed: ids stay
 * stable for the tracker's lifetime, and a failure stays local to its source.
 * One call per marker means a slow target does not delay the others, because a
 * call only answers once all of its sources have loaded.
 *
 * Kept free of A-Frame / THREE / DOM so it can be unit-tested with a fake
 * tracker.
 *
 * @module markerLoader
 */

/** @typedef {import('./markerRegistry').MarkerRegistry} MarkerRegistry */
/** @typedef {import('./markerRegistry').MarkerRecord} MarkerRecord */
/** @typedef {import('./markerRegistry').NFTData} NFTData */
/** @typedef {import('@webarkit/jsartoolkit-nft').NFTTracker} NFTTracker */

/**
 * How long a load may go unanswered before a warning. Failures report on their
 * own, so this only concerns a server that accepts the request and never answers.
 * It warns rather than fails: the tracker has no per-target signal, so the load
 * cannot be cancelled and may still finish, on a slow phone for example.
 */
const SLOW_LOAD_MS = 30000;

/**
 * Request every registered marker that is not loaded or loading yet, one
 * `addNFTTargets()` call per marker.
 *
 * @param {NFTTracker} tracker The tracker.
 * @param {MarkerRegistry} registry Source of the markers to load; updated as loads finish.
 * @param {object} handlers
 * @param {function(MarkerRecord, NFTData): void} handlers.onLoaded Called when a
 *     marker has loaded, with the target's size.
 * @param {function(MarkerRecord, string): void} handlers.onFailed Called once per failed
 *     marker, with the reason: `<reason>: <message>` from the tracker.
 * @param {function(*): void} handlers.onTrackerFailed Called when the tracker itself
 *     failed, for example a Worker that died. `addNFTTargets()` reports a failed load
 *     in its result, so a rejected call is never about one target.
 */
export function loadPendingMarkers(tracker, registry, { onLoaded, onFailed, onTrackerFailed }) {
    for (const marker of registry.unloaded()) {
        loadMarker(tracker, registry, marker, onLoaded, onFailed, onTrackerFailed);
    }
}

/**
 * Load a single marker and route the outcome to the registry and handlers.
 *
 * @param {NFTTracker} tracker
 * @param {MarkerRegistry} registry
 * @param {MarkerRecord} marker
 * @param {function(MarkerRecord, NFTData): void} onLoaded
 * @param {function(MarkerRecord, string): void} onFailed
 * @param {function(*): void} onTrackerFailed
 * @private
 */
function loadMarker(tracker, registry, marker, onLoaded, onFailed, onTrackerFailed) {
    registry.markLoading(marker);

    // After resetLoadState the tracker behind this load is gone, and the marker may
    // already be loading again on the next one: this load has nothing left to say.
    const generation = registry.generation;
    const isStale = () => registry.generation !== generation;

    const fail = (reason) => {
        if (isStale()) {
            return;
        }
        registry.markLoadFailed(marker);
        // No message for an <a-nft> that is already gone.
        if (registry.has(marker)) {
            onFailed(marker, reason);
        }
    };

    const onRejected = (err) => {
        if (isStale()) {
            return;
        }
        registry.markLoadFailed(marker);
        onTrackerFailed(err);
    };

    const onResult = ([load]) => {
        if (isStale()) {
            return;
        }
        if (load.status !== 'loaded') {
            fail(`${load.reason}: ${load.message}`);
            return;
        }
        const { id, widthPx, heightPx, dpi } = load.info;
        const data = { width: widthPx, height: heightPx, dpi };
        // null when the <a-nft> was removed while loading: the registry keeps
        // the target for reuse, and there is no component left to notify.
        if (registry.setLoaded(marker, id, data)) {
            onLoaded(marker, data);
        }
    };

    const slowLoad = setTimeout(() => {
        if (!isStale() && registry.has(marker)) {
            console.warn(
                `arnft: NFT marker "${marker.name}" (${marker.url}) has not loaded after ` +
                    `${SLOW_LOAD_MS / 1000} s; still waiting for the server`,
            );
        }
    }, SLOW_LOAD_MS);

    // onRejected only sees a call that failed. A throw from onLoaded is a separate
    // problem: the target did load and is tracked.
    tracker
        .addNFTTargets([marker.url], { origin: 'corner' })
        .then(onResult, onRejected)
        .catch((err) => console.error(`arnft: NFT marker "${marker.name}" loaded, but its <a-nft> could not use it`, err))
        .finally(() => clearTimeout(slowLoad));
}

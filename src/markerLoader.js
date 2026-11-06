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
 * Request every registered marker that is not loaded or loading yet, one
 * `addNFTTargets()` call per marker.
 *
 * @param {NFTTracker} tracker The tracker.
 * @param {MarkerRegistry} registry Source of the markers to load; updated as loads finish.
 * @param {object} handlers
 * @param {function(MarkerRecord, NFTData): void} handlers.onLoaded Called when a
 *     marker has loaded, with the target's size.
 * @param {function(MarkerRecord, *): void} handlers.onFailed Called once per failed
 *     marker, with the reason: `<reason>: <message>` from the tracker, or an Error.
 */
export function loadPendingMarkers(tracker, registry, { onLoaded, onFailed }) {
    for (const marker of registry.unloaded()) {
        loadMarker(tracker, registry, marker, onLoaded, onFailed);
    }
}

/**
 * Load a single marker and route the outcome to the registry and handlers.
 *
 * @param {NFTTracker} tracker
 * @param {MarkerRegistry} registry
 * @param {MarkerRecord} marker
 * @param {function(MarkerRecord, NFTData): void} onLoaded
 * @param {function(MarkerRecord, *): void} onFailed
 * @private
 */
function loadMarker(tracker, registry, marker, onLoaded, onFailed) {
    registry.markLoading(marker);

    const fail = (reason) => {
        registry.markLoadFailed(marker);
        onFailed(marker, reason);
    };

    tracker
        .addNFTTargets([marker.url], { origin: 'corner' })
        .then(([load]) => {
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
        })
        .catch(fail);
}

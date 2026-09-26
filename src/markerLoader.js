/**
 * Hands the markers registered by `<a-nft>` components to the jsartoolkitNFT
 * controller.
 *
 * Since jsartoolkitNFT 1.13.0, `loadNFTMarker()` can be called at any time and
 * as often as needed: ids continue across calls, and markers loaded earlier
 * stay loaded and detectable (webarkit/jsartoolkitNFT#612, fixed in #666).
 * Loading one marker per call means a bad url fails only its own `<a-nft>`; in
 * a single batch it would fail every marker in the scene.
 *
 * Kept free of A-Frame / THREE / DOM so it can be unit-tested with a fake
 * controller.
 *
 * @module markerLoader
 */

/** @typedef {import('./markerRegistry').MarkerRegistry} MarkerRegistry */
/** @typedef {import('./markerRegistry').MarkerRecord} MarkerRecord */
/** @typedef {import('./markerRegistry').NFTData} NFTData */
/** @typedef {import('@webarkit/jsartoolkit-nft').ARControllerNFT} ARControllerNFT */

/** jsartoolkitNFT holds at most this many markers in total (its `PAGES_MAX`). */
export const MAX_MARKERS = 20;

/**
 * Request every registered marker that is not loaded or loading yet, one
 * `loadNFTMarker()` call per marker.
 *
 * @param {ARControllerNFT} ar The tracker.
 * @param {MarkerRegistry} registry Source of the markers to load; updated as loads finish.
 * @param {object} handlers
 * @param {function(MarkerRecord, NFTData): void} handlers.onLoaded Called when a
 *     marker has loaded, with the target's size.
 * @param {function(MarkerRecord, *): void} handlers.onFailed Called at most once
 *     per marker, with the reason: an HTTP status, an Error or a message.
 */
export function loadPendingMarkers(ar, registry, { onLoaded, onFailed }) {
    for (const marker of registry.unloaded()) {
        loadMarker(ar, registry, marker, onLoaded, onFailed);
    }
}

/**
 * Load a single marker and route the outcome to the registry and handlers.
 *
 * @param {ARControllerNFT} ar
 * @param {MarkerRegistry} registry
 * @param {MarkerRecord} marker
 * @param {function(MarkerRecord, NFTData): void} onLoaded
 * @param {function(MarkerRecord, *): void} onFailed
 * @private
 */
function loadMarker(ar, registry, marker, onLoaded, onFailed) {
    registry.markLoading(marker);

    // Upstream calls onError once per descriptor file that fails (.fset,
    // .iset, .fset3), so a missing marker can report up to three times.
    const fail = (reason) => {
        if (marker.failed) {
            return;
        }
        registry.markLoadFailed(marker);
        onFailed(marker, reason);
    };

    const onSuccess = (id) => {
        // Past the tracker's limit the load is refused by calling back with
        // no id, not through onError.
        if (!Number.isInteger(id) || id < 0) {
            fail(`the tracker returned no id — it holds at most ${MAX_MARKERS} markers`);
            return;
        }
        ar.trackNFTMarkerId(id);
        // null when the <a-nft> was removed while loading: the registry keeps
        // the id for reuse, and there is no component left to notify.
        if (registry.setId(marker, id)) {
            onLoaded(marker, ar.getNFTData(id));
        }
    };

    // loadNFTMarker is async, so anything it throws arrives as a rejection.
    Promise.resolve(ar.loadNFTMarker(marker.url, onSuccess, fail)).catch(fail);
}

// Hands the markers registered by <a-nft> components to the jsartoolkitNFT
// controller.
//
// Since jsartoolkitNFT 1.13.0, loadNFTMarker() can be called at any time and
// as often as needed: ids continue across calls and markers loaded earlier
// stay loaded and detectable (webarkit/jsartoolkitNFT#612, fixed in #666).
// Loading one marker per call means a bad url fails only its own <a-nft>; in
// a single batch it would fail every marker in the scene.
//
// Kept free of A-Frame / THREE / DOM so it can be unit-tested with a fake
// controller.

// jsartoolkitNFT holds at most this many markers in total (PAGES_MAX).
export const MAX_MARKERS = 20;

// Request every registered marker that is not loaded or loading yet.
// `onLoaded(marker, data)` receives the marker's real-world size
// ({ width, height, dpi }); `onFailed(marker, reason)` is called at most once
// per marker.
export function loadPendingMarkers(ar, registry, { onLoaded, onFailed }) {
    for (const marker of registry.unloaded()) {
        loadMarker(ar, registry, marker, onLoaded, onFailed);
    }
}

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

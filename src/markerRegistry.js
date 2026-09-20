// Bookkeeping for the NFT markers registered by <a-nft> components.
//
// Holds two pieces of state the `arnft` system needs and that are easy to get
// subtly wrong:
//
//   1. Load state — a marker may be registered before the tracker exists (the
//      common case) or after it is already running (a dynamically added
//      <a-nft>). Both must end up loaded exactly once.
//   2. Visibility — jsartoolkitNFT's `lostNFTMarker` only tracks one marker at
//      a time (webarkit/jsartoolkitNFT#611), so with several targets a marker
//      that leaves the frame may never emit a lost event. Instead we stamp each
//      marker when a pose arrives and treat it as gone once it goes stale.
//
// Kept free of A-Frame / THREE / DOM so it can be unit-tested in isolation.

export class MarkerRegistry {
    constructor() {
        this.markers = [];
        this._byId = new Map();
    }

    // `marker` is { name, url, component }. Returns the stored record.
    add(marker) {
        marker.id = null;
        marker.loading = false;
        marker.failed = false;
        marker.lastSeen = 0;
        marker.visible = false;
        this.markers.push(marker);
        return marker;
    }

    // Markers that still need to be handed to the tracker.
    unloaded() {
        return this.markers.filter((m) => m.id === null && !m.loading && !m.failed);
    }

    markLoading(marker) {
        marker.loading = true;
    }

    // Load failure is TERMINAL — the marker is not retried.
    //
    // Retrying would mean a second loadNFTMarkers() call, and upstream
    // addNFTMarkers is single-call: a second invocation returns duplicate ids,
    // overwrites surfaceSet[0..] and replaces the KPM reference set
    // (webarkit/jsartoolkitNFT#612). A failed load may also have partially
    // registered datasets natively, so retrying could compound the damage.
    // Recovering properly needs a fresh controller, not another load.
    markLoadFailed(marker) {
        marker.loading = false;
        marker.failed = true;
    }

    // Called once the tracker has assigned this marker an id.
    setId(marker, id) {
        marker.id = id;
        marker.loading = false;
        this._byId.set(id, marker);
        return marker;
    }

    get(id) {
        return this._byId.get(id) || null;
    }

    // A pose arrived for `id`: stamp it and mark it visible. Returns the marker,
    // or null when the id isn't one of ours.
    markSeen(id, now) {
        const marker = this._byId.get(id);
        if (!marker) {
            return null;
        }
        marker.lastSeen = now;
        marker.visible = true;
        return marker;
    }

    // Markers that were visible but haven't been seen within `timeout` ms. They
    // are flipped to hidden here, so each one is reported exactly once.
    collectStale(now, timeout) {
        const stale = [];
        for (const marker of this.markers) {
            if (marker.visible && now - marker.lastSeen > timeout) {
                marker.visible = false;
                stale.push(marker);
            }
        }
        return stale;
    }
}

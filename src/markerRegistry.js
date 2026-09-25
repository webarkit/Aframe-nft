// Bookkeeping for the NFT markers registered by <a-nft> components.
//
// Holds the state the `arnft` system needs and that is easy to get subtly
// wrong:
//
//   1. Load state — a marker may be registered before the tracker exists (the
//      common case) or after it is already running (a dynamically added
//      <a-nft>). Both must end up loaded exactly once.
//   2. Visibility — each marker is stamped when a pose arrives and treated as
//      gone once it goes stale, rather than relying on jsartoolkitNFT's
//      `lostNFTMarker` (single-marker before 1.13.0,
//      webarkit/jsartoolkitNFT#611, and with a fixed 200 ms timeout since).
//   3. Removal — jsartoolkitNFT cannot unload a marker and holds at most 20,
//      so when an <a-nft> goes away its tracker id is parked by url and handed
//      to the next <a-nft> added with the same url, instead of loading the
//      target again.
//
// Kept free of A-Frame / THREE / DOM so it can be unit-tested in isolation.

export class MarkerRegistry {
    constructor() {
        this.markers = [];
        this._byId = new Map();
        // url -> tracker ids left loaded by removed markers, oldest first.
        this._parked = new Map();
    }

    // `marker` is { name, url, component }. Returns the stored record. If a
    // removed marker left a loaded dataset for the same url, the record reuses
    // its id and comes back already loaded (`id !== null`).
    add(marker) {
        marker.id = null;
        marker.loading = false;
        marker.failed = false;
        marker.lastSeen = 0;
        marker.visible = false;
        this.markers.push(marker);

        const parked = this._parked.get(marker.url);
        if (parked) {
            this.setId(marker, parked.shift());
            if (parked.length === 0) {
                this._parked.delete(marker.url);
            }
        }
        return marker;
    }

    has(marker) {
        return this.markers.includes(marker);
    }

    // The <a-nft> went away: its poses are no longer routed and it is never
    // reported stale. If it was loaded, its id is parked for reuse by url.
    remove(marker) {
        const index = this.markers.indexOf(marker);
        if (index === -1) {
            return;
        }
        this.markers.splice(index, 1);
        marker.visible = false;
        if (marker.id !== null) {
            this._byId.delete(marker.id);
            this._park(marker.url, marker.id);
        }
    }

    // Markers that still need to be handed to the tracker.
    unloaded() {
        return this.markers.filter((m) => m.id === null && !m.loading && !m.failed);
    }

    markLoading(marker) {
        marker.loading = true;
    }

    // Load failure is TERMINAL for this record — retrying the same url would
    // only fail again. Re-adding the <a-nft> registers a fresh record.
    markLoadFailed(marker) {
        marker.loading = false;
        marker.failed = true;
    }

    // Called once the tracker has assigned this marker an id. Returns the
    // record, or null when the marker was removed while it was loading — the
    // id is then parked so a re-added <a-nft> with the same url reuses it.
    setId(marker, id) {
        marker.loading = false;
        if (!this.has(marker)) {
            this._park(marker.url, id);
            return null;
        }
        marker.id = id;
        this._byId.set(id, marker);
        return marker;
    }

    _park(url, id) {
        const ids = this._parked.get(url) || [];
        ids.push(id);
        this._parked.set(url, ids);
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

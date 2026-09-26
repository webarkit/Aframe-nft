/**
 * Bookkeeping for the NFT markers registered by `<a-nft>` components.
 *
 * Holds the state the `arnft` system needs and that is easy to get subtly
 * wrong:
 *
 * 1. **Load state.** A marker may be registered before the tracker exists (the
 *    common case) or after it is already running (a dynamically added
 *    `<a-nft>`). Both must end up loaded exactly once.
 * 2. **Visibility.** Each marker is stamped when a pose arrives and treated as
 *    gone once it goes stale. jsartoolkitNFT's `lostNFTMarker` event is not
 *    used: it was single-marker before 1.13.0 (webarkit/jsartoolkitNFT#611),
 *    and its timeout is fixed at 200 ms since.
 * 3. **Removal.** jsartoolkitNFT cannot unload a marker and holds at most 20.
 *    When an `<a-nft>` goes away, its tracker id is parked by url and handed to
 *    the next `<a-nft>` added with the same url, instead of loading the target
 *    again.
 *
 * Kept free of A-Frame / THREE / DOM so it can be unit-tested in isolation.
 *
 * @module markerRegistry
 */

/**
 * The component side of a marker: the `nft-anchor` methods the system calls.
 *
 * @typedef {object} MarkerComponent
 * @property {function(NFTData): void} onData Receives the target's size once it has loaded.
 * @property {function(ArrayLike<number>): void} onPose Receives each new pose (`matrixGL_RH`).
 * @property {function(): void} onLost Called once when the target goes out of view.
 */

/**
 * Real-world size data of a loaded target, from `ARControllerNFT.getNFTData()`.
 *
 * @typedef {object} NFTData
 * @property {number} width Width in image pixels.
 * @property {number} height Height in image pixels.
 * @property {number} dpi Image resolution in dots per inch.
 */

/**
 * A registered marker. {@link MarkerRegistry#add} fills in the state fields.
 *
 * @typedef {object} MarkerRecord
 * @property {string} name Label from `<a-nft name>`, used in messages.
 * @property {string} url Descriptor-set url, resolved and without extension.
 * @property {MarkerComponent} component The owning `nft-anchor` component.
 * @property {number|null} id Tracker id once loaded, else `null`.
 * @property {boolean} loading A load request is in flight.
 * @property {boolean} failed The load failed. The record is not retried.
 * @property {number} lastSeen Time (ms, `performance.now()`) of the last pose.
 * @property {boolean} visible Whether the target is currently considered in view.
 */

export class MarkerRegistry {
    constructor() {
        /** @type {MarkerRecord[]} Registered markers, in registration order. */
        this.markers = [];
        /** @type {Map<number, MarkerRecord>} */
        this._byId = new Map();
        /** @type {Map<string, number[]>} url -> tracker ids left loaded by removed markers, oldest first. */
        this._parked = new Map();
    }

    /**
     * Register a marker. If a removed marker left a loaded target for the same
     * url, the record reuses its id and comes back already loaded.
     *
     * @param {{name: string, url: string, component: MarkerComponent}} marker
     *     Mutated into, and returned as, the stored record.
     * @returns {MarkerRecord} The record; `id !== null` means it is already loaded.
     */
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

    /**
     * @param {MarkerRecord} marker
     * @returns {boolean} Whether the record is still registered.
     */
    has(marker) {
        return this.markers.includes(marker);
    }

    /**
     * Unregister a marker: its poses are no longer routed and it is never
     * reported stale. If it was loaded, its id is parked for reuse by url.
     * Unknown records are ignored.
     *
     * @param {MarkerRecord} marker
     */
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

    /**
     * @returns {MarkerRecord[]} Markers that still need to be handed to the
     *     tracker: not loaded, not loading and not failed.
     */
    unloaded() {
        return this.markers.filter((m) => m.id === null && !m.loading && !m.failed);
    }

    /** @param {MarkerRecord} marker */
    markLoading(marker) {
        marker.loading = true;
    }

    /**
     * Mark a load as failed. This is TERMINAL for the record: retrying the same
     * url would only fail again. Re-adding the `<a-nft>` registers a fresh record.
     *
     * @param {MarkerRecord} marker
     */
    markLoadFailed(marker) {
        marker.loading = false;
        marker.failed = true;
    }

    /**
     * Record the tracker id assigned to a marker. If the marker was removed
     * while it was loading, the id is parked instead, so a re-added `<a-nft>`
     * with the same url reuses it.
     *
     * @param {MarkerRecord} marker
     * @param {number} id
     * @returns {MarkerRecord|null} The record, or `null` if it was removed.
     */
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

    /**
     * @param {string} url
     * @param {number} id
     * @private
     */
    _park(url, id) {
        const ids = this._parked.get(url) || [];
        ids.push(id);
        this._parked.set(url, ids);
    }

    /**
     * @param {number} id Tracker id.
     * @returns {MarkerRecord|null}
     */
    get(id) {
        return this._byId.get(id) || null;
    }

    /**
     * A pose arrived for `id`: stamp it and mark it visible.
     *
     * @param {number} id Tracker id from the `getNFTMarker` event.
     * @param {number} now Current time in ms.
     * @returns {MarkerRecord|null} The marker, or `null` when the id is not one of ours.
     */
    markSeen(id, now) {
        const marker = this._byId.get(id);
        if (!marker) {
            return null;
        }
        marker.lastSeen = now;
        marker.visible = true;
        return marker;
    }

    /**
     * Markers that were visible but have not been seen within `timeout` ms.
     * They are flipped to hidden here, so each one is reported exactly once.
     *
     * @param {number} now Current time in ms.
     * @param {number} timeout Time in ms after which an unseen marker counts as lost.
     * @returns {MarkerRecord[]}
     */
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

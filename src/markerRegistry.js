/**
 * Bookkeeping for the NFT markers registered by `<a-nft>` components.
 *
 * Holds the state the `arnft` system needs and that is easy to get subtly
 * wrong:
 *
 * 1. **Load state.** A marker may be registered before the tracker exists (the
 *    common case) or after it is already running (a dynamically added
 *    `<a-nft>`). Both must end up loaded exactly once.
 * 2. **Removal.** jsartoolkitNFT cannot unload a marker and holds at most 20.
 *    When an `<a-nft>` goes away, its tracker id is parked by url, with the
 *    target's size, and handed to the next `<a-nft>` added with the same url,
 *    instead of loading the target again. The size is kept because the tracker
 *    has no `getNFTData()`.
 *
 * Which targets are in view is the tracker's job: its `process()` results carry
 * debounced `lost` transitions (see `frames.js`).
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
 * @property {function(ArrayLike<number>, number): void} onPose Receives each new pose and its frame time (ms).
 * @property {function(): void} onLost Called once when the target goes out of view.
 */

/**
 * Real-world size data of a loaded target, mapped from the tracker's `TargetInfo`.
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
 * @property {NFTData|null} data The target's size once loaded, else `null`.
 * @property {boolean} loading A load request is in flight.
 * @property {boolean} failed The load failed. The record is not retried.
 */

export class MarkerRegistry {
    constructor() {
        /** @type {MarkerRecord[]} Registered markers, in registration order. */
        this.markers = [];
        /** @type {Map<number, MarkerRecord>} */
        this._byId = new Map();
        /**
         * Targets left loaded by removed markers, oldest first.
         * @type {Map<string, {id: number, data: NFTData}[]>}
         */
        this._parked = new Map();
        /**
         * Bumped when the load state starts over for a new tracker. A load that
         * started under an earlier generation has nothing left to report.
         * @type {number}
         */
        this.generation = 0;
    }

    /**
     * @returns {boolean} Whether any registered marker has a target to track.
     */
    hasLoaded() {
        return this.markers.some((m) => m.id !== null);
    }

    /**
     * Start the load state over, for a new tracker: ids belong to one tracker, and on
     * the next one they would mean other targets. Every registered marker is offered
     * for loading again, including one whose load had failed.
     */
    resetLoadState() {
        this.generation++;
        this._byId.clear();
        this._parked.clear();
        for (const marker of this.markers) {
            marker.id = null;
            marker.data = null;
            marker.loading = false;
            marker.failed = false;
        }
    }

    /**
     * Register a marker. If a removed marker left a loaded target for the same
     * url, the record reuses it and comes back already loaded.
     *
     * @param {{name: string, url: string, component: MarkerComponent}} marker
     *     Mutated into, and returned as, the stored record.
     * @returns {MarkerRecord} The record; `id !== null` means it is already loaded.
     */
    add(marker) {
        marker.id = null;
        marker.data = null;
        marker.loading = false;
        marker.failed = false;
        this.markers.push(marker);

        const parked = this._parked.get(marker.url);
        if (parked) {
            const { id, data } = parked.shift();
            this.setLoaded(marker, id, data);
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
     * Unregister a marker: its poses are no longer routed. If it was loaded, its
     * target is parked for reuse by url. Unknown records are ignored.
     *
     * @param {MarkerRecord} marker
     */
    remove(marker) {
        const index = this.markers.indexOf(marker);
        if (index === -1) {
            return;
        }
        this.markers.splice(index, 1);
        if (marker.id !== null) {
            this._byId.delete(marker.id);
            this._park(marker.url, marker.id, marker.data);
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
     * Record the loaded target of a marker. If the marker was removed while it
     * was loading, the target is parked instead, so a re-added `<a-nft>` with the
     * same url reuses it.
     *
     * @param {MarkerRecord} marker
     * @param {number} id Tracker id.
     * @param {NFTData} data The target's size.
     * @returns {MarkerRecord|null} The record, or `null` if it was removed.
     */
    setLoaded(marker, id, data) {
        marker.loading = false;
        if (!this.has(marker)) {
            this._park(marker.url, id, data);
            return null;
        }
        marker.id = id;
        marker.data = data;
        this._byId.set(id, marker);
        return marker;
    }

    /**
     * @param {string} url
     * @param {number} id
     * @param {NFTData} data
     * @private
     */
    _park(url, id, data) {
        const targets = this._parked.get(url) || [];
        targets.push({ id, data });
        this._parked.set(url, targets);
    }

    /**
     * @param {number} id Tracker id.
     * @returns {MarkerRecord|null}
     */
    get(id) {
        return this._byId.get(id) || null;
    }
}

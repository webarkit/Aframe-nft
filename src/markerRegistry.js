/**
 * Bookkeeping for the NFT markers registered by `<a-nft>` components.
 *
 * Holds the state the `arnft` system needs and that is easy to get subtly
 * wrong:
 *
 * 1. **Load state.** A marker may be registered before the tracker exists (the
 *    common case) or after it is already running (a dynamically added
 *    `<a-nft>`). Both must end up loaded.
 * 2. **One target per url.** jsartoolkitNFT cannot unload a marker and holds at
 *    most 20. Each descriptor url is loaded at most once per tracker: several
 *    `<a-nft>` with the same url, or an `<a-nft>` removed and added again
 *    (even while its load is still in flight), share that one loaded target
 *    and its size (webarkit/Aframe-nft#11). The size is kept because the
 *    tracker has no `getNFTData()`.
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
 * @property {boolean} loading A load request is in flight for this record's url.
 * @property {boolean} failed The load failed. The record is not retried.
 */

export class MarkerRegistry {
    constructor() {
        /** @type {MarkerRecord[]} Registered markers, in registration order. */
        this.markers = [];
        /**
         * Live records for each loaded tracker id.
         * @type {Map<number, Set<MarkerRecord>>}
         */
        this._byId = new Map();
        /**
         * Targets loaded on the current tracker, kept for its lifetime so any
         * `<a-nft>` with the same url reuses the target instead of loading a copy.
         * @type {Map<string, {id: number, data: NFTData}>}
         */
        this._targets = new Map();
        /**
         * Urls currently being loaded, with the live records waiting on each.
         * An entry stays until the load settles even if all waiting records are
         * removed, so a record added in the meantime joins the in-flight load.
         * @type {Map<string, Set<MarkerRecord>>}
         */
        this._inFlight = new Map();
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
        this._targets.clear();
        this._inFlight.clear();
        for (const marker of this.markers) {
            marker.id = null;
            marker.data = null;
            marker.loading = false;
            marker.failed = false;
        }
    }

    /**
     * Register a marker. If its url is already loaded on the current tracker,
     * the record adopts that target and comes back already loaded; if a load for
     * its url is in flight, it joins that load.
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

        const target = this._targets.get(marker.url);
        if (target) {
            this._attach(marker, target.id, target.data);
            return marker;
        }
        const waiting = this._inFlight.get(marker.url);
        if (waiting) {
            marker.loading = true;
            waiting.add(marker);
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
     * Unregister a marker: its poses are no longer routed. The loaded target in
     * `_targets` (or an in-flight load in `_inFlight`) stays for other or future
     * `<a-nft>` with the same url. Unknown records are ignored.
     *
     * @param {MarkerRecord} marker
     */
    remove(marker) {
        const index = this.markers.indexOf(marker);
        if (index === -1) {
            return;
        }
        this.markers.splice(index, 1);
        this._inFlight.get(marker.url)?.delete(marker);
        if (marker.id !== null) {
            const set = this._byId.get(marker.id);
            if (set) {
                set.delete(marker);
                if (set.size === 0) {
                    this._byId.delete(marker.id);
                }
            }
        }
    }

    /**
     * @returns {MarkerRecord[]} Markers that still need to be handed to the
     *     tracker: not loaded, not loading and not failed.
     */
    unloaded() {
        return this.markers.filter((m) => m.id === null && !m.loading && !m.failed);
    }

    /**
     * Mark a record as loading its url. If another record already started a load
     * for the same url, this record joins it and `false` is returned so the
     * caller does not start a second tracker load.
     *
     * @param {MarkerRecord} marker
     * @returns {boolean} `true` when the caller must start the load for `marker.url`.
     */
    markLoading(marker) {
        marker.loading = true;
        let waiting = this._inFlight.get(marker.url);
        if (waiting) {
            waiting.add(marker);
            return false;
        }
        waiting = new Set([marker]);
        this._inFlight.set(marker.url, waiting);
        return true;
    }

    /**
     * Mark the in-flight load for `url` as failed. This is TERMINAL for the
     * records that were waiting on it: retrying the same url would only fail
     * again. Re-adding an `<a-nft>` registers a fresh record, and `_inFlight`
     * has been cleared so it will try anew.
     *
     * @param {string} url
     * @returns {MarkerRecord[]} Live records that were waiting on `url`.
     */
    failLoad(url) {
        const waiting = this._inFlight.get(url);
        this._inFlight.delete(url);
        if (!waiting) {
            return [];
        }
        const failed = [];
        for (const marker of waiting) {
            marker.loading = false;
            marker.failed = true;
            if (this.has(marker)) {
                failed.push(marker);
            }
        }
        return failed;
    }

    /**
     * Record the loaded target for `url`. The target is kept in `_targets` even
     * if every waiting `<a-nft>` was removed while it was loading, so a later
     * `<a-nft>` with the same url reuses it.
     *
     * @param {string} url
     * @param {number} id Tracker id.
     * @param {NFTData} data The target's size.
     * @returns {MarkerRecord[]} Live records that were waiting on `url`.
     */
    finishLoad(url, id, data) {
        this._targets.set(url, { id, data });
        const waiting = this._inFlight.get(url);
        this._inFlight.delete(url);
        if (!waiting) {
            return [];
        }
        const loaded = [];
        for (const marker of waiting) {
            marker.loading = false;
            if (this.has(marker)) {
                this._attach(marker, id, data);
                loaded.push(marker);
            }
        }
        return loaded;
    }

    /**
     * @param {MarkerRecord} marker
     * @param {number} id
     * @param {NFTData} data
     * @private
     */
    _attach(marker, id, data) {
        marker.id = id;
        marker.data = data;
        let set = this._byId.get(id);
        if (!set) {
            set = new Set();
            this._byId.set(id, set);
        }
        set.add(marker);
    }

    /**
     * @param {number} id Tracker id.
     * @returns {MarkerRecord[]} Live records tracking `id`.
     */
    recordsFor(id) {
        const set = this._byId.get(id);
        return set ? Array.from(set) : [];
    }
}

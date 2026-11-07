/**
 * A-Frame glue. Registers:
 *
 * - the **`arnft` system**, one per scene: it owns the camera, the single
 *   jsartoolkitNFT tracker and the per-frame detection loop;
 * - the **`nft-anchor` component**: each instance registers one target with the
 *   system, receives its pose callbacks (`onData`, `onPose`, `onLost`) and turns
 *   them into the entity's transform;
 * - the **`<a-nft>` primitive**: an entity with `nft-anchor`, mapping
 *   `url` and `name` onto it.
 *
 * Logic that can be tested without A-Frame lives in the imported modules. This
 * file is verified with the examples on a real camera, plus the removal test in
 * `test/nftAnchor.test.js`.
 *
 * @module registerNFT
 */
import 'aframe';
import { createNFTTracker, createNFTTrackerWorker } from '@webarkit/jsartoolkit-nft';
import { CameraView } from '@webarkit/camera-view';
import { withIdealSize } from './cameraConstraints';
import { computeCenterOffset, computeLiftZ, toMatrixElements } from './nftMath';
import { PoseFilter } from './poseFilter';
import { MarkerRegistry } from './markerRegistry';
import { loadPendingMarkers } from './markerLoader';
import { nextFrame, routeFrameResult } from './frames';
import { runtimePatch, trackerConfig } from './trackerSettings';
import { createTracker } from './trackerFactory';
import { DEFAULT_LOG_LEVEL, LOG_LEVEL_NAMES } from './logLevel';

/**
 * Resolve a marker or camera path against the HTML page, like any other asset
 * URL, so relative paths keep working under sub-path deployments. Absolute and
 * root-relative URLs pass through unchanged.
 *
 * @param {string} path
 * @returns {string} Absolute URL.
 */
function resolveUrl(path) {
    return new URL(path, document.baseURI).href;
}

/**
 * `arnft` system: set on `<a-scene>`. It owns the camera, the jsartoolkitNFT
 * tracker and the per-frame detection loop. Components register their target
 * with it and receive pose callbacks: the tracker runs once per scene, not
 * once per component.
 *
 * Page requirements:
 * - a `<video id="video">` element, which receives the camera feed;
 * - an `embedded` scene, so the canvas can be sized to match the video;
 * - a `[camera]` entity (or an `<a-camera>` with `look-controls` disabled) at the
 *   origin. The tracker's projection is applied to it.
 */
AFRAME.registerSystem('arnft', {
    schema: {
        // Requested capture size. These are ideals: the browser may pick another.
        videoWidth: { type: 'number', default: 640 },
        videoHeight: { type: 'number', default: 480 },
        // ARToolKit camera parameter file, resolved against the page.
        cameraParam: { type: 'string', default: 'Data/camera_para.dat' },
        // How long (ms) a marker may go without a pose before its mesh is hidden.
        // The tracker's own default.
        lostTimeout: { type: 'number', default: 200 },
        // Detection policy: while some markers are tracked and others are not,
        // look for the missing ones at most every `detectionInterval` ms (0 =
        // every frame). continuousDetection: false stops looking while anything
        // is tracked — cheapest, but a second target entering the view is not
        // found.
        continuousDetection: { type: 'boolean', default: true },
        detectionInterval: { type: 'number', default: 300 },
        // Verbosity of ARToolKit's console lines ("[info] Tracked page 0" and
        // the like, printed on every frame at info): debug, info, warn or
        // error. WebARKitLib's camera parameter table still prints at every
        // level (webarkit/WebARKitLib#113).
        logLevel: { type: 'string', default: DEFAULT_LOG_LEVEL, oneOf: LOG_LEVEL_NAMES },
        // Track in a Web Worker, falling back to the same thread if it cannot start.
        // Read when the tracker is created.
        worker: { type: 'boolean', default: false },
        // Folder of the Worker files, resolved against the page. Empty: next to the
        // bundle, which needs the bundle to load through a plain <script>.
        workerBase: { type: 'string', default: '' },
    },

    /**
     * Start the camera right away, preferring the rear camera and capturing at
     * most 60 fps. The tracker is created later, in `_maybeStart()`, once the
     * camera is live and at least one `<a-nft>` has registered.
     */
    init: function () {
        this.video = document.getElementById('video');
        this.view = new CameraView(this.video, {
            mediaDevices: withIdealSize(navigator.mediaDevices, {
                width: this.data.videoWidth,
                height: this.data.videoHeight,
            }),
        });
        this.tracker = null;
        this.videoReady = false;
        this.starting = false;
        // No tracker will start any more: tracking failed, or the scene was removed.
        this.stopped = false;
        // Bumped when a tracker is stopped, so that a start still in flight knows
        // it was overtaken.
        this._generation = 0;
        // Markers registered by <a-nft> components: load state and reusable ids.
        this.registry = new MarkerRegistry();

        this.view.addEventListener('geometrychange', (event) => this._onGeometryChange(event.detail));
        this.view.addEventListener('ended', () => this._onCameraEnded());
        this.view
            .initialize({ facingMode: 'environment', targetFrameRate: 60 })
            .then(() => {
                this.videoReady = true;
                this._maybeStart();
            })
            .catch((err) => this._onCameraError(err));

        // A-Frame never calls remove() on a system, so teardown hangs on a component:
        // a scene being removed runs the remove() of its own components.
        this.el.setAttribute('arnft-lifecycle', '');
        this._watchRemovalBeforeLoad();
    },

    /**
     * Cover the time before the scene has loaded, which can be seconds with
     * `<a-assets>`. A-Frame only initialises a scene's components once it has loaded,
     * and removing one that is not initialised waits for ever, so `arnft-lifecycle`
     * does not run and the camera, which starts right away, would stay on.
     *
     * @private
     */
    _watchRemovalBeforeLoad: function () {
        const observer = new MutationObserver(() => {
            if (!this.el.isConnected) {
                observer.disconnect();
                this._teardown();
            }
        });
        observer.observe(document, { childList: true, subtree: true });
        this.el.addEventListener('loaded', () => observer.disconnect(), { once: true });
    },

    /**
     * The camera could not start. A start cancelled by `_teardown()` is not a failure.
     *
     * @param {*} err The `getUserMedia` error or a `CameraViewError`.
     * @private
     */
    _onCameraError: function (err) {
        if (err && err.code === 'DESTROYED') {
            return;
        }
        console.error('arnft: camera init failed', err);
    },

    /**
     * The scene was removed: stop the camera and release the tracker. The system does
     * not come back, so re-attaching a removed scene is not supported.
     *
     * @private
     */
    _teardown: function () {
        this.stopped = true;
        this.videoReady = false;
        this._stopTracker();
        this.view.destroy();
    },

    /**
     * Apply the settings that can change while tracking runs. A-Frame also calls
     * this from the system's constructor, before any tracker exists: the initial
     * values then reach the tracker through `trackerConfig()`.
     *
     * `setAttribute('arnft', key, value)` does not work on a system: A-Frame drops
     * the value and turns `this.data` into the bare key, so the previous settings
     * are restored here. A-Frame rebuilds the data from what is passed, so with a
     * partial `'key: value'` string the other settings go back to their defaults.
     *
     * @param {object} oldData Previous property values.
     */
    update: function (oldData) {
        if (typeof this.data !== 'object') {
            console.warn(
                `arnft: setAttribute('arnft', key, value) is not supported; ` +
                    `use setAttribute('arnft', 'key: value') instead`,
            );
            this.data = oldData;
            return;
        }
        if (this.tracker) {
            this._applySettings(oldData);
        }
    },

    /**
     * Send the tracker whichever runtime settings differ from `oldData`.
     *
     * @param {object} oldData The settings the tracker has now.
     * @private
     */
    _applySettings: function (oldData) {
        const patch = runtimePatch(oldData, this.data);
        if (patch) {
            this.tracker
                .configure(patch)
                .catch((err) => console.error('arnft: could not apply the new settings', err));
        }
    },

    /**
     * Register a target. Called by `nft-anchor` components during their own
     * `init()`.
     *
     * Targets can be registered at any time: an `<a-nft>` added after tracking
     * has started is loaded on the spot.
     *
     * @param {{name: string, url: string, component: object}} marker `url` may
     *     be relative to the page; `component` is the calling `nft-anchor`.
     * @returns {import('./markerRegistry').MarkerRecord} The registry record,
     *     which the component hands back to `unregisterMarker()`.
     */
    registerMarker: function (marker) {
        const record = this.registry.add({
            name: marker.name,
            // Resolved here so the registry can recognise a re-added url.
            url: resolveUrl(marker.url),
            component: marker.component,
        });
        if (record.id !== null) {
            // A re-added <a-nft>: its target is still loaded in the tracker.
            record.component.onData(record.data);
        } else if (this.tracker) {
            this._loadPendingMarkers();
        } else {
            this._maybeStart();
        }
        return record;
    },

    /**
     * Unregister a target. Called by `nft-anchor` components when they are
     * removed. jsartoolkitNFT cannot unload a marker, so the target stays
     * loaded and is reused if an `<a-nft>` with the same url is added again.
     *
     * @param {import('./markerRegistry').MarkerRecord|null} record The record
     *     from `registerMarker()`. Unknown or `null` records are ignored.
     */
    unregisterMarker: function (record) {
        this.registry.remove(record);
    },

    /**
     * Create the tracker once the camera is live and at least one target is
     * registered. Safe to call repeatedly.
     *
     * @private
     */
    _maybeStart: function () {
        if (
            this.stopped ||
            this.starting ||
            this.tracker ||
            !this.videoReady ||
            this.registry.markers.length === 0
        ) {
            return;
        }
        this.starting = true;

        const { frameWidth, frameHeight } = this.view.geometry;
        this._frameSize = { width: frameWidth, height: frameHeight };
        const cameraParam = this._cameraParam || resolveUrl(this.data.cameraParam);
        const workerOptions = this._workerOptions || {
            worker: this.data.worker,
            workerBase: this.data.workerBase && resolveUrl(this.data.workerBase),
        };
        const startData = this.data;
        const generation = this._generation;
        createTracker(trackerConfig(startData, this._frameSize, cameraParam), workerOptions, {
            createNFTTracker,
            createNFTTrackerWorker,
        })
            .then((tracker) => {
                if (generation !== this._generation) {
                    tracker.dispose();
                    return;
                }
                // Kept once they have worked: a partial setAttribute('arnft', 'key: value')
                // returns these to their defaults, which a restart must not pick up.
                this._cameraParam = cameraParam;
                this._workerOptions = workerOptions;
                this._onTrackerReady(tracker, startData);
            })
            .catch((err) => {
                if (generation !== this._generation) {
                    return;
                }
                // Allow a later _maybeStart() to retry instead of blocking forever.
                this.starting = false;
                console.error('arnft: tracker init failed', err);
            });
    },

    /**
     * Stop the current tracker, or overtake a start still in flight. Every target
     * will have to load again on the next one.
     *
     * @private
     */
    _stopTracker: function () {
        const tracker = this.tracker;
        this._generation++;
        this.tracker = null;
        this.starting = false;
        this.registry.resetLoadState();
        if (tracker) {
            // Its dispose() lets a native teardown error reach the caller. Whatever
            // called this still has to finish: stop the camera, start a new tracker.
            try {
                tracker.dispose();
            } catch (err) {
                console.error('arnft: could not release the tracker', err);
            }
        }
    },

    /**
     * Replace the tracker, whose frame size is fixed when it is created.
     *
     * @private
     */
    _restartTracker: function () {
        this._hideAll();
        this._stopTracker();
        this._maybeStart();
    },

    /**
     * Hide the content of every target. The components hide their own mesh.
     *
     * @private
     */
    _hideAll: function () {
        for (const marker of this.registry.markers) {
            marker.component.onLost();
        }
    },

    /**
     * The video changed size, for example because a phone was rotated. With the same
     * frame size only the projection changes. A new frame size needs a new tracker,
     * because `camera_para` is scaled to it when the tracker is created.
     *
     * @param {import('@webarkit/camera-view').FrameGeometry} geometry
     * @private
     */
    _onGeometryChange: function (geometry) {
        // With no tracker and no start in flight, the next start reads the geometry.
        if (!this.tracker && !this.starting) {
            return;
        }
        const { width, height } = this._frameSize;
        if (geometry.frameWidth !== width || geometry.frameHeight !== height) {
            this._restartTracker();
        } else if (this.tracker) {
            this._setupCamera();
        }
    },

    /**
     * The camera stream ended: unplugged, or the permission was revoked. There are
     * no more frames, so hide the content instead of leaving it frozen, and release
     * the tracker. With `videoReady` false, no other one starts.
     *
     * @private
     */
    _onCameraEnded: function () {
        this.videoReady = false;
        this._hideAll();
        this._stopTracker();
        console.warn('arnft: the camera stream ended; tracking has stopped');
    },

    /**
     * The tracker failed while running. This stops tracking for good, instead of
     * repeating the same error on every frame of the render loop.
     *
     * @param {*} err
     * @private
     */
    _onTrackerFailure: function (err) {
        console.error('arnft: the tracker failed; tracking has stopped', err);
        this.stopped = true;
        this._hideAll();
        this._stopTracker();
    },

    /**
     * The tracker is ready: apply its projection, catch it up on any setting
     * changed while it was starting, and load the registered targets.
     *
     * @param {import('@webarkit/jsartoolkit-nft').NFTTracker} tracker
     * @param {object} [startData] The settings it was created with.
     * @private
     */
    _onTrackerReady: function (tracker, startData = this.data) {
        this.tracker = tracker;
        this._setupCamera();
        this._applySettings(startData);
        this._loadPendingMarkers();
    },

    /**
     * Hand every target that is not loaded yet to the tracker, one call per
     * target. Safe to call at any time; see `markerLoader.js`.
     *
     * @private
     */
    _loadPendingMarkers: function () {
        if (!this.tracker) {
            return;
        }
        loadPendingMarkers(this.tracker, this.registry, {
            onLoaded: (marker, data) => marker.component.onData(data),
            onFailed: (marker, reason) =>
                console.error(
                    `arnft: failed to load NFT marker "${marker.name}" (${marker.url}); ` +
                        'it will not be tracked',
                    reason,
                ),
        });
    },

    /**
     * Compute and store the tracker's projection matrix for the A-Frame camera.
     *
     * The tracker's own matrix targets the whole processing frame, where the video
     * is letterboxed. `projectionFor` undoes that from the frame geometry, giving
     * the projection at the video's true aspect. The viewport is given that same
     * aspect, so no further scaling applies.
     *
     * Alignment comes from sizing the render canvas to the same box as the video
     * (see `_resize`), the AR.js approach, so the overlay matches the video for any
     * `camera_para`.
     *
     * @private
     */
    _setupCamera: function () {
        const cameraEle =
            this.el.querySelector('a-camera') || this.el.querySelector('[camera]');
        if (!cameraEle) {
            console.warn('arnft: no camera entity found to apply projection');
            return;
        }
        const geometry = this.view.geometry;
        const viewport = { width: geometry.videoWidth, height: geometry.videoHeight };
        const proj = Array.from(this.tracker.projectionFor(viewport, geometry));

        // Re-assert both projection and sizing each frame (A-Frame's camera/render
        // systems recompute them on resize).
        this.arCamera = cameraEle.getObject3D('camera');
        this.projArray = proj;
        this._resize();
        this._applyProjection();
    },

    /**
     * Write the stored projection into the A-Frame camera. Called every frame,
     * because A-Frame recomputes the projection on resize.
     *
     * @private
     */
    _applyProjection: function () {
        const camera = this.arCamera;
        camera.projectionMatrix.fromArray(this.projArray);
        camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    },

    /**
     * Size the video AND the render canvas to the same "cover" box: the source
     * aspect, scaled to fill the window, with the overflow hidden by negative
     * margins. Both elements share the exact box and the renderer draws at that
     * box, so the raw projection maps 3D onto the same pixels as the video, with
     * no stretch and no shift.
     *
     * Mirrors AR.js `ArToolkitSource.onResizeElement` + `copyElementSizeTo`.
     * Runs every frame but only touches the DOM when the box changes.
     *
     * @private
     */
    _resize: function () {
        const video = this.video;
        const canvas = this.el.canvas;
        if (!video || !video.videoWidth || !canvas) {
            return;
        }
        const screenW = window.innerWidth;
        const screenH = window.innerHeight;
        const sourceAspect = video.videoWidth / video.videoHeight;
        const screenAspect = screenW / screenH;

        let boxW;
        let boxH;
        let marginLeft;
        let marginTop;
        if (screenAspect < sourceAspect) {
            // Taller/narrower window: fill height, overflow width.
            boxH = screenH;
            boxW = sourceAspect * screenH;
            marginLeft = -(boxW - screenW) / 2;
            marginTop = 0;
        } else {
            // Wider window: fill width, overflow height.
            boxW = screenW;
            boxH = screenW / sourceAspect;
            marginLeft = 0;
            marginTop = -(boxH - screenH) / 2;
        }

        // Skip the DOM/renderer work when the box hasn't changed (this runs every
        // frame). setSize reallocates the WebGL buffer, so only touch it on change.
        const last = this._lastBox;
        if (last && last.w === boxW && last.h === boxH && last.ml === marginLeft && last.mt === marginTop) {
            return;
        }
        this._lastBox = { w: boxW, h: boxH, ml: marginLeft, mt: marginTop };

        const apply = (el) => {
            el.style.position = 'absolute';
            el.style.top = '0';
            el.style.left = '0';
            el.style.width = boxW + 'px';
            el.style.height = boxH + 'px';
            el.style.marginLeft = marginLeft + 'px';
            el.style.marginTop = marginTop + 'px';
        };
        apply(video);
        apply(canvas);
        canvas.style.zIndex = '100';
        // Match the WebGL drawing buffer to the box (updateStyle=false so our
        // margins survive), else the rendered aspect would not match the canvas.
        this.el.renderer.setSize(boxW, boxH, false);
    },

    /**
     * Per frame: keep the layout and projection in sync, run one detection and
     * tracking pass on a new frame, and hand the poses and `lost` transitions to the
     * components. With no target to track, or no new frame, there is nothing to do:
     * a detection pass is the expensive step (webarkit/Aframe-nft#12).
     */
    tick: function () {
        if (!this.tracker || !this.videoReady) {
            return;
        }
        this._resize();
        this._applyProjection();
        if (!this.registry.hasLoaded()) {
            return;
        }
        let result;
        try {
            const frame = nextFrame(this.view);
            if (!frame) {
                return;
            }
            result = this.tracker.process(frame, performance.now());
        } catch (err) {
            this._onTrackerFailure(err);
            return;
        }
        routeFrameResult(this.registry, result);
    },
});

/**
 * `arnft-lifecycle` component: internal, added to the scene by the `arnft` system,
 * which has no removal hook of its own.
 */
AFRAME.registerComponent('arnft-lifecycle', {
    remove: function () {
        this.el.systems.arnft._teardown();
    },
});

/**
 * `nft-anchor` component: anchors its entity, and the content inside it, to one
 * NFT target. Usually used through the `<a-nft>` primitive.
 *
 * Each pose goes through the following steps:
 * 1. optional 1€ smoothing;
 * 2. the post-matrix: centring on the target (real size, DPI → mm), then the
 *    lift onto the plane, then `scaleFactor`;
 * 3. the result is written to the entity's matrix.
 *
 * The content stays hidden until the first pose, and is hidden again when the
 * target is lost or the component is removed. While the entity is paused, poses
 * are ignored and the content stays where it is.
 */
AFRAME.registerComponent('nft-anchor', {
    dependencies: ['arnft'],
    schema: {
        // Label for the target, used in console messages (`<a-nft name>`).
        entityName: { type: 'string', default: 'pinball' },
        // Descriptor-set path without extension (`<a-nft url>`), resolved
        // against the page. The default only suits the bundled example.
        markerUrl: { type: 'string', default: 'DataNFT/pinball' },
        // Uniform scale for the mesh geometry (pose units are millimetres, so a
        // bare 1-unit primitive is tiny). Does not affect the centering offset.
        scaleFactor: { type: 'number', default: 150 },
        // When true, the mesh is lifted so it rests ON the marker plane; when
        // false, its origin sits on the plane (no standing-mesh parallax lean).
        lift: { type: 'boolean', default: true },
        // Optional fine-alignment nudge in marker millimetres, added on top of the
        // (canonical) centering offset. Defaults to 0 — use it to compensate for
        // camera calibration (principal point) on a specific device.
        offsetX: { type: 'number', default: 0 },
        offsetY: { type: 'number', default: 0 },
        // Pose smoothing (1€ filter) to reduce tracking jitter. Lower minCutoff =
        // smoother but more lag; higher beta = less lag while moving. The cutoff is
        // shared. The betas are not, because they are per unit of the signal:
        // smoothBeta is for the translation (mm), smoothRotationBeta for the rotation
        // (radians).
        smooth: { type: 'boolean', default: true },
        smoothMinCutoff: { type: 'number', default: 0.0001 },
        smoothBeta: { type: 'number', default: 0.01 },
        smoothRotationBeta: { type: 'number', default: 2 },
    },

    /** Set up pose state and register the target with the `arnft` system. */
    init: function () {
        this.mesh = this.el.object3D;
        // Without a pose the content has no place to be: onPose() shows it.
        this.mesh.visible = false;
        this.postMatrix = new AFRAME.THREE.Matrix4();
        this.markerData = null;
        // Built by the first update(), which A-Frame runs right after init().
        this.filter = null;

        this.marker = this.el.sceneEl.systems.arnft.registerMarker({
            name: this.data.entityName,
            url: this.data.markerUrl,
            component: this,
        });
    },

    /**
     * `onPose()` ignores poses while the entity is paused, so smoothing starts again
     * afterwards rather than easing in from the pose it stopped at.
     */
    pause: function () {
        if (this.filter) {
            this.filter.reset();
        }
    },

    /**
     * The entity was removed or detached, or `nft-anchor` was removed from it:
     * stop routing poses to it. No pose and no `onLost` will arrive after this,
     * so the mesh is hidden now rather than left frozen at its last pose.
     *
     * A-Frame does not re-run `init()` when the same element is appended again,
     * so a removed `<a-nft>` is not tracked again; create a new element instead
     * (webarkit/Aframe-nft#15).
     */
    remove: function () {
        this.el.sceneEl.systems.arnft.unregisterMarker(this.marker);
        this.marker = null;
        this.onLost();
    },

    /**
     * Apply property changes: the first call after `init()`, then any runtime
     * change of `scaleFactor`, `lift`, the offsets or the smoothing parameters.
     * A change of `markerUrl` is not handled (webarkit/Aframe-nft#15).
     *
     * The filter is rebuilt only when its own properties change, because
     * rebuilding resets the smoothing state.
     *
     * @param {object} oldData Previous property values; `{}` on the first call.
     */
    update: function (oldData) {
        if (
            this.data.smooth !== oldData.smooth ||
            this.data.smoothMinCutoff !== oldData.smoothMinCutoff ||
            this.data.smoothBeta !== oldData.smoothBeta ||
            this.data.smoothRotationBeta !== oldData.smoothRotationBeta
        ) {
            this._buildFilter();
        }
        if (this.markerData) {
            this._composePostMatrix();
        }
    },

    /**
     * (Re)create the 1€ filter from the smoothing properties, or drop it when
     * `smooth` is false.
     *
     * @private
     */
    _buildFilter: function () {
        this.filter = this.data.smooth
            ? new PoseFilter({
                  minCutoff: this.data.smoothMinCutoff,
                  beta: this.data.smoothBeta,
                  rotationBeta: this.data.smoothRotationBeta,
              })
            : null;
    },

    /**
     * The target has loaded. Called by the `arnft` system with the target's
     * size, which fixes the centring offset.
     *
     * @param {import('./markerRegistry').NFTData} data
     */
    onData: function (data) {
        this.markerData = data;
        this._composePostMatrix();
    },

    /**
     * Build the post-matrix applied after each pose: centre the content on the
     * target, lift it onto the plane when `lift` is set, and scale it by
     * `scaleFactor`.
     *
     * @private
     */
    _composePostMatrix: function () {
        const data = this.markerData;
        const offset = computeCenterOffset(data.width, data.height, data.dpi);
        const s = this.data.scaleFactor;
        // Lift along the marker normal by the mesh's real (unscaled) bottom extent
        // so ANY mesh rests on the plane — not just a unit cube. Falls back to a
        // unit-cube bottom (-0.5) if the mesh isn't measurable yet.
        const bbox = this._getLocalBBox();
        const bottomZ = bbox ? bbox.min.z : -0.5;
        const position = new AFRAME.THREE.Vector3(
            offset.x + this.data.offsetX,
            offset.y + this.data.offsetY,
            offset.z + computeLiftZ(bottomZ, s, this.data.lift),
        );
        const quaternion = new AFRAME.THREE.Quaternion();
        const scale = new AFRAME.THREE.Vector3(s, s, s);
        this.postMatrix.compose(position, quaternion, scale);
    },

    /**
     * Bounding box of the child meshes in this anchor's local frame, i.e.
     * before the post-matrix scale is applied.
     *
     * @returns {THREE.Box3|null} `null` if no geometry has loaded yet.
     * @private
     */
    _getLocalBBox: function () {
        const anchor = this.el.object3D;
        const box = new AFRAME.THREE.Box3();
        const tmp = new AFRAME.THREE.Box3();
        const rel = new AFRAME.THREE.Matrix4();
        let found = false;
        anchor.traverse((node) => {
            if (node === anchor || !node.geometry) {
                return;
            }
            if (!node.geometry.boundingBox) {
                node.geometry.computeBoundingBox();
            }
            // Accumulate local matrices from node up to (but excluding) the anchor.
            rel.identity();
            let cur = node;
            while (cur && cur !== anchor) {
                cur.updateMatrix();
                rel.premultiply(cur.matrix);
                cur = cur.parent;
            }
            tmp.copy(node.geometry.boundingBox).applyMatrix4(rel);
            if (!found) {
                box.copy(tmp);
                found = true;
            } else {
                box.union(tmp);
            }
        });
        return found ? box : null;
    },

    /**
     * A new pose for this target. Called by the `arnft` system on every frame
     * in which the target is tracked. The right-handed pose is smoothed,
     * combined with the post-matrix, and written to the entity's matrix, so the
     * entity's `position` / `rotation` / `scale` attributes are ignored once
     * tracking starts.
     *
     * The matrix is written here because A-Frame renders right after the systems'
     * `tick`, which is where this runs: the frame that shows the content must
     * already have its pose. The component's own `tick` has run by then.
     *
     * @param {ArrayLike<number>} matrixGL_RH 4×4 pose matrix from jsartoolkitNFT.
     * @param {number} time Time (ms) of the frame this pose comes from.
     */
    onPose: function (matrixGL_RH, time) {
        // A paused entity keeps its content where it is, but its poses still arrive,
        // because they come from the `arnft` system. This reads `el.isPlaying` rather
        // than a flag set by pause() and play(): A-Frame calls pause() when an entity
        // is removed, and no play() when the same entity is appended again.
        if (!this.el.isPlaying) {
            return;
        }
        let elements = toMatrixElements(matrixGL_RH);
        if (elements === null) {
            console.error('nft-anchor: invalid matrixGL_RH', matrixGL_RH);
            return;
        }
        if (this.filter) {
            elements = this.filter.filter(time, elements);
        }
        const m = new AFRAME.THREE.Matrix4();
        m.elements = elements;
        m.multiply(this.postMatrix);
        this.mesh.matrixAutoUpdate = false;
        this.mesh.matrix.copy(m);
        this.mesh.visible = true;
    },

    /**
     * The target went out of view (unseen for `lostTimeout` ms). Called by the
     * `arnft` system once per loss.
     */
    onLost: function () {
        this.mesh.visible = false;
        // Start fresh on re-acquisition so the mesh doesn't ease in from a stale pose.
        if (this.filter) {
            this.filter.reset();
        }
    },
});

/**
 * `<a-nft url="…" name="…">`: an entity with `nft-anchor`. `url` maps to
 * `nft-anchor.markerUrl` and `name` to `nft-anchor.entityName`. Its children are
 * the content anchored to the target.
 */
AFRAME.registerPrimitive('a-nft', AFRAME.utils.extendDeep({}, AFRAME.primitives.getMeshMixin(), {
    defaultComponents: {
        'nft-anchor': {},
    },
    mappings: {
        url: 'nft-anchor.markerUrl',
        name: 'nft-anchor.entityName',
    },
}));

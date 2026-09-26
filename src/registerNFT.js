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
import { ARControllerNFT } from '@webarkit/jsartoolkit-nft';
import { cameraViewRenderer } from './cameraViewRenderer';
import { computeCenterOffset, computeLiftZ, toMatrixElements } from './nftMath';
import { OneEuroFilter } from './oneEuroFilter';
import { MarkerRegistry } from './markerRegistry';
import { loadPendingMarkers } from './markerLoader';

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
 * - an `<a-camera>` (or `[camera]` entity) at the origin with `look-controls`
 *   disabled. The tracker's projection is applied to it.
 */
AFRAME.registerSystem('arnft', {
    schema: {
        // Requested capture size. These are ideals: the browser may pick another.
        videoWidth: { type: 'number', default: 640 },
        videoHeight: { type: 'number', default: 480 },
        // ARToolKit camera parameter file, resolved against the page.
        cameraParam: { type: 'string', default: 'Data/camera_para.dat' },
        // How long (ms) a marker may go without a pose before its mesh is hidden.
        // Matches jsartoolkitNFT's own MARKER_LOST_TIME.
        lostTimeout: { type: 'number', default: 200 },
        // Detection policy (jsartoolkitNFT 1.13.0): while some markers are
        // tracked and others are not, look for the missing ones at most every
        // `detectionInterval` ms (0 = every frame). continuousDetection: false
        // stops looking while anything is tracked — cheapest, but a second
        // target entering the view is not found.
        continuousDetection: { type: 'boolean', default: true },
        detectionInterval: { type: 'number', default: 300 },
    },

    /**
     * Start the camera right away, preferring the rear camera and capturing at
     * most 60 fps. The tracker is created later, in `_maybeStart()`, once the
     * camera is live and at least one `<a-nft>` has registered.
     */
    init: function () {
        this.video = document.getElementById('video');
        this.camV = new cameraViewRenderer(this.video);
        this.controller = null;
        this.videoReady = false;
        this.starting = false;
        // Markers registered by <a-nft> components: load state + visibility.
        this.registry = new MarkerRegistry();

        this.camV
            .initialize({
                facingMode: 'environment',
                targetFrameRate: 60,
                width: this.data.videoWidth,
                height: this.data.videoHeight,
            })
            .then(() => {
                this.videoReady = true;
                this._maybeStart();
            })
            .catch((err) => console.error('arnft: camera init failed', err));
    },

    /**
     * Register a target. Called by `nft-anchor` components during their own
     * `init()`.
     *
     * Targets can be registered at any time: since jsartoolkitNFT 1.13.0 they
     * load incrementally (webarkit/jsartoolkitNFT#612), so an `<a-nft>` added
     * after tracking has started is loaded on the spot.
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
            record.component.onData(this.controller.getNFTData(record.id));
        } else if (this.controller) {
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
            this.starting ||
            this.controller ||
            !this.videoReady ||
            this.registry.markers.length === 0
        ) {
            return;
        }
        this.starting = true;

        const cameraParamUrl = resolveUrl(this.data.cameraParam);
        ARControllerNFT.initWithDimensions(this.camV.pw, this.camV.ph, cameraParamUrl, true)
            .then((ar) => this._onControllerReady(ar))
            .catch((err) => {
                // Allow a later _maybeStart() to retry instead of blocking forever.
                this.starting = false;
                console.error('arnft: tracker init failed', err);
            });
    },

    /**
     * The tracker is ready: apply its projection and detection settings, route
     * its poses to the components, and load the registered targets.
     *
     * @param {import('@webarkit/jsartoolkit-nft').ARControllerNFT} ar
     * @private
     */
    _onControllerReady: function (ar) {
        this.controller = ar;
        this._setupCamera();

        // jsartoolkitNFT 1.13.0 tracks every loaded marker at once; these set
        // how often it looks for the ones not tracked yet.
        ar.setContinuousDetection(this.data.continuousDetection);
        ar.setDetectionInterval(this.data.detectionInterval);

        // There is deliberately no 'lostNFTMarker' listener: visibility is
        // derived from pose timestamps in tick() instead. That behaves the same
        // on any jsartoolkitNFT version (before 1.13.0 the event was
        // single-marker, webarkit/jsartoolkitNFT#611), and `lostTimeout` stays
        // tunable where upstream's timeout is fixed at 200 ms.
        ar.addEventListener('getNFTMarker', (ev) => {
            const marker = this.registry.markSeen(ev.data.index, performance.now());
            if (marker) {
                marker.component.onPose(ev.data.matrixGL_RH);
            }
        });

        this._loadPendingMarkers();
    },

    /**
     * Hand every target that is not loaded yet to the tracker, one call per
     * target. Safe to call at any time; see `markerLoader.js`.
     *
     * @private
     */
    _loadPendingMarkers: function () {
        const ar = this.controller;
        if (!ar) {
            return;
        }
        loadPendingMarkers(ar, this.registry, {
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
     * `getCameraMatrix()` targets the full `pw` × `ph` processing canvas, but
     * the video content is drawn letterboxed at `w` × `h` inside it. Scaling by
     * `pw / w` (x) and `ph / h` (y) undoes that padding, giving the intrinsic
     * projection at the video's true aspect.
     *
     * No further aspect correction is needed. Alignment comes from sizing the
     * render canvas to the same box as the video (see `_resize`), the AR.js
     * approach, so the overlay matches the video for any `camera_para`.
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
        const cv = this.camV;
        const ratioW = cv.pw / cv.w;
        const ratioH = cv.ph / cv.h;
        const proj = Array.from(this.controller.getCameraMatrix());
        proj[0] *= ratioW;
        proj[4] *= ratioW;
        proj[8] *= ratioW;
        proj[12] *= ratioW;
        proj[1] *= ratioH;
        proj[5] *= ratioH;
        proj[9] *= ratioH;
        proj[13] *= ratioH;

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
     * tracking pass, then hide the targets that stopped being seen.
     * `process()` reads the processing frame; each tracked target fires the
     * `getNFTMarker` listener registered in `_onControllerReady`.
     */
    tick: function () {
        if (!this.controller || !this.videoReady) {
            return;
        }
        this._resize();
        this._applyProjection();
        // process() dispatches getNFTMarker synchronously for every marker it
        // finds, so the registry is up to date before we check for stale ones.
        this.controller.process(this.camV.getImage());

        for (const marker of this.registry.collectStale(performance.now(), this.data.lostTimeout)) {
            marker.component.onLost();
        }
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
 * 3. the result is written to the entity's matrix in `tick()`.
 *
 * The content is hidden when the target is lost or the component is removed.
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
        // smoother but more lag; higher beta = less lag while moving.
        smooth: { type: 'boolean', default: true },
        smoothMinCutoff: { type: 'number', default: 0.0001 },
        smoothBeta: { type: 'number', default: 0.01 },
    },

    /** Set up pose state and register the target with the `arnft` system. */
    init: function () {
        this.mesh = this.el.object3D;
        this.postMatrix = new AFRAME.THREE.Matrix4();
        this.latestMatrix = null;
        this.markerData = null;
        this._buildFilter();

        this.marker = this.el.sceneEl.systems.arnft.registerMarker({
            name: this.data.entityName,
            url: this.data.markerUrl,
            component: this,
        });
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
        this.latestMatrix = null;
    },

    /**
     * Rebuild the filter and the post-matrix when a tunable changes at runtime:
     * `scaleFactor`, `lift`, the offsets or the smoothing parameters. A change
     * of `markerUrl` is not handled (webarkit/Aframe-nft#15).
     */
    update: function () {
        this._buildFilter();
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
            ? new OneEuroFilter({
                  minCutoff: this.data.smoothMinCutoff,
                  beta: this.data.smoothBeta,
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
     * combined with the post-matrix, and cached for `tick()`.
     *
     * @param {ArrayLike<number>} matrixGL_RH 4×4 pose matrix from jsartoolkitNFT.
     */
    onPose: function (matrixGL_RH) {
        let elements = toMatrixElements(matrixGL_RH);
        if (elements === null) {
            console.error('nft-anchor: invalid matrixGL_RH', matrixGL_RH);
            return;
        }
        if (this.filter) {
            elements = this.filter.filter(performance.now(), elements);
        }
        const m = new AFRAME.THREE.Matrix4();
        m.elements = elements;
        m.multiply(this.postMatrix);
        this.latestMatrix = m;
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

    /**
     * Apply the latest pose. The matrix is set directly, so the entity's
     * `position` / `rotation` / `scale` attributes are ignored once tracking
     * starts.
     */
    tick: function () {
        if (this.latestMatrix === null) {
            return;
        }
        this.mesh.matrixAutoUpdate = false;
        this.mesh.matrix.copy(this.latestMatrix);
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

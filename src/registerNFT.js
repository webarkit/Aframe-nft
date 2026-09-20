import 'aframe';
import { ARControllerNFT } from '@webarkit/jsartoolkit-nft';
import { cameraViewRenderer } from './cameraViewRenderer';
import { computeCenterOffset, computeLiftZ, toMatrixElements } from './nftMath';
import { OneEuroFilter } from './oneEuroFilter';
import { MarkerRegistry } from './markerRegistry';

// Resolve a marker/camera path relative to the HTML page (like any other asset
// URL), so relative paths keep working under sub-path deployments. Absolute and
// root-relative URLs pass through unchanged.
function resolveUrl(path) {
    return new URL(path, document.baseURI).href;
}

// The `arnft` system owns the camera, the jsartoolkitNFT tracker, and the
// per-frame detection loop. Components register their marker with it and receive
// pose callbacks — the tracker runs once, not per component.
AFRAME.registerSystem('arnft', {
    schema: {
        videoWidth: { type: 'number', default: 640 },
        videoHeight: { type: 'number', default: 480 },
        cameraParam: { type: 'string', default: 'Data/camera_para.dat' },
        // How long (ms) a marker may go without a pose before its mesh is hidden.
        // Matches jsartoolkitNFT's own MARKER_LOST_TIME.
        lostTimeout: { type: 'number', default: 200 },
    },

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

    // Called by nft-anchor components during their own init(). All <a-nft>
    // elements declared in the scene register well before the camera and
    // tracker finish initialising, so they are loaded together in one batch.
    registerMarker: function (marker) {
        this.registry.add(marker);
        if (this.controller) {
            // Markers cannot be added once tracking has started: upstream
            // addNFTMarkers is single-call (webarkit/jsartoolkitNFT#612), and a
            // second call corrupts the markers already loaded. Warn rather than
            // silently ignoring it, which is what used to happen.
            console.warn(
                `arnft: <a-nft> "${marker.name}" was added after tracking started and will ` +
                    'not be tracked. jsartoolkitNFT cannot load markers incrementally — ' +
                    'declare all <a-nft> elements before the scene initialises.',
            );
            return;
        }
        this._maybeStart();
    },

    // Start the tracker once the camera is live and at least one marker exists.
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

    _onControllerReady: function (ar) {
        this.controller = ar;
        this._setupCamera();

        // Note there is deliberately no 'lostNFTMarker' listener: upstream that
        // event only tracks one marker at a time (webarkit/jsartoolkitNFT#611),
        // so with several targets a marker leaving the frame may never fire it.
        // Visibility is derived from pose timestamps in tick() instead.
        ar.addEventListener('getNFTMarker', (ev) => {
            const marker = this.registry.markSeen(ev.data.index, performance.now());
            if (marker) {
                marker.component.onPose(ev.data.matrixGL_RH);
            }
        });

        this._loadPendingMarkers();
    },

    // Hand every registered marker to the tracker in ONE batch.
    //
    // This must be a single call: upstream `addNFTMarkers` derives page numbers,
    // marker ids and surfaceSet indices from its loop counter, so a second call
    // restarts at 0 — returning duplicate ids, overwriting surfaceSet[0..] and
    // replacing the whole KPM reference set. Calling it twice corrupts markers
    // that are already being tracked. See webarkit/jsartoolkitNFT#612.
    _loadPendingMarkers: function () {
        const ar = this.controller;
        if (!ar) {
            return;
        }
        const pending = this.registry.unloaded();
        if (pending.length === 0) {
            return;
        }
        pending.forEach((marker) => this.registry.markLoading(marker));

        // ids come back positionally, matching the urls we passed in.
        ar.loadNFTMarkers(
            pending.map((marker) => resolveUrl(marker.url)),
            (ids) => {
                ids.forEach((id, i) => {
                    const marker = pending[i];
                    this.registry.setId(marker, id);
                    marker.component.onData(ar.getNFTData(id, 0));
                    ar.trackNFTMarkerId(id);
                });
            },
            (err) => {
                // Terminal: retrying would issue a second addNFTMarkers call,
                // which corrupts state upstream (jsartoolkitNFT#612).
                pending.forEach((marker) => this.registry.markLoadFailed(marker));
                console.error(
                    'arnft: failed to load NFT markers; they will not be tracked ' +
                        '(reload the page to retry)',
                    err,
                );
            },
        );
    },

    // Compute and store the tracker's projection matrix for the a-camera.
    //
    // getCameraMatrix() targets the full pw x ph processing canvas, but the video
    // content is drawn letterboxed at w x h inside it. Scale by pw/w (x) and ph/h
    // (y) to undo that padding, giving the intrinsic projection at the video's true
    // aspect. No further aspect fudging: alignment is handled by sizing the render
    // canvas to the same box as the video (see _resize) — the AR.js approach — so
    // the overlay matches the video by construction, for any camera_para.
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

    _applyProjection: function () {
        const camera = this.arCamera;
        camera.projectionMatrix.fromArray(this.projArray);
        camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    },

    // Size the video AND the render canvas to the same "cover" box: source aspect,
    // scaled to fill the window, overflow hidden via negative margins. Because both
    // elements share the exact box, and the renderer draws at that box, the raw
    // projection maps 3D onto the same pixels as the video — no stretch, no shift.
    // Mirrors AR.js ArToolkitSource.onResizeElement + copyElementSizeTo.
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

    // Drive one detection pass per frame, then expire markers that stopped
    // being seen. process() reads the cropped camera frame; matches fire the
    // getNFTMarker listener above.
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

AFRAME.registerComponent('nft-anchor', {
    dependencies: ['arnft'],
    schema: {
        entityName: { type: 'string', default: 'pinball' },
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

    init: function () {
        this.mesh = this.el.object3D;
        this.postMatrix = new AFRAME.THREE.Matrix4();
        this.latestMatrix = null;
        this.markerData = null;
        this._buildFilter();

        const system = this.el.sceneEl.systems.arnft;
        system.registerMarker({
            name: this.data.entityName,
            url: this.data.markerUrl,
            component: this,
        });
    },

    // Recompose / rebuild when a tunable changes at runtime (scaleFactor, offsets,
    // smoothing params).
    update: function () {
        this._buildFilter();
        if (this.markerData) {
            this._composePostMatrix();
        }
    },

    _buildFilter: function () {
        this.filter = this.data.smooth
            ? new OneEuroFilter({
                  minCutoff: this.data.smoothMinCutoff,
                  beta: this.data.smoothBeta,
              })
            : null;
    },

    // Marker metadata (real-world size + dpi) arrived — compose the post-matrix.
    onData: function (data) {
        this.markerData = data;
        this._composePostMatrix();
    },

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

    // Bounding box of the child mesh(es) expressed in this anchor's local frame
    // (i.e. before the postMatrix scale is applied). Returns null if no geometry
    // has loaded yet.
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

    // New pose for this marker: RH matrix -> centered model matrix, cached for tick.
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

    onLost: function () {
        this.mesh.visible = false;
        // Start fresh on re-acquisition so the mesh doesn't ease in from a stale pose.
        if (this.filter) {
            this.filter.reset();
        }
    },

    tick: function () {
        if (this.latestMatrix === null) {
            return;
        }
        this.mesh.matrixAutoUpdate = false;
        this.mesh.matrix.copy(this.latestMatrix);
    },
});

AFRAME.registerPrimitive('a-nft', AFRAME.utils.extendDeep({}, AFRAME.primitives.getMeshMixin(), {
    defaultComponents: {
        'nft-anchor': {},
    },
    mappings: {
        url: 'nft-anchor.markerUrl',
        name: 'nft-anchor.entityName',
    },
}));

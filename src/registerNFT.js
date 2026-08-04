import 'aframe';
import { ARControllerNFT } from '@webarkit/jsartoolkit-nft';
import { cameraViewRenderer } from './cameraViewRenderer';
import { computeCenterOffset, toMatrixElements } from './nftMath';

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
    },

    init: function () {
        this.video = document.getElementById('video');
        this.camV = new cameraViewRenderer(this.video);
        this.controller = null;
        this.videoReady = false;
        this.starting = false;
        // Markers registered by <a-nft> components, keyed later by tracker id.
        this.markers = [];
        this.markersById = new Map();

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

    // Called by nft-anchor components during their own init().
    registerMarker: function (marker) {
        this.markers.push(marker);
        this._maybeStart();
    },

    // Start the tracker once the camera is live and at least one marker exists.
    _maybeStart: function () {
        if (this.starting || this.controller || !this.videoReady || this.markers.length === 0) {
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

        ar.addEventListener('getNFTMarker', (ev) => {
            const marker = this.markersById.get(ev.data.index);
            if (marker) {
                marker.component.onPose(ev.data.matrixGL_RH);
            }
        });
        ar.addEventListener('lostNFTMarker', (ev) => {
            const marker = this.markersById.get(ev.data.index);
            if (marker) {
                marker.component.onLost();
            }
        });

        const urls = this.markers.map((m) => resolveUrl(m.url));
        ar.loadNFTMarkers(
            urls,
            (ids) => {
                ids.forEach((id, i) => {
                    const marker = this.markers[i];
                    marker.id = id;
                    this.markersById.set(id, marker);
                    marker.component.onData(ar.getNFTData(id, 0));
                    ar.trackNFTMarkerId(id);
                });
            },
            (err) => console.error('arnft: failed to load NFT markers', err),
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

    // Drive one detection pass per frame. process() reads the cropped camera
    // frame; matches fire the getNFTMarker/lostNFTMarker listeners above.
    tick: function () {
        if (!this.controller || !this.videoReady) {
            return;
        }
        this._resize();
        this._applyProjection();
        this.controller.process(this.camV.getImage());
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
        // Optional fine-alignment nudge in marker millimetres, added on top of the
        // (canonical) centering offset. Defaults to 0 — use it to compensate for
        // camera calibration (principal point) on a specific device.
        offsetX: { type: 'number', default: 0 },
        offsetY: { type: 'number', default: 0 },
    },

    init: function () {
        this.mesh = this.el.object3D;
        this.postMatrix = new AFRAME.THREE.Matrix4();
        this.latestMatrix = null;
        this.markerData = null;

        const system = this.el.sceneEl.systems.arnft;
        system.registerMarker({
            name: this.data.entityName,
            url: this.data.markerUrl,
            component: this,
        });
    },

    // Recompose when a tunable (scaleFactor/offsetX/offsetY) changes at runtime.
    update: function () {
        if (this.markerData) {
            this._composePostMatrix();
        }
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
        // Lift the mesh along the marker normal by half its scaled depth so it
        // rests ON the marker plane instead of being half-buried in it. The scaled
        // unit mesh spans `s`, so half-depth is s/2 (translation is unscaled).
        const position = new AFRAME.THREE.Vector3(
            offset.x + this.data.offsetX,
            offset.y + this.data.offsetY,
            offset.z + s / 2,
        );
        const quaternion = new AFRAME.THREE.Quaternion();
        const scale = new AFRAME.THREE.Vector3(s, s, s);
        this.postMatrix.compose(position, quaternion, scale);
    },

    // New pose for this marker: RH matrix -> centered model matrix, cached for tick.
    onPose: function (matrixGL_RH) {
        const elements = toMatrixElements(matrixGL_RH);
        if (elements === null) {
            console.error('nft-anchor: invalid matrixGL_RH', matrixGL_RH);
            return;
        }
        const m = new AFRAME.THREE.Matrix4();
        m.elements = elements;
        m.multiply(this.postMatrix);
        this.latestMatrix = m;
        this.mesh.visible = true;
    },

    onLost: function () {
        this.mesh.visible = false;
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

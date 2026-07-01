import 'aframe';
import ARNFT from '@webarkit/ar-nft';
const { ARnft } = ARNFT;
import { cameraViewRenderer } from './cameraViewRenderer';
import { computeCenterOffset, toMatrixElements } from './nftMath';

AFRAME.registerSystem('arnft', {
    schema: {
        videoWidth: { type: 'number', default: 640 },
        videoHeight: { type: 'number', default: 480 },
        configUrl: { type: 'string', default: './config.json' },
    },
    init: function () {
        console.info('arnft system init');
        this.arNFT = new ARnft(this.data.videoWidth, this.data.videoHeight, this.data.configUrl);
        this.uuid = this.arNFT.uuid;
        this.video = document.getElementById('video');
        this.camV = new cameraViewRenderer(this.video);
    },
});

AFRAME.registerComponent('nft-anchor', {
    dependencies: ['arnft'],
    schema: {
        entityName: { type: 'string', default: 'pinball' },
        markerUrl: { type: 'string', default: 'examples/dataNFT/pinball' },
        // Uniform scale applied to the mesh geometry. NFT pose units are millimetres,
        // so a bare 1-unit primitive is tiny; this makes it visible without changing
        // the (now correctly centered) placement offset.
        scaleFactor: { type: 'number', default: 200 },
    },

    init: function () {
        this.container = this.el.sceneEl.parentNode;
        this.sysNft = this.el.sceneEl.systems.arnft;
        this.mesh = this.el.object3D;

        // Post-matrix that recenters the mesh on the marker origin. Composed once
        // the NFT metadata (size + dpi) arrives.
        this.postMatrix = new AFRAME.THREE.Matrix4();
        // Latest pose from the tracker, applied every tick. null until first hit.
        this.latestMatrix = null;

        this.sysNft.arNFT.initializeRaw(
            [[this.data.markerUrl]],
            [[this.data.entityName]],
            this.sysNft.camV,
            true,
        );

        // Bind all listeners ONCE here — never in tick() (that leaked a listener
        // per frame and ran the handler N times per frame). See DESIGN.md finding #2.
        const eventSuffix = this.sysNft.uuid + '-' + this.data.entityName;

        window.addEventListener('getProjectionMatrix', (ev) => {
            this.setupCamera(ev.detail.proj);
        });

        window.addEventListener('getNFTData-' + eventSuffix, (ev) => {
            const msg = ev.detail;
            // Center the mesh using the marker's real-world size (dpi-scaled mm),
            // NOT raw pixels — this is the mesh-shift fix. See DESIGN.md finding #1.
            const offset = computeCenterOffset(msg.width, msg.height, msg.dpi);
            const position = new AFRAME.THREE.Vector3(offset.x, offset.y, offset.z);
            const quaternion = new AFRAME.THREE.Quaternion();
            const s = this.data.scaleFactor;
            const scale = new AFRAME.THREE.Vector3(s, s, s);
            this.postMatrix.compose(position, quaternion, scale);
        });

        window.addEventListener('getMatrixGL_RH-' + eventSuffix, (ev) => {
            const elements = toMatrixElements(ev.detail.matrixGL_RH);
            if (elements === null) {
                console.error('Invalid matrixGL_RH data:', ev.detail.matrixGL_RH);
                return;
            }
            const m = new AFRAME.THREE.Matrix4();
            m.elements = elements;
            m.multiply(this.postMatrix);
            this.latestMatrix = m;
            this.mesh.visible = true;
        });

        window.addEventListener('nftTrackingLost-' + eventSuffix, () => {
            this.mesh.visible = false;
        });
    },

    setupCamera: function (proj) {
        const container = this.container;
        const fov = (2 * Math.atan(1 / proj[5]) * 180) / Math.PI; // vertical fov
        const near = proj[14] / (proj[10] - 1.0);
        const far = proj[14] / (proj[10] + 1.0);
        const aspect = container.clientWidth / container.clientHeight;

        const cameraEle = container.getElementsByTagName('a-camera')[0];
        const camera = cameraEle.getObject3D('camera');
        camera.fov = fov;
        camera.aspect = aspect;
        camera.near = near;
        camera.far = far;
        camera.updateProjectionMatrix();
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

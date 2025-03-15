import 'aframe';
import ARNFT from '@webarkit/ar-nft'
const {ARnft} = ARNFT;
import {cameraViewRenderer} from './cameraViewRenderer'
import {setMatrix} from './utils'

AFRAME.registerSystem('arnft', {
    container: null,
    schema: {
        // Define schema of system here
        videoWidth: {
            type: 'number',
            default: 640
        },
        videoHeight: {
            type: 'number',
            default: 480
        },
    },
    init: function () {
        console.info('arnft system init');
        this.arNFT = new ARnft(this.data.videoWidth, this.data.videoHeight, './config.json');
        this.uuid = this.arNFT.uuid;
        const video = document.getElementById("video");
        this.camV = new cameraViewRenderer(video);
    }
});

AFRAME.registerComponent('nft-anchor', {
    dependencies: ['arnft'],
    schema: {
        // Define schema of component here
        entityName: {
            type: 'string',
            default: 'pinball',
        },
        markerUrl: {
            type: 'string',
            default: 'examples/dataNFT/pinball'

        }
    },
    setupCamera: function (proj) {
        const container = this.container;
        const fov = 2 * Math.atan(1/proj[5] / vh * container.clientHeight ) * 180 / Math.PI; // vertical fov
        const near = proj[14] / (proj[10] - 1.0);
        const far = proj[14] / (proj[10] + 1.0);
        const ratio = proj[5] / proj[0]; // (r-l) / (t-b)
        //console.log("loaded proj: ", proj, ". fov: ", fov, ". near: ", near, ". far: ", far, ". ratio: ", ratio);
        const newAspect = container.clientWidth / container.clientHeight;
        const cameraEle = container.getElementsByTagName("a-camera")[0];
        const camera = cameraEle.getObject3D('camera');
        camera.fov = fov;
        camera.aspect = newAspect;
        camera.near = near;
        camera.far = far;
        camera.updateProjectionMatrix();
        //const newCam = new AFRAME.THREE.PerspectiveCamera(fov, newRatio, near, far);
        //camera.getObject3D('camera').projectionMatrix = newCam.projectionMatrix;

        /*this.video.style.top = (-(vh - container.clientHeight) / 2) + "px";
        this.video.style.left = (-(vw - container.clientWidth) / 2) + "px";
        this.video.style.width = vw + "px";
        this.video.style.height = vh + "px";*/

    },
    init: function () {
        this.container = this.el.sceneEl.parentNode;
        console.log('a-nft component init');
        //console.log(this.data);
        //console.log(this.system);
        this.sysNft = this.el.sceneEl.systems.arnft;
        console.log('sysNft is: ', this.sysNft)
        this.sysNft.arNFT.initializeRaw([[this.data.markerUrl]], [[this.data.entityName]], this.sysNft.camV, true)
        //this.root = this.el.object3D;
        const mesh = this.el.object3D;
        console.log(this.root)
        this.markerWidth=0;
        this.markerHeight=0;
        this.postMatrix = new AFRAME.THREE.Matrix4();
        window.addEventListener("getProjectionMatrix", (ev) => {
            this.el.setupCamera(ev.detail.proj)
        });
        window.addEventListener("getNFTData-" + this.sysNft.uuid + "-" + this.data.entityName, (ev) => {
            console.log('msg from event: ', ev.detail)
            const msg = ev.detail;
            //mesh.position.y = ((msg.height / msg.dpi) * 2.54 * 10) / 2.0;
            //mesh.position.x = ((msg.width / msg.dpi) * 2.54 * 10) / 2.0;
            //mesh.position.y = 120;
            //mesh.position.x = 120;
            //mesh.position.z = 120;
            const position = new AFRAME.THREE.Vector3();
            const quaternion = new AFRAME.THREE.Quaternion();
            const scale = new AFRAME.THREE.Vector3();
            this.markerWidth = msg.width;
            //this.markerWidth = 1;
            this.markerHeight = msg.height;

            //console.log('msg from event: ',  ((msg.height / msg.dpi) * 2.54 * 10) / 2.0)
            //position.y = ((this.markerHeight / msg.dpi) * 2.54 * 10) / 2.0;
            //position.x = ((this.markerWidth / msg.dpi) * 2.54 * 10) / 2.0;
            position.x = this.markerWidth / 2;
            position.y = this.markerWidth / 2 + (this.markerHeight - this.markerWidth) / 2;
            scale.x = this.markerWidth;
            scale.y = this.markerWidth;
            scale.z = this.markerWidth;
            this.postMatrix.compose(position, quaternion, scale);
            console.log(this.postMatrix)
        });
    },

    tick: function () {
        const mesh = this.el.object3D;
        window.addEventListener("getMatrixGL_RH-" + this.sysNft.uuid + "-" + this.data.entityName, (ev) => {
            mesh.visible = true;
            mesh.matrixAutoUpdate = false;

            const m = new AFRAME.THREE.Matrix4();
            const matrixGL_RH = ev.detail.matrixGL_RH;

            //console.log('matrixGL_RH: ', matrixGL_RH);

            // Ensure matrixGL_RH is an array and contains valid numbers
            if (Array.isArray(matrixGL_RH) && matrixGL_RH.length === 16) {
                m.elements = matrixGL_RH.map(value => Number(value));
            } else if (typeof matrixGL_RH === 'object' && matrixGL_RH !== null) {
                m.elements = [
                    Number(matrixGL_RH[0]), Number(matrixGL_RH[1]), Number(matrixGL_RH[2]), Number(matrixGL_RH[3]),
                    Number(matrixGL_RH[4]), Number(matrixGL_RH[5]), Number(matrixGL_RH[6]), Number(matrixGL_RH[7]),
                    Number(matrixGL_RH[8]), Number(matrixGL_RH[9]), Number(matrixGL_RH[10]), Number(matrixGL_RH[11]),
                    Number(matrixGL_RH[12]), Number(matrixGL_RH[13]), Number(matrixGL_RH[14]), Number(matrixGL_RH[15])
                ];
            } else {
                console.error('Invalid matrixGL_RH data:', matrixGL_RH);
                return;
            }

            //console.log('m.elements: ', m.elements);
            m.multiply(this.postMatrix);
            mesh.matrix = m;
        });
        window.addEventListener("nftTrackingLost-" + this.sysNft.uuid + "-" + this.data.entityName, (ev) => {
            //this.root.visible = false;
            mesh.visible = false;
        });

    }
});

AFRAME.registerPrimitive('a-nft', AFRAME.utils.extendDeep({}, AFRAME.primitives.getMeshMixin(), {
    defaultComponents: {
        'nft-anchor': {}
    },
    mappings: {
        url: 'nft-anchor.markerUrl',
        name: 'nft-anchor.entityName',
    }
}),)

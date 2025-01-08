import 'aframe';
import ARNFT from '@webarkit/ar-nft'
const {ARnft} = ARNFT;
import {cameraViewRenderer} from './cameraViewRenderer'
import {setMatrix} from './utils'

AFRAME.registerSystem('arnft', {
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
    init: function () {
        console.log('a-nft component init');
        //console.log(this.data);
        //console.log(this.system);
        this.sysNft = this.el.sceneEl.systems.arnft;
        console.log('sysNft is: ', this.sysNft)
        this.sysNft.arNFT.initializeRaw([[this.data.markerUrl]], [[this.data.entityName]], this.sysNft.camV, true)
        const mesh = this.el.object3D;
        window.addEventListener("getProjectionMatrix", (ev) => {
            setMatrix(this.sysNft.el.camera.projectionMatrix, ev.detail.proj);
        });
        window.addEventListener("getNFTData-" + this.sysNft.uuid + "-" + this.data.entityName, (ev) => {
            console.log('msg from event: ', ev.detail)
            const msg = ev.detail;
            mesh.position.y = ((msg.height / msg.dpi) * 2.54 * 10) / 2.0;
            mesh.position.x = ((msg.width / msg.dpi) * 2.54 * 10) / 2.0;
        });
    },

    tick: function () {
        const mesh = this.el.object3D;
        window.addEventListener("getMatrixGL_RH-" + this.sysNft.uuid + "-" + this.data.entityName, (ev) => {
            //root.visible = true;
            mesh.visible = true;
            mesh.matrixAutoUpdate = false;
            setMatrix(mesh.matrix, ev.detail.matrixGL_RH);
        });
        window.addEventListener("nftTrackingLost-" + this.sysNft.uuid + "-" + this.data.entityName, (ev) => {
            //root.visible = false;
            mesh.visible = false;
        });

    }
});

AFRAME.registerPrimitive('a-nft', AFRAME.utils.extendDeep({}, AFRAME.primitives.getMeshMixin(), {
    defaultComponents: {
        'nft-anchor': {}
    },
    mappings: {
        markerUrl: 'nft-anchor.markerUrl',
        entityName: 'nft-anchor.entityName',
    }
}),)

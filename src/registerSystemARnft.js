import 'aframe';
import ARNFT from '@webarkit/ar-nft'
const {ARnft} = ARNFT;
import { cameraViewRenderer } from './cameraViewRenderer'

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
        console.log(this.data);
        //console.log(this.system);
        const sysNft = this.el.sceneEl.systems.arnft;
        console.log('arnft is: ', sysNft)
        sysNft.arNFT.initializeRaw([[this.data.markerUrl]], [[this.data.entityName]], sysNft.camV, true)
    },

    tick: function() {
        this.el.object3D.visible= true
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

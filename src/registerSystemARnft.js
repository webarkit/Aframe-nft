import 'aframe';
import ARNFT from '@webarkit/ar-nft'
const {ARnft} = ARNFT;
import { cameraViewRenderer } from './cameraViewRenderer'

console.log(ARNFT);

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
        console.log('arnft system init');
        console.log(this.data);
        
        this.arNFT = new ARnft(this.data.videoWidth, this.data.videoHeight, 'config.json');
        console.log(this.arNFT);
        this.uuid = this.arNFT.uuid;
        console.log(this.uuid);
        const video = document.getElementById("video");
        const camV = new cameraViewRenderer(video);
        this.arNFT.initializeRaw([["./examples/DataNFT/pinball"]], [["pinball"]], camV, true)
    }
});

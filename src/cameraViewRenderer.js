/**
 * Opens the camera and turns its frames into the images the tracker processes.
 *
 * Each captured frame is drawn into a 320×240 (4:3) processing canvas. Video
 * with another aspect ratio is scaled to fit and letterboxed with black bars.
 * After {@link cameraViewRenderer#initialize} resolves, the frame geometry is
 * available as:
 *
 * - `vw` × `vh`: native video size;
 * - `pw` × `ph`: processing frame size, always 320×240;
 * - `w` × `h`: size of the video content inside the processing frame;
 * - `ox`, `oy`: offset of that content, i.e. the letterbox bars.
 *
 * The `arnft` system uses `pw / w` and `ph / h` to undo the letterboxing in the
 * tracker's projection matrix.
 */
export class cameraViewRenderer {
    /**
     * @param {HTMLVideoElement} video Element that receives the camera stream.
     */
    constructor(video) {
        this.canvas_process = document.createElement("canvas");
        // willReadFrequently: getImageData() runs every captured frame, which
        // is much faster on a CPU-backed canvas.
        this.context_process = this.canvas_process.getContext("2d", { alpha: false, willReadFrequently: true });
        this._video = video;
        this._frame = 0;
        this.lastCache = 0;
        this.imageData = null;
        // Default so the getImage() frame-rate gate never divides by undefined (NaN).
        this.targetFrameRate = 60;
    }

    /**
     * Start the camera and prepare the processing canvas.
     *
     * @param {object} videoSettings
     * @param {string} [videoSettings.facingMode="environment"] Preferred camera:
     *     `"environment"` (rear) or `"user"` (front).
     * @param {number} [videoSettings.width] Ideal capture width.
     * @param {number} [videoSettings.height] Ideal capture height.
     * @param {number} [videoSettings.targetFrameRate=60] Maximum rate (fps) at
     *     which {@link cameraViewRenderer#getImage} captures new frames.
     * @returns {Promise<true>} Resolves once the stream plays and the frame
     *     geometry is known. Rejects with the `getUserMedia` error (for example
     *     `NotAllowedError`), or with a message string when the browser has no
     *     camera API.
     */
    async initialize(videoSettings) {
        this._facing = videoSettings.facingMode || "environment";
        if (videoSettings.targetFrameRate != null) {
            this.targetFrameRate = videoSettings.targetFrameRate;
        }

        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
            try {
                const hint = {
                    audio: false,
                    video: {
                        facingMode: this._facing,
                        width: videoSettings.width ? { ideal: videoSettings.width } : { min: 480, max: 640 },
                        height: videoSettings.height ? { ideal: videoSettings.height } : undefined,
                    },
                };
                if (navigator.mediaDevices.enumerateDevices) {
                    const devices = await navigator.mediaDevices.enumerateDevices();
                    const videoDevices = [];
                    let videoDeviceIndex = 0;
                    devices.forEach(function (device) {
                        if (device.kind === "videoinput") {
                            videoDevices[videoDeviceIndex++] = device.deviceId;
                        }
                    });
                    if (videoDevices.length > 1) {
                        hint.video.deviceId = { exact: videoDevices[videoDevices.length - 1] };
                    }
                }
                this._video.srcObject = await this._openStream(hint);
                this._video = await new Promise((resolve, reject) => {
                    // Metadata may already be available (reused element); don't wait forever.
                    if (this._video.readyState >= 1 /* HAVE_METADATA */) {
                        resolve(this._video);
                        return;
                    }
                    this._video.onloadedmetadata = () => resolve(this._video);
                    this._video.onerror = () =>
                        reject(new Error('video element failed to load the camera stream'));
                });
                this.prepareImage();
                return true;
            } catch (error) {
                return Promise.reject(error);
            }
        } else {
            return Promise.reject("Sorry, Your device does not support this experience.");
        }
    }

    /**
     * Open the camera stream.
     *
     * With several cameras the hint asks for the last one, which on most phones
     * is the back camera. On a desktop the last one can be a virtual camera
     * that cannot start: Meta Quest Link, for one, registers several that fail
     * with NotReadableError when no headset is connected. So on failure the
     * request is retried once without `deviceId`, letting `facingMode` choose.
     * A denied permission would only be denied again, so it is not retried.
     *
     * @param {MediaStreamConstraints} hint Constraints, possibly with `video.deviceId`.
     * @returns {Promise<MediaStream>}
     * @private
     */
    async _openStream(hint) {
        try {
            return await navigator.mediaDevices.getUserMedia(hint);
        } catch (error) {
            if (!hint.video.deviceId || error.name === "NotAllowedError") {
                throw error;
            }
            const { deviceId, ...video } = hint.video;
            return navigator.mediaDevices.getUserMedia({ ...hint, video });
        }
    }

    /**
     * @returns {number} Number of frames captured so far. It increases only when
     *     {@link cameraViewRenderer#getImage} actually captures a new frame.
     */
    getFrame() {
        return this._frame;
    }

    /**
     * The latest processing frame.
     *
     * The same ImageData is returned until the frame-rate gate captures a new
     * one, instead of a fresh copy per call. That is safe because
     * `ARControllerNFT.process()` copies the pixels into the WASM heap
     * synchronously (`passVideoData` → `HEAPU8.set`) and keeps no reference.
     * Callers must not mutate it.
     *
     * @returns {ImageData} A `pw` × `ph` RGBA frame.
     */
    getImage() {
        const now = Date.now();
        if (now - this.lastCache > 1000 / this.targetFrameRate) {
            this.context_process.drawImage(this._video, 0, 0, this.vw, this.vh, this.ox, this.oy, this.w, this.h);
            this.imageData = this.context_process.getImageData(0, 0, this.pw, this.ph);
            this.lastCache = now;
            this._frame++;
        }
        return this.imageData;
    }

    /**
     * Compute the frame geometry from the video's native size and size the
     * processing canvas (see the class description for the fields it sets).
     * Called once the stream's metadata is available.
     */
    prepareImage() {
        this.vw = this._video.videoWidth;
        this.vh = this._video.videoHeight;

        // Scale so the video fits a 320-wide 4:3 frame.
        const pscale = 320 / Math.max(this.vw, (this.vh / 3) * 4);

        // Floor to whole pixels: canvas sizes and draw offsets are integers.
        this.w = Math.floor(this.vw * pscale);
        this.h = Math.floor(this.vh * pscale);
        this.pw = Math.floor(Math.max(this.w, (this.h / 3) * 4));
        this.ph = Math.floor(Math.max(this.h, (this.w / 4) * 3));
        this.ox = Math.floor((this.pw - this.w) / 2);
        this.oy = Math.floor((this.ph - this.h) / 2);

        this.canvas_process.width = this.pw;
        this.canvas_process.height = this.ph;

        this.context_process.fillStyle = "black";
        this.context_process.fillRect(0, 0, this.pw, this.ph);
    }
}
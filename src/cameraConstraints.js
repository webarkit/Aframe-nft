/**
 * Keeps the `arnft` system's `videoWidth` and `videoHeight` working with
 * `@webarkit/camera-view`, as `ideal` capture sizes.
 *
 * camera-view only sends `width: { min, max }` and never a height, so a camera
 * could deliver 16:9 and tracking would see a smaller letterboxed picture. Its
 * `deps.mediaDevices` injection point lets us add the sizes to its constraints.
 * This module goes away if camera-view gains `ideal` support.
 *
 * Kept free of A-Frame / THREE / DOM so it can be unit-tested with a fake
 * `mediaDevices`.
 *
 * @module cameraConstraints
 */

/**
 * Wrap `mediaDevices` so every `getUserMedia()` also asks for the given size.
 *
 * @param {MediaDevices|undefined} mediaDevices Usually `navigator.mediaDevices`.
 * @param {{width: number, height: number}} size Ideal capture size. A size of 0
 *     is left out, which leaves the choice to the browser.
 * @returns {Pick<MediaDevices, 'getUserMedia'|'enumerateDevices'>|undefined}
 *     `undefined` with no `mediaDevices`, so camera-view reports `NOT_SUPPORTED`.
 */
export function withIdealSize(mediaDevices, { width, height }) {
    if (!mediaDevices) {
        return undefined;
    }
    return {
        enumerateDevices: mediaDevices.enumerateDevices?.bind(mediaDevices),
        getUserMedia: (constraints) => {
            const video = { ...constraints.video };
            if (width) {
                video.width = { ideal: width };
            }
            if (height) {
                video.height = { ideal: height };
            }
            return mediaDevices.getUserMedia({ ...constraints, video });
        },
    };
}

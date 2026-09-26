/**
 * Pure geometry and matrix helpers for placing content on an NFT target.
 *
 * Kept free of A-Frame / THREE / DOM so they can be unit-tested in isolation.
 *
 * @module nftMath
 */

/**
 * Convert a length in NFT-image pixels to millimetres, using the image DPI.
 * `px / dpi` gives inches; × 25.4 gives millimetres.
 *
 * @param {number} px Length in image pixels.
 * @param {number} dpi Image resolution in dots per inch.
 * @returns {number} Length in millimetres.
 */
export function pxToMm(px, dpi) {
    return (px / dpi) * 2.54 * 10;
}

/**
 * Translation that centres content on the target.
 *
 * jsartoolkitNFT reports the pose with its origin at a corner of the target,
 * so content must move by half the target's *real-world* size to sit at its
 * centre. Using raw pixel counts here instead was the original "mesh-shift"
 * bug (DESIGN.md, finding #1).
 *
 * @param {number} markerWidthPx Target width in image pixels.
 * @param {number} markerHeightPx Target height in image pixels.
 * @param {number} dpi Target image DPI.
 * @returns {{x: number, y: number, z: number}} Offset in millimetres; `z` is always 0.
 */
export function computeCenterOffset(markerWidthPx, markerHeightPx, dpi) {
    return {
        x: pxToMm(markerWidthPx, dpi) / 2,
        y: pxToMm(markerHeightPx, dpi) / 2,
        z: 0,
    };
}

/**
 * Translation along the target normal that seats content on the target plane.
 *
 * Content is scaled by `scaleFactor`, so its scaled bottom sits at
 * `scaleFactor * bboxMinZ`. With `lift`, that bottom moves to z = 0 and the
 * content rests ON the target. Without it, the content's origin stays on the
 * plane, which avoids the parallax "lean" of a tall standing object.
 *
 * @param {number} bboxMinZ Lowest z of the content's unscaled bounding box.
 * @param {number} scaleFactor Uniform scale applied to the content.
 * @param {boolean} lift Whether to lift the content onto the plane.
 * @returns {number} Z translation in millimetres.
 */
export function computeLiftZ(bboxMinZ, scaleFactor, lift) {
    return lift ? -scaleFactor * bboxMinZ : 0;
}

/**
 * Normalise a `matrixGL_RH` pose into a plain array of 16 numbers.
 *
 * @param {ArrayLike<number>|null|undefined} matrixGL_RH Pose from a
 *     `getNFTMarker` event: an array or an array-like such as a Float64Array.
 * @returns {number[]|null} The 16 elements, or `null` when the input is not a
 *     valid 4×4 matrix.
 */
export function toMatrixElements(matrixGL_RH) {
    if (matrixGL_RH == null) {
        return null;
    }
    const source = Array.isArray(matrixGL_RH)
        ? matrixGL_RH
        : Array.from({ length: 16 }, (_, i) => matrixGL_RH[i]);
    if (source.length !== 16) {
        return null;
    }
    const elements = source.map(Number);
    return elements.some(Number.isNaN) ? null : elements;
}

// Pure geometry/matrix helpers for NFT pose placement.
// Kept free of A-Frame / THREE / DOM so they can be unit-tested in isolation.

// Convert a length in NFT-image pixels to millimetres using the marker DPI.
// (px / dpi) = inches; * 2.54 = cm; * 10 = mm.
export function pxToMm(px, dpi) {
    return (px / dpi) * 2.54 * 10;
}

// Compute the post-matrix translation that centers the mesh on the marker origin.
//
// jsartoolkit reports the NFT pose with its origin at a marker corner, so the mesh
// must be shifted by half the marker's *real-world* size to sit at the center.
// The previous implementation used raw pixel counts (markerWidth / 2) instead of
// the DPI-scaled millimetre size — that is the "mesh-shift" bug: the offset was
// hundreds of units too large. See DESIGN.md finding #1.
export function computeCenterOffset(markerWidthPx, markerHeightPx, dpi) {
    return {
        x: pxToMm(markerWidthPx, dpi) / 2,
        y: pxToMm(markerHeightPx, dpi) / 2,
        z: 0,
    };
}

// Z translation (along the marker normal) that seats a mesh on the plane.
//
// The mesh is scaled by `scaleFactor`, so its scaled bottom sits at
// `scaleFactor * bboxMinZ`. When `lift` is true, we move that bottom to z=0 so
// the mesh rests ON the marker; when false, the mesh origin stays on the plane
// (centered), which avoids the parallax "lean" of a tall standing mesh.
export function computeLiftZ(bboxMinZ, scaleFactor, lift) {
    return lift ? -scaleFactor * bboxMinZ : 0;
}

// Normalize the matrixGL_RH payload (array-like or object) into a plain
// 16-number array. Returns null when the input is not a valid 4x4 matrix.
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

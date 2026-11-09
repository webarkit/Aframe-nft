/**
 * Hands what the tracker found in a frame to the `<a-nft>` components.
 *
 * Kept free of A-Frame / THREE / DOM so it can be unit-tested with a fake registry.
 *
 * @module frames
 */

/** @typedef {import('./markerRegistry').MarkerRegistry} MarkerRegistry */

/**
 * The next frame to process, or `null` when there is none.
 *
 * `getImage()` always returns an `ImageData`: between captures, a copy of the last
 * frame. Its `frame` counter says whether it captured, so a repeated frame is not
 * processed again (webarkit/Aframe-nft#12). The counter follows the frame-rate gate,
 * not the camera: a camera slower than `targetFrameRate` can still repeat a picture.
 *
 * @param {import('@webarkit/camera-view').CameraView} view
 * @returns {ImageData|null}
 */
export function nextFrame(view) {
    const before = view.frame;
    const image = view.getImage();
    return view.frame === before ? null : image;
}

/**
 * Route one `process()` result: each tracked target's pose to its records, and each
 * `lost` transition to `onLost()`.
 *
 * Ids with no record are skipped: a removed `<a-nft>` leaves its target loaded in
 * the tracker, which keeps reporting it. Several `<a-nft>` with the same url share
 * one tracker id and each receives the pose and `lost` transitions (webarkit/Aframe-nft#11).
 * `found` transitions are not used: a re-added `<a-nft>` can adopt a target that is
 * already tracked, which fires no new `found`, so a pose is what makes content visible.
 *
 * `{ skipped: true }` is the Worker's answer to a `process()` made while another was
 * in flight: it says nothing about any target.
 *
 * @param {MarkerRegistry} registry
 * @param {import('@webarkit/jsartoolkit-nft').FrameResult|{skipped: true}} result
 */
export function routeFrameResult(registry, result) {
    if (result.skipped) {
        return;
    }
    for (const target of result.targets) {
        if (target.pose) {
            for (const record of registry.recordsFor(target.id)) {
                record.component.onPose(target.pose, result.time);
            }
        }
    }
    for (const transition of result.transitions) {
        if (transition.type === 'lost') {
            for (const record of registry.recordsFor(transition.id)) {
                record.component.onLost();
            }
        }
    }
}

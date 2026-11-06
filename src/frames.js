/**
 * Hands what the tracker found in a frame to the `<a-nft>` components.
 *
 * Kept free of A-Frame / THREE / DOM so it can be unit-tested with a fake registry.
 *
 * @module frames
 */

/** @typedef {import('./markerRegistry').MarkerRegistry} MarkerRegistry */

/**
 * Route one `process()` result: each tracked target's pose to its record, and each
 * `lost` transition to `onLost()`.
 *
 * Ids with no record are skipped: a removed `<a-nft>` leaves its target loaded in
 * the tracker, which keeps reporting it. `found` transitions are not used: a re-added
 * `<a-nft>` can adopt a target that is already tracked, which fires no new `found`,
 * so a pose is what makes content visible.
 *
 * @param {MarkerRegistry} registry
 * @param {import('@webarkit/jsartoolkit-nft').FrameResult} result
 */
export function routeFrameResult(registry, result) {
    for (const target of result.targets) {
        if (target.pose) {
            registry.get(target.id)?.component.onPose(target.pose, result.time);
        }
    }
    for (const transition of result.transitions) {
        if (transition.type === 'lost') {
            registry.get(transition.id)?.component.onLost();
        }
    }
}

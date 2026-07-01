// Path: js/temporal/trajectory-anchor.js

/**
 * @fileoverview Pure helpers that keep a trajectory's ANCHOR (its earliest
 * keypoint, kp 0) bound 1:1 to the feature's home (authoring) position.
 *
 * The anchor IS the feature's start position: moving the feature relocates the
 * anchor, and moving the anchor relocates the feature. These helpers compute the
 * trajectory edits for the "feature moved" direction; the "anchor moved" direction
 * lives in the trajectory editor (it also owns the geometry write). No DOM / store
 * here so they stay unit-testable.
 */

import { normalizeTrajectory } from './temporal-model.js';

/**
 * Returns a chronologically-normalized copy of `trajetoria` with its anchor
 * (earliest keypoint) repositioned to [lng, lat] (its time preserved), or null
 * when there's no anchor or it already sits there (so callers can skip writing).
 *
 * @param {Array<{t:number, lng:number, lat:number}>|undefined} trajetoria
 * @param {number} lng
 * @param {number} lat
 * @returns {Array<{t:number, lng:number, lat:number}>|null}
 */
export function repositionAnchor(trajetoria, lng, lat) {
    if (!Array.isArray(trajetoria) || trajetoria.length === 0) return null;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
    const sorted = normalizeTrajectory(trajetoria);
    if (sorted.length === 0) return null;
    if (sorted[0].lng === lng && sorted[0].lat === lat) return null;
    return sorted.map((kp, i) => (i === 0 ? { ...kp, lng, lat } : { ...kp }));
}

/**
 * Decides how to re-anchor a trajectory feature that is being MOVED to `coords`
 * (its new home). Returns a property patch to merge into the moved feature
 * ({ trajetoria, [_temporalHome] }), or null when the move must not touch the
 * anchor.
 *
 * The move is only allowed to re-anchor when the feature currently sits at its
 * home/start position:
 *  - not temporally displaced (no `_temporalHome`) — the common case; or
 *  - displaced but parked at its home (cursor before the trajectory), detected by
 *    `fromCoords` matching `_temporalHome`.
 * For a feature displaced mid-trajectory a drag is transient (the next frame
 * re-interpolates it), so re-anchoring there would silently corrupt the start
 * point — return null instead. When the feature is displaced and re-anchored, the
 * patch also moves `_temporalHome`, so the persisted home follows the anchor.
 *
 * @param {Object} props - Feature properties (trajetoria, optional _temporalHome).
 * @param {[number, number]} coords - New home position [lng, lat].
 * @param {[number, number]} [fromCoords] - The feature's pre-move displayed coords.
 * @returns {{trajetoria: Array, _temporalHome?: [number, number]}|null}
 */
export function reanchorOnMove(props, coords, fromCoords) {
    const traj = props?.trajetoria;
    if (!Array.isArray(traj) || traj.length === 0) return null;
    if (!Array.isArray(coords) || !Number.isFinite(coords[0]) || !Number.isFinite(coords[1])) return null;

    const home = props._temporalHome;
    const displaced = Array.isArray(home);
    if (displaced) {
        const atHome = Array.isArray(fromCoords) && fromCoords[0] === home[0] && fromCoords[1] === home[1];
        if (!atHome) return null; // mid-trajectory drag is transient — don't re-anchor
    }

    const moved = repositionAnchor(traj, coords[0], coords[1]);
    if (!moved) return null;

    const patch = { trajetoria: moved };
    if (displaced) patch._temporalHome = [coords[0], coords[1]];
    return patch;
}

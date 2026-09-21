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
 *
 * DRAGGING THE FEATURE CARRIES THE WHOLE ROUTE, and until 2026-09-21 it carried only the
 * anchor here while the other two doors carried everything (achado E7). The same gesture had
 * three semantics: on the desktop `reanchorOnMove` moved kp 0 alone and the route DEFORMED
 * around it (a patrol dragged one town over had its first leg stretched across the map and
 * every other leg left behind); on the phone (`phone/phone-move-geometry.js`) and on
 * "Colar Aqui" (`tool_manager/clipboard-offset.js`) the route translated rigidly. Rigid is
 * what the operator means by dragging a moving feature, and it is what two of the three doors
 * already did, so this one joined them — through the SAME pure helper the other two call,
 * `translateKeypoints` (`@utils/geometry-utils.js`), never a second copy of the walk.
 *
 * DRAGGING THE KEYPOINT is the other gesture and it did NOT change: inside the editor, moving
 * handle 1 edits the departure and only the departure (`trajectory-edit-control.js`).
 */

import { normalizeTrajectory } from './temporal-model.js';
import { translateKeypoints } from '@utils/geometry-utils.js';

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
 * Decides how to move a trajectory feature that is being dragged to `coords` (its new home).
 * Returns a property patch to merge into the moved feature ({ trajetoria, [_temporalHome] }),
 * or null when the move must not touch the trajectory.
 *
 * THE WHOLE ROUTE TRANSLATES by the same delta the geometry travelled, and the anchor is then
 * pinned exactly onto `coords`. The pin is not redundant with the translation: it absorbs the
 * floating-point residue of `kp + (coords - kp)` and, more importantly, it REPAIRS a trajectory
 * whose kp 0 had drifted away from the home position, which is the invariant every other reader
 * of this pair assumes.
 *
 * WHERE THE DELTA COMES FROM: `fromCoords`, the feature's pre-move displayed position, which is
 * what all three owning controls already pass (`add_point_control.js`,
 * `add_military_symbol_control.js`, `add_coordination_measure_control.js`). Without it the
 * anchor itself is the origin, which is the same answer whenever the anchor invariant holds.
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

    const sorted = normalizeTrajectory(traj);
    if (sorted.length === 0) return null;

    const origin = Array.isArray(fromCoords) && Number.isFinite(fromCoords[0]) && Number.isFinite(fromCoords[1])
        ? [fromCoords[0], fromCoords[1]]
        : [sorted[0].lng, sorted[0].lat];

    const dLng = coords[0] - origin[0];
    const dLat = coords[1] - origin[1];
    // A GESTURE THAT MOVED NOTHING WRITES NOTHING, which is the contract the three controls
    // read: a null patch means "leave the properties alone". Comparing the delta and not the
    // resulting array keeps a drag that ends where it began from queueing a sync operation.
    if (dLng === 0 && dLat === 0) return null;

    const moved = translateKeypoints(sorted, dLng, dLat);
    if (!moved) return null;

    const patch = { trajetoria: repositionAnchor(moved, coords[0], coords[1]) ?? moved };
    if (displaced) patch._temporalHome = [coords[0], coords[1]];
    return patch;
}

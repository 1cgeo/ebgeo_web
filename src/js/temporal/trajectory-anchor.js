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
 * PASTE is the other direction, and it is NOT re-anchoring: a paste writes a new
 * feature elsewhere, so the whole route travels with it (`translateTrajectory` /
 * `translateOnPaste`). Reusing `reanchorOnMove` there moved kp 0 alone and left
 * the copy's route bending back to the original position.
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
 * Returns a chronologically-normalized copy of `trajetoria` with EVERY keypoint
 * displaced by `{dx, dy}` degrees, or null when there is no usable trajectory.
 *
 * This is the PASTE counterpart of `repositionAnchor`: a paste creates a copy of
 * the whole feature somewhere else, so the whole route travels with it. Moving
 * only the anchor (what a drag does) would leave the pasted copy's route running
 * back to the original one.
 *
 * A non-finite `dx`/`dy` yields the copy WITHOUT displacement instead of a route
 * full of NaN, so a broken offset degrades to "pasted in place", never to a
 * trajectory that can no longer be drawn.
 *
 * @param {Array<{t:number, lng:number, lat:number}>|undefined} trajetoria
 * @param {number} dx - Longitude delta in degrees.
 * @param {number} dy - Latitude delta in degrees.
 * @returns {Array<{t:number, lng:number, lat:number}>|null}
 */
export function translateTrajectory(trajetoria, dx, dy) {
    if (!Array.isArray(trajetoria) || trajetoria.length === 0) return null;
    const sorted = normalizeTrajectory(trajetoria);
    if (sorted.length === 0) return null;

    if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
        return sorted.map((kp) => ({ ...kp }));
    }

    return sorted.map((kp) => ({ ...kp, lng: kp.lng + dx, lat: kp.lat + dy }));
}

/**
 * Property patch for a trajectory feature being PASTED with offset `{dx, dy}`:
 * the whole route travels, and so does the persisted home (`_temporalHome`), so
 * a copy taken while the feature was temporally displaced keeps home and route
 * in the same relative position as the original.
 *
 * Unlike `reanchorOnMove` there is no "transient drag" case to refuse: a paste
 * writes a brand-new feature, never a live one.
 *
 * @param {Object} props - Feature properties (trajetoria, optional _temporalHome).
 * @param {number} dx - Longitude delta in degrees.
 * @param {number} dy - Latitude delta in degrees.
 * @returns {{trajetoria: Array, _temporalHome?: [number, number]}|null}
 */
export function translateOnPaste(props, dx, dy) {
    const moved = translateTrajectory(props?.trajetoria, dx, dy);
    if (!moved) return null;

    const patch = { trajetoria: moved };

    const home = props._temporalHome;
    if (Array.isArray(home) && Number.isFinite(home[0]) && Number.isFinite(home[1])) {
        patch._temporalHome = Number.isFinite(dx) && Number.isFinite(dy)
            ? [home[0] + dx, home[1] + dy]
            : [home[0], home[1]];
    }

    return patch;
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

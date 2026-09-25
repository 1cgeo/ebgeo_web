// Path: js/temporal/trajectory-tool/trajectory-edit-geometry.js

/**
 * @fileoverview Pure geometry helpers for the trajectory editor. The editor works
 * like the line tool: keypoints are vertices, with draggable vertex handles, drag
 * a midpoint handle to insert a keypoint, and right-click/long-press to remove one.
 *  - buildPathCollection: the connecting LineString through the keypoints;
 *  - buildHandleCollection: vertex + midpoint edit handles (a GeoJSON layer, not
 *    DOM markers — cheaper for dense trajectories and gives midpoint handles);
 *  - moveKeypoint / insertKeypointAtSegment / removeKeypoint: pure array edits;
 *  - isInAnchorRingHole / grabOffset: the screen arithmetic of the departure ring.
 * All operate on the chronologically-normalized keypoints, so handle indices and
 * edit indices refer to the same time-ordered sequence.
 */

import { normalizeTrajectory } from '../temporal-model.js';

/**
 * THE DEPARTURE HANDLE IS A RING, AND ITS HOLE BELONGS TO THE FEATURE (owner, 2026-09-24).
 *
 * Keypoint 0 is bound 1:1 to the feature's home position, so its handle sat EXACTLY on the centre
 * of the symbol, which is where a person grabs the symbol to drag it: the press moved only the
 * departure and the route was deformed. The handle is now painted as a ring around that centre and
 * a press inside the hole goes to the feature's body, the whole-route drag of `move_handler.js`.
 * The rejected alternatives: hiding the handle takes away the only way to edit the departure's
 * position (the panel does not edit positions), and moving it aside detaches it from the point it
 * stands for.
 *
 * MapLibre paints a circle's stroke OUTSIDE its radius, so the ring spans RADIUS to RADIUS + STROKE
 * pixels from the centre, and its hit area is the whole disc of that outer radius: the hole has to
 * be carved out in code, which is what `isInAnchorRingHole` is for. The hole stops short of the
 * painted band so a press on the inner edge of the ring still takes the ring.
 */
export const ANCHOR_RING_RADIUS_PX = 16;
/** Width, in screen pixels, of the departure ring's stroke. */
export const ANCHOR_RING_STROKE_PX = 4;
/** Below this distance from the departure's centre, in screen pixels, a press is the feature's. */
export const ANCHOR_RING_HOLE_PX = 12;

/**
 * Reads a screen position given as `{x, y}` (MapLibre's `Point`) or as `[x, y]`.
 * Only numbers are read: `Number(null)` is 0, and a missing coordinate must not become the corner
 * of the canvas.
 * @param {{x:number, y:number}|Array<number>} p - Screen position.
 * @returns {{x:number, y:number}} Pixels, `NaN` when unreadable.
 */
function screenXY(p) {
    const num = (v) => (typeof v === 'number' ? v : NaN);
    return {
        x: num(Array.isArray(p) ? p[0] : p?.x),
        y: num(Array.isArray(p) ? p[1] : p?.y),
    };
}

/**
 * Whether a screen point falls in the hole of the departure ring, the part that belongs to the
 * feature's body and not to the handle.
 *
 * AN UNREADABLE POSITION IS NOT IN THE HOLE: any non-finite input answers false, which keeps the
 * handle's answer from before the ring (the press is the handle's) instead of guessing.
 *
 * @param {{x:number, y:number}|Array<number>} point - The press, in screen pixels.
 * @param {{x:number, y:number}|Array<number>} centre - The departure projected on screen.
 * @param {number} [holePx] - Radius of the hole, in screen pixels.
 * @returns {boolean} True when the press is strictly closer to the centre than `holePx`.
 */
export function isInAnchorRingHole(point, centre, holePx = ANCHOR_RING_HOLE_PX) {
    const p = screenXY(point);
    const c = screenXY(centre);
    const distance = Math.hypot(p.x - c.x, p.y - c.y);
    return Number.isFinite(distance) && Number.isFinite(holePx) && distance < holePx;
}

/**
 * Where a press landed relative to the centre of the handle it took, in screen pixels.
 *
 * The drag of the ring keeps this offset between the pointer and the departure, so the departure
 * moves by what the pointer moved instead of jumping the ring's radius to land under the pointer
 * on the first move. A non-finite input gives a zero offset, which is the drag as it was before the
 * ring (the handle follows the pointer).
 *
 * @param {{x:number, y:number}|Array<number>} point - The press, in screen pixels.
 * @param {{x:number, y:number}|Array<number>} centre - The handle's centre, in screen pixels.
 * @returns {{dx:number, dy:number}} The offset, never `-0` and never `NaN`.
 */
export function grabOffset(point, centre) {
    const p = screenXY(point);
    const c = screenXY(centre);
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return { dx: 0, dy: 0 };
    // `+ 0` turns a `-0` into `0`: the offset is a screen distance, and a signed zero only shows up
    // as a surprise in a comparison.
    return { dx: dx + 0, dy: dy + 0 };
}

/**
 * Builds a FeatureCollection with a single time-ordered LineString through the
 * trajectory keypoints (empty when there are fewer than two valid keypoints).
 * @param {Array<{t:number, lng:number, lat:number}>} keypoints
 * @returns {{type:'FeatureCollection', features:Array}}
 */
export function buildPathCollection(keypoints) {
    const pts = normalizeTrajectory(keypoints);
    if (pts.length < 2) return { type: 'FeatureCollection', features: [] };

    return {
        type: 'FeatureCollection',
        features: [
            {
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: pts.map((k) => [k.lng, k.lat]) },
                properties: {},
            },
        ],
    };
}

/**
 * Builds the edit-handle FeatureCollection: one `vertex` handle per keypoint
 * (numbered in time order) plus one `midpoint` handle per segment (drag to insert).
 * Indices are into the time-ordered sequence, matching the edit helpers below.
 * @param {Array<{t:number, lng:number, lat:number}>} keypoints
 * @returns {{type:'FeatureCollection', features:Array}}
 */
export function buildHandleCollection(keypoints) {
    const pts = normalizeTrajectory(keypoints);
    const features = [];

    pts.forEach((kp, index) => {
        features.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [kp.lng, kp.lat] },
            properties: { role: 'handle', handleType: 'vertex', index, label: String(index + 1) },
        });
    });

    for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        features.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [(a.lng + b.lng) / 2, (a.lat + b.lat) / 2] },
            properties: { role: 'handle', handleType: 'midpoint', index: i },
        });
    }

    return { type: 'FeatureCollection', features };
}

/**
 * Moves the keypoint at `index` to a new position, keeping its time `t` (so the
 * chronological order is unchanged). Returns a new normalized array, or null when
 * the index/position is invalid.
 * @param {Array<{t:number, lng:number, lat:number}>} keypoints
 * @param {number} index
 * @param {number} lng
 * @param {number} lat
 * @returns {Array<{t:number, lng:number, lat:number}>|null}
 */
export function moveKeypoint(keypoints, index, lng, lat) {
    const pts = normalizeTrajectory(keypoints);
    if (index < 0 || index >= pts.length || !Number.isFinite(lng) || !Number.isFinite(lat)) return null;
    const next = pts.map((kp) => ({ ...kp }));
    next[index] = { ...next[index], lng, lat };
    return next;
}

/**
 * Inserts a keypoint into segment `segIndex` (between keypoints segIndex and
 * segIndex+1) at the given position. The new keypoint's time is the AVERAGE of its
 * neighbours' times, so it lands between them chronologically. Returns a new
 * normalized array, or null when the segment/position is invalid.
 * @param {Array<{t:number, lng:number, lat:number}>} keypoints
 * @param {number} segIndex - Segment index (0-based) to split.
 * @param {number} lng
 * @param {number} lat
 * @returns {Array<{t:number, lng:number, lat:number}>|null}
 */
export function insertKeypointAtSegment(keypoints, segIndex, lng, lat) {
    const pts = normalizeTrajectory(keypoints);
    if (segIndex < 0 || segIndex >= pts.length - 1 || !Number.isFinite(lng) || !Number.isFinite(lat)) return null;
    const t = (pts[segIndex].t + pts[segIndex + 1].t) / 2;
    const next = pts.map((kp) => ({ ...kp }));
    next.splice(segIndex + 1, 0, { t, lng, lat });
    return next;
}

/**
 * Removes the keypoint at `index`. Returns a new normalized array (possibly with
 * fewer than 2 keypoints — the render model then snaps the feature home), or null
 * when the index is invalid.
 * @param {Array<{t:number, lng:number, lat:number}>} keypoints
 * @param {number} index
 * @returns {Array<{t:number, lng:number, lat:number}>|null}
 */
export function removeKeypoint(keypoints, index) {
    const pts = normalizeTrajectory(keypoints);
    if (index < 0 || index >= pts.length) return null;
    const next = pts.map((kp) => ({ ...kp }));
    next.splice(index, 1);
    return next;
}

// Path: js/temporal/trajectory-tool/trajectory-edit-geometry.js

/**
 * @fileoverview Pure geometry helpers for the trajectory editor. The editor works
 * like the line tool: keypoints are vertices, with draggable vertex handles, drag
 * a midpoint handle to insert a keypoint, and right-click/long-press to remove one.
 *  - buildPathCollection: the connecting LineString through the keypoints;
 *  - buildHandleCollection: vertex + midpoint edit handles (a GeoJSON layer, not
 *    DOM markers — cheaper for dense trajectories and gives midpoint handles);
 *  - moveKeypoint / insertKeypointAtSegment / removeKeypoint: pure array edits.
 * All operate on the chronologically-normalized keypoints, so handle indices and
 * edit indices refer to the same time-ordered sequence.
 */

import { normalizeTrajectory } from '../temporal-model.js';

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

// Path: js/temporal/trajectory-tool/trajectory-edit-geometry.js

/**
 * @fileoverview Pure geometry helpers for the trajectory editor: building the
 * MapLibre preview FeatureCollection (numbered keypoints + connecting path) and
 * keypoint list mutations. No DOM / MapLibre — unit-testable.
 */

import { normalizeTrajectory } from '../temporal-model.js';

/**
 * Builds the preview FeatureCollection for a list of keypoints: one labelled
 * Point per keypoint plus a LineString path when there are at least two.
 * @param {Array<{t:number, lng:number, lat:number}>} keypoints
 * @returns {{type:'FeatureCollection', features:Array}}
 */
export function buildPreviewCollection(keypoints) {
    const pts = normalizeTrajectory(keypoints);
    const features = pts.map((kp, i) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [kp.lng, kp.lat] },
        properties: { index: i + 1, label: String(i + 1) },
    }));

    if (pts.length >= 2) {
        features.push({
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: pts.map((k) => [k.lng, k.lat]) },
            properties: { kind: 'path' },
        });
    }

    return { type: 'FeatureCollection', features };
}

/**
 * Appends a keypoint, preserving INSERTION order (so the editor can undo the
 * last click regardless of its timestamp). Sorting happens at preview/commit
 * time via normalizeTrajectory.
 * @param {Array} keypoints - Existing keypoints.
 * @param {number} t - Timestamp (epoch ms).
 * @param {number} lng - Longitude.
 * @param {number} lat - Latitude.
 * @returns {Array<{t:number, lng:number, lat:number}>}
 */
export function appendKeypoint(keypoints, t, lng, lat) {
    const list = Array.isArray(keypoints) ? keypoints.slice() : [];
    list.push({ t, lng, lat });
    return list;
}

/**
 * Removes the most-recently-added keypoint (last in insertion order), so a
 * right-click undoes the user's last click even when it was earlier in time.
 * @param {Array} keypoints
 * @returns {Array}
 */
export function removeLastKeypoint(keypoints) {
    const list = Array.isArray(keypoints) ? keypoints.slice() : [];
    list.pop();
    return list;
}

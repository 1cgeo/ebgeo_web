// Path: js/temporal/trajectory-tool/trajectory-edit-geometry.js

/**
 * @fileoverview Pure geometry helper for the trajectory editor: builds the
 * connecting-path FeatureCollection from a set of keypoints (the points
 * themselves are rendered as draggable map markers, not in this source).
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

// Path: js/temporal/temporal-render.service.js

/**
 * @fileoverview Applies temporal state to the live MapLibre map:
 *  - show/hide via the temporal clause in the layer visibility filters;
 *  - move trajectory-capable features by overriding their displayed geometry
 *    with interpolated coordinates (without mutating the stored feature).
 *
 * The displayed override is derived purely from each feature's `trajetoria`,
 * so re-applying any cursor is idempotent. The authoring position is stashed
 * once in `_temporalHome` so disabling temporal restores the stored geometry.
 */

import {
    setTemporalCursor,
    invalidateFilterCache,
    updateAllLayerFilters,
} from '../layers/visibility-filter.js';
import { TRAJECTORY_SOURCE_IDS } from './temporal.constants.js';
import { normalizeTrajectory, resolveTrajectoryTarget } from './temporal-model.js';

/**
 * Recomputes displayed coordinates for trajectory features in the moving
 * sources (points / military_symbols / coordination_measures).
 *
 * @param {Object} map - MapLibre map instance.
 * @param {number|null} cursor - Cursor (epoch ms), or null to restore home positions.
 * @returns {Promise<void>}
 */
export async function updateTrajectoryPositions(map, cursor) {
    if (!map) return;

    for (const sourceId of TRAJECTORY_SOURCE_IDS) {
        let source;
        try {
            source = map.getSource(sourceId);
        } catch {
            source = null;
        }
        if (!source || typeof source.getData !== 'function') continue;

        let data;
        try {
            data = await source.getData();
        } catch {
            continue;
        }
        if (!data || !Array.isArray(data.features) || data.features.length === 0) continue;

        let changed = false;
        for (const feature of data.features) {
            const props = feature.properties;
            if (!props || feature.geometry?.type !== 'Point') continue;

            // Stash the authoring (home) position the first time we displace a feature.
            const hasUsableTrajectory = normalizeTrajectory(props.trajetoria).length >= 2;
            if (hasUsableTrajectory && !Array.isArray(props._temporalHome) && Array.isArray(feature.geometry.coordinates)) {
                props._temporalHome = feature.geometry.coordinates.slice();
            }

            const { target, keepHome } = resolveTrajectoryTarget(props.trajetoria, props._temporalHome, cursor);
            // Drop the stash once we've snapped back home, so a re-added/re-moved
            // trajectory re-stashes a fresh home on the next pass.
            if (!keepHome) delete props._temporalHome;
            if (!Array.isArray(target)) continue;

            const cur = feature.geometry.coordinates;
            if (!cur || cur[0] !== target[0] || cur[1] !== target[1]) {
                feature.geometry.coordinates = [target[0], target[1]];
                changed = true;
            }
        }

        if (changed) {
            source.setData(data);
        }
    }
}

/**
 * Updates a single property on a feature inside a GeoJSON source (live only,
 * no persistence). Used when keypoint times are retimed from the timeline bar.
 *
 * @param {Object} map - MapLibre map instance.
 * @param {string} sourceId - Source ID.
 * @param {string} featureId - Target feature id.
 * @param {string} key - Property key to set.
 * @param {*} value - New value.
 * @returns {Promise<void>}
 */
export async function updateSourceFeatureProperty(map, sourceId, featureId, key, value) {
    if (!map) return;
    let source;
    try {
        source = map.getSource(sourceId);
    } catch {
        source = null;
    }
    if (!source || typeof source.getData !== 'function') return;

    const data = await source.getData();
    const feature = data?.features?.find(
        (f) => f.properties && String(f.properties.id) === String(featureId)
    );
    if (!feature) return;
    feature.properties[key] = value;
    source.setData(data);
}

/**
 * Applies the full temporal state to the map: visibility filters + trajectory
 * positions. Disabling clears the temporal clause and restores home positions.
 *
 * @param {Object} map - MapLibre map instance.
 * @param {{enabled: boolean, cursor: number}} state - Temporal state.
 * @returns {Promise<void>}
 */
export async function applyTemporalState(map, { enabled, cursor }) {
    if (!map) return;

    const effectiveCursor = enabled ? cursor : null;
    setTemporalCursor(effectiveCursor);
    invalidateFilterCache();
    updateAllLayerFilters(map);
    await updateTrajectoryPositions(map, effectiveCursor);
}

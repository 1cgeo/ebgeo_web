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
    setRevealMode,
    updateAllLayerFilters,
} from '../layers/visibility-filter.js';
import { FEATURE_LAYER_IDS, FEATURE_SOURCES } from '../layers/layer.constants.js';
import { getStateManager } from '../store';
import { TRAJECTORY_SOURCE_IDS } from './temporal.constants.js';
import { normalizeTrajectory, resolveTrajectoryTarget } from './temporal-model.js';

/** Sentinels at the edges of the JS Date range (used as "no bound"). */
const MIN_TS = -8.64e15;
const MAX_TS = 8.64e15;
/** Opacity multiplier applied to temporally out-of-window features in reveal mode. */
const REVEAL_DIM = 0.4;
/** Opacity paint properties to dim, by MapLibre layer type. */
const OPACITY_PROPS_BY_TYPE = {
    circle: ['circle-opacity', 'circle-stroke-opacity'],
    fill: ['fill-opacity'],
    line: ['line-opacity'],
    symbol: ['icon-opacity', 'text-opacity'],
    'fill-extrusion': ['fill-extrusion-opacity'],
};
/** Cache of each layer's original opacity paint value (`${layerId}|${prop}`). */
const originalOpacity = new Map();
/** Whether the dim paint override is currently applied to the layers. */
let dimApplied = false;

/**
 * Reveal mode: instead of hiding out-of-window features, render them dimmed so
 * they remain editable while it stays clear they are temporally hidden. Restores
 * the original opacity paint when reveal is off.
 * @param {Object} map - MapLibre map instance.
 * @param {number|null} cursor - Cursor (epoch ms).
 * @param {boolean} reveal - Whether reveal mode is active.
 */
export function applyRevealDim(map, cursor, reveal) {
    if (!map) return;
    const wantDim = reveal && Number.isFinite(cursor);
    // Hot-path guard: reveal mode is off (the playback default) and nothing is
    // currently dimmed, so there is nothing to restore — skip the full layer
    // sweep that would otherwise run get/setPaintProperty on every frame.
    if (!wantDim && !dimApplied) return;

    const dimCase = wantDim
        ? [
            'case',
            [
                'all',
                ['<=', ['coalesce', ['get', 'temporalInicio'], MIN_TS], cursor],
                ['>=', ['coalesce', ['get', 'temporalFim'], MAX_TS], cursor],
            ],
            1,
            REVEAL_DIM,
        ]
        : null;

    for (const layerId of FEATURE_LAYER_IDS) {
        let layer;
        try {
            layer = map.getLayer(layerId);
        } catch {
            layer = null;
        }
        if (!layer) continue;
        const props = OPACITY_PROPS_BY_TYPE[layer.type];
        if (!props) continue;

        for (const prop of props) {
            const key = `${layerId}|${prop}`;
            if (!originalOpacity.has(key)) {
                originalOpacity.set(key, map.getPaintProperty(layerId, prop));
            }
            const orig = originalOpacity.get(key);
            try {
                if (dimCase) {
                    map.setPaintProperty(layerId, prop, ['*', orig == null ? 1 : orig, dimCase]);
                } else {
                    map.setPaintProperty(layerId, prop, orig == null ? undefined : orig);
                }
            } catch {
                /* layer may not support this paint property — ignore */
            }
        }
    }
    dimApplied = wantDim;
}

/**
 * Source IDs known to currently hold ≥1 trajectory-capable feature. While this
 * is non-null, playback frames only query these sources instead of every moving
 * source. `null` means "unknown" — the next pass rescans all sources and rebuilds
 * the list. Reset via resetTrajectoryCache() whenever the feature set may have
 * changed (map switch, config change, trajectory edit — all of which resync).
 * @type {string[]|null}
 */
let activeTrajectorySources = null;

/**
 * Forces the next updateTrajectoryPositions() to rescan every moving source and
 * rebuild the active-source list. Called by the controller on every resync, so
 * newly added/removed trajectories are picked up.
 */
export function resetTrajectoryCache() {
    activeTrajectorySources = null;
}

/**
 * Recomputes displayed coordinates for trajectory features in the moving
 * sources (points / military_symbols / coordination_measures).
 *
 * During playback this runs every frame, so it avoids the expensive async
 * `source.getData()` round-trip for sources with no trajectory features: a full
 * rescan records which sources actually carry trajectories, and subsequent
 * frames touch only those (commonly none → the loop is a no-op).
 *
 * @param {Object} map - MapLibre map instance.
 * @param {number|null} cursor - Cursor (epoch ms), or null to restore home positions.
 * @returns {Promise<void>}
 */
export async function updateTrajectoryPositions(map, cursor) {
    if (!map) return;

    const rescan = activeTrajectorySources === null;
    const sourceIds = rescan ? TRAJECTORY_SOURCE_IDS : activeTrajectorySources;
    if (sourceIds.length === 0) return; // no moving features — nothing to recompute

    const displaced = new Map(); // featureId -> [lng, lat] for selection-box sync
    const nextActive = rescan ? [] : null;

    for (const sourceId of sourceIds) {
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
        let hasTrajectory = false;
        for (const feature of data.features) {
            const props = feature.properties;
            if (!props || feature.geometry?.type !== 'Point') continue;

            // Stash the authoring (home) position the first time we displace a feature.
            const hasUsableTrajectory = normalizeTrajectory(props.trajetoria).length >= 2;
            if (hasUsableTrajectory) hasTrajectory = true;
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
                if (props.id != null) displaced.set(String(props.id), [target[0], target[1]]);
                changed = true;
            }
        }

        if (rescan && hasTrajectory) nextActive.push(sourceId);
        if (changed) {
            source.setData(data);
        }
    }

    if (rescan) activeTrajectorySources = nextActive;

    syncSelectionGeometry(displaced);
}

/**
 * Keeps selected trajectory features' selection boxes aligned with their
 * displaced position: updates the selected feature objects' geometry and clears
 * their cached selectionBox so the highlight recomputes at the new location.
 * The highlight refresh itself is triggered by the controller (which holds uiManager).
 * @param {Map<string, [number, number]>} displaced
 */
function syncSelectionGeometry(displaced) {
    if (displaced.size === 0) return;
    let sm;
    try {
        sm = getStateManager();
    } catch {
        sm = null;
    }
    const items = sm?.getUnsafe?.('selection.features') || [];
    for (const item of items) {
        const feature = item?.feature;
        const id = feature?.properties?.id;
        const pos = id != null ? displaced.get(String(id)) : null;
        if (pos && feature.geometry?.type === 'Point') {
            feature.geometry.coordinates = [pos[0], pos[1]];
            feature.properties.selectionBox = null; // force recompute at the new position
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
 * Shifts every temporal timestamp on the live feature sources by `deltaMs`
 * (`temporalInicio`, `temporalFim`, trajectory keypoint `t`), mirroring the store
 * shift so the map reflects a changed relative origin without a full reload.
 * @param {Object} map - MapLibre map instance.
 * @param {number} deltaMs - Amount to add to each temporal timestamp.
 * @returns {Promise<void>}
 */
export async function shiftSourcesTemporal(map, deltaMs) {
    if (!map || !Number.isFinite(deltaMs) || deltaMs === 0) return;

    for (const sourceId of Object.values(FEATURE_SOURCES)) {
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
            const p = feature.properties;
            if (!p) continue;
            if (Number.isFinite(p.temporalInicio)) { p.temporalInicio += deltaMs; changed = true; }
            if (Number.isFinite(p.temporalFim)) { p.temporalFim += deltaMs; changed = true; }
            if (Array.isArray(p.trajetoria)) {
                for (const kp of p.trajetoria) {
                    if (kp && Number.isFinite(kp.t)) { kp.t += deltaMs; changed = true; }
                }
            }
        }

        if (changed) source.setData(data);
    }
}

/**
 * Applies the full temporal state to the map: visibility filters + trajectory
 * positions. Disabling clears the temporal clause and restores home positions.
 *
 * Show/hide and movement run at independent cadences: the `[filterStart, filterEnd]`
 * window (one timeline step, snapped to the step grid) drives the layer visibility
 * filters, so they only rebuild when the cursor crosses a step boundary — the
 * filter cache absorbs every intra-step frame. The raw `cursor` drives trajectory
 * interpolation, so moving features stay smooth even while show/hide steps by whole
 * units. When the window is omitted it falls back to the raw cursor (instantaneous).
 *
 * @param {Object} map - MapLibre map instance.
 * @param {{enabled: boolean, cursor: number, filterStart?: number, filterEnd?: number, reveal?: boolean}} state
 * @returns {Promise<void>}
 */
export async function applyTemporalState(map, { enabled, cursor, filterStart, filterEnd, reveal = false }) {
    if (!map) return;

    const effectiveCursor = enabled ? cursor : null;
    const winStart = enabled ? (Number.isFinite(filterStart) ? filterStart : cursor) : null;
    const winEnd = enabled ? (Number.isFinite(filterEnd) ? filterEnd : winStart) : null;
    const revealOn = enabled && reveal;
    setTemporalCursor(winStart, winEnd);
    // In reveal mode the hide-filter is suppressed and out-of-window features are
    // dimmed instead (so they stay visible/editable but clearly hidden).
    setRevealMode(revealOn);
    // No invalidateFilterCache() here: the filter cache keys off the (quantized)
    // window + reveal + visible-layer set, so it rebuilds exactly when one of
    // those changes and short-circuits the per-frame intra-step calls.
    updateAllLayerFilters(map);
    await updateTrajectoryPositions(map, effectiveCursor);
    applyRevealDim(map, effectiveCursor, revealOn);
}

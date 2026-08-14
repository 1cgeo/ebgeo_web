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
import { getGeoJsonDispatcher } from '@layers/geojson-dispatcher.js';
import { getStateManager } from '../store';
import { TRAJECTORY_SOURCE_IDS } from './temporal.constants.js';
import { normalizeTrajectory, resolveTrajectoryTargetNormalized } from './temporal-model.js';

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
                let original;
                try {
                    original = map.getPaintProperty(layerId, prop);
                } catch {
                    // Defensive: MapLibre throws if `prop` is not valid for this
                    // layer's type. `props` is already type-filtered, but guard anyway.
                    original = undefined;
                }
                originalOpacity.set(key, original);
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
 * Per-source playback state retained between frames, keyed by source id.
 *
 * `data` is the FeatureCollection this module last read from (or wrote to) the
 * source. Reusing it across frames removes the `getData()` worker round-trip — a
 * structured clone of the WHOLE collection — from every playback frame. But a
 * retained copy is only safe while we are still the last writer: any other
 * `setData()` (a point drawn, an attribute edited) makes it stale, and pushing a
 * stale copy back would silently revert that change on the map.
 *
 * `token` is the object the source itself holds as its data at the moment we
 * synced with it. When it no longer matches, the copy is dropped and re-read.
 * If MapLibre ever stops exposing that object the token reads `undefined`, which
 * is treated as "not ours": every frame re-reads and the behaviour degrades to
 * exactly what it was before this cache existed — never to a stale frame.
 *
 * `movers` is the subset of features that can actually move (usable trajectory
 * or a stashed home), each carrying its trajectory normalized ONCE at read time
 * instead of once per feature per frame.
 * @type {Map<string, {data: Object, token: *, movers: Array<{feature: Object, props: Object, traj: Array}>}>}
 */
const retainedSources = new Map();

/**
 * The object a MapLibre GeoJSONSource currently holds as its data. Private API on
 * purpose: there is no public equivalent, and it is read ONLY as an identity token
 * (never mutated), so an internal rename can only make it `undefined`, which fails
 * safe into a re-read.
 *
 * MEASURED, and it is the reason the playback frame below still writes with `setData`:
 * a single `GeoJSONSource.updateData` call swaps `_data` for an internal
 * `{ updateable: Map }`, so this token reads `undefined` from then on and stays that
 * way until the next whole-collection `setData` restores it. That degrades to a
 * re-read per frame, never to a stale frame, but it also means a diff-per-frame
 * playback loop would pay the full `getData` structured clone it exists to avoid.
 * @param {Object} source - MapLibre GeoJSON source.
 * @returns {*} Identity token, or undefined when unavailable.
 */
function sourceDataToken(source) {
    return source?._data?.geojson;
}

/**
 * Selects the features a temporal frame can actually move and normalizes each
 * trajectory once. A feature with no usable trajectory but a stashed
 * `_temporalHome` stays in the list so it can still be snapped back home.
 * @param {Object} data - FeatureCollection retained for a source.
 * @returns {Array<{feature: Object, props: Object, traj: Array}>}
 */
function collectMovers(data) {
    const movers = [];
    for (const feature of data.features) {
        const props = feature.properties;
        if (!props || feature.geometry?.type !== 'Point') continue;
        const traj = normalizeTrajectory(props.trajetoria);
        if (traj.length < 2 && !Array.isArray(props._temporalHome)) continue;
        movers.push({ feature, props, traj });
    }
    return movers;
}

/**
 * Returns the retained state for a source, re-reading it from the worker only
 * when someone else wrote to the source since the last frame (or on first use).
 * @param {Object} source - MapLibre GeoJSON source.
 * @param {string} sourceId - Source ID.
 * @returns {Promise<{data: Object, token: *, movers: Array}|null>}
 */
async function acquireSourceState(source, sourceId) {
    const entry = retainedSources.get(sourceId);
    // Read the token BEFORE awaiting: a write landing during the await must leave
    // the retained copy invalid for the next frame, not falsely fresh.
    const token = sourceDataToken(source);
    if (entry && token !== undefined && entry.token === token) return entry;

    let data;
    try {
        data = await source.getData();
    } catch {
        retainedSources.delete(sourceId);
        return null;
    }
    if (!data || !Array.isArray(data.features)) {
        retainedSources.delete(sourceId);
        return null;
    }

    const next = { data, token, movers: collectMovers(data) };
    retainedSources.set(sourceId, next);
    return next;
}

/**
 * Forces the next updateTrajectoryPositions() to rescan every moving source and
 * rebuild the active-source list. Called by the controller on every resync, so
 * newly added/removed trajectories are picked up. Also drops the retained
 * per-source data, so the next frame re-reads it from the worker.
 */
export function resetTrajectoryCache() {
    activeTrajectorySources = null;
    retainedSources.clear();
}

/**
 * Recomputes displayed coordinates for trajectory features in the moving
 * sources (points / military_symbols / coordination_measures).
 *
 * During playback this runs every frame, so it avoids the expensive async
 * `source.getData()` round-trip twice over: a full rescan records which sources
 * actually carry trajectories, and subsequent frames touch only those (commonly
 * none → the loop is a no-op); and for a source that does carry them the
 * collection read on the first frame is RETAINED and reused while we remain its
 * last writer (see `retainedSources`), so the frame mutates coordinates in place
 * and only pushes them back with `setData`.
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

        const state = await acquireSourceState(source, sourceId);
        if (!state) continue;

        let changed = false;
        let hasTrajectory = false;
        // Only the features that can move, with their trajectory already
        // normalized when the collection was read (it does not change while the
        // retained copy stays valid).
        for (const { feature, props, traj } of state.movers) {
            // Stash the authoring (home) position the first time we displace a feature.
            const hasUsableTrajectory = traj.length >= 2;
            if (hasUsableTrajectory) hasTrajectory = true;
            if (hasUsableTrajectory && !Array.isArray(props._temporalHome) && Array.isArray(feature.geometry.coordinates)) {
                props._temporalHome = feature.geometry.coordinates.slice();
            }

            const { target, keepHome } = resolveTrajectoryTargetNormalized(traj, props._temporalHome, cursor);
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
            // NOT a diff, on purpose, and this is the one write in the module that must stay
            // whole-collection: the frame already holds the retained copy, so `setData` costs a
            // single hand-off with no read, while a diff would blank the identity token above and
            // put the `getData` round-trip back on EVERY later frame. Frames also arrive with no
            // gap between them (~16 ms), which is inside the interval where back-to-back
            // `updateData` calls were measured to drop each other.
            source.setData(state.data);
            // We are the source's last writer again, so the retained copy stays
            // valid for the next frame.
            state.token = state.data;
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
 * no persistence). Used when a trajectory is committed from the editor and when
 * keypoint times are retimed from the attribute panel.
 *
 * One property of one feature is the smallest possible delta, so this goes through the
 * dispatcher as a `patch` instead of the read-modify-write of the whole collection it used
 * to be. Two things follow from that, both deliberate:
 *  - the collection is never read, so an unknown `featureId` is no longer detected. MapLibre
 *    no-ops an update on an absent key, which is the same outcome the old early return had;
 *  - `featureId` goes in RAW. It is the promoted key (`promoteId: 'id'` on the declaration),
 *    so the value that keyed the feature is the value that sits in `properties.id`; the old
 *    `String()` comparison would now MISS a numeric key rather than protect anything.
 *
 * The flush is awaited for the same reason the point tool awaits it: every other writer of
 * these sources (the playback frame below included) does read-modify-write with a raw
 * `setData`, and a raw `setData` discards a diff still queued in MapLibre. Draining here
 * keeps the queue empty between gestures.
 *
 * @param {Object} map - MapLibre map instance.
 * @param {string} sourceId - Source ID.
 * @param {string} featureId - Target feature id (the promoted key).
 * @param {string} key - Property key to set.
 * @param {*} value - New value.
 * @returns {Promise<void>}
 */
export async function updateSourceFeatureProperty(map, sourceId, featureId, key, value) {
    if (!map || featureId === null || featureId === undefined) return;
    let source;
    try {
        source = map.getSource(sourceId);
    } catch {
        source = null;
    }
    // `getData` is what distinguishes a GeoJSON source: without it the dispatcher has no
    // whole-collection path to fall back to when a diff fails.
    if (!source || typeof source.getData !== 'function') return;

    const dispatcher = getGeoJsonDispatcher(map, sourceId);
    dispatcher.patch(featureId, { setProps: { [key]: value } });
    await dispatcher.flush();

    // The retained copy predates this write, so drop it: the next frame re-reads (and
    // re-normalizes the trajectory just changed) instead of pushing the pre-edit state back.
    // Dropping it AFTER the flush is what makes the invalidation honest — a frame that ran
    // during the await cannot leave a copy behind that is missing this change.
    retainedSources.delete(sourceId);
}

/**
 * Shifts every temporal timestamp on the live feature sources by `deltaMs`
 * (`temporalInicio`, `temporalFim`, trajectory keypoint `t`), mirroring the store
 * shift so the map reflects a changed relative origin without a full reload.
 *
 * Stays on `setData` because the delta IS the collection: every timed feature in every
 * source moves, so a diff would carry one update entry per feature for the same O(N) cost
 * plus a per-feature key lookup.
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

        if (changed) {
            source.setData(data);
            // Every keypoint time just moved: whatever a playback frame retained
            // for this source describes the pre-shift world.
            retainedSources.delete(sourceId);
        }
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

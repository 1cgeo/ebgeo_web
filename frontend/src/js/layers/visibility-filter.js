// Path: js/layers/visibility-filter.js

/**
 * @fileoverview Layer visibility filter system for MapLibre.
 *
 * This module writes NO data: it hides and reveals through `map.setFilter` on layer ids, so it is
 * orthogonal to the diff dispatcher (`layers/geojson-dispatcher.js`) and has nothing to migrate.
 * The consequence matters to whoever migrates a source, though: hiding a feature does NOT remove
 * it from its source, so "ocultar" must never be implemented as a `{ remove }` diff. The filter
 * owns visibility and the source has to keep every feature, or the next step boundary has nothing
 * left to bring back.
 */

import { FEATURE_LAYER_IDS, HATCH_PATTERN_LAYERS, LAYER_ADDITIONAL_FILTERS } from './layer.constants.js';
import { getVisibleLayerIds } from '../store';

const VISIBLE_FILTER = ['!=', ['get', 'visivel'], false];

let cachedVisibleLayerIds = null;

/**
 * Active temporal window [start, end] (epoch ms), or null when temporal control
 * is off. A feature passes when its [temporalInicio, temporalFim] validity
 * overlaps this window. During playback the window spans one timeline step, so
 * the filters only change on step boundaries while the cursor advances smoothly.
 * For an instantaneous test, end === start.
 * @type {number|null}
 */
let activeTemporalCursor = null;
let activeTemporalCursorEnd = null;

/**
 * Reveal mode: when true the temporal hide-clause is suppressed so all features
 * stay rendered (out-of-window ones are dimmed elsewhere, not hidden).
 * @type {boolean}
 */
let revealMode = false;

/**
 * Sets (or clears) the temporal window used by the layer filters. A feature is
 * kept when its validity overlaps [cursor, cursorEnd]; with the default
 * `cursorEnd === cursor` this is the classic instantaneous test. Pass a wider
 * window (one timeline step) to keep features valid anywhere within the current
 * step visible for the whole step. Pass a null/non-finite `cursor` to disable
 * temporal filtering. Caller must follow with updateAllLayerFilters() to take effect.
 * @param {number|null} cursor - Window start (epoch ms), or null to disable.
 * @param {number} [cursorEnd=cursor] - Window end (epoch ms).
 */
export function setTemporalCursor(cursor, cursorEnd = cursor) {
    activeTemporalCursor = Number.isFinite(cursor) ? cursor : null;
    activeTemporalCursorEnd =
        activeTemporalCursor === null ? null
            : Number.isFinite(cursorEnd) ? Math.max(cursorEnd, activeTemporalCursor) : activeTemporalCursor;
}

/**
 * Enables/disables reveal mode (suppresses temporal hiding).
 * @param {boolean} on
 */
export function setRevealMode(on) {
    revealMode = !!on;
}

/** Sentinels at the edges of the JS Date range (used as "no bound"). */
const MIN_TS = -8.64e15;
const MAX_TS = 8.64e15;

/**
 * Builds a MapLibre predicate that keeps a feature only when its
 * [temporalInicio, temporalFim] window overlaps [windowStart, windowEnd].
 * Missing/null bounds coalesce to the date-range sentinels, so a feature without
 * temporal data is permanent. With windowEnd === windowStart this is the classic
 * "cursor inside the feature window" instantaneous test.
 * @param {number} windowStart - Window start (epoch ms).
 * @param {number} windowEnd - Window end (epoch ms).
 * @returns {Array} MapLibre filter expression.
 */
function buildTemporalFilter(windowStart, windowEnd) {
    return [
        'all',
        ['<=', ['coalesce', ['get', 'temporalInicio'], MIN_TS], windowEnd],
        ['>=', ['coalesce', ['get', 'temporalFim'], MAX_TS], windowStart],
    ];
}

/**
 * @returns {Array<Array>} Temporal clause(s) to append to a layer filter ([] when off).
 */
function temporalClauses() {
    if (activeTemporalCursor === null || revealMode) return [];
    return [buildTemporalFilter(activeTemporalCursor, activeTemporalCursorEnd ?? activeTemporalCursor)];
}

/**
 * Builds the layer membership filter for a set of visible layer IDs.
 * @param {string[]} visibleLayerIds
 * @returns {Array} MapLibre expression
 */
function buildLayerFilter(visibleLayerIds) {
    return ['in', ['coalesce', ['get', 'layerId'], 'default'], ['literal', visibleLayerIds]];
}

/**
 * Creates a visibility filter expression for MapLibre layers.
 * @param {string[]} visibleLayerIds - Array of visible layer IDs
 * @param {Array|null} [additionalFilters=null] - Additional filter expressions
 * @returns {Array} MapLibre filter expression
 */
export function createLayerVisibilityFilter(visibleLayerIds, additionalFilters) {
    const layerFilter = buildLayerFilter(visibleLayerIds);
    const extra = [...(additionalFilters || []), ...temporalClauses()];
    if (extra.length) {
        return ['all', VISIBLE_FILTER, layerFilter, ...extra];
    }
    return ['all', VISIBLE_FILTER, layerFilter];
}

/**
 * Creates a hatch pattern filter for fill layers.
 * @param {string[]} visibleLayerIds - Array of visible layer IDs
 * @param {boolean} hatchEnabled - Whether to filter for hatch (true) or solid (false)
 * @returns {Array} MapLibre filter expression
 */
export function createHatchLayerFilter(visibleLayerIds, hatchEnabled) {
    const hatchFilters = hatchEnabled
        ? [['==', ['get', 'hatchEnabled'], true], ['has', 'hatchPatternId']]
        : [['!=', ['get', 'hatchEnabled'], true]];

    return ['all', VISIBLE_FILTER, buildLayerFilter(visibleLayerIds), ...hatchFilters, ...temporalClauses()];
}

/**
 * Updates all layer filters on the map.
 * @param {Object} mapInstance - MapLibre map instance
 */
export function updateAllLayerFilters(mapInstance) {
    if (!mapInstance) return;

    const visibleLayerIds = getVisibleLayerIds();
    // Cheap cache key (runs every frame during playback): join the ids instead of
    // JSON.stringify — layer ids are plain strings, so a delimiter join is unique
    // enough and avoids the per-frame serializer cost.
    const cacheKey = `${activeTemporalCursor}|${activeTemporalCursorEnd}|${revealMode}|${visibleLayerIds.join(',')}`;
    if (cachedVisibleLayerIds === cacheKey) return;
    cachedVisibleLayerIds = cacheKey;

    FEATURE_LAYER_IDS.forEach(function (layerId) {
        if (!mapInstance.getLayer(layerId)) return;

        try {
            let filter;
            if (layerId in HATCH_PATTERN_LAYERS) {
                filter = createHatchLayerFilter(visibleLayerIds, HATCH_PATTERN_LAYERS[layerId]);
            } else {
                filter = createLayerVisibilityFilter(visibleLayerIds, LAYER_ADDITIONAL_FILTERS[layerId]);
            }
            mapInstance.setFilter(layerId, filter);
        } catch (error) {
            console.warn(`Error updating filter for ${layerId}:`, error);
        }
    });
}

/**
 * Clears the visibility filter cache.
 * Call when layer configuration changes.
 */
export function invalidateFilterCache() {
    cachedVisibleLayerIds = null;
}

/**
 * Updates visibility of DOM-based measurement labels to match layer visibility.
 * Measurement labels are MapLibre Markers (DOM elements) that bypass layer filters.
 * Reads layerId from data-layer-id attribute stored at label creation time.
 */
export function updateMeasurementLabelVisibility() {
    const labels = document.querySelectorAll('.measurement-label[data-feature-id]');
    if (labels.length === 0) return;

    const visibleSet = new Set(getVisibleLayerIds());

    for (const label of labels) {
        const layerId = label.dataset.layerId || 'default';
        const marker = label.closest('.maplibregl-marker');
        if (!marker) continue;

        marker.style.display = visibleSet.has(layerId) ? '' : 'none';
    }
}

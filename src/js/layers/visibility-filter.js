// Path: js/layers/visibility-filter.js

/**
 * @fileoverview Layer visibility filter system for MapLibre.
 */

import { FEATURE_LAYER_IDS, HATCH_PATTERN_LAYERS, LAYER_ADDITIONAL_FILTERS } from './layer.constants.js';
import { getVisibleLayerIds } from '../store';

const VISIBLE_FILTER = ['!=', ['get', 'visivel'], false];

let cachedVisibleLayerIds = null;

/**
 * Active temporal cursor (epoch ms) or null when temporal control is off.
 * When set, every feature layer also filters by temporal validity window.
 * @type {number|null}
 */
let activeTemporalCursor = null;

/**
 * Reveal mode: when true the temporal hide-clause is suppressed so all features
 * stay rendered (out-of-window ones are dimmed elsewhere, not hidden).
 * @type {boolean}
 */
let revealMode = false;

/**
 * Sets (or clears) the temporal cursor used by the layer filters.
 * Pass null to disable temporal filtering. Caller must follow with
 * invalidateFilterCache() + updateAllLayerFilters() to take effect.
 * @param {number|null} cursor - Epoch ms, or null to disable.
 */
export function setTemporalCursor(cursor) {
    activeTemporalCursor = Number.isFinite(cursor) ? cursor : null;
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
 * Builds a MapLibre predicate that keeps a feature only when the cursor falls
 * within its [temporalInicio, temporalFim] window. Missing/null bounds coalesce
 * to the date-range sentinels, so a feature without temporal data is permanent.
 * @param {number} cursor - Epoch ms.
 * @returns {Array} MapLibre filter expression.
 */
function buildTemporalFilter(cursor) {
    return [
        'all',
        ['<=', ['coalesce', ['get', 'temporalInicio'], MIN_TS], cursor],
        ['>=', ['coalesce', ['get', 'temporalFim'], MAX_TS], cursor],
    ];
}

/**
 * @returns {Array<Array>} Temporal clause(s) to append to a layer filter ([] when off).
 */
function temporalClauses() {
    if (activeTemporalCursor === null || revealMode) return [];
    return [buildTemporalFilter(activeTemporalCursor)];
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
    const cacheKey = `${activeTemporalCursor}|${revealMode}|${JSON.stringify(visibleLayerIds)}`;
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

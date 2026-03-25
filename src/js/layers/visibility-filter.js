// Path: js/layers/visibility-filter.js

/**
 * @fileoverview Layer visibility filter system for MapLibre.
 */

import { FEATURE_LAYER_IDS, HATCH_PATTERN_LAYERS, LAYER_ADDITIONAL_FILTERS } from './layer.constants.js';
import { getVisibleLayerIds } from '../store';

const VISIBLE_FILTER = ['!=', ['get', 'visivel'], false];

let cachedVisibleLayerIds = null;

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
    if (additionalFilters) {
        return ['all', VISIBLE_FILTER, layerFilter, ...additionalFilters];
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

    return ['all', VISIBLE_FILTER, buildLayerFilter(visibleLayerIds), ...hatchFilters];
}

/**
 * Updates all layer filters on the map.
 * @param {Object} mapInstance - MapLibre map instance
 */
export function updateAllLayerFilters(mapInstance) {
    if (!mapInstance) return;

    const visibleLayerIds = getVisibleLayerIds();
    const cacheKey = JSON.stringify(visibleLayerIds);
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

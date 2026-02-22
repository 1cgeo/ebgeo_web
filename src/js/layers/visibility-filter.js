// Path: js/layers/visibility-filter.js

/**
 * @fileoverview Layer visibility filter system for MapLibre.
 */

import { FEATURE_LAYER_IDS, HATCH_PATTERN_LAYERS } from './layer.constants.js';
import { getVisibleLayerIds } from '../store';

let cachedVisibleLayerIds = null;

/**
 * Creates a visibility filter expression for MapLibre layers.
 * @param {string[]} visibleLayerIds - Array of visible layer IDs
 * @param {Array|null} [additionalFilters=null] - Additional filter expressions
 * @returns {Array} MapLibre filter expression
 */
export function createLayerVisibilityFilter(visibleLayerIds, additionalFilters = null) {
    const layerFilter = [
        'in',
        ['coalesce', ['get', 'layerId'], 'default'],
        ['literal', visibleLayerIds]
    ];

    const baseFilters = [
        ['!=', ['get', 'visivel'], false],
        layerFilter
    ];

    if (additionalFilters) {
        return ['all', ...baseFilters, ...additionalFilters];
    }

    return ['all', ...baseFilters];
}

/**
 * Creates a hatch pattern filter for fill layers.
 * @param {string[]} visibleLayerIds - Array of visible layer IDs
 * @param {boolean} hatchEnabled - Whether to filter for hatch (true) or solid (false)
 * @returns {Array} MapLibre filter expression
 */
export function createHatchLayerFilter(visibleLayerIds, hatchEnabled) {
    const layerFilter = [
        'in',
        ['coalesce', ['get', 'layerId'], 'default'],
        ['literal', visibleLayerIds]
    ];

    if (hatchEnabled) {
        return [
            'all',
            ['!=', ['get', 'visivel'], false],
            layerFilter,
            ['==', ['get', 'hatchEnabled'], true],
            ['has', 'hatchPatternId']
        ];
    } else {
        return [
            'all',
            ['!=', ['get', 'visivel'], false],
            layerFilter,
            ['!=', ['get', 'hatchEnabled'], true]
        ];
    }
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

    FEATURE_LAYER_IDS.forEach(layerId => {
        if (!mapInstance.getLayer(layerId)) return;

        try {
            let newFilter;
            if (layerId in HATCH_PATTERN_LAYERS) {
                newFilter = createHatchLayerFilter(visibleLayerIds, HATCH_PATTERN_LAYERS[layerId]);
            } else {
                newFilter = createLayerVisibilityFilter(visibleLayerIds);
            }
            mapInstance.setFilter(layerId, newFilter);
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

// Path: js/layers/styles/layer.helpers.js

/**
 * @fileoverview Shared helpers for layer setup files.
 *
 * Eliminates repeated source/layer-existence checks across
 * shape, tactical, symbol, content, line, polygon and auxiliary layer modules.
 */

const EMPTY_FC = { type: 'FeatureCollection', features: [] };

/**
 * Creates a GeoJSON source with data, or updates it if it already exists.
 * @param {Object} map - MapLibre map instance
 * @param {string} id - Source ID
 * @param {Array} features - Array of GeoJSON features
 */
export function setOrCreateSource(map, id, features) {
    const fc = { type: 'FeatureCollection', features };

    if (map.getSource(id)) {
        map.getSource(id).setData(fc);
    } else {
        map.addSource(id, { type: 'geojson', data: fc });
    }
}

/**
 * Adds an empty GeoJSON source if it does not already exist.
 * @param {Object} map - MapLibre map instance
 * @param {string} id - Source ID
 */
export function ensureSource(map, id) {
    if (!map.getSource(id)) {
        map.addSource(id, { type: 'geojson', data: EMPTY_FC });
    }
}

/**
 * Adds a MapLibre layer if it does not already exist.
 * @param {Object} map - MapLibre map instance
 * @param {Object} layerDef - Full MapLibre layer definition (must include `id`)
 */
export function ensureLayer(map, layerDef) {
    if (!map.getLayer(layerDef.id)) {
        map.addLayer(layerDef);
    }
}

/**
 * MapLibre expression that maps `lineStyle` property values to dash arrays.
 * Reused by polygon, circle, rectangle, ellipse, and sector outline layers.
 */
export const LINE_STYLE_DASHARRAY = [
    'match',
    ['get', 'lineStyle'],
    'dashed', ['literal', [8, 4]],
    'dotted', ['literal', [2, 3]],
    'dash-dot', ['literal', [8, 4, 2, 4]],
    'long-dash', ['literal', [16, 6]],
    'short-dash', ['literal', [4, 4]],
    'dot-dot-dash', ['literal', [2, 2, 2, 2, 8, 2]],
    ['literal', [1, 0]],
];

/** Visibility filter used on most feature layers. */
export const VISIBLE_FILTER = ['!=', ['get', 'visivel'], false];

/** Filter for solid fill layers (visible + no hatch). */
export const SOLID_FILL_FILTER = [
    'all',
    ['!=', ['get', 'visivel'], false],
    ['!=', ['get', 'hatchEnabled'], true],
];

/** Filter for hatch-pattern fill layers (visible + hatch enabled + pattern present). */
export const HATCH_FILL_FILTER = [
    'all',
    ['!=', ['get', 'visivel'], false],
    ['==', ['get', 'hatchEnabled'], true],
    ['has', 'hatchPatternId'],
];

/** Standard Point type filter for edit-handle layers. */
export const POINT_TYPE_FILTER = ['==', '$type', 'Point'];

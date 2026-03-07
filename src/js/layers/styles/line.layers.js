// Path: js/layers/styles/line.layers.js

/**
 * @fileoverview Line and brush layer styles for MapLibre.
 */

import { getControl } from '../../store';

const EMPTY_FC = { type: 'FeatureCollection', features: [] };

/**
 * Wraps an array of features into a GeoJSON FeatureCollection.
 * @param {Array} features
 * @returns {Object}
 */
function fc(features) {
    return { type: 'FeatureCollection', features };
}

/**
 * Adds a GeoJSON source if it does not already exist.
 * @param {Object} map - MapLibre map instance
 * @param {string} id - Source ID
 */
function ensureSource(map, id) {
    if (!map.getSource(id)) {
        map.addSource(id, { type: 'geojson', data: EMPTY_FC });
    }
}

/**
 * Adds or updates a GeoJSON source with the given features.
 * @param {Object} map - MapLibre map instance
 * @param {string} id - Source ID
 * @param {Array} features - Array of GeoJSON features
 */
function upsertSource(map, id, features) {
    const data = fc(features);
    if (!map.getSource(id)) {
        map.addSource(id, { type: 'geojson', data });
    } else {
        map.getSource(id).setData(data);
    }
}

/**
 * Adds a layer if it does not already exist.
 * @param {Object} map - MapLibre map instance
 * @param {Object} layerDef - Full MapLibre layer definition
 */
function ensureLayer(map, layerDef) {
    if (!map.getLayer(layerDef.id)) {
        map.addLayer(layerDef);
    }
}

/**
 * Sets up line layers on the map.
 * @param {Object} features - Feature collection with lines
 * @param {Object} mapInstance - MapLibre map instance
 */
export function setupLineLayers(features, mapInstance) {
    upsertSource(mapInstance, 'lines', features.lines || []);
    ensureSource(mapInstance, 'line-feedback');
    ensureSource(mapInstance, 'line-edit-handles');

    ensureLayer(mapInstance, {
        id: 'line-feedback-layer',
        type: 'line',
        source: 'line-feedback',
        layout: {
            'line-cap': 'round',
            'line-join': 'round',
        },
        paint: {
            'line-color': '#ff0000',
            'line-width': 3,
            'line-dasharray': [2, 2],
            'line-opacity': 0.8,
        },
    });

    ensureLayer(mapInstance, {
        id: 'line-layer',
        type: 'line',
        source: 'lines',
        layout: {
            'line-cap': 'round',
            'line-join': 'round',
        },
        paint: {
            'line-color': ['get', 'lineColor'],
            'line-width': ['get', 'lineWidth'],
            'line-opacity': ['get', 'opacity'],
            'line-dasharray': [
                'match',
                ['get', 'lineStyle'],
                'dashed', ['literal', [8, 4]],
                'dotted', ['literal', [2, 3]],
                'dash-dot', ['literal', [8, 4, 2, 4]],
                'long-dash', ['literal', [16, 6]],
                'short-dash', ['literal', [4, 4]],
                'dot-dot-dash', ['literal', [2, 2, 2, 2, 8, 2]],
                ['literal', [1, 0]],
            ],
        },
        filter: ['!=', ['get', 'visivel'], false],
    });

    ensureLayer(mapInstance, {
        id: 'line-edit-handles-layer',
        type: 'circle',
        source: 'line-edit-handles',
        paint: {
            'circle-radius': 8,
            'circle-color': [
                'case',
                ['==', ['get', 'handleType'], 'vertex'], '#ff0000',
                ['==', ['get', 'handleType'], 'midpoint'], '#ffaa00',
                '#000000',
            ],
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 2,
            'circle-opacity': [
                'case',
                ['==', ['get', 'handleType'], 'midpoint'], 0.6,
                1.0,
            ],
        },
        filter: ['==', '$type', 'Point'],
    });
}

/**
 * Sets up brush layers on the map.
 * @param {Object} features - Feature collection with brushes
 * @param {Object} mapInstance - MapLibre map instance
 */
export function setupBrushLayers(features, mapInstance) {
    const brushControl = getControl('AddBrushControl');
    const correctedBrushes = brushControl
        ? brushControl.applyZoomCorrections(features.brushes)
        : features.brushes;

    upsertSource(mapInstance, 'brushes', correctedBrushes);
    ensureSource(mapInstance, 'brush-feedback');

    ensureLayer(mapInstance, {
        id: 'brush-layer',
        type: 'line',
        source: 'brushes',
        layout: {
            'line-cap': 'round',
            'line-join': 'round',
        },
        paint: {
            'line-color': ['get', 'lineColor'],
            'line-width': ['get', 'calculatedLineWidth'],
            'line-opacity': 1,
        },
        filter: ['!=', ['get', 'visivel'], false],
    });

    ensureLayer(mapInstance, {
        id: 'brush-feedback-layer',
        type: 'line',
        source: 'brush-feedback',
        layout: {
            'line-cap': 'round',
            'line-join': 'round',
        },
        paint: {
            'line-color': ['get', 'lineColor'],
            'line-width': ['get', 'lineWidth'],
            'line-opacity': 0.7,
        },
    });
}

// Path: js/layers/styles/line.layers.js

/**
 * @fileoverview Line and brush layer styles for MapLibre.
 */

import { getControl } from '../../store';
import {
    setOrCreateSource,
    ensureSource,
    ensureLayer,
    LINE_STYLE_DASHARRAY,
    VISIBLE_FILTER,
    POINT_TYPE_FILTER
} from './layer.helpers.js';

/**
 * Sets up line layers on the map.
 * @param {Object} features - Feature collection with lines
 * @param {Object} mapInstance - MapLibre map instance
 */
export function setupLineLayers(features, mapInstance) {
    setOrCreateSource(mapInstance, 'lines', features.lines || []);
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
            'line-dasharray': LINE_STYLE_DASHARRAY,
        },
        filter: VISIBLE_FILTER,
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
        filter: POINT_TYPE_FILTER,
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

    setOrCreateSource(mapInstance, 'brushes', correctedBrushes);
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
        filter: VISIBLE_FILTER,
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

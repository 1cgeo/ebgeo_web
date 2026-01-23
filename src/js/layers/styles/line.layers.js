// Path: js/layers/styles/line.layers.js

/**
 * @fileoverview Line and brush layer styles for MapLibre.
 */

import { getControl } from '../../store';

/**
 * Sets up line layers on the map.
 * @param {Object} features - Feature collection with lines
 * @param {Object} mapInstance - MapLibre map instance
 */
export function setupLineLayers(features, mapInstance) {
    if (!mapInstance.getSource('lines')) {
        mapInstance.addSource('lines', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: features.lines || []
            }
        });
    } else {
        mapInstance.getSource('lines').setData({
            type: 'FeatureCollection',
            features: features.lines || []
        });
    }

    if (!mapInstance.getSource('line-feedback')) {
        mapInstance.addSource('line-feedback', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    if (!mapInstance.getSource('line-edit-handles')) {
        mapInstance.addSource('line-edit-handles', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    if (!mapInstance.getLayer('line-feedback-layer')) {
        mapInstance.addLayer({
            id: 'line-feedback-layer',
            type: 'line',
            source: 'line-feedback',
            layout: {
                'line-cap': 'round',
                'line-join': 'round'
            },
            paint: {
                'line-color': '#ff0000',
                'line-width': 3,
                'line-dasharray': [2, 2],
                'line-opacity': 0.8
            }
        });
    }

    if (!mapInstance.getLayer('line-layer')) {
        mapInstance.addLayer({
            id: 'line-layer',
            type: 'line',
            source: 'lines',
            layout: {
                'line-cap': 'round',
                'line-join': 'round'
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
                    ['literal', [1, 0]]
                ]
            },
            filter: ['!=', ['get', 'visivel'], false]
        });
    }

    if (!mapInstance.getLayer('line-edit-handles-layer')) {
        mapInstance.addLayer({
            id: 'line-edit-handles-layer',
            type: 'circle',
            source: 'line-edit-handles',
            paint: {
                'circle-radius': 8,
                'circle-color': [
                    'case',
                    ['==', ['get', 'handleType'], 'vertex'], '#ff0000',
                    ['==', ['get', 'handleType'], 'midpoint'], '#ffaa00',
                    '#000000'
                ],
                'circle-stroke-color': '#ffffff',
                'circle-stroke-width': 2,
                'circle-opacity': [
                    'case',
                    ['==', ['get', 'handleType'], 'midpoint'], 0.6,
                    1.0
                ]
            },
            filter: ['==', '$type', 'Point']
        });
    }
}

/**
 * Sets up brush layers on the map.
 * @param {Object} features - Feature collection with brushes
 * @param {Object} mapInstance - MapLibre map instance
 */
export function setupBrushLayers(features, mapInstance) {
    const brushControl = getControl('AddBrushControl');

    let correctedBrushes = features.brushes;
    if (brushControl) {
        correctedBrushes = brushControl.applyZoomCorrections(features.brushes);
    }

    if (!mapInstance.getSource('brushes')) {
        mapInstance.addSource('brushes', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: correctedBrushes
            }
        });
    } else {
        mapInstance.getSource('brushes').setData({
            type: 'FeatureCollection',
            features: correctedBrushes
        });
    }

    if (!mapInstance.getSource('brush-feedback')) {
        mapInstance.addSource('brush-feedback', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    if (!mapInstance.getLayer('brush-layer')) {
        mapInstance.addLayer({
            id: 'brush-layer',
            type: 'line',
            source: 'brushes',
            layout: {
                'line-cap': 'round',
                'line-join': 'round'
            },
            paint: {
                'line-color': ['get', 'lineColor'],
                'line-width': ['get', 'calculatedLineWidth'],
                'line-opacity': 1
            },
            filter: ['!=', ['get', 'visivel'], false]
        });
    }

    if (!mapInstance.getLayer('brush-feedback-layer')) {
        mapInstance.addLayer({
            id: 'brush-feedback-layer',
            type: 'line',
            source: 'brush-feedback',
            layout: {
                'line-cap': 'round',
                'line-join': 'round'
            },
            paint: {
                'line-color': ['get', 'lineColor'],
                'line-width': ['get', 'lineWidth'],
                'line-opacity': 0.7
            }
        });
    }
}

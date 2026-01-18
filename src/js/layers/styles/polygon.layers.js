// Path: js/layers/styles/polygon.layers.js

/**
 * @fileoverview Polygon layer styles with hatch pattern support.
 */

import { HatchPatternGenerator } from '../../tool_manager';

/**
 * Sets up polygon layers on the map.
 * Includes both solid fill and hatch pattern layers.
 * @param {Object} features - Feature collection with polygons
 * @param {Object} mapInstance - MapLibre map instance
 */
export function setupPolygonLayers(features, mapInstance) {
    if (!mapInstance.getSource('polygons')) {
        mapInstance.addSource('polygons', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: features.polygons || []
            }
        });
    } else {
        mapInstance.getSource('polygons').setData({
            type: 'FeatureCollection',
            features: features.polygons || []
        });
    }

    if (!mapInstance.getSource('polygon-feedback')) {
        mapInstance.addSource('polygon-feedback', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    if (!mapInstance.getSource('polygon-edit-handles')) {
        mapInstance.addSource('polygon-edit-handles', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    const hatchGenerator = new HatchPatternGenerator();
    hatchGenerator.loadPatternsToMap(mapInstance, features.polygons || []);

    if (!mapInstance.getLayer('polygon-fill-layer')) {
        mapInstance.addLayer({
            id: 'polygon-fill-layer',
            type: 'fill',
            source: 'polygons',
            paint: {
                'fill-color': ['get', 'color'],
                'fill-opacity': ['get', 'opacity']
            },
            filter: [
                'all',
                ['!=', ['get', 'visivel'], false],
                ['!=', ['get', 'hatchEnabled'], true]
            ]
        });
    }

    if (!mapInstance.getLayer('polygon-fill-pattern-layer')) {
        mapInstance.addLayer({
            id: 'polygon-fill-pattern-layer',
            type: 'fill',
            source: 'polygons',
            paint: {
                'fill-opacity': ['get', 'opacity'],
                'fill-pattern': ['get', 'hatchPatternId']
            },
            filter: [
                'all',
                ['!=', ['get', 'visivel'], false],
                ['==', ['get', 'hatchEnabled'], true],
                ['has', 'hatchPatternId']
            ]
        });
    }

    if (!mapInstance.getLayer('polygon-feedback-layer')) {
        mapInstance.addLayer({
            id: 'polygon-feedback-layer',
            type: 'line',
            source: 'polygon-feedback',
            paint: {
                'line-color': '#ff0000',
                'line-width': 3,
                'line-dasharray': [2, 2],
                'line-opacity': 0.8
            }
        });
    }

    if (!mapInstance.getLayer('polygon-layer')) {
        mapInstance.addLayer({
            id: 'polygon-layer',
            type: 'line',
            source: 'polygons',
            paint: {
                'line-color': ['get', 'outlinecolor'],
                'line-width': ['get', 'size'],
                'line-opacity': 1,
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

    if (!mapInstance.getLayer('polygon-edit-handles-layer')) {
        mapInstance.addLayer({
            id: 'polygon-edit-handles-layer',
            type: 'circle',
            source: 'polygon-edit-handles',
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

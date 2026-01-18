// Path: js/layers/styles/shape.layers.js

/**
 * @fileoverview Shape layer styles (circle, rectangle, ellipse).
 */

import { HatchPatternGenerator } from '../../tool_manager';

/**
 * Sets up circle layers on the map.
 * @param {Object} features - Feature collection with circles
 * @param {Object} mapInstance - MapLibre map instance
 */
export function setupCircleLayers(features, mapInstance) {
    if (!mapInstance.getSource('circles')) {
        mapInstance.addSource('circles', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: features.circles
            }
        });
    } else {
        mapInstance.getSource('circles').setData({
            type: 'FeatureCollection',
            features: features.circles
        });
    }

    if (!mapInstance.getSource('circle-feedback')) {
        mapInstance.addSource('circle-feedback', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    if (!mapInstance.getSource('circle-edit-handles')) {
        mapInstance.addSource('circle-edit-handles', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    if (!mapInstance.getSource('circle-x-marks')) {
        mapInstance.addSource('circle-x-marks', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    const hatchGeneratorCircle = new HatchPatternGenerator();
    hatchGeneratorCircle.loadPatternsToMap(mapInstance, features.circles || []);

    if (!mapInstance.getLayer('circle-feedback-layer')) {
        mapInstance.addLayer({
            id: 'circle-feedback-layer',
            type: 'line',
            source: 'circle-feedback',
            paint: {
                'line-color': '#ff0000',
                'line-width': 3,
                'line-dasharray': [2, 2],
                'line-opacity': 0.8
            }
        });
    }

    if (!mapInstance.getLayer('circle-fill-layer')) {
        mapInstance.addLayer({
            id: 'circle-fill-layer',
            type: 'fill',
            source: 'circles',
            paint: {
                'fill-color': ['get', 'fillColor'],
                'fill-opacity': ['get', 'opacity']
            },
            filter: [
                'all',
                ['!=', ['get', 'visivel'], false],
                ['!=', ['get', 'hatchEnabled'], true]
            ]
        });
    }

    if (!mapInstance.getLayer('circle-fill-pattern-layer')) {
        mapInstance.addLayer({
            id: 'circle-fill-pattern-layer',
            type: 'fill',
            source: 'circles',
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

    if (!mapInstance.getLayer('circle-layer')) {
        mapInstance.addLayer({
            id: 'circle-layer',
            type: 'line',
            source: 'circles',
            paint: {
                'line-color': ['get', 'lineColor'],
                'line-width': ['get', 'lineWidth'],
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

    if (!mapInstance.getLayer('circle-edit-handles-layer')) {
        mapInstance.addLayer({
            id: 'circle-edit-handles-layer',
            type: 'circle',
            source: 'circle-edit-handles',
            paint: {
                'circle-radius': 8,
                'circle-color': '#ff0000',
                'circle-stroke-color': '#ffffff',
                'circle-stroke-width': 2
            },
            filter: ['==', '$type', 'Point']
        });
    }
}

/**
 * Sets up rectangle layers on the map.
 * @param {Object} features - Feature collection with rectangles
 * @param {Object} mapInstance - MapLibre map instance
 */
export function setupRectangleLayers(features, mapInstance) {
    if (!mapInstance.getSource('rectangles')) {
        mapInstance.addSource('rectangles', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: features.rectangles
            }
        });
    } else {
        mapInstance.getSource('rectangles').setData({
            type: 'FeatureCollection',
            features: features.rectangles
        });
    }

    if (!mapInstance.getSource('rectangle-feedback')) {
        mapInstance.addSource('rectangle-feedback', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    if (!mapInstance.getSource('rectangle-edit-handles')) {
        mapInstance.addSource('rectangle-edit-handles', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    const hatchGenerator = new HatchPatternGenerator();
    hatchGenerator.loadPatternsToMap(mapInstance, features.rectangles || []);

    if (!mapInstance.getLayer('rectangle-feedback-layer')) {
        mapInstance.addLayer({
            id: 'rectangle-feedback-layer',
            type: 'line',
            source: 'rectangle-feedback',
            paint: {
                'line-color': '#ff0000',
                'line-width': 3,
                'line-dasharray': [2, 2],
                'line-opacity': 0.8
            }
        });
    }

    if (!mapInstance.getLayer('rectangle-fill-layer')) {
        mapInstance.addLayer({
            id: 'rectangle-fill-layer',
            type: 'fill',
            source: 'rectangles',
            paint: {
                'fill-color': ['get', 'fillColor'],
                'fill-opacity': ['get', 'opacity']
            },
            filter: [
                'all',
                ['!=', ['get', 'visivel'], false],
                ['!=', ['get', 'hatchEnabled'], true]
            ]
        });
    }

    if (!mapInstance.getLayer('rectangle-fill-pattern-layer')) {
        mapInstance.addLayer({
            id: 'rectangle-fill-pattern-layer',
            type: 'fill',
            source: 'rectangles',
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

    if (!mapInstance.getLayer('rectangle-layer')) {
        mapInstance.addLayer({
            id: 'rectangle-layer',
            type: 'line',
            source: 'rectangles',
            paint: {
                'line-color': ['get', 'lineColor'],
                'line-width': ['get', 'lineWidth'],
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

    if (!mapInstance.getLayer('rectangle-edit-handles-layer')) {
        mapInstance.addLayer({
            id: 'rectangle-edit-handles-layer',
            type: 'circle',
            source: 'rectangle-edit-handles',
            paint: {
                'circle-radius': 8,
                'circle-color': [
                    'case',
                    ['==', ['get', 'handleType'], 'vertex'], '#ff0000',
                    ['==', ['get', 'handleType'], 'eccentricity'], '#0066ff',
                    '#ffffff'
                ],
                'circle-stroke-color': '#ffffff',
                'circle-stroke-width': 2
            },
            filter: ['==', '$type', 'Point']
        });
    }
}

/**
 * Sets up ellipse layers on the map.
 * @param {Object} features - Feature collection with ellipses
 * @param {Object} mapInstance - MapLibre map instance
 */
export function setupEllipseLayers(features, mapInstance) {
    if (!mapInstance.getSource('ellipses')) {
        mapInstance.addSource('ellipses', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: features.ellipses
            }
        });
    } else {
        mapInstance.getSource('ellipses').setData({
            type: 'FeatureCollection',
            features: features.ellipses
        });
    }

    if (!mapInstance.getSource('ellipse-feedback')) {
        mapInstance.addSource('ellipse-feedback', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    if (!mapInstance.getSource('ellipse-edit-handles')) {
        mapInstance.addSource('ellipse-edit-handles', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    const hatchGeneratorEllipse = new HatchPatternGenerator();
    hatchGeneratorEllipse.loadPatternsToMap(mapInstance, features.ellipses || []);

    if (!mapInstance.getLayer('ellipse-feedback-layer')) {
        mapInstance.addLayer({
            id: 'ellipse-feedback-layer',
            type: 'line',
            source: 'ellipse-feedback',
            paint: {
                'line-color': '#ff0000',
                'line-width': 3,
                'line-dasharray': [2, 2],
                'line-opacity': 0.8
            }
        });
    }

    if (!mapInstance.getLayer('ellipse-fill-layer')) {
        mapInstance.addLayer({
            id: 'ellipse-fill-layer',
            type: 'fill',
            source: 'ellipses',
            paint: {
                'fill-color': ['get', 'fillColor'],
                'fill-opacity': ['get', 'opacity']
            },
            filter: [
                'all',
                ['!=', ['get', 'visivel'], false],
                ['!=', ['get', 'hatchEnabled'], true]
            ]
        });
    }

    if (!mapInstance.getLayer('ellipse-fill-pattern-layer')) {
        mapInstance.addLayer({
            id: 'ellipse-fill-pattern-layer',
            type: 'fill',
            source: 'ellipses',
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

    if (!mapInstance.getLayer('ellipse-layer')) {
        mapInstance.addLayer({
            id: 'ellipse-layer',
            type: 'line',
            source: 'ellipses',
            paint: {
                'line-color': ['get', 'lineColor'],
                'line-width': ['get', 'lineWidth'],
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

    if (!mapInstance.getLayer('ellipse-edit-handles-layer')) {
        mapInstance.addLayer({
            id: 'ellipse-edit-handles-layer',
            type: 'circle',
            source: 'ellipse-edit-handles',
            paint: {
                'circle-radius': 8,
                'circle-color': [
                    'case',
                    ['==', ['get', 'handleType'], 'vertex'], '#ff0000',
                    ['==', ['get', 'handleType'], 'eccentricity'], '#0066ff',
                    '#ffffff'
                ],
                'circle-stroke-color': '#ffffff',
                'circle-stroke-width': 2
            },
            filter: ['==', '$type', 'Point']
        });
    }
}

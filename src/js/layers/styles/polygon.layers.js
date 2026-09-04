// Path: js/layers/styles/polygon.layers.js

/**
 * @fileoverview Polygon layer styles with hatch pattern support.
 */

import { getHatchPatternGenerator } from '../../tool_manager';
import { syncLabelSource } from '../../tool_manager/helpers/label-tab.helpers.js';
import { zoomScaledExpression } from './zoom-expression.js';
// Label sizes scale on the GPU (zoom-expression.js); the label pass of each tool
// only refreshes `labelCalculatedSize` at the end of a gesture.
const LABEL_SIZE = { base: ['coalesce', ['get', 'labelSize'], 14], anchor: 'labelCreatedAtZoom', disabledFlag: 'labelZoomCorrectionEnabled', maxValue: 255 };


/**
 * Sets up polygon layers on the map.
 * Includes both solid fill and hatch pattern layers.
 * @param {Object} features - Feature collection with polygons
 * @param {Object} mapInstance - MapLibre map instance
 */
export function setupPolygonLayers(features, mapInstance) {
    const polygons = features.polygons || [];
    const data = { type: 'FeatureCollection', features: polygons };

    if (!mapInstance.getSource('polygons')) {
        mapInstance.addSource('polygons', { type: 'geojson', data });
    } else {
        mapInstance.getSource('polygons').setData(data);
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

    if (!mapInstance.getSource('polygon-labels')) {
        mapInstance.addSource('polygon-labels', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    const hatchGenerator = getHatchPatternGenerator();
    hatchGenerator.loadPatternsToMap(mapInstance, polygons);

    if (!mapInstance.getLayer('polygon-fill-layer')) {
        mapInstance.addLayer({
            id: 'polygon-fill-layer',
            type: 'fill',
            source: 'polygons',
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
                'line-color': ['get', 'lineColor'],
                'line-width': ['get', 'lineWidth'],
                'line-opacity': 1,
                'line-dasharray': [
                    'match',
                    ['get', 'lineStyle'],
                    'dashed', ['literal', [8, 4]],
                    'dotted', ['literal', [2, 3]],
                    'dash-dot', ['literal', [8, 4, 2, 4]],
                    'long-dash', ['literal', [16, 6]],
                    'short-dash', ['literal', [4, 4]],
                    'dot-dot-dash', ['literal', [2, 2, 2, 2, 8, 2]],
                    ['literal', [1, 0]]
                ]
            },
            filter: ['!=', ['get', 'visivel'], false]
        });
    }

    if (!mapInstance.getLayer('polygon-label-layer')) {
        mapInstance.addLayer({
            id: 'polygon-label-layer',
            type: 'symbol',
            source: 'polygon-labels',
            filter: [
                'all',
                ['==', ['get', 'showLabel'], true],
                ['!=', ['get', 'visivel'], false],
                ['has', 'labelText'],
                ['!=', ['get', 'labelText'], ''],
            ],
            layout: {
                'text-field': ['get', 'labelText'],
                'text-size': zoomScaledExpression(LABEL_SIZE),
                'text-font': ['Noto Sans Bold'],
                'text-anchor': 'center',
                'text-allow-overlap': true,
                'text-ignore-placement': true,
            },
            paint: {
                'text-color': ['coalesce', ['get', 'labelColor'], '#ffffff'],
                'text-halo-color': ['coalesce', ['get', 'labelOutlineColor'], '#000000'],
                'text-halo-width': ['coalesce', ['get', 'labelOutlineWidth'], 2],
                'text-opacity': 1,
            },
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

    // Populate label source with centroids from initial features
    syncLabelSource(mapInstance, 'polygon-labels', data);
}

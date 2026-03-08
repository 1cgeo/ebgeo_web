// Path: js/layers/styles/point.layers.js

import {
    setOrCreateSource,
    ensureSource,
    ensureLayer,
} from './layer.helpers.js';

/**
 * Filter for circle-type markers (default or explicit 'circle').
 */
const CIRCLE_MARKER_FILTER = [
    'all',
    ['!=', ['get', 'visivel'], false],
    ['any',
        ['!', ['has', 'markerSymbol']],
        ['==', ['get', 'markerSymbol'], 'circle'],
    ],
];

/**
 * Filter for non-circle symbol markers.
 */
const SYMBOL_MARKER_FILTER = [
    'all',
    ['!=', ['get', 'visivel'], false],
    ['has', 'markerSymbol'],
    ['!=', ['get', 'markerSymbol'], 'circle'],
];

/**
 * Sets up point layers on the map.
 * @param {Object} features - Feature collection with points
 * @param {Object} mapInstance - MapLibre map instance
 */
export function setupPointLayers(features, mapInstance) {
    setOrCreateSource(mapInstance, 'points', features.points || []);
    ensureSource(mapInstance, 'point-feedback');

    // Circle markers (default symbol or no symbol set)
    ensureLayer(mapInstance, {
        id: 'point-layer',
        type: 'circle',
        source: 'points',
        paint: {
            'circle-radius': ['get', 'size'],
            'circle-color': ['get', 'fillColor'],
            'circle-opacity': ['get', 'opacity'],
            'circle-stroke-color': ['coalesce', ['get', 'lineColor'], 'transparent'],
            'circle-stroke-width': ['coalesce', ['get', 'lineWidth'], 0],
        },
        filter: CIRCLE_MARKER_FILTER,
    });

    // Symbol markers (non-circle shapes rendered as SDF icons)
    ensureLayer(mapInstance, {
        id: 'point-symbol-layer',
        type: 'symbol',
        source: 'points',
        filter: SYMBOL_MARKER_FILTER,
        layout: {
            'icon-image': ['concat', 'marker-', ['get', 'markerSymbol']],
            'icon-size': [
                'interpolate', ['linear'], ['coalesce', ['get', 'size'], 10],
                6, 0.4,
                10, 0.6,
                20, 1.0,
            ],
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
        },
        paint: {
            'icon-color': ['coalesce', ['get', 'fillColor'], '#3f4fb5'],
            'icon-opacity': ['coalesce', ['get', 'opacity'], 1],
        },
    });

    ensureLayer(mapInstance, {
        id: 'point-feedback-layer',
        type: 'circle',
        source: 'point-feedback',
        paint: {
            'circle-radius': ['coalesce', ['get', 'size'], 8],
            'circle-color': ['coalesce', ['get', 'fillColor'], '#ff0000'],
            'circle-opacity': ['coalesce', ['get', 'opacity'], 0.8],
            'circle-stroke-color': ['coalesce', ['get', 'lineColor'], 'transparent'],
            'circle-stroke-width': ['coalesce', ['get', 'lineWidth'], 0],
        },
    });

    ensureLayer(mapInstance, {
        id: 'point-label-layer',
        type: 'symbol',
        source: 'points',
        filter: [
            'all',
            ['==', ['get', 'showLabel'], true],
            ['!=', ['get', 'visivel'], false],
            ['has', 'labelText'],
            ['!=', ['get', 'labelText'], ''],
        ],
        layout: {
            'text-field': ['get', 'labelText'],
            'text-size': ['coalesce', ['get', 'labelCalculatedSize'], 14],
            'text-font': ['Noto Sans Bold'],
            'text-offset': [0.8, -0.8],
            'text-anchor': 'bottom-left',
            'text-allow-overlap': true,
            'text-ignore-placement': true,
        },
        paint: {
            'text-color': ['coalesce', ['get', 'labelColor'], '#ffffff'],
            'text-halo-color': ['coalesce', ['get', 'labelOutlineColor'], '#000000'],
            'text-halo-width': ['coalesce', ['get', 'labelOutlineWidth'], 2],
            'text-opacity': ['coalesce', ['get', 'opacity'], 1],
        },
    });
}

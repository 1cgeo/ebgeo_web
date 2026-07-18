// Path: js/layers/styles/point.layers.js

import {
    setOrCreateSource,
    ensureSource,
    ensureLayer,
} from './layer.helpers.js';
import { LAYER_ADDITIONAL_FILTERS } from '../layer.constants.js';
import { POINT_IMAGE_HALF_SIZE } from '../../draw_tools/point_tool/point-marker-symbols.js';
import { getControl } from '../../store';

/** Filter for circle-type markers (default or explicit 'circle'). */
const CIRCLE_MARKER_FILTER = [
    'all',
    ['!=', ['get', 'visivel'], false],
    ...LAYER_ADDITIONAL_FILTERS['point-layer'],
];

/** Filter for non-circle markers rendered as per-feature images. */
const MARKER_FILTER = [
    'all',
    ['!=', ['get', 'visivel'], false],
    ...LAYER_ADDITIONAL_FILTERS['point-marker-layer'],
];

/**
 * Sets up point layers on the map.
 * @param {Object} features - Feature collection with points
 * @param {Object} mapInstance - MapLibre map instance
 */
export function setupPointLayers(features, mapInstance) {
    const pointControl = getControl('AddPointControl');
    const correctedPoints = pointControl
        ? pointControl.applyZoomCorrections(features.points || [])
        : (features.points || []);

    setOrCreateSource(mapInstance, 'points', correctedPoints);
    ensureSource(mapInstance, 'point-feedback');

    // Circle markers (default symbol or no symbol set)
    ensureLayer(mapInstance, {
        id: 'point-layer',
        type: 'circle',
        source: 'points',
        paint: {
            'circle-radius': ['coalesce', ['get', 'calculatedSize'], ['get', 'size']],
            'circle-color': ['get', 'fillColor'],
            'circle-opacity': ['get', 'opacity'],
            'circle-stroke-color': ['coalesce', ['get', 'lineColor'], 'transparent'],
            'circle-stroke-width': ['coalesce', ['get', 'lineWidth'], 0],
            'circle-stroke-opacity': ['get', 'opacity'],
        },
        filter: CIRCLE_MARKER_FILTER,
    });

    // Per-feature image markers (shapes + icons with baked-in colors/borders)
    ensureLayer(mapInstance, {
        id: 'point-marker-layer',
        type: 'symbol',
        source: 'points',
        filter: MARKER_FILTER,
        layout: {
            'icon-image': ['get', 'id'],
            'icon-size': ['/', ['coalesce', ['get', 'calculatedSize'], ['get', 'size'], 10], POINT_IMAGE_HALF_SIZE],
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
        },
        paint: {
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
            ['!=', ['get', 'visivel'], false],
            ...LAYER_ADDITIONAL_FILTERS['point-label-layer'],
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

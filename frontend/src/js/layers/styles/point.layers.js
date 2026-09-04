// Path: js/layers/styles/point.layers.js

import {
    setOrCreateSource,
    ensureSource,
    ensureLayer,
} from './layer.helpers.js';
import { LAYER_ADDITIONAL_FILTERS } from '../layer.constants.js';
import { POINT_IMAGE_HALF_SIZE } from '../../draw_tools/point_tool/point-marker-symbols.js';
import { getControl } from '../../store';
import { zoomScaledExpression } from './zoom-expression.js';

// Sizes scale on the GPU with the zoom (see zoom-expression.js); the JavaScript
// pass only refreshes the stored `calculatedSize` at the end of a gesture.
// The clamps mirror MAX_POINT_RADIUS and MAX_LABEL_SIZE in add_point_control.js,
// and `anchorDefault: 0` mirrors the `props.sizeCreatedAtZoom || 0` that pass uses.
const POINT_SIZE = { base: ['coalesce', ['get', 'size'], 10], anchor: 'sizeCreatedAtZoom', anchorDefault: 0, disabledFlag: 'sizeZoomCorrectionEnabled', maxValue: 500 };
const POINT_LABEL_SIZE = { base: ['coalesce', ['get', 'labelSize'], 14], anchor: 'labelCreatedAtZoom', disabledFlag: 'labelZoomCorrectionEnabled', maxValue: 255 };

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
            'circle-radius': zoomScaledExpression(POINT_SIZE),
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
            'icon-size': zoomScaledExpression({ ...POINT_SIZE, divideBy: POINT_IMAGE_HALF_SIZE }),
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
            'text-size': zoomScaledExpression(POINT_LABEL_SIZE),
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

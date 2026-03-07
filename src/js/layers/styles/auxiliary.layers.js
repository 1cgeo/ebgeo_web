// Path: js/layers/styles/auxiliary.layers.js

/**
 * @fileoverview Auxiliary layer styles (selection, feedback, separators, snap indicator).
 */

import {
    SNAP_INDICATOR_SOURCE,
    SNAP_INDICATOR_LAYER,
    SNAP_INDICATOR_STYLE,
} from '../../snapping/snapping.constants.js';
import { ensureSource, ensureLayer } from './layer.helpers.js';

/**
 * Sets up layer separators for ordering control.
 * @param {Object} mapInstance - MapLibre map instance
 */
export function setupLayerSeparators(mapInstance) {
    const separators = ['analysis-separator', 'features-separator'];

    for (const name of separators) {
        ensureSource(mapInstance, `${name}-source`);
        ensureLayer(mapInstance, {
            id: name,
            type: 'circle',
            source: `${name}-source`,
            layout: { visibility: 'none' },
            paint: { 'circle-opacity': 0 },
        });
    }
}

/**
 * Sets up auxiliary layers (selection boxes, previews).
 * @param {Object} mapInstance - MapLibre map instance
 */
export function setupAuxiliaryLayers(mapInstance) {
    ensureSource(mapInstance, 'rectangle-selection-preview');
    ensureLayer(mapInstance, {
        id: 'rectangle-selection-preview-layer',
        type: 'line',
        source: 'rectangle-selection-preview',
        paint: {
            'line-color': '#ff0000',
            'line-width': 2,
            'line-dasharray': [3, 3],
            'line-opacity': 0.8,
        },
    });

    ensureSource(mapInstance, 'selection-boxes');
    ensureLayer(mapInstance, {
        id: 'selection-boxes-layer',
        type: 'line',
        source: 'selection-boxes',
        paint: {
            'line-color': '#FF0000',
            'line-width': 2,
            'line-dasharray': [2, 2],
        },
    });

    // Snap indicator -- shown when cursor is near a snappable vertex/edge
    ensureSource(mapInstance, SNAP_INDICATOR_SOURCE);

    const { vertex } = SNAP_INDICATOR_STYLE;
    ensureLayer(mapInstance, {
        id: SNAP_INDICATOR_LAYER,
        type: 'circle',
        source: SNAP_INDICATOR_SOURCE,
        paint: {
            'circle-radius': ['coalesce', ['get', 'radius'], vertex.radius],
            'circle-color': ['coalesce', ['get', 'color'], vertex.color],
            'circle-stroke-width': ['coalesce', ['get', 'strokeWidth'], vertex.strokeWidth],
            'circle-stroke-color': ['coalesce', ['get', 'strokeColor'], vertex.strokeColor],
            'circle-opacity': ['coalesce', ['get', 'opacity'], vertex.opacity],
        },
    });
}

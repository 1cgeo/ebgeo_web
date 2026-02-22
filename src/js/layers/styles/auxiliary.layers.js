// Path: js/layers/styles/auxiliary.layers.js

/**
 * @fileoverview Auxiliary layer styles (selection, feedback, separators, snap indicator).
 */

import {
    SNAP_INDICATOR_SOURCE,
    SNAP_INDICATOR_LAYER,
    SNAP_INDICATOR_STYLE,
} from '../../snapping/snapping.constants.js';

/**
 * Sets up layer separators for ordering control.
 * @param {Object} mapInstance - MapLibre map instance
 */
export function setupLayerSeparators(mapInstance) {
    if (!mapInstance.getSource('analysis-separator-source')) {
        mapInstance.addSource('analysis-separator-source', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });

        mapInstance.addLayer({
            id: 'analysis-separator',
            type: 'circle',
            source: 'analysis-separator-source',
            layout: { visibility: 'none' },
            paint: { 'circle-opacity': 0 }
        });
    }

    if (!mapInstance.getSource('features-separator-source')) {
        mapInstance.addSource('features-separator-source', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });

        mapInstance.addLayer({
            id: 'features-separator',
            type: 'circle',
            source: 'features-separator-source',
            layout: { visibility: 'none' },
            paint: { 'circle-opacity': 0 }
        });
    }
}

/**
 * Sets up auxiliary layers (selection boxes, previews).
 * @param {Object} mapInstance - MapLibre map instance
 */
export function setupAuxiliaryLayers(mapInstance) {
    if (!mapInstance.getSource('rectangle-selection-preview')) {
        mapInstance.addSource('rectangle-selection-preview', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: []
            }
        });

        mapInstance.addLayer({
            id: 'rectangle-selection-preview-layer',
            type: 'line',
            source: 'rectangle-selection-preview',
            paint: {
                'line-color': '#ff0000',
                'line-width': 2,
                'line-dasharray': [3, 3],
                'line-opacity': 0.8
            }
        });
    }

    if (!mapInstance.getSource('selection-boxes')) {
        mapInstance.addSource('selection-boxes', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: []
            }
        });
    }

    if (!mapInstance.getLayer('selection-boxes-layer')) {
        mapInstance.addLayer({
            id: 'selection-boxes-layer',
            type: 'line',
            source: 'selection-boxes',
            paint: {
                'line-color': '#FF0000',
                'line-width': 2,
                'line-dasharray': [2, 2]
            }
        });
    }

    // Snap indicator — shown when cursor is near a snappable vertex/edge
    if (!mapInstance.getSource(SNAP_INDICATOR_SOURCE)) {
        mapInstance.addSource(SNAP_INDICATOR_SOURCE, {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
        });
    }

    if (!mapInstance.getLayer(SNAP_INDICATOR_LAYER)) {
        const vertexStyle = SNAP_INDICATOR_STYLE.vertex;
        mapInstance.addLayer({
            id: SNAP_INDICATOR_LAYER,
            type: 'circle',
            source: SNAP_INDICATOR_SOURCE,
            paint: {
                'circle-radius': ['coalesce', ['get', 'radius'], vertexStyle.radius],
                'circle-color': ['coalesce', ['get', 'color'], vertexStyle.color],
                'circle-stroke-width': ['coalesce', ['get', 'strokeWidth'], vertexStyle.strokeWidth],
                'circle-stroke-color': ['coalesce', ['get', 'strokeColor'], vertexStyle.strokeColor],
                'circle-opacity': ['coalesce', ['get', 'opacity'], vertexStyle.opacity],
            },
        });
    }
}

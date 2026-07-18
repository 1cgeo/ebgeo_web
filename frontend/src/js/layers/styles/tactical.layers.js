// Path: js/layers/styles/tactical.layers.js

/**
 * @fileoverview Tactical layer styles (boundary, occupied front, LOS, visibility).
 */

import {
    setOrCreateSource,
    ensureSource,
    ensureLayer,
    VISIBLE_FILTER,
    POINT_TYPE_FILTER,
} from './layer.helpers.js';

/**
 * Sets up boundary layers on the map.
 * @param {Object} features - Feature collection with boundaries
 * @param {Object} mapInstance - MapLibre map instance
 */
export function setupBoundaryLayers(features, mapInstance) {
    if (!features.boundarys) return;

    setOrCreateSource(mapInstance, 'boundarys', features.boundarys);
    ensureSource(mapInstance, 'boundary-circles');
    ensureSource(mapInstance, 'boundary-texts');
    ensureSource(mapInstance, 'boundary-feedback');
    ensureSource(mapInstance, 'boundary-edit-handles');

    ensureLayer(mapInstance, {
        id: 'boundary-feedback-layer',
        type: 'line',
        source: 'boundary-feedback',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
            'line-color': '#ff0000',
            'line-width': 4,
            'line-dasharray': [3, 3],
            'line-opacity': 0.8,
        },
        filter: ['!=', ['get', 'user_isEditingHandle'], true],
    });

    ensureLayer(mapInstance, {
        id: 'boundary-main-layer',
        type: 'line',
        source: 'boundarys',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
            'line-color': ['get', 'color'],
            'line-width': ['get', 'lineWidth'],
            'line-opacity': ['get', 'opacity'],
        },
        filter: VISIBLE_FILTER,
    });

    ensureLayer(mapInstance, {
        id: 'boundary-circles-layer',
        type: 'fill',
        source: 'boundary-circles',
        paint: {
            'fill-color': ['get', 'color'],
            'fill-opacity': ['get', 'opacity'],
        },
        filter: VISIBLE_FILTER,
    });

    ensureLayer(mapInstance, {
        id: 'boundary-circles-stroke-layer',
        type: 'line',
        source: 'boundary-circles',
        paint: {
            'line-color': ['get', 'color'],
            'line-width': 2,
            'line-opacity': ['get', 'opacity'],
        },
        filter: VISIBLE_FILTER,
    });

    ensureLayer(mapInstance, {
        id: 'boundary-text-layer',
        type: 'symbol',
        source: 'boundary-texts',
        layout: {
            'text-field': ['get', 'text'],
            'text-size': ['coalesce', ['get', 'text_size'], 14],
            'text-rotate': ['get', 'rotation'],
            'text-allow-overlap': true,
            'text-ignore-placement': true,
            'symbol-spacing': 1,
        },
        paint: {
            'text-color': ['get', 'color'],
            'text-halo-color': '#fff',
            'text-halo-width': 2,
            'text-opacity': ['coalesce', ['get', 'opacity'], 1],
        },
        filter: VISIBLE_FILTER,
    });

    ensureLayer(mapInstance, {
        id: 'boundary-handles-layer',
        type: 'circle',
        source: 'boundary-edit-handles',
        paint: {
            'circle-radius': 8,
            'circle-color': [
                'case',
                ['==', ['get', 'type'], 'vertex'], '#ff0000',
                ['==', ['get', 'type'], 'midpoint'], '#ffaa00',
                ['==', ['get', 'type'], 'symbol_handle'], '#0066ff',
                ['==', ['get', 'type'], 'size_handle'], '#28a745',
                ['==', ['get', 'type'], 'text_distance_handle'], '#9900cc',
                '#000000',
            ],
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 2,
            'circle-opacity': [
                'case',
                ['==', ['get', 'type'], 'midpoint'], 0.6,
                1.0,
            ],
        },
        filter: POINT_TYPE_FILTER,
    });
}

/**
 * Sets up occupied front layers on the map.
 * @param {Object} features - Feature collection with occupied fronts
 * @param {Object} mapInstance - MapLibre map instance
 */
export function setupOccupiedFrontLayers(features, mapInstance) {
    setOrCreateSource(mapInstance, 'occupied_fronts', features.occupied_fronts);
    ensureSource(mapInstance, 'occupied-front-feedback');
    ensureSource(mapInstance, 'occupied-front-edit-handles');

    ensureLayer(mapInstance, {
        id: 'occupied-front-feedback-layer',
        type: 'line',
        source: 'occupied-front-feedback',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
            'line-color': '#ff0000',
            'line-width': 4,
            'line-dasharray': [3, 3],
            'line-opacity': 0.8,
        },
    });

    ensureLayer(mapInstance, {
        id: 'occupied-front-layer',
        type: 'line',
        source: 'occupied_fronts',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
            'line-color': ['get', 'color'],
            'line-width': ['get', 'lineWidth'],
            'line-opacity': ['get', 'opacity'],
        },
        filter: VISIBLE_FILTER,
    });

    ensureLayer(mapInstance, {
        id: 'occupied-front-edit-handles-layer',
        type: 'circle',
        source: 'occupied-front-edit-handles',
        paint: {
            'circle-radius': 8,
            'circle-color': [
                'case',
                ['==', ['get', 'handleType'], 'center'], '#00ff00',
                ['==', ['get', 'handleType'], 'primary'], '#ff0000',
                ['==', ['get', 'handleType'], 'secondary'], '#0066ff',
                '#888888',
            ],
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 2,
            'circle-stroke-opacity': 1,
        },
        filter: POINT_TYPE_FILTER,
    });
}

/**
 * Sets up LOS (Line of Sight) layers on the map.
 * @param {Object} features - Feature collection with LOS features
 * @param {Object} mapInstance - MapLibre map instance
 */
export function setupLOSLayers(features, mapInstance) {
    setOrCreateSource(mapInstance, 'los', features.los);
    setOrCreateSource(mapInstance, 'processed-los', features.processed_los);
    ensureSource(mapInstance, 'los-feedback');

    ensureLayer(mapInstance, {
        id: 'los-layer',
        type: 'line',
        source: 'los',
        paint: {
            'line-color': '#D3D3D3',
            'line-opacity': 0,
            'line-width': ['get', 'width'],
        },
    });

    ensureLayer(mapInstance, {
        id: 'processed-los-layer',
        type: 'line',
        source: 'processed-los',
        paint: {
            'line-color': ['get', 'color'],
            'line-opacity': ['get', 'opacity'],
            'line-width': ['get', 'width'],
        },
        filter: VISIBLE_FILTER,
    });

    ensureLayer(mapInstance, {
        id: 'los-feedback-layer',
        type: 'line',
        source: 'los-feedback',
        paint: {
            'line-color': '#ff0000',
            'line-width': 3,
            'line-dasharray': [2, 2],
            'line-opacity': 0.8,
        },
    });
}

/**
 * Sets up visibility analysis layers on the map.
 * @param {Object} features - Feature collection with visibility features
 * @param {Object} mapInstance - MapLibre map instance
 */
export function setupVisibilityLayers(features, mapInstance) {
    setOrCreateSource(mapInstance, 'visibility', features.visibility);
    setOrCreateSource(mapInstance, 'processed-visibility', features.processed_visibility);
    ensureSource(mapInstance, 'visibility-feedback');
    ensureSource(mapInstance, 'visibility-edit-handles');

    ensureLayer(mapInstance, {
        id: 'visibility-layer',
        type: 'fill',
        source: 'visibility',
        paint: {
            'fill-color': '#D3D3D3',
            'fill-opacity': 0,
        },
    });

    ensureLayer(mapInstance, {
        id: 'visibility-visible-layer',
        type: 'fill',
        source: 'processed-visibility',
        paint: {
            'fill-color': ['get', 'color'],
            'fill-opacity': ['get', 'opacity'],
        },
        filter: ['all', VISIBLE_FILTER, ['==', ['get', 'color'], '#00FF00']],
    });

    ensureLayer(mapInstance, {
        id: 'visibility-obstructed-layer',
        type: 'fill',
        source: 'processed-visibility',
        paint: {
            'fill-color': ['get', 'color'],
            'fill-opacity': ['get', 'opacity'],
        },
        filter: ['all', VISIBLE_FILTER, ['==', ['get', 'color'], '#FF0000']],
    });

    ensureLayer(mapInstance, {
        id: 'visibility-feedback-layer',
        type: 'fill',
        source: 'visibility-feedback',
        paint: {
            'fill-color': '#3f4fb5',
            'fill-opacity': 0.5,
            'fill-outline-color': '#3f4fb5',
        },
    });

    ensureLayer(mapInstance, {
        id: 'visibility-feedback-outline-layer',
        type: 'line',
        source: 'visibility-feedback',
        paint: {
            'line-color': '#3f4fb5',
            'line-width': 2,
            'line-dasharray': [4, 2],
            'line-opacity': 0.8,
        },
    });

    ensureLayer(mapInstance, {
        id: 'visibility-edit-handles-layer',
        type: 'circle',
        source: 'visibility-edit-handles',
        paint: {
            'circle-radius': 8,
            'circle-color': [
                'case',
                ['==', ['get', 'handleType'], 'vertex'], '#ff0000',
                ['==', ['get', 'handleType'], 'eccentricity'], '#0066ff',
                ['==', ['get', 'handleType'], 'center'], '#00ff00',
                '#ffffff',
            ],
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 2,
        },
        filter: POINT_TYPE_FILTER,
    });
}

// Path: js/layers/styles/tactical.layers.js

/**
 * @fileoverview Tactical layer styles (boundary, occupied front, LOS, visibility).
 */

/**
 * Sets up boundary layers on the map.
 * @param {Object} features - Feature collection with boundaries
 * @param {Object} mapInstance - MapLibre map instance
 */
export function setupBoundaryLayers(features, mapInstance) {
    if (!features.boundarys) return;

    if (!mapInstance.getSource('boundarys')) {
        mapInstance.addSource('boundarys', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: features.boundarys
            }
        });
    } else {
        mapInstance.getSource('boundarys').setData({
            type: 'FeatureCollection',
            features: features.boundarys
        });
    }

    if (!mapInstance.getSource('boundary-circles')) {
        mapInstance.addSource('boundary-circles', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    if (!mapInstance.getSource('boundary-texts')) {
        mapInstance.addSource('boundary-texts', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    if (!mapInstance.getSource('boundary-feedback')) {
        mapInstance.addSource('boundary-feedback', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    if (!mapInstance.getSource('boundary-edit-handles')) {
        mapInstance.addSource('boundary-edit-handles', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    if (!mapInstance.getLayer('boundary-feedback-layer')) {
        mapInstance.addLayer({
            id: 'boundary-feedback-layer',
            type: 'line',
            source: 'boundary-feedback',
            layout: {
                'line-cap': 'round',
                'line-join': 'round'
            },
            paint: {
                'line-color': '#ff0000',
                'line-width': 4,
                'line-dasharray': [3, 3],
                'line-opacity': 0.8
            },
            filter: ['!=', ['get', 'user_isEditingHandle'], true]
        });
    }

    if (!mapInstance.getLayer('boundary-main-layer')) {
        mapInstance.addLayer({
            id: 'boundary-main-layer',
            type: 'line',
            source: 'boundarys',
            layout: {
                'line-cap': 'round',
                'line-join': 'round'
            },
            paint: {
                'line-color': ['get', 'color'],
                'line-width': ['get', 'lineWidth'],
                'line-opacity': ['get', 'opacity']
            },
            filter: ['!=', ['get', 'visivel'], false]
        });
    }

    if (!mapInstance.getLayer('boundary-circles-layer')) {
        mapInstance.addLayer({
            id: 'boundary-circles-layer',
            type: 'fill',
            source: 'boundary-circles',
            paint: {
                'fill-color': ['get', 'color'],
                'fill-opacity': ['get', 'opacity']
            },
            filter: ['!=', ['get', 'visivel'], false]
        });
    }

    if (!mapInstance.getLayer('boundary-circles-stroke-layer')) {
        mapInstance.addLayer({
            id: 'boundary-circles-stroke-layer',
            type: 'line',
            source: 'boundary-circles',
            paint: {
                'line-color': ['get', 'color'],
                'line-width': 2,
                'line-opacity': ['get', 'opacity']
            },
            filter: ['!=', ['get', 'visivel'], false]
        });
    }

    if (!mapInstance.getLayer('boundary-text-layer')) {
        mapInstance.addLayer({
            id: 'boundary-text-layer',
            type: 'symbol',
            source: 'boundary-texts',
            layout: {
                'text-field': ['get', 'text'],
                'text-size': ['coalesce', ['get', 'text_size'], 14],
                'text-rotate': ['get', 'rotation'],
                'text-allow-overlap': true,
                'text-ignore-placement': true,
                'symbol-spacing': 1
            },
            paint: {
                'text-color': ['get', 'color'],
                'text-halo-color': '#fff',
                'text-halo-width': 2
            },
            filter: ['!=', ['get', 'visivel'], false]
        });
    }

    if (!mapInstance.getLayer('boundary-handles-layer')) {
        mapInstance.addLayer({
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
                    '#000000'
                ],
                'circle-stroke-color': '#ffffff',
                'circle-stroke-width': 2,
                'circle-opacity': [
                    'case',
                    ['==', ['get', 'type'], 'midpoint'], 0.6,
                    1.0
                ]
            },
            filter: ['==', '$type', 'Point']
        });
    }
}

/**
 * Sets up occupied front layers on the map.
 * @param {Object} features - Feature collection with occupied fronts
 * @param {Object} mapInstance - MapLibre map instance
 */
export function setupOccupiedFrontLayers(features, mapInstance) {
    if (!mapInstance.getSource('occupied_fronts')) {
        mapInstance.addSource('occupied_fronts', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: features.occupied_fronts
            }
        });
    } else {
        mapInstance.getSource('occupied_fronts').setData({
            type: 'FeatureCollection',
            features: features.occupied_fronts
        });
    }

    if (!mapInstance.getSource('occupied-front-feedback')) {
        mapInstance.addSource('occupied-front-feedback', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    if (!mapInstance.getSource('occupied-front-edit-handles')) {
        mapInstance.addSource('occupied-front-edit-handles', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    if (!mapInstance.getLayer('occupied-front-feedback-layer')) {
        mapInstance.addLayer({
            id: 'occupied-front-feedback-layer',
            type: 'line',
            source: 'occupied-front-feedback',
            layout: {
                'line-cap': 'round',
                'line-join': 'round'
            },
            paint: {
                'line-color': '#ff0000',
                'line-width': 4,
                'line-dasharray': [3, 3],
                'line-opacity': 0.8
            }
        });
    }

    if (!mapInstance.getLayer('occupied-front-layer')) {
        mapInstance.addLayer({
            id: 'occupied-front-layer',
            type: 'line',
            source: 'occupied_fronts',
            layout: {
                'line-cap': 'round',
                'line-join': 'round'
            },
            paint: {
                'line-color': ['get', 'color'],
                'line-width': ['get', 'lineWidth'],
                'line-opacity': ['get', 'opacity']
            },
            filter: ['!=', ['get', 'visivel'], false]
        });
    }

    if (!mapInstance.getLayer('occupied-front-edit-handles-layer')) {
        mapInstance.addLayer({
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
                    '#888888'
                ],
                'circle-stroke-color': '#ffffff',
                'circle-stroke-width': 2,
                'circle-stroke-opacity': 1
            },
            filter: ['==', '$type', 'Point']
        });
    }
}

/**
 * Sets up LOS (Line of Sight) layers on the map.
 * @param {Object} features - Feature collection with LOS features
 * @param {Object} mapInstance - MapLibre map instance
 */
export function setupLOSLayers(features, mapInstance) {
    if (!mapInstance.getSource('los')) {
        mapInstance.addSource('los', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: features.los
            }
        });
    } else {
        mapInstance.getSource('los').setData({
            type: 'FeatureCollection',
            features: features.los
        });
    }

    if (!mapInstance.getSource('processed-los')) {
        mapInstance.addSource('processed-los', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: features.processed_los
            }
        });
    } else {
        mapInstance.getSource('processed-los').setData({
            type: 'FeatureCollection',
            features: features.processed_los
        });
    }

    if (!mapInstance.getSource('los-feedback')) {
        mapInstance.addSource('los-feedback', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    if (!mapInstance.getLayer('los-layer')) {
        mapInstance.addLayer({
            'id': 'los-layer',
            'type': 'line',
            'source': 'los',
            'paint': {
                'line-color': '#D3D3D3',
                'line-opacity': 0,
                'line-width': ['get', 'width']
            }
        });
    }

    if (!mapInstance.getLayer('processed-los-layer')) {
        mapInstance.addLayer({
            'id': 'processed-los-layer',
            'type': 'line',
            'source': 'processed-los',
            'paint': {
                'line-color': ['get', 'color'],
                'line-opacity': ['get', 'opacity'],
                'line-width': ['get', 'width']
            },
            filter: ['!=', ['get', 'visivel'], false]
        });
    }

    if (!mapInstance.getLayer('los-feedback-layer')) {
        mapInstance.addLayer({
            id: 'los-feedback-layer',
            type: 'line',
            source: 'los-feedback',
            paint: {
                'line-color': '#ff0000',
                'line-width': 3,
                'line-dasharray': [2, 2],
                'line-opacity': 0.8
            }
        });
    }
}

/**
 * Sets up visibility analysis layers on the map.
 * @param {Object} features - Feature collection with visibility features
 * @param {Object} mapInstance - MapLibre map instance
 */
export function setupVisibilityLayers(features, mapInstance) {
    if (!mapInstance.getSource('visibility')) {
        mapInstance.addSource('visibility', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: features.visibility
            }
        });
    } else {
        mapInstance.getSource('visibility').setData({
            type: 'FeatureCollection',
            features: features.visibility
        });
    }

    if (!mapInstance.getSource('processed-visibility')) {
        mapInstance.addSource('processed-visibility', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: features.processed_visibility
            }
        });
    } else {
        mapInstance.getSource('processed-visibility').setData({
            type: 'FeatureCollection',
            features: features.processed_visibility
        });
    }

    if (!mapInstance.getSource('visibility-feedback')) {
        mapInstance.addSource('visibility-feedback', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    if (!mapInstance.getLayer('visibility-layer')) {
        mapInstance.addLayer({
            id: 'visibility-layer',
            type: 'fill',
            source: 'visibility',
            paint: {
                'fill-color': '#D3D3D3',
                'fill-opacity': 0
            }
        });
    }

    if (!mapInstance.getLayer('visibility-visible-layer')) {
        mapInstance.addLayer({
            id: 'visibility-visible-layer',
            type: 'fill',
            source: 'processed-visibility',
            paint: {
                'fill-color': ['get', 'color'],
                'fill-opacity': ['get', 'opacity']
            },
            filter: ['all',
                ['!=', ['get', 'visivel'], false],
                ['==', ['get', 'color'], '#00FF00']
            ]
        });
    }

    if (!mapInstance.getLayer('visibility-obstructed-layer')) {
        mapInstance.addLayer({
            id: 'visibility-obstructed-layer',
            type: 'fill',
            source: 'processed-visibility',
            paint: {
                'fill-color': ['get', 'color'],
                'fill-opacity': ['get', 'opacity']
            },
            filter: ['all',
                ['!=', ['get', 'visivel'], false],
                ['==', ['get', 'color'], '#FF0000']
            ]
        });
    }

    if (!mapInstance.getLayer('visibility-feedback-layer')) {
        mapInstance.addLayer({
            id: 'visibility-feedback-layer',
            type: 'fill',
            source: 'visibility-feedback',
            paint: {
                'fill-color': '#3f4fb5',
                'fill-opacity': 0.5,
                'fill-outline-color': '#3f4fb5'
            }
        });
    }
}

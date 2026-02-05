// Path: js/layers/styles/point.layers.js

/**
 * @fileoverview Point layer styles for MapLibre.
 */

/**
 * Sets up point layers on the map.
 * @param {Object} features - Feature collection with points
 * @param {Object} mapInstance - MapLibre map instance
 */
export function setupPointLayers(features, mapInstance) {
    if (!mapInstance.getSource('points')) {
        mapInstance.addSource('points', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: features.points || []
            }
        });
    } else {
        mapInstance.getSource('points').setData({
            type: 'FeatureCollection',
            features: features.points || []
        });
    }

    if (!mapInstance.getSource('point-feedback')) {
        mapInstance.addSource('point-feedback', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
    }

    if (!mapInstance.getLayer('point-layer')) {
        mapInstance.addLayer({
            id: 'point-layer',
            type: 'circle',
            source: 'points',
            paint: {
                'circle-radius': ['get', 'size'],
                'circle-color': ['get', 'fillColor'],
                'circle-opacity': ['get', 'opacity']
            },
            filter: ['!=', ['get', 'visivel'], false]
        });
    }

    if (!mapInstance.getLayer('point-feedback-layer')) {
        mapInstance.addLayer({
            id: 'point-feedback-layer',
            type: 'circle',
            source: 'point-feedback',
            paint: {
                'circle-radius': ['coalesce', ['get', 'size'], 8],
                'circle-color': ['coalesce', ['get', 'fillColor'], '#ff0000'],
                'circle-opacity': ['coalesce', ['get', 'opacity'], 0.8]
            }
        });
    }
}

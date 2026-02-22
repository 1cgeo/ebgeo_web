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

    // ===== LABEL LAYER =====
    // Shows text labels for points with showLabel=true and non-empty labelText
    if (!mapInstance.getLayer('point-label-layer')) {
        mapInstance.addLayer({
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
                'text-size': ['coalesce', ['get', 'labelSize'], 14],
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
            }
        });
    }
}

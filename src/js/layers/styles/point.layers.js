// Path: js/layers/styles/point.layers.js

const EMPTY_FC = { type: 'FeatureCollection', features: [] };

/**
 * Creates a GeoJSON FeatureCollection wrapper.
 * @param {Array} features
 * @returns {{ type: string, features: Array }}
 */
function featureCollection(features) {
    return { type: 'FeatureCollection', features: features || [] };
}

/**
 * Adds a GeoJSON source if missing, or updates its data if it already exists.
 * @param {Object} map - MapLibre map instance
 * @param {string} id - Source ID
 * @param {Object} data - GeoJSON data
 */
function ensureSource(map, id, data) {
    if (map.getSource(id)) {
        map.getSource(id).setData(data);
    } else {
        map.addSource(id, { type: 'geojson', data });
    }
}

/**
 * Adds a layer if it does not already exist.
 * @param {Object} map - MapLibre map instance
 * @param {Object} layerDef - Full MapLibre layer definition
 */
function ensureLayer(map, layerDef) {
    if (!map.getLayer(layerDef.id)) {
        map.addLayer(layerDef);
    }
}

/**
 * Sets up point layers on the map.
 * @param {Object} features - Feature collection with points
 * @param {Object} mapInstance - MapLibre map instance
 */
export function setupPointLayers(features, mapInstance) {
    ensureSource(mapInstance, 'points', featureCollection(features.points));
    ensureSource(mapInstance, 'point-feedback', EMPTY_FC);

    ensureLayer(mapInstance, {
        id: 'point-layer',
        type: 'circle',
        source: 'points',
        paint: {
            'circle-radius': ['get', 'size'],
            'circle-color': ['get', 'fillColor'],
            'circle-opacity': ['get', 'opacity'],
        },
        filter: ['!=', ['get', 'visivel'], false],
    });

    ensureLayer(mapInstance, {
        id: 'point-feedback-layer',
        type: 'circle',
        source: 'point-feedback',
        paint: {
            'circle-radius': ['coalesce', ['get', 'size'], 8],
            'circle-color': ['coalesce', ['get', 'fillColor'], '#ff0000'],
            'circle-opacity': ['coalesce', ['get', 'opacity'], 0.8],
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

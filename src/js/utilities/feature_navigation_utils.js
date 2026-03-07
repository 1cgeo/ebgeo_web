// Path: js/utilities/feature_navigation_utils.js
/**
 * @fileoverview Map feature navigation and zoom operations.
 * Centralizes zoom, selection, and navigation logic.
 *
 * @module utilities/feature_navigation_utils
 */
import { getSourceTypeFromStorage } from '@store';

/** Feature types that use a selectionBox polygon for zoom bounds. */
const SELECTION_BOX_TYPES = ['text', 'image', 'military_symbol'];

/**
 * Approximate degree-to-pixel scale factor for padding calculation.
 * 1 degree ~ 111 km ~ 100 000 "base pixels" at reference scale.
 * @constant {number}
 */
const DEGREE_TO_BASE_PIXELS = 100_000;

/** Minimum padding in pixels applied to fitBounds. */
const MIN_PADDING = 50;

/** Maximum padding in pixels applied to fitBounds. */
const MAX_PADDING = 200;

/**
 * Zooms to a feature with contextual padding.
 *
 * @param {Object} feature - GeoJSON feature
 * @param {Object} mapInstance - MapLibre map instance
 * @param {Object} [options] - Zoom options
 * @param {number} [options.paddingPercent=0.2] - Padding as fraction of bbox
 * @param {number} [options.minZoom=10] - Minimum zoom level
 * @param {number} [options.maxZoom=18] - Maximum zoom level
 * @param {number} [options.duration=800] - Animation duration in ms
 */
export async function zoomToFeature(feature, mapInstance, options = {}) {
    if (!feature?.geometry) {
        console.warn('Invalid feature for zoom');
        return;
    }

    const {
        paddingPercent = 0.2,
        minZoom = 10,
        maxZoom = 18,
        duration = 800
    } = options;

    const geometry = resolveGeometry(feature);

    switch (geometry.type) {
        case 'Point':
            await flyToPoint(geometry.coordinates, mapInstance, {
                minZoom: Math.max(mapInstance.getZoom(), 15),
                duration
            });
            break;

        case 'LineString':
        case 'Polygon':
        case 'MultiLineString':
        case 'MultiPolygon':
            await fitGeometryBounds(geometry, mapInstance, {
                paddingPercent,
                minZoom,
                maxZoom,
                duration
            });
            break;

        default:
            console.warn('Unsupported geometry type:', geometry.type);
    }
}

/**
 * Zooms to a feature and selects it.
 *
 * @param {Object} feature - GeoJSON feature
 * @param {Object} mapInstance - MapLibre map instance
 * @param {Object} selectionManager - Selection manager instance
 * @param {string} featureType - Feature storage type (e.g. 'points')
 * @param {string} featureId - Feature ID
 */
export async function zoomAndSelectFeature(feature, mapInstance, selectionManager, featureType, featureId) {
    selectionManager.deselectAllFeatures();

    const sourceType = getSourceTypeFromStorage(featureType);
    await selectionManager.selectFeature(sourceType, featureId, feature);

    await zoomToFeature(feature, mapInstance, {
        paddingPercent: 0.25,
        minZoom: 12,
        maxZoom: 18
    });
}

/**
 * Returns the selectionBox geometry when applicable, otherwise the main geometry.
 *
 * @param {Object} feature - GeoJSON feature
 * @returns {Object} GeoJSON geometry to use for navigation
 */
function resolveGeometry(feature) {
    const props = feature.properties;
    const hasSelectionBox = SELECTION_BOX_TYPES.includes(props?.source)
        && props?.selectionBox?.type === 'Polygon';

    return hasSelectionBox ? props.selectionBox : feature.geometry;
}

/**
 * Flies to a specific point coordinate.
 *
 * @param {Array<number>} coordinates - [lng, lat]
 * @param {Object} mapInstance - MapLibre map instance
 * @param {Object} options - { minZoom, duration }
 * @returns {Promise<void>} Resolves when animation completes
 */
function flyToPoint(coordinates, mapInstance, { minZoom, duration }) {
    return new Promise((resolve) => {
        mapInstance.flyTo({ center: coordinates, zoom: minZoom, duration });
        setTimeout(resolve, duration);
    });
}

/**
 * Fits the map to the bounds of a geometry.
 *
 * @param {Object} geometry - GeoJSON geometry
 * @param {Object} mapInstance - MapLibre map instance
 * @param {Object} options - { paddingPercent, maxZoom, duration }
 * @returns {Promise<void>} Resolves when animation completes
 */
function fitGeometryBounds(geometry, mapInstance, { paddingPercent, maxZoom, duration }) {
    const coordinates = extractAllCoordinates(geometry.coordinates);

    if (coordinates.length === 0) {
        console.warn('No coordinates found in geometry');
        return Promise.resolve();
    }

    const bounds = new maplibregl.LngLatBounds();
    for (const coord of coordinates) {
        bounds.extend(coord);
    }

    if (bounds.isEmpty()) {
        console.warn('Empty bounds for feature');
        return Promise.resolve();
    }

    const ne = bounds.getNorthEast();
    const sw = bounds.getSouthWest();
    const bboxSize = Math.max(Math.abs(ne.lng - sw.lng), Math.abs(ne.lat - sw.lat));
    const rawPadding = bboxSize * DEGREE_TO_BASE_PIXELS * paddingPercent;
    const padding = Math.round(Math.max(MIN_PADDING, Math.min(MAX_PADDING, rawPadding)));

    return new Promise((resolve) => {
        mapInstance.fitBounds(bounds, { padding, duration, maxZoom });
        setTimeout(resolve, duration);
    });
}

/**
 * Recursively extracts all [lng, lat] coordinate pairs from a GeoJSON
 * coordinates structure (any nesting depth).
 *
 * @param {Array} coordArray - GeoJSON coordinates (any depth)
 * @param {Array<Array<number>>} [result] - Accumulator (internal)
 * @returns {Array<Array<number>>} Flat array of [lng, lat] pairs
 */
function extractAllCoordinates(coordArray, result = []) {
    if (!Array.isArray(coordArray)) return result;

    if (typeof coordArray[0] === 'number' && coordArray.length >= 2) {
        result.push(coordArray);
    } else {
        for (const item of coordArray) {
            extractAllCoordinates(item, result);
        }
    }

    return result;
}

// Path: js/store/repository.utils.js

/**
 * @fileoverview Repository utility functions.
 *
 * This module contains utility functions that were previously in repository.js
 * but are not related to IndexedDB operations. These are pure functions
 * for data manipulation and validation.
 *
 * NOTE: These functions are re-exported from repository.js for backward
 * compatibility during the migration period.
 */

// ===== VERSION CONSTANTS =====

/**
 * Legacy schema version (pre-Atlas).
 * Used for v1.3-v1.7 data.
 */
export const SCHEMA_VERSION = '1.7';

/**
 * Minimum supported legacy schema version.
 */
export const MIN_SCHEMA_VERSION = '1.3';

/**
 * Maximum legacy schema version.
 */
export const MAX_SCHEMA_VERSION = '1.7';

// ===== INTERNAL PROPERTY DETECTION =====

/**
 * List of properties that are internal to MapLibre/Mapbox
 * and should not be persisted.
 */
const INTERNAL_PROPERTIES = [
    '_vectorTileFeature', '_pbf', '_geometry', '_keys', '_values',
    '_z', '_x', '_y',
    'layer', 'state',
    'extent', 'type'
];

/**
 * Checks if a property is internal MapLibre/Mapbox metadata.
 * @param {string} key - Property key
 * @returns {boolean} True if internal property
 */
export function isInternalProperty(key) {
    return INTERNAL_PROPERTIES.includes(key) || key.startsWith('_');
}

// ===== FEATURE CLEANING =====

/**
 * Removes internal Mapbox metadata and keeps only essential GeoJSON data.
 * @param {Object} feature - Feature to clean
 * @returns {Object|null} Cleaned feature or null if invalid
 */
export function cleanFeature(feature) {
    if (!feature || !feature.type) {
        console.warn('Invalid feature provided for cleaning:', feature);
        return null;
    }

    let geometry = feature.geometry;
    if (!geometry && feature._geometry) {
        geometry = feature._geometry;
    }

    const cleanedProperties = {};
    if (feature.properties) {
        Object.keys(feature.properties).forEach(key => {
            if (!isInternalProperty(key)) {
                cleanedProperties[key] = feature.properties[key];
            }
        });
    }

    return {
        type: feature.type,
        id: feature.id,
        properties: cleanedProperties,
        geometry: geometry
    };
}

// ===== VERSION UTILITIES =====

/**
 * Compares two version strings (format X.Y or X.Y.Z).
 * @param {string} version1 - First version
 * @param {string} version2 - Second version
 * @returns {number} -1 if v1 < v2, 0 if equal, 1 if v1 > v2
 */
export function compareVersions(version1, version2) {
    const v1Parts = version1.split('.').map(Number);
    const v2Parts = version2.split('.').map(Number);

    for (let i = 0; i < Math.max(v1Parts.length, v2Parts.length); i++) {
        const v1Part = v1Parts[i] || 0;
        const v2Part = v2Parts[i] || 0;

        if (v1Part < v2Part) return -1;
        if (v1Part > v2Part) return 1;
    }
    return 0;
}

// ===== DATA STRUCTURE FACTORIES =====

/**
 * Returns empty map data structure.
 * @returns {Object} Empty map data
 */
export function getEmptyMapData() {
    return {
        baseLayer: 'carta-topografica',
        analysisLayers: {},
        features: {
            polygons: [],
            lines: [],
            points: [],
            texts: [],
            images: [],
            los: [],
            visibility: [],
            processed_los: [],
            processed_visibility: [],
            brushes: [],
            rectangles: [],
            circles: [],
            ellipses: [],
            arrows: [],
            boundarys: [],
            occupied_fronts: [],
            military_symbols: [],
            setores: [],
            coordenadas: [],
            coordination_measures: []
        },
        zoom: null,
        center_lat: null,
        center_long: null,
        bearing: null,
        pitch: null
    };
}

/**
 * Returns default layer structure.
 * @returns {Object} Default layer
 */
export function getDefaultLayer() {
    const now = Date.now();
    return {
        id: 'default',
        name: 'Padrão',
        visible: true,
        locked: false,
        order: 0,
        createdAt: now,
        updatedAt: now,
        version: 1
    };
}

/**
 * Returns empty Cesium 3D data structure.
 * @returns {Object} Empty cesium3d data
 */
export function getEmptyCesium3dData() {
    return {
        cameraPositions: {},
        markers: [],
        measurements: [],
        viewsheds: []
    };
}

/**
 * Returns empty Street View 360 data structure.
 * @returns {Object} Empty streetview360 data
 */
export function getEmptyStreetview360Data() {
    return {
        orientations: {},
        markers: []
    };
}

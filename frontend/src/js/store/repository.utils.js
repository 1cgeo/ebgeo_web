// Path: js/store/repository.utils.js

/**
 * @fileoverview Pure utility functions for data manipulation and validation.
 * Re-exported from repository.js for backward compatibility.
 */

/** Legacy schema version (pre-Atlas, v1.3-v1.7). */
export const SCHEMA_VERSION = '1.7';

/** Minimum supported legacy schema version. */
export const MIN_SCHEMA_VERSION = '1.3';

/** Maximum legacy schema version. */
export const MAX_SCHEMA_VERSION = '1.7';

/** Properties internal to MapLibre/Mapbox that should not be persisted. */
const INTERNAL_PROPERTIES = new Set([
    '_vectorTileFeature', '_pbf', '_geometry', '_keys', '_values',
    '_z', '_x', '_y',
    'layer', 'state',
    'extent', 'type'
]);

/**
 * Checks if a property is internal MapLibre/Mapbox metadata.
 * @param {string} key - Property key
 * @returns {boolean} True if internal property
 */
export function isInternalProperty(key) {
    return key.startsWith('_') || INTERNAL_PROPERTIES.has(key);
}

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

    let geometry = feature.geometry || feature._geometry;

    // Temporal: a trajectory-displaced feature carries its authoring (home)
    // position in the runtime-only `_temporalHome`. Persist the home position,
    // not the interpolated/displaced one, so editing a moving feature never
    // saves a wrong location. (`_temporalHome` itself is dropped below by the
    // `_`-prefix rule in isInternalProperty.)
    const home = feature.properties?._temporalHome;
    if (Array.isArray(home) && home.length >= 2 && geometry?.type === 'Point') {
        geometry = { ...geometry, coordinates: [home[0], home[1]] };
    }

    const cleanedProperties = {};
    if (feature.properties) {
        for (const [key, value] of Object.entries(feature.properties)) {
            if (!isInternalProperty(key)) {
                cleanedProperties[key] = value;
            }
        }
    }

    return {
        type: feature.type,
        id: feature.id,
        properties: cleanedProperties,
        geometry
    };
}

/**
 * Compares two version strings (format X.Y or X.Y.Z).
 * @param {string} version1 - First version
 * @param {string} version2 - Second version
 * @returns {number} -1 if v1 < v2, 0 if equal, 1 if v1 > v2
 */
export function compareVersions(version1, version2) {
    const v1Parts = version1.split('.').map(Number);
    const v2Parts = version2.split('.').map(Number);
    const maxLen = Math.max(v1Parts.length, v2Parts.length);

    for (let i = 0; i < maxLen; i++) {
        const v1Part = v1Parts[i] || 0;
        const v2Part = v2Parts[i] || 0;

        if (v1Part < v2Part) return -1;
        if (v1Part > v2Part) return 1;
    }
    return 0;
}

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
            coordination_lines: [],
            military_symbols: [],
            setores: [],
            coordenadas: [],
            coordination_measures: [],
            magnetic_declinations: []
        },
        zoom: null,
        center_lat: null,
        center_long: null,
        bearing: null,
        pitch: null
    };
}

/** The feature collection the Coordination Line tool draws into. */
const COORDINATION_LINE_BUCKET = 'coordination_lines';

/**
 * Bring one map's feature collection to the shape the Coordination Line tool needs.
 *
 * WHY THIS IS NOT A SCHEMA MIGRATION. A map created before the tool existed has no
 * `coordination_lines` key, and that is NOT harmless: `setupCoordinationLineLayers`
 * builds the MapLibre source out of that collection, and every write the tool makes
 * goes through `getSource(...)?.setData`, whose optional chaining swallows the absence.
 * The tool then activates, accepts clicks and draws NOTHING, with no error and no log.
 *
 * The `main` line of the product paid a schema bump (v2.3) for exactly this. Here the
 * version stays at '2.3' by decision of 2026-09-03: this branch is in development with no
 * user data to preserve, its own v2.3 is an INSTALLATION-level migration ("Meu Atlas"),
 * and a shape a read can normalise on its own does not deserve a version. So this runs at
 * READ time, in the three paths a map can enter by (`.ebgeo` import, server snapshot,
 * IndexedDB read), all three calling THIS function so they cannot drift apart.
 *
 * Returns null when there is nothing to do, which is what keeps a caller from rewriting
 * a document it only read. Idempotent, so a map that already carries the bucket (one
 * written by `main` at 2.3, for instance) passes through untouched.
 *
 * Nothing is added to the features themselves. An empty bucket is the honest reading of
 * "this map has no coordination lines yet".
 *
 * @param {Object} features - The map's feature collection
 * @returns {Object|null} New feature collection, or null when already in shape
 */
export function ensureCoordinationLines(features) {
    if (!features || typeof features !== 'object') return null;
    if (Array.isArray(features[COORDINATION_LINE_BUCKET])) return null;

    return { ...features, [COORDINATION_LINE_BUCKET]: [] };
}

/**
 * Return a map document whose feature collection carries every bucket the app expects.
 *
 * The same null contract as `ensureCoordinationLines`, one level up: null means the
 * document is already in shape and the caller should keep the object it has.
 *
 * @param {Object} mapData - A stored map document
 * @returns {Object|null} New map document, or null when nothing changed
 */
export function ensureMapDataShape(mapData) {
    if (!mapData || typeof mapData !== 'object') return null;

    const features = ensureCoordinationLines(mapData.features);
    return features ? { ...mapData, features } : null;
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
        opacity: 1,
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

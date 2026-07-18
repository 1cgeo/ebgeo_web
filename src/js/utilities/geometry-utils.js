// Path: js/utilities/geometry-utils.js
/**
 * @fileoverview Shared geometry utilities for map coordinate calculations.
 * Centralized functions for pixel-to-degree conversions and bounding box operations.
 * Used across tool controls, geometry classes, and UI managers.
 *
 * @module utilities/geometry-utils
 */

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Earth's circumference in meters at the equator.
 * Used for Web Mercator projection calculations.
 * @constant {number}
 */
const EARTH_CIRCUMFERENCE_METERS = 40075017;

/** @constant {number} */
const DEG_TO_RAD = Math.PI / 180;

/** @constant {number} */
const RAD_TO_DEG = 180 / Math.PI;

/** @constant {number} */
const DEGREES_PER_METER = 360 / EARTH_CIRCUMFERENCE_METERS;

/** @constant {number} */
const METERS_PER_DEGREE = EARTH_CIRCUMFERENCE_METERS / 360;

/**
 * Earth's mean radius in meters (used for Haversine formula).
 * @constant {number}
 */
const EARTH_RADIUS_METERS = 6371000;

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

/**
 * Compute meters-per-pixel at a given latitude and zoom level.
 * Formula: circumference * cos(lat) / 2^(zoom+8)
 *
 * @param {number} latitude - Latitude in degrees
 * @param {number} zoom - Map zoom level
 * @returns {number} Meters per pixel
 */
function metersPerPixel(latitude, zoom) {
    return EARTH_CIRCUMFERENCE_METERS *
        Math.cos(latitude * DEG_TO_RAD) /
        (2 ** (zoom + 8));
}

// ============================================================================
// COORDINATE CONVERSION FUNCTIONS
// ============================================================================

/**
 * Convert pixels to degrees at a given latitude and zoom level.
 * Uses Web Mercator projection formula for accurate conversion.
 *
 * @param {number} pixels - Number of pixels to convert
 * @param {number} latitude - Latitude in degrees (affects scale due to Mercator distortion)
 * @param {number} zoom - Map zoom level
 * @returns {number} Equivalent distance in degrees
 *
 * @example
 * const degrees = pixelsToDegrees(10, -23.5, 15);
 */
export function pixelsToDegrees(pixels, latitude, zoom) {
    return pixels * metersPerPixel(latitude, zoom) * DEGREES_PER_METER;
}

/**
 * Convert degrees to pixels at a given latitude and zoom level.
 * Inverse of pixelsToDegrees.
 *
 * @param {number} degrees - Distance in degrees to convert
 * @param {number} latitude - Latitude in degrees
 * @param {number} zoom - Map zoom level
 * @returns {number} Equivalent distance in pixels
 *
 * @example
 * const pixels = degreesToPixels(0.001, -23.5, 15);
 */
export function degreesToPixels(degrees, latitude, zoom) {
    return (degrees * METERS_PER_DEGREE) / metersPerPixel(latitude, zoom);
}

// ============================================================================
// BOUNDING BOX FUNCTIONS
// ============================================================================

/**
 * Expand a bounding box by a padding value in pixels.
 * Converts pixel padding to degrees based on the center latitude.
 *
 * @param {Array<number>} bbox - Bounding box [minX, minY, maxX, maxY]
 * @param {number} paddingPixels - Padding to add in pixels
 * @param {Object} map - MapLibre map instance (for zoom level)
 * @returns {Array<number>} Expanded bounding box [minX, minY, maxX, maxY]
 *
 * @example
 * const expanded = expandBboxWithPadding([lng1, lat1, lng2, lat2], 5, map);
 */
export function expandBboxWithPadding(bbox, paddingPixels, map) {
    const centerLat = (bbox[1] + bbox[3]) / 2;
    const paddingDegrees = pixelsToDegrees(paddingPixels, centerLat, map.getZoom());

    return [
        bbox[0] - paddingDegrees,
        bbox[1] - paddingDegrees,
        bbox[2] + paddingDegrees,
        bbox[3] + paddingDegrees
    ];
}

/**
 * Create a bounding box polygon around a point with pixel-based padding.
 *
 * @param {Array<number>} coordinates - Point coordinates [lng, lat]
 * @param {number} paddingPixels - Padding in pixels
 * @param {number} zoom - Map zoom level
 * @returns {Object} GeoJSON Polygon geometry
 *
 * @example
 * const bbox = createPointBoundingBox([-43.2, -22.9], 10, 15);
 */
export function createPointBoundingBox(coordinates, paddingPixels, zoom) {
    const [lng, lat] = coordinates;
    const pad = pixelsToDegrees(paddingPixels, lat, zoom);

    return {
        type: 'Polygon',
        coordinates: [[
            [lng - pad, lat - pad],
            [lng + pad, lat - pad],
            [lng + pad, lat + pad],
            [lng - pad, lat + pad],
            [lng - pad, lat - pad]
        ]]
    };
}

// ============================================================================
// COORDINATE PARSING FUNCTIONS
// ============================================================================

/**
 * Normalize coordinates from various input formats.
 * Handles JSON strings, arrays, and validates structure.
 *
 * @param {string|Array} coordinates - Coordinates in string or array format
 * @returns {Array|null} Normalized coordinates array or null if invalid
 *
 * @example
 * normalizeCoordinates('[1, 2]');       // Returns [1, 2]
 * normalizeCoordinates([1, 2]);         // Returns [1, 2]
 * normalizeCoordinates('invalid');      // Returns null
 */
export function normalizeCoordinates(coordinates) {
    if (typeof coordinates === 'string') {
        try {
            coordinates = JSON.parse(coordinates);
        } catch {
            console.warn('Error parsing coordinates:', coordinates);
            return null;
        }
    }
    return Array.isArray(coordinates) ? coordinates : null;
}

/**
 * Wrap a longitude into the canonical [-180, 180] range.
 *
 * MapLibre's `map.getCenter()` returns an UNWRAPPED longitude: panning east past
 * the antimeridian yields 187.3, and repeated wraps yield values like -420. Any
 * value handed to a backend that validates WGS84 bounds (or casts to PostGIS
 * ::geography) must be wrapped first.
 *
 * Matches MapLibre's own `LngLat.wrap()` semantics, including the edge case where
 * +180 maps to -180.
 *
 * @param {number} lng - Longitude in degrees, possibly unwrapped
 * @returns {number} Longitude in [-180, 180), or NaN if the input is not finite
 *
 * @example
 * wrapLongitude(187.3);   // Returns -172.7
 * wrapLongitude(-43.2);   // Returns -43.2 (already in range)
 */
export function wrapLongitude(lng) {
    if (!Number.isFinite(lng)) return NaN;
    return ((((lng + 180) % 360) + 360) % 360) - 180;
}

/**
 * Clamp a latitude into the valid WGS84 range [-90, 90].
 *
 * Web Mercator already bounds a map's latitude to roughly ±85, so this is a
 * defensive guard for coordinates that arrive from elsewhere (user input,
 * imported data) before they reach a backend that rejects out-of-range values.
 *
 * @param {number} lat - Latitude in degrees
 * @returns {number} Latitude in [-90, 90], or NaN if the input is not finite
 *
 * @example
 * clampLatitude(91);     // Returns 90
 * clampLatitude(-22.9);  // Returns -22.9 (already in range)
 */
export function clampLatitude(lat) {
    if (!Number.isFinite(lat)) return NaN;
    return Math.min(90, Math.max(-90, lat));
}

// ============================================================================
// DISTANCE CALCULATIONS
// ============================================================================

/**
 * Calculate the Haversine distance between two points.
 * Returns distance in meters.
 *
 * @param {Array<number>} point1 - First point [lng, lat]
 * @param {Array<number>} point2 - Second point [lng, lat]
 * @returns {number} Distance in meters
 *
 * @example
 * const distance = calculateDistance([-43.2, -22.9], [-43.3, -22.95]);
 */
export function calculateDistance(point1, point2) {
    const lat1Rad = point1[1] * DEG_TO_RAD;
    const lat2Rad = point2[1] * DEG_TO_RAD;
    const deltaLat = (point2[1] - point1[1]) * DEG_TO_RAD;
    const deltaLng = (point2[0] - point1[0]) * DEG_TO_RAD;

    const a = Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
        Math.cos(lat1Rad) * Math.cos(lat2Rad) *
        Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return EARTH_RADIUS_METERS * c;
}

/**
 * Calculate bearing (azimuth) between two points.
 * Returns bearing in degrees (0-360, clockwise from north).
 *
 * @param {Array<number>} point1 - Start point [lng, lat]
 * @param {Array<number>} point2 - End point [lng, lat]
 * @returns {number} Bearing in degrees
 *
 * @example
 * const bearing = calculateBearing([-43.2, -22.9], [-43.3, -22.95]);
 */
export function calculateBearing(point1, point2) {
    const lat1Rad = point1[1] * DEG_TO_RAD;
    const lat2Rad = point2[1] * DEG_TO_RAD;
    const deltaLng = (point2[0] - point1[0]) * DEG_TO_RAD;

    const y = Math.sin(deltaLng) * Math.cos(lat2Rad);
    const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) -
        Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(deltaLng);

    const bearing = Math.atan2(y, x) * RAD_TO_DEG;
    return (bearing + 360) % 360;
}

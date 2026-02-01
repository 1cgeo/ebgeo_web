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

/**
 * Degrees per meter at the equator.
 * @constant {number}
 */
const DEGREES_PER_METER = 360 / EARTH_CIRCUMFERENCE_METERS;

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
 * // Convert 10 pixels to degrees at latitude -23.5 and zoom 15
 * const degrees = pixelsToDegrees(10, -23.5, 15);
 */
export function pixelsToDegrees(pixels, latitude, zoom) {
    // Meters per pixel at given latitude and zoom
    // Formula: circumference * cos(lat) / 2^(zoom+8)
    const metersPerPixel = EARTH_CIRCUMFERENCE_METERS *
        Math.cos(latitude * Math.PI / 180) /
        Math.pow(2, zoom + 8);

    return pixels * metersPerPixel * DEGREES_PER_METER;
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
 * // Convert 0.001 degrees to pixels at latitude -23.5 and zoom 15
 * const pixels = degreesToPixels(0.001, -23.5, 15);
 */
export function degreesToPixels(degrees, latitude, zoom) {
    const metersPerPixel = EARTH_CIRCUMFERENCE_METERS *
        Math.cos(latitude * Math.PI / 180) /
        Math.pow(2, zoom + 8);

    const metersPerDegree = 1 / DEGREES_PER_METER;
    return (degrees * metersPerDegree) / metersPerPixel;
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
 * const bbox = [lng1, lat1, lng2, lat2];
 * const expanded = expandBboxWithPadding(bbox, 5, map);
 */
export function expandBboxWithPadding(bbox, paddingPixels, map) {
    const centerLat = (bbox[1] + bbox[3]) / 2;
    const zoom = map.getZoom();
    const paddingDegrees = pixelsToDegrees(paddingPixels, centerLat, zoom);

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
    const latitude = coordinates[1];
    const paddingDegrees = pixelsToDegrees(paddingPixels, latitude, zoom);

    return {
        type: 'Polygon',
        coordinates: [[
            [coordinates[0] - paddingDegrees, coordinates[1] - paddingDegrees],
            [coordinates[0] + paddingDegrees, coordinates[1] - paddingDegrees],
            [coordinates[0] + paddingDegrees, coordinates[1] + paddingDegrees],
            [coordinates[0] - paddingDegrees, coordinates[1] + paddingDegrees],
            [coordinates[0] - paddingDegrees, coordinates[1] - paddingDegrees]
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
        } catch (_e) {
            console.warn('Error parsing coordinates:', coordinates);
            return null;
        }
    }
    return Array.isArray(coordinates) ? coordinates : null;
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
    const R = 6371000; // Earth's radius in meters
    const lat1Rad = point1[1] * Math.PI / 180;
    const lat2Rad = point2[1] * Math.PI / 180;
    const deltaLat = (point2[1] - point1[1]) * Math.PI / 180;
    const deltaLng = (point2[0] - point1[0]) * Math.PI / 180;

    const a = Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
        Math.cos(lat1Rad) * Math.cos(lat2Rad) *
        Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
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
    const lat1Rad = point1[1] * Math.PI / 180;
    const lat2Rad = point2[1] * Math.PI / 180;
    const deltaLng = (point2[0] - point1[0]) * Math.PI / 180;

    const y = Math.sin(deltaLng) * Math.cos(lat2Rad);
    const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) -
        Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(deltaLng);

    const bearing = Math.atan2(y, x) * 180 / Math.PI;
    return (bearing + 360) % 360;
}

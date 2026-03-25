// Path: js/measurement_tool/measurement-geometry.js

/**
 * @module measurement_tool/measurement-geometry
 * @description Pure geometry calculations for measurement tools using Turf.js.
 * @dependencies turf (global)
 */

/**
 * Calculates the total length of a polyline in meters.
 * @param {number[][]} coordinates - Array of [lng, lat] pairs
 * @returns {number} Length in meters
 */
export function calculateLineLength(coordinates) {
    if (!coordinates || coordinates.length < 2) return 0;

    const line = turf.lineString(coordinates);
    return turf.length(line, { units: 'meters' });
}

/**
 * Calculates the distance of a single segment in meters.
 * @param {number[]} from - [lng, lat]
 * @param {number[]} to - [lng, lat]
 * @returns {number} Distance in meters
 */
export function calculateSegmentDistance(from, to) {
    return turf.distance(turf.point(from), turf.point(to), { units: 'meters' });
}

/**
 * Returns the midpoint of a segment.
 * @param {number[]} from - [lng, lat]
 * @param {number[]} to - [lng, lat]
 * @returns {number[]} [lng, lat]
 */
export function getSegmentMidpoint(from, to) {
    const mid = turf.midpoint(turf.point(from), turf.point(to));
    return mid.geometry.coordinates;
}

/**
 * Calculates area and perimeter of a polygon in meters/meters squared.
 * @param {number[][]} coordinates - Array of [lng, lat] pairs (ring, first != last)
 * @returns {{ area: number, perimeter: number }}
 */
export function calculatePolygonMetrics(coordinates) {
    if (!coordinates || coordinates.length < 3) return { area: 0, perimeter: 0 };

    const ring = [...coordinates, coordinates[0]];
    const polygon = turf.polygon([ring]);

    const area = turf.area(polygon);
    const perimeter = turf.length(turf.lineString(ring), { units: 'meters' });

    return { area, perimeter };
}

/**
 * Returns the centroid of a polygon.
 * @param {number[][]} coordinates - Array of [lng, lat] pairs (ring, first != last)
 * @returns {number[]} [lng, lat]
 */
export function getPolygonCentroid(coordinates) {
    if (!coordinates || coordinates.length < 3) return coordinates?.[0] || [0, 0];

    const ring = [...coordinates, coordinates[0]];
    const polygon = turf.polygon([ring]);
    const centroid = turf.centroid(polygon);

    return centroid.geometry.coordinates;
}

/**
 * Calculates the angle at vertex P2 between rays P2->P1 and P2->P3.
 * @param {number[]} p1 - [lng, lat] first ray endpoint
 * @param {number[]} p2 - [lng, lat] vertex
 * @param {number[]} p3 - [lng, lat] second ray endpoint
 * @returns {number} Angle in degrees (0-360)
 */
export function calculateAngle(p1, p2, p3) {
    const bearing1 = turf.bearing(turf.point(p2), turf.point(p1));
    const bearing2 = turf.bearing(turf.point(p2), turf.point(p3));

    let angle = bearing2 - bearing1;
    if (angle < 0) angle += 360;

    return angle;
}

/**
 * Generates an arc (LineString coords) between two bearings around a center point.
 * @param {number[]} center - [lng, lat]
 * @param {number} bearing1 - Start bearing in degrees
 * @param {number} bearing2 - End bearing in degrees
 * @param {number} radiusMeters - Arc radius in meters
 * @param {number} [numPoints=36] - Points on the arc
 * @returns {number[][]} Array of [lng, lat] coords
 */
export function generateArcCoordinates(center, bearing1, bearing2, radiusMeters, numPoints = 36) {
    let sweep = bearing2 - bearing1;
    if (sweep < 0) sweep += 360;

    const coords = [];
    for (let i = 0; i <= numPoints; i++) {
        const fraction = i / numPoints;
        const bearing = bearing1 + sweep * fraction;
        const dest = turf.destination(turf.point(center), radiusMeters / 1000, bearing, { units: 'kilometers' });
        coords.push(dest.geometry.coordinates);
    }

    return coords;
}

/**
 * Returns bearing from p1 to p2 in degrees (-180 to 180).
 * @param {number[]} p1 - [lng, lat]
 * @param {number[]} p2 - [lng, lat]
 * @returns {number} Bearing in degrees
 */
export function getBearing(p1, p2) {
    return turf.bearing(turf.point(p1), turf.point(p2));
}

/**
 * Formats a distance value with smart unit auto-switching.
 * Values < 1000m show in meters, >= 1000m show in km.
 * @param {number} meters - Distance in meters
 * @returns {string} Formatted string (e.g., "523.4 m" or "1.52 km")
 */
export function formatDistanceAuto(meters) {
    if (meters >= 1000) {
        return `${(meters / 1000).toFixed(2)} km`;
    }
    return `${meters.toFixed(1)} m`;
}

/**
 * Formats a distance in a specific unit.
 * @param {number} meters - Distance in meters
 * @param {Object} unit - Unit definition from DISTANCE_UNITS
 * @returns {string} Formatted string
 */
export function formatDistance(meters, unit) {
    const value = meters * unit.factor;
    return `${value.toFixed(unit.decimals)} ${unit.suffix}`;
}

/**
 * Formats an area value with smart unit auto-switching.
 * @param {number} sqMeters - Area in m2
 * @returns {string} Formatted string
 */
export function formatAreaAuto(sqMeters) {
    if (sqMeters >= 1e6) {
        return `${(sqMeters / 1e6).toFixed(3)} km\u00B2`;
    }
    if (sqMeters >= 10000) {
        return `${(sqMeters / 10000).toFixed(2)} ha`;
    }
    return `${sqMeters.toFixed(1)} m\u00B2`;
}

/**
 * Formats an area in a specific unit.
 * @param {number} sqMeters - Area in m2
 * @param {Object} unit - Unit definition from AREA_UNITS
 * @returns {string} Formatted string
 */
export function formatArea(sqMeters, unit) {
    const value = sqMeters * unit.factor;
    return `${value.toFixed(unit.decimals)} ${unit.suffix}`;
}

/**
 * Formats an angle in a specific unit.
 * @param {number} degrees - Angle in degrees
 * @param {Object} unit - Unit definition from ANGLE_UNITS
 * @returns {string} Formatted string
 */
export function formatAngle(degrees, unit) {
    const value = degrees * unit.factor;
    return `${value.toFixed(unit.decimals)}${unit.suffix}`;
}

// Path: js/azimuth_distance_tool/azimuth_distance_geometry.js

/**
 * @fileoverview Geometry calculations for Azimuth and Distance tool.
 * Uses turf.js for geographic calculations.
 *
 * @module azimuth_distance_tool/azimuth_distance_geometry
 */

import {
    MILS_PER_CIRCLE,
    DEGREES_PER_CIRCLE,
    MIL_TO_DEG,
    DEG_TO_MIL,
    ANGULAR_UNIT,
    DISTANCE_UNIT,
    NORTH_REFERENCE,
    OUTPUT_MODE,
    VALIDATION
} from './azimuth_distance_constants.js';

// ============================================================================
// UNIT CONVERSION
// ============================================================================

/**
 * Convert azimuth between degrees and mils.
 *
 * @param {number} value - Azimuth value
 * @param {string} fromUnit - Source unit (ANGULAR_UNIT.DEGREES or ANGULAR_UNIT.MILS)
 * @param {string} toUnit - Target unit
 * @returns {number} Converted value
 */
export function convertAzimuth(value, fromUnit, toUnit) {
    if (fromUnit === toUnit) return value;

    if (fromUnit === ANGULAR_UNIT.DEGREES && toUnit === ANGULAR_UNIT.MILS) {
        return Math.round(value * DEG_TO_MIL);
    }

    if (fromUnit === ANGULAR_UNIT.MILS && toUnit === ANGULAR_UNIT.DEGREES) {
        return parseFloat((value * MIL_TO_DEG).toFixed(1));
    }

    return value;
}

/**
 * Convert distance between meters and kilometers.
 *
 * @param {number} value - Distance value
 * @param {string} fromUnit - Source unit (DISTANCE_UNIT.METERS or DISTANCE_UNIT.KILOMETERS)
 * @param {string} toUnit - Target unit
 * @returns {number} Converted value
 */
export function convertDistance(value, fromUnit, toUnit) {
    if (fromUnit === toUnit) return value;

    if (fromUnit === DISTANCE_UNIT.METERS && toUnit === DISTANCE_UNIT.KILOMETERS) {
        return parseFloat((value / 1000).toFixed(3));
    }

    if (fromUnit === DISTANCE_UNIT.KILOMETERS && toUnit === DISTANCE_UNIT.METERS) {
        return Math.round(value * 1000);
    }

    return value;
}

/**
 * Convert azimuth to degrees (internal standard).
 *
 * @param {number} value - Azimuth value
 * @param {string} unit - Current unit
 * @returns {number} Value in degrees
 */
export function azimuthToDegrees(value, unit) {
    if (unit === ANGULAR_UNIT.MILS) {
        return value * MIL_TO_DEG;
    }
    return value;
}

/**
 * Convert distance to meters (internal standard).
 *
 * @param {number} value - Distance value
 * @param {string} unit - Current unit
 * @returns {number} Value in meters
 */
export function distanceToMeters(value, unit) {
    if (unit === DISTANCE_UNIT.KILOMETERS) {
        return value * 1000;
    }
    return value;
}

// ============================================================================
// DECLINATION CORRECTION
// ============================================================================

/**
 * Apply magnetic declination correction to azimuth.
 * Formula: True Azimuth = Magnetic Azimuth + Declination
 * (West declination is negative, East is positive)
 *
 * @param {number} azimuthDeg - Azimuth in degrees
 * @param {number} declination - Magnetic declination in degrees
 * @param {string} northRef - North reference (NORTH_REFERENCE.MAGNETIC or NORTH_REFERENCE.TRUE)
 * @returns {number} Corrected azimuth in degrees (normalized 0-360)
 */
export function applyDeclination(azimuthDeg, declination, northRef) {
    // If already true north, no correction needed
    if (northRef === NORTH_REFERENCE.TRUE) {
        return normalizeAzimuth(azimuthDeg);
    }

    // Apply declination: True = Magnetic + Declination
    const trueAzimuth = azimuthDeg + declination;
    return normalizeAzimuth(trueAzimuth);
}

/**
 * Normalize azimuth to the [0, 360) range.
 *
 * WHY NOT THE ONE-LINER. `((a % 360) + 360) % 360` is not idempotent near the top
 * of the circle: for a = 359.99999999999994 the sum has no double, rounds to
 * exactly 720, and 720 % 360 is 0 — a bearing one hair short of north snapping TO
 * north. The circle is added only to a remainder that is actually negative, which
 * is the only case that needs it.
 *
 * The `>= 360` guard catches the mirror image of the same rounding: for
 * a = -1e-14 the sum rounds up to exactly 360, and 360 is not in [0, 360).
 *
 * `-0` IS FOLDED TO `0`, and it is not cosmetic: `-0` reaches here from any
 * negative multiple of a full circle (`-720 % 360`) and from a plain `-0` input,
 * and it survives every arithmetic path downstream, so it travels into readings,
 * exports and `Object.is` comparisons unchanged. The fold costs one branch.
 *
 * @param {number} azimuth - Azimuth in degrees
 * @returns {number} Normalized azimuth in [0, 360), or NaN if the input is not finite
 */
export function normalizeAzimuth(azimuth) {
    let result = azimuth % DEGREES_PER_CIRCLE;
    if (result < 0) result += DEGREES_PER_CIRCLE;
    // Float guard: a tiny negative input can make (azimuth % 360) + 360 round to
    // exactly 360 — keep the result strictly in [0, 360) so the op stays idempotent
    // (re-normalizing an already-normalized value returns it unchanged).
    if (result >= DEGREES_PER_CIRCLE) result -= DEGREES_PER_CIRCLE;
    // Folds -0 (and only -0: `0 === -0` is true, so this never touches a real value).
    if (result === 0) return 0;
    return result;
}

/**
 * Calculate contra-azimuth (back azimuth).
 *
 * @param {number} azimuth - Azimuth value
 * @param {string} unit - Angular unit
 * @returns {number} Contra-azimuth in same unit
 */
export function calculateContraAzimuth(azimuth, unit) {
    const half = unit === ANGULAR_UNIT.MILS ? MILS_PER_CIRCLE / 2 : DEGREES_PER_CIRCLE / 2;
    const full = unit === ANGULAR_UNIT.MILS ? MILS_PER_CIRCLE : DEGREES_PER_CIRCLE;
    return parseFloat(((azimuth + half) % full).toFixed(1));
}

// ============================================================================
// WAYPOINT CALCULATION
// ============================================================================

/**
 * Calculate waypoints from reference point and legs.
 *
 * @param {Array<number>} referencePoint - [lng, lat] coordinates
 * @param {Array<Object>} legs - Array of leg objects { azimuth, distance, observation }
 * @param {number} declination - Magnetic declination in degrees
 * @param {string} northRef - North reference
 * @param {string} angularUnit - Angular unit used in legs
 * @param {string} distanceUnit - Distance unit used in legs
 * @returns {Array<Array<number>>} Array of [lng, lat] coordinates
 */
export function calculateWaypoints(
    referencePoint,
    legs,
    declination,
    northRef,
    angularUnit,
    distanceUnit
) {
    if (!referencePoint || !Array.isArray(referencePoint) || referencePoint.length < 2) {
        return [];
    }

    const waypoints = [referencePoint];
    let currentPoint = turf.point(referencePoint);

    for (const leg of legs) {
        // Skip incomplete legs
        if (leg.azimuth === '' || leg.azimuth == null || !leg.distance) {
            continue;
        }

        // 1. Convert azimuth to degrees
        let azimuthDeg = azimuthToDegrees(Number(leg.azimuth), angularUnit);

        // 2. Apply declination correction if magnetic north
        azimuthDeg = applyDeclination(azimuthDeg, declination, northRef);

        // 3. Convert distance to meters, then to kilometers (turf uses km)
        const distanceM = distanceToMeters(Number(leg.distance), distanceUnit);
        const distanceKm = distanceM / 1000;

        // 4. Calculate next point using turf.destination
        // turf.destination expects bearing in degrees (0-360, clockwise from north)
        const nextPoint = turf.destination(
            currentPoint,
            distanceKm,
            azimuthDeg,
            { units: 'kilometers' }
        );

        waypoints.push(nextPoint.geometry.coordinates);
        currentPoint = nextPoint;
    }

    return waypoints;
}

// ============================================================================
// GEOMETRY GENERATION
// ============================================================================

/**
 * Generate GeoJSON geometry based on output mode.
 *
 * @param {Array<Array<number>>} waypoints - Array of [lng, lat] coordinates
 * @param {Array<number>} referencePoint - Original reference point
 * @param {string} outputMode - Output mode (point, route, area)
 * @returns {Object|null} GeoJSON geometry object
 */
export function generateGeometry(waypoints, referencePoint, outputMode) {
    if (!waypoints || waypoints.length === 0) {
        return null;
    }

    switch (outputMode) {
        case OUTPUT_MODE.POINT:
            // For point mode, we return null here - multiple points are created separately
            // This function is only used for single geometry generation
            // Point mode creates multiple features, handled in generatePointFeatures()
            return null;

        case OUTPUT_MODE.ROUTE:
            // Return a LineString through all waypoints
            if (waypoints.length < 2) {
                return null;
            }
            return {
                type: 'LineString',
                coordinates: waypoints
            };

        case OUTPUT_MODE.AREA: {
            // Return a Polygon, closing back to the reference point
            if (waypoints.length < 3) {
                return null;
            }
            // Close the polygon by adding the first point at the end
            const closedCoords = [...waypoints, waypoints[0]];
            return {
                type: 'Polygon',
                coordinates: [closedCoords]
            };
        }

        default:
            return null;
    }
}

/**
 * Generate multiple point features for Point mode.
 * Each waypoint becomes a separate Point feature.
 *
 * @param {Object} options - Feature options
 * @param {Array<Array<number>>} options.waypoints - Calculated waypoints
 * @param {Function} options.generateIds - Function that returns { id, geoJsonId }
 * @param {Function} options.generateName - Async function that returns feature name
 * @param {string} options.layerId - Layer ID
 * @param {Object} options.style - Point style properties
 * @param {Object} options.polarData - Original polar construction data for reference
 * @param {Array<string>} [options.observations] - Per-leg observations to use as point names
 * @returns {Promise<Array<Object>>} Array of point features
 */
export async function generatePointFeatures(options) {
    const {
        waypoints,
        generateIds,
        generateName,
        layerId,
        style,
        polarData,
        observations = [],
        currentZoom = 0
    } = options;

    if (!waypoints || waypoints.length === 0) {
        return [];
    }

    const features = [];

    for (let i = 0; i < waypoints.length; i++) {
        const coords = waypoints[i];
        const { id: featureId, geoJsonId } = generateIds();
        // Use observation as name: waypoint 0 = ref point (no obs), waypoint i = end of leg i-1
        const obsName = i > 0 ? observations[i - 1] : '';
        const featureName = obsName || await generateName();

        const feature = {
            type: 'Feature',
            id: geoJsonId,
            properties: {
                id: featureId,
                layerId,
                featureType: 'azimuth_distance',
                source: 'point',
                nome: featureName,
                descricao: '',
                visivel: true,
                bloqueado: false,

                // Point-specific properties (matching point tool)
                fillColor: style?.fillColor || '#16a34a',
                size: style?.size || 10,
                opacity: style?.opacity || 1,

                // Anchor zoom-correction to the current zoom (like a drawn point), or
                // the 2^(zoom-createdAtZoom) factor balloons the marker at any zoom.
                sizeCreatedAtZoom: currentZoom,
                calculatedSize: style?.size || 10,
                labelCreatedAtZoom: currentZoom,
                labelCalculatedSize: 14,

                // Store polar construction metadata for reference
                azimuthDistanceData: {
                    waypointIndex: i,
                    isReferencePoint: i === 0,
                    ...polarData
                }
            },
            geometry: {
                type: 'Point',
                coordinates: coords
            }
        };

        features.push(feature);
    }

    return features;
}

/**
 * Generate complete GeoJSON feature for Line or Polygon mode.
 * Point mode should use generatePointFeatures() instead.
 *
 * @param {Object} options - Feature options
 * @param {Array<number>} options.referencePoint - [lng, lat]
 * @param {Array<Object>} options.legs - Leg data
 * @param {string} options.outputMode - Output mode
 * @param {string} options.angularUnit - Angular unit
 * @param {string} options.distanceUnit - Distance unit
 * @param {string} options.northReference - North reference
 * @param {number} options.magneticDeclination - Declination in degrees
 * @param {Object} options.style - Style properties
 * @param {string} options.id - Feature ID
 * @param {number} options.geoJsonId - GeoJSON numeric ID
 * @param {string} options.layerId - Layer ID
 * @param {string} options.name - Feature name
 * @returns {Object|null} Complete GeoJSON feature
 */
export function generateFeature(options) {
    const {
        referencePoint,
        legs,
        outputMode,
        angularUnit,
        distanceUnit,
        northReference,
        magneticDeclination,
        style,
        id,
        geoJsonId,
        layerId,
        name
    } = options;

    // Point mode should use generatePointFeatures() instead
    if (outputMode === OUTPUT_MODE.POINT) {
        console.warn('generateFeature called for POINT mode - use generatePointFeatures() instead');
        return null;
    }

    // Calculate waypoints
    const waypoints = calculateWaypoints(
        referencePoint,
        legs,
        magneticDeclination,
        northReference,
        angularUnit,
        distanceUnit
    );

    if (waypoints.length === 0) {
        return null;
    }

    // Generate geometry
    const geometry = generateGeometry(waypoints, referencePoint, outputMode);

    if (!geometry) {
        return null;
    }

    // Store legs with values as entered by user (not converted)
    const storedLegs = legs.map(leg => ({
        azimuth: leg.azimuth,
        distance: leg.distance,
        observation: leg.observation || ''
    }));

    // Polar construction data for reference
    const polarData = {
        referencePoint,
        outputMode,
        angularUnit,
        distanceUnit,
        northReference,
        magneticDeclination,
        legs: storedLegs,
        calculatedWaypoints: waypoints
    };

    // Generate feature based on output mode (matching standard tools)
    if (outputMode === OUTPUT_MODE.ROUTE) {
        // LINE feature (matching add_line_control.js structure)
        return {
            type: 'Feature',
            id: geoJsonId,
            properties: {
                id,
                layerId,
                featureType: 'azimuth_distance',
                source: 'line',
                nome: name,
                descricao: '',
                visivel: true,
                bloqueado: false,

                // Line-specific properties (matching line tool)
                lineColor: style?.lineColor || '#16a34a',
                lineWidth: style?.lineWidth || 5,
                opacity: style?.opacity || 0.7,
                lineStyle: style?.lineStyle || 'solid',
                measure: false,
                profile: false,
                profileData: null,

                // Store base coordinates for editing (like line tool)
                baseCoordinates: waypoints,

                // Per-leg observations (used by QAN export and observations editor)
                observations: storedLegs.map(leg => leg.observation),

                // Store polar construction data
                azimuthDistanceData: polarData
            },
            geometry
        };
    } else if (outputMode === OUTPUT_MODE.AREA) {
        // POLYGON feature (matching add_polygon_control.js structure)
        return {
            type: 'Feature',
            id: geoJsonId,
            properties: {
                id,
                layerId,
                featureType: 'azimuth_distance',
                source: 'polygon',
                nome: name,
                descricao: '',
                visivel: true,
                bloqueado: false,

                // Polygon-specific properties (matching polygon tool)
                fillColor: style?.fillColor || '#16a34a',
                lineColor: style?.lineColor || '#16a34a',
                lineWidth: style?.lineWidth || 2,
                opacity: style?.opacity || 0.5,
                lineStyle: style?.lineStyle || 'solid',
                measure: false,
                hatchEnabled: false,
                hatchType: 'none',
                hatchColor: '#000000',
                hatchSpacing: 8,
                hatchLineWidth: 2,

                // Store base coordinates for editing (like polygon tool)
                baseCoordinates: waypoints,

                // Per-leg observations (used by QAN export and observations editor)
                observations: storedLegs.map(leg => leg.observation),

                // Store polar construction data
                azimuthDistanceData: polarData
            },
            geometry
        };
    }

    return null;
}

// ============================================================================
// TOTAL DISTANCE CALCULATION
// ============================================================================

/**
 * Calculate total distance of all legs.
 * Returns the sum of leg distances as entered (unit-agnostic).
 * Use formatTotalDistance() to display with unit label.
 *
 * @param {Array<Object>} legs - Array of leg objects
 * @returns {number} Total distance in the current unit
 */
export function calculateTotalDistance(legs) {
    let total = 0;

    for (const leg of legs) {
        if (leg.distance) {
            total += Number(leg.distance);
        }
    }

    return total;
}

/**
 * Format total distance for display.
 *
 * @param {number} totalDistance - Total distance
 * @param {string} distanceUnit - Distance unit
 * @returns {string} Formatted string (e.g., "1.5 km" or "800 m")
 */
export function formatTotalDistance(totalDistance, distanceUnit) {
    if (distanceUnit === DISTANCE_UNIT.KILOMETERS) {
        return `${totalDistance.toFixed(2)} km`;
    }

    // If in meters, show km if >= 1000m
    if (totalDistance >= 1000) {
        return `${(totalDistance / 1000).toFixed(2)} km`;
    }

    return `${totalDistance} m`;
}

// ============================================================================
// VALIDATION
// ============================================================================

/**
 * Validate a leg's data.
 *
 * @param {Object} leg - Leg object
 * @param {string} angularUnit - Angular unit
 * @returns {{valid: boolean, errors: string[]}} Validation result
 */
export function validateLeg(leg, angularUnit) {
    const errors = [];

    // Check azimuth
    if (leg.azimuth !== '' && leg.azimuth != null) {
        const az = Number(leg.azimuth);
        const maxAz = angularUnit === ANGULAR_UNIT.MILS ? MILS_PER_CIRCLE : DEGREES_PER_CIRCLE;

        if (isNaN(az) || az < 0 || az > maxAz) {
            errors.push(`Azimute deve estar entre 0 e ${maxAz}`);
        }
    }

    // Check distance
    if (leg.distance) {
        const dist = Number(leg.distance);
        if (isNaN(dist) || dist < 0) {
            errors.push('Distância deve ser maior ou igual a 0');
        }
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Check if feature can be created.
 *
 * @param {Array<number>} referencePoint - Reference point
 * @param {Array<Object>} legs - Legs data
 * @param {string} outputMode - Output mode
 * @returns {{canCreate: boolean, reason: string|null}} Result
 */
export function canCreateFeature(referencePoint, legs, outputMode) {
    // Must have reference point
    if (!referencePoint || referencePoint.length < 2) {
        return { canCreate: false, reason: 'Defina o ponto de referência' };
    }

    // Count complete legs (have both azimuth and distance)
    const completLegs = legs.filter(l =>
        l.azimuth !== '' && l.azimuth != null && l.distance
    );

    if (completLegs.length === 0) {
        return { canCreate: false, reason: 'Adicione pelo menos uma perna completa' };
    }

    // Area mode needs at least 2 legs (2 legs + closing to origin = 3 points = triangle)
    if (outputMode === OUTPUT_MODE.AREA && completLegs.length < VALIDATION.MIN_LEGS_FOR_AREA) {
        return { canCreate: false, reason: 'Área requer pelo menos 2 pernas' };
    }

    return { canCreate: true, reason: null };
}

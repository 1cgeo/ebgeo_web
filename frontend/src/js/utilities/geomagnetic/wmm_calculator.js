// Path: js/utilities/geomagnetic/wmm_calculator.js
/**
 * @fileoverview Magnetic declination calculator using the geomagnetism npm package.
 * Wraps the WMM (World Magnetic Model) implementation for use in EBGeo.
 *
 * Uses WMM2025 coefficients (valid 2025.0-2030.0) via the geomagnetism library.
 *
 * @module utilities/geomagnetic/wmm_calculator
 */

import geomagnetism from 'geomagnetism';

// ============================================================================
// CONSTANTS
// ============================================================================

const WMM_EPOCH = 2025.0;
const WMM_EXPIRY = 2030.0;
const WMM_MODEL_NAME = 'WMM2025';
const MS_PER_DAY = 86_400_000;

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Computes magnetic declination for a position and date using WMM2025.
 *
 * @param {number} lat - Latitude in decimal degrees (-90 to 90)
 * @param {number} lng - Longitude in decimal degrees (-180 to 180)
 * @param {number} [altitudeKm=0] - Altitude in km above the WGS84 ellipsoid
 * @param {Date} [date=new Date()] - Calculation date
 * @returns {{ declination: number, inclination: number, intensity: number, warning: string|null }|null}
 *   - declination: degrees, positive=East, negative=West
 *   - inclination: magnetic dip in degrees
 *   - intensity: total field intensity in nT
 *   - warning: string if date is outside model validity, null otherwise
 */
export function calculateMagneticDeclination(lat, lng, altitudeKm = 0, date = new Date()) {
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        return null;
    }

    const clampedAltitude = Math.max(0, altitudeKm);

    let warning = null;
    const validity = checkWMMValidity(date);
    if (!validity.valid) {
        warning = validity.message;
        console.warn(`${WMM_MODEL_NAME}: ${warning}`);
    }

    const model = geomagnetism.model(date, { allowOutOfBoundsModel: true });
    const result = model.point([lat, lng, clampedAltitude]);

    return {
        declination: roundTo(result.decl, 2),
        inclination: roundTo(result.incl, 2),
        intensity: roundTo(result.f, 1),
        warning
    };
}

/**
 * Checks whether WMM coefficients are still within their validity period.
 *
 * @param {Date} [date=new Date()] - Date to check
 * @returns {{ valid: boolean, message: string|null }}
 */
export function checkWMMValidity(date = new Date()) {
    const decimalYear = dateToDecimalYear(date);

    if (decimalYear < WMM_EPOCH) {
        return {
            valid: false,
            message: `Data anterior ao modelo ${WMM_MODEL_NAME} (válido a partir de ${WMM_EPOCH})`
        };
    }

    if (decimalYear >= WMM_EXPIRY) {
        return {
            valid: false,
            message: `Coeficientes ${WMM_MODEL_NAME} expirados. Precisão da declinação degradada.`
        };
    }

    return { valid: true, message: null };
}

// ============================================================================
// PRIVATE HELPERS
// ============================================================================

/**
 * Rounds a number to the specified number of decimal places.
 *
 * @param {number} value
 * @param {number} decimals
 * @returns {number}
 */
function roundTo(value, decimals) {
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
}

/**
 * Converts a Date to a decimal year representation.
 *
 * @param {Date} date
 * @returns {number}
 */
function dateToDecimalYear(date) {
    const year = date.getFullYear();
    const startOfYear = new Date(year, 0, 1);
    const startOfNext = new Date(year + 1, 0, 1);
    const daysInYear = (startOfNext - startOfYear) / MS_PER_DAY;
    const dayOfYear = (date - startOfYear) / MS_PER_DAY;
    return year + dayOfYear / daysInYear;
}

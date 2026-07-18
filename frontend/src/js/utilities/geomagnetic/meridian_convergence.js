// Path: js/utilities/geomagnetic/meridian_convergence.js
/**
 * @fileoverview Meridian (grid) convergence for UTM / Transverse Mercator.
 * γ = angle from True North (NV) to Grid North (NQ), positive = East (clockwise).
 *
 * @module utilities/geomagnetic/meridian_convergence
 */

const DEG = Math.PI / 180;

/** WGS84 second eccentricity squared (e'^2), used in the 2nd-order term. */
const E_PRIME_SQ = 0.00673949674228;

/**
 * UTM zone number (1-60) for a longitude.
 * @param {number} lng - Longitude in decimal degrees
 * @returns {number}
 */
function utmZone(lng) {
    return Math.floor((lng + 180) / 6) + 1;
}

/**
 * Central meridian (decimal degrees) of the UTM zone containing lng.
 * @param {number} lng - Longitude in decimal degrees
 * @returns {number}
 */
export function utmCentralMeridian(lng) {
    return utmZone(lng) * 6 - 183;
}

/**
 * Meridian convergence at a point.
 * First-order term (λ−λ₀)·sinφ with a small 2nd-order correction.
 *
 * @param {number} lat - Latitude in decimal degrees (-90..90)
 * @param {number} lng - Longitude in decimal degrees (-180..180)
 * @param {number} [lambda0] - Central meridian (deg); defaults to UTM zone CM
 * @returns {number|null} Convergence in degrees (+East, −West), or null if invalid
 */
export function calculateMeridianConvergence(lat, lng, lambda0 = utmCentralMeridian(lng)) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

    const phi = lat * DEG;
    const dLambda = (lng - lambda0) * DEG;
    const cos2 = Math.cos(phi) ** 2;

    const gammaRad = dLambda * Math.sin(phi) *
        (1 + (dLambda ** 2 / 3) * cos2 * (1 + 3 * E_PRIME_SQ * cos2));

    const result = Math.round((gammaRad / DEG) * 100) / 100; // 2 decimal places
    return result === 0 ? 0 : result; // normalize -0 → 0
}

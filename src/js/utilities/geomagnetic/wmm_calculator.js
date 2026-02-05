/**
 * @fileoverview Magnetic declination calculator using the geomagnetism npm package.
 * Wraps the WMM (World Magnetic Model) implementation for use in EBGeo.
 *
 * Uses WMM2025 coefficients (valid 2025.0–2030.0) via the geomagnetism library.
 *
 * @module utilities/geomagnetic/wmm_calculator
 * @dependencies geomagnetism
 */

import geomagnetism from 'geomagnetism';

// ============================================================================
// CONSTANTS
// ============================================================================

const WMM_EPOCH = 2025.0;
const WMM_EXPIRY = 2030.0;
const WMM_MODEL_NAME = 'WMM2025';

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Calcula a declinação magnética para uma posição e data usando WMM2025.
 *
 * @param {number} lat - Latitude em graus decimais (-90 a 90)
 * @param {number} lng - Longitude em graus decimais (-180 a 180)
 * @param {number} [altitudeKm=0] - Altitude em km acima do elipsoide WGS84
 * @param {Date} [date=new Date()] - Data do cálculo
 * @returns {{ declination: number, inclination: number, intensity: number, warning: string|null }|null}
 *   - declination: em graus, positivo=Leste, negativo=Oeste
 *   - inclination: inclinação magnética em graus
 *   - intensity: intensidade total em nT
 *   - warning: string se data fora da validade, null caso contrário
 */
export function calculateMagneticDeclination(lat, lng, altitudeKm = 0, date = new Date()) {
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        return null;
    }

    if (altitudeKm < 0) altitudeKm = 0;

    let warning = null;
    const validity = checkWMMValidity(date);
    if (!validity.valid) {
        warning = validity.message;
        console.warn(`${WMM_MODEL_NAME}: ${warning}`);
    }

    const model = geomagnetism.model(date, { allowOutOfBoundsModel: true });
    const result = model.point([lat, lng, altitudeKm]);

    return {
        declination: parseFloat(result.decl.toFixed(2)),
        inclination: parseFloat(result.incl.toFixed(2)),
        intensity: parseFloat(result.f.toFixed(1)),
        warning
    };
}

/**
 * Verifica se os coeficientes WMM ainda estão dentro da validade.
 *
 * @param {Date} [date=new Date()] - Data a verificar
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
 * @param {Date} date
 * @returns {number} Decimal year
 */
function dateToDecimalYear(date) {
    const year = date.getFullYear();
    const startOfYear = new Date(year, 0, 1);
    const startOfNext = new Date(year + 1, 0, 1);
    const daysInYear = (startOfNext - startOfYear) / (24 * 60 * 60 * 1000);
    const dayOfYear = (date - startOfYear) / (24 * 60 * 60 * 1000);
    return year + dayOfYear / daysInYear;
}

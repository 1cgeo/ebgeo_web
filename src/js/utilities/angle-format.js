// Path: js/utilities/angle-format.js

/**
 * @fileoverview Shared formatting for signed angles with a cardinal-direction
 * suffix (Brazilian convention: positive = East/Leste, negative = West/Oeste).
 */

/**
 * Formats a signed angle in degrees with a direction suffix and comma decimal.
 * Nullish values are treated as 0.
 *
 * @param {number} degrees - Angle in degrees (+East, −West)
 * @param {Object} [options]
 * @param {boolean} [options.long=false] - true → "Leste"/"Oeste"; false → "E"/"W"
 * @returns {string} e.g. "21,5° W" or "21,5° Leste"
 */
export function formatSignedDegrees(degrees, { long = false } = {}) {
    const value = degrees ?? 0;
    const magnitude = Math.abs(value).toFixed(1).replace('.', ',');
    const east = long ? 'Leste' : 'E';
    const west = long ? 'Oeste' : 'W';
    return `${magnitude}° ${value >= 0 ? east : west}`;
}

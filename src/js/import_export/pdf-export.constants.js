// Path: js/import_export/pdf-export.constants.js

/**
 * Shared constants between pdf-export.tab.js and pdf-cartographic-elements.js.
 * Single source of truth for values that must stay in sync across both modules.
 */

/** Extra margin (mm) added around the map when grid labels are shown. */
export const GRID_MARGIN_MM = 5;

/** Scale denominator at which UTM grid becomes meaningless. */
export const UTM_MAX_SCALE_DENOM = 2500000;

/**
 * Parses the denominator from a scale string like "1:25000".
 * @param {string} scale - Scale string
 * @returns {number} Scale denominator (defaults to 25000 if parsing fails)
 */
export function parseScaleDenom(scale) {
    return parseInt(scale.split(':')[1], 10) || 25000;
}

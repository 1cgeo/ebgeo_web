// Path: js/import_export/pdf-export.constants.js

/**
 * Shared constants between pdf-export.tab.js and pdf-cartographic-elements.js.
 * Single source of truth for values that must stay in sync across both modules.
 */

/** Extra margin (mm) added around the map when grid labels are shown. */
export const GRID_MARGIN_MM = 5;

/** Scale denominator at which UTM grid becomes meaningless. */
export const UTM_MAX_SCALE_DENOM = 2500000;

/** Maximum rows/columns selectable for a mosaic (multi-page) export. */
export const MOSAIC_MAX_DIM = 6;

/**
 * Width (mm) of the coordinate border band drawn on the OUTER perimeter sheets
 * of a mosaic when a grid is enabled. Internal seams stay full-bleed/continuous.
 */
export const MOSAIC_BORDER_MM = 8;

/**
 * Overlap (mm) duplicated between neighbouring mosaic sheets along every internal
 * seam. Each sheet renders this much of its neighbours' map on its top/left, so the
 * operator can cut along the verso guide and lay the cut edge OVER the neighbour —
 * the printer's unprintable border (~3–6 mm) falls inside the duplicated strip, so
 * the assembled mosaic has no white gutter. Must exceed the worst-case printer
 * margin; 10 mm covers typical laser/inkjet printers with slack.
 */
export const MOSAIC_OVERLAP_MM = 10;

/** Soft warning threshold for total mosaic pages (rows × cols). */
export const MOSAIC_WARN_TILES = 16;

/**
 * Parses the denominator from a scale string like "1:25000".
 * @param {string} scale - Scale string
 * @returns {number} Scale denominator (defaults to 25000 if parsing fails)
 */
export function parseScaleDenom(scale) {
    return parseInt(scale.split(':')[1], 10) || 25000;
}

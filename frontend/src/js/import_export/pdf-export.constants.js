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
 * Assumed UNPRINTABLE margin (mm) of the operator's printer. When a full-bleed
 * image is printed at 100% ("tamanho real"), consumer/office printers cannot lay
 * ink within ~3–6.4 mm of the paper edge, leaving a white border on every sheet.
 * Fixed at a conservative 10 mm so the derived seam overlap defeats even
 * wide-margin printers without needing a per-printer setting.
 */
export const MOSAIC_PRINTER_MARGIN_MM = 10;

/**
 * Extra per-side tolerance (mm) for an imperfect manual cut / sheet registration.
 * Added on top of the printer margin so the seam survives small alignment errors.
 */
export const MOSAIC_CUT_SLACK_MM = 2;

/**
 * Seam overlap (mm) duplicated between neighbouring mosaic sheets.
 *
 * At EVERY internal seam two full-bleed sheets meet and EACH loses its own ~m mm
 * unprintable margin, so their inked regions only overlap by `O − 2m`. To hide the
 * seam the operator cuts ONE sheet at the MIDDLE of the duplicated strip (O/2) —
 * removing that sheet's own white margin — and lays its inked cut edge so it
 * covers the neighbour's white margin. That needs `O/2 ≥ m` on each side, i.e.
 * `O ≥ 2m`; adding `s` mm of cut tolerance per side gives `O = 2·(m + s)`.
 *
 * (The earlier 10 mm value used the wrong budget — `O > m` instead of `O ≥ 2m` —
 * and combined with a cut at the full overlap it left a white strip ≈ m at every
 * seam regardless of overlap.)
 *
 * A default PARAMETER only fires for `undefined`, so `null` (and NaN, and a
 * string) used to reach the arithmetic: `getMosaicOverlapMm(null)` answered 4 mm
 * where the fixed margin gives 24 mm, which is a seam that does not close. The
 * guard is explicit so every spelling of "no margin given" lands on the default.
 *
 * @param {number} [printerMarginMm=MOSAIC_PRINTER_MARGIN_MM] - Assumed unprintable margin (mm)
 * @returns {number} Overlap in mm
 */
export function getMosaicOverlapMm(printerMarginMm = MOSAIC_PRINTER_MARGIN_MM) {
    const margin = Number.isFinite(printerMarginMm)
        ? printerMarginMm
        : MOSAIC_PRINTER_MARGIN_MM;
    return 2 * (margin + MOSAIC_CUT_SLACK_MM);
}

/** Seam overlap (mm) at the fixed printer margin (= 24 mm). */
export const MOSAIC_OVERLAP_MM = getMosaicOverlapMm();

/** Soft warning threshold for total mosaic pages (rows × cols). */
export const MOSAIC_WARN_TILES = 16;

/**
 * Parses the denominator from a scale string like "1:25000".
 *
 * A scale denominator has to be POSITIVE, and `|| 25000` only caught 0 and NaN:
 * '1:-5000' came back as -5000 and reached every consumer (bar width, ground
 * span, zoom), flipping their signs instead of falling back.
 *
 * @param {string} scale - Scale string
 * @returns {number} Scale denominator (defaults to 25000 if parsing fails)
 */
export function parseScaleDenom(scale) {
    // A non-string still throws, deliberately: that is a caller bug, and every
    // caller already passes `scale || '1:25000'`.
    const denom = parseInt(scale.split(':')[1], 10);
    return Number.isFinite(denom) && denom > 0 ? denom : 25000;
}

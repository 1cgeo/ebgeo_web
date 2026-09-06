// Path: js/military_tools/bitmap-version.js

/**
 * Version stamp of the SYMBOL BITMAP layout, for military symbols and coordination
 * measures.
 *
 * Version 1 is implicit and never stamped: it is every bitmap generated before the
 * crop, drawn centred inside a square canvas, with transparent bands wherever the
 * drawing was not as wide as it was tall. The selection box and the click hit-test
 * are the bitmap rectangle, so those bands showed as a box larger than the drawing.
 *
 * Version 2 crops the canvas to the drawing and, when the catalog entry says which
 * point of the drawing must sit on the coordinate, carries an `iconOffset`.
 *
 * A feature whose `bitmapVersion` is not the current one still has an old bitmap on
 * disk and has to be regenerated (startup migration, `.ebgeo` import).
 */

export const SYMBOL_BITMAP_VERSION = 2;

/**
 * Whether the stored bitmap of a feature is already in the current layout.
 * @param {Object} properties - Feature properties
 * @returns {boolean} True when the bitmap does not need regenerating
 */
export function hasCurrentBitmap(properties) {
    return properties?.bitmapVersion === SYMBOL_BITMAP_VERSION;
}

/**
 * Writes a generator result into feature properties, and stamps the layout version.
 *
 * This is the ONE place that knows which keys a generated bitmap owns: whoever
 * regenerates a symbol (the tool controls, the point conversion, the import, the
 * migration) calls this instead of copying the keys by hand, so no writer can leave
 * one of them stale.
 *
 * `iconOffset` is written only when the result carries a real displacement. A symbol
 * anchored by the centre of its bitmap has none, and the key stays ABSENT: writing
 * `[0, 0]` would change the stored shape of every old feature for nothing.
 *
 * @param {Object} properties - Feature properties (mutated)
 * @param {Object} result - Generator result { width, height, pixelRatio?, anchor?, iconOffset? }
 * @returns {Object} The same properties object
 */
export function applyGeneratedBitmap(properties, result) {
    if (!properties || !result) {
        return properties;
    }

    properties.width = result.width;
    properties.height = result.height;

    if (Number.isFinite(result.pixelRatio) && result.pixelRatio > 0) {
        properties.pixelRatio = result.pixelRatio;
    }

    if (result.anchor !== undefined && result.anchor !== null) {
        properties.anchor = result.anchor;
    }

    if (temDeslocamento(result.iconOffset)) {
        properties.iconOffset = result.iconOffset;
    } else {
        delete properties.iconOffset;
    }

    properties.bitmapVersion = SYMBOL_BITMAP_VERSION;

    return properties;
}

/**
 * Whether an icon offset actually moves the icon.
 * @param {*} iconOffset - Candidate offset
 * @returns {boolean} True for a finite, non-zero pair
 */
function temDeslocamento(iconOffset) {
    if (!Array.isArray(iconOffset) || iconOffset.length !== 2) {
        return false;
    }

    const [dx, dy] = iconOffset;

    return Number.isFinite(dx) && Number.isFinite(dy) && (dx !== 0 || dy !== 0);
}

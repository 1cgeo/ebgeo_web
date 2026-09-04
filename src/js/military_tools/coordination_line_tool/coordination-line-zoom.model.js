// Path: js/military_tools/coordination_line_tool/coordination-line-zoom.model.js

import { ZOOM_STOPS } from '../../layers/styles/zoom-expression.js';

/**
 * @fileoverview Pure zoom and layout model for coordination line features
 * (node-testable; its one import is the integer zoom stops, from a module that
 * imports nothing itself).
 *
 * A coordination line is a polyline whose course is interrupted at regular intervals
 * by a hollow diamond. Two authored numbers drive the pattern, both in kilometres:
 * `symbol_size` is the diamond's along-line diagonal, and `symbol_spacing` is the
 * distance between two diamond CENTRES.
 *
 * The zoom contract is the boundary tool's, on purpose, so the two military line
 * tools behave the same under the same switch:
 *
 *   - `createdAtZoom` is the zoom the feature was drawn at (one decimal place).
 *   - `zoomCorrectionEnabled` defaults to true and pins the feature to the
 *     TERRAIN: the pixel-sized part (the stroke) grows 2x per zoom level, and the
 *     kilometre-sized part (the diamonds) keeps its ground size.
 *   - Switching it OFF pins the feature to the SCREEN: the stroke stays put and
 *     the diamonds shrink in kilometres by the reciprocal factor, so the drawing
 *     keeps the same apparent size at every zoom.
 *
 * A feature with neither property (a legacy one, or one pasted from an older
 * file) gets a factor of 1 on both axes and draws exactly as it always did.
 *
 * Everything here is arithmetic on numbers. The turf part lives in
 * add_coordination_line_geometry.js, which imports this module; nothing imports back,
 * so the constants below have exactly one home and need no parity test.
 */

/**
 * Bounds for the derived values.
 *
 * The pixel maximum exists because MapLibre rejects absurd stroke widths. The
 * kilometre pair bounds values that feed `turf.destination`, which a few zoom
 * levels away from the anchor would otherwise wander to the other side of the
 * planet.
 *
 * `MAX_GAP_FRACTION` is the share of the line the diamonds may eat. It reads
 * unusually cleanly here: one diamond costs exactly its own size, and the pattern
 * repeats every `spacing`, so the eaten share IS `size / spacing`, and the bound
 * collapses to `size <= MAX_GAP_FRACTION * spacing`. Measured on 2026-09-03: a
 * line with `size > spacing` merges every gap into one and leaves NO visible
 * line at all (94 diamonds, 2 stray segments on a 96 km line).
 *
 * `MAX_GLYPHS` is the ceiling that keeps a zoom gesture inside its frame
 * budget. Measured on 2026-09-03 against the bundled turf, on a 100 km line: one
 * feature costs 1.3 ms at 200 diamonds, but the zoom pass regenerates EVERY
 * screen-pinned feature per frame, and 30 features at 200 took 20.0 ms against
 * the 16.7 ms budget, while 30 features at 100 took 8.0 ms. Left unbounded, a
 * 100 km line pinned to the screen and zoomed to z=22 asks for 51,277 diamonds
 * (358,941 vertices, 14 MB of GeoJSON, 135 ms to build).
 */
export const COORDINATION_LINE_ZOOM_LIMITS = {
    MAX_LINE_WIDTH_PX: 60,
    MIN_SYMBOL_SIZE_KM: 0.001,
    MAX_SYMBOL_SIZE_KM: 50,
    MIN_SPACING_KM: 0.002,
    MAX_SPACING_KM: 500,
    MAX_GAP_FRACTION: 0.5,
    MAX_GLYPHS: 120,
};

/** Fallbacks used when the authored value is missing or not a positive number. */
export const COORDINATION_LINE_ZOOM_DEFAULTS = {
    lineWidth: 4,
    symbolSizeKm: 0.5,
    symbolSpacingKm: 2,
};

/**
 * Coerce an authored size to a usable positive number.
 * @param {*} value - Authored value (may be undefined, NaN, negative)
 * @param {number} fallback - Value to use when `value` is unusable
 * @returns {number} A finite positive number
 */
function positiveOr(value, fallback) {
    return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Clamp a derived value into `(0, max]`, never returning NaN.
 * @param {number} value - Derived value
 * @param {number} max - Upper bound
 * @param {number} fallback - Value to use when `value` is not finite
 * @returns {number} Clamped value
 */
function clampSize(value, max, fallback) {
    if (!Number.isFinite(value)) return fallback;
    if (value <= 0) return fallback;
    return Math.min(value, max);
}

/**
 * Clamp a derived value into `[min, max]`, never returning NaN.
 * @param {number} value - Derived value
 * @param {number} min - Lower bound
 * @param {number} max - Upper bound
 * @param {number} fallback - Value to use when `value` is not finite
 * @returns {number} Clamped value
 */
function clampRange(value, min, max, fallback) {
    const usable = Number.isFinite(value) ? value : fallback;
    if (!Number.isFinite(usable)) return min;
    return Math.min(max, Math.max(min, usable));
}

/**
 * Whether the feature carries a usable zoom reference.
 *
 * Zero is deliberately NOT one. It is finite, so a bare `Number.isFinite` test
 * accepts it, but it is also the sentinel the control's DEFAULT_PROPERTIES carries
 * for "never anchored", and the map's own minimum zoom is 1: any caller that
 * spreads those defaults without stamping a real zoom would otherwise get a
 * factor of `2 ** currentZoom` and saturate every clamp at once.
 *
 * @param {Object} [properties] - Feature properties
 * @returns {boolean} True when `createdAtZoom` is a finite number above zero
 */
export function hasZoomReference(properties) {
    return Number.isFinite(properties?.createdAtZoom) && properties.createdAtZoom > 0;
}

/**
 * Scale factor applied to pixel-sized parts (the stroke).
 * Returns 1 (today's behaviour) when there is no reference, when the correction
 * is switched off, or when the current zoom is not a finite number.
 *
 * @param {Object} [properties] - Feature properties
 * @param {number} currentZoom - Current map zoom
 * @returns {number} `2 ** (currentZoom - createdAtZoom)`, or 1
 */
export function getPixelZoomFactor(properties, currentZoom) {
    if (!hasZoomReference(properties)) return 1;
    if (properties.zoomCorrectionEnabled === false) return 1;
    if (!Number.isFinite(currentZoom)) return 1;

    const factor = 2 ** (currentZoom - properties.createdAtZoom);
    return Number.isFinite(factor) && factor > 0 ? factor : 1;
}

/**
 * Scale factor applied to the ground-sized parts (diamond size and spacing, both
 * in km). It is the RECIPROCAL of the pixel factor and only leaves 1 when the
 * correction is switched OFF: that is what pins the diamonds to the screen, so
 * that turning the correction off freezes the whole feature visually instead of
 * half of it.
 *
 * @param {Object} [properties] - Feature properties
 * @param {number} currentZoom - Current map zoom
 * @returns {number} `2 ** (createdAtZoom - currentZoom)`, or 1
 */
export function getGroundZoomFactor(properties, currentZoom) {
    if (!hasZoomReference(properties)) return 1;
    if (properties.zoomCorrectionEnabled !== false) return 1;
    if (!Number.isFinite(currentZoom)) return 1;

    const factor = 2 ** (properties.createdAtZoom - currentZoom);
    return Number.isFinite(factor) && factor > 0 ? factor : 1;
}

/**
 * Whether the feature is pinned to the SCREEN, i.e. it has a reference zoom and
 * the correction is switched off. This is the only state in which the derived
 * kilometre values can differ from the authored ones, so it is also the gate the
 * control uses before deciding a zoom change reshaped the geometry.
 *
 * @param {Object} [properties] - Feature properties
 * @returns {boolean} True when the diamonds must be rescaled per zoom level
 */
export function isScreenAnchored(properties) {
    return hasZoomReference(properties) && properties.zoomCorrectionEnabled === false;
}

/**
 * Smallest spacing a given diamond size may sit at.
 *
 * This is the single invariant that keeps a coordination line from eating itself, and
 * it is enforced HERE rather than at the panel because the panel is not the only
 * writer: a pasted feature, an imported `.ebgeo`, and the zoom correction all
 * reach the geometry without passing a slider. `computeCoordinationLineZoomSizes`
 * clamps size and spacing independently, and independent clamps can land on a
 * pair that violates the ratio, so the geometry re-applies this at the point of
 * use, where nothing can route around it.
 *
 * @param {number} sizeKm - Diamond along-line diagonal, in kilometres
 * @param {number} spacingKm - Requested distance between diamond centres
 * @returns {number} The requested spacing, or the smallest one the size allows
 */
export function clampSpacingForSize(sizeKm, spacingKm) {
    const size = positiveOr(sizeKm, COORDINATION_LINE_ZOOM_DEFAULTS.symbolSizeKm);
    const asked = positiveOr(spacingKm, COORDINATION_LINE_ZOOM_DEFAULTS.symbolSpacingKm);
    const floor = size / COORDINATION_LINE_ZOOM_LIMITS.MAX_GAP_FRACTION;
    return Math.max(asked, floor);
}

/**
 * Place the diamonds along a line of a given length.
 *
 * The pattern is centred: whatever length the diamonds do not span is split
 * evenly between the two ends, so a coordination line always starts and ends with a
 * stretch of plain line rather than with half a diamond.
 *
 * When the requested spacing would ask for more diamonds than `MAX_GLYPHS`,
 * the spacing WIDENS instead of the pattern stopping midway: a capped line still
 * reads as a coordination line end to end, just a sparser one. Stopping at the cap
 * would leave the tail of a long line looking like a plain line, which is a
 * different symbol.
 *
 * @param {number} totalLengthKm - Length of the line, in kilometres
 * @param {number} sizeKm - Diamond along-line diagonal, in kilometres
 * @param {number} spacingKm - Requested distance between diamond centres
 * @returns {{count: number, size: number, spacing: number, start: number, capped: boolean}}
 *   `count` is 0 when no whole diamond fits, and then the caller draws a plain
 *   line. `start` is the distance along the line of the FIRST diamond's centre.
 */
export function resolveGlyphLayout(totalLengthKm, sizeKm, spacingKm) {
    const empty = { count: 0, size: 0, spacing: 0, start: 0, capped: false };

    if (!Number.isFinite(totalLengthKm) || totalLengthKm <= 0) return empty;
    if (!Number.isFinite(sizeKm) || sizeKm <= 0) return empty;
    if (!Number.isFinite(spacingKm) || spacingKm <= 0) return empty;

    // A diamond that does not fit whole would have to be clipped by the ends of
    // the line, and a clipped diamond is not the symbol.
    if (sizeKm > totalLengthKm) return empty;

    let spacing = clampSpacingForSize(sizeKm, spacingKm);
    const usable = totalLengthKm - sizeKm;
    let count = Math.floor(usable / spacing) + 1;
    let capped = false;

    if (count > COORDINATION_LINE_ZOOM_LIMITS.MAX_GLYPHS) {
        count = COORDINATION_LINE_ZOOM_LIMITS.MAX_GLYPHS;
        capped = true;
        // Spread the survivors over the whole usable span. With `count > 1` this
        // is always at least the clamped spacing, since the cap only fires when
        // the requested spacing was smaller.
        spacing = usable / (count - 1);
    }

    const span = (count - 1) * spacing;
    const start = (totalLengthKm - span) / 2;

    return { count, size: sizeKm, spacing, start, capped };
}

/**
 * Place a CONTINUOUS pattern along a line: the sap and the trench, whose drawing
 * is the course of the line rather than a mark placed along it.
 *
 * Two things separate this from `resolveGlyphLayout`, and both follow from the
 * pattern having no gaps. The period is FITTED to the line (`total / round(total
 * / period)`) rather than leaving the remainder split between the two ends,
 * because a continuous pattern that stopped short would end in a stub of plain
 * line, and plain line is a different symbol. And `symbol_spacing` plays no part
 * at all, which is why the panel hides its slider for these two.
 *
 * The cap widens the period the same way the other layout does, and for the same
 * reason: a capped line still reads end to end, just coarser.
 *
 * @param {number} totalLengthKm - Length of the line, in kilometres
 * @param {number} periodKm - Requested length of one tooth
 * @returns {{count: number, period: number, capped: boolean}} `count` is 0 when
 *   not one whole tooth fits, and then the caller draws a plain line.
 */
export function resolveContinuousLayout(totalLengthKm, periodKm) {
    const empty = { count: 0, period: 0, capped: false };

    if (!Number.isFinite(totalLengthKm) || totalLengthKm <= 0) return empty;
    if (!Number.isFinite(periodKm) || periodKm <= 0) return empty;
    if (periodKm > totalLengthKm) return empty;

    let count = Math.max(1, Math.round(totalLengthKm / periodKm));
    let capped = false;

    if (count > COORDINATION_LINE_ZOOM_LIMITS.MAX_GLYPHS) {
        count = COORDINATION_LINE_ZOOM_LIMITS.MAX_GLYPHS;
        capped = true;
    }

    return { count, period: totalLengthKm / count, capped };
}

/**
 * Derive every zoom-dependent size from the authored ones.
 *
 * The kilometre pair is clamped independently of each other, which can produce a
 * pair that violates `MAX_GAP_FRACTION`; that is deliberate, and
 * `resolveGlyphLayout` is where the pair is reconciled. Clamping the ratio here
 * instead would silently rewrite the user's spacing into the stored feature.
 *
 * @param {Object} [properties] - Coordination line feature properties
 * @param {number} currentZoom - Current map zoom
 * @returns {{calculatedLineWidth: number, calculatedSymbolSize: number, calculatedSymbolSpacing: number}}
 */
export function computeCoordinationLineZoomSizes(properties, currentZoom) {
    const authoredWidth = positiveOr(properties?.lineWidth, COORDINATION_LINE_ZOOM_DEFAULTS.lineWidth);
    const authoredSize = positiveOr(properties?.symbol_size, COORDINATION_LINE_ZOOM_DEFAULTS.symbolSizeKm);
    const authoredSpacing = positiveOr(properties?.symbol_spacing, COORDINATION_LINE_ZOOM_DEFAULTS.symbolSpacingKm);

    const pixelFactor = getPixelZoomFactor(properties, currentZoom);
    const groundFactor = getGroundZoomFactor(properties, currentZoom);

    return {
        calculatedLineWidth: clampSize(
            authoredWidth * pixelFactor,
            COORDINATION_LINE_ZOOM_LIMITS.MAX_LINE_WIDTH_PX,
            authoredWidth,
        ),
        calculatedSymbolSize: clampRange(
            authoredSize * groundFactor,
            COORDINATION_LINE_ZOOM_LIMITS.MIN_SYMBOL_SIZE_KM,
            COORDINATION_LINE_ZOOM_LIMITS.MAX_SYMBOL_SIZE_KM,
            authoredSize,
        ),
        calculatedSymbolSpacing: clampRange(
            authoredSpacing * groundFactor,
            COORDINATION_LINE_ZOOM_LIMITS.MIN_SPACING_KM,
            COORDINATION_LINE_ZOOM_LIMITS.MAX_SPACING_KM,
            authoredSpacing,
        ),
    };
}

/**
 * Return a NEW properties object carrying fresh derived sizes.
 * @param {Object} [properties] - Coordination line feature properties
 * @param {number} currentZoom - Current map zoom
 * @returns {Object} New properties object
 */
export function withCoordinationLineZoomSizes(properties, currentZoom) {
    return { ...properties, ...computeCoordinationLineZoomSizes(properties, currentZoom) };
}

/**
 * MapLibre expression for the stroke width.
 *
 * It used to be a plain `coalesce` on `calculatedLineWidth`, which made the
 * drawing depend on a JavaScript pass rewriting the WHOLE collection on every
 * frame of a zoom gesture. Measured on 2026-09-04: 91 `setData` calls in a 3 s
 * gesture with 30 lines, 9,100 features resent with 100. The composite
 * interpolate below computes the same number on the GPU, so the pass is left
 * with what no expression can do (the ground geometry of the screen-pinned
 * lines) and runs once per gesture for the rest.
 *
 * Why the maths is exact between stops, and why the `min` inside each stop
 * value deviates from a hard clamp inside one zoom level only: see the header of
 * `layers/styles/zoom-expression.js`.
 *
 * Written here rather than through that module's `zoomScaledExpression` because
 * this model's rules are stricter than the builder can express. The base falls
 * back to the default unless it is a POSITIVE number (`positiveOr`), and the
 * anchor counts only when it is positive too (`hasZoomReference`: zero is the
 * "never anchored" sentinel, which the builder's `anchorDefault` would happily
 * scale from).
 *
 * @returns {Array} MapLibre expression
 */
export function buildCoordinationLineWidthExpression() {
    // `['get', ...]` yields `value`, which no arithmetic operator accepts, so
    // every number goes through `['number', ..., 0]`: it returns the property
    // when it IS a number and 0 otherwise, and never throws.
    const width = ['number', ['get', 'lineWidth'], 0];
    const anchor = ['number', ['get', 'createdAtZoom'], 0];

    // The `Number.isFinite(n) && n > 0` of `positiveOr` and `hasZoomReference`.
    // `n < 2n` holds for every positive finite number and fails for Infinity;
    // NaN is already out on `n > 0`.
    const isPositiveFinite = (n) => ['all', ['>', n, 0], ['<', n, ['*', 2, n]]];

    const base = ['case',
        isPositiveFinite(width), width,
        COORDINATION_LINE_ZOOM_DEFAULTS.lineWidth,
    ];

    // `clampSize(base * factor, MAX_LINE_WIDTH_PX, base)`: base is positive and
    // finite by construction and so is the factor, so the clamp is just a `min`,
    // and it wraps the unscaled branches too (an authored width above the
    // ceiling is clamped whether or not the correction is on).
    const stopValue = (z) => ['min',
        COORDINATION_LINE_ZOOM_LIMITS.MAX_LINE_WIDTH_PX,
        ['case',
            ['==', ['get', 'zoomCorrectionEnabled'], false], base,
            ['!', isPositiveFinite(anchor)], base,
            ['*', base, ['^', 2, ['-', z, anchor]]],
        ],
    ];

    const expression = ['interpolate', ['exponential', 2], ['zoom']];
    for (const z of ZOOM_STOPS) expression.push(z, stopValue(z));
    return expression;
}

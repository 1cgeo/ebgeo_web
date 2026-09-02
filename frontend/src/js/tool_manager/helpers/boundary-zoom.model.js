// Path: js/tool_manager/helpers/boundary-zoom.model.js

/**
 * @fileoverview Pure zoom model for boundary features (no imports, node-testable).
 *
 * WHY IT DOES NOT LIVE IN `military_tools/boundary_tool/`, next to the tool it
 * serves. The boundary tool is LAZY: `tool_manager/tool-registry.js` reaches it
 * through an `import()`, and `tests/unit/teto-de-peso-da-pagina-do-mapa.test.js`
 * pins `military_tools` at EXACTLY zero eager modules. Two core modules import
 * this file statically, both on a path that runs with no click at all
 * (`layers/styles/tactical.layers.js` when the map draws what was already there,
 * and `import_export/export-utils.js` when a PDF is produced), so putting the
 * math under `military_tools/` would drag the whole folder back into the boot
 * payload and turn that budget red. `tool_manager/helpers/` is core by
 * `vite.config.js`, and this file is its neighbour `zoom-correction.helpers.js`
 * without the shared `size`/`calculatedSize` shape.
 *
 * WHAT IT MODELS. A boundary anchors its pixel-sized parts (line width, label
 * text size, circle stroke) to the zoom level it was drawn at, so that they keep
 * a constant size RELATIVE TO THE TERRAIN instead of a constant size on screen.
 * The anchor is a single pair of properties, named exactly like the military
 * symbol's:
 *
 *  - `createdAtZoom`          the reference zoom (1 decimal place)
 *  - `zoomCorrectionEnabled`  `false` opts the feature out (fixed on screen)
 *
 * Legacy features carry neither, so `hasZoomReference` is false and every ZOOM
 * FACTOR is 1: the pixel sizes (line, label, circle stroke) come out exactly as
 * they did before this model existed, at any zoom. That is why
 * `calculateZoomCorrectedValue` (the sibling `zoom-correction.helpers.js`) is
 * deliberately NOT reused here: it propagates `NaN` when `createdAtZoom` is
 * missing, while "no reference" must mean "today's behaviour".
 *
 * THE ECHELON IS THE ONE PART THAT CAN STILL MOVE, and saying "byte-for-byte"
 * here hid it. `maxSymbolSizeForLine` caps the symbol by the LENGTH OF THE LINE,
 * and that cap binds the AUTHORED size too, with no zoom reference involved; the
 * boot rebuilds the geometry of every boundary, so a legacy feature authored with
 * `symbol_size: 5` km on a 2 km line stops drawing at 5 and starts drawing at the
 * cap. That is the intended trade (a symbol that eats its own line left a
 * boundary with no visible segment at all), not a regression to chase.
 *
 * The switch governs the WHOLE feature, on two reciprocal axes:
 *
 *  - pixel parts (line, label, circle stroke) scale by `2 ** (z - z0)` while the
 *    correction is ON, so they keep a constant size on the ground;
 *  - the echelon symbol, which is geometry in KILOMETRES and therefore already
 *    anchored to the ground, scales by `2 ** (z0 - z)` while the correction is
 *    OFF, so it keeps a constant size on the screen.
 *
 * Exactly one of the two factors is ever different from 1, which is what makes
 * "correction ON" mean everything is glued to the terrain and "correction OFF"
 * mean everything is glued to the screen. Legacy features get 1 on both.
 */

/**
 * Bounds for the derived values. The pixel maxima exist because MapLibre
 * rejects absurd sizes; the kilometre pair bounds the ECHELON symbol, whose
 * derived size feeds `turf.destination` and would otherwise wander to the other
 * side of the planet a few zoom levels out from its anchor.
 */
export const BOUNDARY_ZOOM_LIMITS = {
    MAX_LINE_WIDTH_PX: 60,
    MAX_TEXT_SIZE_PX: 255,
    MAX_CIRCLE_STROKE_PX: 60,
    MIN_SYMBOL_SIZE_KM: 0.001,
    MAX_SYMBOL_SIZE_KM: 50,
    // Share of the line the echelon gaps may consume, all instances together.
    MAX_GAP_FRACTION: 0.5,
    // Gap length one echelon symbol costs, as a multiple of the symbol size:
    // `SYMBOL_WIDTH_MULTIPLIER * GAP_WIDTH_MULTIPLIER` of the geometry's own
    // GEOMETRY_CONSTANTS (1.5 * 1.2). It is DUPLICATED here because this module
    // has zero imports by contract; the two copies are held together by
    // `tests/unit/boundary-zoom-model.test.js`, which imports both and compares
    // them, so a change on either side fails loudly instead of drifting.
    SYMBOL_GAP_FACTOR: 1.8,
};

/** Fallbacks used when the authored value is missing or not a positive number. */
export const BOUNDARY_ZOOM_DEFAULTS = {
    lineWidth: 4,
    textSize: 35,
    circleStrokeWidth: 2,
    symbolSizeKm: 1,
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
 * Scale factor applied to pixel-sized parts.
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
 * Scale factor applied to the ground-sized part (the echelon symbol, in km).
 * It is the RECIPROCAL of the pixel factor and only leaves 1 when the correction
 * is switched OFF: that is what pins the echelon to the screen, so that turning
 * the correction off freezes the whole feature visually instead of half of it.
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
 * the correction is switched off. This is the only state in which
 * `calculatedSymbolSize` can differ from the authored `symbol_size`, so it is
 * also the gate the geometry uses before trusting the derived kilometre value.
 *
 * @param {Object} [properties] - Feature properties
 * @returns {boolean} True when the echelon must be rescaled per zoom level
 */
export function isScreenAnchored(properties) {
    return hasZoomReference(properties) && properties.zoomCorrectionEnabled === false;
}

/**
 * Largest echelon size, in kilometres, that a line of `totalLengthKm` can carry.
 *
 * The echelon is drawn INSIDE a gap cut out of the line, and the gap grows
 * linearly with the symbol size, so a big enough symbol eats the line it is
 * supposed to annotate (measured: a 1 km echelon zoomed out to the 50 km clamp
 * left a boundary with no visible segment at all). The rule is that all the gaps
 * together may not take more than `MAX_GAP_FRACTION` of the line:
 *
 *   instanceCount * echelonLength * SYMBOL_GAP_FACTOR * size <= fraction * length
 *
 * It bounds the AUTHORED size as much as the zoom-derived one: a symbol too big
 * for its line is too big at the zoom it was authored at too.
 *
 * @param {number} totalLengthKm - Length of the boundary line, in kilometres
 * @param {number} instanceCount - How many echelon instances the line carries
 * @param {number} echelonLength - Symbols per instance (`echelon.length`)
 * @returns {number} Maximum size in km, or `Infinity` when any input is unusable
 *   (no line, no instances: nothing to cap)
 */
export function maxSymbolSizeForLine(totalLengthKm, instanceCount, echelonLength) {
    if (!Number.isFinite(totalLengthKm) || totalLengthKm <= 0) return Infinity;
    if (!Number.isFinite(instanceCount) || instanceCount <= 0) return Infinity;
    if (!Number.isFinite(echelonLength) || echelonLength <= 0) return Infinity;

    const { MAX_GAP_FRACTION, SYMBOL_GAP_FACTOR } = BOUNDARY_ZOOM_LIMITS;
    return (totalLengthKm * MAX_GAP_FRACTION) / (instanceCount * echelonLength * SYMBOL_GAP_FACTOR);
}

/**
 * Compute every zoom-derived size of a boundary.
 *
 * @param {Object} [properties] - Boundary feature properties
 * @param {number} currentZoom - Current map zoom
 * @returns {{calculatedLineWidth: number, calculatedTextSize: number, calculatedStrokeWidth: number, calculatedSymbolSize: number}}
 *   Derived sizes, the first three in pixels and the last in kilometres; never NaN.
 */
export function computeBoundaryZoomSizes(properties, currentZoom) {
    const props = properties || {};

    const baseLineWidth = positiveOr(props.lineWidth, BOUNDARY_ZOOM_DEFAULTS.lineWidth);
    const baseTextSize = positiveOr(props.text_size, BOUNDARY_ZOOM_DEFAULTS.textSize);
    // Circle features carry their own `strokeWidth` base (the parent boundary
    // does not), so a circle can be recomputed without reaching for its parent.
    const baseStroke = positiveOr(props.strokeWidth, BOUNDARY_ZOOM_DEFAULTS.circleStrokeWidth);
    const baseSymbolSize = positiveOr(props.symbol_size, BOUNDARY_ZOOM_DEFAULTS.symbolSizeKm);

    const factor = getPixelZoomFactor(props, currentZoom);
    const groundFactor = getGroundZoomFactor(props, currentZoom);

    return {
        calculatedLineWidth: clampSize(
            baseLineWidth * factor,
            BOUNDARY_ZOOM_LIMITS.MAX_LINE_WIDTH_PX,
            baseLineWidth,
        ),
        calculatedTextSize: clampSize(
            baseTextSize * factor,
            BOUNDARY_ZOOM_LIMITS.MAX_TEXT_SIZE_PX,
            baseTextSize,
        ),
        calculatedStrokeWidth: clampSize(
            baseStroke * factor,
            BOUNDARY_ZOOM_LIMITS.MAX_CIRCLE_STROKE_PX,
            baseStroke,
        ),
        // The identity case returns the AUTHORED size untouched instead of a
        // clamped copy: the bounds guard the derived growth, and an authored
        // symbol larger than MAX_SYMBOL_SIZE_KM (the size handle can drag one
        // there) must keep drawing at the size the user gave it.
        calculatedSymbolSize: groundFactor === 1
            ? baseSymbolSize
            : clampRange(
                baseSymbolSize * groundFactor,
                BOUNDARY_ZOOM_LIMITS.MIN_SYMBOL_SIZE_KM,
                BOUNDARY_ZOOM_LIMITS.MAX_SYMBOL_SIZE_KM,
                baseSymbolSize,
            ),
    };
}

/**
 * Non-mutating copy of the properties with the derived sizes applied.
 * @param {Object} [properties] - Boundary feature properties
 * @param {number} currentZoom - Current map zoom
 * @returns {Object} New properties object
 */
export function withBoundaryZoomSizes(properties, currentZoom) {
    return { ...(properties || {}), ...computeBoundaryZoomSizes(properties, currentZoom) };
}

/**
 * Text rotation in degrees for a boundary label.
 *
 * With `text-rotation-alignment: 'map'` the layer interprets this as a bearing
 * on the ground, so 0 is map north whatever the camera does, and `bearing ± 90`
 * stays glued to the line even with the map rotated.
 *
 * @param {Object} config
 * @param {boolean} [config.northFacing] - `true` pins the glyphs to map north
 * @param {number} [config.lineBearing] - Local bearing of the line, in degrees
 * @returns {number} Rotation in degrees
 */
export function computeTextRotation({ northFacing, lineBearing } = {}) {
    if (northFacing === true) return 0;

    const bearing = Number.isFinite(lineBearing) ? lineBearing : 0;
    // Keep-upright: flip the perpendicular on the half where the label would
    // otherwise read upside down.
    return (bearing <= 0 || bearing >= 180) ? bearing + 90 : bearing - 90;
}

/**
 * The eight MapLibre `text-anchor` values, indexed by the compass octant of the
 * direction FROM the line TOWARDS the label. The anchor names the edge of the
 * glyph box that touches the placement point, so it is the OPPOSITE of that
 * direction: a label north of the line hangs from its bottom edge.
 */
const ANCHOR_BY_OCTANT = [
    'bottom',        // label is north of the line
    'bottom-left',   // north-east
    'left',          // east
    'top-left',      // south-east
    'top',           // south
    'top-right',     // south-west
    'right',         // west
    'bottom-right',  // north-west
];

/**
 * Text anchor for a boundary label.
 *
 * With the glyphs glued to the line (`northFacing` off) the label is centred on
 * its placement point, which sits a fixed distance off the line on the label's
 * side: the box extends ALONG the line, so the two labels never meet. Pinned to
 * north, the box extends east-west whatever the line does, and on a diagonal
 * line the two centred boxes cross each other over the line (measured on
 * 2026-09-01: "LESTE" and "OESTE" unreadable on a NW-SE boundary). Anchoring
 * the box by the edge that faces the line puts each label entirely in its own
 * half-plane, so the two cannot overlap and neither crosses the line.
 *
 * @param {Object} config
 * @param {boolean} [config.northFacing] - `true` when the glyphs are pinned to map north
 * @param {number} [config.placementBearing] - Compass bearing from the line towards
 *   the label, in degrees (0 = north, clockwise; any range, wrapped here)
 * @returns {string} A MapLibre `text-anchor` value; `'center'` unless north-facing
 */
export function computeTextAnchor({ northFacing, placementBearing } = {}) {
    if (northFacing !== true) return 'center';
    if (!Number.isFinite(placementBearing)) return 'center';

    const bearing = ((placementBearing % 360) + 360) % 360;
    const octant = Math.round(bearing / 45) % 8;
    return ANCHOR_BY_OCTANT[octant];
}

/**
 * Line-width expression for `boundary-main-layer`.
 * @returns {Array} MapLibre expression
 */
export function buildBoundaryLineWidthExpression() {
    return ['coalesce', ['get', 'calculatedLineWidth'], ['get', 'lineWidth'], BOUNDARY_ZOOM_DEFAULTS.lineWidth];
}

/**
 * Text-size expression for `boundary-text-layer`.
 * @returns {Array} MapLibre expression
 */
export function buildBoundaryTextSizeExpression() {
    return ['coalesce', ['get', 'calculatedTextSize'], ['get', 'text_size'], 14];
}

/**
 * Stroke-width expression for `boundary-circles-stroke-layer`.
 * @returns {Array} MapLibre expression
 */
export function buildBoundaryCircleStrokeExpression() {
    return ['coalesce', ['get', 'calculatedStrokeWidth'], BOUNDARY_ZOOM_DEFAULTS.circleStrokeWidth];
}

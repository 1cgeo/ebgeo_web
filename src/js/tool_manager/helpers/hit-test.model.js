// Path: js/tool_manager/helpers/hit-test.model.js

/**
 * @fileoverview Pure model behind "what did the user click on". No DOM, no map,
 * no store, so it is node-testable and safe to import from anywhere.
 *
 * WHY THIS EXISTS — two opposite complaints about the same `queryRenderedFeatures`.
 *
 * 1. THIN THINGS ARE TOO HARD TO HIT. MapLibre hit-tests geometry with ZERO
 *    tolerance: a `line` layer answers only within `line-width / 2` of the
 *    centreline and a `fill` layer only strictly inside the polygon. A 2 px
 *    boundary is a 2 px target. The fix is to query a small BOX around the
 *    click instead of the bare point (`toleranceBox`).
 *
 * 2. IMAGES ARE FAR TOO EASY TO HIT. Symbol layers are not hit-tested against
 *    the drawn pixels at all — they are hit-tested against the placement
 *    COLLISION BOX, and that box is wrong for this app in two compounding ways:
 *
 *    - It is sized at the WRONG ZOOM. `symbol/symbol_layout.ts:98` evaluates
 *      `icon-size` with `new EvaluationParameters(args.bucket.zoom + 1)`, i.e.
 *      one integer zoom ABOVE the tile, and `symbol/collision_index.ts:129`
 *      then scales that box only by `textPixelRatio * projectedPoint
 *      .perspectiveRatio` — never by the current FRACTIONAL zoom. With this
 *      app's zoom correction (`base * 2^(zoom - createdAtZoom)`, see
 *      `layers/styles/zoom-expression.js`) the icon doubles every zoom level,
 *      so the box is 2x the drawn size (4x the area) right after each integer
 *      zoom and shrinks back to 1x just before the next.
 *    - It is an axis-aligned box around the ROTATED icon. `symbol/quads.ts:137`
 *      rotates the four corners by `icon-rotate` and the collision box is the
 *      AABB of the result (plus the 2 px default `icon-padding`), so a rotated
 *      rectangle is clickable across its whole bounding box.
 *
 *    Both grids are queried (`grid` and `ignoredGrid`), so the layers'
 *    `icon-ignore-placement: true` does not take them out of the answer either.
 *
 *    The fix is to rebuild, in JavaScript, the rectangle MapLibre actually DREW
 *    and test the click against it: `evaluateZoomScaledSize` replays the style
 *    expression at the real fractional zoom, `iconScreenQuad` replays the
 *    layout (`symbol/shaping.ts:732` `shapeIcon` + `:277` `getAnchorAlignment`,
 *    `symbol/quads.ts:137-148` rotation) and `pointInConvexQuad` answers.
 *
 * DESIGN RULES ENCODED HERE
 *
 * - Tolerance is for THIN things. Lines, brushes, boundaries and point circles
 *   get the pixel slack; images get NONE (the rectangle is the whole truth,
 *   transparent pixels inside it included — a rectangle test, not an alpha
 *   test); AREAS get none either, because they are already big targets and a
 *   tolerant border would let a click well inside polygon A pick up polygon B
 *   sitting 5 px away (`resolveAreaHits`).
 * - When several classes survive, the SMALLEST wins: point > line > area
 *   (`pickPreferredHits`). Clicking 4 px off a line that crosses a polygon must
 *   select the line, not open a disambiguation menu. Same-class overlaps are
 *   left alone — that is what the selection manager's menu is for.
 * - EDIT HANDLES stay exact too (`needsExactHit`). Every handle feature carries
 *   `user_isEditingHandle: true`, and the tools grab them with a zero-tolerance
 *   query of their own; if the shared hit-test reported a handle 6 px away the
 *   move cursor would promise a grab that the mousedown never honours, and the
 *   drag gate would refuse a feature drag for nothing.
 * - Only a DECISIVE row may demote the other classes (`pickPreferredHits`). A
 *   row from a symbol layer that was NOT rebuilt here (`text-layer`,
 *   `point-marker-layer`, the `*-label-layer`s) still comes from the inflated
 *   collision box, so it is kept — the user can still pick it — but it never
 *   makes a polygon under it unreachable; those overlaps fall back to the menu.
 * - Anything that is not ours (base map, viewer markers — no string
 *   `properties.source`) is classified `null` and passes through every filter
 *   untouched. This model never decides what a foreign row means.
 *
 * ONE KNOWN TRANSIENT. `evaluateZoomScaledSize` is exact while the drawn tile
 * is the one for the current integer zoom. During a zoom gesture MapLibre keeps
 * a parent tile on screen until the child loads, and that tile's icon size is
 * clamped between ITS stops, so the drawn icon is briefly smaller than the
 * rectangle computed here. The row is then merely kept for a frame or two.
 *
 * @see src/js/layers/styles/zoom-expression.js - the expression replayed here
 * @see src/js/tool_manager/helpers/feature-hit-test.helpers.js - the map-facing side
 */

import { ZOOM_STOPS } from '@layers/styles/zoom-expression.js';

/** Click slack for a fine pointer (mouse), in CSS pixels. @constant {number} */
export const CLICK_TOLERANCE_PX = 6;

/** Click slack for a coarse pointer (touch), in CSS pixels. @constant {number} */
export const TOUCH_CLICK_TOLERANCE_PX = 12;

/**
 * MapLibre layer ids whose features must be hit-tested against the exact
 * rendered icon rectangle instead of the symbol collision box.
 * @constant {string[]}
 */
export const EXACT_ICON_LAYER_IDS = Object.freeze([
    'image-layer',
    'military-symbols-layer',
    'coordination-measures-layer',
    'magnetic-declinations-layer',
]);

/**
 * Per-layer `icon-size` rules, mirroring the `zoomScaledExpression` specs in
 * `layers/styles/content.layers.js` (IMAGE_SIZE) and `layers/styles/symbol.layers.js`
 * (SYMBOL_SIZE, DECLINATION_SIZE): base = `properties.size` or `baseDefault`,
 * anchor = `properties.createdAtZoom`, disabled when
 * `properties.zoomCorrectionEnabled === false`, result clamped at `maxValue`.
 *
 * `rotates` says whether the layer reads `icon-rotate` from `properties.rotation`,
 * `anchored` whether it reads `icon-anchor` from `properties.anchor` and
 * `offset` whether it reads `icon-offset` from `properties.iconOffset`
 * (`layers/styles/icon-offset.expression.js`, applied on the coordination
 * measures only); a property the layer does not read must not shape the
 * rectangle either.
 *
 * `point-marker-layer` is image-backed too, but its spec differs in every field
 * (`sizeCreatedAtZoom` with a default of 0, `sizeZoomCorrectionEnabled`, a
 * `divideBy`), so it is deliberately NOT listed: a rule shaped like these would
 * compute a wrong rectangle for it. Its rows stay non-decisive instead.
 * @constant {Object<string, {baseDefault: number, maxValue: number, rotates: boolean, anchored: boolean, offset: boolean}>}
 */
export const ICON_SIZE_RULES = Object.freeze({
    'image-layer': Object.freeze({ baseDefault: 1, maxValue: 10, rotates: true, anchored: false, offset: false }),
    'military-symbols-layer': Object.freeze({ baseDefault: 1, maxValue: 10, rotates: true, anchored: false, offset: false }),
    'coordination-measures-layer': Object.freeze({ baseDefault: 1, maxValue: 10, rotates: true, anchored: true, offset: true }),
    'magnetic-declinations-layer': Object.freeze({ baseDefault: 0.6, maxValue: 10, rotates: false, anchored: false, offset: false }),
});

/** The three hit classes, ranked point > line > area. @constant {Object<string, string>} */
export const HIT_CLASS = Object.freeze({ POINT: 'point', LINE: 'line', AREA: 'area' });

/** Feature types hit-tested with NO tolerance because they are large targets. @constant {string[]} */
export const AREA_FEATURE_TYPES = Object.freeze([
    'polygon', 'circle', 'ellipse', 'rectangle', 'sector', 'arrow', 'visibility',
]);

/** Feature types that behave as a single point on screen. @constant {string[]} */
export const POINT_FEATURE_TYPES = Object.freeze([
    'point', 'text', 'image', 'military_symbol', 'coordination_measure', 'magnetic_declination',
]);

/** Class ranking, best first. @constant {string[]} */
const CLASS_PRIORITY = Object.freeze([HIT_CLASS.POINT, HIT_CLASS.LINE, HIT_CLASS.AREA]);

/** First and last integer zoom stop of the style expressions. */
const FIRST_STOP = ZOOM_STOPS[0];
const LAST_STOP = ZOOM_STOPS[ZOOM_STOPS.length - 1];

/**
 * Reads a value only when it is a real, finite number. `Number(null)` is `0` and
 * `x ?? 0` lets `NaN` through, so neither would do here: this is the JavaScript
 * equivalent of the expression's own `['!=', ['typeof', ['get', p]], 'number']`
 * guard.
 * @param {*} value - Candidate
 * @returns {number} The number, or `NaN`
 */
function finiteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : NaN;
}

/**
 * Normalises a screen point given either as `{ x, y }` or as `[x, y]`.
 * @param {Object|Array<number>} point - Screen point
 * @returns {{x: number, y: number}} Coordinates, `NaN` when unreadable
 */
function toXY(point) {
    if (Array.isArray(point)) return { x: Number(point[0]), y: Number(point[1]) };
    return { x: Number(point?.x), y: Number(point?.y) };
}

/**
 * Horizontal/vertical alignment factors of a symbol anchor, exactly as
 * `getAnchorAlignment` in `maplibre-gl/src/symbol/shaping.ts:277`: anything not
 * named falls back to the centre.
 * @param {string} iconAnchor - MapLibre `icon-anchor` value
 * @returns {{horizontal: number, vertical: number}} Factors in [0, 1]
 */
function anchorAlignment(iconAnchor) {
    let horizontal = 0.5;
    let vertical = 0.5;

    if (iconAnchor === 'right' || iconAnchor === 'top-right' || iconAnchor === 'bottom-right') {
        horizontal = 1;
    } else if (iconAnchor === 'left' || iconAnchor === 'top-left' || iconAnchor === 'bottom-left') {
        horizontal = 0;
    }

    if (iconAnchor === 'bottom' || iconAnchor === 'bottom-left' || iconAnchor === 'bottom-right') {
        vertical = 1;
    } else if (iconAnchor === 'top' || iconAnchor === 'top-left' || iconAnchor === 'top-right') {
        vertical = 0;
    }

    return { horizontal, vertical };
}

/** Coordinate slack when two rendered rows are compared by position, in degrees. */
const SAME_POSITION_EPSILON = 1e-9;

/**
 * Identity of a rendered row across two queries: the MapLibre source plus the
 * feature id. Two rows of the same feature always come back with both.
 *
 * Edit handles have NO such key. Their ids live at the feature level, which
 * MapLibre drops for strings, and their properties name the PARENT feature
 * (`featureId`, plus a tool-specific `handleId` or `index`), so every handle of
 * one source would hash alike. They are matched by position instead
 * (`samePosition`), which is what "the same handle" means on screen anyway.
 *
 * @param {Object} row - Rendered feature
 * @returns {string|null} Stable key, or `null` for a row that must be matched
 *   by position
 */
function rowKey(row) {
    const properties = row?.properties;
    if (properties?.user_isEditingHandle === true) return null;
    const id = properties?.id;
    if (id === undefined || id === null) return null;
    return `${row?.source}:${id}`;
}

/**
 * Whether two key-less rows are the same rendered point: same source, both
 * Point geometries, coordinates within `SAME_POSITION_EPSILON`. The two rows
 * come from the same tile grid, so equal handles differ at most by float noise.
 * @param {Object} a - Rendered row
 * @param {Object} b - Rendered row
 * @returns {boolean} `true` for the same point
 */
function samePosition(a, b) {
    if (a?.source !== b?.source) return false;
    const ga = a?.geometry;
    const gb = b?.geometry;
    if (ga?.type !== 'Point' || gb?.type !== 'Point') return false;
    const ca = ga.coordinates;
    const cb = gb.coordinates;
    if (!Array.isArray(ca) || !Array.isArray(cb)) return false;
    return Math.abs(Number(ca[0]) - Number(cb[0])) <= SAME_POSITION_EPSILON
        && Math.abs(Number(ca[1]) - Number(cb[1])) <= SAME_POSITION_EPSILON;
}

/**
 * Class of a feature type, by `properties.source` (the singular feature type
 * this app writes on every feature it owns).
 * @param {*} featureType - Candidate feature type
 * @returns {string|null} `'point'`, `'line'`, `'area'`, or `null` when the row
 *   is not one of ours and must not be ranked or filtered
 */
export function hitClassOf(featureType) {
    if (typeof featureType !== 'string' || featureType.length === 0) return null;
    if (AREA_FEATURE_TYPES.includes(featureType)) return HIT_CLASS.AREA;
    if (POINT_FEATURE_TYPES.includes(featureType)) return HIT_CLASS.POINT;
    return HIT_CLASS.LINE;
}

/**
 * Square query geometry around a screen point.
 *
 * A tolerance that is not finite and positive gives a ZERO-AREA box, which is
 * not the same thing as a point query to MapLibre (a two-corner box is expanded
 * into a ring and takes the polygon path). Callers that want a point query must
 * pass the point itself instead of this box.
 *
 * @param {Object|Array<number>} point - Screen point, `{ x, y }` or `[x, y]`
 * @param {number} tolerance - Half-size in pixels
 * @returns {Array<Array<number>>} `[[x - t, y - t], [x + t, y + t]]`
 */
export function toleranceBox(point, tolerance) {
    const { x, y } = toXY(point);
    const t = Number.isFinite(tolerance) && tolerance > 0 ? tolerance : 0;
    return [[x - t, y - t], [x + t, y + t]];
}

/**
 * Replica of the `icon-size` number MapLibre computes for this app's
 * `zoomScaledExpression` at a fractional zoom.
 *
 * The expression is `['interpolate', ['exponential', 2], ['zoom'], 0, v0, ... 24, v24]`
 * with `vk = min(maxValue, base * 2^(k - anchorZoom))`. MapLibre's interpolation
 * factor for base 2 between consecutive integer stops is
 * `(2^(zoom - z0) - 1) / (2^1 - 1) = 2^(zoom - z0) - 1`
 * (`maplibre-gl-style-spec/src/expression/definitions/interpolate.ts:329`), and
 * the blend is `from + t * (to - from)` (`util/interpolate-primitives.ts:1`).
 * Outside the stop range the expression returns the end stop verbatim
 * (`interpolate.ts:223-230`), which is why the two clamps below are exact and
 * not an approximation.
 *
 * @param {Object} spec - Size rule
 * @param {number} spec.base - Base size (`properties.size`, already defaulted)
 * @param {number} spec.anchorZoom - Zoom the feature was anchored at
 * @param {boolean} [spec.enabled] - `false` disables the scaling, as the
 *   `zoomCorrectionEnabled` branch of the expression does
 * @param {number} [spec.maxValue] - Upper clamp baked into every stop value
 * @param {number} zoom - Current map zoom
 * @returns {number} The evaluated size; `NaN` when `base` or `zoom` is not a
 *   finite number, so the caller can fall back instead of trusting a bad quad
 */
export function evaluateZoomScaledSize({ base, anchorZoom, enabled, maxValue }, zoom) {
    if (!Number.isFinite(base)) return NaN;
    if (enabled === false) return base;
    if (!Number.isFinite(anchorZoom)) return base;
    if (!Number.isFinite(zoom)) return NaN;

    const stopValue = (stop) => {
        const scaled = base * Math.pow(2, stop - anchorZoom);
        return Number.isFinite(maxValue) ? Math.min(maxValue, scaled) : scaled;
    };

    if (zoom <= FIRST_STOP) return stopValue(FIRST_STOP);
    if (zoom >= LAST_STOP) return stopValue(LAST_STOP);

    const lower = Math.floor(zoom);
    const from = stopValue(lower);
    const to = stopValue(lower + 1);
    const t = Math.pow(2, zoom - lower) - 1;
    return from + t * (to - from);
}

/**
 * Size of one rendered symbol row, using the rule of its layer.
 *
 * The base falls back to the layer default when `properties.size` is not a
 * usable positive number. That is slightly stricter than the expression's
 * `['coalesce', ['get', 'size'], default]`, which would keep a literal `0`; a
 * zero-size icon has no rectangle to hit-test anyway.
 *
 * @param {string} layerId - MapLibre layer id
 * @param {Object} properties - Rendered feature properties
 * @param {number} zoom - Current map zoom
 * @returns {number|null} Icon size, or `null` when the layer has no size rule
 */
export function iconSizeForFeature(layerId, properties, zoom) {
    const rule = ICON_SIZE_RULES[layerId];
    if (!rule) return null;

    const size = finiteNumber(properties?.size);
    const base = size > 0 ? size : rule.baseDefault;

    return evaluateZoomScaledSize({
        base,
        anchorZoom: finiteNumber(properties?.createdAtZoom),
        enabled: properties?.zoomCorrectionEnabled,
        maxValue: rule.maxValue,
    }, zoom);
}

/**
 * Reads an `icon-offset` property as a `[dx, dy]` pair of icon pixels.
 *
 * WHY THE STRING FORM. An array property does not fit a vector tile's value
 * types, so the GeoJSON worker serialises it as JSON TEXT behind a marker
 * (`util.ts:20` `JSON_PREFIX = '__$json__:'`, written at
 * `source/geojson_worker_source.ts:95`) and the query side only turns it back
 * into an array when that marker survived the round trip
 * (`util/vectortile_to_geojson.ts:48-56`). Every row that reaches the hit-test
 * through a path that skipped that decode — a property re-read from serialised
 * text, another MapLibre version's tile — would otherwise silently lose the
 * offset and put the rectangle back on the bitmap centre. Parsing the text
 * costs one `try` and keeps the box on the drawing.
 *
 * Entries must be real finite NUMBERS, the same strictness the style spec has
 * (`icon-offset` is `"value": "number"`): a pair like `[null, 3]` would be
 * rejected by MapLibre and drawn with no offset at all, so it is `[0, 0]` here
 * too rather than a half-honoured shift.
 *
 * @param {*} value - `properties.iconOffset`: a `[dx, dy]` pair, the same pair
 *   as JSON text, or anything at all
 * @returns {Array<number>} `[dx, dy]` in icon pixels, `[0, 0]` when the value
 *   cannot be read as a pair of finite numbers
 */
export function parseIconOffset(value) {
    let pair = value;

    if (typeof pair === 'string') {
        try {
            pair = JSON.parse(pair);
        } catch {
            return [0, 0];
        }
    }

    if (!Array.isArray(pair) || pair.length !== 2) return [0, 0];

    const dx = finiteNumber(pair[0]);
    const dy = finiteNumber(pair[1]);
    if (Number.isNaN(dx) || Number.isNaN(dy)) return [0, 0];

    return [dx, dy];
}

/**
 * Screen-space quad of a viewport-aligned point symbol (`icon-rotation-alignment`
 * and `icon-pitch-alignment` both `viewport`, `symbol-placement: point`) — the
 * rectangle MapLibre actually draws.
 *
 * Layout follows `shapeIcon` (`maplibre-gl/src/symbol/shaping.ts:740-743`):
 * `x1 = dx - displayWidth * hAlign`, `x2 = x1 + displayWidth`, and the same
 * vertically with `dy`. The `icon-offset` is therefore part of the LOCAL
 * rectangle, before alignment is subtracted and before `getIconQuads`
 * (`symbol/quads.ts:68-71`, `:137-148`) rotates the corners — so the offset
 * turns WITH the icon, which is what the style spec means by "when combined
 * with `icon-rotate` the offset will be as if the rotated direction was up".
 * Rotation follows `getIconQuads` (`symbol/quads.ts:137-148`),
 * which builds `[cos, -sin, sin, cos]` and feeds it to `Point._matMult`
 * (`@mapbox/point-geometry/index.js:205`), i.e. `x' = cos*x - sin*y` and
 * `y' = sin*x + cos*y`. Screen y grows downwards, so a positive rotation turns
 * CLOCKWISE on screen. The rotation is applied to the corner offsets, which are
 * relative to the ANCHOR, so the rectangle pivots about the anchor point and
 * not about its own centre. The shader then multiplies those offsets by
 * `size * perspective_ratio` (`shaders/glsl/symbol_icon.vertex.glsl:84-87`);
 * scaling and rotation commute, so both are applied here in one pass.
 *
 * @param {Object} spec - Quad specification
 * @param {Object|Array<number>} spec.anchor - Anchor in screen pixels
 * @param {number} spec.displayWidth - CSS-pixel width (`image.data.width / image.pixelRatio`)
 * @param {number} spec.displayHeight - CSS-pixel height
 * @param {number} spec.iconSize - Evaluated `icon-size`
 * @param {number} [spec.rotationDeg=0] - `icon-rotate`, degrees
 * @param {string} [spec.iconAnchor='center'] - `icon-anchor`
 * @param {Array<number>|string} [spec.iconOffset=[0, 0]] - `icon-offset`,
 *   `[dx, dy]` in ICON pixels (`icon-size` 1, positive right/down); read
 *   through `parseIconOffset`, so an unusable value simply means no offset
 * @param {number} [spec.perspectiveRatio=1] - Perspective scaling of the symbol
 * @param {number} [spec.paddingPx=0] - Extra SCREEN pixels on every side, for a
 *   frame drawn around the icon; it rotates with the icon and is ignored when
 *   the icon has no size on screen
 * @returns {Array<{x: number, y: number}>|null} Corners in the order top-left,
 *   top-right, bottom-right, bottom-left OF THE UNROTATED rectangle; `null`
 *   when any input is not finite
 */
export function iconScreenQuad({
    anchor,
    displayWidth,
    displayHeight,
    iconSize,
    rotationDeg = 0,
    iconAnchor = 'center',
    iconOffset = [0, 0],
    perspectiveRatio: perspective = 1,
    paddingPx = 0,
}) {
    const { x: anchorX, y: anchorY } = toXY(anchor);
    const width = Number(displayWidth);
    const height = Number(displayHeight);
    const size = Number(iconSize);
    const rotation = Number(rotationDeg);
    const ratio = Number(perspective);

    const inputs = [anchorX, anchorY, width, height, size, rotation, ratio];
    if (inputs.some((value) => !Number.isFinite(value))) return null;

    const { horizontal, vertical } = anchorAlignment(iconAnchor);
    const [offsetX, offsetY] = parseIconOffset(iconOffset);
    const scale = size * ratio;
    // The padding is asked for in screen pixels; the corners below are in icon
    // pixels and get multiplied by `scale`, so it is divided out here once.
    const pad = scale > 0 && Number.isFinite(paddingPx) && paddingPx > 0 ? paddingPx / scale : 0;
    const x1 = offsetX - width * horizontal - pad;
    const x2 = x1 + width + 2 * pad;
    const y1 = offsetY - height * vertical - pad;
    const y2 = y1 + height + 2 * pad;

    const angle = rotation * Math.PI / 180;
    const sin = Math.sin(angle);
    const cos = Math.cos(angle);

    const corner = (localX, localY) => {
        const offsetX = localX * scale;
        const offsetY = localY * scale;
        return {
            x: anchorX + cos * offsetX - sin * offsetY,
            y: anchorY + sin * offsetX + cos * offsetY,
        };
    };

    return [corner(x1, y1), corner(x2, y1), corner(x2, y2), corner(x1, y2)];
}

/**
 * Point-in-convex-polygon test, boundary included.
 *
 * The bounding-box pre-check is not only a shortcut: it is what keeps a
 * DEGENERATE quad (zero width or height) honest. Every cross product of a
 * collapsed quad is zero, so the sign test alone would answer "inside" for the
 * whole line the quad lies on.
 *
 * @param {Object|Array<number>} point - Screen point, `{ x, y }` or `[x, y]`
 * @param {Array<Object|Array<number>>} quad - Convex ring, any winding
 * @returns {boolean} `true` when the point is inside or on the boundary
 */
export function pointInConvexQuad(point, quad) {
    if (!Array.isArray(quad) || quad.length < 3) return false;

    const { x, y } = toXY(point);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;

    const corners = [];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const vertex of quad) {
        const corner = toXY(vertex);
        if (!Number.isFinite(corner.x) || !Number.isFinite(corner.y)) return false;
        corners.push(corner);
        if (corner.x < minX) minX = corner.x;
        if (corner.x > maxX) maxX = corner.x;
        if (corner.y < minY) minY = corner.y;
        if (corner.y > maxY) maxY = corner.y;
    }

    if (x < minX || x > maxX || y < minY || y > maxY) return false;

    let hasPositive = false;
    let hasNegative = false;

    for (let i = 0; i < corners.length; i++) {
        const a = corners[i];
        const b = corners[(i + 1) % corners.length];
        const cross = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
        if (cross > 0) hasPositive = true;
        else if (cross < 0) hasNegative = true;
        if (hasPositive && hasNegative) return false;
    }

    return true;
}

/**
 * Perspective scaling MapLibre applies to a viewport-aligned symbol, from
 * `shaders/glsl/symbol_icon.vertex.glsl:75-82` (and the JavaScript twin in
 * `symbol/collision_index.ts:467`): `clamp(0.5 + 0.5 * cameraToCenterDistance / w, 0, 4)`.
 * @param {number} cameraToCenterDistance - Transform's camera distance, pixels
 * @param {number} w - Clip-space w of the anchor, i.e. its signed distance from
 *   the camera
 * @returns {number} The ratio, or `1` when the inputs cannot be used
 */
export function perspectiveRatio(cameraToCenterDistance, w) {
    if (!Number.isFinite(cameraToCenterDistance) || !Number.isFinite(w) || w <= 0) return 1;
    return Math.min(4, Math.max(0, 0.5 + 0.5 * (cameraToCenterDistance / w)));
}

/**
 * The `w` component of a column-major mat4 applied to `[x, y, z, 1]`, matching
 * `gl-matrix` `vec4.transformMat4`: `w = m[3]*x + m[7]*y + m[11]*z + m[15]`.
 * @param {Array<number>|Float64Array} mat4 - Column-major 4x4 matrix
 * @param {number} x - World x
 * @param {number} y - World y
 * @param {number} z - World z (metres of elevation for a mercator transform)
 * @returns {number} The w component, `NaN` when the matrix is unusable
 */
export function projectedW(mat4, x, y, z) {
    if (!mat4 || typeof mat4.length !== 'number' || mat4.length < 16) return NaN;
    return mat4[3] * x + mat4[7] * y + mat4[11] * z + mat4[15];
}

/**
 * Web-mercator unit coordinates, same formulas as MapLibre's
 * `mercatorXfromLng` / `mercatorYfromLat` (`geo/mercator_coordinate.ts:17-23`).
 * @param {number} lng - Longitude in degrees
 * @param {number} lat - Latitude in degrees
 * @returns {{x: number, y: number}} Mercator coordinates in [0, 1]
 */
export function lngLatToMercator(lng, lat) {
    return {
        x: (180 + lng) / 360,
        y: (180 - (180 / Math.PI * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)))) / 360,
    };
}

/**
 * Whether a row may only count when the zero-tolerance query saw it too:
 * an AREA feature (big target, no slack) or an edit handle (the tools grab
 * handles exactly, so the shared hit-test must not be more generous).
 * @param {Object} row - Rendered row
 * @returns {boolean} `true` when the row needs the exact query to confirm it
 */
export function needsExactHit(row) {
    const properties = row?.properties;
    if (properties?.user_isEditingHandle === true) return true;
    return hitClassOf(properties?.source) === HIT_CLASS.AREA;
}

/**
 * Applies the "this needs an exact hit" rule (`needsExactHit`).
 *
 * Such rows only survive the tolerant query when the SAME feature also came
 * back from a zero-tolerance query at the click point. Every other row — ours
 * or not — passes straight through, in its original order, because the
 * callers still rely on that order for their own dedup.
 *
 * @param {Array<Object>} tolerantRows - Rows from the box query, with image rows
 *   already filtered against their rendered rectangle
 * @param {Array<Object>} [exactRows] - Rows from the point query
 * @returns {Array<Object>} The surviving rows
 */
export function resolveExactHits(tolerantRows, exactRows) {
    if (!Array.isArray(tolerantRows) || tolerantRows.length === 0) return [];

    const exactKeys = new Set();
    const exactByPosition = [];
    if (Array.isArray(exactRows)) {
        for (const row of exactRows) {
            const key = rowKey(row);
            if (key === null) exactByPosition.push(row);
            else exactKeys.add(key);
        }
    }

    return tolerantRows.filter((row) => {
        if (!needsExactHit(row)) return true;
        const key = rowKey(row);
        if (key !== null) return exactKeys.has(key);
        return exactByPosition.some((candidate) => samePosition(row, candidate));
    });
}

/**
 * Keeps the best class present: point beats line beats area.
 *
 * The winning class is chosen among DECISIVE rows only — those whose hit was
 * actually verified (geometry queried by MapLibre within the tolerance, or an
 * icon rectangle rebuilt here). A non-decisive row (a symbol still answering
 * from its inflated collision box) is always kept, so the user can still pick
 * it, but it never decides the class and never hides a feature under it.
 *
 * Rows with no class are kept whatever happens — they are the base map and the
 * viewer markers, and dropping them would break callers that look for exactly
 * those.
 *
 * @param {Array<Object>} rows - Rendered rows
 * @param {function(Object): boolean} [isDecisive] - Whether a row's hit is
 *   trustworthy enough to demote the other classes; every row by default
 * @returns {Array<Object>} The rows of the best class, plus every non-decisive
 *   and every unclassified row
 */
export function pickPreferredHits(rows, isDecisive = () => true) {
    if (!Array.isArray(rows) || rows.length === 0) return [];

    let best = null;
    for (const row of rows) {
        const hitClass = hitClassOf(row?.properties?.source);
        if (hitClass === null || !isDecisive(row)) continue;
        if (best === null || CLASS_PRIORITY.indexOf(hitClass) < CLASS_PRIORITY.indexOf(best)) {
            best = hitClass;
        }
    }

    if (best === null) return rows.slice();

    return rows.filter((row) => {
        const hitClass = hitClassOf(row?.properties?.source);
        return hitClass === null || hitClass === best || !isDecisive(row);
    });
}

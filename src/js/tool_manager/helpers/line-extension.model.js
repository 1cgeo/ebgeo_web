// Path: js/tool_manager/helpers/line-extension.model.js

/**
 * @fileoverview Pure model behind CONTINUING an existing linear feature (`line`,
 * `arrow`, `boundary`, `barrier_line`) from one of its two ends. No DOM, no store, no map, so it
 * is node-testable and safe to import from anywhere.
 *
 * WHY A MODEL AT ALL. The whole operation reduces to one decision that is easy
 * to get backwards: where the newly clicked points go relative to the spine the
 * feature already has. Appending is trivial; PREPENDING is not, because the user
 * clicks OUTWARD from the first vertex (first click nearest to it, last click
 * furthest away) while the stored spine must read from the furthest point
 * inwards. So the added points are REVERSED before they are prepended, and the
 * cursor of the live preview is the point that ends up at index 0. That single
 * `reverse` is the reason this file exists instead of two inline spreads.
 *
 * THE GEOMETRIC TRUTH IS `properties.baseCoordinates`, NEVER `geometry`, for the
 * same reason `linear-conversion.model.js` states: only `line` persists a
 * LineString, while an arrow is a Polygon and a boundary a MultiLineString, both
 * DERIVED. `resolveSpineCoordinates` is reused rather than reimplemented.
 *
 * CONTRACT ON GARBAGE INPUT. `extendCoordinates`/`previewCoordinates` are about
 * ORDER, not about validity: a non-array `existing` or `added` is read as empty,
 * and coordinate VALUES are copied through untouched, `NaN` included. Validity is
 * each tool's own business (`geometry.validate`, and three different minimum
 * spacings), and a model that silently dropped a bad point would hand the caller
 * a spine shorter than the one it asked for. The only programmer error this
 * module refuses outright is an `end` that is neither `'start'` nor `'end'`,
 * which is a bug at the call site and therefore throws.
 */

import { resolveSpineCoordinates } from './linear-conversion.model.js';

/** The types that can be continued from an end. @constant {string[]} */
export const EXTENDABLE_SOURCES = Object.freeze(['line', 'arrow', 'boundary', 'barrier_line']);

/** The two ends a feature can be continued from. @constant {string[]} */
export const EXTENSION_ENDS = Object.freeze(['start', 'end']);

/**
 * Guard the `end` argument. A wrong value here is a caller bug, not user input,
 * so it throws instead of degrading to a default that would silently continue
 * the wrong end of the drawing.
 * @param {string} end - Candidate end
 * @throws {Error} When `end` is not one of `EXTENSION_ENDS`
 */
function assertEnd(end) {
    if (!EXTENSION_ENDS.includes(end)) {
        throw new Error(`Invalid extension end: ${String(end)}`);
    }
}

/**
 * Copy one coordinate pair, leaving anything that is not an array untouched.
 * @param {*} point - Candidate coordinate
 * @returns {*} A fresh copy of the pair, or the value as-is
 */
function copyPoint(point) {
    return Array.isArray(point) ? [...point] : point;
}

/**
 * Read a value as a list of points; anything else is an empty list.
 * @param {*} value - Candidate list
 * @returns {Array} A fresh array of copied points
 */
function toPointList(value) {
    return Array.isArray(value) ? value.map(copyPoint) : [];
}

/**
 * Whether a value is a usable spine: at least two points with finite lng/lat.
 * @param {*} coords - Candidate coordinates
 * @returns {boolean} True when usable
 */
function isUsableSpine(coords) {
    if (!Array.isArray(coords) || coords.length < 2) return false;
    return coords.every(point =>
        Array.isArray(point) &&
        point.length >= 2 &&
        Number.isFinite(point[0]) &&
        Number.isFinite(point[1])
    );
}

/**
 * Splice the newly drawn points onto the spine the feature already has.
 *
 * `added` is in CLICK order. Continuing from `'end'` keeps that order; continuing
 * from `'start'` reverses it, so the LAST click becomes index 0 and the drawing
 * reads outward-to-inward exactly as the user drew it.
 *
 * @param {Array<Array<number>>} existing - Spine the feature already has
 * @param {Array<Array<number>>} added - Points drawn now, in click order
 * @param {string} end - Which end to continue from ('start' | 'end')
 * @returns {Array<Array<number>>} A NEW array (never an input, never an alias)
 * @throws {Error} When `end` is invalid
 */
export function extendCoordinates(existing, added, end) {
    assertEnd(end);

    const spine = toPointList(existing);
    const drawn = toPointList(added);

    if (drawn.length === 0) return spine;
    if (end === 'end') return [...spine, ...drawn];
    return [...drawn.reverse(), ...spine];
}

/**
 * The spine as it should be DRAWN while the cursor hovers, cursor included.
 *
 * The cursor is just one more "added" point, the newest one, which is what puts
 * it at index 0 when continuing from `'start'`. A missing cursor (before the
 * pointer has moved) degrades to the committed spine instead of drawing a hole.
 *
 * @param {Array<Array<number>>} existing - Spine the feature already has
 * @param {Array<Array<number>>} added - Points already clicked, in click order
 * @param {Array<number>|null} [cursor] - Live cursor position [lng, lat]
 * @param {string} end - Which end is being continued ('start' | 'end')
 * @returns {Array<Array<number>>} A NEW array
 * @throws {Error} When `end` is invalid
 */
export function previewCoordinates(existing, added, cursor, end) {
    assertEnd(end);

    const drawn = toPointList(added);
    if (Array.isArray(cursor)) drawn.push(copyPoint(cursor));

    return extendCoordinates(existing, drawn, end);
}

/**
 * The two ends of a feature's spine.
 *
 * @param {Object} [feature] - GeoJSON feature
 * @returns {{spine: Array<Array<number>>, start: Array<number>, end: Array<number>}|null}
 *   The spine and its two endpoints, or null when there is no usable spine
 */
export function resolveEndpoints(feature) {
    const spine = resolveSpineCoordinates(feature);
    if (!spine) return null;

    return {
        spine,
        start: [...spine[0]],
        end: [...spine[spine.length - 1]],
    };
}

/**
 * The point a continuation starts from: the vertex the handle sits on.
 *
 * It is seeded as the drawing's FIRST point so the tool's own minimum-spacing
 * check (`isPointTooClose`, which compares against the last drawn point) rejects
 * a first click landing on top of the vertex.
 *
 * @param {Array<Array<number>>} spine - Resolved spine
 * @param {string} end - Which end ('start' | 'end')
 * @returns {Array<number>|null} A copy of the anchor point, or null when the
 *   spine holds no points
 * @throws {Error} When `end` is invalid
 */
export function anchorFor(spine, end) {
    assertEnd(end);

    if (!Array.isArray(spine) || spine.length === 0) return null;
    return copyPoint(end === 'start' ? spine[0] : spine[spine.length - 1]);
}

/**
 * Whether `feature` can be continued at all, and why not when it cannot.
 *
 * The lock axis here is only the feature's OWN `bloqueado` flag; map lock, layer
 * lock and group lock are store state, so the caller checks those (see
 * `extensionDenialReason` in `line-extension.helpers.js`).
 *
 * A MERGED arrow is refused on `isMerged` ALONE, which is stricter than
 * `canConvertLinear` (which also demands two or more branches). The reason is
 * specific to this operation: a merged arrow draws from `properties.branches`,
 * so a rewritten `baseCoordinates` would change nothing on screen. A refusal the
 * user can read beats a gesture that appears to do nothing.
 *
 * @param {Object} [feature] - Candidate feature
 * @returns {{ok: boolean, reason?: string}} Verdict with a pt-BR reason
 */
export function canExtendFeature(feature) {
    const props = feature?.properties;

    if (!EXTENDABLE_SOURCES.includes(props?.source)) {
        return { ok: false, reason: 'Só linha, seta, linha de limite e linha de barreiras podem ser continuadas' };
    }
    if (props.bloqueado === true) {
        return { ok: false, reason: 'Feição está bloqueada' };
    }
    if (props.source === 'arrow' && props.isMerged === true) {
        return { ok: false, reason: 'Separe as setas antes de continuar' };
    }
    if (!isUsableSpine(resolveSpineCoordinates(feature))) {
        return { ok: false, reason: 'Feição sem coordenadas suficientes' };
    }

    return { ok: true };
}

/**
 * The properties of the CONTINUED feature.
 *
 * Continuing changes exactly one thing, the spine, and this function is where
 * that is asserted. Everything else is carried over by identity, which matters
 * most for the boundary: `createdAtZoom` and `zoomCorrectionEnabled` are its
 * zoom ANCHOR (re-stamping them would resize the whole feature under the user),
 * `symbol_instances` holds ratios along the line (the echelon slides as the line
 * grows, the same way it does when a vertex is inserted), and the `calculated*`
 * keys are a cache owned by the zoom pass that nothing else may write.
 *
 * @param {Object} [feature] - Feature being continued
 * @param {Array<Array<number>>} coordinates - The extended spine
 * @returns {Object} New properties object for the same feature id
 */
export function buildExtendedProperties(feature, coordinates) {
    return { ...(feature?.properties || {}), baseCoordinates: coordinates };
}

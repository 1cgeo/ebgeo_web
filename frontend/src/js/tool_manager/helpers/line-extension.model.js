// Path: js/tool_manager/helpers/line-extension.model.js

/**
 * @fileoverview Pure model behind CONTINUING an existing linear feature (`line`, `arrow`,
 * `boundary`) from one of its two ends: where the new points go, which vertex is the anchor,
 * what carries over, and whether the store actually took the write. No DOM, no store, no map,
 * so it loads in plain node and is testable without a browser.
 *
 * ================= WHY A MODEL AT ALL =======================================
 *
 * The whole operation reduces to ONE decision that is easy to get backwards: where the newly
 * clicked points go relative to the spine the feature already has. Appending is trivial;
 * PREPENDING is not, because the user clicks OUTWARD from the first vertex (first click nearest
 * to it, last click furthest away) while the stored spine must read from the furthest point
 * inwards. So the added points are REVERSED before they are prepended, and the cursor of the
 * live preview is the point that ends up at index 0. That single `reverse` is the reason this
 * file exists instead of two inline spreads copied into three controls.
 *
 * THE CONSEQUENCE THE ARROW PAYS, and the one that reads backwards most easily: continuing from
 * the START does not move the head. An arrow's head is drawn on the LAST coordinate of the
 * spine, and prepending leaves that last coordinate where it was. Continuing from the END is
 * what moves the head, and it moves it because that is what the user asked for.
 *
 * THE GEOMETRIC TRUTH IS `properties.baseCoordinates`, NEVER `geometry`, for the same reason
 * `linear-conversion.model.js` states: only the line persists a `LineString`; an arrow is a
 * `Polygon` (the outline) and a boundary a `MultiLineString` (the segments with the echelon gaps
 * already carved out). `resolveSpineCoordinates` is REUSED from that file rather than
 * reimplemented, because two readings of the same spine diverge on the first legacy feature.
 *
 * ================= CONTRACT ON GARBAGE INPUT ================================
 *
 * `extendCoordinates` and `previewCoordinates` are about ORDER, not about validity: a non-array
 * `existing` or `added` is read as empty, and coordinate VALUES are copied through untouched,
 * `NaN` included. Validity is each tool's own business (`geometry.validate`, and three different
 * minimum spacings), and a model that silently dropped a bad point would hand the caller a spine
 * shorter than the one it asked for, without saying so. The only programmer error this module
 * refuses outright is an `end` that is neither `'start'` nor `'end'`, which is a bug at the call
 * site and therefore throws.
 *
 * ================= THE CONFIRMATION, WHICH IS NOT OPTIONAL ==================
 *
 * `storedSpineMatches` exists because `updateFeature` (`store/feature.operations.js`) returns
 * `undefined` on EVERY path, success included: `guardWrite` refuses on rank or on a lock, emits
 * `STORE_OPERATION_BLOCKED` and simply returns, which from the outside is indistinguishable from
 * a write. The "read the return value" lesson from the conversion batch (where `addFeature` DOES
 * return the created feature) does not transfer to the update. What is left is to read the
 * feature back from the store and ask whether the spine that came back is the new one; that is
 * what this predicate answers, and it is what authorizes touching the MapLibre source.
 */

import { isMergedArrow, resolveSpineCoordinates } from './linear-conversion.model.js';

/** The three types that can be continued from an end. @type {readonly string[]} */
export const EXTENDABLE_SOURCES = Object.freeze(['line', 'arrow', 'boundary']);

/** The two ends a feature can be continued from. @type {readonly string[]} */
export const EXTENSION_ENDS = Object.freeze(['start', 'end']);

/** Refusal for anything that is not a line, an arrow or a boundary. @type {string} */
export const NOT_EXTENDABLE_NOTICE = 'Só linha, seta e linha de limite podem ser continuadas.';

/** Refusal for a feature carrying its own lock. @type {string} */
export const LOCKED_FEATURE_NOTICE = 'Esta feição está bloqueada. Desbloqueie-a para continuá-la.';

/** Refusal for a merged arrow, whose undo lives in the feature's own menu. @type {string} */
export const MERGED_ARROW_NOTICE = 'Separe as setas combinadas antes de continuar.';

/** Refusal for a spine that does not make a line. @type {string} */
export const SHORT_SPINE_NOTICE = 'Esta feição não tem um eixo com dois vértices para continuar.';

/**
 * Guard the `end` argument. A wrong value here is a caller bug, never user input, so it throws
 * instead of degrading to a default that would silently continue the wrong end of the drawing.
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
 * @returns {Array} A NEW array of copied points
 */
function toPointList(value) {
    return Array.isArray(value) ? value.map(copyPoint) : [];
}

/**
 * Whether a value is a usable coordinate pair.
 * @param {*} point - Candidate
 * @returns {boolean} True when it is a finite pair
 */
function isFinitePosition(point) {
    return Array.isArray(point)
        && point.length >= 2
        && Number.isFinite(point[0])
        && Number.isFinite(point[1]);
}

/**
 * Whether a value is a usable spine: two or more finite points.
 * @param {*} coords - Candidate spine
 * @returns {boolean} True when usable
 */
function isUsableSpine(coords) {
    return Array.isArray(coords) && coords.length >= 2 && coords.every(isFinitePosition);
}

/**
 * Splice the newly drawn points onto the spine the feature already has.
 *
 * `added` is in CLICK order. Continuing from `'end'` keeps that order; continuing from `'start'`
 * reverses it, so the LAST click becomes index 0 and the drawing reads outward-to-inward exactly
 * as the user drew it.
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
 * The cursor is just one more "added" point, the newest one, which is what puts it at index 0
 * when continuing from `'start'`. A missing cursor (before the pointer has moved) degrades to
 * the committed spine instead of drawing a hole.
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
 * @returns {{spine: Array<Array<number>>, start: Array<number>, end: Array<number>}|null} The
 *   spine and its two endpoints, or null when there is no usable spine
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
 * The point a continuation starts from: the vertex the clicked handle sits on.
 *
 * It is seeded as the drawing's FIRST point so the tool's own minimum-spacing check
 * (`isPointTooClose`, which compares against the last drawn point) rejects a first click landing
 * on top of the vertex.
 *
 * @param {Array<Array<number>>} spine - Resolved spine
 * @param {string} end - Which end ('start' | 'end')
 * @returns {Array<number>|null} A copy of the anchor point, or null when the spine holds no
 *   points
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
 * The lock axis here is only the feature's OWN `bloqueado` flag; map lock, layer lock and group
 * lock are store state, and the one that asks about those is `extensionDenialReason`
 * (`line-extension.helpers.js`), which cannot live in this pure file.
 *
 * THE MERGED ARROW IS REFUSED BY `isMergedArrow`, THE SHARED PREDICATE, and never by `isMerged`
 * alone. The distinction is not pedantry, and it is written out in that predicate's own JSDoc:
 * `isMerged` has been seen true WITHOUT the branches (an interrupted split), and in that state
 * the feature is an ordinary arrow with a lying flag. It draws from `baseCoordinates`, so
 * continuing it works; "Separar Setas" is not even offered, so there is no way to clear the
 * flag; and a refusal there would remove the handle with no word and no way out. A genuinely
 * merged arrow draws from `properties.branches`, so rewriting `baseCoordinates` would change
 * NOTHING on screen; a refusal the user can read beats a gesture that appears to do nothing, and
 * the sentence names the undo, which is in the same menu.
 *
 * The source is not re-checked around it because only an arrow ever carries `branches`, and the
 * sibling `canConvertLinear` asks the same question the same way.
 *
 * @param {Object} [feature] - Candidate feature
 * @returns {{ok: boolean, reason?: string}} Verdict with a pt-BR sentence
 */
export function canExtendFeature(feature) {
    const props = feature?.properties;

    if (!EXTENDABLE_SOURCES.includes(props?.source)) {
        return { ok: false, reason: NOT_EXTENDABLE_NOTICE };
    }
    if (props.bloqueado === true) {
        return { ok: false, reason: LOCKED_FEATURE_NOTICE };
    }
    if (isMergedArrow(props)) {
        return { ok: false, reason: MERGED_ARROW_NOTICE };
    }
    if (!isUsableSpine(resolveSpineCoordinates(feature))) {
        return { ok: false, reason: SHORT_SPINE_NOTICE };
    }

    return { ok: true };
}

/**
 * The properties of the CONTINUED feature.
 *
 * Continuing changes exactly one thing, the spine, and this function is where that is asserted.
 * Everything else is carried over BY IDENTITY, which matters most for the boundary:
 * `createdAtZoom` and `zoomCorrectionEnabled` are its zoom ANCHOR (re-stamping them would resize
 * the whole feature under the user), `symbol_instances` holds ratios along the line (the echelon
 * slides as the line grows, the same way it does when a vertex is inserted), `text_north_facing`
 * is the operator's choice, and the `calculated*` keys are a cache owned by the zoom pass that
 * nothing else may write.
 *
 * @param {Object} [feature] - Feature being continued
 * @param {Array<Array<number>>} coordinates - The extended spine
 * @returns {Object} A NEW properties object, for the SAME feature id
 */
export function buildExtendedProperties(feature, coordinates) {
    return { ...(feature?.properties || {}), baseCoordinates: coordinates };
}

/**
 * DOES THE FEATURE READ BACK FROM THE STORE CARRY THE NEW SPINE?
 *
 * It is the only confirmation available, which is why it is the gate that authorizes touching
 * the MapLibre source. See the `@fileoverview`: `updateFeature` returns `undefined` on success
 * and on refusal alike, and a feature that no longer exists in the store returns `undefined`
 * from the re-read, which is read here as not-written, correctly.
 *
 * The comparison is about the SPINE and not about the whole object, deliberately: the store
 * preserves user data and sync metadata over what was handed to it (`preserveUserData`,
 * `preserveSyncMetadata`), so a deep equality would reject every successful write.
 *
 * @param {Object} [feature] - Feature read back from the store
 * @param {Array<Array<number>>} coordinates - The spine the caller tried to write
 * @returns {boolean} True when the stored spine is, point by point, the requested one
 */
export function storedSpineMatches(feature, coordinates) {
    if (!Array.isArray(coordinates) || coordinates.length < 2) return false;

    const stored = resolveSpineCoordinates(feature);
    if (!stored || stored.length !== coordinates.length) return false;

    return stored.every((point, i) => {
        const wanted = coordinates[i];
        return isFinitePosition(point)
            && isFinitePosition(wanted)
            && point[0] === wanted[0]
            && point[1] === wanted[1];
    });
}

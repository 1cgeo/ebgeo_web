// Path: js/3d_models_viewer_tool/services/viewshed-preview.js

/**
 * @module 3d_models_viewer_tool/services/viewshed-preview
 * @description The pure arithmetic of the interactive 3D viewshed PREVIEW: the sector the analysis
 * is about to cover, drawn between the first click (the observer) and the second (the target) while
 * the pointer moves.
 *
 * THE PREVIEW EXISTED, AND THE 2026-09-15 REWRITE DROPPED IT WITHOUT A TRACE. The replaced plugin's
 * MOUSE_MOVE handler recomputed the frustum orientation and then assigned `distance` through a
 * SETTER, and that setter removed and re-added the rectangular-sensor entity: the wireframe followed
 * the pointer as a side effect of an assignment. The rewrite (decision D15, commit d53a0d27) kept the
 * handler and wrote the private range field directly; and even the setter would have done nothing,
 * because the house outline needs the observer camera, which is only built on the second click. The
 * behaviour inventory had described that handler as "moving the mouse updates the current range",
 * which is true and is half of what it did. The owner reported the missing preview on 2026-09-22.
 *
 * WHAT THE PREVIEW PROMISES, AND WHY THE FRAME IS BUILT THE WAY IT IS. It must be the sector the
 * tool will actually draw after the second click, not a lookalike. The tool does not keep the
 * interactive instance: it stores the two clicks and REBUILDS the viewshed with the observer lifted
 * to eye height (`handleViewshedComplete` then `createCesiumViewsheds` in
 * `tools/viewshed_tool_3d.js`). That rebuild aims from the EYE at the target, but its range is the
 * distance from the CLICKED point (the ground) to the target, rounded to a tenth, because that is
 * what the interactive instance measured and handed back. `previewFrame` reproduces both halves,
 * and the axes are the ones Cesium's `Camera` ends up with after it orthonormalizes: `up` is the
 * geocentric normal at the eye with its forward component removed, and `right` is forward cross up.
 *
 * ZERO CESIUM, BY CONTRACT: plain `{x, y, z}` triples in Earth-fixed metres in and out, so every
 * number that decides the drawing is reachable from a node test
 * (`frontend/tests/unit/viewshed-3d-preview.test.js`). The only import is the sibling leaf that
 * already draws the final wireframe, so the preview and the final outline cannot drift apart.
 */

import { frustumOutlineAngles, directionFromAngles } from './viewshed-geometry.js';

/**
 * Shortest range, in metres after rounding, that still has a sector to show.
 *
 * Below it the pointer is on the observer: a range of zero has no far surface, and the tool itself
 * would fall back to its 500 m default on a second click there (`parameters.distance || 500`).
 */
export const MIN_PREVIEW_RANGE = 0.1;

/**
 * Smallest length, in metres or as a unit-vector residue, treated as non-zero. It rejects the one
 * degenerate aim that survives the range test: the pointer straight below (or above) the eye, where
 * forward is parallel to up and no horizontal opening can be defined.
 *
 * It is 1e-7 and not something nearer the float floor because the inputs are Earth-fixed: one ulp
 * of a coordinate near 6.4e6 m is about 1e-9 m, so an aim that is parallel to the vertical by
 * construction still leaves a residue of a few 1e-10, which a 1e-9 threshold would call a direction.
 * As an angle, 1e-7 is six millionths of a degree off the vertical, which draws nothing different.
 */
const LENGTH_EPSILON = 1e-7;

/**
 * @param {*} v
 * @returns {boolean} True for an object with three finite coordinates.
 */
function isPoint(v) {
    return v != null
        && Number.isFinite(v.x)
        && Number.isFinite(v.y)
        && Number.isFinite(v.z);
}

/** @returns {{x: number, y: number, z: number}} a - b */
function subtract(a, b) {
    return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

/** @returns {number} a . b */
function dot(a, b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}

/** @returns {{x: number, y: number, z: number}} a x b */
function cross(a, b) {
    return {
        x: a.y * b.z - a.z * b.y,
        y: a.z * b.x - a.x * b.z,
        z: a.x * b.y - a.y * b.x,
    };
}

/**
 * @param {{x: number, y: number, z: number}} v
 * @returns {{x: number, y: number, z: number}|null} Unit vector, or null when v has no length.
 */
function normalize(v) {
    const length = Math.hypot(v.x, v.y, v.z);
    if (!(length > LENGTH_EPSILON) || !Number.isFinite(length)) return null;
    return { x: v.x / length, y: v.y / length, z: v.z / length };
}

/**
 * The range the analysis will get: straight-line distance from the CLICKED observer to the target,
 * rounded to one decimal, the same arithmetic the engine applies on the second click.
 * @param {{x: number, y: number, z: number}} observer - First click, Earth-fixed metres.
 * @param {{x: number, y: number, z: number}} pointer - Point under the cursor, Earth-fixed metres.
 * @returns {number} Metres, or NaN when either point is not a finite triple.
 */
export function previewRange(observer, pointer) {
    if (!isPoint(observer) || !isPoint(pointer)) return NaN;
    const d = subtract(pointer, observer);
    return Number(Math.hypot(d.x, d.y, d.z).toFixed(1));
}

/**
 * The observer frame of the previewed sector.
 * @param {{x: number, y: number, z: number}} observer - First click (the ground), Earth-fixed metres.
 * @param {{x: number, y: number, z: number}} eye - The observer lifted to eye height, Earth-fixed
 *   metres. It is where the sector's apex is drawn, and it is what the final analysis looks from.
 * @param {{x: number, y: number, z: number}} pointer - Point under the cursor, Earth-fixed metres.
 * @returns {{
 *   range: number,
 *   forward: {x: number, y: number, z: number},
 *   right: {x: number, y: number, z: number},
 *   up: {x: number, y: number, z: number},
 * }|null} Unit axes plus the range, or null when there is no sector to preview (a non-finite
 *   input, the pointer on the observer, the pointer on the eye, or the aim parallel to the vertical).
 */
export function previewFrame(observer, eye, pointer) {
    if (!isPoint(observer) || !isPoint(eye) || !isPoint(pointer)) return null;

    const range = previewRange(observer, pointer);
    if (!(range >= MIN_PREVIEW_RANGE)) return null;

    const forward = normalize(subtract(pointer, eye));
    if (!forward) return null;

    const vertical = normalize(eye);
    if (!vertical) return null;

    // Gram-Schmidt, which is what Cesium's Camera does to an `up` that is not perpendicular to
    // `direction`: the final outline is drawn from those orthonormalized axes, so the preview has
    // to be too, or the two wireframes would disagree by the tilt of the aim.
    const along = dot(vertical, forward);
    const up = normalize({
        x: vertical.x - forward.x * along,
        y: vertical.y - forward.y * along,
        z: vertical.z - forward.z * along,
    });
    if (!up) return null;

    const right = normalize(cross(forward, up));
    if (!right) return null;

    return { range, forward, right, up };
}

/**
 * The polylines of the preview, in Earth-fixed metres.
 *
 * `outline` is the wireframe `Viewshed3D` draws once the analysis exists (same
 * `frustumOutlineAngles`, same `directionFromAngles`, same radius), anchored at the eye. `aim` is
 * the line from the eye to the pointer, which the final drawing does not carry: it is what tells the
 * person, while the sector is still a promise, exactly which point the second click will take.
 * @param {ReturnType<typeof previewFrame>} frame - From `previewFrame`.
 * @param {{x: number, y: number, z: number}} eye - The apex, Earth-fixed metres.
 * @param {{x: number, y: number, z: number}} pointer - Point under the cursor, Earth-fixed metres.
 * @param {number} horizontalAngle - Horizontal opening in degrees.
 * @param {number} verticalAngle - Vertical opening in degrees.
 * @param {number} [slices] - Subdivisions per axis, as in `frustumOutlineAngles`.
 * @returns {{
 *   outline: Array<Array<{x: number, y: number, z: number}>>,
 *   aim: Array<{x: number, y: number, z: number}>,
 * }|null} Null when there is no frame.
 */
export function previewPolylines(frame, eye, pointer, horizontalAngle, verticalAngle, slices) {
    if (!frame || !isPoint(eye) || !isPoint(pointer)) return null;

    const { forward, right, up, range } = frame;
    const apex = { x: eye.x, y: eye.y, z: eye.z };

    /**
     * @param {{azimuth: number, elevation: number}} angle
     * @returns {{x: number, y: number, z: number}} Point on the sector's far surface.
     */
    const pointAt = (angle) => {
        const dir = directionFromAngles(forward, right, up, angle.azimuth, angle.elevation);
        return {
            x: eye.x + dir.x * range,
            y: eye.y + dir.y * range,
            z: eye.z + dir.z * range,
        };
    };

    const outline = frustumOutlineAngles(horizontalAngle, verticalAngle, slices).map((line) => (
        line.apex ? [{ ...apex }, pointAt(line.points[0])] : line.points.map(pointAt)
    ));

    return { outline, aim: [{ ...apex }, { x: pointer.x, y: pointer.y, z: pointer.z }] };
}

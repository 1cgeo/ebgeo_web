// Path: js/map/drag-rotate.model.js

/**
 * @fileoverview Pure model for the custom mouse drag-rotate/pitch gesture.
 *
 * Keeps every decision of the gesture (which axis a modifier drives, how many
 * degrees a pixel is worth, when a drag stops being a click) out of the DOM
 * handler so it can be unit-tested in plain node.
 *
 * Axis mapping (desktop only):
 *   Ctrl (or Meta on macOS) + drag -> pitch only   (vertical movement)
 *   Shift + drag                   -> bearing only (horizontal movement)
 *   Ctrl + Shift + drag            -> both axes    (legacy behaviour)
 *
 * The right mouse button is deliberately NOT mapped: it is reserved for the
 * context menu and for finishing in-progress drawings.
 *
 * This module has ZERO imports on purpose: it is the half of the gesture that
 * runs in node, and pulling anything from `@utils` here would drag the store
 * into a file whose whole point is to be testable without one.
 */

/** @enum {string} */
export const DRAG_MODE = {
    NONE: 'none',
    PITCH: 'pitch',
    BEARING: 'bearing',
    BOTH: 'both'
};

/** Degrees of bearing per horizontal pixel. */
export const MOUSE_BEARING_SENSITIVITY = 0.5;

/** Degrees of pitch per vertical pixel (0-65 deg in ~217 px). */
export const MOUSE_PITCH_SENSITIVITY = 0.3;

/** Pixels the pointer must travel before the drag engages (keeps Shift+click selecting). */
export const DRAG_THRESHOLD_PX = 3;

/**
 * Resolves which camera axes a mousedown should drive.
 *
 * `metaKey` is accepted as an alias of `ctrlKey` because on macOS Ctrl+click is
 * the secondary click, so Cmd is the practical modifier there.
 *
 * @param {{button?: number, ctrlKey?: boolean, metaKey?: boolean, shiftKey?: boolean}} [event]
 * @returns {string} One of DRAG_MODE.
 */
export function resolveDragMode(event = {}) {
    const { button, ctrlKey, metaKey, shiftKey } = event ?? {};
    if (button !== 0) return DRAG_MODE.NONE;

    const pitchModifier = Boolean(ctrlKey) || Boolean(metaKey);
    const bearingModifier = Boolean(shiftKey);

    if (pitchModifier && bearingModifier) return DRAG_MODE.BOTH;
    if (pitchModifier) return DRAG_MODE.PITCH;
    if (bearingModifier) return DRAG_MODE.BEARING;
    return DRAG_MODE.NONE;
}

/**
 * Converts a pointer delta into camera deltas, locking the axis the mode excludes.
 *
 * @param {string} mode - One of DRAG_MODE.
 * @param {number} dx - Horizontal pointer movement in pixels.
 * @param {number} dy - Vertical pointer movement in pixels.
 * @returns {{bearingDelta: number, pitchDelta: number}} Never NaN.
 */
export function computeCameraDelta(mode, dx, dy) {
    const safeDx = Number.isFinite(dx) ? dx : 0;
    const safeDy = Number.isFinite(dy) ? dy : 0;

    // `|| 0` collapses -0 (from a zero delta) to 0, so callers never compare
    // against a negative zero.
    const bearing = -safeDx * MOUSE_BEARING_SENSITIVITY || 0;
    const pitch = -safeDy * MOUSE_PITCH_SENSITIVITY || 0;

    switch (mode) {
        case DRAG_MODE.PITCH:
            return { bearingDelta: 0, pitchDelta: pitch };
        case DRAG_MODE.BEARING:
            return { bearingDelta: bearing, pitchDelta: 0 };
        case DRAG_MODE.BOTH:
            return { bearingDelta: bearing, pitchDelta: pitch };
        default:
            return { bearingDelta: 0, pitchDelta: 0 };
    }
}

/**
 * Clamps a pitch value into the map's allowed range.
 * A non-finite value collapses to the minimum instead of poisoning the camera.
 *
 * The range is an ARGUMENT, never a constant: `maxPitch` comes from the server
 * (`config.map2d.maxPitch`), so a hardcoded ceiling here would silently cap a
 * map the deployment allows to tilt further.
 *
 * @param {number} value
 * @param {number} minPitch
 * @param {number} maxPitch
 * @returns {number}
 */
export function clampPitch(value, minPitch, maxPitch) {
    const min = Number.isFinite(minPitch) ? minPitch : 0;
    const max = Number.isFinite(maxPitch) ? maxPitch : min;
    if (!Number.isFinite(value)) return min;
    return Math.max(min, Math.min(max, value));
}

/**
 * Whether the accumulated movement is large enough to be a drag rather than a click.
 *
 * @param {number} dx
 * @param {number} dy
 * @returns {boolean}
 */
export function exceedsDragThreshold(dx, dy) {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return false;
    return Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX;
}

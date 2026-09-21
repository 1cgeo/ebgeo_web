// Path: js/tool_manager/click-after-drag.js

/**
 * @fileoverview A CLICK THAT ENDS A DRAG IS NOT A CLICK, and since the handle drag became a POINTER
 * drag nobody was saying so any more.
 *
 * MapLibre suppresses the `click` that follows a drag by comparing it with the position of the last
 * `mousedown` it saw. The edit-handle drag of the draw tools moved to pointer events with capture
 * (it had to: the mouse events never arrive from a finger), and its `pointerdown` calls
 * `preventDefault`, which cancels the COMPATIBILITY mouse events and does NOT cancel the `click`.
 * MapLibre therefore never sees the `mousedown`, has nothing to compare against, and fires the
 * click at the point where the vertex was dropped. That point is usually outside the feature, so
 * the selection manager read it as "clicked on nothing" and deselected.
 *
 * MEASURED 2026-09-20, polygon on a local atlas: after dragging one vertex the selection went from
 * one feature to none, and the eight handles stayed rendered, because the drag's own continuation
 * (`await forceUpdateMainSource` yields, the click lands in the gap) redrew them for a feature that
 * was no longer selected.
 *
 * THE RULE IS RESTORED WHERE THE CLICK IS CONSUMED, from the pointer events themselves, so it holds
 * for every control whatever it does with `preventDefault`.
 *
 * ZERO IMPORTS: pure, tested in node.
 */

/** Same figure as MapLibre's default `clickTolerance`, in CSS pixels. */
export const CLICK_TOLERANCE_PX = 3;

/**
 * @param {{x: number, y: number}|null|undefined} down - Where the pointer went down.
 * @param {{x: number, y: number}|null|undefined} click - Where the click landed.
 * @param {number} [tolerance]
 * @returns {boolean} True when the pointer travelled farther than a click may. FALSE when either
 *   point is missing or not finite: a click nobody can place against a pointerdown (keyboard,
 *   synthetic, a test that fires `click` alone) stays a click.
 */
export function isDragEndClick(down, click, tolerance = CLICK_TOLERANCE_PX) {
    const nums = [down?.x, down?.y, click?.x, click?.y];
    if (!nums.every(Number.isFinite)) return false;
    return Math.hypot(click.x - down.x, click.y - down.y) > tolerance;
}

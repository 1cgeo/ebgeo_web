// Path: js/temporal/temporal-bar.model.js

/**
 * @fileoverview Pure input model for the timeline bar's ruler: which pointer may
 * start a cursor drag, what each pointer event does to a live drag, and which
 * cursor a key press asks for. No DOM, no listeners, no store, no MapLibre:
 * every function here runs in plain node against literal event objects.
 *
 * IT TAKES THE DOM EVENT TYPE NAMES ON PURPOSE (`pointerdown`, `pointermove`,
 * `pointerup`, `pointercancel`, `lostpointercapture`), so the bar can hand the
 * real event straight through and a test can hand it an object literal with the
 * same shape. An adapter in between would be one more place for the two to
 * disagree.
 *
 * THE TWO RULES THAT WERE WRONG INSIDE THE BAR AND ARE CHEAP TO PIN DOWN HERE:
 *
 *  - C7, the drag that never ends. The bar ended a drag on `pointerup` and on
 *    nothing else, with the move listener parked on `window` for the component's
 *    whole life. On touch, the system takes the pointer away mid-gesture (a page
 *    scroll, a pinch, a notification) and delivers `pointercancel` INSTEAD of
 *    `pointerup`: the flag stayed true and every later movement anywhere on the
 *    page dragged the timeline cursor until a reload. It also filtered no
 *    button and no `isPrimary`, so a right-click began a drag and a second
 *    finger scrubbed with the wrong finger's position.
 *
 *  - C8, the ruler that only answered two keys. It is a `role="slider"`, and a
 *    slider answers Home/End and PageUp/PageDown as well as the arrows. The
 *    translation lives here so the boundaries (a degenerate step, a bound that
 *    is not a number, a cursor already at the end) are asserted without a
 *    browser.
 */

import { clampCursor } from './temporal.utils.js';

/** What the caller must do about a pointer event. */
export const DragOutcome = Object.freeze({
    /** Nothing: the event is not ours (wrong button, extra finger, no live drag). */
    NONE: 'none',
    /** Take the capture, wire the exits, scrub to this position. */
    START: 'start',
    /** Scrub to this position. */
    MOVE: 'move',
    /** Drop the exits and the capture. */
    END: 'end',
});

/** The resting state: no drag in flight. */
export const IDLE_DRAG = Object.freeze({ dragging: false, pointerId: null });

/** How many unit steps PageUp/PageDown cover, against one for an arrow. */
export const PAGE_STEP_MULTIPLIER = 10;

/** The three ways a drag ends. `lostpointercapture` closes the case where the
 *  browser hands the capture back without a `pointerup` of its own. */
const END_TYPES = new Set(['pointerup', 'pointercancel', 'lostpointercapture']);

const FORWARD_KEYS = new Set(['ArrowRight', 'ArrowUp']);
const BACKWARD_KEYS = new Set(['ArrowLeft', 'ArrowDown']);

/** Coerces anything into a well-formed drag state, so a caller may pass null. */
function normalizeDragState(state) {
    if (!state || typeof state !== 'object' || state.dragging !== true) return IDLE_DRAG;
    return { dragging: true, pointerId: Number.isFinite(state.pointerId) ? state.pointerId : null };
}

/**
 * Is this event from the pointer that owns the live drag?
 *
 * A drag born from an event with no usable `pointerId` (a synthetic one) owns no
 * identity, so it accepts any pointer EXCEPT one that declares itself secondary:
 * that is the second finger, and letting it through would scrub with the wrong
 * finger's position.
 */
function isOwnPointer(state, evt) {
    if (state.pointerId === null) return evt?.isPrimary !== false;
    if (!Number.isFinite(evt?.pointerId)) return true;
    return evt.pointerId === state.pointerId;
}

/**
 * Advances the drag state machine by one pointer event.
 *
 * @param {{dragging: boolean, pointerId: (number|null)}|null} state - Current state (IDLE_DRAG to start).
 * @param {{type: string, pointerId?: number, isPrimary?: boolean, button?: number}} evt
 *   A PointerEvent, or any object with the same four fields.
 * @returns {{state: {dragging: boolean, pointerId: (number|null)}, outcome: string}}
 *   The next state and what the caller must do (a `DragOutcome`).
 */
export function reduceDragEvent(state, evt) {
    const current = normalizeDragState(state);
    const type = evt?.type;

    if (type === 'pointerdown') {
        // A second pointer down while a drag is live is the second finger, never
        // a new drag: it would scrub the ruler from wherever that finger landed.
        if (current.dragging) return { state: current, outcome: DragOutcome.NONE };
        if (evt.isPrimary === false) return { state: current, outcome: DragOutcome.NONE };
        // Only the main button. A missing `button` is a synthetic event, not a
        // secondary one, so it is accepted; any declared non-zero button is not.
        if (Number.isFinite(evt.button) && evt.button !== 0) {
            return { state: current, outcome: DragOutcome.NONE };
        }
        const pointerId = Number.isFinite(evt.pointerId) ? evt.pointerId : null;
        return { state: { dragging: true, pointerId }, outcome: DragOutcome.START };
    }

    if (!current.dragging) return { state: current, outcome: DragOutcome.NONE };
    if (!isOwnPointer(current, evt)) return { state: current, outcome: DragOutcome.NONE };

    if (type === 'pointermove') return { state: current, outcome: DragOutcome.MOVE };
    if (END_TYPES.has(type)) return { state: IDLE_DRAG, outcome: DragOutcome.END };

    return { state: current, outcome: DragOutcome.NONE };
}

/**
 * Which cursor a key press asks for on the ruler.
 *
 * Home/End answer from the bounds alone and need no step, which is what keeps
 * them working on a timeline whose unit resolves to no length. Every other key
 * needs a positive step and a finite cursor, and a `null` return says "not a key
 * of mine": the caller must NOT call `preventDefault` on it, or Tab and the
 * browser's own shortcuts would die on this element.
 *
 * @param {Object} input
 * @param {string} input.key - `KeyboardEvent.key`.
 * @param {number} input.cursor - Current cursor (epoch ms).
 * @param {number} input.inicio - Timeline start (epoch ms); non-finite means no lower bound.
 * @param {number} input.fim - Timeline end (epoch ms); non-finite means no upper bound.
 * @param {number} input.step - One division unit in ms; non-positive disables the arrows.
 * @param {number} [input.pageSteps=PAGE_STEP_MULTIPLIER] - Steps a PageUp/PageDown covers.
 * @param {boolean} [input.ctrlKey] - Held modifiers hand the key back to the browser.
 * @param {boolean} [input.metaKey]
 * @param {boolean} [input.altKey]
 * @returns {number|null} The cursor to ask for (clamped to the bounds), or null.
 */
export function cursorForKey({
    key,
    cursor,
    inicio,
    fim,
    step,
    pageSteps = PAGE_STEP_MULTIPLIER,
    ctrlKey = false,
    metaKey = false,
    altKey = false,
} = {}) {
    if (ctrlKey || metaKey || altKey) return null;

    if (key === 'Home') return Number.isFinite(inicio) ? inicio : null;
    if (key === 'End') return Number.isFinite(fim) ? fim : null;

    const forward = FORWARD_KEYS.has(key);
    const backward = BACKWARD_KEYS.has(key);
    const page = key === 'PageUp' || key === 'PageDown';
    if (!forward && !backward && !page) return null;

    if (!Number.isFinite(cursor)) return null;
    if (!Number.isFinite(step) || step <= 0) return null;

    const multiplier = page && Number.isFinite(pageSteps) && pageSteps > 0 ? pageSteps : 1;
    const sign = forward || key === 'PageUp' ? 1 : -1;
    return clampCursor(cursor + sign * step * multiplier, inicio, fim);
}

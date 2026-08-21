// Path: js/first_person_3d_tool/services/keyboard-service-fp.js

/**
 * @fileoverview Keyboard handling service for the first-person 3D viewer.
 * Mirrors `street_view_tool/services/keyboard_service_360.js`: it owns the
 * viewer-specific shortcuts, disables the global shortcuts while active and
 * re-enables them on deactivation.
 *
 * It only routes TOOL keys. Movement (WASD / arrows / space / shift / C) is
 * owned by `walk/walk-mode.js`, which listens on its own because it needs the
 * keys held down across frames, not one event per press.
 *
 * Keys routed here: T (tape), L (labels), Backspace (undo point),
 * Delete (clear measurements), Esc (cascade).
 *
 * OWNERSHIP. The viewer hands over VERBS and asks nothing about keys; this
 * service owns the key table and the Escape cascade.
 */

// =========================================================================
// STATE
// =========================================================================

let isActive = false;
let boundHandler = null;
let globalKeyboardShortcuts = null;

/**
 * Callbacks provided by first_person_viewer.js. The viewer owns the state, so
 * this service never inspects it - it only decides WHICH action a key maps to.
 *
 * The three Escape steps must return a truthy value when they consumed the key,
 * so the cascade can stop at the first one that acted.
 */
let callbacks = {
    /** T - toggles the measuring tape. */
    toggleMeasurement: null,
    /** L - toggles the curated marker labels. */
    toggleLabels: null,
    /** Backspace - removes the last measurement point. */
    undoMeasurement: null,
    /** Delete - clears every measurement. */
    clearMeasurement: null,
    /**
     * Esc 0 - leaves the immersive mode.
     *
     * A SAFETY NET, and expected to be dead code in Chrome: the browser exits
     * pointer lock on Escape ITSELF and does not deliver that keydown to the
     * page, so this step normally never runs. It is here for the browser that
     * delivers it, where without it one Escape would leave the mode AND close
     * the card behind it.
     */
    exitImmersive: null,
    /** Esc 1 - closes the open marker card. */
    closeMarkerPanel: null,
    /** Esc 2 - closes the polyline still being drawn. */
    finishMeasurement: null,
    /** Esc 3 - turns the measuring tape off. */
    disableMeasurement: null
};

// =========================================================================
// PUBLIC API
// =========================================================================

/**
 * Initialize the service with the global keyboard shortcuts instance.
 * @param {Object} keyboardShortcutsInstance - Global keyboard shortcuts
 */
export function initKeyboardServiceFp(keyboardShortcutsInstance) {
    globalKeyboardShortcuts = keyboardShortcutsInstance;
}

/**
 * Set callback functions for keyboard actions.
 * @param {Object} newCallbacks - Partial map of callbacks to merge in
 */
export function setKeyboardCallbacksFp(newCallbacks) {
    callbacks = { ...callbacks, ...newCallbacks };
}

/**
 * Activate the first-person keyboard service.
 * Disables the global shortcuts and registers the viewer-specific handler.
 */
export function activateKeyboardServiceFp() {
    if (isActive) return;

    // Disable global keyboard shortcuts
    if (globalKeyboardShortcuts && globalKeyboardShortcuts.isEnabled()) {
        globalKeyboardShortcuts.disable();
    }

    boundHandler = handleKeyDown;
    document.addEventListener('keydown', boundHandler);

    isActive = true;
}

/**
 * Deactivate the first-person keyboard service.
 *
 * Idempotent: both `closeFirstPersonViewer()` and the module teardown call it.
 */
export function deactivateKeyboardServiceFp() {
    if (!isActive) return;

    if (boundHandler) {
        document.removeEventListener('keydown', boundHandler);
        boundHandler = null;
    }

    // Re-enable global keyboard shortcuts
    if (globalKeyboardShortcuts) {
        globalKeyboardShortcuts.enable();
    }

    isActive = false;
}

// =========================================================================
// KEYBOARD HANDLER
// =========================================================================

/**
 * Main keydown handler for the first-person viewer.
 *
 * Keys are matched by `event.code` (physical key), not by `event.key`, for the
 * same reason walk-mode does it: the keyboard layout must not move a shortcut,
 * and the tool keys sit right next to the movement keys.
 *
 * @param {KeyboardEvent} e - Keyboard event
 */
function handleKeyDown(e) {
    // Skip if typing in input fields
    if (isTypingInInput(e.target)) return;

    // Browser combos (Ctrl+T, Alt+Left, ...) are never ours.
    if (e.ctrlKey || e.altKey || e.metaKey) return;

    switch (e.code) {
        case 'Escape':
            // preventDefault only when the cascade actually consumed the key,
            // so an Escape this viewer has no use for still reaches the browser.
            if (runEscapeCascade()) {
                e.preventDefault();
            }
            break;

        case 'KeyT':
            e.preventDefault();
            callbacks.toggleMeasurement?.();
            break;

        case 'KeyL':
            e.preventDefault();
            callbacks.toggleLabels?.();
            break;

        case 'Backspace':
            // Without preventDefault an old browser walks back in history.
            e.preventDefault();
            callbacks.undoMeasurement?.();
            break;

        case 'Delete':
            e.preventDefault();
            callbacks.clearMeasurement?.();
            break;
    }
}

/**
 * Esc - the cascade, in this order, stopping at the first step that acts:
 *   0. immersive mode on -> leave it (see `exitImmersive`: normally the browser
 *      has already done this and never told us);
 *   1. marker card open -> close it (otherwise the visitor is stuck with the
 *      card on screen and no way out through the keyboard);
 *   2. measurement being drawn -> finish the open polyline;
 *   3. tape on -> turn it off.
 *
 * Escape never closes the viewer - that is the close button's job.
 *
 * @returns {boolean} True when one of the steps consumed the key
 */
function runEscapeCascade() {
    const cascade = [
        callbacks.exitImmersive,
        callbacks.closeMarkerPanel,
        callbacks.finishMeasurement,
        callbacks.disableMeasurement
    ];

    for (const step of cascade) {
        if (step?.()) {
            return true;
        }
    }
    return false;
}

// =========================================================================
// HELPERS
// =========================================================================

/**
 * Check if user is typing in an input field.
 * @param {HTMLElement} target - Event target
 * @returns {boolean} True if typing in input
 */
function isTypingInInput(target) {
    if (!target || !target.tagName) return false;
    if (['INPUT', 'TEXTAREA'].includes(target.tagName)) {
        return true;
    }
    if (target.isContentEditable || target.closest?.('[contenteditable="true"]')) {
        return true;
    }
    if (target.closest?.('.ql-editor')) {
        return true;
    }
    return false;
}

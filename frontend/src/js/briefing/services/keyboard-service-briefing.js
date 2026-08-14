// Path: js/briefing/services/keyboard-service-briefing.js

/**
 * @fileoverview Keyboard handling service for Briefing presentation mode.
 * Manages keyboard shortcuts specific to briefing presentations.
 * Disables global keyboard shortcuts when active and re-enables them when deactivated.
 *
 * Follows the same pattern as keyboard_service_360.js and keyboard-service-3d.js.
 *
 * @module briefing/services/keyboard-service-briefing
 */

// =========================================================================
// STATE
// =========================================================================

let isActive = false;
let boundHandler = null;
let globalKeyboardShortcuts = null;

// Callbacks set by the briefing presentation component
let callbacks = {
    nextSlide: null,
    previousSlide: null,
    firstSlide: null,
    lastSlide: null,
    exitPresentation: null,
    toggleFullscreen: null
};

// =========================================================================
// PUBLIC API
// =========================================================================

/**
 * Initialize the keyboard service with the global keyboard shortcuts instance.
 * Must be called before activating the service.
 *
 * @param {KeyboardShortcuts} keyboardShortcutsInstance - Global keyboard shortcuts
 */
export function initKeyboardServiceBriefing(keyboardShortcutsInstance) {
    globalKeyboardShortcuts = keyboardShortcutsInstance;
}

/**
 * Set callback functions for keyboard actions.
 *
 * @param {Object} newCallbacks - Object with callback functions
 * @param {Function} [newCallbacks.nextSlide] - Navigate to next slide
 * @param {Function} [newCallbacks.previousSlide] - Navigate to previous slide
 * @param {Function} [newCallbacks.firstSlide] - Navigate to first slide
 * @param {Function} [newCallbacks.lastSlide] - Navigate to last slide
 * @param {Function} [newCallbacks.exitPresentation] - Exit presentation mode
 * @param {Function} [newCallbacks.toggleFullscreen] - Toggle fullscreen mode
 */
export function setKeyboardCallbacksBriefing(newCallbacks) {
    callbacks = { ...callbacks, ...newCallbacks };
}

/**
 * Activate the briefing keyboard service.
 * Disables global shortcuts and registers briefing-specific handlers.
 */
export function activateKeyboardServiceBriefing() {
    if (isActive) return;

    // Disable global keyboard shortcuts
    if (globalKeyboardShortcuts && globalKeyboardShortcuts.isEnabled()) {
        globalKeyboardShortcuts.disable();
    }

    // Register our handler
    boundHandler = handleKeyDown;
    document.addEventListener('keydown', boundHandler);

    isActive = true;
}

/**
 * Deactivate the briefing keyboard service.
 * Re-enables global shortcuts and removes briefing-specific handlers.
 */
export function deactivateKeyboardServiceBriefing() {
    if (!isActive) return;

    // Remove our handler
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
 * Main keyboard event handler for briefing presentation.
 * @param {KeyboardEvent} e - Keyboard event
 */
function handleKeyDown(e) {
    // Skip if typing in input fields
    if (isTypingInInput(e.target)) return;

    const key = e.key;

    switch (key) {
        // Navigation: Next slide
        case 'ArrowRight':
        case 'd':
        case 'D':
            e.preventDefault();
            callbacks.nextSlide?.();
            break;

        // Navigation: Previous slide
        case 'ArrowLeft':
        case 'a':
        case 'A':
            e.preventDefault();
            callbacks.previousSlide?.();
            break;

        // Navigation: First slide
        case 'Home':
            e.preventDefault();
            callbacks.firstSlide?.();
            break;

        // Navigation: Last slide
        case 'End':
            e.preventDefault();
            callbacks.lastSlide?.();
            break;

        // Exit presentation
        case 'Escape':
            e.preventDefault();
            callbacks.exitPresentation?.();
            break;

        // Toggle fullscreen
        case 'f':
        case 'F':
            e.preventDefault();
            callbacks.toggleFullscreen?.();
            break;

    }
}

/**
 * Check if user is typing in an input field.
 * @param {HTMLElement} target - Event target
 * @returns {boolean} True if typing in input
 */
function isTypingInInput(target) {
    if (['INPUT', 'TEXTAREA'].includes(target.tagName)) {
        return true;
    }
    if (target.isContentEditable || target.closest('[contenteditable="true"]')) {
        return true;
    }
    if (target.closest('.ql-editor')) {
        return true;
    }
    return false;
}

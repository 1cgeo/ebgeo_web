// Path: js/street_view_tool/services/keyboard_service_360.js

/**
 * @fileoverview Keyboard handling service for Street View 360.
 * Manages keyboard shortcuts specific to the 360 viewer.
 * Disables global keyboard shortcuts when active and re-enables them when deactivated.
 */

import { isCurrentMapLockedSync } from '../../store/index.js';

// Dynamic imports to avoid static import conflict with viewer's dynamic import
let sidebarModule = null;

async function getSidebarModule() {
    if (!sidebarModule) {
        sidebarModule = await import('../components/streetview-sidebar.js');
    }
    return sidebarModule;
}

// =========================================================================
// STATE
// =========================================================================

let isActive = false;
let boundHandler = null;
let globalKeyboardShortcuts = null;

// Callbacks set by street_view_viewer.js
let callbacks = {
    rotateCamera: null,
    zoomCamera: null,
    toggleMarkerTool: null,
    saveOrientation: null,
    closeViewer: null,
    deselectPOI: null,
    isToolActive: null
};

// =========================================================================
// ROTATION AMOUNTS (degrees per keypress)
// =========================================================================

const ROTATION_STEP = 5;
const ZOOM_STEP = 5;

// =========================================================================
// PUBLIC API
// =========================================================================

/**
 * Initialize the keyboard service with the global keyboard shortcuts instance.
 * @param {KeyboardShortcuts} keyboardShortcutsInstance - Global keyboard shortcuts
 */
export function initKeyboardService360(keyboardShortcutsInstance) {
    globalKeyboardShortcuts = keyboardShortcutsInstance;
}

/**
 * Set callback functions for keyboard actions.
 * @param {Object} newCallbacks - Object with callback functions
 */
export function setKeyboardCallbacks(newCallbacks) {
    callbacks = { ...callbacks, ...newCallbacks };
}

/**
 * Activate the 360 keyboard service.
 * Disables global shortcuts and registers 360-specific handlers.
 */
export function activateKeyboardService360() {
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
 * Deactivate the 360 keyboard service.
 * Re-enables global shortcuts and removes 360-specific handlers.
 */
export function deactivateKeyboardService360() {
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

/**
 * Check if the keyboard service is currently active.
 * @returns {boolean}
 */
export function isKeyboardService360Active() {
    return isActive;
}

// =========================================================================
// KEYBOARD HANDLER
// =========================================================================

/**
 * Main keyboard event handler for 360 viewer.
 * @param {KeyboardEvent} e - Keyboard event
 */
async function handleKeyDown(e) {
    // Skip if typing in input fields
    if (isTypingInInput(e.target)) return;

    const key = e.key;

    switch (key) {
        case 'Escape':
            e.preventDefault();
            handleEscape();
            break;

        case 'ArrowLeft':
        case 'a':
        case 'A':
            e.preventDefault();
            callbacks.rotateCamera?.('left', ROTATION_STEP);
            break;

        case 'ArrowRight':
        case 'd':
        case 'D':
            e.preventDefault();
            callbacks.rotateCamera?.('right', ROTATION_STEP);
            break;

        case 'ArrowUp':
        case 'w':
        case 'W':
            e.preventDefault();
            callbacks.rotateCamera?.('up', ROTATION_STEP);
            break;

        case 'ArrowDown':
        case 's':
        case 'S':
            e.preventDefault();
            callbacks.rotateCamera?.('down', ROTATION_STEP);
            break;

        case '+':
        case '=':
            e.preventDefault();
            callbacks.zoomCamera?.('in', ZOOM_STEP);
            break;

        case '-':
            e.preventDefault();
            callbacks.zoomCamera?.('out', ZOOM_STEP);
            break;

        case 'm':
        case 'M':
            e.preventDefault();
            if (!isCurrentMapLockedSync()) callbacks.toggleMarkerTool?.();
            break;

        case 'o':
        case 'O':
            e.preventDefault();
            if (!isCurrentMapLockedSync()) callbacks.saveOrientation?.();
            break;
    }
}

/**
 * Handle Escape key with priority order.
 * 1. Help popup open → close popup
 * 2. Tool active → deactivate tool
 * 3. POI selected → deselect POI
 * 4. Otherwise → close viewer
 */
async function handleEscape() {
    const sidebar = await getSidebarModule();

    // Priority 1: Close help popup
    if (sidebar.isHelpPopupOpen360()) {
        // The popup close is handled by the document click listener in streetview-sidebar.js
        // We just need to dispatch a click event outside the popup
        document.body.click();
        return;
    }

    // Priority 2: Deactivate current tool
    if (callbacks.isToolActive?.()) {
        sidebar.deactivateCurrentTool360();
        return;
    }

    // Priority 3: Deselect POI
    // Check if there's a selected POI before trying to close
    if (callbacks.deselectPOI?.()) {
        // deselectPOI returns true if something was deselected
        return;
    }

    // Priority 4: Close the viewer
    callbacks.closeViewer?.();
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

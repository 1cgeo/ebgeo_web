// Path: js/3d_models_viewer_tool/services/keyboard-service-3d.js

/**
 * @fileoverview Keyboard handling service for 3D Viewer.
 * Manages keyboard shortcuts specific to the Cesium 3D viewer.
 * Disables global keyboard shortcuts when active and re-enables them when deactivated.
 *
 * Follows the same pattern as keyboard_service_360.js for consistency.
 *
 * @module 3d_models_viewer_tool/services/keyboard-service-3d
 */

import { showConfirm } from '../../modals/index.js';

// =========================================================================
// STATE
// =========================================================================

let isActive = false;
let boundHandler = null;
let globalKeyboardShortcuts = null;

// Callbacks set by the 3D viewer
let callbacks = {
    activateTool: null,      // (toolId) => void
    deactivateCurrentTool: null,
    deleteSelectedFeature: null,
    isHelpPopupOpen: null,   // () => boolean
    closeHelpPopup: null
};

// =========================================================================
// TOOL MAPPING
// =========================================================================

/**
 * Map keys to 3D tool IDs.
 * @type {Object<string, string>}
 */
const TOOL_KEY_MAPPING = {
    'v': 'visualizacao',   // Visibility analysis
    'd': 'distancia',      // Measure distance
    'a': 'area',           // Measure area
    'm': 'add-marker-3d'   // Add marker
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
export function initKeyboardService3D(keyboardShortcutsInstance) {
    globalKeyboardShortcuts = keyboardShortcutsInstance;
}

/**
 * Set callback functions for keyboard actions.
 *
 * @param {Object} newCallbacks - Object with callback functions
 * @param {Function} [newCallbacks.activateTool] - Called with toolId to activate a tool
 * @param {Function} [newCallbacks.deactivateCurrentTool] - Called to deactivate current tool
 * @param {Function} [newCallbacks.deleteSelectedFeature] - Called to delete selected feature
 * @param {Function} [newCallbacks.isHelpPopupOpen] - Returns true if help popup is open
 * @param {Function} [newCallbacks.closeHelpPopup] - Called to close help popup
 */
export function setKeyboardCallbacks3D(newCallbacks) {
    callbacks = { ...callbacks, ...newCallbacks };
}

/**
 * Activate the 3D keyboard service.
 * Disables global shortcuts and registers 3D-specific handlers.
 */
export function activateKeyboardService3D() {
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
 * Deactivate the 3D keyboard service.
 * Re-enables global shortcuts and removes 3D-specific handlers.
 */
export function deactivateKeyboardService3D() {
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
export function isKeyboardService3DActive() {
    return isActive;
}

// =========================================================================
// KEYBOARD HANDLER
// =========================================================================

/**
 * Main keyboard event handler for 3D viewer.
 * @param {KeyboardEvent} e - Keyboard event
 */
async function handleKeyDown(e) {
    // Skip if typing in input fields
    if (isTypingInInput(e.target)) return;

    const key = e.key.toLowerCase();

    // Handle Escape key with priority
    if (key === 'escape') {
        e.preventDefault();
        handleEscape();
        return;
    }

    // Handle Delete/Backspace for deleting features
    if (key === 'delete' || key === 'backspace') {
        e.preventDefault();
        await handleDelete();
        return;
    }

    // Handle tool activation shortcuts
    const toolId = TOOL_KEY_MAPPING[key];
    if (toolId) {
        e.preventDefault();
        callbacks.activateTool?.(toolId);
    }
}

/**
 * Handle Escape key with priority order.
 * 1. Help popup open → close popup
 * 2. Tool active → deactivate tool
 */
function handleEscape() {
    // Priority 1: Close help popup
    if (callbacks.isHelpPopupOpen?.()) {
        callbacks.closeHelpPopup?.();
        return;
    }

    // Priority 2: Deactivate current tool
    callbacks.deactivateCurrentTool?.();
}

/**
 * Handle Delete/Backspace key to delete selected features.
 */
async function handleDelete() {
    await callbacks.deleteSelectedFeature?.();
}

/**
 * Confirms and deletes the currently selected 3D feature.
 * Checks for selected marker, measurement, or viewshed.
 * Exposed for external use (e.g., via callbacks).
 */
export async function confirmAndDelete3DFeature() {
    // Dynamically import 3D tool modules to avoid loading them when not needed
    const [markerTool, measurementTool, viewshedTool] = await Promise.all([
        import('../tools/marker_tool_3d.js'),
        import('../tools/measurement_tool_3d.js'),
        import('../tools/viewshed_tool_3d.js')
    ]);

    // Check for selected marker
    const selectedMarkerId = markerTool.getSelectedMarkerId();
    if (selectedMarkerId) {
        const confirmed = await showConfirm('Deletar este marcador?', {
            message: 'Esta ação não pode ser desfeita.',
            destructive: true
        });
        if (confirmed) {
            await markerTool.deleteMarker(selectedMarkerId);
        }
        return;
    }

    // Check for selected measurement
    const selectedMeasurementId = measurementTool.getSelectedMeasurementId();
    if (selectedMeasurementId) {
        const confirmed = await showConfirm('Deletar esta medição?', {
            message: 'Esta ação não pode ser desfeita.',
            destructive: true
        });
        if (confirmed) {
            await measurementTool.deleteMeasurement(selectedMeasurementId);
        }
        return;
    }

    // Check for selected viewshed
    const selectedViewshedId = viewshedTool.getSelectedViewshedId();
    if (selectedViewshedId) {
        const confirmed = await showConfirm('Deletar esta análise de visibilidade?', {
            message: 'Esta ação não pode ser desfeita.',
            destructive: true
        });
        if (confirmed) {
            await viewshedTool.deleteViewshed(selectedViewshedId);
        }
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

// Path: js/street_view_tool/components/streetview-sidebar.js

/**
 * @fileoverview Toolbar and UI management for Street View 360.
 * Handles toolbar visibility, button states, active tool chip, and help popup.
 * Based on the 3D viewer toolbar pattern from map_3d.js.
 */

// =========================================================================
// STATE
// =========================================================================

let isInitialized = false;
let currentActiveTool = null;
let helpPopupOpen = false;

// DOM element references (cached after init)
const elements = {
    toolbar: null,
    activeToolChip: null,
    activeToolChipName: null,
    activeToolChipClose: null,
    helpPopup: null,
    helpButton: null,
    addMarkerButton: null,
    screenshotButton: null,
    saveOrientationButton: null,
    clearOrientationButton: null
};

// =========================================================================
// INITIALIZATION
// =========================================================================

/**
 * Initialize toolbar 360 event listeners and cache DOM elements.
 * Should be called once when the 360 viewer module loads.
 */
export function initToolbar360() {
    if (isInitialized) return;

    // Cache DOM elements
    elements.toolbar = document.getElementById('toolbar-360');
    elements.activeToolChip = document.getElementById('active-tool-chip-360');
    elements.activeToolChipName = document.getElementById('active-tool-chip-360-name');
    elements.activeToolChipClose = document.getElementById('active-tool-chip-360-close');
    elements.helpPopup = document.getElementById('nav-help-popup-360');
    elements.helpButton = document.getElementById('help-360');
    elements.addMarkerButton = document.getElementById('add-marker-360');
    elements.screenshotButton = document.getElementById('screenshot-360');
    elements.saveOrientationButton = document.getElementById('salvar-orientacao-360');
    elements.clearOrientationButton = document.getElementById('limpar-orientacao-360');

    // Setup help popup
    if (elements.helpButton && elements.helpPopup) {
        elements.helpButton.addEventListener('click', toggleHelpPopup);
        setupHelpPopupTabs();
    }

    // Setup active tool chip close button
    if (elements.activeToolChipClose) {
        elements.activeToolChipClose.addEventListener('click', () => {
            deactivateCurrentTool360();
        });
    }

    // Close help popup when clicking outside
    document.addEventListener('click', (e) => {
        if (helpPopupOpen && elements.helpPopup && elements.helpButton) {
            if (!elements.helpPopup.contains(e.target) && !elements.helpButton.contains(e.target)) {
                closeHelpPopup();
            }
        }
    });

    isInitialized = true;
}

/**
 * Setup tab switching for help popup.
 */
function setupHelpPopupTabs() {
    const tabs = elements.helpPopup?.querySelectorAll('.nav-help-tab-360');
    const panels = elements.helpPopup?.querySelectorAll('.nav-help-panel-360');

    if (!tabs || !panels) return;

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const targetPanel = tab.dataset.tab;

            // Update tab states
            tabs.forEach(t => {
                t.classList.remove('active');
                t.setAttribute('aria-selected', 'false');
            });
            tab.classList.add('active');
            tab.setAttribute('aria-selected', 'true');

            // Update panel visibility
            panels.forEach(p => {
                p.classList.toggle('active', p.dataset.panel === targetPanel);
            });
        });
    });
}

// =========================================================================
// TOOLBAR VISIBILITY
// =========================================================================

/**
 * Show the 360 toolbar.
 * Called when opening the 360 viewer.
 */
export function showToolbar360() {
    if (elements.toolbar) {
        elements.toolbar.style.display = '';
    }
}

/**
 * Hide the 360 toolbar.
 * Called when closing the 360 viewer.
 */
export function hideToolbar360() {
    if (elements.toolbar) {
        elements.toolbar.style.display = 'none';
    }
    // Also hide related UI elements
    hideActiveToolChip360();
    closeHelpPopup();
}

// =========================================================================
// ACTIVE TOOL CHIP
// =========================================================================

/**
 * Show the active tool chip with the specified tool name.
 * @param {string} toolName - Display name of the active tool
 */
export function showActiveToolChip360(toolName) {
    currentActiveTool = toolName;

    if (elements.activeToolChip && elements.activeToolChipName) {
        elements.activeToolChipName.textContent = toolName;
        elements.activeToolChip.style.display = '';
    }
}

/**
 * Hide the active tool chip.
 */
export function hideActiveToolChip360() {
    currentActiveTool = null;

    if (elements.activeToolChip) {
        elements.activeToolChip.style.display = 'none';
    }
}

/**
 * Get the currently active tool name.
 * @returns {string|null} The active tool name or null
 */
export function getCurrentActiveTool360() {
    return currentActiveTool;
}

// =========================================================================
// TOOL DEACTIVATION
// =========================================================================

/**
 * Deactivate the currently active 360 tool.
 * This is called when ESC is pressed or the chip close button is clicked.
 */
export function deactivateCurrentTool360() {
    if (!currentActiveTool) return;

    // Remove active state from buttons
    if (elements.addMarkerButton) {
        elements.addMarkerButton.classList.remove('active');
    }

    // Hide the chip
    hideActiveToolChip360();

    // Emit event for the navigator to handle
    // The actual tool deactivation logic is in the navigator
    const event = new CustomEvent('tool360:deactivate', {
        detail: { tool: currentActiveTool }
    });
    document.dispatchEvent(event);
}

// =========================================================================
// ORIENTATION BUTTON STATE
// =========================================================================

/**
 * Update orientation button visibility based on saved state.
 * @param {boolean} hasSaved - Whether orientation is saved for current photo
 */
export function setOrientationButtonState(hasSaved) {
    if (elements.saveOrientationButton) {
        elements.saveOrientationButton.style.display = hasSaved ? 'none' : '';
    }
    if (elements.clearOrientationButton) {
        elements.clearOrientationButton.style.display = hasSaved ? '' : 'none';
    }
}

// =========================================================================
// HELP POPUP
// =========================================================================

/**
 * Toggle the help popup visibility.
 */
function toggleHelpPopup() {
    if (helpPopupOpen) {
        closeHelpPopup();
    } else {
        openHelpPopup();
    }
}

/**
 * Open the help popup.
 */
function openHelpPopup() {
    if (elements.helpPopup && elements.helpButton) {
        elements.helpPopup.hidden = false;
        elements.helpButton.setAttribute('aria-expanded', 'true');
        helpPopupOpen = true;
    }
}

/**
 * Close the help popup.
 */
function closeHelpPopup() {
    if (elements.helpPopup && elements.helpButton) {
        elements.helpPopup.hidden = true;
        elements.helpButton.setAttribute('aria-expanded', 'false');
        helpPopupOpen = false;
    }
}

/**
 * Check if help popup is currently open.
 * @returns {boolean}
 */
export function isHelpPopupOpen360() {
    return helpPopupOpen;
}

// =========================================================================
// BUTTON EVENT REGISTRATION
// =========================================================================

/**
 * Register a click handler for the add marker button.
 * @param {Function} handler - Click handler function
 */
export function onAddMarkerClick(handler) {
    if (elements.addMarkerButton) {
        elements.addMarkerButton.addEventListener('click', handler);
    }
}

/**
 * Register a click handler for the screenshot button.
 * @param {Function} handler - Click handler function
 */
export function onScreenshotClick(handler) {
    if (elements.screenshotButton) {
        elements.screenshotButton.addEventListener('click', handler);
    }
}

/**
 * Register a click handler for the save orientation button.
 * @param {Function} handler - Click handler function
 */
export function onSaveOrientationClick(handler) {
    if (elements.saveOrientationButton) {
        elements.saveOrientationButton.addEventListener('click', handler);
    }
}

/**
 * Register a click handler for the clear orientation button.
 * @param {Function} handler - Click handler function
 */
export function onClearOrientationClick(handler) {
    if (elements.clearOrientationButton) {
        elements.clearOrientationButton.addEventListener('click', handler);
    }
}

/**
 * Set the active state of the marker button.
 * @param {boolean} active - Whether the button should appear active
 */
export function setMarkerButtonActive(active) {
    if (elements.addMarkerButton) {
        elements.addMarkerButton.classList.toggle('active', active);
    }
}

// =========================================================================
// CLEANUP
// =========================================================================

/**
 * Cleanup toolbar state when viewer closes.
 * Resets button states but doesn't remove event listeners.
 */
export function cleanupToolbar360() {
    hideToolbar360();
    setOrientationButtonState(false);
    setMarkerButtonActive(false);
}

// Path: js/utilities/streetview360-state.js

/**
 * @fileoverview Lightweight utility for checking Street View 360 viewer state via DOM.
 * This avoids importing the full street_view_viewer.js module which causes circular dependencies.
 */

/**
 * Checks if the Street View 360 viewer is currently visible/open.
 * Uses DOM-based check to avoid circular dependency with street_view_viewer.js
 * @returns {boolean} True if viewer is visible
 */
export function isStreetView360Open() {
    const streetViewContainer = document.getElementById('street-view-container');
    return streetViewContainer && streetViewContainer.style.display !== 'none';
}

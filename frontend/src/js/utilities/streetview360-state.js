// Path: js/utilities/streetview360-state.js
/**
 * @fileoverview Lightweight DOM-based check for Street View 360 viewer visibility.
 * Avoids importing street_view_viewer.js which would cause circular dependencies.
 */

/**
 * @returns {boolean} True if the 360 viewer is currently visible
 */
export function isStreetView360Open() {
    const container = document.getElementById('street-view-container');
    return container !== null && container.style.display !== 'none';
}

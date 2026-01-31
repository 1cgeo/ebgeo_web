// Path: js/utilities/viewer3d-state.js

/**
 * @fileoverview Lightweight utility for checking 3D viewer state via DOM.
 * This avoids importing the full map_3d.js module which causes circular dependencies.
 */

/**
 * Checks if the 3D viewer is currently visible/open.
 * Uses DOM-based check to avoid circular dependency with map_3d.js
 * @returns {boolean} True if viewer is visible
 */
export function isViewer3DOpen() {
    const map3dContainer = document.getElementById('map-3d-container');
    return map3dContainer && map3dContainer.style.display !== 'none';
}

// Path: js/utilities/viewer3d-state.js
/**
 * @fileoverview Lightweight DOM-based check for 3D viewer visibility.
 * Avoids importing map_3d.js which would cause circular dependencies.
 */

/**
 * @returns {boolean} True if the 3D viewer is currently visible
 */
export function isViewer3DOpen() {
    const container = document.getElementById('map-3d-container');
    return container !== null && container.style.display !== 'none';
}

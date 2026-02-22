// Path: js/street_view_tool/index.js

/**
 * Public API for Street View 360 Tool
 *
 * NOTE: street_view_viewer.js, navigation/*, and services/* are NOT exported here
 * to allow proper lazy loading. They should be imported dynamically where needed:
 *   const { openViewer360WithPhoto, closeViewer360 } = await import('./street_view_viewer.js');
 */

export { default as AddStreetViewControl } from './add_street_view_control.js';

// Re-export cleanup function that can be called synchronously for app cleanup
// This is a lightweight wrapper that dynamically imports the actual implementation
export async function cleanupStreetViewFeatures() {
    const viewer = await import('./street_view_viewer.js');
    return viewer.cleanupStreetViewFeatures();
}

// Re-export state check function
export async function isStreetView360Open() {
    const viewer = await import('./street_view_viewer.js');
    return viewer.isStreetView360Open();
}

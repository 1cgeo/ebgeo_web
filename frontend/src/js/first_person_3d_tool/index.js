// Path: js/first_person_3d_tool/index.js

/**
 * Public API for the First-Person 3D Tool (Gaussian splatting).
 *
 * NOTE: first_person_viewer.js, walk/*, components/*, tools/* and services/*
 * are NOT re-exported here, so the viewer and its engine stay out of the entry
 * bundle. Import them dynamically where they are needed:
 *   const { openFirstPersonViewer } = await import('./first_person_viewer.js');
 *
 * Mirrors `street_view_tool/index.js`: only async wrappers, no static import of
 * the viewer. `scene-config.service.js` is deliberately absent too — it is
 * light, but it is imported directly by the catalog, the search and the 3D
 * control, which have no reason to pull this barrel.
 */

/**
 * Tear down the first-person viewer and release its GPU resources.
 * Safe to call when the viewer was never opened.
 * @returns {Promise<void>}
 */
export async function cleanupFirstPersonFeatures() {
    const viewer = await import('./first_person_viewer.js');
    return viewer.cleanupFirstPersonFeatures();
}

/**
 * Is the first-person viewer currently open?
 * @returns {Promise<boolean>} True while it is on screen
 */
export async function isFirstPersonViewerOpen() {
    const viewer = await import('./first_person_viewer.js');
    return viewer.isFirstPersonViewerOpen();
}

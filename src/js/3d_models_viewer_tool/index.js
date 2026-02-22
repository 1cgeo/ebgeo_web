// Path: js/3d_models_viewer_tool/index.js

/**
 * Public API for 3D Models Viewer Tool
 *
 * NOTE: map_3d.js and tools/* are NOT exported here to allow proper lazy loading.
 * They should be imported dynamically where needed:
 *   const { openViewerWithTileset, closeViewer } = await import('./map_3d.js');
 */

export { default as Add3DModelsViewerControl } from './add_3d_models_viewer_control.js';

// Re-export cleanup function that can be called synchronously for app cleanup
// This is a lightweight wrapper that dynamically imports the actual implementation
export async function cleanup3DFeatures() {
    const map3d = await import('./map_3d.js');
    return map3d.cleanup3DFeatures();
}

// Path: js/3d_models_viewer_tool/tools/index.js

/**
 * 3D Tools are lazy-loaded directly by map_3d.js
 * This barrel file is intentionally empty to prevent static imports
 * that would break code splitting.
 *
 * Tools available (import dynamically):
 * - mouse_coordinates_3d.js: initMouseCoordinates3D, cleanupMouseCoordinates3D
 * - screenshot_tool.js: takeScreenshot, captureScreenshotAsDataUrl
 * - marker_tool_3d.js: marker placement and persistence
 * - presence_cursor_3d.js: peers' live cursors inside the scene (initPresenceCursor3D,
 *   renderRemoteCursors3D, resetRemoteCursors3D, cleanupPresenceCursor3D)
 * - measurement_tool_3d.js: distance/area measurements and persistence
 * - viewshed_tool_3d.js: viewshed analysis and persistence
 * - viewshed.js: (deprecated) legacy viewshed - use viewshed_tool_3d.js
 */

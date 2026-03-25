// Path: js/3d_models_viewer_tool/tools/viewshed.js

/**
 * @fileoverview Legacy viewshed module - superseded by viewshed_tool_3d.js.
 * Kept only for backward compatibility. All functionality has been migrated
 * to viewshed_tool_3d.js which provides persistence, selection, and panel integration.
 * @deprecated Use viewshed_tool_3d.js instead.
 */

let arrViewField = [];

const viewModel = { verticalAngle: 120, horizontalAngle: 120, distance: 10 };

/**
 * Adds a viewshed analysis field to the 3D map.
 * @deprecated Use viewshed_tool_3d.js activateViewshedTool() instead.
 * @param {Cesium.Viewer} map - The Cesium viewer instance
 */
function addViewField(map) {
    const e = new Cesium.ViewShed3D(map, {
        horizontalAngle: Number(viewModel.horizontalAngle),
        verticalAngle: Number(viewModel.verticalAngle),
        distance: Number(viewModel.distance),
        calback: function () {
            viewModel.distance = e.distance;
        }
    });
    arrViewField.push(e);
}

/**
 * Clears all viewshed analysis fields from the map.
 * @deprecated Use viewshed_tool_3d.js clearAllViewField() instead.
 */
function clearAllViewField() {
    for (const viewField of arrViewField) {
        viewField.destroy();
    }
    arrViewField = [];
}

export { addViewField, clearAllViewField };

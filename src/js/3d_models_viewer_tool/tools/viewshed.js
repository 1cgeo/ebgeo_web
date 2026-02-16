// Path: js/3d_models_viewer_tool/tools/viewshed.js

// ===== MODULE STATE =====
let arrViewField = [];
const viewModel = { verticalAngle: 120, horizontalAngle: 120, distance: 10 };

// ===== PUBLIC API =====

/**
 * Adds a viewshed analysis field to the 3D map
 * @param {Cesium.Viewer} map - The Cesium viewer instance
 */
const addViewField = (map) => {
    const e = new Cesium.ViewShed3D(map, {
        horizontalAngle: Number(viewModel.horizontalAngle),
        verticalAngle: Number(viewModel.verticalAngle),
        distance: Number(viewModel.distance),
        calback: function () {
            viewModel.distance = e.distance
        }
    });
    arrViewField.push(e)
}

/**
 * Clears all viewshed analysis fields from the map
 */
const clearAllViewField = () => {
    for (let e = 0, i = arrViewField.length; e < i; e++) {
        arrViewField[e].destroy()
    }
    arrViewField = []
}


export {
    addViewField,
    clearAllViewField
}

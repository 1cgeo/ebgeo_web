// Path: js\control_3d\viewshed.js
import config from '../config.js';

var arrViewField = [];
var viewModel = { 
    verticalAngle: config.map3d.viewshed.verticalAngle, 
    horizontalAngle: config.map3d.viewshed.horizontalAngle, 
    distance: config.map3d.viewshed.distance 
};

const addViewField = (map) => {
    var e = new Cesium.ViewShed3D(map, {
        horizontalAngle: Number(viewModel.horizontalAngle),
        verticalAngle: Number(viewModel.verticalAngle),
        distance: Number(viewModel.distance),
        calback: function () {
            viewModel.distance = e.distance
        }
    });
    arrViewField.push(e)
}

const clearAllViewField = () => {
    for (var e = 0, i = arrViewField.length; e < i; e++) {
        arrViewField[e].destroy()
    }
    arrViewField = []
}


export {
    addViewField,
    clearAllViewField
}
var arrViewField = [];
var viewModel = { verticalAngle: 120, horizontalAngle: 150, distance: 10 };

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
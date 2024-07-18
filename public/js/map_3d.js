Cesium.Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJkMzViMDllOS0zMDNhLTRlNjgtODRmYi1iYzQyNmY3ZmEyYWIiLCJpZCI6MjA1ODQ1LCJpYXQiOjE3MTE5ODI0Mzd9.BhKXygD0YSiMuUVD1o7AfOmWKCOlS3lCMQuQMViPQac';
var viewer = new Cesium.Viewer("map-3d", {
    infoBox: true,
    shouldAnimate: true,
    vrButton: true,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    baseLayerPicker: true,
    navigationHelpButton: false,
    animation: false,
    timeline: false,
    fullscreenButton: false,
});

for (let tilesetSetup of [
    {
        url: "/3d/AMAN/tileset.json",

        heightOffset: -360, //-360 para elipsoide 40 para terreno,
        id: "AMAN",
        default: true,
    },
    {
        url: "/3d/ESA/tileset.json",
        heightOffset: -770,
        id: "ESA",

    },
    {
        url: "/3d/PCL/tileset.json",
        heightOffset: -387,
        id: "PCL",

    },

]) {
    var tileset = new Cesium.Cesium3DTileset({
        url: tilesetSetup.url,
        maximumScreenSpaceError: 0,
        maximumMemoryUsage: 0
    })
    var tilesets = viewer.scene.primitives.add(tileset);
    if (tilesetSetup.default) {
        viewer.flyTo(tileset, {
            offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-60), 0)
        })
    }
    //   const cartographic = Cesium.Cartographic.fromCartesian(
    // tileset.boundingSphere.center
    // );
    tileset.readyPromise.then(function (tileset) {
        const heightOffset = tilesetSetup.heightOffset;
        const modelMatrix = tileset.modelMatrix;
        const boundingSphere = tileset.boundingSphere;
        const cartographic = Cesium.Cartographic.fromCartesian(boundingSphere.center);
        const surface = Cesium.Cartesian3.fromRadians(cartographic.longitude, cartographic.latitude, 0.0);
        const offset = Cesium.Cartesian3.fromRadians(cartographic.longitude, cartographic.latitude, heightOffset);
        const translation = Cesium.Cartesian3.subtract(offset, surface, new Cesium.Cartesian3());
        tileset.modelMatrix = Cesium.Matrix4.fromTranslation(translation);
    }).otherwise(function (error) {
        // Handle loading errors here
        console.error("Error loading tileset:", error);
    });
    // Nome das imagens para o Fly To
    if (tilesetSetup.id === "AMAN") {
        var tilesetAMAN = tileset;
    } else if (tilesetSetup.id === "ESA") {
        var tilesetESA = tileset;
    } else if (tilesetSetup.id === "PCL") {
        var tilesetPCL = tileset;
    }
}


const scene = viewer.scene;

//ELEVACAO
var annotations
const handler = new Cesium.ScreenSpaceEventHandler(viewer.canvas);
handler.setInputAction((movement) => {
    if (!activeEle) return
    if (!annotations) annotations = scene.primitives.add(new Cesium.LabelCollection());
    const feature = scene.pick(movement.position);
    if (!Cesium.defined(feature)) {
        return;
    }

    annotate(movement, feature);
}, Cesium.ScreenSpaceEventType.RIGHT_CLICK);
function annotate(movement, feature) {
    if (scene.pickPositionSupported) {
        const cartesian = scene.pickPosition(movement.position);
        if (Cesium.defined(cartesian)) {
            const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
            const height = `${(cartographic.height + 393).toFixed(2)} m`;

            annotations.add({
                position: cartesian,
                text: height,
                showBackground: true,
                font: "14px monospace",
                horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
            });
        }
    }
}


//TOOLS
var activeEle = false
var arrViewField = [];
var viewModel = { verticalAngle: 120, horizontalAngle: 150, distance: 10 };

function addViewField() {
    var e = new Cesium.ViewShed3D(viewer, {
        horizontalAngle: Number(viewModel.horizontalAngle),
        verticalAngle: Number(viewModel.verticalAngle),
        distance: Number(viewModel.distance),
        calback: function () {
            viewModel.distance = e.distance
        }
    });
    arrViewField.push(e)
}

function clearAllViewField() {
    for (var e = 0, i = arrViewField.length; e < i; e++) {
        arrViewField[e].destroy()
    }
    arrViewField = []
}

const removeAllTools = () => {
    activeEle = false
    measure._drawLayer.entities.removeAll();
    scene.primitives.remove(annotations)
    annotations = null
    clearAllViewField()
}

let clampToGround = true
let measure = new Cesium.Measure(viewer)
$('.button-tool-3d').on('click', function () {
    let text = $(this).attr('id')
    if (text) {
        removeAllTools()
        $(".tools-3d-bar a").removeClass('active-tool-3d')
        $(this).addClass('active-tool-3d')
        switch (text) {
            // case '不贴地': clampToGround = false; break;
            case 'elevacao':
                activeEle = true
                break;
            case 'distancia':
                measure.drawLineMeasureGraphics({ clampToGround: clampToGround, callback: () => { } });
                break;
            case 'area':
                measure.drawAreaMeasureGraphics({ clampToGround: clampToGround, callback: () => { } });
                break;
            // case '三角量测': measure.drawTrianglesMeasureGraphics({ callback: () => { } }); break;
            case 'visualizacao':
                addViewField()
                break;
            case 'btnAMAN':
                // Código de Fly To 
                viewer.flyTo(tilesetAMAN, {
                    offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-60), 0)
                });
                break;
            case 'btnESA':
                viewer.flyTo(tilesetESA, {
                    offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-60), 0)
                });
                break;
            case 'btnPCL':
                viewer.flyTo(tilesetPCL, {
                    offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-60), 0)
                });
                break;
            // case 'btnCoordenadas':
            //     ativarObterCoordenadas(); // Chama a função para ativar o modo
            //     break;
        }
    }
});


$('input[type=radio][name=modelo-3d]').change(function () {
    let text = this.value
    if (text) {
        removeAllTools()
        switch (text) {
            case 'aman':
                viewer.flyTo(tilesetAMAN, {
                    offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-60), 0)
                });
                break;
            case 'esa':
                viewer.flyTo(tilesetESA, {
                    offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-60), 0)
                });
                break;
            case 'aman-pcl':
                viewer.flyTo(tilesetPCL, {
                    offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-60), 0)
                });
                break;
        }
    }
});


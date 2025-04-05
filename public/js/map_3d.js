// Path: js\map_3d.js
import { map } from './control_3d/map.js'
import { load3dTileset } from './control_3d/3d_tileset.js'
import { addViewField, clearAllViewField } from './control_3d/viewshed.js';
import { initIdentifyTool, toggleIdentifyTool } from './control_3d/identify_tool.js';

//MODELOS 3D
for (let tilesetSetup of [
    {
        url: "/3d/AMAN/tileset.json",

        heightOffset: 50, //-360 para elipsoide 40 para terreno,
        id: "AMAN",
        default: true,
        locate: {
            lat: -22.455921,
            lon: -44.449655,
            height: 2200
        }
    },
    {
        url: "/3d/ESA/tileset.json",
        heightOffset: 75,
        id: "ESA",
        locate: {
            lon: -45.25666459926732,
            lat: -21.703613735103637,
            height: 1500
        }

    },
    {
        url: "/3d/PCL/tileset.json",
        heightOffset: 35,
        id: "PCL",
        locate: {
            lon: -44.47332385414955,
            lat: -22.43976556982974,
            height: 1000
        }

    },

]) {
    let tileset = load3dTileset(map, tilesetSetup)
    // Nome das imagens para o Fly To
    if (tilesetSetup.id === "AMAN") {
        var tilesetAMAN = tilesetSetup.locate;
    } else if (tilesetSetup.id === "ESA") {
        var tilesetESA = tilesetSetup.locate;
    } else if (tilesetSetup.id === "PCL") {
        var tilesetPCL = tilesetSetup.locate;
    }
}


const scene = map.scene;

//TOOLS
const removeAllTools = () => {
    measure._drawLayer.entities.removeAll();
    measure.removeDrawLineMeasureGraphics()
    measure.removeDrawAreaMeasureGraphics()
    clearAllViewField()
}

let clampToGround = true
const measure = new Cesium.Measure(map)

initIdentifyTool();

export function activeTool() {
    let text = $(this).attr('id')
    if (text) {
        removeAllTools()
        switch (text) {
            case 'distancia':
                measure.drawLineMeasureGraphics({ clampToGround: clampToGround, callback: () => { } });
                break;
            case 'area':
                measure.drawAreaMeasureGraphics({ clampToGround: clampToGround, callback: () => { } });
                break;
            case 'visualizacao':
                addViewField(map)
                break;
            case 'identify-tool':
                toggleIdentifyTool();
                break;
        }
    }
}


export function handleClickGoTo() {
    let text = $(this).attr('id')
    if (text) {
        removeAllTools()
        switch (text) {
            case 'aman':
                var { lat, lon, height } = tilesetAMAN
                break;
            case 'esa':
                var { lat, lon, height } = tilesetESA
                break;
            case 'aman-pcl':
                var { lat, lon, height } = tilesetPCL

                break;
        }
        map.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(lon, lat, height),
        });
    }
}

$('#locate-3d-container button').click(handleClickGoTo);

var handler = new Cesium.ScreenSpaceEventHandler(map.canvas);
handler.setInputAction(function (event) {
    var scratchRectangle = new Cesium.Rectangle();
    var pickedPosition = map.scene.pickPosition(event.position);
    if (Cesium.defined(pickedPosition)) {
        var carto = Cesium.Ellipsoid.WGS84.cartesianToCartographic(pickedPosition);
        var lon = Cesium.Math.toDegrees(carto.longitude);
        var lat = Cesium.Math.toDegrees(carto.latitude);
    }
}, Cesium.ScreenSpaceEventType.LEFT_CLICK);

import { map } from './control_3d/map.js'
import { load3dTileset } from './control_3d/3d_tileset.js'
import { addViewField, clearAllViewField } from './control_3d/viewshed.js';

//MODELOS 3D
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
    let tileset = load3dTileset(map, tilesetSetup)
    // Nome das imagens para o Fly To
    if (tilesetSetup.id === "AMAN") {
        var tilesetAMAN = tileset;
    } else if (tilesetSetup.id === "ESA") {
        var tilesetESA = tileset;
    } else if (tilesetSetup.id === "PCL") {
        var tilesetPCL = tileset;
    }
}


const scene = map.scene;

//TOOLS
const removeAllTools = () => {
    measure._drawLayer.entities.removeAll();
    clearAllViewField()
}

let clampToGround = true
let measure = new Cesium.Measure(map)
$('.button-tool-3d').on('click', function () {
    let text = $(this).attr('id')
    if (text) {
        removeAllTools()
        $(".tools-3d-bar a").removeClass('active-tool-3d')
        $(this).addClass('active-tool-3d')
        switch (text) {
            case 'distancia':
                measure.drawLineMeasureGraphics({ clampToGround: clampToGround, callback: () => { } });
                break;
            case 'area':
                measure.drawAreaMeasureGraphics({ clampToGround: clampToGround, callback: () => { } });
                break;
            // case '三角量测': measure.drawTrianglesMeasureGraphics({ callback: () => { } }); break;
            case 'visualizacao':
                addViewField(map)
                break;
        }
    }
});


$('input[type=radio][name=modelo-3d]').change(function () {
    let text = this.value
    if (text) {
        removeAllTools()
        switch (text) {
            case 'aman':
                map.flyTo(tilesetAMAN, {
                    offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-60), 0)
                });
                break;
            case 'esa':
                map.flyTo(tilesetESA, {
                    offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-60), 0)
                });
                break;
            case 'aman-pcl':
                map.flyTo(tilesetPCL, {
                    offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-60), 0)
                });
                break;
        }
    }
});


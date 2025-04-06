// Path: js\map_3d.js
import { map } from './control_3d/map.js';
import { load3dTileset } from './control_3d/3d_tileset.js';
import { addViewField, clearAllViewField } from './control_3d/viewshed.js';
import { initIdentifyTool, toggleIdentifyTool } from './control_3d/identify_tool.js';
import config from './config.js';

// Controle de renderização
let renderingActive = false;

// Load 3D models from configuration
const tilesetLocations = {};
for (let tilesetSetup of config.map3d.tilesets) {
    let tileset = load3dTileset(map, tilesetSetup);
    // Store location data for each model for Fly To function
    tilesetLocations[tilesetSetup.id.toLowerCase()] = tilesetSetup.locate;
}

const scene = map.scene;

// Configuração de renderização otimizada
map.scene.postRender.addEventListener(function() {
    if (!renderingActive) {
        // Se a renderização estiver desativada, defina uma taxa de atualização mínima
        map.scene.requestRenderMode = true;
        map.scene.maximumRenderTimeChange = Infinity;
    } else {
        // Quando ativo, permita renderização normal
        map.scene.requestRenderMode = false;
    }
});

// TOOLS
const removeAllTools = () => {
    measure._drawLayer.entities.removeAll();
    measure.removeDrawLineMeasureGraphics();
    measure.removeDrawAreaMeasureGraphics();
    clearAllViewField();
}

let clampToGround = true;
const measure = new Cesium.Measure(map);

initIdentifyTool();

export function activeTool() {
    let text = $(this).attr('id');
    if (text) {
        removeAllTools();
        switch (text) {
            case 'distancia':
                measure.drawLineMeasureGraphics({ clampToGround: clampToGround, callback: () => { } });
                break;
            case 'area':
                measure.drawAreaMeasureGraphics({ clampToGround: clampToGround, callback: () => { } });
                break;
            case 'visualizacao':
                addViewField(map);
                break;
            case 'identify-tool':
                toggleIdentifyTool();
                break;
        }
    }
}

export function handleClickGoTo() {
    let text = $(this).attr('id');
    if (text) {
        removeAllTools();
        const location = tilesetLocations[text];
        
        if (location) {
            const { lat, lon, height } = location;
            map.camera.flyTo({
                destination: Cesium.Cartesian3.fromDegrees(lon, lat, height),
            });
        }
    }
}

// Funções de controle de renderização
export function stopRendering() {
    renderingActive = false;
    // Remove event handler quando não estiver ativo
    if (handler) {
        handler.destroy();
        handler = undefined;
    }
}

export function resumeRendering() {
    renderingActive = true;
    
    // Recria o handler de eventos se foi destruído
    if (!handler) {
        handler = new Cesium.ScreenSpaceEventHandler(map.canvas);
        handler.setInputAction(function (event) {
            var pickedPosition = map.scene.pickPosition(event.position);
            if (Cesium.defined(pickedPosition)) {
                var carto = Cesium.Ellipsoid.WGS84.cartesianToCartographic(pickedPosition);
                var lon = Cesium.Math.toDegrees(carto.longitude);
                var lat = Cesium.Math.toDegrees(carto.latitude);
            }
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    }
}

$('#locate-3d-container button').click(handleClickGoTo);

var handler = new Cesium.ScreenSpaceEventHandler(map.canvas);
handler.setInputAction(function (event) {
    var pickedPosition = map.scene.pickPosition(event.position);
    if (Cesium.defined(pickedPosition)) {
        var carto = Cesium.Ellipsoid.WGS84.cartesianToCartographic(pickedPosition);
        var lon = Cesium.Math.toDegrees(carto.longitude);
        var lat = Cesium.Math.toDegrees(carto.latitude);
    }
}, Cesium.ScreenSpaceEventType.LEFT_CLICK);

// Por padrão, comece com renderização desativada se o modo 3D não estiver visível inicialmente
if (document.getElementById('map-3d-container').style.display === 'none') {
    stopRendering();
} else {
    resumeRendering();
}
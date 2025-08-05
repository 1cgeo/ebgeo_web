// Path: js\map_3d.js
import { map } from './control_3d/map.js'
import { load3dTileset } from './control_3d/3d_tileset.js'
import { addViewField, clearAllViewField } from './control_3d/viewshed.js';
import { initMouseCoordinates3D, cleanupMouseCoordinates3D } from './control_3d/mouse_coordinates_3d.js';
import { takeScreenshot } from './control_3d/screenshot_tool.js';
import { flyToAndOrbit, stopOrbit, initOrbitControl, cleanupOrbitControl } from './control_3d/orbit_control.js';

//MODELOS 3D
const loadedTilesets = {}; // Armazenar referências dos tilesets para órbita

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
    
    // Armazenar tileset e localização para órbita
    loadedTilesets[tilesetSetup.id.toLowerCase()] = {
        tileset: tileset,
        location: tilesetSetup.locate
    };
    
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
    stopOrbit() // Para a órbita ao limpar ferramentas
}

let clampToGround = true
const measure = new Cesium.Measure(map)

// Inicializar funcionalidades 3D
function init3DFeatures() {
    initMouseCoordinates3D();
    initOrbitControl(); // Inicializar controle de órbita
}

// Cleanup quando sair do modo 3D
function cleanup3DFeatures() {
    cleanupMouseCoordinates3D();
    cleanupOrbitControl(); // Limpar controle de órbita
}

// Handler para screenshot
function handleScreenshot() {
    const success = takeScreenshot();
    if (success) {
        // Feedback visual breve
        const button = document.getElementById('screenshot-3d');
        if (button) {
            const originalBg = button.style.backgroundColor;
            button.style.backgroundColor = '#28a745';
            setTimeout(() => {
                button.style.backgroundColor = originalBg;
            }, 500);
        }
    }
}

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
            case 'screenshot-3d':  // ID correto do botão no HTML
                handleScreenshot();
                break;
        }
    }
}


export function handleClickGoTo() {
    let text = $(this).attr('id')
    if (text) {
        removeAllTools()
        
        // Busca o tileset e localização correspondentes
        const tilesetData = loadedTilesets[text];
        if (tilesetData) {
            const { tileset, location } = tilesetData;
            // Voa para a localização e inicia órbita automaticamente
            flyToAndOrbit(location, tileset);
        } else {
            // Fallback para o método antigo se não encontrar no mapeamento
            let location;
            switch (text) {
                case 'aman':
                    location = tilesetAMAN;
                    break;
                case 'esa':
                    location = tilesetESA;
                    break;
                case 'aman-pcl':
                    location = tilesetPCL;
                    break;
            }
            if (location) {
                map.camera.flyTo({
                    destination: Cesium.Cartesian3.fromDegrees(location.lon, location.lat, location.height),
                });
            }
        }
    }
}

// Exportar funções de inicialização e limpeza
export { init3DFeatures, cleanup3DFeatures };

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
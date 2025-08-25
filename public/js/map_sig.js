// Path: js\map_sig.js
import BaseLayerControl from './controls_sig/base_layer_control.js';
import AddTextControl from './controls_sig/text_tool/add_text_control.js';
import AddImageControl from './controls_sig/image_tool/add_image_control.js';
import AddLOSControl from './controls_sig/los_tool/add_los_control.js';
import AddVisibilityControl from './controls_sig/visibility_tool/add_visibility_control.js';
import AddImportControl from './controls_sig/add_import_control.js';
import ToolManager from './controls_sig/tool_manager/tool_manager.js';
import SelectionManager from './controls_sig/tool_manager/selection_manager.js';
import UIManager from './controls_sig/tool_manager/ui_manager.js';
import MoveHandler from './controls_sig/tool_manager/move_handler.js';
import MapControl from './controls_sig/map_control.js';
import AddStreetViewControl from './controls_sig/street_view_tool/add_street_view_control.js';
import VectorTileInfoControl from './controls_sig/vector_info_control.js'
import ResetNorthControl from './controls_sig/reset_north_control.js';
import FeatureSearchControl from './controls_sig/feature_search_control.js';
import ScreenshotControl from './controls_sig/screenshot_control.js';
import MouseCoordinatesControl from './controls_sig/mouse_coordinates.js';
import { undoLastAction, redoLastAction} from './controls_sig/store.js';
import AddCircleControl from './controls_sig/circle_tool/add_circle_control.js';
import AddEllipseControl from './controls_sig/ellipse_tool/add_ellipse_control.js';
import AddArrowControl from './controls_sig/arrow_tool/add_arrow_control.js';
import AddBoundaryControl from './controls_sig/boundary_tool/add_boundary_control.js';
import AddOccupiedFrontControl from './controls_sig/occupied_front_tool/add_occupied_front_control.js';
import AddMilitarySymbolControl from './controls_sig/military_symbol_tool/add_military_symbol_control.js';
import TerrainControl from './controls_sig/terrain_control.js';
import config from './config.js';
import AddRectangleControl from './controls_sig/rectangle_tool/add_rectangle_control.js';
import AddBrushControl from './controls_sig/brush_tool/add_brush_control.js';
import AddPointControl from './controls_sig/draw_tools/add_point_control.js'
import AddLineControl from './controls_sig/draw_tools/add_line_control.js'
import AddPolygonControl from './controls_sig/draw_tools/add_polygon_control.js'
import baseStyle from './controls_sig/baselayers/carta_topografica.js'
import { hideLoadingScreen } from './index.js';

//-----------------------------------------------
// CRIAÇÃO E CONFIGURAÇÃO DO MAPA
//-----------------------------------------------

const map = new maplibregl.Map({
    container: 'map-sig',
    style: baseStyle,
    attributionControl: false,
    minZoom: config.map2d.minZoom,
    maxZoom: config.map2d.maxZoom,
    maxPitch: config.map2d.maxPitch,
    bounds: config.map2d.bounds
});

map.setSourceTileLodParams(...config.map2d.sourceTileLodParams);
if (config.map2d.maxBounds) {
    map.setMaxBounds(config.map2d.maxBounds);
}

map.addControl(new maplibregl.AttributionControl({
    customAttribution: 'Diretoria de Serviço Geográfico - Exército Brasileiro',
    compact: true
}), 'bottom-right');

//-----------------------------------------------
// EVENTO LOAD DO MAPA
//-----------------------------------------------

map.on('load', async () => {
    map.doubleClickZoom.disable();
    map.boxZoom.disable();
    await baseLayerControl.switchMap(true);
    hideLoadingScreen();
});

//-----------------------------------------------
// CONTROLES
//-----------------------------------------------

const selectionManager = new SelectionManager(map);
const toolManager = new ToolManager();
toolManager.setSelectionManager(selectionManager)

const pointControl = new AddPointControl(toolManager);
const lineControl = new AddLineControl(toolManager);
const polygonControl = new AddPolygonControl(toolManager);

const textControl = new AddTextControl(toolManager);

const imageControl = new AddImageControl(toolManager);

const losControl = new AddLOSControl(toolManager);

const visibilityControl = new AddVisibilityControl(toolManager);

const importControl = new AddImportControl(toolManager);

const addStreetViewControl = new AddStreetViewControl(toolManager);

const circleControl = new AddCircleControl(toolManager);
const rectangleControl = new AddRectangleControl(toolManager);
const ellipseControl = new AddEllipseControl(toolManager);
const arrowControl = new AddArrowControl(toolManager);
const boundaryControl = new AddBoundaryControl(toolManager);
const occupiedFrontControl = new AddOccupiedFrontControl(toolManager);
const militarySymbolControl = new AddMilitarySymbolControl(toolManager);
const brushControl = new AddBrushControl(toolManager);

selectionManager.registerControl('point', pointControl);
selectionManager.registerControl('line', lineControl);
selectionManager.registerControl('polygon', polygonControl);
selectionManager.registerControl('text', textControl);
selectionManager.registerControl('image', imageControl);
selectionManager.registerControl('los', losControl);
selectionManager.registerControl('visibility', visibilityControl);
selectionManager.registerControl('circle', circleControl);
selectionManager.registerControl('rectangle', rectangleControl);
selectionManager.registerControl('ellipse', ellipseControl);
selectionManager.registerControl('arrow', arrowControl);
selectionManager.registerControl('boundary', boundaryControl);
selectionManager.registerControl('occupied_front', occupiedFrontControl);
selectionManager.registerControl('military_symbol', militarySymbolControl);
selectionManager.registerControl('brush', brushControl);

const uiManager = new UIManager(map, selectionManager, toolManager);
selectionManager.setUIManager(uiManager);

const featureSearchControl = new FeatureSearchControl(uiManager);
uiManager.setFeatureSearchControl(featureSearchControl);

new MoveHandler(map, selectionManager, uiManager);

const vectorTileInfoControl = new VectorTileInfoControl(toolManager, uiManager);

selectionManager.setvectorTileInfoControl(vectorTileInfoControl);
const baseLayerControl = new BaseLayerControl(uiManager, config.map2d.hillshade);

const mapControl = new MapControl(baseLayerControl);
mapControl.setSelectionManager(selectionManager)

baseLayerControl.setMapControl(mapControl);


importControl.setControls(pointControl, lineControl, polygonControl);

const resetNorthControl = new ResetNorthControl();
const terrainControl = new TerrainControl(config.map2d);
const screenshotControl = new ScreenshotControl();

const mouseCoordinatesControl = new MouseCoordinatesControl(pointControl);

//-----------------------------------------------
// ADICIONAR CONTROLES AO MAPA
//-----------------------------------------------
map.addControl(baseLayerControl, 'top-left');
map.addControl(mapControl, 'top-left');
mapControl.loadMenu()

map.addControl(mouseCoordinatesControl, 'bottom-right');

map.addControl(featureSearchControl, 'top-right'); // Primeiro - Feature Search
map.addControl(resetNorthControl, 'top-right');    // Segundo - North
map.addControl(importControl, 'top-right');        // Terceiro - Import
map.addControl(screenshotControl, 'top-right');    // Quarto - Screenshot
map.addControl(vectorTileInfoControl, 'top-right'); // Quinto - Vector Info
map.addControl(addStreetViewControl, 'top-right');  // Sexto - Street View

// GRUPO TERRENO (últimos 3)
map.addControl(terrainControl, 'top-right');        // Sétimo - Terrain
map.addControl(losControl, 'top-right');            // Oitavo - LOS
map.addControl(visibilityControl, 'top-right');     // Nono - Visibility

// COLUNA DIREITA - Ferramentas de desenho
map.addControl(pointControl, 'top-right');
map.addControl(lineControl, 'top-right');
map.addControl(polygonControl, 'top-right');
map.addControl(textControl, 'top-right');
map.addControl(imageControl, 'top-right');
map.addControl(rectangleControl, 'top-right');
map.addControl(circleControl, 'top-right');
map.addControl(ellipseControl, 'top-right');
map.addControl(brushControl, 'top-right');
map.addControl(arrowControl, 'top-right');
map.addControl(boundaryControl, 'top-right');
map.addControl(occupiedFrontControl, 'top-right');
map.addControl(militarySymbolControl, 'top-right');

//-----------------------------------------------
// ATALHOS DE TECLADO
//-----------------------------------------------

document.addEventListener('keydown', (e) => {
    // Verificar se não está digitando em um input/textarea
    if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) {
        return;
    }
    if (addStreetViewControl.isOpen) {
        return;
    }
    switch (e.key) {
        case 'Delete':
        case 'Backspace':
            e.preventDefault();
            selectionManager.deleteSelectedFeatures();
            break;
        case 'Escape':
            e.preventDefault();
            toolManager.deactivateCurrentTool();
            selectionManager.deselectAllFeatures();
            break;
        case 'z':
        case 'Z':
            if (e.ctrlKey && !e.shiftKey) {
                e.preventDefault();
                if (undoLastAction()) {
                    baseLayerControl.switchMap(false);
                }
            }
            break;
        case 'y':
        case 'Y':
            if (e.ctrlKey && !e.shiftKey) {
                e.preventDefault();
                if (redoLastAction()) {
                    baseLayerControl.switchMap(false);
                }
            }
            break;

        // ✅ ATALHOS PARA ATIVAÇÃO DE FERRAMENTAS
        case 'n':
        case 'N':
            e.preventDefault();
            toolManager.setActiveTool(vectorTileInfoControl);
            break;
        case 'p':
        case 'P':
            e.preventDefault();
            toolManager.setActiveTool(pointControl);
            break;
        case 'l':
        case 'L':
            e.preventDefault();
            toolManager.setActiveTool(lineControl);
            break;
        case 'a':
        case 'A':
            e.preventDefault();
            toolManager.setActiveTool(polygonControl);
            break;
        case 't':
        case 'T':
            e.preventDefault();
            toolManager.setActiveTool(textControl);
            break;
        case 'i':
        case 'I':
            e.preventDefault();
            toolManager.setActiveTool(imageControl);
            break;
        case 'c':
        case 'C':
            e.preventDefault();
            toolManager.setActiveTool(circleControl);
            break;
        case 'e':
        case 'E':
            e.preventDefault();
            toolManager.setActiveTool(ellipseControl);
            break;
        case 'v':
        case 'V':
            e.preventDefault();
            if (map.getTerrain()) {
                toolManager.setActiveTool(visibilityControl);
            }
            break;
        // 'o' para LOS (Line Of Sight)
        case 'o':
        case 'O':
            e.preventDefault();
            if (map.getTerrain()) {
                toolManager.setActiveTool(losControl);
            }
            break;
        case 's':
        case 'S':
            e.preventDefault();
            toolManager.setActiveTool(arrowControl);
            break;
        case 'd':
        case 'D':
            e.preventDefault();
            toolManager.setActiveTool(boundaryControl);
            break;
        case 'f':
        case 'F':
            e.preventDefault();
            toolManager.setActiveTool(occupiedFrontControl);
            break;
        case 'm':
        case 'M':
            e.preventDefault();
            toolManager.setActiveTool(militarySymbolControl);
            break;
        case 'r':
        case 'R':
            e.preventDefault();
            toolManager.setActiveTool(rectangleControl);
            break;
        case 'b':
        case 'B':
            e.preventDefault();
            toolManager.setActiveTool(brushControl);
            break;
    }
});

//-----------------------------------------------
// TRATAMENTO DE ERROS GLOBAIS
//-----------------------------------------------

window.addEventListener('unhandledrejection', (event) => {
    console.error('Erro não tratado:', event.reason);
});

window.addEventListener('error', (event) => {
    console.error('Erro JavaScript:', event.error);
});

//-----------------------------------------------
// EXPORTAÇÕES
//-----------------------------------------------
export { 
    map, 
    baseLayerControl, 
    mapControl,
    selectionManager,
    toolManager
};
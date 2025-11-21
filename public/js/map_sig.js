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
import VectorTileInfoControl from './controls_sig/vector_info_control.js';
import FeatureSearchControl from './controls_sig/feature_search_control.js';
import ScreenshotControl from './controls_sig/screenshot_control.js';
import MouseCoordinatesControl from './controls_sig/mouse_coordinates.js';
import AddCircleControl from './controls_sig/circle_tool/add_circle_control.js';
import AddEllipseControl from './controls_sig/ellipse_tool/add_ellipse_control.js';
import AddArrowControl from './controls_sig/arrow_tool/add_arrow_control.js';
import AddBoundaryControl from './controls_sig/boundary_tool/add_boundary_control.js';
import AddOccupiedFrontControl from './controls_sig/occupied_front_tool/add_occupied_front_control.js';
import AddMilitarySymbolControl from './controls_sig/military_symbol_tool/add_military_symbol_control.js';
import TerrainControl from './controls_sig/terrain_control.js';
import AnalysisLayersManager from './controls_sig/analysis_layers_manager.js';
import config from './config.js';
import AddRectangleControl from './controls_sig/rectangle_tool/add_rectangle_control.js';
import AddBrushControl from './controls_sig/brush_tool/add_brush_control.js';
import AddPointControl from './controls_sig/draw_tools/add_point_control.js';
import AddLineControl from './controls_sig/draw_tools/add_line_control.js';
import AddPolygonControl from './controls_sig/draw_tools/add_polygon_control.js';
import baseStyle from './controls_sig/baselayers/carta_topografica.js';
import { hideLoadingScreen } from './index.js';
import DragDropHandler from './controls_sig/drag_drop_handler.js';
import ContextMenuControl from './controls_sig/context_menu_control.js';
import DragRotateHandler from './controls_sig/drag_rotate_handler.js';
import ClipboardManager from './controls_sig/tool_manager/clipboard_manager.js';
import RectangleSelectionControl from './controls_sig/selection_tools/rectangle_selection_control.js';
import KeyboardShortcuts from './controls_sig/keyboard_shortcuts.js';
import SuggestionsModal from './controls_sig/suggestions_modal.js';
import GridControl from './controls_sig/grid.js';
import FrameControl from './controls_sig/frame.js';
import AddCoordinationMeasureControl from './controls_sig/coordination_measure_tool/add_coordination_measure_control.js';

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

const analysisLayersManager = new AnalysisLayersManager(map);

const gridControl = new GridControl(map);
const frameControl = new FrameControl(map);

//-----------------------------------------------
// EVENTO LOAD DO MAPA
//-----------------------------------------------

map.on('load', async () => {
    map.doubleClickZoom.disable();
    map.boxZoom.disable();
    map.dragRotate.disable();
    await baseLayerControl.switchMap(true);
    hideLoadingScreen();
    // gridControl._initGridLayers();
    // frameControl._initFrameLayers();
});



//-----------------------------------------------
// CONTROLES
//-----------------------------------------------

const selectionManager = new SelectionManager(map);
const toolManager = new ToolManager();
toolManager.setSelectionManager(selectionManager);

const pointControl = new AddPointControl(toolManager);
const lineControl = new AddLineControl(toolManager);
const polygonControl = new AddPolygonControl(toolManager);

const textControl = new AddTextControl(toolManager);

const imageControl = new AddImageControl(toolManager);

const losControl = new AddLOSControl(toolManager);

const visibilityControl = new AddVisibilityControl(toolManager);

const importControl = new AddImportControl(toolManager);

const addStreetViewControl = new AddStreetViewControl();

const circleControl = new AddCircleControl(toolManager);
const rectangleControl = new AddRectangleControl(toolManager);
const ellipseControl = new AddEllipseControl(toolManager);
const arrowControl = new AddArrowControl(toolManager);
const boundaryControl = new AddBoundaryControl(toolManager);
const occupiedFrontControl = new AddOccupiedFrontControl(toolManager);
const militarySymbolControl = new AddMilitarySymbolControl(toolManager);
const brushControl = new AddBrushControl(toolManager);
const coordinationMeasureControl = new AddCoordinationMeasureControl(toolManager);

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
selectionManager.registerControl('coordination_measure', coordinationMeasureControl);

const uiManager = new UIManager(map, selectionManager, toolManager);
selectionManager.setUIManager(uiManager);
toolManager.setUiManager(uiManager);

const featureSearchControl = new FeatureSearchControl(uiManager);
uiManager.setFeatureSearchControl(featureSearchControl);

new MoveHandler(map, selectionManager, uiManager);

const vectorTileInfoControl = new VectorTileInfoControl(toolManager, uiManager);

selectionManager.setvectorTileInfoControl(vectorTileInfoControl);
const baseLayerControl = new BaseLayerControl(uiManager, config.map2d.hillshade);

const mapControl = new MapControl(baseLayerControl, analysisLayersManager);
mapControl.setSelectionManager(selectionManager);

baseLayerControl.setMapControl(mapControl);

importControl.setControls(pointControl, lineControl, polygonControl);

const terrainControl = new TerrainControl(config.map2d);
const screenshotControl = new ScreenshotControl();

const mouseCoordinatesControl = new MouseCoordinatesControl(
    pointControl,
    coordinationMeasureControl,
    militarySymbolControl
);

// Context menu e drag rotate customizados
const contextMenuControl = new ContextMenuControl(mouseCoordinatesControl, toolManager, selectionManager);
const dragRotateHandler = new DragRotateHandler(map);
dragRotateHandler.enable();

const dragDropHandler = new DragDropHandler(
    map.getContainer(),
    toolManager,
    importControl,
    mapControl,
    imageControl
);
dragDropHandler.enable();

const clipboardManager = new ClipboardManager(selectionManager, map);

const rectangleSelectionControl = new RectangleSelectionControl(toolManager);
selectionManager.setRectangleSelectionControl(rectangleSelectionControl);

//-----------------------------------------------
// CONFIGURAÇÃO DOS ATALHOS DE TECLADO
//-----------------------------------------------

const keyboardShortcuts = new KeyboardShortcuts({
    map,
    selectionManager,
    toolManager,
    baseLayerControl,
    clipboardManager,
    addStreetViewControl,
    mapControl,
    controls: {
        pointControl,
        lineControl,
        polygonControl,
        textControl,
        imageControl,
        losControl,
        visibilityControl,
        circleControl,
        rectangleControl,
        ellipseControl,
        arrowControl,
        boundaryControl,
        occupiedFrontControl,
        militarySymbolControl,
        brushControl,
        rectangleSelectionControl,
        vectorTileInfoControl,
        coordinationMeasureControl
    }
});

keyboardShortcuts.enable();
keyboardShortcuts.initModal();

const suggestionsModal = new SuggestionsModal();
suggestionsModal.init();

//-----------------------------------------------
// ADICIONAR CONTROLES AO MAPA
//-----------------------------------------------
map.addControl(baseLayerControl, 'top-left');
map.addControl(mapControl, 'top-left');
mapControl.loadMenu();

map.addControl(mouseCoordinatesControl, 'bottom-right');

map.addControl(contextMenuControl, 'top-left');

map.addControl(featureSearchControl, 'top-right');
map.addControl(importControl, 'top-right');
map.addControl(screenshotControl, 'top-right');
map.addControl(vectorTileInfoControl, 'top-right');
map.addControl(rectangleSelectionControl, 'top-right');
map.addControl(addStreetViewControl, 'top-right');
map.addControl(terrainControl, 'top-right');
map.addControl(losControl, 'top-right');
map.addControl(visibilityControl, 'top-right');

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
map.addControl(coordinationMeasureControl, 'top-right');

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
// EXPORTS E CLEANUP
//-----------------------------------------------

window.addEventListener('beforeunload', () => {
    keyboardShortcuts.destroy();
    suggestionsModal.destroy();
});
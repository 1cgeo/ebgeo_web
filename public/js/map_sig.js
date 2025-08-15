// Path: js\map_sig.js
import { map } from './controls_sig/map.js';
import BaseLayerControl from './controls_sig/base_layer_control.js';
import DrawControl from './controls_sig/draw_tool/draw.js';
import AddTextControl from './controls_sig/text_tool/add_text_control.js';
import AddImageControl from './controls_sig/image_tool/add_image_control.js';
import AddLOSControl from './controls_sig/los_tool/add_los_control.js';
import AddVisibilityControl from './controls_sig/visibility_tool/add_visibility_control.js';
import AddImportControl from './controls_sig/import_tool/add_import_control.js';
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
import { undoLastAction, redoLastAction } from './controls_sig/store.js';
import AddCircleControl from './controls_sig/circle_tool/add_circle_control.js';
import AddEllipseControl from './controls_sig/ellipse_tool/add_ellipse_control.js';
import AddArrowControl from './controls_sig/arrow_tool/add_arrow_control.js';
import AddBoundaryControl from './controls_sig/boundary_tool/add_boundary_control.js';
import AddOccupiedFrontControl from './controls_sig/occupied_front_tool/add_occupied_front_control.js';

//-----------------------------------------------
// CONTROLES
//-----------------------------------------------

const selectionManager = new SelectionManager(map);
const toolManager = new ToolManager(map);
toolManager.setSelectionManager(selectionManager)

const drawControl = new DrawControl(toolManager);

toolManager.setDrawControl(drawControl);

const textControl = new AddTextControl(toolManager);

const imageControl = new AddImageControl(toolManager);

const losControl = new AddLOSControl(toolManager);

const visibilityControl = new AddVisibilityControl(toolManager);

const importControl = new AddImportControl(toolManager);

const addStreetViewControl = new AddStreetViewControl(toolManager);

const circleControl = new AddCircleControl(toolManager);
const ellipseControl = new AddEllipseControl(toolManager);
const arrowControl = new AddArrowControl(toolManager);
const boundaryControl = new AddBoundaryControl(toolManager);
const occupiedFrontControl = new AddOccupiedFrontControl(toolManager);

selectionManager.setDrawControl(drawControl);
selectionManager.setTextControl(textControl);
selectionManager.setImageControl(imageControl);
selectionManager.setLosControl(losControl);
selectionManager.setVisibilityControl(visibilityControl);
selectionManager.setCircleControl(circleControl);
selectionManager.setEllipseControl(ellipseControl);
selectionManager.setArrowControl(arrowControl);
selectionManager.setBoundaryControl(boundaryControl);
selectionManager.setOccupiedFrontControl(occupiedFrontControl);

const uiManager = new UIManager(map, selectionManager, toolManager);
selectionManager.setUIManager(uiManager);

importControl.setDrawControl(drawControl);

const featureSearchControl = new FeatureSearchControl(uiManager);
uiManager.setFeatureSearchControl(featureSearchControl);

new MoveHandler(map, selectionManager, uiManager);

const vectorTileInfoControl = new VectorTileInfoControl(toolManager, uiManager);

selectionManager.setvectorTileInfoControl(vectorTileInfoControl);
const baseLayerControl = new BaseLayerControl(uiManager);

const mapControl = new MapControl(baseLayerControl);
mapControl.setSelectionManager(selectionManager)

importControl.setBaseLayerControl(baseLayerControl);

const resetNorthControl = new ResetNorthControl();

const screenshotControl = new ScreenshotControl();

const mouseCoordinatesControl = new MouseCoordinatesControl(drawControl);

//-----------------------------------------------
// ADICIONAR CONTROLES AO MAPA
//-----------------------------------------------
map.addControl(baseLayerControl, 'top-left');
map.addControl(mapControl, 'top-left');
mapControl.loadMenu()

map.addControl(featureSearchControl, 'bottom-left');

map.addControl(mouseCoordinatesControl, 'bottom-right');

map.addControl(resetNorthControl, 'top-right');
map.addControl(importControl, 'top-right');
map.addControl(screenshotControl, 'top-right');
map.addControl(vectorTileInfoControl, 'top-right');
map.addControl(drawControl, 'top-right');
map.addControl(textControl, 'top-right');
map.addControl(imageControl, 'top-right');
map.addControl(losControl, 'top-right');
map.addControl(visibilityControl, 'top-right');
map.addControl(addStreetViewControl, 'top-right');
map.addControl(circleControl, 'top-right');
map.addControl(ellipseControl, 'top-right');
map.addControl(arrowControl, 'top-right');
map.addControl(boundaryControl, 'top-right');
map.addControl(occupiedFrontControl, 'top-right');

//-----------------------------------------------
// ATALHOS DE TECLADO
//-----------------------------------------------

document.addEventListener('keydown', (e) => {
    // Verificar se não está digitando em um input/textarea
    if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) {
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
            selectionManager.deselectAllFeatures(true);
            break;
        case 'z':
        case 'Z':
            if (e.ctrlKey && !e.shiftKey) {
                e.preventDefault();
                if (undoLastAction()) {
                    mapControl.switchMap(false);
                }
            }
            break;
        case 'y':
            if (e.ctrlKey && !e.shiftKey) {
                e.preventDefault();
                if (redoLastAction()) {
                    mapControl.switchMap(false);
                }
            }
            break;

        // ✅ ATALHOS PARA ATIVAÇÃO DE FERRAMENTAS
        case 'p':
        case 'P':
            e.preventDefault();
            toolManager.setActiveTool(drawControl);
            drawControl.draw.changeMode('draw_point');
            break;
        case 'a':
        case 'A':
            e.preventDefault();
            toolManager.setActiveTool(drawControl);
            drawControl.draw.changeMode('draw_polygon');
            break;
        case 'l':
        case 'L':
            e.preventDefault();
            toolManager.setActiveTool(drawControl);
            drawControl.draw.changeMode('draw_line_string');
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
            toolManager.setActiveTool(visibilityControl);
            break;
        // 'o' para LOS (Line Of Sight)
        case 'o':
        case 'O':
            e.preventDefault();
            toolManager.setActiveTool(losControl);
            break;
        case 's':
        case 'S':
            e.preventDefault();
            toolManager.setActiveTool(arrowControl);
            break;
        case 'b':
        case 'B':
            e.preventDefault();
            toolManager.setActiveTool(boundaryControl);
            break;
        case 'f':
        case 'F':
            e.preventDefault();
            toolManager.setActiveTool(occupiedFrontControl);
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
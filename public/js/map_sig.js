// Path: js\map_sig.js
import { map } from './controls_sig/map.js';
import BaseLayerControl from './controls_sig/base_layer_control.js';
import DrawControl from './controls_sig/draw_tool/draw.js';
import SaveLoadControl from './controls_sig/save_load_control.js';
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
import { undoLastAction, redoLastAction, hasUnsavedData } from './controls_sig/store.js';
import MouseCoordinatesControl from './controls_sig/mouse_coordinates.js';

//-----------------------------------------------
// CONTROLES
//-----------------------------------------------

const toolManager = new ToolManager(map);

const drawControl = new DrawControl(toolManager);

toolManager.setDrawControl(drawControl);

const textControl = new AddTextControl(toolManager);

const imageControl = new AddImageControl(toolManager);

const losControl = new AddLOSControl(toolManager);

const visibilityControl = new AddVisibilityControl(toolManager);
const addStreetViewControl = new AddStreetViewControl(toolManager);

const selectionManager = new SelectionManager(map, drawControl, textControl, imageControl, losControl, visibilityControl);
const uiManager = new UIManager(map, selectionManager, toolManager);
selectionManager.setUIManager(uiManager);
drawControl.setSelectionManager(selectionManager);
textControl.setSelectionManager(selectionManager);

const featureSearchControl = new FeatureSearchControl(uiManager);
uiManager.setFeatureSearchControl(featureSearchControl);

toolManager.setSelectionManager(selectionManager);

new MoveHandler(map, selectionManager, uiManager);

const vectorTileInfoControl = new VectorTileInfoControl(toolManager,uiManager);

selectionManager.setvectorTileInfoControl(vectorTileInfoControl);

const baseLayerControl = new BaseLayerControl(uiManager);

const mapControl = new MapControl(baseLayerControl);

const saveLoadControl = new SaveLoadControl(mapControl, baseLayerControl);

const importControl = new AddImportControl(toolManager);
importControl.setDrawControl(drawControl);
importControl.setBaseLayerControl(baseLayerControl);

const mouseCoordinatesControl = new MouseCoordinatesControl(drawControl);

map.addControl(baseLayerControl, 'top-left');
map.addControl(mapControl, 'top-left');
map.addControl(saveLoadControl, 'top-left');
map.addControl(featureSearchControl, 'top-right');
map.addControl(new ResetNorthControl(), 'top-right');
map.addControl(vectorTileInfoControl, 'top-right');
map.addControl(drawControl, 'top-right');
map.addControl(textControl, 'top-right');
map.addControl(imageControl, 'top-right');
map.addControl(losControl, 'top-right');
map.addControl(visibilityControl, 'top-right');
map.addControl(importControl, 'top-right');
map.addControl(addStreetViewControl, 'top-right');
map.addControl(mouseCoordinatesControl, 'bottom-left');
mapControl.loadMenu()



//-----------------------------------------------
// ATALHOS
//-----------------------------------------------
document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'z') {
        if (undoLastAction()) {
            mapControl.switchMap(false);
        }
    }
    if ((event.ctrlKey || event.metaKey) && event.key === 'y') {
        if (redoLastAction()) {
            mapControl.switchMap(false);
        }
    }
});

//-----------------------------------------------
// OUTROS
//-----------------------------------------------

window.addEventListener('beforeunload', function (e) {
    if (hasUnsavedData()) {
        e.preventDefault();

        // Para navegadores mais antigos que precisam de um valor retornado.
        return 'Ao fechar perderá todos os dados. Tem certeza de que deseja sair?'
    }
});
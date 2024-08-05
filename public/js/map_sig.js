import { map } from './controls_sig/map.js';
import BaseLayerControl from './controls_sig/base_layer_control.js';
import DrawControl from './controls_sig/draw_tool/draw.js';
import SaveLoadControl from './controls_sig/save_load_control.js';
import AddTextControl from './controls_sig/text_tool/add_text_control.js';
import AddImageControl from './controls_sig/image_tool/add_image_control.js';
import AddLOSControl from './controls_sig/los_tool/add_los_control.js';
import AddVisibilityControl from './controls_sig/visibility_tool/add_visibility_control.js';
import ToolManager from './controls_sig/tool_manager/tool_manager.js';
import SelectionManager from './controls_sig/tool_manager/selection_manager.js';
import UIManager from './controls_sig/tool_manager/ui_manager.js';
import MoveHandler from './controls_sig/tool_manager/move_handler.js';
import MapControl from './controls_sig/map_control.js';
import AddStreetViewControl from './controls_sig/street_view_tool/add_street_view_control.js';
//import ResetNorthControl from './controls_sig/reset_north_control.js';
//import ResetOrthogonalControl from './controls_sig/reset_otho_control.js';
//import FlyToCoordinatesControl from './controls_sig/fly_coordinates_control.js';
import { undoLastAction, redoLastAction, hasUnsavedData } from './controls_sig/store.js';

//-----------------------------------------------
// CONTROLES
//-----------------------------------------------
const baseLayerControl = new BaseLayerControl();
map.addControl(baseLayerControl, 'top-left');

const mapControl = new MapControl(baseLayerControl);
map.addControl(mapControl, 'top-left');

const saveLoadControl = new SaveLoadControl(mapControl, baseLayerControl);
map.addControl(saveLoadControl, 'top-left');

mapControl.loadMenu()


//map.addControl(new ResetNorthControl(), 'top-right');
//map.addControl(new ResetOrthogonalControl(), 'top-right');
//map.addControl(new FlyToCoordinatesControl(), 'top-right');

const toolManager = new ToolManager(map);

const drawControl = new DrawControl(toolManager);
map.addControl(drawControl, 'top-right');

const textControl = new AddTextControl(toolManager);
map.addControl(textControl, 'top-right');

const imageControl = new AddImageControl(toolManager);
map.addControl(imageControl, 'top-right');

const losControl = new AddLOSControl(toolManager);
map.addControl(losControl, 'top-right');

const visibilityControl = new AddVisibilityControl(toolManager);
map.addControl(visibilityControl, 'top-right');

const addStreetViewControl = new AddStreetViewControl(toolManager);
map.addControl(addStreetViewControl, 'top-right');

const selectionManager = new SelectionManager(map, drawControl, textControl, imageControl, losControl, visibilityControl);
const uiManager = new UIManager(map, selectionManager);
selectionManager.setUIManager(uiManager);

new MoveHandler(map, selectionManager, uiManager);

const scale = new maplibregl.ScaleControl({
    maxWidth: 80,
    unit: 'metric'
});
map.addControl(scale, 'bottom-left');


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
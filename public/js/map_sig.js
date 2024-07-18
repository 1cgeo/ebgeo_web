import { map } from './controls_sig/map.js';
import baseLayerControl from './controls_sig/base_layer_control.js';
import DrawControl from './controls_sig/draw_tool/draw.js';
import SaveLoadControl from './controls_sig/save_load_control.js';
import AddTextControl from './controls_sig/text_tool/add_text_control.js';
import AddImageControl from './controls_sig/image_tool/add_image_control.js';
import ToolManager from './controls_sig/tool_manager.js';
import MapControl from './controls_sig/map_control.js';
import { undoLastAction, redoLastAction } from './controls_sig/store.js';

map.addControl(baseLayerControl, 'top-left');

const mapControl = new MapControl();
map.addControl(mapControl, 'top-left');

const saveLoadControl = new SaveLoadControl(mapControl);
map.addControl(saveLoadControl, 'top-left');

const toolManager = new ToolManager(map);

const drawControl = new DrawControl(toolManager);
map.addControl(drawControl, 'top-right');

const textControl = new AddTextControl(toolManager);
map.addControl(textControl, 'top-right');

const imageControl = new AddImageControl(toolManager);
map.addControl(imageControl, 'top-right');


const scale = new maplibregl.ScaleControl({
    maxWidth: 80,
    unit: 'metric'
});
map.addControl(scale, 'bottom-left');

document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'z') {
        undoLastAction();
        // Atualize o mapa para refletir as mudanças
        mapControl.switchMap();
    }
    if ((event.ctrlKey || event.metaKey) && event.key === 'y') {
        redoLastAction();
        // Atualize o mapa para refletir as mudanças
        mapControl.switchMap();
    }
});
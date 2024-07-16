import { map } from './controls_carta/map.js';
import baseLayerControl from './controls_carta/base_layer_control.js';
import DrawControl from './controls_carta/draw_tool/draw.js';
import SaveLoadControl from './controls_carta/save_load_control.js';
import AddTextControl from './controls_carta/text_tool/add_text_control.js';
import AddImageControl from './controls_carta/image_tool/add_image_control.js';
import ToolManager from './controls_carta/tool_manager.js';
import MapControl from './controls_carta/map_control.js';

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

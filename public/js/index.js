// public/js/index.js
import { map } from './map.js';
import baseLayerControl from './controls/baseLayerControl.js';
import drawControl from './controls/draw.js';
import saveLoadControl from './controls/save_load_control.js';
import AddTextControl from './controls/add_text_control.js';
import AddImageControl from './controls/add_image_control.js';

// Add controls to the map
map.addControl(baseLayerControl, 'top-left');
map.addControl(drawControl, 'top-right');
map.addControl(saveLoadControl, 'top-left');
map.addControl(new AddTextControl(), 'top-right');
map.addControl(new AddImageControl(), 'top-right');

const scale = new maplibregl.ScaleControl({
    maxWidth: 80,
    unit: 'metric'
});
map.addControl(scale, 'bottom-left');

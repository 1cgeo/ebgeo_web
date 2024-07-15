import 'https://unpkg.com/@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.js';
import drawStyles from './drawStyles.js';
import { createFeatureAttributesPanel } from './feature_attributes_panel.js';

class DrawControl {

    constructor(toolManager) {
        this.toolManager = toolManager;
        this.isActive = false;
        this.defaultProperties = {
            user_color: '#1100FF',
            user_opacity: 0.2,
        };
    }

    onAdd(map) {
        this.map = map;
        this.container = document.createElement('div');
        this.container.className = 'mapboxgl-ctrl-group mapboxgl-ctrl draw-control';

        this.draw = new MapboxDraw({
            displayControlsDefault: false,
            userProperties: true,
            controls: {
                polygon: true,
                line_string: true,
                point: true,
                trash: false
            },
            styles: drawStyles
        });

        this.map.addControl(this.draw, 'top-right');



        this.map.on('draw.create', (e) => {
            const feature = e.features[0];        

            // Define as propriedades padrão na feição
            this.draw.setFeatureProperty(feature.id, 'color', this.defaultProperties.user_color);
            this.draw.setFeatureProperty(feature.id, 'opacity', this.defaultProperties.user_opacity);
        
            this.map.getCanvas().style.cursor = ''; // Reset cursor
        });

        this.map.on('draw.update', (e) => {
            // Handle feature update
        });

        this.map.on('draw.modechange', (e) => {
            const mode = e.mode;
            if (mode === 'draw_polygon' || mode === 'draw_line_string' || mode === 'draw_point') {
                this.toolManager.setActiveTool(this);
                this.map.getCanvas().style.cursor = 'crosshair';
            } else {
                this.map.getCanvas().style.cursor = '';
            }
        });

        this.map.on('click', (e) => {
            const features = this.draw.getSelected().features;
            if (features.length > 0) {
                const feature = features[0];
                createFeatureAttributesPanel(feature, this.map, this.defaultProperties);
            } else {
                let panel = document.querySelector('.feature-attributes-panel');
                if (panel) {
                    const discardButton = panel.querySelector('button[id="DescartarFeat"]');
                    if (discardButton) {
                        discardButton.click();
                    }
                    panel.remove();
                }
            }
        });

        return this.container;
    }

    onRemove() {
        this.map.removeControl(this.draw);
        this.map.off('draw.create');
        this.map.off('draw.update');
        this.map.off('draw.delete');
        this.map.off('draw.modechange');
        this.map = undefined;
    }

    activate() {
        this.isActive = true;
        this.map.getCanvas().style.cursor = 'crosshair';
    }

    deactivate() {
        this.isActive = false;
        this.draw.changeMode('simple_select');
        this.map.getCanvas().style.cursor = '';
    }
};

export default DrawControl;


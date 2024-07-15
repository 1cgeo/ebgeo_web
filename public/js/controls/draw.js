// public/js/controls/draw.js
import 'https://unpkg.com/@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.js';
import drawStyles from './drawStyles.js';
import { createFeatureAttributesPanel } from './feature_attributes_panel.js';

const drawControl = {
    onAdd: function (map) {
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
                trash: true
            },
            styles: drawStyles
        });

        this.map.addControl(this.draw, 'top-right');

        let defaultProperties = {
            user_color: '#1100FF',
            user_opacity: 0.2,
        };

        this.map.on('draw.create', (e) => {
            const feature = e.features[0];
            const type = feature.geometry.type.toLowerCase() + 's';
        

            // Define as propriedades padrão na feição
            this.draw.setFeatureProperty(feature.id, 'color', defaultProperties.user_color);
            this.draw.setFeatureProperty(feature.id, 'opacity', defaultProperties.user_opacity);
        
            this.map.getCanvas().style.cursor = ''; // Reset cursor
        });

        this.map.on('draw.update', (e) => {

        });

        this.map.on('draw.delete', (e) => {
            // Fechar o painel de atributos se estiver aberto
            let panel = document.querySelector('.feature-attributes-panel');
            if (panel) {
                panel.remove();
            }
        });

        this.map.on('draw.modechange', (e) => {
            const mode = e.mode;
            if (mode === 'draw_polygon' || mode === 'draw_line_string' || mode === 'draw_point') {
                this.map.getCanvas().style.cursor = 'crosshair';
            } else {
                this.map.getCanvas().style.cursor = '';
            }
        });

        this.map.on('click', (e) => {
            const features = this.draw.getSelected().features;
            if (features.length > 0) {
                const feature = features[0];
                createFeatureAttributesPanel(feature, this.map, defaultProperties);
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
    },

    onRemove: function () {
        this.map.removeControl(this.draw);
        this.map.off('draw.create');
        this.map.off('draw.update');
        this.map.off('draw.delete');
        this.map.off('draw.modechange');
        this.map = undefined;
    }
};

export default drawControl;

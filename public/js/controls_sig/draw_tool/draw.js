import 'https://unpkg.com/@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.js';
import drawStyles from './draw_styles.js';
import { createFeatureAttributesPanel } from './feature_attributes_panel.js';
import { addFeature, updateFeature, removeFeature } from '../store.js';

class DrawControl {

    constructor(toolManager) {
        this.toolManager = toolManager;
        this.isActive = false;
        this.defaultProperties = {
            color: '#fbb03b',
            opacity: 0.5,
            size: 3,
            outlinecolor: '#fbb03b'
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
            e.features.forEach(feature => {
                Object.keys(this.defaultProperties).forEach(key => {
                    if (!feature.properties.hasOwnProperty(key)) {
                        feature.properties[key] = this.defaultProperties[key];
                    }
                });
                const type = feature.geometry.type.toLowerCase() + 's';
                addFeature(type, feature);
    
                // Define as propriedades padrão na feição
                this.draw.setFeatureProperty(feature.id, 'color', this.defaultProperties.color);
                this.draw.setFeatureProperty(feature.id, 'opacity', this.defaultProperties.opacity);
                this.draw.setFeatureProperty(feature.id, 'size', this.defaultProperties.size);
                this.draw.setFeatureProperty(feature.id, 'outlinecolor', this.defaultProperties.outlinecolor);    
            });

            this.map.getCanvas().style.cursor = ''; // Reset cursor
        });

        this.map.on('draw.update', (e) => {
            e.features.forEach(feature => {
                const type = feature.geometry.type.toLowerCase() + 's';
                updateFeature(type, feature.id);
            });
        });
        this.map.on('draw.delete', (e) => {
            e.features.forEach(feature => {
                const type = feature.geometry.type.toLowerCase() + 's';
                removeFeature(type, feature.id);
            });
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

        const pixelsToDegrees = (pixels, latitude, zoom) => {
            const earthCircumference = 40075017; // Circunferência da Terra em metros
            const metersPerPixel = earthCircumference * Math.cos(latitude * Math.PI / 180) / Math.pow(2, zoom + 8);
            const degreesPerMeter = 360 / earthCircumference;
            return pixels * metersPerPixel * degreesPerMeter;
        }

        const calculateBuffer = (feature, zoom, latitude, pixelBuffer) => {
            const bufferSize = pixelsToDegrees(pixelBuffer, latitude, zoom);
            const buffered = turf.buffer(feature, bufferSize, { units: 'degrees' });
            return buffered;
          }

        const updateSelectedBBoxSource = () => {
            const selectedFeatures = this.draw.getSelected().features;
            if (selectedFeatures.length) {
                const zoom = map.getZoom();
                const center = map.getCenter();
                const latitude = center.lat;
                const pixelBuffer = 10;
              
                const boundsFeatures = selectedFeatures.map(feature => calculateBuffer(feature, zoom, latitude, pixelBuffer));
              
                this.map.getSource('highlighted_bbox').setData({
                    type: 'FeatureCollection',
                    features: boundsFeatures
                });
            
            } else {
                this.map.getSource('highlighted_bbox').setData({
                  type: 'FeatureCollection',
                  features: []
                });
            }
        }

        this.map.on('zoomend', updateSelectedBBoxSource);
        this.map.on('draw.render', updateSelectedBBoxSource);

        this.map.on('click', (e) => {
            const features = this.draw.getSelected().features;
            if (features.length > 0) {
                createFeatureAttributesPanel(features, this.map, this.defaultProperties);
            } else {
                let panel = document.querySelector('.feature-attributes-panel');
                if (panel) {
                    const saveButton = panel.querySelector('button[id="SalvarFeat"]');
                    if (saveButton) {
                        saveButton.click();
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
        this.map.off('move');
        this.map.off('draw.render');
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


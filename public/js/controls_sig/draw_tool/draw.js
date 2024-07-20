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
            e.features.forEach(f => {
                Object.keys(this.defaultProperties).forEach(key => {
                    if (!f.properties.hasOwnProperty(key)) {
                        f.properties[key] = this.defaultProperties[key];
                    }
                });
                const type = f.geometry.type.toLowerCase() + 's';
                addFeature(type, f);
    
                // Define as propriedades padrão na feição
                this.draw.setFeatureProperty(f.id, 'color', this.defaultProperties.color);
                this.draw.setFeatureProperty(f.id, 'opacity', this.defaultProperties.opacity);
                this.draw.setFeatureProperty(f.id, 'size', this.defaultProperties.size);
                this.draw.setFeatureProperty(f.id, 'outlinecolor', this.defaultProperties.outlinecolor);    
            });

            this.map.getCanvas().style.cursor = ''; // Reset cursor
        });

        this.map.on('draw.update', (e) => {
            e.features.forEach(f => {
                const type = f.geometry.type.toLowerCase() + 's';
                updateFeature(type, f);
            });
        });

        this.map.on('draw.delete', (e) => {
            e.features.forEach(f => {
                const type = f.geometry.type.toLowerCase() + 's';
                removeFeature(type, f.id);
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

        this.map.on('move', updateSelectedBBoxSource);
        this.map.on('draw.render', updateSelectedBBoxSource);

        this.map.on('click', (e) => {
            const features = this.draw.getSelected().features;
            if (features.length > 0) {
                createFeatureAttributesPanel(features, this);
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

    updateFeaturesProperty(features, property, value) {
        features.forEach(feature => {
            this.draw.setFeatureProperty(feature.id, property, value);

            const feat = this.draw.get(feature.id);
            this.draw.add(feat);
        });
    }

    updateFeatures(features) {
        features.forEach(feature => {
            Object.keys(feature.properties).forEach(key => {
                this.draw.setFeatureProperty(feature.id, key, feature.properties[key]);
            });
            const feat = this.draw.get(feature.id);
            this.draw.add(feat);
        });
    }

    saveFeatures(features, initialPropertiesMap) {
        features.forEach(f => {
            if (hasFeatureChanged(f, initialPropertiesMap.get(f.id))) {
                const type = feature.geometry.type.toLowerCase() + 's';
                updateFeature(type, f);            
            }
        });
    }

    discartChangeFeatures(features, initialPropertiesMap) {
        features.forEach(f => {
            Object.assign(f.properties, initialPropertiesMap.get(f.id));
        });
        this.updateFeatures(features);
    }

    deleteFeatures(features) {
        features.forEach(f => {
            this.draw.delete(f.id);
            const type = f.geometry.type.toLowerCase() + 's';
            removeFeature(type, f.id);
        });
    }

    setDefaultProperties(properties, commonAttributes) {
        commonAttributes.forEach(attr => {
            this.defaultProperties[attr] = properties[attr];
        });
    }
};

function hasFeatureChanged(feature, initialProperties) {
    return (
        feature.properties.color !== initialProperties.color ||
        feature.properties.opacity !== initialProperties.opacity ||
        feature.properties.size !== initialProperties.size ||
        feature.properties.outlinecolor !== initialProperties.outlinecolor
    );
}

export default DrawControl;


import 'https://unpkg.com/@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.js';
import drawStyles from './draw_styles.js';
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
        this.controlPosition = 'top-right';
    }

    onAdd = (map) => {
        try {
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

            this.map.addControl(this.draw, this.controlPosition);

            this.setupEventListeners();

            return this.container;
        } catch (error) {
            console.error('Error adding DrawControl:', error);
            throw error;
        }
    }

    onRemove = () => {
        try {
            this.map.removeControl(this.draw);
            this.removeEventListeners();
            this.map = undefined;
        } catch (error) {
            console.error('Error removing DrawControl:', error);
            throw error;
        }
    }

    setupEventListeners = () => {
        this.map.on('draw.create', this.handleDrawCreate);
        this.map.on('draw.update', this.handleDrawUpdate);
        this.map.on('draw.delete', this.handleDrawDelete);
        this.map.on('draw.modechange', this.handleDrawModeChange);
    }

    removeEventListeners = () => {
        this.map.off('draw.create', this.handleDrawCreate);
        this.map.off('draw.update', this.handleDrawUpdate);
        this.map.off('draw.delete', this.handleDrawDelete);
        this.map.off('draw.modechange', this.handleDrawModeChange);
    }

    handleDrawCreate = (e) => {
        e.features.forEach(f => {
            const properties = { ...this.defaultProperties, ...f.properties };
            Object.keys(properties).forEach(key => {
                this.draw.setFeatureProperty(f.id, key, properties[key]);
            });
            const type = f.geometry.type.toLowerCase() + 's';
            addFeature(type, f);
        });

        this.toolManager.deactivateCurrentTool();
    }

    handleDrawUpdate = (e) => {
        e.features.forEach(f => {
            const type = f.geometry.type.toLowerCase() + 's';
            updateFeature(type, f);
        });
    }

    handleDrawDelete = (e) => {
        e.features.forEach(f => {
            const type = f.geometry.type.toLowerCase() + 's';
            removeFeature(type, f.id);
        });
    }

    handleDrawModeChange = (e) => {
        const mode = e.mode;
        if (['draw_polygon', 'draw_line_string', 'draw_point'].includes(mode)) {
            this.toolManager.setActiveTool(this);
        }
    }

    activate = () => {
        this.isActive = true;
        this.map.getCanvas().style.cursor = 'crosshair';
    }

    deactivate = () => {
        this.isActive = false;
        this.map.getCanvas().style.cursor = '';
    }

    handleMapClick = () => {
        //nothing to do here
    }

    updateFeaturesProperty = (features, property, value) => {
        features.forEach(feature => {
            feature.properties[property] = value;
            this.draw.setFeatureProperty(feature.id, property, value);
            const feat = this.draw.get(feature.id);
            this.draw.add(feat);
        });
    }

    updateFeatures = (features, save = false) => {
        features.forEach(feature => {
            Object.keys(feature.properties).forEach(key => {
                this.draw.setFeatureProperty(feature.id, key, feature.properties[key]);
            });
            const feat = this.draw.get(feature.id);
            this.draw.add(feat);
            const type = feat.geometry.type.toLowerCase() + 's';
            if(save){
                updateFeature(type, feat);
            }
        });
    }

    saveFeatures = (features, initialPropertiesMap) => {
        features.forEach(f => {
            if (this.hasFeatureChanged(f, initialPropertiesMap.get(f.id))) {
                const type = f.geometry.type.toLowerCase() + 's';
                updateFeature(type, f);
            }
        });
    }

    discardChangeFeatures = (features, initialPropertiesMap) => {
        features.forEach(f => {
            Object.assign(f.properties, initialPropertiesMap.get(f.id));
        });
        this.updateFeatures(features);
    }

    deleteFeatures = (features) => {
        features.forEach(f => {
            this.draw.delete(f.id);
            const type = f.geometry.type.toLowerCase() + 's';
            removeFeature(type, f.id);
        });
    }

    setDefaultProperties = (properties, commonAttributes) => {
        commonAttributes.forEach(attr => {
            this.defaultProperties[attr] = properties[attr];
        });
    }

    hasFeatureChanged = (feature, initialProperties) => {
        return (
            feature.properties.color !== initialProperties.color ||
            feature.properties.opacity !== initialProperties.opacity ||
            feature.properties.size !== initialProperties.size ||
            feature.properties.outlinecolor !== initialProperties.outlinecolor
        );
    }
};
export default DrawControl;
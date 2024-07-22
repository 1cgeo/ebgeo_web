import { addFeature, updateFeature, removeFeature } from '../store.js';
class AddLOSControl {
    static DEFAULT_PROPERTIES = {
        opacity: 1,
        profile: true,
        measure: false
    };

    constructor(toolManager) {
        this.toolManager = toolManager;
        this.toolManager.textControl = this;
        this.isActive = false;
    }

    onAdd = (map) => {
        this.map = map;
        this.container = document.createElement('div');
        this.container.className = 'mapboxgl-ctrl-group mapboxgl-ctrl';

        const button = document.createElement('button');
        button.className = 'mapbox-gl-draw_ctrl-draw-btn';
        button.innerHTML = 'V1';
        button.title = 'Adicionar linha de visada';
        button.onclick = () => this.toolManager.setActiveTool(this);

        this.container.appendChild(button);

        this.setupEventListeners();

        return this.container;
    }
    
    onRemove = () => {
        try {
            this.uiManager.removeControl(this.container);
            this.removeEventListeners();
            this.map = undefined;
        } catch (error) {
            console.error('Error removing AddLOSControl:', error);
            throw error;
        }
    }

    setupEventListeners = () => {
        this.map.on('mouseenter', 'text-layer', this.handleMouseEnter);
        this.map.on('mouseleave', 'text-layer', this.handleMouseLeave);
    }

    removeEventListeners = () => {
        this.map.off('mouseenter', 'text-layer', this.handleMouseEnter);
        this.map.off('mouseleave', 'text-layer', this.handleMouseLeave);
    }

    activate = () => {
        this.isActive = true;
        this.map.getCanvas().style.cursor = 'crosshair';
    }

    deactivate = () => {
        this.isActive = false;
        this.map.getCanvas().style.cursor = '';
    }

    handleMapClick = (e) => {
        if (this.isActive) {
            this.addTextFeature(e.lngLat, 'Texto');
            this.toolManager.deactivateCurrentTool();
        }
    }

    addTextFeature = (lngLat, text) => {
        const feature = this.createTextFeature(lngLat, text);
        addFeature('los', feature);

        const data = JSON.parse(JSON.stringify(this.map.getSource('los')._data));
        data.features.push(feature);
        this.map.getSource('los').setData(data);
    }

    createTextFeature = (lngLat, text) => {
        return {
            type: 'Feature',
            id: Date.now().toString(),
            properties: { ...AddLOSControl.DEFAULT_PROPERTIES },
            geometry: {
                type: 'LineString',
                coordinates: [lngLat.lng, lngLat.lat]
            }
        };
    }

    handleMouseEnter = (e) => {
        this.map.getCanvas().style.cursor = 'pointer';
    }

    handleMouseLeave = (e) => {
        this.map.getCanvas().style.cursor = '';
    }
    
    updateFeaturesProperty = (features, property, value) => {
        const data = JSON.parse(JSON.stringify(this.map.getSource('los')._data));
        features.forEach(feature => {
            const f = data.features.find(f => f.id === feature.id);
            if (f) {
                f.properties[property] = value;
                feature.properties[property] = value;
            }
        });
        this.map.getSource('los').setData(data);
    }

    updateFeatures = (features, save = false) => {
        const data = JSON.parse(JSON.stringify(this.map.getSource('los')._data));
        features.forEach(feature => {
            const featureIndex = data.features.findIndex(f => f.id === feature.id);
            if (featureIndex !== -1) {
                data.features[featureIndex] = feature;
            }
            if(save){
                updateFeature('los', feature);
            }
        });
        this.map.getSource('los').setData(data);
    }

    saveFeatures = (features, initialPropertiesMap) => {
        features.forEach(f => {
            if (this.hasFeatureChanged(f, initialPropertiesMap.get(f.id))) {
                updateFeature('los', f);
            }
        });
    }

    discartChangeFeatures = (features, initialPropertiesMap) => {
        features.forEach(f => {
            Object.assign(f.properties, initialPropertiesMap.get(f.id));
        });
        this.updateFeatures(features);
    }

    deleteFeatures = (features) => {
        if (features.size === 0) {
            return;
        }
        const data = JSON.parse(JSON.stringify(this.map.getSource('los')._data));
        const idsToDelete = new Set(Array.from(features).map(f => f.id));
        data.features = data.features.filter(f => !idsToDelete.has(f.id));
        this.map.getSource('los').setData(data);

        features.forEach(f => {
            removeFeature('los', f.id);

        });
    }

    setDefaultProperties = (properties) => {
        Object.assign(AddLOSControl.DEFAULT_PROPERTIES, properties);
    }

    hasFeatureChanged = (feature, initialProperties) => {
        return (
            feature.properties.profile !== initialProperties.profile
        );
    }
}

export default AddLOSControl;

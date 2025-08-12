// Path: js\controls_sig\text_tool\add_text_control.js
import { addFeature, updateFeature, removeFeature } from '../store.js';

class AddTextControl {
    static DEFAULT_PROPERTIES = {
        text: '',
        size: 16,
        color: '#000000',
        backgroundColor: '#ffffff',
        rotation: 0,
        justify: 'center',
        source: 'text'
    };

    constructor(toolManager) {
        this.toolManager = toolManager;
        this.selectionManager = toolManager.selectionManager;
        this.toolManager.textControl = this;
        this.isActive = false;
    }

    onAdd = (map) => {
        this.map = map;
        this.container = document.createElement('div');
        this.container.className = 'mapboxgl-ctrl-group mapboxgl-ctrl text-control controls-column-right';

        const button = document.createElement('button');
        button.className = 'mapbox-gl-draw_ctrl-draw-btn';
        button.setAttribute("id", "text-tool");
        button.innerHTML = '<img class="icon-sig-tool" src="./images/icon_text_black.svg" alt="TEXT" />';
        button.title = 'Adicionar texto (T)';
        button.onclick = () => this.toolManager.setActiveTool(this);

        this.container.appendChild(button);

        this.setupEventListeners();

        this.changeButtonColor()

        return this.container;
    }

    changeButtonColor = () => {
        $("#text-tool").html(`<img class="icon-sig-tool" src="./images/icon_text_black.svg" alt="TEXT" />`);
        if (!this.isActive) return
        $("#text-tool").html('<img class="icon-sig-tool" src="./images/icon_text_red.svg" alt="TEXT" />');
    }
    
    onRemove = () => {
        try {
            this.uiManager.removeControl(this.container);
            this.removeEventListeners();
            this.map = undefined;
        } catch (error) {
            console.error('Error removing AddTextControl:', error);
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
        this.changeButtonColor()
    }

    deactivate = () => {
        this.isActive = false;
        this.map.getCanvas().style.cursor = '';
        this.changeButtonColor()
    }

    handleMapClick = (e) => {
        if (this.isActive) {
            this.addTextFeature(e.lngLat, 'Texto');
            this.toolManager.deactivateCurrentTool();
        }
    }

    addTextFeature = async (lngLat, text) => {
        const feature = this.createTextFeature(lngLat, text);
        
        // Salvar no IndexedDB
        await addFeature('texts', feature);

        const data = JSON.parse(JSON.stringify(this.map.getSource('texts')._data));
        data.features.push(feature);
        this.map.getSource('texts').setData(data);

        this.selectionManager.toggleFeatureSelection('text', feature.id, feature)
        this.selectionManager.updateUI()
    }

    createTextFeature = (lngLat, text) => {
        return {
            type: 'Feature',
            id: Date.now().toString(),
            properties: { ...AddTextControl.DEFAULT_PROPERTIES, text },
            geometry: {
                type: 'Point',
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
        const data = JSON.parse(JSON.stringify(this.map.getSource('texts')._data));
        for (const feature of features) {
            const f = data.features.find(f => f.id == feature.id);
            if (f) {
                f.properties[property] = value;
                feature.properties[property] = value;
            }
        }
        this.map.getSource('texts').setData(data);
    }

    updateFeatures = async (features, save = false, onlyUpdateProperties = false) => {
        if(features.length > 0){
            const data = JSON.parse(JSON.stringify(this.map.getSource('texts')._data));
            for (const feature of features) {
                const featureIndex = data.features.findIndex(f => f.id == feature.id);
                if (featureIndex !== -1) {
                    if (onlyUpdateProperties) {
                        // Only update properties of the existing feature
                        Object.assign(data.features[featureIndex].properties, feature.properties);
                    } else {
                        // Replace the entire feature
                        data.features[featureIndex] = feature;
                    }
        
                    if (save) {
                        const featureToUpdate = onlyUpdateProperties ? data.features[featureIndex] : feature;
                        await updateFeature('texts', featureToUpdate);
                    }
                }
            }
            this.map.getSource('texts').setData(data);
        }
    }

    saveFeatures = async (features, initialPropertiesMap) => {
        for (const f of features) {
            if (this.hasFeatureChanged(f, initialPropertiesMap.get(f.id))) {
                await updateFeature('texts', f);
            }
        }
    }

    discardChangeFeatures = async (features, initialPropertiesMap) => {
        features.forEach(f => {
            Object.assign(f.properties, initialPropertiesMap.get(f.id));
        });
        await this.updateFeatures(features, true, true);
    }

    deleteFeatures = async (features) => {
        if (features.size === 0) {
            return;
        }
        const data = JSON.parse(JSON.stringify(this.map.getSource('texts')._data));
        const idsToDelete = new Set(Array.from(features).map(f => String(f.id)));
        data.features = data.features.filter(f => !idsToDelete.has(f.id.toString()));

        this.map.getSource('texts').setData(data);

        for (const f of features) {
            // Remover do IndexedDB
            await removeFeature('texts', f.id);
        }
    }

    setDefaultProperties = (properties) => {
        Object.assign(AddTextControl.DEFAULT_PROPERTIES, properties);
    }

    hasFeatureChanged = (feature, initialProperties) => {
        return (
            feature.properties.text !== initialProperties.text ||
            feature.properties.size !== initialProperties.size ||
            feature.properties.color !== initialProperties.color ||
            feature.properties.backgroundColor !== initialProperties.backgroundColor ||
            feature.properties.rotate !== initialProperties.rotate ||
            feature.properties.justify !== initialProperties.justify
        );
    }
}

export default AddTextControl;
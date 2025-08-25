// Path: js\controls_sig\text_tool\add_text_control.js
import { addFeature, updateFeature, removeFeature } from '../store.js';
import { IDUtils } from '../id_utils.js';

class AddTextControl {
    constructor(toolManager) {
        this.toolManager = toolManager;
        this.selectionManager = toolManager.selectionManager;
        this.toolManager.textControl = this;
        
        this.isActive = false;
        this.selectedFeature = null;

        this.zoomRafId = null;
        this.pendingZoomUpdate = false;
        this.setupZoomListener();
    }

    static DEFAULT_PROPERTIES = {
        text: '',
        size: 16,
        color: '#000000',
        backgroundColor: '#ffffff',
        rotation: 0,
        justify: 'center',
        source: 'text',
        
        createdAtZoom: 0,
        calculatedSize: 16,
        nome: '',
        descricao: '',
        visivel: true,
        bloqueado: false
    };

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
        this.changeButtonColor();

        return this.container;
    }

    changeButtonColor = () => {
        $("#text-tool").html(`<img class="icon-sig-tool" src="./images/icon_text_black.svg" alt="TEXT" />`);
        if (!this.isActive) return;
        $("#text-tool").html('<img class="icon-sig-tool" src="./images/icon_text_red.svg" alt="TEXT" />');
    }

    onRemove = () => {
        try {
            this.uiManager.removeControl(this.container);
            
            this.map.off('zoom', this.handleZoomChange);
            if (this.zoomRafId) {
                cancelAnimationFrame(this.zoomRafId);
                this.zoomRafId = null;
            }
            this.pendingZoomUpdate = false;
            
            this.removeEventListeners();
            this.map = undefined;
        } catch (error) {
            console.error('Error removing AddTextControl:', error);
            throw error;
        }
    }

    setupEventListeners = () => {
        // Event listeners básicos se necessário
    }

    removeEventListeners = () => {
        this.removeHoverListeners();
    }

    // ✅ NOVO - Sistema de zoom (mesmo padrão do brush)
    setupZoomListener = () => {
        if(this.map){
            his.map.on('zoom', this.handleZoomChange);
        }
    }

    handleZoomChange = () => {
        if (!this.pendingZoomUpdate) {
            this.pendingZoomUpdate = true;
            this.zoomRafId = requestAnimationFrame(this.updateAllTextSizes);
        }
    }

    applyZoomCorrections = (features) => {
        const currentZoom = this.map.getZoom();

        return features.map(feature => {
            const zoomDifference = currentZoom - feature.properties.createdAtZoom;
            const scaleFactor = Math.pow(2, zoomDifference);
            feature.properties.calculatedSize = feature.properties.size * scaleFactor <= 255? feature.properties.size * scaleFactor : 255;
            return feature;
        });
    }

    updateAllTextSizes = () => {
        if(!this.map.getSource('texts')){
            return
        }
        const currentZoom = this.map.getZoom();
        const data = JSON.parse(JSON.stringify(this.map.getSource('texts')._data));
        let hasChanges = false;

        data.features.forEach(feature => {
            const zoomDifference = currentZoom - feature.properties.createdAtZoom;
            const scaleFactor = Math.pow(2, zoomDifference);
            const newCalculatedSize = feature.properties.size * scaleFactor <= 255? feature.properties.size * scaleFactor : 255;
            if (feature.properties.calculatedSize !== newCalculatedSize) {
                feature.properties.calculatedSize = newCalculatedSize;
                hasChanges = true;
            }
        });

        if (hasChanges) {
            this.map.getSource('texts').setData(data);
        }

        this.pendingZoomUpdate = false;
    }

    activate = () => {
        this.isActive = true;
        this.map.getCanvas().style.cursor = 'crosshair';
        this.changeButtonColor();
    }

    deactivate = () => {
        this.isActive = false;
        this.map.getCanvas().style.cursor = '';
        this.changeButtonColor();
        this.deselectFeature();
    }

    handleMapClick = (e) => {
        if (this.isActive) {
            this.addTextFeature(e.lngLat, 'Texto');
            this.toolManager.deactivateCurrentTool();
        }
    }

    addTextFeature = async (lngLat, text) => {
        const feature = this.createTextFeature(lngLat, text);
        feature.properties.id = IDUtils.generateUniqueId();
        
        feature.properties.nome = IDUtils.generateFeatureName('text', this.map);
        
        const currentZoom = this.map.getZoom();
        feature.properties.createdAtZoom = currentZoom;
        feature.properties.calculatedSize = feature.properties.size;
        
        // Salvar no IndexedDB
        await addFeature('texts', feature);

        const data = JSON.parse(JSON.stringify(this.map.getSource('texts')._data));
        data.features.push(feature);
        this.map.getSource('texts').setData(data);

        this.selectionManager.toggleFeatureSelection('text', feature.properties.id, feature);
        this.selectionManager.updateUI();
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

    // ===== SELECTION SYSTEM INTEGRATION ===== 

    onFeatureSelected = (feature) => {
        this.selectedFeature = feature;
        this.setupHoverListeners();
    }

    onFeatureDeselected = (feature) => {
        const featureId = feature.properties.id;
        if (this.selectedFeature && this.selectedFeature.properties.id === featureId) {
            this.deselectFeature();
        }
    }

    onGlobalDeselect = () => {
        if (this.selectedFeature) {
            this.deselectFeature();
        }
    }

    deselectFeature = () => {
        this.selectedFeature = null;
        this.removeHoverListeners();
        this.map.getCanvas().style.cursor = '';
    }

    setupHoverListeners = () => {
        this.map.on('mousemove', this.onHoverMove);
    }

    removeHoverListeners = () => {
        this.map.off('mousemove', this.onHoverMove);
    }

    onHoverMove = (e) => {
        if (!this.selectedFeature) return;
        
        const features = this.map.queryRenderedFeatures(e.point);
        const hasSelectedFeature = features.some(f => 
            f.source === 'texts' && 
            f.properties.id === this.selectedFeature.properties.id
        );
        
        this.map.getCanvas().style.cursor = hasSelectedFeature ? 'move' : '';
    }

    isEditingMode = () => {
        return false;
    }

    hasEditHandle = (featureId) => {
        return false;
    }

    syncEditHandlesAfterDrag = (movedFeatures) => {
        // N/A
    }

    // ===== FEATURE MANAGEMENT METHODS =====
    
    updateFeaturesProperty = (features, property, value) => {
        const data = JSON.parse(JSON.stringify(this.map.getSource('texts')._data));
        for (const feature of features) {
            const f = data.features.find(f => f.properties.id == feature.properties.id);
            if (f) {
                f.properties[property] = value;
                feature.properties[property] = value;

                if (property === 'size') {
                    const currentZoom = this.map.getZoom();
                    const zoomDifference = currentZoom - f.properties.createdAtZoom;
                    const scaleFactor = Math.pow(2, zoomDifference);
                    const newCalculatedSize = value * scaleFactor <= 255? value * scaleFactor : 255;
                    f.properties.calculatedSize = newCalculatedSize;
                    feature.properties.calculatedSize = newCalculatedSize;
                }
            }
        }
        this.map.getSource('texts').setData(data);
    }

    updateFeatures = async (features, save = false, onlyUpdateProperties = false) => {
        if (features.length > 0) {
            const data = JSON.parse(JSON.stringify(this.map.getSource('texts')._data));
            for (const feature of features) {
                const featureIndex = data.features.findIndex(f => f.properties.id == feature.properties.id);
                if (featureIndex !== -1) {
                    if (onlyUpdateProperties) {
                        Object.assign(data.features[featureIndex].properties, feature.properties);
                    } else {
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
        const currentData = this.map.getSource('texts')._data;

        for (const selectedFeature of features) {
            if (this.hasFeatureChanged(selectedFeature, initialPropertiesMap.get(selectedFeature.properties.id))) {
                const currentFeature = currentData.features.find(f => f.properties.id == selectedFeature.properties.id);

                if (currentFeature) {
                    const featureToSave = {
                        ...currentFeature,
                        properties: { ...selectedFeature.properties }
                    };
                    await updateFeature('texts', featureToSave);
                }
            }
        }
    }

    discardChangeFeatures = async (features, initialPropertiesMap) => {
        features.forEach(f => {
            Object.assign(f.properties, initialPropertiesMap.get(f.properties.id));
        });
        await this.updateFeatures(features, true, true);
    }

    deleteFeatures = async (features) => {
        if (features.size === 0) {
            return;
        }
        const data = JSON.parse(JSON.stringify(this.map.getSource('texts')._data));
        const idsToDelete = new Set(Array.from(features).map(f => String(f.properties.id)));
        data.features = data.features.filter(f => !idsToDelete.has(f.properties.id.toString()));

        this.map.getSource('texts').setData(data);

        for (const f of features) {
            await removeFeature('texts', f.properties.id);
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
            feature.properties.rotation !== initialProperties.rotation ||
            feature.properties.justify !== initialProperties.justify ||
            feature.properties.nome !== initialProperties.nome ||
            feature.properties.descricao !== initialProperties.descricao ||
            feature.properties.visivel !== initialProperties.visivel ||
            feature.properties.bloqueado !== initialProperties.bloqueado
        );
    }
}

export default AddTextControl;
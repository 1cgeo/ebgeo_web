// Path: js/controls_sig/draw_tools/add_point_control.js
import { addFeature, updateFeature, removeFeature } from '../store.js';
import { IDUtils } from '../id_utils.js';

class AddPointControl {
    constructor(toolManager) {
        this.toolManager = toolManager;
        this.selectionManager = toolManager.selectionManager;

        // Core state
        this.isActive = false;
        this.selectedFeature = null;
    }

    static DEFAULT_PROPERTIES = {
        color: '#fbb03b',
        size: 10,
        opacity: 1,
        source: 'point',
        nome: '',
        descricao: '',
        visivel: true,
        bloqueado: false
    };

    // ===== MAPBOX CONTROL INTERFACE =====

    onAdd = (map) => {
        this.map = map;
        this.container = document.createElement('div');
        this.container.className = 'mapboxgl-ctrl-group mapboxgl-ctrl point-control controls-column-right';

        const button = document.createElement('button');
        button.className = 'mapbox-gl-draw_ctrl-draw-btn';
        button.setAttribute("id", "point-tool");
        button.innerHTML = '<img class="icon-sig-tool" src="./images/icon_point_black.svg" alt="POINT" />';
        button.title = 'Adicionar ponto (P)';
        button.onclick = () => this.toolManager.setActiveTool(this);

        this.container.appendChild(button);
        this.updateButtonAppearance();

        return this.container;
    }

    onRemove = () => {
        try {
            if (this.selectionManager && this.selectionManager.uiManager) {
                this.selectionManager.uiManager.removeControl(this.container);
            }
            this.deactivate();
            this.map = undefined;
        } catch (error) {
            console.error('Error removing AddPointControl:', error);
            throw error;
        }
    }

    // ===== TOOL ACTIVATION/DEACTIVATION =====

    activate = () => {
        this.isActive = true;
        this.map.getCanvas().style.cursor = 'crosshair';
        this.updateButtonAppearance();
    }

    deactivate = () => {
        this.isActive = false;
        this.map.getCanvas().style.cursor = '';
        this.updateButtonAppearance();
        this.deselectFeature();
    }

    updateButtonAppearance = () => {
        const iconSrc = this.isActive ?
            './images/icon_point_red.svg' :
            './images/icon_point_black.svg';
        $(`#point-tool`).html(`<img class="icon-sig-tool" src="${iconSrc}" alt="POINT" />`);
    }

    // ===== SIMPLIFIED STATE MANAGEMENT =====

    selectFeature = (feature) => {
        this.selectedFeature = feature;
        this.setupHoverListeners();
    }

    deselectFeature = () => {
        this.selectedFeature = null;
        this.removeHoverListeners();
        this.map.getCanvas().style.cursor = '';
    }

    // ===== HOVER SYSTEM FOR DYNAMIC CURSOR =====

    setupHoverListeners = () => {
        this.map.on('mousemove', this.onHoverMove);
    }

    removeHoverListeners = () => {
        this.map.off('mousemove', this.onHoverMove);
    }

    onHoverMove = (e) => {
        if (!this.selectedFeature) return;

        const features = this.map.queryRenderedFeatures(e.point);
        const hasFeature = this.hasSelectedFeatureAtPoint(features);

        this.map.getCanvas().style.cursor = hasFeature ? 'move' : '';
    }

    hasSelectedFeatureAtPoint = (features) => {
        if (!this.selectedFeature) return false;
        return features.some(f =>
            f.source === 'points' &&
            f.properties.id === this.selectedFeature.properties.id
        );
    }

    // ===== SELECTION SYSTEM INTEGRATION =====

    onFeatureSelected = (feature) => {
        this.selectFeature(feature);
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

    // Interface for move_handler integration
    isEditingMode = () => {
        return false; // Points don't have editing mode with handles
    }

    hasEditHandle = (featureId) => {
        return false; // Points don't have handles
    }

    syncEditHandlesAfterDrag = (movedFeatures) => {
        // N/A - Points don't have handles to sync
    }

    // ===== DRAWING SYSTEM =====

    handleMapClick = async (e) => {
        if (!this.isActive) return;

        if (!e.lngLat || isNaN(e.lngLat.lng) || isNaN(e.lngLat.lat)) {
            console.warn('Coordenadas inválidas para ponto');
            return;
        }
        await this.createPointAtCoordinates(e.lngLat.lng, e.lngLat.lat);
        this.toolManager.deactivateCurrentTool();
    }

    // ===== SPECIAL METHOD FOR MOUSE COORDINATES =====

    createPointAtCoordinates = async (lng, lat) => {
        const featureId = IDUtils.generateUniqueId();
        const featureName = IDUtils.generateFeatureName('point', this.map);

        const feature = {
            type: 'Feature',
            id: Date.now().toString(),
            properties: {
                ...AddPointControl.DEFAULT_PROPERTIES,
                id: featureId,
                nome: featureName
            },
            geometry: {
                type: 'Point',
                coordinates: [lng, lat]
            }
        };

        try {
            await addFeature('points', feature);

            const data = JSON.parse(JSON.stringify(this.map.getSource('points')._data));
            data.features.push(feature);
            this.map.getSource('points').setData(data);

            this.selectionManager.toggleFeatureSelection('point', feature.properties.id, feature);
            this.selectionManager.updateUI();

            return feature;
        } catch (error) {
            console.error('Erro ao criar ponto:', error);
        }
    }

    // ===== FEATURE MANAGEMENT METHODS =====

    updateFeaturesProperty = (features, property, value) => {
        const data = JSON.parse(JSON.stringify(this.map.getSource('points')._data));

        for (const feature of features) {
            const sourceFeature = data.features.find(f => f.properties.id == feature.properties.id);
            if (sourceFeature) {
                sourceFeature.properties[property] = value;
                feature.properties[property] = value;
            }
        }

        this.map.getSource('points').setData(data);

        if (this.selectedFeature && !this.isDraggingHandle) {
            // Points don't have handles, so just update selection
            this.selectFeature(this.selectedFeature);
        }
    }

    updateFeatures = async (features, save = false, onlyUpdateProperties = false) => {
        if (features.length > 0) {
            const data = JSON.parse(JSON.stringify(this.map.getSource('points')._data));

            for (const feature of features) {
                const featureIndex = data.features.findIndex(f => f.properties.id == feature.properties.id);
                if (featureIndex !== -1) {
                    if (onlyUpdateProperties) {
                        Object.assign(data.features[featureIndex].properties, feature.properties);
                    } else {
                        data.features[featureIndex] = feature;
                    }

                    if (save) {
                        const featureToUpdate = onlyUpdateProperties ?
                            data.features[featureIndex] : feature;
                        await updateFeature('points', featureToUpdate);
                    }
                }
            }

            this.map.getSource('points').setData(data);
        }
    }

    saveFeatures = async (features, initialPropertiesMap) => {
        const currentData = this.map.getSource('points')._data;

        for (const selectedFeature of features) {
            if (this.hasFeatureChanged(selectedFeature, initialPropertiesMap.get(selectedFeature.properties.id))) {
                const currentFeature = currentData.features.find(f => f.properties.id == selectedFeature.properties.id);

                if (currentFeature) {
                    const featureToSave = {
                        ...currentFeature,
                        properties: { ...selectedFeature.properties }
                    };
                    await updateFeature('points', featureToSave);
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
        if (features.length === 0) return;

        for (const feature of features) {
            try {
                const featureId = feature.properties.id;
                await removeFeature('points', featureId);
            } catch (error) {
                console.error(`Error removing point ${featureId}:`, error);
            }
        }

        // Remove from map source (visual)
        const data = JSON.parse(JSON.stringify(this.map.getSource('points')._data));
        const idsToDelete = new Set(features.map(f => String(f.properties.id)));
        data.features = data.features.filter(f => !idsToDelete.has(String(f.properties.id)));
        this.map.getSource('points').setData(data);
    }

    setDefaultProperties = (properties) => {
        Object.assign(AddPointControl.DEFAULT_PROPERTIES, properties);
    }

    hasFeatureChanged = (feature, initialProperties) => {
        if (!initialProperties) return true;

        return (
            feature.properties.color !== initialProperties.color ||
            feature.properties.size !== initialProperties.size ||
            feature.properties.opacity !== initialProperties.opacity ||
            feature.properties.nome !== initialProperties.nome ||
            feature.properties.descricao !== initialProperties.descricao ||
            feature.properties.visivel !== initialProperties.visivel ||
            feature.properties.bloqueado !== initialProperties.bloqueado
        );
    }
}

export default AddPointControl;
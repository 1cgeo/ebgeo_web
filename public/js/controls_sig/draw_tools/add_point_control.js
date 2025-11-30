// Path: js\controls_sig\draw_tools\add_point_control.js

import { addFeature, updateFeature, removeFeature, getActiveLayerIdSync } from '../store/store.js';
import { IDUtils } from '../id_utils.js';
import { addPointAttributesToPanel } from './point_attributes_panel.js';
import AddPointGeometry from './add_point_geometry.js';
import BaseControl from '../tool_manager/base_control.js';

class AddPointControl extends BaseControl {
    constructor(toolManager) {
        super(toolManager);

        // Geometry handler
        this.geometry = new AddPointGeometry();
    }

    static DEFAULT_PROPERTIES = {
        color: '#fbb03b',
        size: 10,
        opacity: 1,
        outlinecolor: '#fbb03b',
        source: 'point',
        nome: '',
        descricao: '',
        visivel: true,
        bloqueado: false
    };

    // ===== FONTE ÚNICA DA VERDADE =====

    /**
     * Get currently selected point feature from SelectionManager
     * @returns {Object|null} Selected point feature or null
     */
    getSelectedFeature() {
        const selectedItems = this.selectionManager.getSelectedFeaturesByType('point');
        return selectedItems.length > 0 ? selectedItems[0].feature : null;
    }

    /**
     * Get all selected point features from SelectionManager
     * @returns {Array} Array of selected point features
     */
    getSelectedFeatures() {
        return this.selectionManager.getSelectedFeaturesByType('point')
            .map(item => item.feature);
    }

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
        this.setupBaseEventListeners();
        this.updateButtonAppearance();

        return this.container;
    }

    onRemove = () => {
        try {
            this.selectionManager.uiManager.removeControl(this.container);
            this.deactivate();
            this.removeAllEventListeners();
            this.map = undefined;
        } catch (error) {
            console.error('Error removing AddPointControl:', error);
            throw error;
        }
    }

    // ===== TOOL-CENTRIC INTERFACE IMPLEMENTATIONS =====

    hasAttributePanel() {
        return true;
    }

    createAttributePanel(container, features, selectionManager, uiManager) {
        const sectionPanel = document.createElement('div');
        sectionPanel.className = 'point-attributes-section';

        try {
            addPointAttributesToPanel(sectionPanel, features, this, selectionManager, uiManager);
            container.appendChild(sectionPanel);
        } catch (error) {
            console.error('Error creating point attribute panel:', error);
        }
    }

    getDragSources() {
        return ['points'];
    }

    getEditHandleSources() {
        return []; // Point features don't have edit handles
    }

    createSelectionBox(feature) {
        try {
            const coordinates = feature.geometry.coordinates;
            const zoom = this.map.getZoom();
            const paddingPixels = this.getSelectionBoxPadding();
            
            return this.geometry.createSelectionBoxGeometry(coordinates, paddingPixels, zoom);
        } catch (error) {
            console.warn('Error creating point selection box:', error);
            return null;
        }
    }

    getSelectionBoxStrategy() {
        return 'custom'; // Point uses custom selection box calculation
    }

    getSelectionBoxPadding() {
        return 15; // Larger padding for point features to make them easier to select
    }

    getLayerIds() {
        return ['point-layer'];
    }

    getSourceNames() {
        return ['points'];
    }

    getEditHandleSource() {
        return null; // Point features don't have edit handles
    }

    canCopy(feature) {
        return true;
    }

    canPaste(feature) {
        return true;
    }

    prepareForPaste(feature, offset) {
        // Apply offset to point coordinates using geometry class
        const newCoordinates = this.geometry.applyOffset(
            feature.geometry.coordinates, 
            offset.dx, 
            offset.dy
        );

        return {
            ...feature,
            geometry: {
                ...feature.geometry,
                coordinates: newCoordinates
            }
        };
    }

    calculateMoveOffset(feature, referencePoint) {
        // Use geometry class to get center point (same as coordinates for points)
        const centerPoint = this.geometry.getCenter(feature.geometry.coordinates);
        if (!centerPoint) {
            return [0, 0];
        }

        return [
            centerPoint[0] - referencePoint.lng,
            centerPoint[1] - referencePoint.lat
        ];
    }

    updateFeatureForMove(feature, dx, dy, newCoords) {
        // Use geometry class to apply offset to coordinates
        const newCoordinates = this.geometry.applyOffset(
            feature.geometry.coordinates, 
            dx, 
            dy
        );

        return {
            ...feature,
            geometry: {
                ...feature.geometry,
                coordinates: newCoordinates
            }
        };
    }

    canMove(feature) {
        return !feature.properties?.bloqueado;
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
    }

    updateButtonAppearance = () => {
        const iconSrc = this.isActive ?
            './images/icon_point_red.svg' :
            './images/icon_point_black.svg';
        $("#point-tool").html(`<img class="icon-sig-tool" src="${iconSrc}" alt="POINT" />`);
    }

    // ===== SELECTION SYSTEM INTEGRATION (NO EDIT HANDLES) =====

    onFeatureSelected = (feature) => {
        // Point features don't have edit handles - just show selection highlight
    }

    onFeatureDeselected = (feature) => {
        // No handles to clean up
    }

    onGlobalDeselect = () => {
        // No handles to clean up
    }

    isEditingMode = () => {
        return false; // Point features are not editable via handles
    }

    hasEditHandle = (featureId) => {
        return false; // Point features don't have edit handles
    }

    syncEditHandlesAfterDrag = (movedFeatures) => {
        // No handles to sync for point features
    }

    // ===== DRAWING SYSTEM =====

    handleMapClick = async (e) => {
        if (!this.isActive) return;

        if (!e.lngLat || isNaN(e.lngLat.lng) || isNaN(e.lngLat.lat)) {
            console.warn('Coordenadas inválidas para ponto');
            return;
        }

        await this.createPointAtCoordinates(e.lngLat.lng, e.lngLat.lat);
    }

    /**
     * Create point at specific coordinates
     * @param {number} lng - Longitude
     * @param {number} lat - Latitude
     * @returns {Object|null} Created feature or null if error
     */
    createPointAtCoordinates = async (lng, lat) => {
        const coordinates = [lng, lat];

        if (!this.geometry.validate(coordinates)) {
            console.warn('Coordenadas inválidas para ponto');
            return null;
        }

        const featureId = IDUtils.generateUniqueId();
        const featureName = await IDUtils.generateFeatureName('point', this.map);

        const feature = {
            type: 'Feature',
            id: Date.now().toString(),
            properties: {
                ...AddPointControl.DEFAULT_PROPERTIES,
                layerId: getActiveLayerIdSync(),
                id: featureId,
                nome: featureName
            },
            geometry: this.geometry.generate(coordinates)
        };

        try {
            await addFeature('points', feature);

            const data = await this.map.getSource('points').getData();
            data.features.push(feature);
            this.map.getSource('points').setData(data);

            this.toolManager.deactivateCurrentTool();
            this.selectionManager.toggleFeatureSelection('point', featureId, feature);
            this.selectionManager.updateUI();

            return feature;
        } catch (error) {
            console.error('Erro ao criar ponto:', error);
            return null;
        }
    }

    // ===== FEATURE MANAGEMENT INTERFACE =====

    updateFeaturesProperty = async (features, property, value) => {
        const data = await this.map.getSource('points').getData();

        for (const feature of features) {
            const sourceFeature = data.features.find(f => f.properties.id == feature.properties.id);
            if (sourceFeature) {
                sourceFeature.properties[property] = value;
                feature.properties[property] = value;
            }
        }

        this.map.getSource('points').setData(data);

        // CRITICAL FIX: Get fresh features from map source before updating SelectionManager
        const freshFeatures = features.map(feature => {
            const sourceFeature = data.features.find(f => f.properties.id == feature.properties.id);
            return sourceFeature || feature; // Fallback to original if not found
        });

        // Update SelectionManager with fresh features
        this.updateSelectionManagerFeatures(freshFeatures);
    }

    saveFeatures = async (features, initialPropertiesMap) => {
        // CRITICAL FIX: Always get fresh feature data from map source before saving
        const currentData = await this.map.getSource('points').getData();
        let hasChanges = false;

        for (const selectedFeature of features) {
            if (this.hasFeatureChanged(selectedFeature, initialPropertiesMap.get(selectedFeature.properties.id))) {
                const currentFeature = currentData.features.find(f => f.properties.id == selectedFeature.properties.id);

                if (currentFeature) {
                    // Use complete current feature (with updated geometry + properties)
                    await updateFeature('points', currentFeature);
                    hasChanges = true;
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
                const data = await this.map.getSource('points').getData();
                const idsToDelete = new Set(features.map(f => String(f.properties.id)));
                data.features = data.features.filter(f => !idsToDelete.has(String(f.properties.id)));
                this.map.getSource('points').setData(data);
            } catch (error) {
                console.error(`Error removing point ${feature.properties.id}:`, error);
            }
        }
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
            feature.properties.outlinecolor !== initialProperties.outlinecolor ||
            feature.properties.nome !== initialProperties.nome ||
            feature.properties.descricao !== initialProperties.descricao ||
            feature.properties.visivel !== initialProperties.visivel ||
            feature.properties.bloqueado !== initialProperties.bloqueado
        );
    }

    updateFeatures = async (features, save = false, onlyUpdateProperties = false) => {
        if (features.length > 0) {
            const data = await this.map.getSource('points').getData();
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

            // Update SelectionManager with updated features
            this.updateSelectionManagerFeatures(features);
        }
    }

    // ===== SELECTION MANAGER INTEGRATION =====

    /**
     * Update SelectionManager with current feature data
     */
    updateSelectionManagerFeature(feature) {
        const key = `point:${feature.properties.id}`;
        this.selectionManager.selectedFeatures.set(key, { type: 'point', feature });
    }

    /**
     * Update SelectionManager with multiple features
     */
    updateSelectionManagerFeatures(features) {
        features.forEach(feature => {
            if (feature.properties.source === 'point') {
                this.updateSelectionManagerFeature(feature);
            }
        });
    }

    // ===== UTILITY METHODS =====

    setupBaseEventListeners = () => {
        // Base listeners setup if needed
    }

    removeAllEventListeners = () => {
        // Clean up any event listeners specific to point tool
    }
}

export default AddPointControl;
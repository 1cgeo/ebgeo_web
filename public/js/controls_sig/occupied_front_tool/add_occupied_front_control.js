// Path: js\controls_sig\occupied_front_tool\add_occupied_front_control.js

import { addFeature, updateFeature, removeFeature } from '../store/store.js';
import { IDUtils } from '../id_utils.js';
import { addOccupiedFrontAttributesToPanel } from './occupied_front_attributes_panel.js';
import AddOccupiedFrontGeometry from './add_occupied_front_geometry.js';
import BaseControl from '../tool_manager/base_control.js';

class AddOccupiedFrontControl extends BaseControl {
    constructor(toolManager) {
        super(toolManager);

        // State management
        this.drawPoints = [];
        this.isDraggingHandle = false;
        this.activeHandleType = null;

        // Geometry handler
        this.geometry = new AddOccupiedFrontGeometry();

        // Performance optimization - RAF system
        this.previewRafId = null;
        this.pendingPreviewUpdate = false;
        this.lastPreviewPosition = null;
        this.lastPreviewCenter = null;
        this.geometryDebounceTimer = null;
    }

    static DEFAULT_PROPERTIES = {
        color: '#000000',
        lineWidth: 4,
        opacity: 1.0,
        source: 'occupied_front',
        nome: '',
        descricao: '',
        visivel: true,
        bloqueado: false
    };

    // ===== FONTE ÚNICA DA VERDADE =====

    /**
     * Get currently selected occupied front feature from SelectionManager
     * @returns {Object|null} Selected occupied front feature or null
     */
    getSelectedFeature() {
        const selectedItems = this.selectionManager.getSelectedFeaturesByType('occupied_front');
        return selectedItems.length > 0 ? selectedItems[0].feature : null;
    }

    /**
     * Get all selected occupied front features from SelectionManager
     * @returns {Array} Array of selected occupied front features
     */
    getSelectedFeatures() {
        return this.selectionManager.getSelectedFeaturesByType('occupied_front')
            .map(item => item.feature);
    }

    // ===== MAPBOX CONTROL INTERFACE =====

    onAdd = (map) => {
        this.map = map;
        this.container = document.createElement('div');
        this.container.className = 'mapboxgl-ctrl-group mapboxgl-ctrl occupied-front-control controls-column-right';

        const button = document.createElement('button');
        button.className = 'mapbox-gl-draw_ctrl-draw-btn';
        button.setAttribute("id", "occupied-front-tool");
        button.innerHTML = '<img class="icon-sig-tool" src="./images/icon_occupied_front_black.svg" alt="FRENTE OCUPADA" />';
        button.title = 'Adicionar Frente Ocupada (F)';
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
            console.error('Error removing AddOccupiedFrontControl:', error);
            throw error;
        }
    }

    // ===== TOOL-CENTRIC INTERFACE IMPLEMENTATIONS =====

    hasAttributePanel() {
        return true;
    }

    createAttributePanel(container, features, selectionManager, uiManager) {
        const sectionPanel = document.createElement('div');
        sectionPanel.className = 'occupied-front-attributes-section';

        try {
            addOccupiedFrontAttributesToPanel(sectionPanel, features, this, selectionManager, uiManager);
            container.appendChild(sectionPanel);
        } catch (error) {
            console.error('Error creating occupied front attribute panel:', error);
        }
    }

    getDragSources() {
        return ['occupied_fronts'];
    }

    getEditHandleSources() {
        return ['occupied-front-edit-handles'];
    }

    createSelectionBox(feature) {
        try {
            const bbox = turf.bbox(feature);
            const expandedBbox = this.expandBboxWithPadding(bbox, this.getSelectionBoxPadding());
            return turf.bboxPolygon(expandedBbox);
        } catch (error) {
            console.warn('Error creating occupied front selection box:', error);
            return null;
        }
    }

    getSelectionBoxStrategy() {
        return 'bbox';
    }

    getSelectionBoxPadding() {
        return 8; // Slightly larger padding for complex geometry
    }

    getLayerIds() {
        return ['occupied-front-layer'];
    }

    getSourceNames() {
        return ['occupied_fronts'];
    }

    getEditHandleSource() {
        return 'occupied-front-edit-handles';
    }

    canCopy(feature) {
        return true;
    }

    canPaste(feature) {
        return true;
    }

    prepareForPaste(feature, offset) {
        const oldCoords = this.geometry.normalizeBaseCoordinates(feature.properties.baseCoordinates);

        const newCoords = oldCoords.map(coord => [
            coord[0] + offset.dx,
            coord[1] + offset.dy
        ]);

        return {
            ...feature,
            properties: {
                ...feature.properties,
                baseCoordinates: newCoords
            },
            geometry: this.geometry.generate(newCoords)
        };
    }

    calculateMoveOffset(feature, referencePoint) {
        // Use the first coordinate (p1 - origin) as reference for movement
        const coords = this.geometry.normalizeBaseCoordinates(feature.properties.baseCoordinates);
        if (!coords || coords.length < 1) {
            return [0, 0];
        }

        const origin = coords[0]; // p1 is the origin point
        return [
            origin[0] - referencePoint.lng,
            origin[1] - referencePoint.lat
        ];
    }

    updateFeatureForMove(feature, dx, dy, newCoords) {
        const coords = this.geometry.normalizeBaseCoordinates(feature.properties.baseCoordinates);
        if (!coords || coords.length < 3) {
            return feature;
        }

        // Move all base coordinates by the same delta
        const newBaseCoords = coords.map(coord => [
            coord[0] + dx,
            coord[1] + dy
        ]);

        const updatedFeature = {
            ...feature,
            properties: {
                ...feature.properties,
                baseCoordinates: newBaseCoords
            },
            geometry: this.geometry.generate(newBaseCoords)
        };

        return updatedFeature;
    }

    canMove(feature) {
        return !feature.properties?.bloqueado;
    }

    // ===== TOOL ACTIVATION/DEACTIVATION =====

    activate = () => {
        this.isActive = true;
        this.drawPoints = [];
        this.map.getCanvas().style.cursor = 'crosshair';
        this.updateButtonAppearance();
    }

    deactivate = () => {
        this.isActive = false;
        this.drawPoints = [];
        this.map.getCanvas().style.cursor = '';
        this.updateButtonAppearance();
        this.clearPreview();
        this.deselectFeature();
    }

    updateButtonAppearance = () => {
        const iconSrc = this.isActive ?
            './images/icon_occupied_front_red.svg' :
            './images/icon_occupied_front_black.svg';
        $("#occupied-front-tool").html(`<img class="icon-sig-tool" src="${iconSrc}" alt="FRENTE OCUPADA" />`);
    }

    // ===== SELECTION SYSTEM INTEGRATION =====

    onFeatureSelected = (feature) => {
        this.selectFeature(feature);
    }

    onFeatureDeselected = (feature) => {
        const selectedFeature = this.getSelectedFeature();
        const featureId = feature.properties.id;
        if (selectedFeature && selectedFeature.properties.id === featureId) {
            this.deselectFeature();
        }
    }

    onGlobalDeselect = () => {
        const selectedFeature = this.getSelectedFeature();
        if (selectedFeature) {
            this.deselectFeature();
        }
    }

    isEditingMode = () => {
        return false;
    }

    hasEditHandle = (featureId) => {
        const selectedFeature = this.getSelectedFeature();
        return selectedFeature && selectedFeature.properties.id === featureId;
    }

    syncEditHandlesAfterDrag = (movedFeatures) => {
        const selectedFeature = this.getSelectedFeature();
        if (selectedFeature && !this.isDraggingHandle) {
            // Always recreate handles with current feature data
            this.createEditHandles(selectedFeature);
        }
    }

    // ===== DRAWING SYSTEM =====

    handleMapClick = (e) => {
        if (!this.isActive) return;

        if (!e.lngLat || isNaN(e.lngLat.lng) || isNaN(e.lngLat.lat)) {
            console.warn('Coordenadas inválidas para frente ocupada');
            return;
        }

        this.drawPoints.push([e.lngLat.lng, e.lngLat.lat]);

        if (this.drawPoints.length === 1) {
            this.map.on('mousemove', this.handlePreviewMouseMove);
        } else if (this.drawPoints.length === 2) {
            this.map.off('mousemove', this.handlePreviewMouseMove);
            this.createFeature();
            this.toolManager.deactivateCurrentTool();
        }
    }

    handlePreviewMouseMove = (e) => {
        if (this.drawPoints.length === 1) {
            this.lastPreviewCenter = this.drawPoints[0];
            this.lastPreviewPosition = [e.lngLat.lng, e.lngLat.lat];

            if (!this.pendingPreviewUpdate) {
                this.pendingPreviewUpdate = true;
                this.previewRafId = requestAnimationFrame(this.performPreviewUpdate);
            }
        }
    }

    performPreviewUpdate = () => {
        if (!this.lastPreviewPosition) {
            this.pendingPreviewUpdate = false;
            return;
        }

        const selectedFeature = this.getSelectedFeature();
        if (this.isDraggingHandle && selectedFeature) {
            this.updateOccupiedFrontPreview(this.lastPreviewPosition);
        } else if (this.drawPoints.length === 1 && this.lastPreviewCenter) {
            const p1 = this.lastPreviewCenter;
            const p2 = this.lastPreviewPosition;

            // Calculate P3 automatically with 50° angle
            const distance = this.geometry.calculateDistance(p1, p2);
            const bearing = this.geometry.calculateBearing(p1, p2);
            const p3 = this.geometry.destination(p1, distance, bearing + 50);

            if (distance >= 10) {
                clearTimeout(this.geometryDebounceTimer);
                this.geometryDebounceTimer = setTimeout(() => {
                    const previewGeometry = this.geometry.generate([p1, p2, p3]);
                    this.showPreview(previewGeometry);
                }, 12); // More debouncing for complex geometry
            }
        }

        this.pendingPreviewUpdate = false;
    }

    showPreview = (geometry) => {
        this.map.getSource('occupied-front-feedback').setData({
            type: 'Feature',
            geometry: geometry,
            properties: {
                isPreview: true,
                color: AddOccupiedFrontControl.DEFAULT_PROPERTIES.color,
                lineWidth: AddOccupiedFrontControl.DEFAULT_PROPERTIES.lineWidth,
                opacity: 0.7
            }
        });
    }

    clearPreview = () => {
        this.map.off('mousemove', this.handlePreviewMouseMove);
        this.cancelPendingUpdates();
        if (this.map && this.map.getSource('occupied-front-feedback')) {
            this.map.getSource('occupied-front-feedback').setData({
                type: 'FeatureCollection',
                features: []
            });
        }
    }

    createFeature = async () => {
        const p1 = this.drawPoints[0]; // Origin
        const p2 = this.drawPoints[1]; // Upper arm

        // Calculate P3 automatically with 50° angle
        const distance = this.geometry.calculateDistance(p1, p2);
        const bearing = this.geometry.calculateBearing(p1, p2);
        const p3 = this.geometry.destination(p1, distance, bearing + 50);

        if (distance < 10) {
            alert('Distância mínima: 10 metros');
            this.drawPoints = [];
            return;
        }

        const featureId = IDUtils.generateUniqueId();
        const featureName = IDUtils.generateFeatureName('occupied_front', this.map);
        const coordinates = [p1, p2, p3];

        const feature = {
            type: 'Feature',
            id: Date.now().toString(),
            properties: {
                ...AddOccupiedFrontControl.DEFAULT_PROPERTIES,
                id: featureId,
                nome: featureName,
                baseCoordinates: coordinates
            },
            geometry: this.geometry.generate(coordinates)
        };

        try {
            await addFeature('occupied_fronts', feature);

            const data = JSON.parse(JSON.stringify(this.map.getSource('occupied_fronts')._data));
            data.features.push(feature);
            this.map.getSource('occupied_fronts').setData(data);

            this.drawPoints = [];
            this.toolManager.setActiveTool(null);
            this.selectionManager.toggleFeatureSelection('occupied_front', featureId, feature);
            this.selectionManager.updateUI();
        } catch (error) {
            console.error('Erro ao criar frente ocupada:', error);
        }
    }

    // ===== EDIT HANDLES SYSTEM =====

    selectFeature = (feature) => {
        // SelectionManager já armazena a feature, só precisamos criar handles
        this.createEditHandles(feature);
        this.setupEditEventListeners();
        this.setupHoverListeners();
    }

    deselectFeature = () => {
        // SelectionManager já remove a feature, só precisamos limpar UI
        this.isDraggingHandle = false;
        this.activeHandleType = null;
        this.clearEditHandles();
        this.removeEditEventListeners();
        this.removeHoverListeners();
        this.cancelPendingUpdates();
        this.map.dragPan.enable();
        this.map.getCanvas().style.cursor = '';
    }

    createEditHandles = (feature) => {
        const handles = this.geometry.createHandles(feature);
        if (!handles || handles.length === 0) return;

        // Show selection feedback
        this.map.getSource('occupied-front-feedback').setData({
            type: 'Feature',
            geometry: feature.geometry,
            properties: {
                ...feature.properties,
                isSelected: true
            }
        });

        // Show handles
        this.map.getSource('occupied-front-edit-handles').setData({
            type: 'FeatureCollection',
            features: handles
        });
    }

    clearEditHandles = () => {
        this.map.getSource('occupied-front-edit-handles').setData({
            type: 'FeatureCollection',
            features: []
        });
        this.map.getSource('occupied-front-feedback').setData({
            type: 'FeatureCollection',
            features: []
        });
    }

    setupEditEventListeners = () => {
        this.map.on('mousedown', this.onEditMouseDown);
        this.map.on('mousemove', this.onEditMouseMove);
        this.map.on('mouseup', this.onEditMouseUp);
    }

    removeEditEventListeners = () => {
        this.map.off('mousedown', this.onEditMouseDown);
        this.map.off('mousemove', this.onEditMouseMove);
        this.map.off('mouseup', this.onEditMouseUp);
    }

    onEditMouseDown = (e) => {
        const selectedFeature = this.getSelectedFeature();
        if (!selectedFeature) return;

        const handleFeatures = this.map.queryRenderedFeatures(e.point, {
            layers: ['occupied-front-edit-handles-layer']
        });

        if (handleFeatures.length > 0) {
            const handle = handleFeatures[0];
            this.isDraggingHandle = true;
            this.activeHandleType = handle.properties.handleId; // 'p1', 'p2', or 'p3'
            this.map.dragPan.disable();
            this.map.getCanvas().style.cursor = 'grabbing';
            e.preventDefault();
        }
    }

    onEditMouseMove = (e) => {
        const selectedFeature = this.getSelectedFeature();
        if (!this.isDraggingHandle || !selectedFeature) return;

        this.lastPreviewPosition = [e.lngLat.lng, e.lngLat.lat];

        if (!this.pendingPreviewUpdate) {
            this.pendingPreviewUpdate = true;
            this.previewRafId = requestAnimationFrame(this.performPreviewUpdate);
        }
    }

    onEditMouseUp = () => {
        const selectedFeature = this.getSelectedFeature();
        if (this.isDraggingHandle && selectedFeature) {
            if (this.lastPreviewPosition && this.activeHandleType) {
                const coords = this.geometry.normalizeBaseCoordinates(selectedFeature.properties.baseCoordinates);

                if (coords && coords.length >= 3) {
                    // Update specific handle position
                    if (this.activeHandleType === 'p1') coords[0] = this.lastPreviewPosition;
                    else if (this.activeHandleType === 'p2') coords[1] = this.lastPreviewPosition;
                    else if (this.activeHandleType === 'p3') coords[2] = this.lastPreviewPosition;

                    // Create updated feature
                    const updatedFeature = {
                        ...selectedFeature,
                        properties: {
                            ...selectedFeature.properties,
                            baseCoordinates: coords
                        },
                        geometry: this.geometry.generate(coords)
                    };

                    this.forceUpdateMainSource(updatedFeature);
                    this.updateSelectionManagerFeature(updatedFeature);
                    this.createEditHandles(updatedFeature);
                    this.updateUIAfterEdit();
                    this.saveFeatureChanges(updatedFeature);
                }
            }
        }

        this.isDraggingHandle = false;
        this.activeHandleType = null;
        this.map.dragPan.enable();
        this.map.getCanvas().style.cursor = '';
    }

    updateOccupiedFrontPreview = (newPosition) => {
        const selectedFeature = this.getSelectedFeature();
        if (!selectedFeature || !this.activeHandleType) return;

        const coords = this.geometry.normalizeBaseCoordinates(selectedFeature.properties.baseCoordinates);
        if (!coords || coords.length < 3) return;

        clearTimeout(this.geometryDebounceTimer);
        this.geometryDebounceTimer = setTimeout(() => {
            // Update specific handle position for preview
            const previewCoords = [...coords];
            if (this.activeHandleType === 'p1') previewCoords[0] = newPosition;
            else if (this.activeHandleType === 'p2') previewCoords[1] = newPosition;
            else if (this.activeHandleType === 'p3') previewCoords[2] = newPosition;

            const previewGeometry = this.geometry.generate(previewCoords);
            const previewHandles = this.geometry.createHandles({
                ...selectedFeature,
                properties: { ...selectedFeature.properties, baseCoordinates: previewCoords }
            });

            // Show updated selection
            this.map.getSource('occupied-front-feedback').setData({
                type: 'Feature',
                geometry: previewGeometry,
                properties: {
                    ...selectedFeature.properties,
                    isSelected: true
                }
            });

            // Update handles
            this.map.getSource('occupied-front-edit-handles').setData({
                type: 'FeatureCollection',
                features: previewHandles
            });
        }, 12); // More debouncing for complex geometry
    }

    // ===== HOVER SYSTEM =====

    setupHoverListeners = () => {
        this.map.on('mousemove', this.onHoverMove);
    }

    removeHoverListeners = () => {
        this.map.off('mousemove', this.onHoverMove);
    }

    onHoverMove = (e) => {
        const selectedFeature = this.getSelectedFeature();
        if (!selectedFeature) return;

        const features = this.map.queryRenderedFeatures(e.point);
        const hasHandle = this.hasHandleAtPoint(features);
        const hasFeature = this.hasSelectedFeatureAtPoint(features);

        if (hasHandle) {
            this.map.getCanvas().style.cursor = 'crosshair';
        } else if (hasFeature) {
            this.map.getCanvas().style.cursor = 'move';
        } else {
            this.map.getCanvas().style.cursor = '';
        }
    }

    hasHandleAtPoint = (features) => {
        return features.some(f =>
            f.source === 'occupied-front-edit-handles' &&
            f.properties.user_isEditingHandle
        );
    }

    hasSelectedFeatureAtPoint = (features) => {
        const selectedFeature = this.getSelectedFeature();
        if (!selectedFeature) return false;
        return features.some(f =>
            f.source === 'occupied_fronts' &&
            f.properties.id === selectedFeature.properties.id
        );
    }

    // ===== FEATURE MANAGEMENT INTERFACE =====

    updateFeaturesProperty = (features, property, value) => {
        const data = JSON.parse(JSON.stringify(this.map.getSource('occupied_fronts')._data));

        for (const feature of features) {
            const sourceFeature = data.features.find(f => f.properties.id == feature.properties.id);
            if (sourceFeature) {
                sourceFeature.properties[property] = value;
                feature.properties[property] = value;

                // Recalculate geometry if baseCoordinates change
                if (property === 'baseCoordinates') {
                    const newGeometry = this.geometry.generate(sourceFeature.properties.baseCoordinates);
                    sourceFeature.geometry = newGeometry;
                    feature.geometry = newGeometry;
                }
            }
        }

        this.map.getSource('occupied_fronts').setData(data);

        // CRITICAL FIX: Get fresh features from map source before updating SelectionManager
        const freshFeatures = features.map(feature => {
            const sourceFeature = data.features.find(f => f.properties.id == feature.properties.id);
            return sourceFeature || feature; // Fallback to original if not found
        });

        // Update SelectionManager with fresh features
        this.updateSelectionManagerFeatures(freshFeatures);

        const selectedFeature = this.getSelectedFeature();
        if (selectedFeature && !this.isDraggingHandle) {
            this.createEditHandles(selectedFeature);
        }
    }

    saveFeatures = async (features, initialPropertiesMap) => {
        // CRITICAL FIX: Always get fresh feature data from map source before saving
        const currentData = this.map.getSource('occupied_fronts')._data;
        let hasChanges = false;

        for (const selectedFeature of features) {
            if (this.hasFeatureChanged(selectedFeature, initialPropertiesMap.get(selectedFeature.properties.id))) {
                const currentFeature = currentData.features.find(f => f.properties.id == selectedFeature.properties.id);

                if (currentFeature) {
                    // Use complete current feature (with updated geometry + properties)
                    await updateFeature('occupied_fronts', currentFeature);
                    hasChanges = true;
                }
            }
        }
    }

    discardChangeFeatures = async (features, initialPropertiesMap) => {
        features.forEach(f => {
            Object.assign(f.properties, initialPropertiesMap.get(f.properties.id));
            f.geometry = this.geometry.generate(f.properties.baseCoordinates);
        });

        await this.updateFeatures(features, true, true);
    }

    deleteFeatures = async (features) => {
        if (features.length === 0) return;

        for (const feature of features) {
            try {
                const featureId = feature.properties.id;
                await removeFeature('occupied_fronts', featureId);
                const data = JSON.parse(JSON.stringify(this.map.getSource('occupied_fronts')._data));
                const idsToDelete = new Set(features.map(f => String(f.properties.id)));
                data.features = data.features.filter(f => !idsToDelete.has(String(f.properties.id)));
                this.map.getSource('occupied_fronts').setData(data);
            } catch (error) {
                console.error(`Error removing occupied front ${feature.properties.id}:`, error);
            }
        }
    }

    setDefaultProperties = (properties) => {
        Object.assign(AddOccupiedFrontControl.DEFAULT_PROPERTIES, properties);
    }

    hasFeatureChanged = (feature, initialProperties) => {
        if (!initialProperties) return true;

        return (
            feature.properties.color !== initialProperties.color ||
            feature.properties.opacity !== initialProperties.opacity ||
            feature.properties.lineWidth !== initialProperties.lineWidth ||
            feature.properties.nome !== initialProperties.nome ||
            feature.properties.descricao !== initialProperties.descricao ||
            feature.properties.visivel !== initialProperties.visivel ||
            feature.properties.bloqueado !== initialProperties.bloqueado ||
            JSON.stringify(feature.properties.baseCoordinates) !== JSON.stringify(initialProperties.baseCoordinates)
        );
    }

    updateFeatures = async (features, save = false, onlyUpdateProperties = false) => {
        if (features.length > 0) {
            const data = JSON.parse(JSON.stringify(this.map.getSource('occupied_fronts')._data));
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
                        await updateFeature('occupied_fronts', featureToUpdate);
                    }
                }
            }

            this.map.getSource('occupied_fronts').setData(data);

            // Update SelectionManager with updated features
            this.updateSelectionManagerFeatures(features);
        }
    }

    // ===== SELECTION MANAGER INTEGRATION =====

    /**
     * Update SelectionManager with current feature data
     */
    updateSelectionManagerFeature(feature) {
        const key = `occupied_front:${feature.properties.id}`;
        this.selectionManager.selectedFeatures.set(key, { type: 'occupied_front', feature });
    }

    /**
     * Update SelectionManager with multiple features
     */
    updateSelectionManagerFeatures(features) {
        features.forEach(feature => {
            if (feature.properties.source === 'occupied_front') {
                this.updateSelectionManagerFeature(feature);
            }
        });
    }

    // ===== UTILITY METHODS =====

    cancelPendingUpdates = () => {
        if (this.previewRafId) {
            cancelAnimationFrame(this.previewRafId);
            this.previewRafId = null;
        }
        this.pendingPreviewUpdate = false;
        this.lastPreviewPosition = null;
        this.lastPreviewCenter = null;
        this.activeHandleType = null;

        if (this.geometryDebounceTimer) {
            clearTimeout(this.geometryDebounceTimer);
            this.geometryDebounceTimer = null;
        }
    }

    forceUpdateMainSource = (feature) => {
        // Don't update source during drag operations to prevent conflicts
        if (this.uiManager && this.uiManager.isDragging) {
            return;
        }

        const data = JSON.parse(JSON.stringify(this.map.getSource('occupied_fronts')._data));
        const sourceFeature = data.features.find(f => f.properties.id == feature.properties.id);
        if (sourceFeature) {
            sourceFeature.properties = {
                ...feature.properties,
                baseCoordinates: feature.properties.baseCoordinates
            };
            sourceFeature.geometry = { ...feature.geometry };
            this.map.getSource('occupied_fronts').setData(data);
        }
    }

    updateUIAfterEdit = () => {
        this.selectionManager.uiManager.updateSelectionHighlight();
        this.selectionManager.uiManager.updatePanels();
        this.selectionManager.updateUI();
    }

    saveFeatureChanges = async (feature) => {
        try {
            await updateFeature('occupied_fronts', feature);
        } catch (error) {
            console.error('Erro ao salvar mudanças:', error);
        }
    }

    setupBaseEventListeners = () => {
        // Base listeners setup if needed
    }

    removeAllEventListeners = () => {
        this.map.off('mousemove', this.handlePreviewMouseMove);
        this.removeEditEventListeners();
        this.removeHoverListeners();
        this.cancelPendingUpdates();
    }
}

export default AddOccupiedFrontControl;
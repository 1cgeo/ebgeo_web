// Path: js\controls_sig\rectangle_tool\add_rectangle_control.js

import { addFeature, updateFeature, removeFeature } from '../store/store.js';
import { IDUtils } from '../id_utils.js';
import { addRectangleAttributesToPanel } from './rectangle_attributes_panel.js';
import AddRectangleGeometry from './add_rectangle_geometry.js';
import BaseControl from '../tool_manager/base_control.js';

class AddRectangleControl extends BaseControl {
    constructor(toolManager) {
        super(toolManager);

        // State management
        this.drawPoints = [];
        this.isDraggingHandle = false;
        this.activeHandleType = null;

        // Geometry handler
        this.geometry = new AddRectangleGeometry();

        // Performance optimization - RAF system
        this.previewRafId = null;
        this.pendingPreviewUpdate = false;
        this.lastPreviewPosition = null;
        this.lastPreviewCenter = null;
        this.geometryDebounceTimer = null;
    }

    static DEFAULT_PROPERTIES = {
        lineColor: '#3f4fb5',
        fillColor: '#3f4fb5',
        lineWidth: 2,
        opacity: 0.5,
        source: 'rectangle',
        nome: '',
        descricao: '',
        visivel: true,
        bloqueado: false
    };

    // ===== FONTE ÚNICA DA VERDADE =====

    /**
     * Get currently selected rectangle feature from SelectionManager
     * @returns {Object|null} Selected rectangle feature or null
     */
    getSelectedFeature() {
        const selectedItems = this.selectionManager.getSelectedFeaturesByType('rectangle');
        return selectedItems.length > 0 ? selectedItems[0].feature : null;
    }

    /**
     * Get all selected rectangle features from SelectionManager
     * @returns {Array} Array of selected rectangle features
     */
    getSelectedFeatures() {
        return this.selectionManager.getSelectedFeaturesByType('rectangle')
            .map(item => item.feature);
    }

    // ===== MAPBOX CONTROL INTERFACE =====

    onAdd = (map) => {
        this.map = map;
        this.container = document.createElement('div');
        this.container.className = 'mapboxgl-ctrl-group mapboxgl-ctrl rectangle-control controls-column-right';

        const button = document.createElement('button');
        button.className = 'mapbox-gl-draw_ctrl-draw-btn';
        button.setAttribute("id", "rectangle-tool");
        button.innerHTML = '<img class="icon-sig-tool" src="./images/icon_rectangle_black.svg" alt="RECTANGLE" />';
        button.title = 'Adicionar retângulo (R)';
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
            console.error('Error removing AddRectangleControl:', error);
            throw error;
        }
    }

    // ===== TOOL-CENTRIC INTERFACE IMPLEMENTATIONS =====

    hasAttributePanel() {
        return true;
    }

    createAttributePanel(container, features, selectionManager, uiManager) {
        const sectionPanel = document.createElement('div');
        sectionPanel.className = 'rectangle-attributes-section';

        try {
            addRectangleAttributesToPanel(sectionPanel, features, this, selectionManager, uiManager);
            container.appendChild(sectionPanel);
        } catch (error) {
            console.error('Error creating rectangle attribute panel:', error);
        }
    }

    getDragSources() {
        return ['rectangles'];
    }

    getEditHandleSources() {
        return ['rectangle-edit-handles'];
    }

    createSelectionBox(feature) {
        try {
            const bbox = turf.bbox(feature);
            const expandedBbox = this.expandBboxWithPadding(bbox, this.getSelectionBoxPadding());
            return turf.bboxPolygon(expandedBbox);
        } catch (error) {
            console.warn('Error creating rectangle selection box:', error);
            return null;
        }
    }

    getSelectionBoxStrategy() {
        return 'bbox';
    }

    getSelectionBoxPadding() {
        return 5;
    }

    getLayerIds() {
        return ['rectangle-fill-layer', 'rectangle-layer'];
    }

    getSourceNames() {
        return ['rectangles'];
    }

    getEditHandleSource() {
        return 'rectangle-edit-handles';
    }

    canCopy(feature) {
        return true;
    }

    canPaste(feature) {
        return true;
    }

    prepareForPaste(feature, offset) {
        const oldCorner1 = this.geometry.normalizeCorner(feature.properties.corner1);
        const oldCorner2 = this.geometry.normalizeCorner(feature.properties.corner2);

        const newCorner1 = [oldCorner1[0] + offset.dx, oldCorner1[1] + offset.dy];
        const newCorner2 = [oldCorner2[0] + offset.dx, oldCorner2[1] + offset.dy];

        const { center, width, height } = this.geometry.calculateDimensionsFromCorners(newCorner1, newCorner2);

        return {
            ...feature,
            properties: {
                ...feature.properties,
                corner1: newCorner1,
                corner2: newCorner2,
                center: center,
                width: width,
                height: height
            },
            geometry: this.geometry.generate(newCorner1, newCorner2)
        };
    }

    calculateMoveOffset(feature, referencePoint) {
        const center = this.geometry.normalizeCenter(feature.properties.center);
        return [
            center[0] - referencePoint.lng,
            center[1] - referencePoint.lat
        ];
    }

    updateFeatureForMove(feature, dx, dy, newCoords) {
        const corner1 = this.geometry.normalizeCorner(feature.properties.corner1);
        const corner2 = this.geometry.normalizeCorner(feature.properties.corner2);

        // Move both corners by the same delta
        const newCorner1 = [corner1[0] + dx, corner1[1] + dy];
        const newCorner2 = [corner2[0] + dx, corner2[1] + dy];

        const { center, width, height } = this.geometry.calculateDimensionsFromCorners(newCorner1, newCorner2);

        const updatedFeature = {
            ...feature,
            properties: {
                ...feature.properties,
                corner1: newCorner1,
                corner2: newCorner2,
                center: center,
                width: width,
                height: height
            },
            geometry: this.geometry.generate(newCorner1, newCorner2)
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
            './images/icon_rectangle_red.svg' :
            './images/icon_rectangle_black.svg';
        $("#rectangle-tool").html(`<img class="icon-sig-tool" src="${iconSrc}" alt="RECTANGLE" />`);
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
            console.warn('Coordenadas inválidas para retângulo');
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
            this.updateRectanglePreview(this.lastPreviewPosition);
        } else if (this.drawPoints.length === 1 && this.lastPreviewCenter) {
            const corner1 = this.lastPreviewCenter;
            const corner2 = this.lastPreviewPosition;

            const { center, width, height } = this.geometry.calculateDimensionsFromCorners(corner1, corner2);

            if (width >= 10 && height >= 10) {
                clearTimeout(this.geometryDebounceTimer);
                this.geometryDebounceTimer = setTimeout(() => {
                    const previewGeometry = this.geometry.generate(corner1, corner2);
                    this.showPreview(previewGeometry);
                }, 8);
            }
        }

        this.pendingPreviewUpdate = false;
    }

    showPreview = (geometry) => {
        this.map.getSource('rectangle-feedback').setData({
            type: 'Feature',
            geometry: geometry,
            properties: {
                isPreview: true,
                lineColor: AddRectangleControl.DEFAULT_PROPERTIES.lineColor,
                fillColor: AddRectangleControl.DEFAULT_PROPERTIES.fillColor,
                opacity: 0.5
            }
        });
    }

    clearPreview = () => {
        this.map.off('mousemove', this.handlePreviewMouseMove);
        this.cancelPendingUpdates();
        this.map.getSource('rectangle-feedback').setData({
            type: 'FeatureCollection',
            features: []
        });
    }

    createFeature = async () => {
        const corner1 = this.drawPoints[0];
        const corner2 = this.drawPoints[1];

        const { center, width, height } = this.geometry.calculateDimensionsFromCorners(corner1, corner2);

        if (width < 10 || height < 10) {
            alert('Dimensões mínimas: 10 metros');
            this.drawPoints = [];
            return;
        }

        const featureId = IDUtils.generateUniqueId();
        const featureName = IDUtils.generateFeatureName('rectangle', this.map);

        const feature = {
            type: 'Feature',
            id: Date.now().toString(),
            properties: {
                ...AddRectangleControl.DEFAULT_PROPERTIES,
                corner1: corner1,
                corner2: corner2,
                center: center,
                width: width,
                height: height,
                id: featureId,
                nome: featureName
            },
            geometry: this.geometry.generate(corner1, corner2)
        };

        try {
            await addFeature('rectangles', feature);

            const data = JSON.parse(JSON.stringify(this.map.getSource('rectangles')._data));
            data.features.push(feature);
            this.map.getSource('rectangles').setData(data);

            this.drawPoints = [];
            this.toolManager.setActiveTool(null);
            this.selectionManager.toggleFeatureSelection('rectangle', featureId, feature);
            this.selectionManager.updateUI();
        } catch (error) {
            console.error('Erro ao criar retângulo:', error);
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
        this.map.getSource('rectangle-feedback').setData({
            type: 'Feature',
            geometry: feature.geometry,
            properties: {
                ...feature.properties,
                isSelected: true
            }
        });

        // Show handles
        this.map.getSource('rectangle-edit-handles').setData({
            type: 'FeatureCollection',
            features: handles
        });
    }

    clearEditHandles = () => {
        this.map.getSource('rectangle-edit-handles').setData({
            type: 'FeatureCollection',
            features: []
        });
        this.map.getSource('rectangle-feedback').setData({
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
            layers: ['rectangle-edit-handles-layer']
        });

        if (handleFeatures.length > 0) {
            const handle = handleFeatures[0];
            this.isDraggingHandle = true;
            this.activeHandleType = handle.properties.handleId; // 'corner1' or 'corner2'
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
                const newCorner1 = this.activeHandleType === 'corner1' ?
                    this.lastPreviewPosition :
                    this.geometry.normalizeCorner(selectedFeature.properties.corner1);

                const newCorner2 = this.activeHandleType === 'corner2' ?
                    this.lastPreviewPosition :
                    this.geometry.normalizeCorner(selectedFeature.properties.corner2);

                // Validate minimum dimensions
                const { width, height } = this.geometry.calculateDimensionsFromCorners(newCorner1, newCorner2);

                if (width > 10 && height > 10) {
                    const { center } = this.geometry.calculateDimensionsFromCorners(newCorner1, newCorner2);

                    // Create updated feature
                    const updatedFeature = {
                        ...selectedFeature,
                        properties: {
                            ...selectedFeature.properties,
                            corner1: newCorner1,
                            corner2: newCorner2,
                            center: center,
                            width: width,
                            height: height
                        },
                        geometry: this.geometry.generate(newCorner1, newCorner2)
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

    updateRectanglePreview = (newPosition) => {
        const selectedFeature = this.getSelectedFeature();
        if (!selectedFeature || !this.activeHandleType) return;

        clearTimeout(this.geometryDebounceTimer);
        this.geometryDebounceTimer = setTimeout(() => {
            const corner1 = this.activeHandleType === 'corner1' ?
                newPosition :
                this.geometry.normalizeCorner(selectedFeature.properties.corner1);

            const corner2 = this.activeHandleType === 'corner2' ?
                newPosition :
                this.geometry.normalizeCorner(selectedFeature.properties.corner2);

            const { width, height } = this.geometry.calculateDimensionsFromCorners(corner1, corner2);

            if (width > 10 && height > 10) {
                const previewGeometry = this.geometry.generate(corner1, corner2);
                this.showEditPreview(previewGeometry, corner1, corner2);
            }
        }, 8);
    }

    showEditPreview = (geometry, corner1, corner2) => {
        const selectedFeature = this.getSelectedFeature();
        if (!selectedFeature) return;

        // Show updated selection feedback
        this.map.getSource('rectangle-feedback').setData({
            type: 'Feature',
            geometry: geometry,
            properties: {
                ...selectedFeature.properties,
                isSelected: true
            }
        });

        // Show accurate handles at exact corner positions
        const handles = [
            {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: corner1 },
                properties: {
                    role: 'handle',
                    handleType: 'vertex',
                    handleId: 'corner1',
                    user_isEditingHandle: true
                }
            },
            {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: corner2 },
                properties: {
                    role: 'handle',
                    handleType: 'vertex',
                    handleId: 'corner2',
                    user_isEditingHandle: true
                }
            }
        ];

        this.map.getSource('rectangle-edit-handles').setData({
            type: 'FeatureCollection',
            features: handles
        });
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
            f.source === 'rectangle-edit-handles' &&
            f.properties.user_isEditingHandle
        );
    }

    hasSelectedFeatureAtPoint = (features) => {
        const selectedFeature = this.getSelectedFeature();
        if (!selectedFeature) return false;
        return features.some(f =>
            f.source === 'rectangles' &&
            f.properties.id === selectedFeature.properties.id
        );
    }

    // ===== FEATURE MANAGEMENT INTERFACE =====

    updateFeaturesProperty = (features, property, value) => {
        const data = JSON.parse(JSON.stringify(this.map.getSource('rectangles')._data));

        for (const feature of features) {
            const sourceFeature = data.features.find(f => f.properties.id == feature.properties.id);
            if (sourceFeature) {
                sourceFeature.properties[property] = value;
                feature.properties[property] = value;

                // Recalculate geometry if corners change
                if (['corner1', 'corner2'].includes(property)) {
                    const corner1 = sourceFeature.properties.corner1;
                    const corner2 = sourceFeature.properties.corner2;

                    // Recalculate derived properties
                    const { center, width, height } = this.geometry.calculateDimensionsFromCorners(corner1, corner2);
                    sourceFeature.properties.center = center;
                    sourceFeature.properties.width = width;
                    sourceFeature.properties.height = height;
                    feature.properties.center = center;
                    feature.properties.width = width;
                    feature.properties.height = height;

                    // Regenerate geometry
                    const newGeometry = this.geometry.generate(corner1, corner2);
                    sourceFeature.geometry = newGeometry;
                    feature.geometry = newGeometry;
                }
            }
        }

        this.map.getSource('rectangles').setData(data);

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
        const currentData = this.map.getSource('rectangles')._data;
        let hasChanges = false;

        for (const selectedFeature of features) {
            if (this.hasFeatureChanged(selectedFeature, initialPropertiesMap.get(selectedFeature.properties.id))) {
                const currentFeature = currentData.features.find(f => f.properties.id == selectedFeature.properties.id);

                if (currentFeature) {
                    // Use complete current feature (with updated geometry + properties)
                    await updateFeature('rectangles', currentFeature);
                    hasChanges = true;
                }
            }
        }
    }

    discardChangeFeatures = async (features, initialPropertiesMap) => {
        features.forEach(f => {
            const initialProps = initialPropertiesMap.get(f.properties.id);
            Object.assign(f.properties, initialProps);
            f.geometry = this.geometry.generate(
                initialProps.corner1,
                initialProps.corner2
            );
        });

        await this.updateFeatures(features, true, true);
    }

    deleteFeatures = async (features) => {
        if (features.length === 0) return;

        for (const feature of features) {
            try {
                const featureId = feature.properties.id;
                await removeFeature('rectangles', featureId);
                const data = JSON.parse(JSON.stringify(this.map.getSource('rectangles')._data));
                const idsToDelete = new Set(features.map(f => String(f.properties.id)));
                data.features = data.features.filter(f => !idsToDelete.has(String(f.properties.id)));
                this.map.getSource('rectangles').setData(data);
            } catch (error) {
                console.error(`Error removing rectangle ${feature.properties.id}:`, error);
            }
        }
    }

    setDefaultProperties = (properties) => {
        Object.assign(AddRectangleControl.DEFAULT_PROPERTIES, properties);
    }

    hasFeatureChanged = (feature, initialProperties) => {
        if (!initialProperties) return true;

        return (
            feature.properties.lineColor !== initialProperties.lineColor ||
            feature.properties.fillColor !== initialProperties.fillColor ||
            feature.properties.opacity !== initialProperties.opacity ||
            feature.properties.lineWidth !== initialProperties.lineWidth ||
            feature.properties.width !== initialProperties.width ||
            feature.properties.height !== initialProperties.height ||
            feature.properties.nome !== initialProperties.nome ||
            feature.properties.descricao !== initialProperties.descricao ||
            feature.properties.visivel !== initialProperties.visivel ||
            feature.properties.bloqueado !== initialProperties.bloqueado ||
            JSON.stringify(feature.properties.corner1) !== JSON.stringify(initialProperties.corner1) ||
            JSON.stringify(feature.properties.corner2) !== JSON.stringify(initialProperties.corner2)
        );
    }

    updateFeatures = async (features, save = false, onlyUpdateProperties = false) => {
        if (features.length > 0) {
            const data = JSON.parse(JSON.stringify(this.map.getSource('rectangles')._data));
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
                        await updateFeature('rectangles', featureToUpdate);
                    }
                }
            }

            this.map.getSource('rectangles').setData(data);

            // Update SelectionManager with updated features
            this.updateSelectionManagerFeatures(features);
        }
    }

    // ===== SELECTION MANAGER INTEGRATION =====

    /**
     * Update SelectionManager with current feature data
     */
    updateSelectionManagerFeature(feature) {
        const key = `rectangle:${feature.properties.id}`;
        this.selectionManager.selectedFeatures.set(key, { type: 'rectangle', feature });
    }

    /**
     * Update SelectionManager with multiple features
     */
    updateSelectionManagerFeatures(features) {
        features.forEach(feature => {
            if (feature.properties.source === 'rectangle') {
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

        const data = JSON.parse(JSON.stringify(this.map.getSource('rectangles')._data));
        const sourceFeature = data.features.find(f => f.properties.id == feature.properties.id);
        if (sourceFeature) {
            sourceFeature.properties = {
                ...feature.properties,
                corner1: feature.properties.corner1,
                corner2: feature.properties.corner2,
                center: feature.properties.center
            };
            sourceFeature.geometry = { ...feature.geometry };
            this.map.getSource('rectangles').setData(data);
        }
    }

    updateUIAfterEdit = () => {
        this.selectionManager.uiManager.updateSelectionHighlight();
        this.selectionManager.uiManager.updatePanels();
        this.selectionManager.updateUI();
    }

    saveFeatureChanges = async (feature) => {
        try {
            await updateFeature('rectangles', feature);
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

export default AddRectangleControl;
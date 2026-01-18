// Path: js/military_tools/arrow_tool/add_arrow_control.js

import { addFeature, updateFeature, removeFeature, getActiveLayerIdSync } from '../../store';
import { IDUtils } from '../../utilities';
import { addArrowAttributesToPanel } from './arrow_attributes_panel.js';
import AddArrowGeometry from './add_arrow_geometry.js';
import { BaseControl } from '../../tool_manager';

/**
 * Arrow Tool Control
 * Manages drawing, editing, and interaction for arrow features on the map
 */
class AddArrowControl extends BaseControl {
    constructor(toolManager) {
        super(toolManager);

        this.drawPoints = [];
        this.isDraggingHandle = false;
        this.activeHandle = null;
        this.activeHandleType = null;
        this.activeHandleIndex = null;

        this.geometry = new AddArrowGeometry();

        this.previewRafId = null;
        this.pendingPreviewUpdate = false;
        this.lastPreviewPosition = null;
        this.lastPreviewPoints = null;
        this.geometryDebounceTimer = null;
    }

    static DEFAULT_PROPERTIES = {
        width: 500,
        fillColor: '#3f4fb5',
        lineColor: '#3f4fb5',
        lineWidth: 3,
        fillOpacity: 0.8,
        lineOpacity: 1.0,
        headLengthRatio: 1.5,
        showArrowHead: true,
        airmobile: false,
        airmobilePosition: 0.7,
        source: 'arrow',
        geometryType: 'arrow',
        baseCoordinates: [],
        nome: '',
        descricao: '',
        visivel: true,
        bloqueado: false
    };

    // ===== ZOOM-ADAPTIVE WIDTH CONSTANTS =====
    static WIDTH_SIZE_CONSTANTS = {
        MIN_WIDTH_M: 50,
        DEFAULT_WIDTH_M: 500,
        ZOOM_BASE_MULTIPLIER: 40,
        ZOOM_EXPONENT_BASE: 2
    };

    /**
     * Calculate arrow width based on current zoom level
     * Exponential decay: higher zoom = smaller arrows (Zoom 5 â†’ ~8000m, Zoom 10 â†’ ~500m, Zoom 15 â†’ ~50m)
     * @param {number} zoom - Map zoom level
     * @returns {number} Width in meters
     */
    calculateWidthForZoom(zoom) {
        const { ZOOM_BASE_MULTIPLIER, ZOOM_EXPONENT_BASE, DEFAULT_WIDTH_M, MIN_WIDTH_M } =
            AddArrowControl.WIDTH_SIZE_CONSTANTS;

        try {
            const calculatedWidth = Math.pow(ZOOM_EXPONENT_BASE, 16 - zoom) * ZOOM_BASE_MULTIPLIER;
            return Math.max(MIN_WIDTH_M, calculatedWidth);
        } catch (error) {
            console.warn('Error calculating zoom-adaptive width, using default:', error);
            return DEFAULT_WIDTH_M;
        }
    }

    /**
     * Get currently selected arrow feature from SelectionManager
     * @returns {Object|null} Selected arrow feature or null
     */
    getSelectedFeature() {
        const selectedItems = this.selectionManager.getSelectedFeaturesByType('arrow');
        return selectedItems.length > 0 ? selectedItems[0].feature : null;
    }

    /**
     * Get all selected arrow features from SelectionManager
     * @returns {Array} Array of selected arrow features
     */
    getSelectedFeatures() {
        return this.selectionManager.getSelectedFeaturesByType('arrow')
            .map(item => item.feature);
    }

    // ===== MAPBOX CONTROL INTERFACE =====

    onAdd = (map) => {
        this.map = map;
        this.container = document.createElement('div');
        this.container.className = 'mapboxgl-ctrl-group mapboxgl-ctrl arrow-control controls-column-right';

        const button = document.createElement('button');
        button.className = 'mapbox-gl-draw_ctrl-draw-btn';
        button.setAttribute("id", "arrow-tool");
        button.innerHTML = '<img class="icon-sig-tool" src="./images/icon_arrow_black.svg" alt="ARROW" />';
        button.title = 'Adicionar Seta (S)';
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
            console.error('Error removing AddArrowControl:', error);
            throw error;
        }
    }

    // ===== TOOL-CENTRIC INTERFACE IMPLEMENTATIONS =====

    hasAttributePanel() {
        return true;
    }

    createAttributePanel(container, features, selectionManager, uiManager) {
        const sectionPanel = document.createElement('div');
        sectionPanel.className = 'arrow-attributes-section';

        try {
            addArrowAttributesToPanel(sectionPanel, features, this, selectionManager, uiManager);
            container.appendChild(sectionPanel);
        } catch (error) {
            console.error('Error creating arrow attribute panel:', error);
        }
    }

    getDragSources() {
        return ['arrows'];
    }

    getEditHandleSources() {
        return ['arrow-edit-handles'];
    }

    createSelectionBox(feature) {
        try {
            const bbox = turf.bbox(feature);
            const expandedBbox = this.expandBboxWithPadding(bbox, this.getSelectionBoxPadding(),this.map);
            return turf.bboxPolygon(expandedBbox);
        } catch (error) {
            console.warn('Error creating arrow selection box:', error);
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
        return ['arrow-fill-layer', 'arrow-layer'];
    }

    getSourceNames() {
        return ['arrows'];
    }

    getEditHandleSource() {
        return 'arrow-edit-handles';
    }

    canCopy(feature) {
        return true;
    }

    canPaste(feature) {
        return true;
    }

    prepareForPaste(feature, offset) {
        const baseCoordinates = this.geometry.normalizeBaseCoordinates(feature.properties.baseCoordinates);
        const newBaseCoordinates = baseCoordinates.map(coord => [
            coord[0] + offset.dx,
            coord[1] + offset.dy
        ]);

        return {
            ...feature,
            properties: {
                ...feature.properties,
                baseCoordinates: newBaseCoordinates
            },
            geometry: this.geometry.generate(newBaseCoordinates, feature.properties)
        };
    }

    calculateMoveOffset(feature, referencePoint) {
        const baseCoordinates = this.geometry.normalizeBaseCoordinates(feature.properties.baseCoordinates);
        if (baseCoordinates.length === 0) return [0, 0];

        const firstPoint = baseCoordinates[0];
        return [
            firstPoint[0] - referencePoint.lng,
            firstPoint[1] - referencePoint.lat
        ];
    }

    updateFeatureForMove(feature, dx, dy, newCoords) {
        const baseCoordinates = this.geometry.normalizeBaseCoordinates(feature.properties.baseCoordinates);
        const newBaseCoordinates = baseCoordinates.map(coord => [
            coord[0] + dx,
            coord[1] + dy
        ]);

        const updatedFeature = {
            ...feature,
            properties: {
                ...feature.properties,
                baseCoordinates: newBaseCoordinates
            },
            geometry: this.geometry.generate(newBaseCoordinates, feature.properties)
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
        this.map.getCanvas().addEventListener('contextmenu', this.handleRightClick);
        this.updateButtonAppearance();
    }

    deactivate = () => {
        this.isActive = false;
        this.drawPoints = [];
        this.map.getCanvas().style.cursor = '';
        this.map.getCanvas().removeEventListener('contextmenu', this.handleRightClick);
        this.updateButtonAppearance();
        this.clearPreview();
        this.deselectFeature();
    }

    updateButtonAppearance = () => {
        const iconSrc = this.isActive ?
            './images/icon_arrow_red.svg' :
            './images/icon_arrow_black.svg';
        const btn = document.getElementById('arrow-tool');
        if (btn) btn.innerHTML = `<img class="icon-sig-tool" src="${iconSrc}" alt="ARROW" />`;
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
            const updatedFeature = movedFeatures.find(f =>
                f.properties.id === selectedFeature.properties.id
            );
            if (updatedFeature) {
                this.createEditHandles(updatedFeature);
            }
        }
    }

    // ===== DRAWING SYSTEM =====

    handleMapClick = (e) => {
        if (!this.isActive) return;

        if (!e.lngLat || isNaN(e.lngLat.lng) || isNaN(e.lngLat.lat)) {
            console.warn('Invalid coordinates for arrow');
            return;
        }

        const newPoint = [e.lngLat.lng, e.lngLat.lat];

        if (this.geometry.isPointTooClose(newPoint, this.drawPoints)) {
            return;
        }

        this.drawPoints.push(newPoint);

        if (this.drawPoints.length === 1) {
            this.map.on('mousemove', this.handlePreviewMouseMove);
        }
    }

    handleRightClick = async (e) => {
        if (!this.isActive || this.drawPoints.length === 0) return;

        e.preventDefault();
        e.stopPropagation();

        const coordinates = this.map.unproject([e.offsetX, e.offsetY]);
        const finalPoint = [coordinates.lng, coordinates.lat];

        if (!this.geometry.isPointTooClose(finalPoint, this.drawPoints)) {
            this.drawPoints.push(finalPoint);
        }

        if (this.drawPoints.length >= 2) {
            this.map.off('mousemove', this.handlePreviewMouseMove);
            await this.createFeature();
            this.toolManager.deactivateCurrentTool();
        } else {
            this.stopDrawing();
        }
    }

    handlePreviewMouseMove = (e) => {
        if (this.drawPoints.length >= 1) {
            this.lastPreviewPosition = [e.lngLat.lng, e.lngLat.lat];
            this.lastPreviewPoints = [...this.drawPoints, this.lastPreviewPosition];

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

        if (this.isDraggingHandle && selectedFeature && this.activeHandleType) {
            this.updateArrowPreview(this.lastPreviewPosition);
        } else if (this.lastPreviewPoints && this.lastPreviewPoints.length >= 2) {
            const isAirmobile = AddArrowControl.DEFAULT_PROPERTIES.airmobile;
            const debounceTime = isAirmobile ? 12 : 8;

            clearTimeout(this.geometryDebounceTimer);
            this.geometryDebounceTimer = setTimeout(() => {
                const currentZoom = this.map.getZoom();
                const previewWidth = this.calculateWidthForZoom(currentZoom);

                const previewGeometry = this.geometry.generate(
                    this.lastPreviewPoints,
                    {
                        ...AddArrowControl.DEFAULT_PROPERTIES,
                        width: previewWidth
                    }
                );

                if (previewGeometry) {
                    this.showPreview(previewGeometry);
                }
            }, debounceTime);
        }

        this.pendingPreviewUpdate = false;
    }

    showPreview = (geometry) => {
        this.map.getSource('arrow-feedback').setData({
            type: 'Feature',
            geometry: geometry,
            properties: {
                isPreview: true,
                fillColor: AddArrowControl.DEFAULT_PROPERTIES.fillColor,
                lineColor: AddArrowControl.DEFAULT_PROPERTIES.lineColor,
                fillOpacity: 0.5
            }
        });
    }

    clearPreview = () => {
        this.map.off('mousemove', this.handlePreviewMouseMove);
        this.cancelPendingUpdates();
        this.map.getSource('arrow-feedback').setData({
            type: 'FeatureCollection',
            features: []
        });
    }

    stopDrawing = () => {
        this.drawPoints = [];
        this.clearPreview();
        this.toolManager.deactivateCurrentTool();
    }

    createFeature = async () => {
        if (this.drawPoints.length < 2) {
            alert('Seta deve ter pelo menos 2 pontos');
            this.drawPoints = [];
            return;
        }

        if (!this.geometry.validate(this.drawPoints, AddArrowControl.DEFAULT_PROPERTIES)) {
            alert('Pontos muito próximos. Distância mínima: 10 metros');
            this.drawPoints = [];
            return;
        }

        const featureId = IDUtils.generateUniqueId();
        const featureName = await IDUtils.generateFeatureName('arrow', this.map);

        const currentZoom = this.map.getZoom();
        const adaptiveWidth = this.calculateWidthForZoom(currentZoom);

        const feature = {
            type: 'Feature',
            id: Date.now().toString(),
            properties: {
                ...AddArrowControl.DEFAULT_PROPERTIES,
                layerId: getActiveLayerIdSync(),
                width: adaptiveWidth,
                baseCoordinates: [...this.drawPoints],
                id: featureId,
                nome: featureName
            },
            geometry: this.geometry.generate(this.drawPoints, {
                ...AddArrowControl.DEFAULT_PROPERTIES,
                width: adaptiveWidth
            })
        };

        try {
            await addFeature('arrows', feature);

            const data = await this.map.getSource('arrows').getData();
            data.features.push(feature);
            this.map.getSource('arrows').setData(data);

            this.drawPoints = [];
            this.toolManager.setActiveTool(null);
            this.selectionManager.toggleFeatureSelection('arrow', featureId, feature);
            this.selectionManager.updateUI();
        } catch (error) {
            console.error('Error creating arrow:', error);
        }
    }

    // ===== EDIT HANDLES SYSTEM =====

    selectFeature = (feature) => {
        this.createEditHandles(feature);
        this.setupEditEventListeners();
        this.setupHoverListeners();
    }

    deselectFeature = () => {
        this.isDraggingHandle = false;
        this.activeHandle = null;
        this.activeHandleType = null;
        this.activeHandleIndex = null;
        this.clearEditHandles();
        this.removeEditEventListeners();
        this.removeHoverListeners();
        this.cancelPendingUpdates();
        this.map.dragPan.enable();
        this.map.getCanvas().style.cursor = '';
    }

    createEditHandles = (feature) => {
        this.map.getSource('arrow-feedback').setData({
            type: 'Feature',
            geometry: feature.geometry,
            properties: {
                ...feature.properties,
                isSelected: true
            }
        });

        const handles = this.geometry.createHandles(feature);

        this.map.getSource('arrow-edit-handles').setData({
            type: 'FeatureCollection',
            features: handles
        });
    }

    clearEditHandles = () => {
        this.map.getSource('arrow-edit-handles').setData({
            type: 'FeatureCollection',
            features: []
        });
        this.map.getSource('arrow-feedback').setData({
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
            layers: ['arrow-edit-handles-layer']
        });

        if (handleFeatures.length > 0) {
            const handle = handleFeatures[0];
            this.isDraggingHandle = true;
            this.activeHandle = handle;
            // Extract type and index separately (like boundary tool)
            this.activeHandleType = handle.properties.handleType;
            this.activeHandleIndex = handle.properties.index !== undefined ? handle.properties.index : null;
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
        if (this.isDraggingHandle && selectedFeature && this.activeHandleType && this.lastPreviewPosition) {
            // Use geometry.updateFromHandle with separate type and index (like boundary tool)
            const result = this.geometry.updateFromHandle(
                this.activeHandleType,
                this.lastPreviewPosition,
                selectedFeature,
                this.activeHandleIndex
            );

            if (result) {
                const updatedFeature = {
                    ...selectedFeature,
                    properties: result.properties,
                    geometry: result.geometry
                };

                this.forceUpdateMainSource(updatedFeature);
                this.updateSelectionManagerFeature(updatedFeature);
                this.createEditHandles(updatedFeature);
                this.updateUIAfterEdit();
                this.saveFeatureChanges(updatedFeature);
            }
        }

        this.isDraggingHandle = false;
        this.activeHandle = null;
        this.activeHandleType = null;
        this.activeHandleIndex = null;
        this.map.dragPan.enable();
        this.map.getCanvas().style.cursor = '';
    }

    /**
     * Update arrow preview during handle dragging without mutating the source feature
     * @param {Array} newPosition - New handle position [lng, lat]
     */
    updateArrowPreview = (newPosition) => {
        const selectedFeature = this.getSelectedFeature();
        if (!selectedFeature || !this.activeHandleType || !this.isDraggingHandle) {
            return;
        }

        const isAirmobile = selectedFeature.properties.airmobile || false;
        const debounceTime = isAirmobile ? 12 : 8;

        clearTimeout(this.geometryDebounceTimer);
        this.geometryDebounceTimer = setTimeout(() => {
            // Re-check state inside callback as it may have changed during debounce
            if (!this.activeHandleType || !this.isDraggingHandle) {
                return;
            }

            // Use calculatePreview with separate type and index (like boundary tool)
            // No mutation of selectedFeature during drag - only visual preview
            const preview = this.geometry.calculatePreview(
                this.activeHandleType,
                newPosition,
                selectedFeature,
                this.activeHandleIndex
            );

            if (preview) {
                this.showEditPreview(preview.geometry);

                // Update handles based on preview
                this.map.getSource('arrow-edit-handles').setData({
                    type: 'FeatureCollection',
                    features: preview.handles
                });
            }
        }, debounceTime);
    }

    showEditPreview = (geometry) => {
        this.map.getSource('arrow-feedback').setData({
            type: 'Feature',
            geometry: geometry,
            properties: {
                isSelected: true
            }
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
            f.source === 'arrow-edit-handles' &&
            f.properties.user_isEditingHandle
        );
    }

    hasSelectedFeatureAtPoint = (features) => {
        const selectedFeature = this.getSelectedFeature();
        if (!selectedFeature) return false;
        return features.some(f =>
            f.source === 'arrows' &&
            f.properties.id === selectedFeature.properties.id
        );
    }

    // ===== FEATURE MANAGEMENT INTERFACE =====

    updateFeaturesProperty = async (features, property, value) => {
        const data = await this.map.getSource('arrows').getData();

        for (const feature of features) {
            const sourceFeature = data.features.find(f => f.properties.id == feature.properties.id);
            if (sourceFeature) {
                sourceFeature.properties[property] = value;
                feature.properties[property] = value;

                if (['width', 'headLengthRatio', 'showArrowHead', 'airmobile', 'airmobilePosition', 'baseCoordinates'].includes(property)) {
                    const newGeometry = this.geometry.generate(
                        sourceFeature.properties.baseCoordinates,
                        sourceFeature.properties
                    );
                    sourceFeature.geometry = newGeometry;
                    feature.geometry = newGeometry;
                }
            }
        }

        this.map.getSource('arrows').setData(data);

        const freshFeatures = features.map(feature => {
            const sourceFeature = data.features.find(f => f.properties.id == feature.properties.id);
            return sourceFeature || feature;
        });
        this.updateSelectionManagerFeatures(freshFeatures);

        const selectedFeature = this.getSelectedFeature();
        if (selectedFeature && !this.isDraggingHandle) {
            this.createEditHandles(selectedFeature);
        }
    }

    saveFeatures = async (features, initialPropertiesMap) => {
        const currentData = await this.map.getSource('arrows').getData();
        let hasChanges = false;

        for (const selectedFeature of features) {
            if (this.hasFeatureChanged(selectedFeature, initialPropertiesMap.get(selectedFeature.properties.id))) {
                const currentFeature = currentData.features.find(f => f.properties.id == selectedFeature.properties.id);

                if (currentFeature) {
                    await updateFeature('arrows', currentFeature);
                    hasChanges = true;
                }
            }
        }
    }

    discardChangeFeatures = async (features, initialPropertiesMap) => {
        features.forEach(f => {
            Object.assign(f.properties, initialPropertiesMap.get(f.properties.id));
            f.geometry = this.geometry.generate(f.properties.baseCoordinates, f.properties);
        });

        await this.updateFeatures(features, true, true);
    }

    deleteFeatures = async (features) => {
        if (features.length === 0) return;

        for (const feature of features) {
            try {
                const featureId = feature.properties.id;
                await removeFeature('arrows', featureId);
                const data = await this.map.getSource('arrows').getData();
                const idsToDelete = new Set(features.map(f => String(f.properties.id)));
                data.features = data.features.filter(f => !idsToDelete.has(String(f.properties.id)));
                this.map.getSource('arrows').setData(data);
            } catch (error) {
                console.error(`Error removing arrow ${feature.properties.id}:`, error);
            }
        }
    }

    setDefaultProperties = (properties) => {
        Object.assign(AddArrowControl.DEFAULT_PROPERTIES, properties);
    }

    hasFeatureChanged = (feature, initialProperties) => {
        if (!initialProperties) return true;

        return (
            feature.properties.fillColor !== initialProperties.fillColor ||
            feature.properties.lineColor !== initialProperties.lineColor ||
            feature.properties.lineWidth !== initialProperties.lineWidth ||
            feature.properties.fillOpacity !== initialProperties.fillOpacity ||
            feature.properties.lineOpacity !== initialProperties.lineOpacity ||
            feature.properties.width !== initialProperties.width ||
            feature.properties.headLengthRatio !== initialProperties.headLengthRatio ||
            feature.properties.showArrowHead !== initialProperties.showArrowHead ||
            feature.properties.airmobile !== initialProperties.airmobile ||
            feature.properties.airmobilePosition !== initialProperties.airmobilePosition ||
            feature.properties.nome !== initialProperties.nome ||
            feature.properties.descricao !== initialProperties.descricao ||
            feature.properties.visivel !== initialProperties.visivel ||
            feature.properties.bloqueado !== initialProperties.bloqueado ||
            JSON.stringify(feature.properties.baseCoordinates) !== JSON.stringify(initialProperties.baseCoordinates)
        );
    }

    updateFeatures = async (features, save = false, onlyUpdateProperties = false) => {
        if (features.length > 0) {
            const data = await this.map.getSource('arrows').getData();
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
                        await updateFeature('arrows', featureToUpdate);
                    }
                }
            }

            this.map.getSource('arrows').setData(data);
            this.updateSelectionManagerFeatures(features);
        }
    }

    // ===== SELECTION MANAGER INTEGRATION =====

    updateSelectionManagerFeature(feature) {
        this.selectionManager.updateSelectedFeature('arrow', feature.properties.id, feature);
    }

    updateSelectionManagerFeatures(features) {
        features.forEach(feature => {
            if (feature.properties.source === 'arrow') {
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
        this.lastPreviewPoints = null;
        this.activeHandle = null;
        this.activeHandleType = null;

        if (this.geometryDebounceTimer) {
            clearTimeout(this.geometryDebounceTimer);
            this.geometryDebounceTimer = null;
        }
    }

    forceUpdateMainSource = async (feature) => {
        if (this.uiManager && this.uiManager.isDragging) {
            return;
        }

        const data = await this.map.getSource('arrows').getData();
        const sourceFeature = data.features.find(f => f.properties.id == feature.properties.id);
        if (sourceFeature) {
            sourceFeature.properties = { ...feature.properties };
            sourceFeature.geometry = { ...feature.geometry };
            this.map.getSource('arrows').setData(data);
        }
    }

    updateUIAfterEdit = () => {
        this.selectionManager.uiManager.updateSelectionHighlight();
        this.selectionManager.uiManager.updatePanels();
        this.selectionManager.updateUI();
    }

    saveFeatureChanges = async (feature) => {
        try {
            await updateFeature('arrows', feature);
        } catch (error) {
            console.error('Error saving changes:', error);
        }
    }

    setupBaseEventListeners = () => {
    }

    removeAllEventListeners = () => {
        this.map.getCanvas().removeEventListener('contextmenu', this.handleRightClick);
        this.map.off('click', this.handleMapClick);
        this.map.off('mousemove', this.handlePreviewMouseMove);
        this.removeEditEventListeners();
        this.removeHoverListeners();
        this.cancelPendingUpdates();
    }
}

export default AddArrowControl;

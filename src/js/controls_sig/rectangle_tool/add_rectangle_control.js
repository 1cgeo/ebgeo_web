// Path: js/controls_sig/rectangle_tool/add_rectangle_control.js

import { addFeature, updateFeature, removeFeature, getActiveLayerIdSync } from '../store/store.js';
import { IDUtils } from '../id_utils.js';
import { addRectangleAttributesToPanel } from './rectangle_attributes_panel.js';
import AddRectangleGeometry from './add_rectangle_geometry.js';
import BaseControl from '../tool_manager/base_control.js';
import { HatchPatternGenerator } from '../tool_manager/hatch_pattern_generator.js';

class AddRectangleControl extends BaseControl {
    constructor(toolManager) {
        super(toolManager);

        this.drawPoints = [];
        this.isDraggingHandle = false;
        this.activeHandleType = null;

        this.geometry = new AddRectangleGeometry();

        this.previewRafId = null;
        this.pendingPreviewUpdate = false;
        this.lastPreviewPosition = null;
        this.lastPreviewCenter = null;
        this.geometryDebounceTimer = null;
        
        // Track current mouse position for accurate capture
        this.currentMousePosition = null;
        this.hatchGenerator = new HatchPatternGenerator();
    }

    static DEFAULT_PROPERTIES = {
        lineColor: '#3f4fb5',
        fillColor: '#3f4fb5',
        lineWidth: 2,
        lineStyle: 'solid',
        opacity: 0.5,
        borderRadius: 0,
        bearing: 0,
        source: 'rectangle',
        nome: '',
        descricao: '',
        visivel: true,
        bloqueado: false,
        hatchEnabled: false,
        hatchType: 'diagonal-right',
        hatchColor: '#000000',
        hatchSpacing: 8,
        hatchLineWidth: 2
    };

    // ===== SELECTION MANAGER INTEGRATION =====

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
            const expandedBbox = this.expandBboxWithPadding(bbox, this.getSelectionBoxPadding(),this.map);
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

        // ✅ FIX: Para bearing = 0, trocar width e height para alinhar com convenção dos handles
        const bearing = feature.properties.bearing || 0;
        const finalWidth = bearing === 0 ? height : width;
        const finalHeight = bearing === 0 ? width : height;

        return {
            ...feature,
            properties: {
                ...feature.properties,
                corner1: newCorner1,
                corner2: newCorner2,
                center: center,
                width: finalWidth,
                height: finalHeight
            },
            geometry: this.geometry.generate(
                newCorner1, 
                newCorner2, 
                feature.properties.borderRadius || 0,
                bearing
            )
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
        const bearing = feature.properties.bearing || 0;
        
        if (bearing !== 0) {
            // For rotated rectangles, move the center and recalculate corners
            const oldCenter = this.geometry.normalizeCenter(feature.properties.center);
            const newCenter = [oldCenter[0] + dx, oldCenter[1] + dy];
            
            // Maintain original dimensions
            const width = feature.properties.width;
            const height = feature.properties.height;
            
            // Recalculate corners with new center, maintaining dimensions and bearing
            const halfWidth = width / 2;
            const halfHeight = height / 2;
            const newCorner1 = this.geometry.rotateAndTranslate(halfWidth, halfHeight, newCenter, bearing);
            const newCorner2 = this.geometry.rotateAndTranslate(-halfWidth, -halfHeight, newCenter, bearing);
            
            const updatedFeature = {
                ...feature,
                properties: {
                    ...feature.properties,
                    corner1: newCorner1,
                    corner2: newCorner2,
                    center: newCenter,
                    width: width,
                    height: height
                },
                geometry: this.geometry.generateRotatedRectangleGeometry(
                    newCenter,
                    width,
                    height,
                    feature.properties.borderRadius || 0,
                    bearing
                )
            };
            
            return updatedFeature;
        } else {
            // Without rotation: use original logic
            const corner1 = this.geometry.normalizeCorner(feature.properties.corner1);
            const corner2 = this.geometry.normalizeCorner(feature.properties.corner2);

            const newCorner1 = [corner1[0] + dx, corner1[1] + dy];
            const newCorner2 = [corner2[0] + dx, corner2[1] + dy];

            const { center, width, height } = this.geometry.calculateDimensionsFromCorners(newCorner1, newCorner2);

            // For bearing = 0, swap width and height to align with handle convention
            const finalWidth = height;
            const finalHeight = width;

            const updatedFeature = {
                ...feature,
                properties: {
                    ...feature.properties,
                    corner1: newCorner1,
                    corner2: newCorner2,
                    center: center,
                    width: finalWidth,
                    height: finalHeight
                },
                geometry: this.geometry.generate(
                    newCorner1, 
                    newCorner2, 
                    feature.properties.borderRadius || 0,
                    0
                )
            };

            return updatedFeature;
        }
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
        const btn = document.getElementById('rectangle-tool');
        if (btn) btn.innerHTML = `<img class="icon-sig-tool" src="${iconSrc}" alt="RECTANGLE" />`;
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
            this.createEditHandles(selectedFeature);
        }
    }

    // ===== DRAWING SYSTEM =====

    handleMapClick = async (e) => {
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
            await this.createFeature();
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
                    const borderRadius = selectedFeature ? 
                        (selectedFeature.properties.borderRadius || 0) : 
                        AddRectangleControl.DEFAULT_PROPERTIES.borderRadius;
                    const previewGeometry = this.geometry.generate(corner1, corner2, borderRadius);
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
        const featureName = await IDUtils.generateFeatureName('rectangle', this.map);

        // Generate geometry first
        const initialBearing = AddRectangleControl.DEFAULT_PROPERTIES.bearing || 0;
        const geometry = this.geometry.generate(
            corner1, 
            corner2, 
            AddRectangleControl.DEFAULT_PROPERTIES.borderRadius,
            initialBearing
        );

        // Extract real corners from normalized geometry
        let finalCorner1, finalCorner2;

        if (initialBearing !== 0) {
            // With bearing: calculate rotated corners
            const halfWidth = width / 2;
            const halfHeight = height / 2;
            finalCorner1 = this.geometry.rotateAndTranslate(halfWidth, halfHeight, center, initialBearing);
            finalCorner2 = this.geometry.rotateAndTranslate(-halfWidth, -halfHeight, center, initialBearing);
        } else {
            // Without bearing: extract from normalized geometry
            const extractedCorners = this.geometry.extractCornersFromGeometry(geometry);
            finalCorner1 = extractedCorners.corner1;
            finalCorner2 = extractedCorners.corner2;
        }

        // Recalculate dimensions from normalized corners
        const finalDimensions = this.geometry.calculateDimensionsFromCorners(finalCorner1, finalCorner2);

        // For bearing = 0, swap width and height to align with handle convention
        let finalWidth, finalHeight;
        if (initialBearing === 0) {
            finalWidth = finalDimensions.height;
            finalHeight = finalDimensions.width;
        } else {
            finalWidth = finalDimensions.width;
            finalHeight = finalDimensions.height;
        }

        const feature = {
            type: 'Feature',
            id: Date.now().toString(),
            properties: {
                ...AddRectangleControl.DEFAULT_PROPERTIES,
                layerId: getActiveLayerIdSync(),
                corner1: finalCorner1,
                corner2: finalCorner2,
                center: finalDimensions.center,
                width: finalWidth,
                height: finalHeight,
                id: featureId,
                nome: featureName
            },
            geometry: geometry
        };

        try {
            await addFeature('rectangles', feature);

            const data = await this.map.getSource('rectangles').getData();
            data.features.push(feature);

            if (feature.properties.hatchEnabled) {
                this.updateHatchPatterns(data);
            }
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
        // SelectionManager already stores the feature, we just need to create handles
        this.createEditHandles(feature);
        this.setupEditEventListeners();
        this.setupHoverListeners();
    }

    deselectFeature = () => {
        // SelectionManager already removes the feature, we just need to clean up UI
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
        const handles = this.geometry.createHandlesFromGeometry(
            feature.geometry, 
            feature.properties.id,
            feature.properties.bearing,
            feature.properties
        );
        if (!handles || handles.length === 0) return;

        this.map.getSource('rectangle-feedback').setData({
            type: 'Feature',
            geometry: feature.geometry,
            properties: {
                ...feature.properties,
                isSelected: true
            }
        });

        // Show handles (now can have 3 handles if bearing exists)
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
            this.activeHandleType = handle.properties.handleId;
            this.map.dragPan.disable();
            
            const cursor = this.getCursorForHandleType(this.activeHandleType);
            this.map.getCanvas().style.cursor = cursor;
            
            this.currentMousePosition = [e.lngLat.lng, e.lngLat.lat];
            e.preventDefault();
        }
    }

    /**
     * Get appropriate cursor for handle type
     * @param {string} handleType - Type of handle
     * @returns {string} CSS cursor value
     */
    getCursorForHandleType(handleType) {
        switch (handleType) {
            case 'width-resize':
                return 'ew-resize';
            case 'height-resize':
                return 'ns-resize';
            case 'rotation':
                return 'grabbing';
            default:
                return 'grabbing';
        }
    }

    onEditMouseMove = (e) => {
        const selectedFeature = this.getSelectedFeature();
        if (!this.isDraggingHandle || !selectedFeature) return;

        this.currentMousePosition = [e.lngLat.lng, e.lngLat.lat];
        this.lastPreviewPosition = this.currentMousePosition;

        if (!this.pendingPreviewUpdate) {
            this.pendingPreviewUpdate = true;
            this.previewRafId = requestAnimationFrame(this.performPreviewUpdate);
        }
    }

    onEditMouseUp = async (e) => {
        const selectedFeature = this.getSelectedFeature();
        if (this.isDraggingHandle && selectedFeature) {
            const finalMousePosition = [e.lngLat.lng, e.lngLat.lat];
            
            if (finalMousePosition && this.activeHandleType) {
                const result = this.geometry.updateFromHandle(
                    this.activeHandleType, 
                    finalMousePosition, 
                    selectedFeature
                );
                
                if (result && result.width > 10 && result.height > 10) {
                    const updatedFeature = {
                        ...selectedFeature,
                        properties: {
                            ...selectedFeature.properties,
                            corner1: result.corner1,
                            corner2: result.corner2,
                            center: result.center,
                            width: result.width,
                            height: result.height,
                            bearing: result.bearing
                        },
                        geometry: result.geometry
                    };

                    await this.forceUpdateMainSource(updatedFeature);
                    this.updateSelectionManagerFeature(updatedFeature);

                    setTimeout(() => {
                        this.createEditHandles(updatedFeature);
                    }, 10);
                    
                    this.updateUIAfterEdit();
                    this.saveFeatureChanges(updatedFeature);
                }
            }
        }

        this.isDraggingHandle = false;
        this.activeHandleType = null;
        this.currentMousePosition = null;
        this.hatchGenerator = new HatchPatternGenerator();
        this.map.dragPan.enable();
        this.map.getCanvas().style.cursor = '';
    }

    updateRectanglePreview = (newPosition) => {
        const selectedFeature = this.getSelectedFeature();
        if (!selectedFeature || !this.activeHandleType) return;

        clearTimeout(this.geometryDebounceTimer);
        this.geometryDebounceTimer = setTimeout(() => {
            const preview = this.geometry.calculatePreview(
                this.activeHandleType,
                newPosition,
                selectedFeature
            );
            
            if (!preview) return;

            this.map.getSource('rectangle-feedback').setData({
                type: 'Feature',
                geometry: preview.geometry,
                properties: {
                    ...selectedFeature.properties,
                    isSelected: true
                }
            });

            // Update handles using width, height and rotation
            const handles = [
                {
                    type: 'Feature',
                    id: `rectangle-handle-${selectedFeature.properties.id}-width`,
                    geometry: { 
                        type: 'Point', 
                        coordinates: preview.handlePositions.width
                    },
                    properties: {
                        role: 'handle',
                        handleType: 'vertex',
                        handleId: 'width-resize',
                        featureId: selectedFeature.properties.id,
                        mode: 'rectangle_editing',
                        meta: 'vertex',
                        user_isEditingHandle: true
                    }
                },
                {
                    type: 'Feature',
                    id: `rectangle-handle-${selectedFeature.properties.id}-height`,
                    geometry: { 
                        type: 'Point', 
                        coordinates: preview.handlePositions.height
                    },
                    properties: {
                        role: 'handle',
                        handleType: 'vertex',
                        handleId: 'height-resize',
                        featureId: selectedFeature.properties.id,
                        mode: 'rectangle_editing',
                        meta: 'vertex',
                        user_isEditingHandle: true
                    }
                },
                {
                    type: 'Feature',
                    id: `rectangle-handle-${selectedFeature.properties.id}-rotation`,
                    geometry: { 
                        type: 'Point', 
                        coordinates: preview.handlePositions.rotation
                    },
                    properties: {
                        role: 'handle',
                        handleType: 'eccentricity',
                        handleId: 'rotation',
                        featureId: selectedFeature.properties.id,
                        mode: 'rectangle_editing',
                        meta: 'vertex',
                        user_isEditingHandle: true
                    }
                }
            ];

            this.map.getSource('rectangle-edit-handles').setData({
                type: 'FeatureCollection',
                features: handles
            });
        }, 8);
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

        if (hasHandle || hasFeature) {
            this.map.getCanvas().style.cursor = 'pointer';
        } else {
            this.map.getCanvas().style.cursor = '';
        }
    }

    hasHandleAtPoint = (features) => {
        return features.some(f =>
            f.layer.id === 'rectangle-edit-handles-layer' &&
            f.properties.role === 'handle'
        );
    }

    hasSelectedFeatureAtPoint = (features) => {
        const selectedFeature = this.getSelectedFeature();
        if (!selectedFeature) return false;

        return features.some(f =>
            f.properties.source === 'rectangle' &&
            f.properties.id === selectedFeature.properties.id
        );
    }

    // ===== FEATURE MANAGEMENT INTERFACE =====

    updateFeaturesProperty = async (features, property, value) => {
        const data = await this.map.getSource('rectangles').getData();

        for (const feature of features) {
            const sourceFeature = data.features.find(f => f.properties.id == feature.properties.id);
            if (sourceFeature) {
                sourceFeature.properties[property] = value;
                feature.properties[property] = value;

                if (['borderRadius', 'bearing', 'corner1', 'corner2'].includes(property)) {
                    const corner1 = this.geometry.normalizeCorner(sourceFeature.properties.corner1);
                    const corner2 = this.geometry.normalizeCorner(sourceFeature.properties.corner2);
                    const { center, width, height } = this.geometry.calculateDimensionsFromCorners(corner1, corner2);
                    
                    // For bearing = 0, swap width and height to align with handle convention
                    const bearing = sourceFeature.properties.bearing || 0;
                    const finalWidth = bearing === 0 ? height : width;
                    const finalHeight = bearing === 0 ? width : height;
                    
                    sourceFeature.properties.center = center;
                    sourceFeature.properties.width = finalWidth;
                    sourceFeature.properties.height = finalHeight;
                    feature.properties.center = center;
                    feature.properties.width = finalWidth;
                    feature.properties.height = finalHeight;

                    const newGeometry = this.geometry.generate(
                        corner1, 
                        corner2, 
                        sourceFeature.properties.borderRadius || 0,
                        bearing
                    );
                    sourceFeature.geometry = newGeometry;
                    feature.geometry = newGeometry;
                }
            }
        }

        if (property.startsWith('hatch')) {
            this.updateHatchPatterns(data);
        }

        this.map.getSource('rectangles').setData(data);

        // Get fresh features from map source before updating SelectionManager
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
        // Always get fresh feature data from map source before saving
        const currentData = await this.map.getSource('rectangles').getData();
        let hasChanges = false;

        for (const selectedFeature of features) {
            if (this.hasFeatureChanged(selectedFeature, initialPropertiesMap.get(selectedFeature.properties.id))) {
                const currentFeature = currentData.features.find(f => f.properties.id == selectedFeature.properties.id);

                if (currentFeature) {
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
                initialProps.corner2,
                initialProps.borderRadius || 0,
                initialProps.bearing || 0
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
                const data = await this.map.getSource('rectangles').getData();
                const idsToDelete = new Set(features.map(f => String(f.properties.id)));
                data.features = data.features.filter(f => !idsToDelete.has(String(f.properties.id)));
                this.map.getSource('rectangles').setData(data);
            } catch (error) {
                console.error(`Error removing rectangle ${feature.properties.id}:`, error);
            }
        }
    }
    updateHatchPatterns = (data) => {
        if (!data || !data.features) {
            return;
        }
        const features = data.features.filter(f => f.properties.hatchEnabled);
        this.hatchGenerator.loadPatternsToMap(this.map, features);
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
            feature.properties.borderRadius !== initialProperties.borderRadius ||
            feature.properties.bearing !== initialProperties.bearing ||
            feature.properties.width !== initialProperties.width ||
            feature.properties.height !== initialProperties.height ||
            feature.properties.nome !== initialProperties.nome ||
            feature.properties.descricao !== initialProperties.descricao ||
            feature.properties.visivel !== initialProperties.visivel ||
            feature.properties.bloqueado !== initialProperties.bloqueado ||
            feature.properties.hatchEnabled !== initialProperties.hatchEnabled ||
            feature.properties.hatchType !== initialProperties.hatchType ||
            feature.properties.hatchColor !== initialProperties.hatchColor ||
            feature.properties.hatchSpacing !== initialProperties.hatchSpacing ||
            feature.properties.hatchLineWidth !== initialProperties.hatchLineWidth ||
            JSON.stringify(feature.properties.corner1) !== JSON.stringify(initialProperties.corner1) ||
            JSON.stringify(feature.properties.corner2) !== JSON.stringify(initialProperties.corner2)
        );
    }

    updateFeatures = async (features, save = false, onlyUpdateProperties = false) => {
        if (features.length > 0) {
            const data = await this.map.getSource('rectangles').getData();
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
        this.currentMousePosition = null;
        this.hatchGenerator = new HatchPatternGenerator();

        if (this.geometryDebounceTimer) {
            clearTimeout(this.geometryDebounceTimer);
            this.geometryDebounceTimer = null;
        }
    }

    forceUpdateMainSource = async (feature) => {
        if (this.uiManager && this.uiManager.isDragging) {
            return;
        }

        const data = await this.map.getSource('rectangles').getData();
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
    }

    removeAllEventListeners = () => {
        this.map.off('mousemove', this.handlePreviewMouseMove);
        this.removeEditEventListeners();
        this.removeHoverListeners();
        this.cancelPendingUpdates();
    }
}

export default AddRectangleControl;
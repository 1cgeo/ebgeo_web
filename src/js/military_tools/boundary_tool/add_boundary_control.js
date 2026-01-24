// Path: js/military_tools/boundary_tool/add_boundary_control.js

import { addFeature, updateFeature, removeFeature, getActiveLayerIdSync } from '../../store';
import { IDUtils } from '../../utilities';
import { addBoundaryAttributesToPanel } from './boundary_attributes_panel.js';
import AddBoundaryGeometry from './add_boundary_geometry.js';
import { BaseControl } from '../../tool_manager';

/**
 * Boundary Tool Control
 * Manages drawing, editing, and interaction for boundary line features with echelon symbols
 */
class AddBoundaryControl extends BaseControl {
    // ===== SYMBOL SIZE CONSTANTS =====
    static SYMBOL_SIZE_CONSTANTS = {
        MIN_SIZE_KM: 0.05,          // Minimum symbol size (50 meters)
        DEFAULT_SIZE_KM: 1,         // Fallback size if zoom calculation fails
        ZOOM_BASE_MULTIPLIER: 0.05, // Base multiplier for zoom-adaptive sizing
        ZOOM_EXPONENT_BASE: 2       // Exponential base for zoom scaling
    };

    constructor(toolManager) {
        super(toolManager);

        this.drawPoints = [];
        this.isDraggingHandle = false;
        this.activeHandleType = null;
        this.activeHandleIndex = null;

        this.geometry = new AddBoundaryGeometry();

        this.previewRafId = null;
        this.pendingPreviewUpdate = false;
        this.lastPreviewPosition = null;
        this.lastPreviewPoints = null;
        this.geometryDebounceTimer = null;

        this.clickTimer = null;
        this.lastClickCoords = null;
        this._name = 'AddBoundaryControl';
    }

    static DEFAULT_PROPERTIES = {
        color: '#000000',
        lineWidth: 4,
        opacity: 1,
        source: 'boundary',
        type: 'boundary',
        symbol_position_ratio: 0.5,
        symbol_size: 1,
        text_size: 35,
        echelon: 'XXX',
        text_top: '',
        text_bottom: '',
        text_distance_ratio: 0.9,
        nome: '',
        descricao: '',
        visivel: true,
        bloqueado: false
    };

    // ===== ZOOM-ADAPTIVE SIZING =====

    /**
     * Calculate symbol size based on current zoom level
     * @param {number} zoom - Current map zoom level
     * @returns {number} Symbol size in kilometers
     */
    calculateSymbolSizeForZoom(zoom) {
        const { ZOOM_BASE_MULTIPLIER, ZOOM_EXPONENT_BASE, DEFAULT_SIZE_KM, MIN_SIZE_KM } =
            AddBoundaryControl.SYMBOL_SIZE_CONSTANTS;

        try {
            const calculatedSize = Math.pow(ZOOM_EXPONENT_BASE, 16 - zoom) * ZOOM_BASE_MULTIPLIER;
            return Math.max(MIN_SIZE_KM, calculatedSize);
        } catch (error) {
            console.warn('Error calculating zoom-adaptive size, using default:', error);
            return DEFAULT_SIZE_KM;
        }
    }

    // ===== SELECTION MANAGER INTEGRATION =====

    /**
     * Get currently selected boundary feature from SelectionManager
     * @returns {Object|null} Selected boundary feature or null
     */
    getSelectedFeature() {
        const selectedItems = this.selectionManager.getSelectedFeaturesByType('boundary');
        return selectedItems.length > 0 ? selectedItems[0].feature : null;
    }

    /**
     * Get all selected boundary features from SelectionManager
     * @returns {Array} Array of selected boundary features
     */
    getSelectedFeatures() {
        return this.selectionManager.getSelectedFeaturesByType('boundary')
            .map(item => item.feature);
    }

    // ===== MAPBOX CONTROL INTERFACE =====

    onAdd = (map) => {
        this.map = map;
    }

    onRemove = () => {
        this.deactivate();
        this.removeAllEventListeners();
        this.map = undefined;
    }

    // ===== TOOL-CENTRIC INTERFACE IMPLEMENTATIONS =====

    hasAttributePanel() {
        return true;
    }

    createAttributePanel(container, features, selectionManager, uiManager, options = {}) {
        const sectionPanel = document.createElement('div');
        sectionPanel.className = 'boundary-attributes-section';

        try {
            addBoundaryAttributesToPanel(sectionPanel, features, this, selectionManager, uiManager, options);
            container.appendChild(sectionPanel);
        } catch (error) {
            console.error('Error creating boundary attribute panel:', error);
        }
    }

    getDragSources() {
        return ['boundarys'];
    }

    getEditHandleSources() {
        return ['boundary-edit-handles'];
    }

    createSelectionBox(feature) {
        try {
            if (feature.properties.baseCoordinates) {
                const coordinates = this.geometry.normalizeBaseCoordinates(feature.properties.baseCoordinates);
                if (coordinates && coordinates.length >= 2) {
                    const bbox = this.geometry.getBoundingBox(coordinates);
                    const expandedBbox = this.expandBboxWithPadding(bbox, this.getSelectionBoxPadding(),this.map);
                    return turf.bboxPolygon(expandedBbox);
                }
            }
            return turf.bbox(feature);
        } catch (error) {
            console.warn('Error creating boundary selection box:', error);
            return null;
        }
    }

    getSelectionBoxStrategy() {
        return 'bbox';
    }

    getSelectionBoxPadding() {
        return 8;
    }

    getLayerIds() {
        return ['boundary-layer'];
    }

    getSourceNames() {
        return ['boundarys'];
    }

    getEditHandleSource() {
        return 'boundary-edit-handles';
    }

    canCopy(feature) {
        return true;
    }

    canPaste(feature) {
        return true;
    }

    prepareForPaste(feature, offset) {
        const oldCoords = this.geometry.normalizeBaseCoordinates(feature.properties.baseCoordinates);
        if (!oldCoords) return feature;

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
            geometry: this.geometry.generate({
                ...feature.properties,
                baseCoordinates: newCoords
            })
        };
    }

    calculateMoveOffset(feature, referencePoint) {
        const coordinates = this.geometry.normalizeBaseCoordinates(feature.properties.baseCoordinates);
        if (!coordinates || coordinates.length === 0) {
            return [0, 0];
        }

        const firstPoint = coordinates[0];
        return [
            firstPoint[0] - referencePoint.lng,
            firstPoint[1] - referencePoint.lat
        ];
    }

    updateFeatureForMove(feature, dx, dy, newCoords) {
        const oldCoords = this.geometry.normalizeBaseCoordinates(feature.properties.baseCoordinates);
        if (!oldCoords) return feature;

        const newBaseCoords = oldCoords.map(coord => [
            coord[0] + dx,
            coord[1] + dy
        ]);

        const updatedFeature = {
            ...feature,
            properties: {
                ...feature.properties,
                baseCoordinates: newBaseCoords
            },
            geometry: this.geometry.generate({
                ...feature.properties,
                baseCoordinates: newBaseCoords
            })
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
        this.lastClickCoords = null;
        this.map.getCanvas().style.cursor = 'crosshair';
        this.map.getCanvas().addEventListener('contextmenu', this.handleRightClick);
    }

    deactivate = () => {
        this.isActive = false;
        this.map.off('mousemove', this.handlePreviewMouseMove);
        this.drawPoints = [];
        this.lastClickCoords = null;
        this.map.getCanvas().style.cursor = '';
        this.map.getCanvas().removeEventListener('contextmenu', this.handleRightClick);
        this.clearPreview();
        this.deselectFeature();
    }

    // ===== SELECTION SYSTEM INTEGRATION =====

    onFeatureSelected = (feature) => {
        if (feature?.properties?.baseCoordinates) {
            const normalizedCoords = this.geometry.normalizeBaseCoordinates(feature.properties.baseCoordinates);
            if (normalizedCoords && normalizedCoords.length >= 2) {
                feature.properties.baseCoordinates = normalizedCoords;
                this.selectFeature(feature);
            } else {
                console.warn('Cannot select boundary feature - invalid coordinates:', feature.properties.baseCoordinates);

            }
        } else {
            this.selectFeature(feature);
        }
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
                const normalizedCoords = this.geometry.normalizeBaseCoordinates(updatedFeature.properties.baseCoordinates);
                if (normalizedCoords && normalizedCoords.length >= 2) {
                    updatedFeature.properties.baseCoordinates = normalizedCoords;
                    this.updateSelectionManagerFeature(updatedFeature);
                    this.createEditHandles(updatedFeature);
                } else {
                    console.warn('Invalid coordinates in moved feature, keeping current selection');
                }
            }
        }

        // Update dependent features with moved data
        this.updateDependentFeaturesFromMovedFeatures(movedFeatures);
    }

    // ===== DRAWING SYSTEM =====

    handleMapClick = (e) => {
        if (!this.isActive) return;

        const newPoint = [e.lngLat.lng, e.lngLat.lat];

        if (this.geometry.isPointTooClose(newPoint, this.drawPoints)) {
            return;
        }

        this.lastClickCoords = newPoint;
        clearTimeout(this.clickTimer);
        this.clickTimer = setTimeout(() => {
            this.drawPoints.push(this.lastClickCoords);
            this.lastClickCoords = null;

            // Add mousemove listener when first point is added
            if (this.drawPoints.length === 1) {
                this.map.on('mousemove', this.handlePreviewMouseMove);
            }
        }, 250);
    }

    handleRightClick = async (e) => {
        if (!this.isActive) return;

        e.preventDefault();
        e.stopPropagation();

        clearTimeout(this.clickTimer);
        this.clickTimer = null;
        this.lastClickCoords = null;

        const coordinates = this.map.unproject([e.offsetX, e.offsetY]);
        const finalPoint = [coordinates.lng, coordinates.lat];

        if (!this.geometry.isPointTooClose(finalPoint, this.drawPoints)) {
            this.drawPoints.push(finalPoint);
        }

        if (this.drawPoints.length >= 2) {
            await this.createFeature();
        }

        this.stopDrawing();
    }

    handlePreviewMouseMove = (e) => {
        if (this.drawPoints.length >= 1) {
            this.lastPreviewPoints = [...this.drawPoints];
            this.lastPreviewPosition = [e.lngLat.lng, e.lngLat.lat];

            if (!this.pendingPreviewUpdate) {
                this.pendingPreviewUpdate = true;
                this.previewRafId = requestAnimationFrame(this.performPreviewUpdate.bind(this));
            }
        }
    }

    performPreviewUpdate = () => {
        if (!this.lastPreviewPosition) {
            this.pendingPreviewUpdate = false;
            return;
        }

        if (this.isDraggingHandle && this.getSelectedFeature() && this.activeHandleType) {
            this.updateBoundaryPreview(this.lastPreviewPosition);
        } else if (this.lastPreviewPoints && this.lastPreviewPoints.length >= 1) {
            const previewPoints = [...this.lastPreviewPoints];
            if (this.lastClickCoords) {
                previewPoints.push(this.lastClickCoords);
            }
            previewPoints.push(this.lastPreviewPosition);

            if (previewPoints.length >= 1) {
                clearTimeout(this.geometryDebounceTimer);
                this.geometryDebounceTimer = setTimeout(() => {
                    const currentZoom = this.map.getZoom();
                    const previewSize = this.calculateSymbolSizeForZoom(currentZoom);

                    const previewProperties = {
                        ...AddBoundaryControl.DEFAULT_PROPERTIES,
                        symbol_size: previewSize,
                        baseCoordinates: previewPoints
                    };
                    const previewGeometry = this.geometry.generate(previewProperties);
                    this.showPreview(previewGeometry);
                }, 8);
            }
        }

        this.pendingPreviewUpdate = false;
    }

    showPreview = (geometry) => {
        this.map.getSource('boundary-feedback').setData({
            type: 'Feature',
            geometry: geometry,
            properties: {}
        });
    }

    clearPreview = () => {
        this.cancelPendingUpdates();
        if (this.map && this.map.getSource('boundary-feedback')) {
            this.map.getSource('boundary-feedback').setData({
                type: 'FeatureCollection',
                features: []
            });
        }
    }

    stopDrawing = () => {
        this.map.off('mousemove', this.handlePreviewMouseMove);
        this.drawPoints = [];
        this.lastClickCoords = null;
        this.clearPreview();
    }

    createFeature = async () => {
        if (this.drawPoints.length < 2) return;

        if (!this.geometry.validate(this.drawPoints)) {
            console.warn('Insufficient valid points for boundary creation');
            return;
        }

        const featureId = IDUtils.generateUniqueId();
        const featureName = await IDUtils.generateFeatureName('boundary', this.map);

        const currentZoom = this.map.getZoom();
        const adaptiveSymbolSize = this.calculateSymbolSizeForZoom(currentZoom);

        const properties = {
            ...AddBoundaryControl.DEFAULT_PROPERTIES,
            symbol_size: adaptiveSymbolSize,
            baseCoordinates: [...this.drawPoints],
            id: featureId,
            nome: featureName,
            layerId: getActiveLayerIdSync(),
        };

        const geometry = this.geometry.generate(properties);

        if (!geometry || !geometry.coordinates) {
            console.error('Failed to generate valid geometry for boundary');
            return;
        }

        const feature = {
            type: 'Feature',
            id: Date.now().toString(),
            properties: properties,
            geometry: geometry
        };

        try {
            await addFeature('boundarys', feature);

            const data = await this.map.getSource('boundarys').getData();
            data.features.push(feature);
            this.map.getSource('boundarys').setData(data);

            await this.updateDependentFeatures(feature);

            this.drawPoints = [];
            this.toolManager.deactivateCurrentTool();
            await this.selectionManager.toggleFeatureSelection('boundary', featureId, feature);
            this.selectionManager.updateUI();
        } catch (error) {
            console.error('Error creating boundary:', error);
        }
    }

    // ===== EDIT HANDLES SYSTEM =====

    selectFeature = (feature) => {
        this.createEditHandles(feature);
        this.setupEditEventListeners();
        this.setupHoverListeners();
        this.setupEditRightClickListener();
    }

    deselectFeature = () => {
        this.isDraggingHandle = false;
        this.activeHandleType = null;
        this.activeHandleIndex = null;
        this.clearEditHandles();
        this.removeEditEventListeners();
        this.removeHoverListeners();
        this.removeEditRightClickListener();
        this.cancelPendingUpdates();
        this.map.dragPan.enable();
        this.map.getCanvas().style.cursor = '';
    }

    createEditHandles = (feature) => {
        const handles = this.geometry.createHandles(feature);
        if (!handles || handles.length === 0) return;

        this.map.getSource('boundary-feedback').setData({
            type: 'Feature',
            geometry: feature.geometry,
            properties: {}
        });

        this.map.getSource('boundary-edit-handles').setData({
            type: 'FeatureCollection',
            features: handles
        });
    }

    clearEditHandles = () => {
        this.map.getSource('boundary-feedback').setData({
            type: 'FeatureCollection',
            features: []
        });
        this.map.getSource('boundary-edit-handles').setData({
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
        // Ignore right-click (button 2) - handled by handleEditRightClick
        if (e.originalEvent && e.originalEvent.button === 2) return;

        const selectedFeature = this.getSelectedFeature();
        if (!selectedFeature) return;

        const handleFeatures = this.map.queryRenderedFeatures(e.point, {
            layers: ['boundary-handles-layer']
        });

        if (handleFeatures.length > 0) {
            const handle = handleFeatures[0];
            if (handle.properties.user_isEditingHandle) {
                this.isDraggingHandle = true;
                this.activeHandleType = handle.properties.type;
                this.activeHandleIndex = handle.properties.index;
                this.map.dragPan.disable();
                this.map.getCanvas().style.cursor = 'grabbing';
                e.preventDefault();
            }
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

    onEditMouseUp = async () => {
        const selectedFeature = this.getSelectedFeature();
        if (this.isDraggingHandle && selectedFeature && this.activeHandleType && this.lastPreviewPosition) {
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

                await this.forceUpdateMainSource(updatedFeature);
                this.updateSelectionManagerFeature(updatedFeature);
                await this.updateDependentFeatures(updatedFeature);
                this.createEditHandles(updatedFeature);
                this.updateUIAfterEdit();
                this.saveFeatureChanges(updatedFeature);
            }
        }

        this.isDraggingHandle = false;
        this.activeHandleType = null;
        this.activeHandleIndex = null;
        this.map.dragPan.enable();
        this.map.getCanvas().style.cursor = '';
    }

    updateBoundaryPreview = (newPosition) => {
        const selectedFeature = this.getSelectedFeature();
        if (!selectedFeature || !this.activeHandleType) return;

        clearTimeout(this.geometryDebounceTimer);
        this.geometryDebounceTimer = setTimeout(() => {
            const currentHandleType = this.activeHandleType;
            const currentFeature = this.getSelectedFeature();
            const currentHandleIndex = this.activeHandleIndex;

            if (currentHandleType && currentFeature) {
                const result = this.geometry.updateFromHandle(
                    currentHandleType,
                    newPosition,
                    currentFeature,
                    currentHandleIndex
                );

                if (result) {
                    this.showEditPreview(result.geometry, result.properties);
                }
            }
        }, 8);
    }

    showEditPreview = (geometry, properties) => {
        this.map.getSource('boundary-feedback').setData({
            type: 'Feature',
            geometry: geometry,
            properties: {}
        });

        const tempFeature = { properties, geometry };
        const handles = this.geometry.createHandles(tempFeature);
        this.map.getSource('boundary-edit-handles').setData({
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

    // ===== EDIT MODE RIGHT-CLICK (VERTEX REMOVAL) =====

    setupEditRightClickListener = () => {
        // Use capture phase to intercept before context menu control
        this.map.getCanvas().addEventListener('contextmenu', this.handleEditRightClick, true);
    }

    removeEditRightClickListener = () => {
        this.map.getCanvas().removeEventListener('contextmenu', this.handleEditRightClick, true);
    }

    /**
     * Handle right-click during edit mode to remove vertices
     * @param {MouseEvent} e - Right-click event
     */
    handleEditRightClick = async (e) => {
        const selectedFeature = this.getSelectedFeature();
        if (!selectedFeature) return;

        // Get the point from mouse coordinates
        const point = [e.offsetX, e.offsetY];

        // Query for vertex handles at click point
        const handleFeatures = this.map.queryRenderedFeatures(point, {
            layers: ['boundary-handles-layer']
        });

        // Find if we clicked on a vertex handle (not midpoint or other handle types)
        // Boundary uses 'type' property instead of 'handleType'
        const vertexHandle = handleFeatures.find(f =>
            f.properties.type === 'vertex' &&
            f.properties.user_isEditingHandle
        );

        if (!vertexHandle) return;

        // Prevent context menu from appearing - must be done before any async operation
        e.preventDefault();
        e.stopPropagation();

        const vertexIndex = vertexHandle.properties.index;
        const coordinates = this.geometry.normalizeBaseCoordinates(selectedFeature.properties.baseCoordinates);

        // Check if we can remove (boundaries must have more than 2 vertices)
        if (!coordinates || coordinates.length <= 2) {
            this.showVertexRemovalWarning();
            return;
        }

        // Remove the vertex
        const newCoordinates = this.geometry.removeVertexAtIndex(coordinates, vertexIndex);
        if (!newCoordinates) {
            return;
        }

        // Update the feature
        const updatedProperties = {
            ...selectedFeature.properties,
            baseCoordinates: newCoordinates
        };

        const updatedFeature = {
            ...selectedFeature,
            properties: updatedProperties,
            geometry: this.geometry.generate(updatedProperties)
        };

        // Apply updates
        await this.forceUpdateMainSource(updatedFeature);
        this.updateSelectionManagerFeature(updatedFeature);
        await this.updateDependentFeatures(updatedFeature);
        this.createEditHandles(updatedFeature);
        this.updateUIAfterEdit();
        this.saveFeatureChanges(updatedFeature);
    }

    /**
     * Show warning when vertex cannot be removed
     */
    showVertexRemovalWarning() {
        // Remove existing warning if any
        const existingWarning = document.querySelector('.vertex-removal-warning');
        if (existingWarning) {
            existingWarning.remove();
        }

        const warning = document.createElement('div');
        warning.className = 'vertex-removal-warning';
        warning.textContent = 'Linha de limite deve ter no mínimo 2 vértices';
        warning.style.cssText = `
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            background-color: #f44336;
            color: white;
            padding: 12px 24px;
            border-radius: 4px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 14px;
            font-weight: 500;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            z-index: 10000;
            animation: fadeInOut 2s ease-in-out forwards;
        `;

        // Add animation style if not exists
        if (!document.querySelector('#vertex-warning-style')) {
            const style = document.createElement('style');
            style.id = 'vertex-warning-style';
            style.textContent = `
                @keyframes fadeInOut {
                    0% { opacity: 0; transform: translateX(-50%) translateY(-10px); }
                    15% { opacity: 1; transform: translateX(-50%) translateY(0); }
                    85% { opacity: 1; transform: translateX(-50%) translateY(0); }
                    100% { opacity: 0; transform: translateX(-50%) translateY(-10px); }
                }
            `;
            document.head.appendChild(style);
        }

        document.body.appendChild(warning);

        // Remove after animation
        setTimeout(() => {
            if (warning.parentNode) {
                warning.remove();
            }
        }, 2000);
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
            f.layer?.id === 'boundary-handles-layer'
        );
    }

    hasSelectedFeatureAtPoint = (features) => {
        const selectedFeature = this.getSelectedFeature();
        if (!selectedFeature) return false;
        return features.some(f =>
            f.source === 'boundarys' &&
            f.properties.id === selectedFeature.properties.id
        );
    }

    // ===== DEPENDENT FEATURES MANAGEMENT =====

    updateDependentFeatures = async (boundaryFeature) => {
        await this.updateBoundaryCircles(boundaryFeature);
        await this.updateBoundaryTexts(boundaryFeature);
    }

    updateDependentFeaturesFromMovedFeatures = (movedFeatures) => {
        movedFeatures.forEach(feature => {
            if (feature.properties.source === 'boundary') {
                this.updateDependentFeatures(feature);
            }
        });
    }

    updateBoundaryCircles = async (boundaryFeature) => {
        const circleData = await this.map.getSource('boundary-circles').getData();
        const featureId = boundaryFeature.properties.id;

        circleData.features = circleData.features.filter(f => f.properties.parent !== featureId);

        const circles = this.geometry.generateBoundaryCircles(boundaryFeature);
        circleData.features.push(...circles);

        this.map.getSource('boundary-circles').setData(circleData);
    }

    updateBoundaryTexts = async (boundaryFeature) => {
        const textData = await this.map.getSource('boundary-texts').getData();
        const featureId = boundaryFeature.properties.id;

        textData.features = textData.features.filter(f => f.properties.parent !== featureId);

        const texts = this.geometry.generateBoundaryTexts(boundaryFeature);
        textData.features.push(...texts);

        this.map.getSource('boundary-texts').setData(textData);
    }

    // ===== FEATURE MANAGEMENT INTERFACE =====

    updateFeaturesProperty = async (features, property, value) => {
        const data = await this.map.getSource('boundarys').getData();

        for (const feature of features) {
            const sourceFeature = data.features.find(f => f.properties.id == feature.properties.id);
            if (sourceFeature) {
                sourceFeature.properties[property] = value;
                feature.properties[property] = value;

                if (['baseCoordinates', 'symbol_position_ratio', 'symbol_size', 'echelon', 'text_distance_ratio'].includes(property)) {
                    const newGeometry = this.geometry.generate(sourceFeature.properties);
                    sourceFeature.geometry = newGeometry;
                    feature.geometry = newGeometry;
                }

                if (['color', 'lineWidth', 'opacity', 'text_top', 'text_bottom', 'text_size', 'text_distance_ratio', 'echelon', 'symbol_position_ratio', 'symbol_size'].includes(property)) {
                    await this.updateDependentFeatures(sourceFeature);
                }
            }
        }

        this.map.getSource('boundarys').setData(data);

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
        const currentData = await this.map.getSource('boundarys').getData();
        let hasChanges = false;

        for (const selectedFeature of features) {
            if (this.hasFeatureChanged(selectedFeature, initialPropertiesMap.get(selectedFeature.properties.id))) {
                const currentFeature = currentData.features.find(f => f.properties.id == selectedFeature.properties.id);

                if (currentFeature) {
                    await updateFeature('boundarys', currentFeature);
                    hasChanges = true;
                }
            }
        }
    }

    discardChangeFeatures = async (features, initialPropertiesMap) => {
        features.forEach(f => {
            Object.assign(f.properties, initialPropertiesMap.get(f.properties.id));
            f.geometry = this.geometry.generate(f.properties);
        });

        await this.updateFeatures(features, true);
    }

    deleteFeatures = async (features) => {
        if (features.length === 0) return;

        const mainData = await this.map.getSource('boundarys').getData();
        const textData = await this.map.getSource('boundary-texts').getData();
        const circleData = await this.map.getSource('boundary-circles').getData();

        for (const feature of features) {
            try {
                const featureId = feature.properties.id;
                await removeFeature('boundarys', featureId);

                const idString = String(featureId);
                mainData.features = mainData.features.filter(f => String(f.properties.id) !== idString);
                textData.features = textData.features.filter(f => f.properties.parent !== featureId);
                circleData.features = circleData.features.filter(f => f.properties.parent !== featureId);

            } catch (error) {
                console.error(`Error removing boundary ${feature.properties.id}:`, error);
            }
        }

        this.map.getSource('boundarys').setData(mainData);
        this.map.getSource('boundary-texts').setData(textData);
        this.map.getSource('boundary-circles').setData(circleData);
    }

    setDefaultProperties = (properties) => {
        const {
            id,
            nome,
            baseCoordinates,
            ...styleProperties
        } = properties;

        Object.assign(AddBoundaryControl.DEFAULT_PROPERTIES, styleProperties);
    }

    hasFeatureChanged = (feature, initialProperties) => {
        if (!initialProperties) return true;

        return (
            feature.properties.color !== initialProperties.color ||
            feature.properties.lineWidth !== initialProperties.lineWidth ||
            feature.properties.echelon !== initialProperties.echelon ||
            feature.properties.text_top !== initialProperties.text_top ||
            feature.properties.text_bottom !== initialProperties.text_bottom ||
            feature.properties.symbol_size !== initialProperties.symbol_size ||
            feature.properties.symbol_position_ratio !== initialProperties.symbol_position_ratio ||
            feature.properties.text_distance_ratio !== initialProperties.text_distance_ratio ||
            feature.properties.nome !== initialProperties.nome ||
            feature.properties.descricao !== initialProperties.descricao ||
            feature.properties.visivel !== initialProperties.visivel ||
            feature.properties.bloqueado !== initialProperties.bloqueado ||
            JSON.stringify(feature.properties.baseCoordinates) !== JSON.stringify(initialProperties.baseCoordinates)
        );
    }

    updateFeatures = async (features, save = false) => {
        if (features.length > 0) {
            const data = await this.map.getSource('boundarys').getData();
            for (const feature of features) {
                const featureIndex = data.features.findIndex(f => f.properties.id == feature.properties.id);
                if (featureIndex !== -1) {
                    data.features[featureIndex] = feature;
                    await this.updateDependentFeatures(feature);

                    if (save) {
                        await updateFeature('boundarys', feature);
                    }
                }
            }

            this.map.getSource('boundarys').setData(data);
            this.updateSelectionManagerFeatures(features);
        }
    }

    // ===== SELECTION MANAGER INTEGRATION =====

    updateSelectionManagerFeature(feature) {
        this.selectionManager.updateSelectedFeature('boundary', feature.properties.id, feature);
    }

    updateSelectionManagerFeatures(features) {
        features.forEach(feature => {
            if (feature.properties.source === 'boundary') {
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
        this.activeHandleType = null;
        this.activeHandleIndex = null;

        if (this.geometryDebounceTimer) {
            clearTimeout(this.geometryDebounceTimer);
            this.geometryDebounceTimer = null;
        }

        if (this.clickTimer) {
            clearTimeout(this.clickTimer);
            this.clickTimer = null;
        }
    }

    forceUpdateMainSource = async (feature) => {
        if (this.uiManager && this.uiManager.isDragging) {
            return;
        }

        const data = await this.map.getSource('boundarys').getData();
        const sourceFeature = data.features.find(f => f.properties.id == feature.properties.id);
        if (sourceFeature) {
            sourceFeature.properties = { ...feature.properties };
            sourceFeature.geometry = { ...feature.geometry };
            this.map.getSource('boundarys').setData(data);
        }
    }

    updateUIAfterEdit = () => {
        this.selectionManager.uiManager.updateSelectionHighlight();
        this.selectionManager.uiManager.updatePanels();
        this.selectionManager.updateUI();
    }

    saveFeatureChanges = async (feature) => {
        try {
            await updateFeature('boundarys', feature);
        } catch (error) {
            console.error('Error saving feature changes:', error);
        }
    }

    setupBaseEventListeners = () => {
    }

    removeAllEventListeners = () => {
        this.map.getCanvas().removeEventListener('contextmenu', this.handleRightClick);
        this.map.off('mousemove', this.handlePreviewMouseMove);
        this.removeEditEventListeners();
        this.removeHoverListeners();
        this.removeEditRightClickListener();
        this.cancelPendingUpdates();
    }
}

export default AddBoundaryControl;

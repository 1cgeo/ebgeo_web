// Path: js/draw_tools/polygon_tool/add_polygon_control.js

import { addFeature, updateFeature, removeFeature, getActiveLayerIdSync } from '../../store';
import { IDUtils, showWarning } from '../../utilities';
import { isTouchDevice } from '../../utilities/pointer-utils';
import { DrawingFinishButton, setupVertexRemoveLongPress } from '../drawing-touch-helpers';
import { addPolygonAttributesToPanel } from './polygon_attributes_panel.js';
import AddPolygonGeometry from './add_polygon_geometry.js';
import { BaseControl, HatchPatternGenerator } from '../../tool_manager';
import { LABEL_DEFAULT_PROPERTIES, hasLabelChanged, LABEL_ZOOM_PROPERTIES, recalcLabelSize, createLabelZoomHandler, syncLabelSource } from '../../tool_manager/helpers/label-tab.helpers.js';
import { getSnappingService } from '../../snapping/snapping.service.js';

class AddPolygonControl extends BaseControl {
    featureType = 'polygon';
    constructor(toolManager) {
        super(toolManager);

        // State management
        this.drawPoints = [];
        this.isDraggingHandle = false;
        this.activeHandle = null;      // Store complete handle object
        this.activeHandleType = null;  // Handle type string
        this.activeHandleIndex = null; // Handle index for vertex/midpoint operations

        // Geometry handler
        this.geometry = new AddPolygonGeometry();

        // Performance optimization - RAF system
        this.previewRafId = null;
        this.pendingPreviewUpdate = false;
        this.lastPreviewPosition = null;
        this.geometryDebounceTimer = null;
        this.hatchGenerator = new HatchPatternGenerator();
        this._name = 'AddPolygonControl';

        // Touch support
        this._finishButton = null;
        this._cleanupVertexLongPress = null;
    }

    static DEFAULT_PROPERTIES = {
        fillColor: '#3f4fb5',
        lineColor: '#3f4fb5',
        lineWidth: 2,
        opacity: 0.5,
        lineStyle: 'solid',
        source: 'polygon',
        nome: '',
        descricao: '',
        visivel: true,
        bloqueado: false,
        hatchEnabled: false,
        hatchType: 'none',
        hatchColor: '#000000',
        hatchSpacing: 8,
        hatchLineWidth: 2,
        ...LABEL_DEFAULT_PROPERTIES,
        observations: [],
    };

    // ===== SINGLE SOURCE OF TRUTH =====

    // ===== MAPBOX CONTROL INTERFACE =====

    onAdd = (map) => {
        this.map = map;
        map.on('zoom', this._onZoomForLabels);
    }

    onRemove = () => {
        this.deactivate();
        this.removeAllEventListeners();
        if (this.map) {
            this.map.off('zoom', this._onZoomForLabels);
        }
        this.#labelZoom.cleanup();
        this.map = undefined;
    }

    // ===== TOOL-CENTRIC INTERFACE IMPLEMENTATIONS =====

    hasAttributePanel() {
        return true;
    }

    createAttributePanel(container, features, selectionManager, uiManager, options = {}) {
        const sectionPanel = document.createElement('div');
        sectionPanel.className = 'polygon-attributes-section';

        try {
            addPolygonAttributesToPanel(sectionPanel, features, this, selectionManager, uiManager, options);
            container.appendChild(sectionPanel);
        } catch (error) {
            console.error('Error creating polygon attribute panel:', error);
        }
    }

    getDragSources() {
        return ['polygons'];
    }

    getEditHandleSources() {
        return ['polygon-edit-handles'];
    }

    createSelectionBox(feature) {
        try {
            const bbox = turf.bbox(feature);
            const expandedBbox = this.expandBboxWithPadding(bbox, this.getSelectionBoxPadding(),this.map);
            return turf.bboxPolygon(expandedBbox);
        } catch (error) {
            console.warn('Error creating polygon selection box:', error);
            return null;
        }
    }

    getSelectionBoxStrategy() {
        return 'bbox';
    }

    getSelectionBoxPadding() {
        return 8; // Slightly larger padding for polygons
    }

    getLayerIds() {
        return ['polygon-fill-layer', 'polygon-fill-pattern-layer', 'polygon-layer', 'polygon-label-layer'];
    }

    getSourceNames() {
        return ['polygons'];
    }

    getEditHandleSource() {
        return 'polygon-edit-handles';
    }

    canCopy(_feature) {
        return true;
    }

    canPaste(_feature) {
        return true;
    }

    prepareForPaste(feature, offset) {
        const coordinates = this.geometry.normalizeBaseCoordinates(feature.properties.baseCoordinates);
        const newCoordinates = this.geometry.applyOffset(coordinates, offset.dx, offset.dy);

        return {
            ...feature,
            properties: {
                ...feature.properties,
                baseCoordinates: newCoordinates
            },
            geometry: this.geometry.generate(newCoordinates)
        };
    }

    calculateMoveOffset(feature, referencePoint) {
        const centerPoint = this.geometry.getCenter(
            this.geometry.normalizeBaseCoordinates(feature.properties.baseCoordinates)
        );
        if (!centerPoint) {
            return [0, 0];
        }

        return [
            centerPoint[0] - referencePoint.lng,
            centerPoint[1] - referencePoint.lat
        ];
    }

    updateFeatureForMove(feature, dx, dy, _newCoords) {
        const coordinates = this.geometry.normalizeBaseCoordinates(feature.properties.baseCoordinates);
        const newCoordinates = this.geometry.applyOffset(coordinates, dx, dy);

        const updatedFeature = {
            ...feature,
            properties: {
                ...feature.properties,
                baseCoordinates: newCoordinates
            },
            geometry: this.geometry.generate(newCoordinates)
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
        this.setupRightClickListener();
        this.map.on('mousemove', this._onPreClickMouseMove);

        // Show finish button on touch devices
        if (isTouchDevice()) {
            this._finishButton = new DrawingFinishButton({
                onFinish: () => this._finishDrawing(),
                onUndo: () => this._undoLastPoint()
            });
            this._finishButton.show();
            this._finishButton.updateState(0, 3); // Polygon needs min 3 points
        }
    }

    deactivate = () => {
        this.isActive = false;
        this.drawPoints = [];
        this.map.getCanvas().style.cursor = '';
        this.map.off('mousemove', this._onPreClickMouseMove);
        getSnappingService()?.hideIndicator(this.map);
        this.clearPreview();
        this.removeRightClickListener();
        this.deselectFeature();

        // Hide finish button
        if (this._finishButton) {
            this._finishButton.hide();
            this._finishButton = null;
        }
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

    syncEditHandlesAfterDrag = (_movedFeatures) => {
        const selectedFeature = this.getSelectedFeature();
        if (selectedFeature && !this.isDraggingHandle) {
            // Always recreate handles with current feature data
            this.createEditHandles(selectedFeature);
        }
    }

    // ===== DRAWING SYSTEM =====

    _onPreClickMouseMove = (e) => {
        const snapping = getSnappingService();
        const snap = snapping?.resolve(this.map, e.point, e.lngLat) ?? e.lngLat;
        if (snap.snapped) {
            snapping.showIndicator(this.map, snap, snap.snapType);
        } else {
            snapping?.hideIndicator(this.map);
        }
    }

    handleMapClick = (e) => {
        if (!this.isActive) return;

        if (!e.lngLat || isNaN(e.lngLat.lng) || isNaN(e.lngLat.lat)) {
            console.warn('Invalid coordinates for polygon');
            return;
        }

        const snapping = getSnappingService();
        const snap = snapping?.resolve(this.map, e.point, e.lngLat) ?? e.lngLat;
        const newPoint = [snap.lng, snap.lat];

        // Check if point is too close to last point
        if (this.geometry.isPointTooClose(newPoint, this.drawPoints)) {
            return;
        }

        this.drawPoints.push(newPoint);

        // Update finish button state
        if (this._finishButton) {
            this._finishButton.updateState(this.drawPoints.length, 3);
        }

        if (this.drawPoints.length === 1) {
            this.map.off('mousemove', this._onPreClickMouseMove);
            this.map.on('mousemove', this.handlePreviewMouseMove);
        } else if (this.drawPoints.length >= 2) {
            // Update preview to show current polygon
            this.updateDrawingPreview();
        }
    }

    setupRightClickListener = () => {
        this.map.getCanvas().addEventListener('contextmenu', this.handleRightClick);
    }

    removeRightClickListener = () => {
        this.map.getCanvas().removeEventListener('contextmenu', this.handleRightClick);
    }

    handleRightClick = async (e) => {
        if (!this.isActive || this.drawPoints.length === 0) return;

        e.preventDefault();
        e.stopPropagation();

        const screenPoint = { x: e.offsetX, y: e.offsetY };
        const coordinates = this.map.unproject([screenPoint.x, screenPoint.y]);
        const snapping = getSnappingService();
        const snap = snapping?.resolve(this.map, screenPoint, coordinates) ?? coordinates;
        const finalPoint = [snap.lng, snap.lat];

        if (!this.geometry.isPointTooClose(finalPoint, this.drawPoints)) {
            this.drawPoints.push(finalPoint);
        }

        // Finish polygon if we have at least 3 points
        if (this.drawPoints.length >= 3) {
            this.map.off('mousemove', this.handlePreviewMouseMove);
            await this.createFeature();
            this.toolManager.deactivateCurrentTool();
        } else {
            showWarning('Polígono deve ter pelo menos 3 pontos');
            this.drawPoints = [];
            this.clearPreview();
        }
    }

    /**
     * Finish drawing - called by touch finish button
     * @private
     */
    _finishDrawing = async () => {
        if (!this.isActive || this.drawPoints.length < 3) return;

        this.map.off('mousemove', this.handlePreviewMouseMove);
        await this.createFeature();
        this.toolManager.deactivateCurrentTool();
    }

    /**
     * Undo last point - called by touch undo button
     * @private
     */
    _undoLastPoint = () => {
        if (!this.isActive || this.drawPoints.length === 0) return;

        this.drawPoints.pop();

        // Update finish button state
        if (this._finishButton) {
            this._finishButton.updateState(this.drawPoints.length, 3);
        }

        // Update preview
        if (this.drawPoints.length === 0) {
            this.clearPreview();
            this.map.off('mousemove', this.handlePreviewMouseMove);
        } else {
            this.updateDrawingPreview();
        }
    }

    handlePreviewMouseMove = (e) => {
        if (this.drawPoints.length >= 1) {
            const snapping = getSnappingService();
            const snap = snapping?.resolve(this.map, e.point, e.lngLat) ?? e.lngLat;
            this.lastPreviewPosition = [snap.lng, snap.lat];

            if (snap.snapped) {
                snapping.showIndicator(this.map, snap, snap.snapType);
            } else {
                snapping?.hideIndicator(this.map);
            }

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
            this.updatePolygonPreview(this.lastPreviewPosition);
        } else if (this.drawPoints.length >= 1) {
            this.updateDrawingPreview();
        }

        this.pendingPreviewUpdate = false;
    }

    updateDrawingPreview = () => {
        if (this.drawPoints.length === 0) return;

        const previewCoords = [...this.drawPoints];
        if (this.lastPreviewPosition) {
            previewCoords.push(this.lastPreviewPosition);
        }

        // Only show polygon preview if we have at least 3 points
        if (previewCoords.length >= 3) {
            clearTimeout(this.geometryDebounceTimer);
            this.geometryDebounceTimer = setTimeout(() => {
                const previewGeometry = this.geometry.generate(previewCoords);
                this.showPreview(previewGeometry);
            }, 8);
        } else if (previewCoords.length === 2) {
            // Show line preview for the first segment
            clearTimeout(this.geometryDebounceTimer);
            this.geometryDebounceTimer = setTimeout(() => {
                this.showLinePreview(previewCoords);
            }, 8);
        }
    }

    showPreview = (geometry) => {
        this.map.getSource('polygon-feedback').setData({
            type: 'Feature',
            geometry: geometry,
            properties: {
                isPreview: true,
                fillColor: AddPolygonControl.DEFAULT_PROPERTIES.fillColor,
                lineColor: AddPolygonControl.DEFAULT_PROPERTIES.lineColor,
                lineWidth: AddPolygonControl.DEFAULT_PROPERTIES.lineWidth,
                opacity: 0.3 // Lower opacity for preview
            }
        });
    }

    showLinePreview = (coordinates) => {
        this.map.getSource('polygon-feedback').setData({
            type: 'Feature',
            geometry: {
                type: 'LineString',
                coordinates: coordinates
            },
            properties: {
                isPreview: true,
                lineColor: AddPolygonControl.DEFAULT_PROPERTIES.lineColor,
                lineWidth: AddPolygonControl.DEFAULT_PROPERTIES.lineWidth,
                opacity: 0.7
            }
        });
    }

    clearPreview = () => {
        this.map.off('mousemove', this.handlePreviewMouseMove);
        this.cancelPendingUpdates();
        if (this.map && this.map.getSource('polygon-feedback')) {
            this.map.getSource('polygon-feedback').setData({
                type: 'FeatureCollection',
                features: []
            });
        }
    }

    createFeature = async () => {
        if (!this.geometry.validate(this.drawPoints)) {
            showWarning('Polígono deve ter pelo menos 3 pontos válidos');
            this.drawPoints = [];
            return;
        }

        const { id: featureId, geoJsonId } = IDUtils.generateFeatureIds();
        const featureName = await IDUtils.generateFeatureName('polygon', this.map);
        const coordinates = [...this.drawPoints];

        const feature = {
            type: 'Feature',
            id: geoJsonId,
            properties: {
                ...AddPolygonControl.DEFAULT_PROPERTIES,
                layerId: getActiveLayerIdSync(),
                id: featureId,
                nome: featureName,
                baseCoordinates: coordinates,
                labelCreatedAtZoom: this.map.getZoom(),
            },
            geometry: this.geometry.generate(coordinates)
        };

        try {
            await addFeature('polygons', feature);

            const data = await this.map.getSource('polygons').getData();
            data.features.push(feature);

            if (feature.properties.hatchEnabled) {
                this.updateHatchPatterns(data);
            }
            this.map.getSource('polygons').setData(data);
            syncLabelSource(this.map, 'polygon-labels', data);

            this.drawPoints = [];
            this.toolManager.deactivateCurrentTool();
            await this.selectionManager.toggleFeatureSelection('polygon', featureId, feature);
            this.selectionManager.updateUI();

        } catch (error) {
            console.error('Error creating polygon:', error);
        }
    }

    // ===== EDIT HANDLES SYSTEM =====

    selectFeature = (feature) => {
        this.setupHoverListeners();

        // Skip edit handles and edit listeners when map is locked (read-only)
        if (this._mapLocked) return;

        this.createEditHandles(feature);
        this.setupEditEventListeners();
        this.setupEditRightClickListener();

        // Setup long-press vertex removal for touch devices
        if (isTouchDevice()) {
            this._cleanupVertexLongPress = setupVertexRemoveLongPress(this.map, {
                handleLayerId: 'polygon-edit-handles-layer',
                onVertexRemove: (vertexHandle) => this._handleVertexLongPress(vertexHandle, feature)
            });
        }
    }

    deselectFeature = () => {
        this.isDraggingHandle = false;
        this.activeHandle = null;         // Reset handle object
        this.activeHandleType = null;
        this.activeHandleIndex = null;
        this.clearEditHandles();
        this.removeEditEventListeners();
        this.removeHoverListeners();
        this.removeEditRightClickListener();
        this.cancelPendingUpdates();
        this.map.dragPan.enable();
        this.map.getCanvas().style.cursor = '';

        // Cleanup vertex long-press handler
        if (this._cleanupVertexLongPress) {
            this._cleanupVertexLongPress();
            this._cleanupVertexLongPress = null;
        }
    }

    createEditHandles = (feature) => {
        const handles = this.geometry.createHandles(feature);
        if (!handles || handles.length === 0) return;

        // Show selection feedback
        this.map.getSource('polygon-feedback').setData({
            type: 'Feature',
            geometry: feature.geometry,
            properties: {
                ...feature.properties,
                isSelected: true
            }
        });

        // Show handles
        this.map.getSource('polygon-edit-handles').setData({
            type: 'FeatureCollection',
            features: handles
        });
    }

    clearEditHandles = () => {
        this.map.getSource('polygon-edit-handles').setData({
            type: 'FeatureCollection',
            features: []
        });
        this.map.getSource('polygon-feedback').setData({
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
            layers: ['polygon-edit-handles-layer']
        });

        if (handleFeatures.length > 0) {
            const handle = handleFeatures[0];
            this.isDraggingHandle = true;
            this.activeHandle = handle;
            // Extract type and index separately (like boundary tool)
            this.activeHandleType = handle.properties.handleType;
            this.activeHandleIndex = handle.properties.index;
            this.map.dragPan.disable();
            this.map.getCanvas().style.cursor = 'grabbing';
            e.preventDefault();
        }
    }

    onEditMouseMove = (e) => {
        const selectedFeature = this.getSelectedFeature();
        if (!this.isDraggingHandle || !selectedFeature) return;

        const snapping = getSnappingService();
        const excludeId = selectedFeature.properties?.id;
        const snap = snapping?.resolve(this.map, e.point, e.lngLat, excludeId) ?? e.lngLat;
        this.lastPreviewPosition = [snap.lng, snap.lat];

        if (snap.snapped) {
            snapping.showIndicator(this.map, snap, snap.snapType);
        } else {
            snapping?.hideIndicator(this.map);
        }

        if (!this.pendingPreviewUpdate) {
            this.pendingPreviewUpdate = true;
            this.previewRafId = requestAnimationFrame(this.performPreviewUpdate);
        }
    }

    onEditMouseUp = async () => {
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
                // Create updated feature
                const updatedFeature = {
                    ...selectedFeature,
                    properties: {
                        ...selectedFeature.properties,
                        baseCoordinates: result.baseCoordinates
                    },
                    geometry: result.geometry
                };

                await this.forceUpdateMainSource(updatedFeature);
                this.updateSelectionManagerFeature(updatedFeature);
                this.createEditHandles(updatedFeature);
                this.updateUIAfterEdit();
                await this.saveFeatureChanges(updatedFeature);
            }
        }

        getSnappingService()?.hideIndicator(this.map);
        this.isDraggingHandle = false;
        this.activeHandle = null;
        this.activeHandleType = null;
        this.activeHandleIndex = null;
        this.map.dragPan.enable();
        this.map.getCanvas().style.cursor = '';
    }

    updatePolygonPreview = (newPosition) => {
        const selectedFeature = this.getSelectedFeature();
        if (!selectedFeature || !this.activeHandleType || !this.isDraggingHandle) {
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
            // Show updated selection
            this.map.getSource('polygon-feedback').setData({
                type: 'Feature',
                geometry: preview.geometry,
                properties: {
                    ...selectedFeature.properties,
                    isSelected: true
                }
            });

            // Update handles
            this.map.getSource('polygon-edit-handles').setData({
                type: 'FeatureCollection',
                features: preview.handles
            });
        }
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
            layers: ['polygon-edit-handles-layer']
        });

        // Find if we clicked on a vertex handle (not midpoint)
        const vertexHandle = handleFeatures.find(f =>
            f.properties.handleType === 'vertex' &&
            f.properties.featureId === selectedFeature.properties.id
        );

        if (!vertexHandle) return;

        // Prevent context menu from appearing - must be done before any async operation
        e.preventDefault();
        e.stopPropagation();

        const vertexIndex = vertexHandle.properties.index;
        const coordinates = this.geometry.normalizeBaseCoordinates(selectedFeature.properties.baseCoordinates);

        // Check if we can remove (polygons must have more than 3 vertices)
        if (!coordinates || coordinates.length <= 3) {
            this.showVertexRemovalWarning();
            return;
        }

        // Remove the vertex
        const newCoordinates = this.geometry.removeVertexAtIndex(coordinates, vertexIndex);
        if (!newCoordinates) {
            return;
        }

        // Update the feature
        const updatedFeature = {
            ...selectedFeature,
            properties: {
                ...selectedFeature.properties,
                baseCoordinates: newCoordinates
            },
            geometry: this.geometry.generate(newCoordinates)
        };

        // Apply updates
        await this.forceUpdateMainSource(updatedFeature);
        this.updateSelectionManagerFeature(updatedFeature);
        this.createEditHandles(updatedFeature);
        this.updateUIAfterEdit();
        await this.saveFeatureChanges(updatedFeature);
        this.updateFeatureMeasurement(updatedFeature);
    }

    /**
     * Show warning when vertex cannot be removed
     */
    showVertexRemovalWarning() {
        showWarning('Polígono deve ter no mínimo 3 vértices');
    }

    /**
     * Handle long-press on vertex for touch removal
     * @param {Object} vertexHandle - The vertex handle feature
     * @param {Object} feature - The selected polygon feature
     * @private
     */
    _handleVertexLongPress = async (vertexHandle, feature) => {
        const selectedFeature = this.getSelectedFeature();
        if (!selectedFeature || selectedFeature.properties.id !== feature.properties.id) return;

        const vertexIndex = vertexHandle.properties.index;
        const coordinates = this.geometry.normalizeBaseCoordinates(selectedFeature.properties.baseCoordinates);

        // Check if we can remove (polygons must have more than 3 vertices)
        if (!coordinates || coordinates.length <= 3) {
            this.showVertexRemovalWarning();
            // Haptic feedback for error
            if (navigator.vibrate) {
                navigator.vibrate([50, 50, 50]);
            }
            return;
        }

        // Haptic feedback for success
        if (navigator.vibrate) {
            navigator.vibrate(50);
        }

        // Remove the vertex
        const newCoordinates = this.geometry.removeVertexAtIndex(coordinates, vertexIndex);
        if (!newCoordinates) return;

        // Update the feature
        const updatedFeature = {
            ...selectedFeature,
            properties: {
                ...selectedFeature.properties,
                baseCoordinates: newCoordinates
            },
            geometry: this.geometry.generate(newCoordinates)
        };

        // Apply updates
        await this.forceUpdateMainSource(updatedFeature);
        this.updateSelectionManagerFeature(updatedFeature);
        this.createEditHandles(updatedFeature);
        this.updateUIAfterEdit();
        await this.saveFeatureChanges(updatedFeature);
        this.updateFeatureMeasurement(updatedFeature);
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
            f.source === 'polygon-edit-handles' &&
            f.properties.user_isEditingHandle
        );
    }

    hasSelectedFeatureAtPoint = (features) => {
        const selectedFeature = this.getSelectedFeature();
        if (!selectedFeature) return false;
        return features.some(f =>
            f.source === 'polygons' &&
            f.properties.id === selectedFeature.properties.id
        );
    }

    // ===== LABEL ZOOM CORRECTION =====
    #labelZoom = createLabelZoomHandler(() => this.map, 'polygons', 'polygon-labels');
    _onZoomForLabels = this.#labelZoom.handler;

    // ===== FEATURE MANAGEMENT INTERFACE =====

    updateFeaturesProperty = async (features, property, value) => {
        const data = await this.map.getSource('polygons').getData();

        for (const feature of features) {
            const sourceFeature = data.features.find(f => f.properties.id === feature.properties.id);
            if (sourceFeature) {
                sourceFeature.properties[property] = value;
                feature.properties[property] = value;

                // If changing geometry properties, recalculate geometry
                if (property === 'baseCoordinates') {
                    const newGeometry = this.geometry.generate(sourceFeature.properties.baseCoordinates);
                    sourceFeature.geometry = newGeometry;
                    feature.geometry = newGeometry;
                }

                if (LABEL_ZOOM_PROPERTIES.has(property)) {
                    recalcLabelSize(sourceFeature, feature, this.map.getZoom());
                }
            }
        }

        // Regenerate hatch patterns if hatch property changes or if fillColor changes (hatch uses fill color)
        if (property.startsWith('hatch') || (property === 'fillColor' && features.some(f => f.properties.hatchEnabled))) {
            this.updateHatchPatterns(data);
        }
        this.map.getSource('polygons').setData(data);
        syncLabelSource(this.map, 'polygon-labels', data);

        // Update SelectionManager with fresh features
        const freshFeatures = features.map(feature => {
            const sourceFeature = data.features.find(f => f.properties.id === feature.properties.id);
            return sourceFeature || feature;
        });
        this.updateSelectionManagerFeatures(freshFeatures);

        const selectedFeature = this.getSelectedFeature();
        if (selectedFeature && !this.isDraggingHandle) {
            this.createEditHandles(selectedFeature);
        }
    }

    updateHatchPatterns = (data) => {
        if (!data || !data.features) {
            return;
        }
        const features = data.features.filter(f => f.properties.hatchEnabled);
        this.hatchGenerator.loadPatternsToMap(this.map, features);
    }

    /**
     * Update hatch type and enabled status together
     * This ensures proper pattern generation when enabling/disabling hatch
     */
    updateHatchType = async (features, type) => {
        const data = await this.map.getSource('polygons').getData();
        const isEnabled = type !== 'none';

        for (const feature of features) {
            const sourceFeature = data.features.find(f => f.properties.id === feature.properties.id);
            if (sourceFeature) {
                // Update both properties together
                sourceFeature.properties.hatchType = type;
                sourceFeature.properties.hatchEnabled = isEnabled;
                feature.properties.hatchType = type;
                feature.properties.hatchEnabled = isEnabled;

                // Clear hatchPatternId when disabling
                if (!isEnabled) {
                    delete sourceFeature.properties.hatchPatternId;
                    delete feature.properties.hatchPatternId;
                }
            }
        }

        // Generate patterns after both properties are set
        if (isEnabled) {
            this.updateHatchPatterns(data);
        }

        this.map.getSource('polygons').setData(data);
        syncLabelSource(this.map, 'polygon-labels', data);

        const selectedFeature = this.getSelectedFeature();
        if (selectedFeature && !this.isDraggingHandle) {
            this.createEditHandles(selectedFeature);
        }
    }

    saveFeatures = async (features, initialPropertiesMap) => {
        const currentData = await this.map.getSource('polygons').getData();

        for (const selectedFeature of features) {
            if (this.hasFeatureChanged(selectedFeature, initialPropertiesMap.get(selectedFeature.properties.id))) {
                const currentFeature = currentData.features.find(f => f.properties.id === selectedFeature.properties.id);

                if (currentFeature) {
                    await updateFeature('polygons', currentFeature);
                }
            }
        }
    }

    discardChangeFeatures = async (features, initialPropertiesMap) => {
        features.forEach(f => {
            Object.assign(f.properties, initialPropertiesMap.get(f.properties.id));
            const coordinates = this.geometry.normalizeBaseCoordinates(f.properties.baseCoordinates);
            f.geometry = this.geometry.generate(coordinates);
        });

        await this.updateFeatures(features, true, true);
    }

    deleteFeatures = async (features) => {
        if (features.length === 0) return;

        for (const feature of features) {
            try {
                const featureId = feature.properties.id;

                await removeFeature('polygons', featureId);
                const data = await this.map.getSource('polygons').getData();
                const idsToDelete = new Set(features.map(f => String(f.properties.id)));
                data.features = data.features.filter(f => !idsToDelete.has(String(f.properties.id)));
                this.map.getSource('polygons').setData(data);
                syncLabelSource(this.map, 'polygon-labels', data);
            } catch (error) {
                console.error(`Error removing polygon ${feature.properties.id}:`, error);
            }
        }
    }

    setDefaultProperties = (properties) => {
        Object.assign(AddPolygonControl.DEFAULT_PROPERTIES, properties);
    }

    hasFeatureChanged = (feature, initialProperties) => {
        if (!initialProperties) return true;

        return (
            feature.properties.fillColor !== initialProperties.fillColor ||
            feature.properties.lineColor !== initialProperties.lineColor ||
            feature.properties.lineWidth !== initialProperties.lineWidth ||
            feature.properties.opacity !== initialProperties.opacity ||
            feature.properties.lineStyle !== initialProperties.lineStyle ||
            feature.properties.nome !== initialProperties.nome ||
            feature.properties.descricao !== initialProperties.descricao ||
            feature.properties.visivel !== initialProperties.visivel ||
            feature.properties.bloqueado !== initialProperties.bloqueado ||
            feature.properties.hatchEnabled !== initialProperties.hatchEnabled ||
            feature.properties.hatchType !== initialProperties.hatchType ||
            feature.properties.hatchColor !== initialProperties.hatchColor ||
            feature.properties.hatchSpacing !== initialProperties.hatchSpacing ||
            feature.properties.hatchLineWidth !== initialProperties.hatchLineWidth ||
            hasLabelChanged(feature, initialProperties) ||
            JSON.stringify(feature.properties.observations) !== JSON.stringify(initialProperties.observations) ||
            JSON.stringify(feature.properties.baseCoordinates) !== JSON.stringify(initialProperties.baseCoordinates)
        );
    }

    updateFeatures = async (features, save = false, onlyUpdateProperties = false) => {
        if (features.length > 0) {
            const data = await this.map.getSource('polygons').getData();
            for (const feature of features) {
                const featureIndex = data.features.findIndex(f => f.properties.id === feature.properties.id);
                if (featureIndex !== -1) {
                    if (onlyUpdateProperties) {
                        Object.assign(data.features[featureIndex].properties, feature.properties);
                    } else {
                        const prevCalcSize = data.features[featureIndex].properties.labelCalculatedSize;
                        data.features[featureIndex] = feature;
                        if (prevCalcSize !== undefined) {
                            feature.properties.labelCalculatedSize = prevCalcSize;
                        }
                    }

                    if (save) {
                        const featureToUpdate = onlyUpdateProperties ?
                            data.features[featureIndex] : feature;
                        await updateFeature('polygons', featureToUpdate);
                    }
                }
            }

            this.map.getSource('polygons').setData(data);
            syncLabelSource(this.map, 'polygon-labels', data);
            this.updateSelectionManagerFeatures(features);
        }
    }
    updateSelectionManagerFeature(feature) {
        this.selectionManager.updateSelectedFeature('polygon', feature.properties.id, feature);
    }

    updateSelectionManagerFeatures(features) {
        features.forEach(feature => {
            if (feature.properties.source === 'polygon') {
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

        // Only reset activeHandle if not currently dragging
        if (!this.isDraggingHandle) {
            this.activeHandle = null;
            this.activeHandleType = null;
        }

        if (this.geometryDebounceTimer) {
            clearTimeout(this.geometryDebounceTimer);
            this.geometryDebounceTimer = null;
        }
    }

    forceUpdateMainSource = async (feature) => {
        if (this.uiManager && this.uiManager.isDragging) {
            return;
        }

        const data = await this.map.getSource('polygons').getData();
        const sourceFeature = data.features.find(f => f.properties.id === feature.properties.id);
        if (sourceFeature) {
            sourceFeature.properties = {
                ...feature.properties,
                baseCoordinates: feature.properties.baseCoordinates
            };
            sourceFeature.geometry = { ...feature.geometry };
            this.map.getSource('polygons').setData(data);
            syncLabelSource(this.map, 'polygon-labels', data);
        }
    }

    updateUIAfterEdit = () => {
        this.selectionManager.uiManager.updateSelectionHighlight();
        this.selectionManager.uiManager.updatePanels();
        this.selectionManager.updateUI();
    }

    saveFeatureChanges = async (feature) => {
        try {
            await updateFeature('polygons', feature);
        } catch (error) {
            console.error('Error saving polygon changes:', error);
        }
    }

    setupBaseEventListeners = () => {
    }

    removeAllEventListeners = () => {
        this.map.off('mousemove', this._onPreClickMouseMove);
        this.map.off('mousemove', this.handlePreviewMouseMove);
        this.removeEditEventListeners();
        this.removeHoverListeners();
        this.removeRightClickListener();
        this.removeEditRightClickListener();
        this.cancelPendingUpdates();
    }
}

export default AddPolygonControl;

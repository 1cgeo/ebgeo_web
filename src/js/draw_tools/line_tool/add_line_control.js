// Path: js/draw_tools/line_tool/add_line_control.js

/**
 * @fileoverview Line drawing tool control.
 * Handles line creation, editing, measurement display, and terrain profiles.
 *
 * @module draw_tools/line_tool/add_line_control
 */

import { addFeature, updateFeature, removeFeature, getActiveLayerIdSync } from '../../store';
import { IDUtils, showWarning } from '../../utilities';
import { isTouchDevice } from '../../utilities/pointer-utils';
import { DrawingFinishButton, setupVertexRemoveLongPress } from '../drawing-touch-helpers';
import { addLineAttributesToPanel } from './line_attributes_panel.js';
import AddLineGeometry from './add_line_geometry.js';
import { BaseControl } from '../../tool_manager';
import { getSnappingService } from '../../snapping/snapping.service.js';

// Extracted modules
import {
    updateFeatureMeasurement,
    removeMeasurement,
    setMeasurementLabelSelected
} from './line_measurement.js';
import { calculateProfile } from './line_profile.js';

class AddLineControl extends BaseControl {
    featureType = 'line';

    constructor(toolManager) {
        super(toolManager);

        this.drawPoints = [];
        this.isDraggingHandle = false;
        this.activeHandle = null;
        this.activeHandleType = null;
        this.activeHandleIndex = null;

        this.geometry = new AddLineGeometry();

        this.previewRafId = null;
        this.pendingPreviewUpdate = false;
        this.lastPreviewPosition = null;
        this.geometryDebounceTimer = null;

        this.isCalculatingProfile = false;

        this.dragRecalculateTimeout = null;
        this._name = 'AddLineControl';

        // Touch support
        this._finishButton = null;
        this._cleanupVertexLongPress = null;
    }

    static DEFAULT_PROPERTIES = {
        lineColor: '#3f4fb5',
        lineWidth: 5,
        opacity: 0.7,
        lineStyle: 'solid',
        measure: false,
        profile: false,
        profileData: null,
        source: 'line',
        nome: '',
        descricao: '',
        visivel: true,
        bloqueado: false
    };

    // ===== SINGLE SOURCE OF TRUTH =====

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
        sectionPanel.className = 'line-attributes-section';

        try {
            addLineAttributesToPanel(sectionPanel, features, this, selectionManager, uiManager, options);
            container.appendChild(sectionPanel);
        } catch (error) {
            console.error('Error creating line attribute panel:', error);
        }
    }

    getDragSources() {
        return ['lines'];
    }

    getEditHandleSources() {
        return ['line-edit-handles'];
    }

    createSelectionBox(feature) {
        try {
            const bbox = turf.bbox(feature);
            const expandedBbox = this.expandBboxWithPadding(bbox, this.getSelectionBoxPadding(),this.map);
            return turf.bboxPolygon(expandedBbox);
        } catch (error) {
            console.warn('Error creating line selection box:', error);
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
        return ['line-layer'];
    }

    getSourceNames() {
        return ['lines'];
    }

    getEditHandleSource() {
        return 'line-edit-handles';
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
            this._finishButton.updateState(0, 2); // Line needs min 2 points
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

    /**
     * Recalculate line profiles asynchronously after drag operation
     * Ensures profile panel is updated with fresh data after recalculation
     * @param {Array} movedFeatures - Features that were moved
     * @returns {Promise<void>}
     */
    syncEditHandlesAfterDrag = async (movedFeatures) => {
        const lineFeatures = movedFeatures.filter(f => f.properties.source === 'line');

        if (lineFeatures.length === 0) {
            const selectedFeature = this.getSelectedFeature();
            if (selectedFeature && !this.isDraggingHandle) {
                this.createEditHandles(selectedFeature);
            }
            return;
        }

        clearTimeout(this.dragRecalculateTimeout);
        this.dragRecalculateTimeout = setTimeout(async () => {
            this.showRecalculatingState();

            try {
                const updatedFeatures = await this.recalculateMovedLineFeatures(lineFeatures);

                this.updateSelectionManagerFeatures(updatedFeatures);

                this.selectionManager.updateUI();

                const selectedFeature = this.getSelectedFeature();
                if (selectedFeature && !this.isDraggingHandle) {
                    this.createEditHandles(selectedFeature);
                }

            } catch (error) {
                console.error('Error recalculating Line profile after drag:', error);
            } finally {
                this.hideRecalculatingState();
            }
        }, 50);
    }

    /**
     * Show recalculation state with visual feedback
     */
    showRecalculatingState() {
        this.map.getCanvas().style.cursor = 'wait';

        this.map.off('click', this.handleMapClick);

        if (this.container) {
            this.container.classList.add('recalculating');
        }
    }

    /**
     * Hide recalculation state and restore normal interaction
     */
    hideRecalculatingState() {
        this.map.getCanvas().style.cursor = this.isActive ? 'crosshair' : '';

        if (this.isActive) {
            this.map.on('click', this.handleMapClick);
        }

        if (this.container) {
            this.container.classList.remove('recalculating');
        }
    }

    /**
     * Recalculate line profiles after movement
     * @param {Array} movedFeatures - Array of moved line features
     * @returns {Promise<Array>} Array of updated features
     */
    async recalculateMovedLineFeatures(movedFeatures) {
        const updatedFeatures = [];

        for (const movedFeature of movedFeatures) {
            if (movedFeature.properties.source === 'line') {
                try {
                    const coordinates = this.geometry.normalizeBaseCoordinates(movedFeature.properties.baseCoordinates);
                    if (coordinates && coordinates.length >= 2) {

                        if (movedFeature.properties.profile) {
                            const newProfileData = await this.calculateProfile(coordinates);
                            movedFeature.properties.profileData = JSON.stringify(newProfileData);
                        }

                        await updateFeature('lines', movedFeature);

                        if (movedFeature.properties.measure) {
                            this.updateFeatureMeasurement(movedFeature);
                        }

                        updatedFeatures.push(movedFeature);
                    }
                } catch (error) {
                    console.error('Error recalculating Line profile after movement:', error);
                    updatedFeatures.push(movedFeature);
                }
            }
        }

        return updatedFeatures;
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
            console.warn('Invalid coordinates for line');
            return;
        }

        const snapping = getSnappingService();
        const snap = snapping?.resolve(this.map, e.point, e.lngLat) ?? e.lngLat;
        const newPoint = [snap.lng, snap.lat];

        if (this.geometry.isPointTooClose(newPoint, this.drawPoints)) {
            return;
        }

        this.drawPoints.push(newPoint);

        // Update finish button state
        if (this._finishButton) {
            this._finishButton.updateState(this.drawPoints.length, 2);
        }

        if (this.drawPoints.length === 1) {
            this.map.off('mousemove', this._onPreClickMouseMove);
            this.map.on('mousemove', this.handlePreviewMouseMove);
        } else if (this.drawPoints.length >= 2) {
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

        if (this.drawPoints.length >= 2) {
            this.map.off('mousemove', this.handlePreviewMouseMove);
            await this.createFeature();
            this.toolManager.deactivateCurrentTool();
        }
    }

    /**
     * Finish drawing - called by touch finish button
     * @private
     */
    _finishDrawing = async () => {
        if (!this.isActive || this.drawPoints.length < 2) return;

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
            this._finishButton.updateState(this.drawPoints.length, 2);
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
            this.updateLinePreview(this.lastPreviewPosition);
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

        if (previewCoords.length >= 2) {
            clearTimeout(this.geometryDebounceTimer);
            this.geometryDebounceTimer = setTimeout(() => {
                const previewGeometry = this.geometry.generate(previewCoords);
                this.showPreview(previewGeometry);
            }, 8);
        }
    }

    showPreview = (geometry) => {
        this.map.getSource('line-feedback').setData({
            type: 'Feature',
            geometry: geometry,
            properties: {
                isPreview: true,
                lineColor: AddLineControl.DEFAULT_PROPERTIES.lineColor,
                lineWidth: AddLineControl.DEFAULT_PROPERTIES.lineWidth,
                opacity: 0.7
            }
        });
    }

    clearPreview = () => {
        this.map.off('mousemove', this.handlePreviewMouseMove);
        this.cancelPendingUpdates();
        if (this.map && this.map.getSource('line-feedback')) {
            this.map.getSource('line-feedback').setData({
                type: 'FeatureCollection',
                features: []
            });
        }
    }

    createFeature = async () => {
        if (!this.geometry.validate(this.drawPoints)) {
            showWarning('Linha deve ter pelo menos 2 pontos válidos');
            this.drawPoints = [];
            return;
        }

        const { id: featureId, geoJsonId } = IDUtils.generateFeatureIds();
        const featureName = await IDUtils.generateFeatureName('line', this.map);
        const coordinates = [...this.drawPoints];

        const feature = {
            type: 'Feature',
            id: geoJsonId,
            properties: {
                ...AddLineControl.DEFAULT_PROPERTIES,
                layerId: getActiveLayerIdSync(),
                id: featureId,
                nome: featureName,
                baseCoordinates: coordinates,
                profileData: JSON.stringify(await this.calculateProfile(coordinates))
            },
            geometry: this.geometry.generate(coordinates)
        };

        try {
            await addFeature('lines', feature);

            const data = await this.map.getSource('lines').getData();
            data.features.push(feature);
            this.map.getSource('lines').setData(data);

            this.drawPoints = [];
            this.toolManager.deactivateCurrentTool();
            await this.selectionManager.toggleFeatureSelection('line', featureId, feature);
            this.selectionManager.updateUI();

            this.updateFeatureMeasurement(feature);
        } catch (error) {
            console.error('Error creating line:', error);
        }
    }

    // ===== EDIT HANDLES SYSTEM =====

    selectFeature = (feature) => {
        this.setupHoverListeners();
        this.setMeasurementLabelSelected(feature.properties.id, true);

        // Skip edit handles and edit listeners when map is locked (read-only)
        if (this._mapLocked) return;

        this.createEditHandles(feature);
        this.setupEditEventListeners();
        this.setupEditRightClickListener();

        // Setup long-press vertex removal for touch devices
        if (isTouchDevice()) {
            this._cleanupVertexLongPress = setupVertexRemoveLongPress(this.map, {
                handleLayerId: 'line-edit-handles-layer',
                onVertexRemove: (vertexHandle) => this._handleVertexLongPress(vertexHandle, feature)
            });
        }
    }

    deselectFeature = () => {
        const selectedFeature = this.getSelectedFeature();
        if (selectedFeature) {
            this.setMeasurementLabelSelected(selectedFeature.properties.id, false);
        }
        this.isDraggingHandle = false;
        this.activeHandle = null;
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

        this.map.getSource('line-feedback').setData({
            type: 'Feature',
            geometry: feature.geometry,
            properties: {
                ...feature.properties,
                isSelected: true
            }
        });

        this.map.getSource('line-edit-handles').setData({
            type: 'FeatureCollection',
            features: handles
        });
    }

    clearEditHandles = () => {
        this.map.getSource('line-edit-handles').setData({
            type: 'FeatureCollection',
            features: []
        });
        this.map.getSource('line-feedback').setData({
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
            layers: ['line-edit-handles-layer']
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

    /**
     * Complete edit operation and recalculate profile if enabled
     */
    onEditMouseUp = async () => {
        const selectedFeature = this.getSelectedFeature();
        if (this.isDraggingHandle && selectedFeature && this.activeHandleType && this.lastPreviewPosition) {
            try {
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
                        properties: {
                            ...selectedFeature.properties,
                            baseCoordinates: result.baseCoordinates
                        },
                        geometry: result.geometry
                    };

                    if (updatedFeature.properties.profile && !this.isCalculatingProfile) {
                        try {
                            this.isCalculatingProfile = true;

                            const newProfileData = await this.calculateProfile(result.baseCoordinates);
                            updatedFeature.properties.profileData = JSON.stringify(newProfileData);

                        } catch (error) {
                            console.error('Error recalculating profile:', error);
                        } finally {
                            this.isCalculatingProfile = false;
                        }
                    }

                    await this.forceUpdateMainSource(updatedFeature);
                    this.updateSelectionManagerFeature(updatedFeature);
                    this.createEditHandles(updatedFeature);

                    this.updateUIAfterEdit();

                    await this.saveFeatureChanges(updatedFeature);
                    this.updateFeatureMeasurement(updatedFeature);
                }
            } catch (error) {
                console.error('Error during edit completion:', error);
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

    updateLinePreview = (newPosition) => {
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
            this.map.getSource('line-feedback').setData({
                type: 'Feature',
                geometry: preview.geometry,
                properties: {
                    ...selectedFeature.properties,
                    isSelected: true
                }
            });

            this.map.getSource('line-edit-handles').setData({
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
            layers: ['line-edit-handles-layer']
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

        // Check if we can remove (must have more than 2 vertices)
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
        const updatedFeature = {
            ...selectedFeature,
            properties: {
                ...selectedFeature.properties,
                baseCoordinates: newCoordinates
            },
            geometry: this.geometry.generate(newCoordinates)
        };

        // Recalculate profile if enabled
        if (updatedFeature.properties.profile) {
            try {
                const newProfileData = await this.calculateProfile(newCoordinates);
                updatedFeature.properties.profileData = JSON.stringify(newProfileData);
            } catch (error) {
                console.error('Error recalculating profile after vertex removal:', error);
            }
        }

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
        // Remove existing warning if any
        const existingWarning = document.querySelector('.vertex-removal-warning');
        if (existingWarning) {
            existingWarning.remove();
        }

        const warning = document.createElement('div');
        warning.className = 'vertex-removal-warning';
        warning.textContent = 'Linha deve ter no mínimo 2 vértices';
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

    /**
     * Handle long-press on vertex for touch removal
     * @param {Object} vertexHandle - The vertex handle feature
     * @param {Object} feature - The selected line feature
     * @private
     */
    _handleVertexLongPress = async (vertexHandle, feature) => {
        const selectedFeature = this.getSelectedFeature();
        if (!selectedFeature || selectedFeature.properties.id !== feature.properties.id) return;

        const vertexIndex = vertexHandle.properties.index;
        const coordinates = this.geometry.normalizeBaseCoordinates(selectedFeature.properties.baseCoordinates);

        // Check if we can remove (must have more than 2 vertices)
        if (!coordinates || coordinates.length <= 2) {
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

        // Recalculate profile if enabled
        if (updatedFeature.properties.profile) {
            try {
                const newProfileData = await this.calculateProfile(newCoordinates);
                updatedFeature.properties.profileData = JSON.stringify(newProfileData);
            } catch (error) {
                console.error('Error recalculating profile after vertex removal:', error);
            }
        }

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
            f.source === 'line-edit-handles' &&
            f.properties.user_isEditingHandle
        );
    }

    hasSelectedFeatureAtPoint = (features) => {
        const selectedFeature = this.getSelectedFeature();
        if (!selectedFeature) return false;
        return features.some(f =>
            f.source === 'lines' &&
            f.properties.id === selectedFeature.properties.id
        );
    }

    // ===== PROFILE CALCULATION =====
    // Delegated to line_profile.js module

    /**
     * Calculate terrain elevation profile for line.
     * Delegates to extracted profile module.
     * @param {Array} coordinates - Line coordinates
     * @returns {Promise<Array>} Profile data with distance, elevation and slope
     */
    async calculateProfile(coordinates) {
        return calculateProfile(this.map, coordinates);
    }

    // ===== MEASUREMENT SYSTEM =====
    // Delegated to line_measurement.js module

    /**
     * Update measurement display for a feature.
     * Delegates to extracted measurement module.
     * @param {Object} feature - Line feature
     */
    updateFeatureMeasurement = (feature) => {
        updateFeatureMeasurement(this.map, feature);
    }

    /**
     * Remove measurement label for a feature.
     * Delegates to extracted measurement module.
     * @param {string} featureId - Feature ID
     */
    removeFeatureMeasurement = (featureId) => {
        removeMeasurement(featureId);
    }

    /**
     * Set selection state on measurement label.
     * Delegates to extracted measurement module.
     * @param {string} featureId - Feature ID
     * @param {boolean} isSelected - Whether selected
     */
    setMeasurementLabelSelected = (featureId, isSelected) => {
        setMeasurementLabelSelected(featureId, isSelected);
    }

    // ===== FEATURE MANAGEMENT INTERFACE =====

    updateFeaturesProperty = async (features, property, value) => {
        const data = await this.map.getSource('lines').getData();

        for (const feature of features) {
            const sourceFeature = data.features.find(f => f.properties.id === feature.properties.id);
            if (sourceFeature) {
                sourceFeature.properties[property] = value;
                feature.properties[property] = value;

                if (property === 'baseCoordinates') {
                    const newGeometry = this.geometry.generate(sourceFeature.properties.baseCoordinates);
                    sourceFeature.geometry = newGeometry;
                    feature.geometry = newGeometry;
                }

                if (property === 'profile' && value === true) {
                    try {
                        const coordinates = this.geometry.normalizeBaseCoordinates(sourceFeature.properties.baseCoordinates);
                        const newProfileData = await this.calculateProfile(coordinates);
                        sourceFeature.properties.profileData = JSON.stringify(newProfileData);
                        feature.properties.profileData = JSON.stringify(newProfileData);
                    } catch (error) {
                        console.error('Error recalculating profile for property change:', error);
                    }
                }
            }
        }

        this.map.getSource('lines').setData(data);

        if (property === 'measure') {
            features.forEach(f => {
                if (value) {
                    this.updateFeatureMeasurement(f);
                } else {
                    this.removeFeatureMeasurement(f.properties.id);
                }
            });
        }

        if (property === 'profile' && this.selectionManager) {
            setTimeout(() => {
                this.selectionManager.updateProfile();
            }, 100);
        }

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

    saveFeatures = async (features, initialPropertiesMap) => {
        const currentData = await this.map.getSource('lines').getData();
        let _hasChanges = false;

        for (const selectedFeature of features) {
            if (this.hasFeatureChanged(selectedFeature, initialPropertiesMap.get(selectedFeature.properties.id))) {
                const currentFeature = currentData.features.find(f => f.properties.id === selectedFeature.properties.id);

                if (currentFeature) {
                    await updateFeature('lines', currentFeature);
                    _hasChanges = true;
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

                this.removeFeatureMeasurement(featureId);

                await removeFeature('lines', featureId);
                const data = await this.map.getSource('lines').getData();
                const idsToDelete = new Set(features.map(f => String(f.properties.id)));
                data.features = data.features.filter(f => !idsToDelete.has(String(f.properties.id)));
                this.map.getSource('lines').setData(data);
            } catch (error) {
                console.error(`Error removing line ${feature.properties.id}:`, error);
            }
        }
    }

    setDefaultProperties = (properties) => {
        Object.assign(AddLineControl.DEFAULT_PROPERTIES, properties);
    }

    hasFeatureChanged = (feature, initialProperties) => {
        if (!initialProperties) return true;

        return (
            feature.properties.lineColor !== initialProperties.lineColor ||
            feature.properties.lineWidth !== initialProperties.lineWidth ||
            feature.properties.opacity !== initialProperties.opacity ||
            feature.properties.lineStyle !== initialProperties.lineStyle ||
            feature.properties.measure !== initialProperties.measure ||
            feature.properties.profile !== initialProperties.profile ||
            feature.properties.nome !== initialProperties.nome ||
            feature.properties.descricao !== initialProperties.descricao ||
            feature.properties.visivel !== initialProperties.visivel ||
            feature.properties.bloqueado !== initialProperties.bloqueado ||
            JSON.stringify(feature.properties.baseCoordinates) !== JSON.stringify(initialProperties.baseCoordinates)
        );
    }

    updateFeatures = async (features, save = false, onlyUpdateProperties = false) => {
        if (features.length > 0) {
            const data = await this.map.getSource('lines').getData();
            for (const feature of features) {
                const featureIndex = data.features.findIndex(f => f.properties.id === feature.properties.id);
                if (featureIndex !== -1) {
                    if (onlyUpdateProperties) {
                        Object.assign(data.features[featureIndex].properties, feature.properties);
                    } else {
                        data.features[featureIndex] = feature;
                    }

                    if (save) {
                        const featureToUpdate = onlyUpdateProperties ?
                            data.features[featureIndex] : feature;
                        await updateFeature('lines', featureToUpdate);
                    }
                }
            }

            this.map.getSource('lines').setData(data);
            this.updateSelectionManagerFeatures(features);
        }
    }

    // ===== SELECTION MANAGER INTEGRATION =====

    updateSelectionManagerFeature(feature) {
        this.selectionManager.updateSelectedFeature('line', feature.properties.id, feature);
    }

    updateSelectionManagerFeatures(features) {
        features.forEach(feature => {
            if (feature.properties.source === 'line') {
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

        if (!this.isDraggingHandle) {
            this.activeHandle = null;
            this.activeHandleType = null;
        }

        if (this.geometryDebounceTimer) {
            clearTimeout(this.geometryDebounceTimer);
            this.geometryDebounceTimer = null;
        }

        if (this.dragRecalculateTimeout) {
            clearTimeout(this.dragRecalculateTimeout);
            this.dragRecalculateTimeout = null;
        }
    }

    forceUpdateMainSource = async (feature) => {
        if (this.uiManager && this.uiManager.isDragging) {
            return;
        }

        const data = await this.map.getSource('lines').getData();
        const sourceFeature = data.features.find(f => f.properties.id === feature.properties.id);
        if (sourceFeature) {
            sourceFeature.properties = {
                ...feature.properties,
                baseCoordinates: feature.properties.baseCoordinates
            };
            sourceFeature.geometry = { ...feature.geometry };
            this.map.getSource('lines').setData(data);
        }
    }

    updateUIAfterEdit = () => {
        this.selectionManager.uiManager.updateSelectionHighlight();
        this.selectionManager.uiManager.updatePanels();
        this.selectionManager.updateUI();
    }

    saveFeatureChanges = async (feature) => {
        try {
            await updateFeature('lines', feature);
        } catch (error) {
            console.error('Error saving line changes:', error);
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

export default AddLineControl;

// Path: js/military_tools/arrow_tool/add_arrow_control.js

import { addFeature, updateFeature, removeFeature, getActiveLayerIdSync } from '../../store';
import { IDUtils, showWarning } from '../../utilities';
import { getPointerPosition, isTouchDevice } from '../../utilities/pointer-utils';
import { addArrowAttributesToPanel } from './arrow_attributes_panel.js';
import AddArrowGeometry from './add_arrow_geometry.js';
import { BaseControl } from '../../tool_manager';
import { DrawingFinishButton } from '../../draw_tools/drawing-touch-helpers';
import { getGeoJsonDispatcher, destroyGeoJsonDispatcher } from '@layers/geojson-dispatcher.js';

/**
 * The dispatcher that owns the `arrows` source.
 *
 * EVERY write to `arrows` made in this file goes through it. The reason is not style: a raw
 * `source.setData()` issued while a diff is queued replaces MapLibre's pending-update slot and the
 * diff disappears with no error at all.
 *
 * Each public method here also awaits `flush()` before it returns. Two reasons, and the second is
 * the one that matters:
 * - the deferred write would otherwise land one animation frame after the caller resumed;
 * - `arrows` still has co-writers outside this file (`arrow-merge.js`, which is migrated too, the
 *   line-to-arrow conversion in `tool_manager/helpers/feature-header.helpers.js`, and the generic
 *   by-storageType writers: attribute table, features tab, import, clipboard, multi-selection
 *   actions, context menu, phone layout), and the ones outside this tool still do read-modify-write
 *   with a raw `setData`. Draining inside the awaited method keeps the queue empty between
 *   gestures, so no co-writer can read a collection that is missing what this tool just wrote.
 *
 * NOTE the sources this does NOT own: `arrow-feedback` and `arrow-edit-handles` keep their plain
 * `setData`. They are rebuilt whole on every mousemove, hold a handful of features with no stable
 * `properties.id` (so they are declared without `promoteId` and are not diffable), and a dropped
 * frame there is a visibly stuttering rubber band.
 * @param {Object} map - MapLibre map instance
 * @returns {Object} dispatcher owning the `arrows` source
 */
function arrowsSource(map) {
    return getGeoJsonDispatcher(map, 'arrows');
}

/**
 * Arrow Tool Control
 * Manages drawing, editing, and interaction for arrow features on the map
 */
class AddArrowControl extends BaseControl {
    featureType = 'arrow';

    constructor(toolManager) {
        super(toolManager);

        this.drawPoints = [];
        this.isDraggingHandle = false;
        this.activeHandle = null;
        this.activeHandleType = null;
        this.activeHandleIndex = null;
        this.activeBranchIndex = null;

        this.geometry = new AddArrowGeometry();

        this.previewRafId = null;
        this.pendingPreviewUpdate = false;
        this.lastPreviewPosition = null;
        this.lastPreviewPoints = null;
        this.geometryDebounceTimer = null;

        // Pointer event state for edit handles
        this._activePointerId = null;

        // Bind pointer event handlers
        this._onEditPointerDown = this._onEditPointerDown.bind(this);
        this._onEditPointerMove = this._onEditPointerMove.bind(this);
        this._onEditPointerUp = this._onEditPointerUp.bind(this);
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
        ZOOM_BASE_MULTIPLIER: 25,
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

    // ===== MAPBOX CONTROL INTERFACE =====

    onAdd = (map) => {
        this.map = map;
    }

    onRemove = () => {
        this.deactivate();
        this.removeAllEventListeners();
        // Releases the queue, its settle timers and the two map listeners the dispatcher opens per
        // dispatch. Dropping a batch here cannot lose an arrow: the store write always precedes
        // the source write, so the redraw that follows a style switch repopulates `arrows` from
        // persistence.
        destroyGeoJsonDispatcher(this.map, 'arrows');
        this.map = undefined;
    }

    // ===== TOOL-CENTRIC INTERFACE IMPLEMENTATIONS =====

    hasAttributePanel() {
        return true;
    }

    createAttributePanel(container, features, selectionManager, uiManager, options = {}) {
        const sectionPanel = document.createElement('div');
        sectionPanel.className = 'arrow-attributes-section';

        try {
            addArrowAttributesToPanel(sectionPanel, features, this, selectionManager, uiManager, options);
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

    canCopy(_feature) {
        return true;
    }

    canPaste(_feature) {
        return true;
    }

    prepareForPaste(feature, offset) {
        const baseCoordinates = this.geometry.normalizeBaseCoordinates(feature.properties.baseCoordinates);
        const newBaseCoordinates = baseCoordinates.map(coord => [
            coord[0] + offset.dx,
            coord[1] + offset.dy
        ]);

        const updatedProps = {
            ...feature.properties,
            baseCoordinates: newBaseCoordinates
        };

        // Offset branches for merged arrows
        if (feature.properties.isMerged && Array.isArray(feature.properties.branches)) {
            updatedProps.branches = feature.properties.branches.map(branch => ({
                ...branch,
                baseCoordinates: this.geometry.normalizeBaseCoordinates(branch.baseCoordinates)
                    .map(coord => [coord[0] + offset.dx, coord[1] + offset.dy])
            }));
        }

        return {
            ...feature,
            properties: updatedProps,
            geometry: this.geometry.generate(newBaseCoordinates, updatedProps)
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

    updateFeatureForMove(feature, dx, dy, _newCoords) {
        const baseCoordinates = this.geometry.normalizeBaseCoordinates(feature.properties.baseCoordinates);
        const newBaseCoordinates = baseCoordinates.map(coord => [
            coord[0] + dx,
            coord[1] + dy
        ]);

        const updatedProps = {
            ...feature.properties,
            baseCoordinates: newBaseCoordinates
        };

        // Translate branches for merged arrows
        if (feature.properties.isMerged && Array.isArray(feature.properties.branches)) {
            updatedProps.branches = feature.properties.branches.map(branch => ({
                ...branch,
                baseCoordinates: this.geometry.normalizeBaseCoordinates(branch.baseCoordinates)
                    .map(coord => [coord[0] + dx, coord[1] + dy])
            }));
        }

        return {
            ...feature,
            properties: updatedProps,
            geometry: this.geometry.generate(newBaseCoordinates, updatedProps)
        };
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

        // Show finish button on touch devices
        if (isTouchDevice()) {
            this._finishButton = new DrawingFinishButton({
                onFinish: () => this._finishFromTouch(),
                onUndo: () => this._undoLastPoint()
            });
            this._finishButton.show();
            this._finishButton.updateState(0, 2);
        }
    }

    deactivate = () => {
        this.isActive = false;
        this.drawPoints = [];
        this.map.getCanvas().style.cursor = '';
        this.map.getCanvas().removeEventListener('contextmenu', this.handleRightClick);
        this.clearPreview();
        this.deselectFeature();

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

        if (this._finishButton) {
            this._finishButton.updateState(this.drawPoints.length, 2);
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
            showWarning('Seta deve ter pelo menos 2 pontos');
            this.drawPoints = [];
            return;
        }

        if (!this.geometry.validate(this.drawPoints, AddArrowControl.DEFAULT_PROPERTIES)) {
            showWarning('Pontos muito próximos. Distância mínima: 10 metros');
            this.drawPoints = [];
            return;
        }

        const { id: featureId, geoJsonId } = IDUtils.generateFeatureIds();
        const featureName = await IDUtils.generateFeatureName('arrow', this.map);

        const currentZoom = this.map.getZoom();
        const adaptiveWidth = this.calculateWidthForZoom(currentZoom);

        const feature = {
            type: 'Feature',
            id: geoJsonId,
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

            const dispatcher = arrowsSource(this.map);
            dispatcher.add(feature);
            await dispatcher.flush();

            this.drawPoints = [];
            this.toolManager.deactivateCurrentTool();
            await this.selectionManager.toggleFeatureSelection('arrow', featureId, feature);
            this.selectionManager.updateUI();
        } catch (error) {
            console.error('Error creating arrow:', error);
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
    }

    deselectFeature = () => {
        this.isDraggingHandle = false;
        this.activeHandle = null;
        this.activeHandleType = null;
        this.activeHandleIndex = null;
        this.activeBranchIndex = null;
        this.clearEditHandles();
        this.removeEditEventListeners();
        this.removeHoverListeners();
        this.removeEditRightClickListener();
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
        const canvas = this.map.getCanvasContainer();
        canvas.addEventListener('pointerdown', this._onEditPointerDown);
    }

    removeEditEventListeners = () => {
        const canvas = this.map.getCanvasContainer();
        canvas.removeEventListener('pointerdown', this._onEditPointerDown);
        canvas.removeEventListener('pointermove', this._onEditPointerMove);
        canvas.removeEventListener('pointerup', this._onEditPointerUp);
        canvas.removeEventListener('pointercancel', this._onEditPointerUp);

        // Release any captured pointer
        if (this._activePointerId !== null) {
            try {
                canvas.releasePointerCapture(this._activePointerId);
            } catch (_err) {
                // Pointer may have already been released
            }
            this._activePointerId = null;
        }
    }

    _onEditPointerDown(e) {
        if (!e.isPrimary) return; // Only handle primary pointer
        // Ignore right-click (button 2) - handled by handleEditRightClick
        if (e.button === 2) return;

        const selectedFeature = this.getSelectedFeature();
        if (!selectedFeature) return;

        const canvas = this.map.getCanvasContainer();
        const point = getPointerPosition(e, canvas);

        const handleFeatures = this.map.queryRenderedFeatures([point.x, point.y], {
            layers: ['arrow-edit-handles-layer']
        });

        if (handleFeatures.length > 0) {
            const handle = handleFeatures[0];
            this.isDraggingHandle = true;
            this.activeHandle = handle;
            // Extract type, index, and branchIndex separately
            this.activeHandleType = handle.properties.handleType;
            this.activeHandleIndex = handle.properties.index !== undefined ? handle.properties.index : null;
            this.activeBranchIndex = handle.properties.branchIndex !== undefined ? handle.properties.branchIndex : null;
            this.map.dragPan.disable();
            this.map.getCanvas().style.cursor = 'grabbing';

            // Capture pointer for reliable tracking
            this._activePointerId = e.pointerId;
            canvas.setPointerCapture(e.pointerId);

            // Add move/up listeners only when dragging starts
            canvas.addEventListener('pointermove', this._onEditPointerMove);
            canvas.addEventListener('pointerup', this._onEditPointerUp);
            canvas.addEventListener('pointercancel', this._onEditPointerUp);

            e.preventDefault();
        }
    }

    _onEditPointerMove(e) {
        if (!e.isPrimary) return;

        const selectedFeature = this.getSelectedFeature();
        if (!this.isDraggingHandle || !selectedFeature) return;

        const canvas = this.map.getCanvasContainer();
        const point = getPointerPosition(e, canvas);
        const lngLat = this.map.unproject([point.x, point.y]);

        this.lastPreviewPosition = [lngLat.lng, lngLat.lat];

        if (!this.pendingPreviewUpdate) {
            this.pendingPreviewUpdate = true;
            this.previewRafId = requestAnimationFrame(this.performPreviewUpdate);
        }
    }

    async _onEditPointerUp(_e) {
        const canvas = this.map.getCanvasContainer();

        // Remove move/up listeners
        canvas.removeEventListener('pointermove', this._onEditPointerMove);
        canvas.removeEventListener('pointerup', this._onEditPointerUp);
        canvas.removeEventListener('pointercancel', this._onEditPointerUp);

        // Release pointer capture
        if (this._activePointerId !== null) {
            try {
                canvas.releasePointerCapture(this._activePointerId);
            } catch (_err) {
                // Pointer may have already been released
            }
            this._activePointerId = null;
        }

        const selectedFeature = this.getSelectedFeature();
        if (this.isDraggingHandle && selectedFeature && this.activeHandleType && this.lastPreviewPosition) {
            // Use geometry.updateFromHandle with separate type, index, and branchIndex
            const result = this.geometry.updateFromHandle(
                this.activeHandleType,
                this.lastPreviewPosition,
                selectedFeature,
                this.activeHandleIndex,
                this.activeBranchIndex
            );

            if (result) {
                const updatedFeature = {
                    ...selectedFeature,
                    properties: result.properties,
                    geometry: result.geometry
                };

                await this.forceUpdateMainSource(updatedFeature);
                this.updateSelectionManagerFeature(updatedFeature);
                this.createEditHandles(updatedFeature);
                this.updateUIAfterEdit();
                await this.saveFeatureChanges(updatedFeature);
            }
        }

        this.isDraggingHandle = false;
        this.activeHandle = null;
        this.activeHandleType = null;
        this.activeHandleIndex = null;
        this.activeBranchIndex = null;
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

            // Use calculatePreview with separate type, index, and branchIndex
            // No mutation of selectedFeature during drag - only visual preview
            const preview = this.geometry.calculatePreview(
                this.activeHandleType,
                newPosition,
                selectedFeature,
                this.activeHandleIndex,
                this.activeBranchIndex
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
            layers: ['arrow-edit-handles-layer']
        });

        // Find if we clicked on a vertex handle (not midpoint or other handle types)
        const vertexHandle = handleFeatures.find(f =>
            f.properties.handleType === 'vertex' &&
            f.properties.featureId === selectedFeature.properties.id
        );

        if (!vertexHandle) return;

        // Prevent context menu from appearing - must be done before any async operation
        e.preventDefault();
        e.stopPropagation();

        const vertexIndex = vertexHandle.properties.index;
        const branchIndex = vertexHandle.properties.branchIndex !== undefined
            ? vertexHandle.properties.branchIndex : null;

        let updatedFeature;

        if (selectedFeature.properties.isMerged && branchIndex !== null) {
            // Merged arrow: remove vertex in specific branch
            const updatedProperties = this.geometry.removeVertexInBranch(
                selectedFeature.properties, branchIndex, vertexIndex
            );
            if (!updatedProperties) {
                this.showVertexRemovalWarning();
                return;
            }

            updatedFeature = {
                ...selectedFeature,
                properties: updatedProperties,
                geometry: this.geometry.generate(updatedProperties.baseCoordinates, updatedProperties)
            };
        } else {
            // Single arrow: remove vertex from baseCoordinates
            const coordinates = this.geometry.normalizeBaseCoordinates(selectedFeature.properties.baseCoordinates);

            if (!coordinates || coordinates.length <= 2) {
                this.showVertexRemovalWarning();
                return;
            }

            const newCoordinates = this.geometry.removeVertexAtIndex(coordinates, vertexIndex);
            if (!newCoordinates) {
                return;
            }

            updatedFeature = {
                ...selectedFeature,
                properties: {
                    ...selectedFeature.properties,
                    baseCoordinates: newCoordinates
                },
                geometry: this.geometry.generate(newCoordinates, selectedFeature.properties)
            };
        }

        // Apply updates
        await this.forceUpdateMainSource(updatedFeature);
        this.updateSelectionManagerFeature(updatedFeature);
        this.createEditHandles(updatedFeature);
        this.updateUIAfterEdit();
        await this.saveFeatureChanges(updatedFeature);
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
        warning.textContent = 'Seta deve ter no mínimo 2 vértices';

        // Appearance and fade animation live in css/vertex-warning.css
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
        // The collection read survives here on purpose. Two things below need the PREVIOUS source
        // feature and no diff hands them back: whether the feature exists at all (an unknown id
        // must be skipped, not created) and its full property set, which `geometry.generate`
        // consumes to rebuild the shape. Draining first keeps that read from being stale.
        const dispatcher = arrowsSource(this.map);
        await dispatcher.flush();
        const data = await this.map.getSource('arrows').getData();
        const upserts = [];

        for (const feature of features) {
            const sourceFeature = data.features.find(f => f.properties.id === feature.properties.id);
            if (sourceFeature) {
                upserts.push(sourceFeature);
                sourceFeature.properties[property] = value;
                feature.properties[property] = value;

                if (['width', 'headLengthRatio', 'showArrowHead', 'airmobile', 'airmobilePosition', 'baseCoordinates', 'branches'].includes(property)) {
                    // For merged arrows, generateMergedGeometry reads each branch's own
                    // value (branch.X || properties.X), so a top-level change is ignored
                    // unless we also write it into every branch.
                    const BRANCH_PROPS = ['width', 'headLengthRatio', 'showArrowHead', 'airmobile', 'airmobilePosition'];
                    if (Array.isArray(sourceFeature.properties.branches) && BRANCH_PROPS.includes(property)) {
                        for (const branch of sourceFeature.properties.branches) {
                            branch[property] = value;
                        }
                    }

                    const newGeometry = this.geometry.generate(
                        sourceFeature.properties.baseCoordinates,
                        sourceFeature.properties
                    );
                    sourceFeature.geometry = newGeometry;
                    feature.geometry = newGeometry;
                }
            }
        }

        // An upsert, not a property patch: a change to `width` (and its siblings) also rewrites
        // the geometry AND every entry of the nested `branches` array of a merged arrow, so the
        // honest delta is the whole feature. `add` is a total replacement in MapLibre, which is
        // exactly what the whole-collection write did to this entry, minus the other N-1.
        dispatcher.add(upserts);
        await dispatcher.flush();

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
        // Reads only, and it persists the SOURCE's version of each feature rather than the
        // selected one, so the queue has to be drained before the collection comes back.
        await arrowsSource(this.map).flush();
        const currentData = await this.map.getSource('arrows').getData();

        for (const selectedFeature of features) {
            if (this.hasFeatureChanged(selectedFeature, initialPropertiesMap.get(selectedFeature.properties.id))) {
                const currentFeature = currentData.features.find(f => f.properties.id === selectedFeature.properties.id);

                if (currentFeature) {
                    await updateFeature('arrows', currentFeature);
                }
            }
        }
    }

    discardChangeFeatures = async (features, initialPropertiesMap) => {
        features.forEach(f => {
            Object.assign(f.properties, initialPropertiesMap.get(f.properties.id));
            f.geometry = this.geometry.generate(f.properties.baseCoordinates, f.properties);
        });

        // Use full update (onlyUpdateProperties=false) so the reverted GEOMETRY is
        // written too; the onlyUpdateProperties path copies only properties, leaving
        // the rendered/persisted shape at the edited geometry.
        await this.updateFeatures(features, true, false);
    }

    deleteFeatures = async (features) => {
        if (features.length === 0) return;

        for (const feature of features) {
            try {
                await removeFeature('arrows', feature.properties.id);
            } catch (error) {
                console.error(`Error removing arrow ${feature.properties.id}:`, error);
            }
        }

        // Removal by promoted key, with no collection read, and once for the whole batch instead
        // of once per feature. The keys go in raw, never coerced: MapLibre keyed the feature by
        // the very value that sits in `properties.id`, so a `String()` around it would miss a
        // numeric key instead of protecting anything.
        const dispatcher = arrowsSource(this.map);
        dispatcher.remove(features.map(f => f.properties.id));
        await dispatcher.flush();
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
            JSON.stringify(feature.properties.baseCoordinates) !== JSON.stringify(initialProperties.baseCoordinates) ||
            JSON.stringify(feature.properties.branches) !== JSON.stringify(initialProperties.branches)
        );
    }

    updateFeatures = async (features, save = false, onlyUpdateProperties = false) => {
        if (features.length > 0) {
            // The collection read survives here too: an unknown id must be skipped rather than
            // created, and the merge branch (`onlyUpdateProperties`) needs the previous source
            // properties to merge ONTO. Draining first keeps that read from being stale.
            const dispatcher = arrowsSource(this.map);
            await dispatcher.flush();
            const data = await this.map.getSource('arrows').getData();
            const upserts = [];

            for (const feature of features) {
                const featureIndex = data.features.findIndex(f => f.properties.id === feature.properties.id);
                if (featureIndex !== -1) {
                    if (onlyUpdateProperties) {
                        Object.assign(data.features[featureIndex].properties, feature.properties);
                    } else {
                        data.features[featureIndex] = feature;
                    }

                    // The merged/replaced entry is a COMPLETE feature, so it ships as an upsert
                    // (`add` is a total replacement in MapLibre) rather than as a property patch:
                    // the same result the whole-collection write produced, without the other N-1
                    // features riding along.
                    upserts.push(data.features[featureIndex]);

                    if (save) {
                        const featureToUpdate = onlyUpdateProperties ?
                            data.features[featureIndex] : feature;
                        await updateFeature('arrows', featureToUpdate);
                    }
                }
            }

            dispatcher.add(upserts);
            await dispatcher.flush();
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
        this.activeBranchIndex = null;

        if (this.geometryDebounceTimer) {
            clearTimeout(this.geometryDebounceTimer);
            this.geometryDebounceTimer = null;
        }
    }

    /**
     * Writes one edited arrow back into the source, unless a drag owns the screen.
     *
     * The read is kept, and only for the existence check: this is called from the handle-drag and
     * vertex-removal paths with a feature derived from the SELECTION, and `add` would CREATE an id
     * the source no longer has instead of the silent skip the old `if (sourceFeature)` produced.
     * The write itself is now a one-feature upsert rather than the whole collection.
     * @param {Object} feature - Edited arrow feature
     */
    forceUpdateMainSource = async (feature) => {
        if (this.uiManager && this.uiManager.isDragging) {
            return;
        }

        const dispatcher = arrowsSource(this.map);
        await dispatcher.flush();
        const data = await this.map.getSource('arrows').getData();
        const sourceFeature = data.features.find(f => f.properties.id === feature.properties.id);
        if (sourceFeature) {
            dispatcher.add({
                ...sourceFeature,
                properties: { ...feature.properties },
                geometry: { ...feature.geometry },
            });
            await dispatcher.flush();
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

    /**
     * Finish drawing from touch device (replaces right-click)
     */
    _finishFromTouch = async () => {
        if (!this.isActive || this.drawPoints.length < 2) return;

        this.map.off('mousemove', this.handlePreviewMouseMove);
        await this.createFeature();
        this.toolManager.deactivateCurrentTool();
    }

    /**
     * Undo last drawn point (touch device helper)
     */
    _undoLastPoint = () => {
        if (!this.isActive || this.drawPoints.length === 0) return;

        this.drawPoints.pop();

        if (this.drawPoints.length === 0) {
            this.map.off('mousemove', this.handlePreviewMouseMove);
            this.clearPreview();
        }

        if (this._finishButton) {
            this._finishButton.updateState(this.drawPoints.length, 2);
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
        this.removeEditRightClickListener();
        this.cancelPendingUpdates();
    }
}

export default AddArrowControl;

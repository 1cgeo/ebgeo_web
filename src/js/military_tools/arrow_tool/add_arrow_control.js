// Path: js/military_tools/arrow_tool/add_arrow_control.js

import { queryFeaturesAtPoint } from '@tools/helpers/feature-hit-test.helpers.js';
import { addFeature, updateFeature, removeFeature, getActiveLayerIdSync } from '../../store';
import { IDUtils, showWarning, showToast, deepClone } from '../../utilities';
import { getPointerPosition, isTouchDevice } from '../../utilities/pointer-utils';
import { addArrowAttributesToPanel } from './arrow_attributes_panel.js';
import AddArrowGeometry from './add_arrow_geometry.js';
import { BaseControl } from '../../tool_manager';
import { createPreviewScheduler } from '../../tool_manager/helpers/preview-scheduler.js';
import { DrawingFinishButton } from '../../draw_tools/drawing-touch-helpers';
import {
    anchorFor,
    buildExtendedProperties,
    extendCoordinates,
    previewCoordinates,
    resolveEndpoints
} from '@tools/helpers/line-extension.model.js';
import {
    extensionDenialReason,
    hideExtensionHandles,
    showExtensionHandles
} from '@tools/helpers/line-extension.helpers.js';

/**
 * Layers onHoverMove needs: 'arrow-edit-handles' (hasHandleAtPoint) and 'arrows'
 * (hasSelectedFeatureAtPoint, rendered by both the fill and the outline).
 * Ids confirmed in layers/styles/content.layers.js:260, :237 and :248.
 */
const HOVER_LAYER_IDS = ['arrow-edit-handles-layer', 'arrow-fill-layer', 'arrow-layer'];

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

        // ONE rAF gate for the whole preview, shared by the drawing and the
        // handle drag (never live together: a drag needs a selected feature),
        // which already shared this state. The arrow does not snap, so the frame
        // only rebuilds the polygon; what the gate removes is the 8/12 ms timer
        // that used to sit INSIDE the frame and only delayed the drawing.
        this._previewScheduler = createPreviewScheduler({
            raf: (callback) => requestAnimationFrame(callback),
            caf: (id) => cancelAnimationFrame(id),
            onFrame: (pointer) => this.performPreviewUpdate(pointer),
        });
        this.lastPreviewPosition = null;
        this.lastPreviewPoints = null;

        // Pointer event state for edit handles
        this._activePointerId = null;

        // Continuation session, set while the user is extending an existing arrow
        // from one of its ends. See startExtending / finishExtending.
        this._extending = null;

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
        doubleHeaded: false,
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
        // Dropped FIRST: Esc and switching tools both land here, and a
        // continuation writes nothing before it is committed, so forgetting the
        // session leaves the original arrow untouched by construction.
        this._extending = null;
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

        if (this._extending) {
            this.map.off('mousemove', this.handlePreviewMouseMove);
            await this.finishExtending();
            return;
        }

        if (this.drawPoints.length >= 2) {
            this.map.off('mousemove', this.handlePreviewMouseMove);
            await this.createFeature();
            this.toolManager.deactivateCurrentTool();
        } else {
            this.stopDrawing();
        }
    }

    /**
     * Park the pointer and ask for a frame. A mouse fires several moves inside
     * one frame and only the last one is ever drawn, so the spine is rebuilt in
     * the frame callback, not here.
     */
    handlePreviewMouseMove = (e) => {
        if (this.drawPoints.length < 1) return;

        this._previewScheduler.request({ point: e.point, lngLat: e.lngLat });
    }

    /**
     * The frame callback: take the frame's last position and redraw once.
     * @param {Object} [pointer] - The frame's last `{ point, lngLat }`, when a
     *   pointer event parked one.
     */
    performPreviewUpdate = (pointer) => {
        if (pointer) {
            this.lastPreviewPosition = [pointer.lngLat.lng, pointer.lngLat.lat];
            // The spine belongs to the DRAWING path only. A handle drag rebuilds
            // from the feature itself, and its pointer handler never touched it.
            if (!this.isDraggingHandle) {
                this.lastPreviewPoints = [...this.drawPoints, this.lastPreviewPosition];
            }
        }

        if (!this.lastPreviewPosition) return;

        const selectedFeature = this.getSelectedFeature();

        if (this.isDraggingHandle && selectedFeature && this.activeHandleType) {
            this.updateArrowPreview(this.lastPreviewPosition);
        } else if (this._extending) {
            this._updateExtensionPreview();
        } else if (this.lastPreviewPoints && this.lastPreviewPoints.length >= 2) {
            // No 8/12 ms debounce any more: this runs inside the frame gate, and
            // both values are under the 16.7 ms of a frame, so they coalesced
            // nothing and only pushed the drawing one timer late. The airmobile
            // arrow is the heavier geometry, which is why it carried the longer
            // timer; the gate caps it at one build per frame either way.
            // Removed 2026-09-04.
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
        }
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

            const data = await this.map.getSource('arrows').getData();
            data.features.push(feature);
            this.map.getSource('arrows').setData(data);

            this.drawPoints = [];
            this.toolManager.deactivateCurrentTool();
            await this.selectionManager.toggleFeatureSelection('arrow', featureId, feature);
            this.selectionManager.updateUI();
        } catch (error) {
            console.error('Error creating arrow:', error);
        }
    }

    // ===== CONTINUING AN EXISTING ARROW =====

    /**
     * Enter "continue this arrow" mode from one of its ends.
     *
     * THE ORDER IS THE CONTRACT: `setActiveTool` deselects everything (which is
     * what removes the handle the user just clicked) and then calls `activate()`,
     * which empties `drawPoints`. The anchor is therefore seeded AFTER the tool
     * switch, never before, or the switch would throw it away.
     *
     * Continuing from `'start'` PREPENDS, so the head stays on the last
     * coordinate and `showArrowHead`, `doubleHeaded`, `width` and
     * `airmobilePosition` are never touched.
     *
     * @param {Object} feature - Arrow feature to continue
     * @param {string} end - Which end to continue from ('start' | 'end')
     */
    startExtending = (feature, end) => {
        // Asked again here, not only when the handle was drawn: the map can be
        // locked while the handle sits on screen.
        const reason = extensionDenialReason(feature);
        if (reason) {
            showWarning(reason);
            return;
        }

        // The same tool already active means a drawing is in progress. Seeding
        // the anchor below overwrites `drawPoints`, so without this the gesture
        // would discard that work in silence. Length 1 is the anchor of a
        // continuation already open (a double click on the handle), which is
        // safe to re-seed.
        if (this.toolManager.activeTool === this && this.drawPoints.length > 1) {
            showWarning('Conclua ou cancele o desenho em andamento antes de continuar uma feição.');
            return;
        }

        const endpoints = resolveEndpoints(feature);
        if (!endpoints) return;

        const sourceFeature = deepClone(feature);

        if (this.toolManager.activeTool !== this) {
            this.toolManager.setActiveTool(this);
        }

        this._extending = {
            featureId: feature.properties.id,
            end,
            existing: endpoints.spine,
            sourceFeature
        };

        this.drawPoints = [anchorFor(endpoints.spine, end)];

        // The tool arms the drawing preview on the FIRST click; here that click
        // already happened (on the handle), so the listener is armed by hand.
        this.map.off('mousemove', this.handlePreviewMouseMove);
        this.map.on('mousemove', this.handlePreviewMouseMove);
        this.map.getCanvas().style.cursor = 'crosshair';
        this._finishButton?.updateState(this.drawPoints.length, 2);

        showToast('Clique no mapa para continuar a seta. Botão direito para concluir.', 'info');
    }

    /**
     * Draw the WHOLE feature (existing spine plus what is being added) while the
     * cursor moves, instead of only the new segment.
     * @private
     */
    _updateExtensionPreview = () => {
        const session = this._extending;
        if (!session) return;

        const coordinates = previewCoordinates(
            session.existing,
            this.drawPoints.slice(1),
            this.lastPreviewPosition,
            session.end
        );
        if (coordinates.length < 2) return;

        // The FEATURE's own properties, never the tool defaults: width, head
        // ratio, second head and the airmobile mark all shape the polygon, so
        // defaults would preview an arrow that is not the one being edited.
        const properties = buildExtendedProperties(session.sourceFeature, coordinates);

        // No timer: reached from inside the frame gate, which already caps this
        // at one build per frame.
        const previewGeometry = this.geometry.generate(coordinates, properties);
        if (previewGeometry) {
            this.showPreview(previewGeometry);
        }
    }

    /**
     * Commit the continuation: ONE `updateFeature` on the SAME feature, so the
     * id, the name and every style survive and a single Ctrl+Z undoes it.
     * @returns {Promise<void>} Resolves once the arrow is saved and reselected
     */
    finishExtending = async () => {
        const session = this._extending;
        if (!session) return;

        const added = this.drawPoints.slice(1);
        this._extending = null;

        if (added.length === 0) {
            showToast('Continuação cancelada: nenhum ponto novo.', 'info');
            this.toolManager.deactivateCurrentTool();
            return;
        }

        const coordinates = extendCoordinates(session.existing, added, session.end);
        const properties = buildExtendedProperties(session.sourceFeature, coordinates);

        try {
            const geometry = this.geometry.generate(coordinates, properties);
            if (!geometry) {
                showWarning('Não foi possível gerar a seta continuada');
                this.toolManager.deactivateCurrentTool();
                return;
            }

            const updatedFeature = {
                ...session.sourceFeature,
                properties,
                geometry
            };

            await this.forceUpdateMainSource(updatedFeature);
            // `updateFeature` directly, not `saveFeatureChanges`: that helper
            // swallows its own errors, which would leave the restore below
            // unreachable for the very failure it exists to undo.
            await updateFeature('arrows', updatedFeature);

            this.toolManager.deactivateCurrentTool();

            await this.selectionManager.selectFeature('arrow', updatedFeature.properties.id, updatedFeature);
            this.updateUIAfterEdit();
        } catch (error) {
            console.error('Error continuing arrow:', error);

            // The MapLibre source was written BEFORE the store. If the store
            // write failed, the map is showing a continuation that nothing
            // persisted, and a reload would make it vanish. Put the original
            // back, so screen and store agree again.
            try {
                await this.forceUpdateMainSource(session.sourceFeature);
            } catch (restoreError) {
                console.error('Error restoring arrow after failed continuation:', restoreError);
            }

            showWarning('Erro ao continuar a seta');
            this.toolManager.deactivateCurrentTool();
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
        hideExtensionHandles(this.map);
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

        // The continuation buttons ride with the vertex handles: every path that
        // moves a vertex (drag, move, insert, remove, property change) ends here.
        showExtensionHandles(this.map, feature, this);
    }

    clearEditHandles = () => {
        // Mirror of createEditHandles: whoever tears down the vertex circles
        // (deselection, but also the attribute table) tears down the
        // continuation buttons with them.
        hideExtensionHandles(this.map);
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

        // Same gate as the drawing preview: the polygon is rebuilt once per
        // frame, from the last position of that frame.
        this._previewScheduler.request({ point, lngLat });
    }

    async _onEditPointerUp(_e) {
        // A drag born and dead inside ONE frame (down, move, up) parks its
        // position and never reaches the frame callback, so `lastPreviewPosition`
        // below would still be null and the vertex would not follow. Deliver the
        // parked pointer now; `flush` cancels the frame it had asked for.
        if (this._previewScheduler.pending) this._previewScheduler.flush();

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
     * Update arrow preview during handle dragging without mutating the source feature.
     *
     * Called from inside the frame gate, so it already runs at most once per
     * frame; the 8/12 ms debounce it used to carry coalesced nothing (both are
     * under the 16.7 ms of a frame) and only pushed the drawing one timer late.
     * With the timer gone the "re-check the state after the debounce" guard goes
     * with it: the guard below now runs in the same turn as the drawing.
     * Removed 2026-09-04.
     *
     * @param {Array} newPosition - New handle position [lng, lat]
     */
    updateArrowPreview = (newPosition) => {
        const selectedFeature = this.getSelectedFeature();
        if (!selectedFeature || !this.activeHandleType || !this.isDraggingHandle) {
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

        const features = queryFeaturesAtPoint(this.map, e.point, { layers: HOVER_LAYER_IDS });
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
            const sourceFeature = data.features.find(f => f.properties.id === feature.properties.id);
            if (sourceFeature) {
                sourceFeature.properties[property] = value;
                feature.properties[property] = value;

                if (['width', 'headLengthRatio', 'showArrowHead', 'doubleHeaded', 'airmobile', 'airmobilePosition', 'baseCoordinates', 'branches'].includes(property)) {
                    // For merged arrows, generateMergedGeometry reads each branch's own
                    // value (branch.X || properties.X), so a top-level change is ignored
                    // unless we also write it into every branch.
                    const BRANCH_PROPS = ['width', 'headLengthRatio', 'showArrowHead', 'doubleHeaded', 'airmobile', 'airmobilePosition'];
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

        this.map.getSource('arrows').setData(data);

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
            feature.properties.doubleHeaded !== initialProperties.doubleHeaded ||
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
            const data = await this.map.getSource('arrows').getData();
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
        this._previewScheduler.cancel();
        this.lastPreviewPosition = null;
        this.lastPreviewPoints = null;
        this.activeHandle = null;
        this.activeHandleType = null;
        this.activeBranchIndex = null;
    }

    /**
     * Write ONE feature's properties and geometry straight into the source.
     *
     * No drag guard. The one that stood here tested `this.uiManager`, which a
     * control is never handed, so it never fired; and the measure that replaced
     * it found nothing for it to protect. A feature drag keeps its position in
     * the selection boxes and writes the geometry only after the flag is down,
     * so the source never holds a partial position, and a guard on the live path
     * would drop a write that nothing reapplies. Removed 2026-09-04, measured by
     * tests/unit/force-update-during-drag-military.test.js.
     *
     * @param {Object} feature - Feature to write
     * @returns {Promise<void>} Resolves once the source is written
     */
    forceUpdateMainSource = async (feature) => {
        const data = await this.map.getSource('arrows').getData();
        const sourceFeature = data.features.find(f => f.properties.id === feature.properties.id);
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

    /**
     * Finish drawing from touch device (replaces right-click)
     */
    _finishFromTouch = async () => {
        if (!this.isActive || this.drawPoints.length < 2) return;

        this.map.off('mousemove', this.handlePreviewMouseMove);

        if (this._extending) {
            await this.finishExtending();
            return;
        }

        await this.createFeature();
        this.toolManager.deactivateCurrentTool();
    }

    /**
     * Undo last drawn point (touch device helper)
     */
    _undoLastPoint = () => {
        // While continuing, index 0 is the ANCHOR (the endpoint the user clicked
        // the handle on), not a point they drew: undoing past it would detach the
        // continuation from the arrow.
        const floor = this._extending ? 1 : 0;
        if (!this.isActive || this.drawPoints.length <= floor) return;

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
        hideExtensionHandles(this.map);
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

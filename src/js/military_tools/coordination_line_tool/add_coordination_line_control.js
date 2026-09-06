// Path: js/military_tools/coordination_line_tool/add_coordination_line_control.js

import { queryFeaturesAtPoint } from '@tools/helpers/feature-hit-test.helpers.js';
import { addFeature, updateFeature, removeFeature, getActiveLayerIdSync } from '@store';
import { IDUtils, deepClone, deepEqual, createSerialQueue, showToast, showWarning } from '@utils';
import { getPointerPosition, isTouchDevice } from '@utils/pointer-utils';
import { readGeoJSONSourceDataAsync } from '@utils/geojson-source.js';
import { BaseControl } from '@tools';
import { DrawingFinishButton } from '@js/draw_tools/drawing-touch-helpers';
import { getSnappingService } from '@js/snapping/snapping.service.js';
import { createPreviewScheduler } from '@tools/helpers/preview-scheduler.js';
import {
    anchorFor,
    buildExtendedProperties,
    extendCoordinates,
    previewCoordinates,
    resolveEndpoints,
} from '@tools/helpers/line-extension.model.js';
import {
    extensionDenialReason,
    hideExtensionHandles,
    showExtensionHandles,
} from '@tools/helpers/line-extension.helpers.js';
import AddCoordinationLineGeometry from './add_coordination_line_geometry.js';
import { DEFAULT_SYMBOL_CODE } from './coordination_line_catalog.js';
import { addCoordinationLineAttributesToPanel } from './coordination_line_attributes_panel.js';
import {
    computeCoordinationLineZoomSizes,
    withCoordinationLineZoomSizes,
    isScreenAnchored,
    COORDINATION_LINE_ZOOM_LIMITS,
} from './coordination-line-zoom.model.js';

/**
 * Layers onHoverMove needs. hasHandleAtPoint matches the handle LAYER id directly;
 * hasSelectedFeatureAtPoint matches source 'coordination_lines'.
 * Ids confirmed in layers/styles/tactical.layers.js:402 and :389.
 */
const HOVER_LAYER_IDS = ['coordination-line-edit-handles-layer', 'coordination-line-layer'];

/**
 * Coordination Line control: the MD33 linear symbols, chosen from a combo box.
 * The catalogue is the one list of them, and no count is repeated here: a comment
 * saying "the five symbols" is wrong the day a sixth lands, and says nothing the
 * catalogue does not say better. See coordination_line_catalog.js.
 *
 * A polyline carrying a glyph repeated at a regular spacing, chosen from
 * coordination_line_catalog.js. Modelled on
 * the boundary tool, which is the other military line with a repeating symbol
 * and a zoom anchor, minus everything the boundary needs for its labels and
 * echelon circles: this tool draws into ONE source, so it has no dependent
 * features to rebuild, no sibling sources to keep in step, and no restore hook.
 */
class AddCoordinationLineControl extends BaseControl {
    featureType = 'coordination_line';

    /**
     * Sizes a freshly drawn coordination line is born with.
     *
     * The glyph is sized from the zoom so that a line drawn at any scale
     * looks the same on screen, exactly as the boundary sizes its echelon. The
     * spacing follows the size, which keeps the gap fraction at 1/3, safely under
     * the model's 0.5 ceiling.
     */
    static SYMBOL_SIZE_CONSTANTS = {
        MIN_SIZE_KM: 0.03,
        DEFAULT_SIZE_KM: 0.5,
        ZOOM_BASE_MULTIPLIER: 0.03,
        ZOOM_EXPONENT_BASE: 2,
        SPACING_RATIO: 3,
    };

    static DEFAULT_PROPERTIES = {
        color: '#000000',
        lineWidth: 4,
        opacity: 1,
        source: 'coordination_line',
        type: 'coordination_line',
        // Which MD33 linear symbol this line draws. See coordination_line_catalog.js.
        symbol_code: DEFAULT_SYMBOL_CODE,
        // Glyph along-line size and centre-to-centre distance, both in km.
        symbol_size: 0.5,
        symbol_spacing: 1.5,
        // Zoom anchor: ONE switch for the whole feature. On (the default), the
        // stroke scales 2x per zoom level from `createdAtZoom` and the diamonds
        // keep their ground size, so everything stays glued to the TERRAIN; off,
        // the stroke stays put and the diamonds shrink in kilometres instead, so
        // everything stays glued to the SCREEN. See coordination-line-zoom.model.js.
        createdAtZoom: 0,
        zoomCorrectionEnabled: true,
        calculatedLineWidth: 4,
        calculatedSymbolSize: 0.5,
        calculatedSymbolSpacing: 1.5,
        nome: '',
        descricao: '',
        visivel: true,
        bloqueado: false,
    };

    constructor(toolManager) {
        super(toolManager);

        this.drawPoints = [];
        this.isDraggingHandle = false;
        this.activeHandleType = null;
        this.activeHandleIndex = null;

        this.geometry = new AddCoordinationLineGeometry();

        // Every read-modify-write of `coordination_lines` goes through this queue.
        // `getData()` is a round trip to the worker, so two overlapping cycles
        // both read the pre-mutation clone and the second `setData` silently
        // discards the first one's work. The zoom pass, a panel edit and a paste
        // can all land in the same frame, so one source is enough to need it.
        // Public methods below are the serialized shells; the `_xxxUnlocked`
        // bodies are what runs inside a task, and they call only each other.
        this._sourceQueue = createSerialQueue();

        // ONE rAF gate for the whole preview. The drawing, the continuation and
        // the handle drag are never live together (a drag needs a selected
        // feature, a drawing does not have one) and already shared this state, so
        // they share the gate: the raw event parks a pointer, the frame resolves
        // the snap once and draws once.
        this._previewScheduler = createPreviewScheduler({
            raf: (callback) => requestAnimationFrame(callback),
            caf: (id) => cancelAnimationFrame(id),
            onFrame: (pointer) => this.performPreviewUpdate(pointer),
        });
        // The indicator BEFORE the first click gets its own gate: it is armed by
        // `activate()` and swapped for the drawing preview on that first click.
        this._preClickScheduler = createPreviewScheduler({
            raf: (callback) => requestAnimationFrame(callback),
            caf: (id) => cancelAnimationFrame(id),
            onFrame: (pointer) => this._updatePreClickSnap(pointer),
        });
        this.zoomRafId = null;
        this.zoomEndRafId = null;
        // `pendingZoomUpdate` is held for the whole (async) pass so the frames of
        // a zoom gesture cannot stack; `missedZoomUpdate` records the frames that
        // arrive meanwhile, so the last zoom of the gesture is replayed, not lost.
        // The `ZoomEnd` twins do the same for the once-per-gesture pass, which is
        // async for the same reasons and can also land mid-drag.
        this.pendingZoomUpdate = false;
        this.missedZoomUpdate = false;
        this.pendingZoomEndUpdate = false;
        this.missedZoomEndUpdate = false;
        this.lastPreviewPosition = null;
        this.lastPreviewPoints = null;

        this._finishButton = null;
        this._name = 'AddCoordinationLineControl';

        // Continuation session, set while the user is extending an existing
        // coordination line from one of its ends. See startExtending / finishExtending.
        this._extending = null;

        this._activePointerId = null;

        this._onEditPointerDown = this._onEditPointerDown.bind(this);
        this._onEditPointerMove = this._onEditPointerMove.bind(this);
        this._onEditPointerUp = this._onEditPointerUp.bind(this);
    }

    // ========================================================================
    // ZOOM-ADAPTIVE SIZING
    // ========================================================================

    /**
     * Diamond size for a coordination line born at a given zoom.
     * @param {number} zoom - Current map zoom level
     * @returns {number} Diamond size in kilometres
     */
    calculateSymbolSizeForZoom(zoom) {
        const { ZOOM_BASE_MULTIPLIER, ZOOM_EXPONENT_BASE, DEFAULT_SIZE_KM, MIN_SIZE_KM } =
            AddCoordinationLineControl.SYMBOL_SIZE_CONSTANTS;

        if (!Number.isFinite(zoom)) return DEFAULT_SIZE_KM;

        const calculatedSize = Math.pow(ZOOM_EXPONENT_BASE, 16 - zoom) * ZOOM_BASE_MULTIPLIER;
        return Number.isFinite(calculatedSize)
            ? Math.max(MIN_SIZE_KM, calculatedSize)
            : DEFAULT_SIZE_KM;
    }

    /**
     * Spacing that goes with a given diamond size.
     * @param {number} sizeKm - Diamond size in kilometres
     * @returns {number} Centre-to-centre distance in kilometres
     */
    calculateSpacingForSize(sizeKm) {
        return sizeKm * AddCoordinationLineControl.SYMBOL_SIZE_CONSTANTS.SPACING_RATIO;
    }

    // ========================================================================
    // MAPLIBRE CONTROL INTERFACE
    // ========================================================================

    onAdd = (map) => {
        this.map = map;
        this.setupZoomListener();
    }

    onRemove = () => {
        this.map?.off('zoom', this.handleZoomChange);
        this.map?.off('zoomend', this.handleZoomEnd);
        if (this.zoomRafId) {
            cancelAnimationFrame(this.zoomRafId);
            this.zoomRafId = null;
        }
        if (this.zoomEndRafId) {
            cancelAnimationFrame(this.zoomEndRafId);
            this.zoomEndRafId = null;
        }
        this.pendingZoomUpdate = false;
        this.missedZoomUpdate = false;
        this.pendingZoomEndUpdate = false;
        this.missedZoomEndUpdate = false;
        this.deactivate();
        this.removeAllEventListeners();
        this.map = undefined;
    }

    hasAttributePanel() {
        return true;
    }

    createAttributePanel(container, features, selectionManager, uiManager, options = {}) {
        const sectionPanel = document.createElement('div');
        sectionPanel.className = 'coordination-line-attributes-section';

        try {
            addCoordinationLineAttributesToPanel(sectionPanel, features, this, selectionManager, uiManager, options);
            container.appendChild(sectionPanel);
        } catch (error) {
            console.error('Error creating coordination line attribute panel:', error);
        }
    }

    getDragSources() {
        return ['coordination_lines'];
    }

    getEditHandleSources() {
        return ['coordination-line-edit-handles'];
    }

    getSourceNames() {
        return ['coordination_lines'];
    }

    getEditHandleSource() {
        return 'coordination-line-edit-handles';
    }

    /**
     * The real MapLibre layer this feature draws into.
     * Named against `tactical.layers.js` on purpose: the boundary tool returns an
     * id that no layer carries, which nothing reads today but would mislead the
     * first caller that did.
     * @returns {string[]} Layer ids
     */
    getLayerIds() {
        return ['coordination-line-layer'];
    }

    getSelectionBoxStrategy() {
        return 'bbox';
    }

    getSelectionBoxPadding() {
        return 8;
    }

    createSelectionBox(feature) {
        try {
            const coordinates = this.geometry.normalizeBaseCoordinates(feature.properties.baseCoordinates);
            if (coordinates && coordinates.length >= 2) {
                const bbox = this.geometry.getBoundingBox(coordinates);
                const expandedBbox = this.expandBboxWithPadding(bbox, this.getSelectionBoxPadding(), this.map);
                return turf.bboxPolygon(expandedBbox);
            }
            return turf.bbox(feature);
        } catch (error) {
            console.warn('Error creating coordination line selection box:', error);
            return null;
        }
    }

    // ========================================================================
    // COPY, PASTE AND MOVE
    // ========================================================================

    canCopy(_feature) {
        return true;
    }

    canPaste(_feature) {
        return true;
    }

    canMove(feature) {
        return !feature.properties?.bloqueado;
    }

    prepareForPaste(feature, offset) {
        const oldCoords = this.geometry.normalizeBaseCoordinates(feature.properties.baseCoordinates);
        if (!oldCoords) return feature;

        const newCoords = oldCoords.map(coord => [coord[0] + offset.dx, coord[1] + offset.dy]);
        const properties = { ...feature.properties, baseCoordinates: newCoords };

        return {
            ...feature,
            properties,
            // The zoom goes in because the pasted copy carries the derived sizes
            // of whatever zoom it was copied at.
            geometry: this.geometry.generate(properties, this.getCurrentZoom()),
        };
    }

    calculateMoveOffset(feature, referencePoint) {
        const coordinates = this.geometry.normalizeBaseCoordinates(feature.properties.baseCoordinates);
        if (!coordinates || coordinates.length === 0) return [0, 0];

        const firstPoint = coordinates[0];
        return [firstPoint[0] - referencePoint.lng, firstPoint[1] - referencePoint.lat];
    }

    updateFeatureForMove(feature, dx, dy, _newCoords) {
        const oldCoords = this.geometry.normalizeBaseCoordinates(feature.properties.baseCoordinates);
        if (!oldCoords) return feature;

        const newBaseCoords = oldCoords.map(coord => [coord[0] + dx, coord[1] + dy]);
        const properties = { ...feature.properties, baseCoordinates: newBaseCoords };

        return {
            ...feature,
            properties,
            geometry: this.geometry.generate(properties, this.getCurrentZoom()),
        };
    }

    // ========================================================================
    // TOOL ACTIVATION
    // ========================================================================

    activate = () => {
        this.isActive = true;
        this.drawPoints = [];
        this.map.getCanvas().style.cursor = 'crosshair';
        this.map.getCanvas().addEventListener('contextmenu', this.handleRightClick);
        this.map.on('mousemove', this._onPreClickMouseMove);

        if (isTouchDevice()) {
            this._finishButton = new DrawingFinishButton({
                onFinish: () => this._finishFromTouch(),
                onUndo: () => this._undoLastPoint(),
            });
            this._finishButton.show();
            this._finishButton.updateState(0, 2);
        }
    }

    deactivate = () => {
        // Dropped FIRST: Esc and switching tools both land here, and a
        // continuation writes nothing before it is committed, so forgetting the
        // session leaves the original coordination line untouched by construction.
        this._extending = null;
        this.isActive = false;
        this.map.off('mousemove', this._onPreClickMouseMove);
        this.map.off('mousemove', this.handlePreviewMouseMove);
        this.drawPoints = [];
        this.map.getCanvas().style.cursor = '';
        this.map.getCanvas().removeEventListener('contextmenu', this.handleRightClick);
        getSnappingService()?.hideIndicator(this.map);
        this.clearPreview();
        this.deselectFeature();

        if (this._finishButton) {
            this._finishButton.hide();
            this._finishButton = null;
        }
    }

    /**
     * Snap indicator before the first click, when there is nothing to preview yet.
     *
     * The raw `mousemove` only PARKS the pointer: `snapping.resolve` is a
     * rendered-feature query, and a mouse can fire several moves inside one
     * frame, so it runs once per frame from the rAF callback below. The
     * indicator lands on the same pixel either way, since only the last position
     * of the frame is ever drawn.
     */
    _onPreClickMouseMove = (e) => {
        this._preClickScheduler.request({ point: e.point, lngLat: e.lngLat });
    }

    /**
     * @param {Object} pointer - The frame's last `{ point, lngLat }`
     * @private
     */
    _updatePreClickSnap = (pointer) => {
        if (!pointer || !this.map) return;

        const snapping = getSnappingService();
        const snap = snapping?.resolve(this.map, pointer.point, pointer.lngLat);
        if (snap?.snapped) {
            snapping.showIndicator(this.map, snap, snap.snapType);
        } else {
            snapping?.hideIndicator(this.map);
        }
    }

    // ========================================================================
    // SELECTION CALLBACKS
    // ========================================================================

    onFeatureSelected = (feature) => {
        const normalizedCoords = this.geometry.normalizeBaseCoordinates(feature?.properties?.baseCoordinates);
        if (feature?.properties?.baseCoordinates && !(normalizedCoords && normalizedCoords.length >= 2)) {
            console.warn('Cannot select coordination line - invalid coordinates:', feature.properties.baseCoordinates);
            return;
        }
        if (normalizedCoords) {
            feature.properties.baseCoordinates = normalizedCoords;
        }
        this.selectFeature(feature);
    }

    onFeatureDeselected = (feature) => {
        const selectedFeature = this.getSelectedFeature();
        if (selectedFeature && selectedFeature.properties.id === feature.properties.id) {
            this.deselectFeature();
        }
    }

    onGlobalDeselect = () => {
        if (this.getSelectedFeature()) {
            this.deselectFeature();
        }
    }

    isEditingMode = () => false

    hasEditHandle = (featureId) => {
        const selectedFeature = this.getSelectedFeature();
        return Boolean(selectedFeature && selectedFeature.properties.id === featureId);
    }

    syncEditHandlesAfterDrag = (movedFeatures) => {
        const selectedFeature = this.getSelectedFeature();
        if (!selectedFeature || this.isDraggingHandle) return;

        const updatedFeature = movedFeatures.find(f => f.properties.id === selectedFeature.properties.id);
        if (!updatedFeature) return;

        const normalizedCoords = this.geometry.normalizeBaseCoordinates(updatedFeature.properties.baseCoordinates);
        if (!normalizedCoords || normalizedCoords.length < 2) {
            console.warn('Invalid coordinates in moved coordination line, keeping current selection');
            return;
        }

        updatedFeature.properties.baseCoordinates = normalizedCoords;
        this.updateSelectionManagerFeature(updatedFeature);
        this.createEditHandles(updatedFeature);
    }

    // ========================================================================
    // DRAWING
    // ========================================================================

    handleMapClick = (e) => {
        if (!this.isActive) return;

        const snapping = getSnappingService();
        // While continuing, exclude the feature itself: its own vertices would
        // otherwise capture every click, exactly as they do for a handle drag.
        const snap = snapping?.resolve(this.map, e.point, e.lngLat, this._extending?.featureId) ?? e.lngLat;
        const newPoint = [snap.lng, snap.lat];

        // The rejection that also does the dedup: a repeat click on the spot the
        // previous click just committed is within MIN_DISTANCE_METERS of the LAST
        // vertex, so it is dropped here. That is why the 250 ms hold this click
        // used to sit in could go: it existed only to catch the repeat, and it
        // caught it by re-arming a pending point, which silently kept the SECOND
        // set of coordinates. Measured in real Chromium on 2026-09-04: 260 to
        // 290 ms from click to vertex, invisible behind the preview on a mouse
        // and plainly late on the touch finish button. Removed 2026-09-04.
        if (this.geometry.isPointTooClose(newPoint, this.drawPoints)) return;

        this._commitPoint(newPoint);
    }

    /**
     * Push a vertex and keep the listeners and the finish button in step.
     * @param {Array<number>} point - The vertex, [lng, lat]
     * @private
     */
    _commitPoint = (point) => {
        this.drawPoints.push(point);

        // Switch from pre-click snap indicator to preview listener when first point is added
        if (this.drawPoints.length === 1) {
            this.map.off('mousemove', this._onPreClickMouseMove);
            this.map.on('mousemove', this.handlePreviewMouseMove);
        }

        if (this._finishButton) {
            this._finishButton.updateState(this.drawPoints.length, 2);
        }
    }

    handleRightClick = async (e) => {
        if (!this.isActive) return;

        e.preventDefault();
        e.stopPropagation();

        // Nothing pending to rescue: every left click is already a vertex.
        const screenPoint = { x: e.offsetX, y: e.offsetY };
        const coordinates = this.map.unproject([screenPoint.x, screenPoint.y]);
        const snapping = getSnappingService();
        const snap = snapping?.resolve(this.map, screenPoint, coordinates, this._extending?.featureId) ?? coordinates;
        snapping?.hideIndicator(this.map);
        const finalPoint = [snap.lng, snap.lat];

        if (!this.geometry.isPointTooClose(finalPoint, this.drawPoints)) {
            this.drawPoints.push(finalPoint);
        }

        if (this._extending) {
            await this.finishExtending();
            return;
        }

        if (this.drawPoints.length >= 2) {
            await this.createFeature();
        }

        this.stopDrawing();
    }

    /**
     * Park the pointer and ask for a frame. The snap is resolved inside the
     * gate's callback, once per frame, for the reason on `_onPreClickMouseMove`.
     */
    handlePreviewMouseMove = (e) => {
        if (this.drawPoints.length < 1) return;

        this._previewScheduler.request({ point: e.point, lngLat: e.lngLat });
    }

    /**
     * The frame callback: resolve the snap ONCE, move the indicator, then draw.
     * @param {Object} [pointer] - The frame's last `{ point, lngLat }`, when a
     *   pointer event parked one.
     */
    performPreviewUpdate = (pointer) => {
        const selectedFeature = this.getSelectedFeature();
        const draggingHandle = Boolean(this.isDraggingHandle && selectedFeature && this.activeHandleType);

        if (pointer) {
            const snapping = getSnappingService();
            // Exclude the feature itself in the two cases that have one: dragging
            // its own handle, and continuing it. Its own vertices would otherwise
            // capture every move.
            const excludeId = draggingHandle
                ? selectedFeature.properties?.id
                : this._extending?.featureId;
            const snap = snapping?.resolve(this.map, pointer.point, pointer.lngLat, excludeId)
                ?? pointer.lngLat;

            if (snap.snapped) {
                snapping.showIndicator(this.map, snap, snap.snapType);
            } else {
                snapping?.hideIndicator(this.map);
            }

            this.lastPreviewPosition = [snap.lng, snap.lat];
            // Read here, not on the raw event: a drag has no drawn points, and
            // the frame sees whatever a click committed meanwhile.
            if (!draggingHandle) this.lastPreviewPoints = [...this.drawPoints];
        }

        if (!this.lastPreviewPosition) return;

        if (draggingHandle) {
            this.updateCoordinationLinePreview(this.lastPreviewPosition);
        } else if (this._extending) {
            this._updateExtensionPreview();
        } else if (this.lastPreviewPoints && this.lastPreviewPoints.length >= 1) {
            // No pending click to append: the click already put it in
            // `drawPoints`, which is what `lastPreviewPoints` was copied from.
            const previewPoints = [...this.lastPreviewPoints, this.lastPreviewPosition];

            const currentZoom = this.map.getZoom();
            const previewSize = this.calculateSymbolSizeForZoom(currentZoom);

            // Derive the sizes instead of inheriting the defaults': the shared
            // DEFAULT_PROPERTIES carries derived values belonging to another
            // size, and the preview overrides only the authored pair.
            const previewProperties = withCoordinationLineZoomSizes({
                ...AddCoordinationLineControl.DEFAULT_PROPERTIES,
                symbol_size: previewSize,
                symbol_spacing: this.calculateSpacingForSize(previewSize),
                createdAtZoom: Math.round(currentZoom * 10) / 10,
                baseCoordinates: previewPoints,
            }, currentZoom);

            this.showPreview(this.geometry.generate(previewProperties, currentZoom));
        }
    }

    showPreview = (geometry) => {
        this.map.getSource('coordination-line-feedback')?.setData({
            type: 'Feature',
            geometry,
            properties: {},
        });
    }

    clearPreview = () => {
        this.cancelPendingUpdates();
        this.map?.getSource('coordination-line-feedback')?.setData({
            type: 'FeatureCollection',
            features: [],
        });
    }

    stopDrawing = () => {
        this.map.off('mousemove', this.handlePreviewMouseMove);
        getSnappingService()?.hideIndicator(this.map);
        this.drawPoints = [];
        this.clearPreview();
    }

    createFeature = async () => {
        if (this.drawPoints.length < 2) return;

        if (!this.geometry.validate(this.drawPoints)) {
            console.warn('Insufficient valid points for coordination line creation');
            return;
        }

        const { id: featureId, geoJsonId } = IDUtils.generateFeatureIds();
        const featureName = await IDUtils.generateFeatureName('coordination_line', this.map);

        const currentZoom = this.map.getZoom();
        const adaptiveSize = this.calculateSymbolSizeForZoom(currentZoom);

        const properties = {
            ...AddCoordinationLineControl.DEFAULT_PROPERTIES,
            symbol_size: adaptiveSize,
            symbol_spacing: this.calculateSpacingForSize(adaptiveSize),
            baseCoordinates: [...this.drawPoints],
            createdAtZoom: Math.round(currentZoom * 10) / 10,
            id: featureId,
            nome: featureName,
            layerId: getActiveLayerIdSync(),
        };

        // At creation the factor is 1 by construction; computing it anyway keeps
        // the derived properties written in one place only.
        Object.assign(properties, computeCoordinationLineZoomSizes(properties, currentZoom));

        const geometry = this.geometry.generate(properties, currentZoom);

        if (!geometry || !geometry.coordinates) {
            console.error('Failed to generate valid geometry for coordination line');
            return;
        }

        const feature = { type: 'Feature', id: geoJsonId, properties, geometry };

        try {
            await addFeature('coordination_lines', feature);

            // One task: the append must not be split by another cycle reading the
            // source in between.
            await this._sourceQueue(async () => {
                const source = this.map?.getSource('coordination_lines');
                if (!source) return;
                const data = await source.getData();
                data.features.push(feature);
                source.setData(data);
            });

            this.drawPoints = [];
            this.toolManager.deactivateCurrentTool();
            await this.selectionManager.toggleFeatureSelection('coordination_line', featureId, feature);
            this.selectionManager.updateUI();
        } catch (error) {
            console.error('Error creating coordination line:', error);
        }
    }

    // ========================================================================
    // CONTINUING AN EXISTING COORDINATION LINE
    // ========================================================================

    /**
     * Open a continuation session from one end of an existing coordination line.
     * Called by the continuation buttons that `showExtensionHandles` draws on the
     * two endpoints of the selected feature.
     * @param {Object} feature - The coordination line to continue
     * @param {string} end - Which end, `'start'` or `'end'`
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
            sourceFeature,
        };

        this.drawPoints = [anchorFor(endpoints.spine, end)];

        // `activate()` armed the pre-click snap indicator, which the drawing
        // preview normally replaces on the FIRST click. Here that click already
        // happened (on the handle), so the swap is done by hand.
        this.map.off('mousemove', this._onPreClickMouseMove);
        this.map.off('mousemove', this.handlePreviewMouseMove);
        this.map.on('mousemove', this.handlePreviewMouseMove);
        this.map.getCanvas().style.cursor = 'crosshair';
        this._finishButton?.updateState(this.drawPoints.length, 2);

        showToast('Clique no mapa para continuar a linha de coordenação. Botão direito para concluir.', 'info');
    }

    /**
     * Draw the WHOLE feature (existing spine plus what is being added) while the
     * cursor moves, instead of only the new segment.
     * @private
     */
    _updateExtensionPreview = () => {
        const session = this._extending;
        if (!session) return;

        const pending = this.drawPoints.slice(1);

        const coordinates = previewCoordinates(
            session.existing,
            pending,
            this.lastPreviewPosition,
            session.end,
        );
        if (coordinates.length < 2) return;

        // The FEATURE's own properties, never the tool defaults: the diamond size
        // and spacing carve the gaps, so defaults would preview a symbol the
        // feature does not have.
        const properties = buildExtendedProperties(session.sourceFeature, coordinates);

        const previewGeometry = this.geometry.generate(properties, this.getCurrentZoom());
        if (previewGeometry) {
            this.showPreview(previewGeometry);
        }
    }

    /**
     * Commit the continuation: ONE `updateFeature` on the SAME feature, so the
     * id, the name and every style survive and a single Ctrl+Z undoes it.
     *
     * `createdAtZoom` and `zoomCorrectionEnabled` are carried over untouched
     * (re-stamping them would resize the whole feature under the user) and the
     * `calculated*` cache is left to the zoom pass that owns it.
     *
     * The diamonds need no remapping, unlike the boundary's echelon: they are
     * placed by an absolute spacing in kilometres, not by a ratio of the total
     * length, so a longer line simply carries more of them at the same spacing,
     * and the ones already drawn do not move.
     *
     * @returns {Promise<void>} Resolves once the feature is rebuilt, saved and reselected
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
            const geometry = this.geometry.generate(properties, this.getCurrentZoom());
            if (!geometry || !geometry.coordinates) {
                showWarning('Não foi possível gerar a linha de coordenação continuada');
                this.toolManager.deactivateCurrentTool();
                return;
            }

            const updatedFeature = { ...session.sourceFeature, properties, geometry };

            await this.forceUpdateMainSource(updatedFeature);
            // `updateFeature` directly, not `saveFeatureChanges`: that helper
            // swallows its own errors, which would leave the restore below
            // unreachable for the very failure it exists to undo.
            await updateFeature('coordination_lines', updatedFeature);

            this.toolManager.deactivateCurrentTool();

            await this.selectionManager.selectFeature(
                'coordination_line', updatedFeature.properties.id, updatedFeature,
            );
            this.updateUIAfterEdit();
        } catch (error) {
            console.error('Error continuing coordination line:', error);

            // The MapLibre source was written BEFORE the store. If the store
            // write failed, the map is showing a continuation that nothing
            // persisted, and a reload would make it vanish. Put the original
            // back, so screen and store agree again.
            try {
                await this.forceUpdateMainSource(session.sourceFeature);
            } catch (restoreError) {
                console.error('Error restoring coordination line after failed continuation:', restoreError);
            }

            showWarning('Erro ao continuar a linha de coordenação');
            this.toolManager.deactivateCurrentTool();
        }
    }

    // ========================================================================
    // EDIT HANDLES
    // ========================================================================

    selectFeature = (feature) => {
        this.setupHoverListeners();

        // Skip edit handles and edit listeners when the map is locked (read-only)
        if (this._mapLocked) return;

        this.createEditHandles(feature);
        this.setupEditEventListeners();
        this.setupEditRightClickListener();
    }

    deselectFeature = () => {
        hideExtensionHandles(this.map);
        this.isDraggingHandle = false;
        this.activeHandleType = null;
        this.activeHandleIndex = null;
        this.clearEditHandles();
        this.removeEditEventListeners();
        this.removeHoverListeners();
        this.removeEditRightClickListener();
        this.cancelPendingUpdates();
        this.map?.dragPan.enable();
        if (this.map) this.map.getCanvas().style.cursor = '';
    }

    createEditHandles = (feature) => {
        const handles = this.geometry.createHandles(feature);
        if (!handles || handles.length === 0) return;

        this.map.getSource('coordination-line-feedback')?.setData({
            type: 'Feature',
            geometry: feature.geometry,
            properties: {},
        });

        this.map.getSource('coordination-line-edit-handles')?.setData({
            type: 'FeatureCollection',
            features: handles,
        });

        // The continuation buttons ride with the vertex handles: every path that
        // moves a vertex (drag, move, insert, remove, property change) ends here.
        showExtensionHandles(this.map, feature, this);
    }

    clearEditHandles = () => {
        // Mirror of createEditHandles: whoever tears down the vertex circles
        // tears down the continuation buttons with them.
        hideExtensionHandles(this.map);
        const empty = { type: 'FeatureCollection', features: [] };
        this.map?.getSource('coordination-line-feedback')?.setData(empty);
        this.map?.getSource('coordination-line-edit-handles')?.setData(empty);
    }

    setupEditEventListeners = () => {
        this.map.getCanvasContainer().addEventListener('pointerdown', this._onEditPointerDown);
    }

    removeEditEventListeners = () => {
        if (!this.map) return;
        const canvas = this.map.getCanvasContainer();
        canvas.removeEventListener('pointerdown', this._onEditPointerDown);
        canvas.removeEventListener('pointermove', this._onEditPointerMove);
        canvas.removeEventListener('pointerup', this._onEditPointerUp);
        canvas.removeEventListener('pointercancel', this._onEditPointerUp);

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
        if (!e.isPrimary) return;
        // Right-click is vertex removal, handled by handleEditRightClick
        if (e.button === 2) return;

        if (!this.getSelectedFeature()) return;

        const canvas = this.map.getCanvasContainer();
        const point = getPointerPosition(e, canvas);

        const handleFeatures = this.map.queryRenderedFeatures([point.x, point.y], {
            layers: ['coordination-line-edit-handles-layer'],
        });
        if (handleFeatures.length === 0) return;

        const handle = handleFeatures[0];
        if (!handle.properties.user_isEditingHandle) return;

        this.isDraggingHandle = true;
        this.activeHandleType = handle.properties.type;
        this.activeHandleIndex = handle.properties.index;
        this.map.dragPan.disable();
        this.map.getCanvas().style.cursor = 'grabbing';

        this._activePointerId = e.pointerId;
        canvas.setPointerCapture(e.pointerId);

        canvas.addEventListener('pointermove', this._onEditPointerMove);
        canvas.addEventListener('pointerup', this._onEditPointerUp);
        canvas.addEventListener('pointercancel', this._onEditPointerUp);

        e.preventDefault();
    }

    /**
     * The handle drag rides the SAME gate as the drawing preview: the pointer is
     * parked here and the snap is resolved once per frame in
     * `performPreviewUpdate`, which excludes the dragged feature itself.
     */
    _onEditPointerMove(e) {
        if (!e.isPrimary) return;

        const selectedFeature = this.getSelectedFeature();
        if (!this.isDraggingHandle || !selectedFeature) return;

        const canvas = this.map.getCanvasContainer();
        const point = getPointerPosition(e, canvas);
        const lngLat = this.map.unproject([point.x, point.y]);

        this._previewScheduler.request({ point, lngLat });
    }

    _onEditPointerUp = async (_e) => {
        // A drag born and dead inside ONE frame (down, move, up) parks its
        // position and never reaches the frame callback, so `lastPreviewPosition`
        // below would still be null and the vertex would not follow. Deliver the
        // parked pointer now; `flush` cancels the frame it had asked for.
        if (this._previewScheduler.pending) this._previewScheduler.flush();

        const canvas = this.map.getCanvasContainer();

        canvas.removeEventListener('pointermove', this._onEditPointerMove);
        canvas.removeEventListener('pointerup', this._onEditPointerUp);
        canvas.removeEventListener('pointercancel', this._onEditPointerUp);

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
            const result = this.geometry.updateFromHandle(
                this.activeHandleType,
                this.lastPreviewPosition,
                selectedFeature,
                this.activeHandleIndex,
                this.getCurrentZoom(),
            );

            if (result) {
                const updatedFeature = {
                    ...selectedFeature,
                    properties: result.properties,
                    geometry: result.geometry,
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
        this.activeHandleType = null;
        this.activeHandleIndex = null;
        this.map.dragPan.enable();
        this.map.getCanvas().style.cursor = '';

        // The zoom pass steps aside while a handle is being dragged; replay the
        // zoom it skipped now that the source is ours again.
        this.replayMissedZoomUpdate();
    }

    /**
     * Draw the handle-drag preview. Called from inside the rAF callback, so it
     * already runs at most once per frame; the 8 ms debounce this used to carry
     * coalesced nothing (8 ms is under the 16.7 ms of a frame) and only pushed
     * the drawing one timer late. Removed 2026-09-04.
     * @param {Array} newPosition - The snapped `[lng, lat]` under the cursor
     */
    updateCoordinationLinePreview = (newPosition) => {
        const selectedFeature = this.getSelectedFeature();
        if (!selectedFeature || !this.activeHandleType) return;

        const result = this.geometry.updateFromHandle(
            this.activeHandleType,
            newPosition,
            selectedFeature,
            this.activeHandleIndex,
            this.getCurrentZoom(),
        );

        if (result) {
            this.showEditPreview(result.geometry, result.properties);
        }
    }

    showEditPreview = (geometry, properties) => {
        this.map.getSource('coordination-line-feedback')?.setData({
            type: 'Feature',
            geometry,
            properties: {},
        });

        const handles = this.geometry.createHandles({ properties, geometry });
        this.map.getSource('coordination-line-edit-handles')?.setData({
            type: 'FeatureCollection',
            features: handles,
        });
    }

    // ========================================================================
    // HOVER AND VERTEX REMOVAL
    // ========================================================================

    setupHoverListeners = () => {
        this.map.on('mousemove', this.onHoverMove);
    }

    removeHoverListeners = () => {
        this.map?.off('mousemove', this.onHoverMove);
    }

    setupEditRightClickListener = () => {
        // Capture phase, to intercept before the context menu control
        this.map.getCanvas().addEventListener('contextmenu', this.handleEditRightClick, true);
    }

    removeEditRightClickListener = () => {
        this.map?.getCanvas().removeEventListener('contextmenu', this.handleEditRightClick, true);
    }

    onHoverMove = (e) => {
        if (!this.getSelectedFeature()) return;

        const features = queryFeaturesAtPoint(this.map, e.point, { layers: HOVER_LAYER_IDS });

        if (this.hasHandleAtPoint(features)) {
            this.map.getCanvas().style.cursor = 'crosshair';
        } else if (this.hasSelectedFeatureAtPoint(features)) {
            this.map.getCanvas().style.cursor = 'move';
        } else {
            this.map.getCanvas().style.cursor = '';
        }
    }

    hasHandleAtPoint = (features) => features.some(f => f.layer?.id === 'coordination-line-edit-handles-layer')

    hasSelectedFeatureAtPoint = (features) => {
        const selectedFeature = this.getSelectedFeature();
        if (!selectedFeature) return false;
        return features.some(f => f.source === 'coordination_lines'
            && f.properties.id === selectedFeature.properties.id);
    }

    /**
     * Right-click on a vertex handle removes that vertex.
     * @param {MouseEvent} e - Right-click event
     * @returns {Promise<void>} Resolves once the removal is written
     */
    handleEditRightClick = async (e) => {
        const selectedFeature = this.getSelectedFeature();
        if (!selectedFeature) return;

        const handleFeatures = this.map.queryRenderedFeatures([e.offsetX, e.offsetY], {
            layers: ['coordination-line-edit-handles-layer'],
        });

        const vertexHandle = handleFeatures.find(f =>
            f.properties.type === 'vertex' && f.properties.user_isEditingHandle);
        if (!vertexHandle) return;

        // Before any await, or the browser menu opens anyway
        e.preventDefault();
        e.stopPropagation();

        const coordinates = this.geometry.normalizeBaseCoordinates(selectedFeature.properties.baseCoordinates);
        if (!coordinates || coordinates.length <= 2) {
            showWarning('Uma linha de coordenação precisa de pelo menos dois vértices.');
            return;
        }

        const newCoordinates = this.geometry.removeVertexAtIndex(coordinates, vertexHandle.properties.index);
        if (!newCoordinates) return;

        const updatedProperties = { ...selectedFeature.properties, baseCoordinates: newCoordinates };
        const updatedFeature = {
            ...selectedFeature,
            properties: updatedProperties,
            geometry: this.geometry.generate(updatedProperties, this.getCurrentZoom()),
        };

        await this.forceUpdateMainSource(updatedFeature);
        this.updateSelectionManagerFeature(updatedFeature);
        this.createEditHandles(updatedFeature);
        this.updateUIAfterEdit();
        await this.saveFeatureChanges(updatedFeature);
    }

    // ========================================================================
    // ZOOM CORRECTION
    // ========================================================================

    // The line layer derives the stroke width from the zoom on the GPU now
    // (`buildCoordinationLineWidthExpression`), so the per-frame pass no longer
    // feeds the drawing of a terrain-pinned line: it is left with the one job no
    // style expression can do, the ground geometry of the SCREEN-pinned lines,
    // whose diamonds live in kilometres and have to be rebuilt at every zoom
    // step. Everything else (the stored `calculated*` properties the export, the
    // selection box and the feature header read) is worth doing once per
    // gesture, on `zoomend`. Measured on 2026-09-04: the old single pass wrote
    // the whole collection 91 times in a 3 s gesture.
    setupZoomListener = () => {
        this.map.on('zoom', this.handleZoomChange);
        this.map.on('zoomend', this.handleZoomEnd);
    }

    handleZoomChange = () => {
        // `pendingZoomUpdate` stays true for the WHOLE pass, not just until it
        // starts: the pass is async (a `getData` read, and a geometry rebuild for
        // the screen-pinned features), so clearing it early would let every frame
        // of a zoom gesture stack another pass, and the one that started at the
        // OLD zoom could finish last and write stale sizes.
        if (this.pendingZoomUpdate) {
            this.missedZoomUpdate = true;
            return;
        }

        this.pendingZoomUpdate = true;
        this.zoomRafId = requestAnimationFrame(this.updateScreenAnchoredGeometry);
    }

    handleZoomEnd = () => {
        // Same discipline as above, and needed for the same reason: `zoomend`
        // fires once per gesture, but a wheel gesture is a burst of gestures, and
        // this pass is async too.
        if (this.pendingZoomEndUpdate) {
            this.missedZoomEndUpdate = true;
            return;
        }

        this.pendingZoomEndUpdate = true;
        this.zoomEndRafId = requestAnimationFrame(this.updateAllCoordinationLineZoomSizes);
    }

    replayMissedZoomUpdate = () => {
        if (!this.map) return;
        if (this.missedZoomUpdate) this.handleZoomChange();
        if (this.missedZoomEndUpdate) this.handleZoomEnd();
    }

    getCurrentZoom = () => (this.map ? this.map.getZoom() : NaN)

    /**
     * A copy of the feature carrying freshly derived sizes.
     * @param {Object} feature - Coordination line feature
     * @returns {Object} New feature object
     */
    withZoomSizes = (feature) => ({
        ...feature,
        properties: withCoordinationLineZoomSizes(feature.properties, this.getCurrentZoom()),
    })

    /**
     * Recompute every feature's derived sizes and geometry at a given zoom.
     *
     * Used on map load, before the source is first written. Unlike the per-frame
     * pass, this rebuilds the geometry of EVERY feature and not only the
     * screen-pinned ones: a feature pinned to the screen and reopened at another
     * zoom would otherwise draw at the wrong scale, and one saved before the
     * diamond cap existed may carry a geometry the cap would now refuse.
     *
     * @param {Array} features - Features from storage
     * @param {number} [zoom] - Zoom to correct for
     * @returns {Array} Corrected features
     */
    applyZoomCorrections = (features, zoom = this.getCurrentZoom()) => {
        if (!Array.isArray(features)) return [];

        return features.map(feature => {
            const properties = withCoordinationLineZoomSizes(feature.properties, zoom);
            return { ...feature, properties, geometry: this.geometry.generate(properties, zoom) };
        });
    }

    /**
     * The per-frame zoom pass: the screen-pinned features' geometry, and nothing
     * else. Writes the live source only, never the store.
     * @returns {Promise<void>} Resolves once the source is written
     */
    updateScreenAnchoredGeometry = async () => {
        this.zoomRafId = null;

        // A drag OWNS the source for its duration (the move handler and the
        // handle drag both write it from outside this pass), and a pass landing
        // mid-drag would rewrite what the drag has not committed yet. Stand down
        // and leave the flag up: the end of the drag replays it.
        if (this.isDraggingHandle || this.selectionManager?.uiManager?.isDragging) {
            this.pendingZoomUpdate = false;
            this.missedZoomUpdate = true;
            return;
        }

        // Frames that arrived before this line are covered by the zoom this pass
        // is about to read; only what arrives from here on has to be replayed.
        this.missedZoomUpdate = false;

        try {
            if (!this.map) return;
            const currentZoom = this.map.getZoom();
            await this._sourceQueue(() => this._refreshScreenAnchoredGeometry(currentZoom));
        } catch (error) {
            // Nothing consumes this promise (it is a rAF callback), so a rejection
            // here would be an unhandled one and the correction would freeze in
            // silence. A style swap can remove a source mid-zoom; log and move on.
            console.warn('Error refreshing coordination line zoom geometry:', error);
        } finally {
            this.pendingZoomUpdate = false;
            if (this.missedZoomUpdate && this.map) {
                this.missedZoomUpdate = false;
                this.handleZoomChange();
            }
        }
    }

    /**
     * Rebuild the diamonds of the SCREEN-pinned features, whose size in
     * kilometres changes with every zoom step. A collection with none of them
     * writes nothing at all, which is the common case: the correction is on by
     * default, and a terrain-pinned line keeps both its ground geometry and (via
     * the layer's expression) its drawn width across the whole gesture.
     *
     * @param {number} currentZoom - Zoom to derive sizes for
     * @returns {Promise<void>} Resolves once the source is written
     * @private
     */
    _refreshScreenAnchoredGeometry = async (currentZoom) => {
        const source = this.map?.getSource('coordination_lines');
        if (!source) return;

        const data = await readGeoJSONSourceDataAsync(source);
        // The map can be gone (or restyled) by the time the read resolves.
        if (!this.map || !data?.features?.length) return;

        let hasChanges = false;

        for (const feature of data.features) {
            if (!feature?.properties || !isScreenAnchored(feature.properties)) continue;

            const sizes = computeCoordinationLineZoomSizes(feature.properties, currentZoom);
            if (feature.properties.calculatedSymbolSize === sizes.calculatedSymbolSize
                && feature.properties.calculatedSymbolSpacing === sizes.calculatedSymbolSpacing) {
                continue;
            }

            feature.properties.calculatedSymbolSize = sizes.calculatedSymbolSize;
            feature.properties.calculatedSymbolSpacing = sizes.calculatedSymbolSpacing;
            feature.geometry = this.geometry.generate(feature.properties, currentZoom);
            hasChanges = true;
        }

        if (hasChanges) {
            source.setData(data);
        }
    }

    /**
     * The once-per-gesture pass, on `zoomend`: every feature's derived sizes,
     * plus the geometry of the screen-pinned ones. Writes the live source only,
     * never the store: the derived sizes are recomputed on read, and what
     * persists is the authored pair (`createdAtZoom`, `zoomCorrectionEnabled`).
     *
     * `calculatedLineWidth` no longer feeds the drawing, but the export, the
     * selection box and the feature header still read it, so it is refreshed
     * here rather than dropped.
     *
     * @returns {Promise<void>} Resolves once the source is written
     */
    updateAllCoordinationLineZoomSizes = async () => {
        this.zoomEndRafId = null;

        // Same reason as the per-frame pass: a drag owns the source, so stand
        // down and let the end of the drag replay this.
        if (this.isDraggingHandle || this.selectionManager?.uiManager?.isDragging) {
            this.pendingZoomEndUpdate = false;
            this.missedZoomEndUpdate = true;
            return;
        }

        this.missedZoomEndUpdate = false;

        try {
            if (!this.map) return;
            const currentZoom = this.map.getZoom();
            await this._sourceQueue(() => this._refreshSourceZoomSizes(currentZoom));
        } catch (error) {
            // A rAF callback consumes nobody's promise; see the per-frame pass.
            console.warn('Error refreshing coordination line zoom sizes:', error);
        } finally {
            this.pendingZoomEndUpdate = false;
            if (this.missedZoomEndUpdate && this.map) {
                this.missedZoomEndUpdate = false;
                this.handleZoomEnd();
            }
        }
    }

    /**
     * @param {number} currentZoom - Zoom to derive sizes for
     * @returns {Promise<void>} Resolves once the source is written
     * @private
     */
    _refreshSourceZoomSizes = async (currentZoom) => {
        const source = this.map?.getSource('coordination_lines');
        if (!source) return;

        const data = await readGeoJSONSourceDataAsync(source);
        // The map can be gone (or restyled) by the time the read resolves.
        if (!this.map || !data?.features?.length) return;

        let hasChanges = false;

        for (const feature of data.features) {
            if (!feature?.properties) continue;

            const sizes = computeCoordinationLineZoomSizes(feature.properties, currentZoom);

            if (feature.properties.calculatedLineWidth !== sizes.calculatedLineWidth) {
                feature.properties.calculatedLineWidth = sizes.calculatedLineWidth;
                hasChanges = true;
            }

            // The kilometre pair is only written where it can differ from the
            // authored one; elsewhere it would be a stale copy waiting to be read.
            if (isScreenAnchored(feature.properties)
                && (feature.properties.calculatedSymbolSize !== sizes.calculatedSymbolSize
                    || feature.properties.calculatedSymbolSpacing !== sizes.calculatedSymbolSpacing)) {
                feature.properties.calculatedSymbolSize = sizes.calculatedSymbolSize;
                feature.properties.calculatedSymbolSpacing = sizes.calculatedSymbolSpacing;
                feature.geometry = this.geometry.generate(feature.properties, currentZoom);
                hasChanges = true;
            }
        }

        if (hasChanges) {
            source.setData(data);
        }
    }

    // ========================================================================
    // PROPERTY EDITING AND PERSISTENCE
    // ========================================================================

    /**
     * Write one property across the selected features. Serialized shell.
     * @param {Array} features - Selected features
     * @param {string} property - Property name
     * @param {*} value - New value
     * @returns {Promise<void>} Resolves once the source is written
     */
    updateFeaturesProperty = async (features, property, value) =>
        this._sourceQueue(() => this._updateFeaturesPropertyUnlocked(features, property, value))

    /**
     * @param {Array} features - Selected features
     * @param {string} property - Property name
     * @param {*} value - New value
     * @returns {Promise<void>} Resolves once the source is written
     * @private
     */
    _updateFeaturesPropertyUnlocked = async (features, property, value) => {
        const source = this.map?.getSource('coordination_lines');
        if (!source) return;

        const data = await source.getData();
        const currentZoom = this.getCurrentZoom();

        for (const feature of features) {
            const sourceFeature = data.features.find(f => f.properties.id === feature.properties.id);
            if (!sourceFeature) continue;

            const applied = property === 'createdAtZoom' && Number.isFinite(value)
                ? Math.round(value * 10) / 10
                : value;

            sourceFeature.properties[property] = applied;
            feature.properties[property] = applied;

            // Any input of the zoom model invalidates the derived sizes.
            if (['createdAtZoom', 'zoomCorrectionEnabled', 'lineWidth', 'symbol_size', 'symbol_spacing']
                .includes(property)) {
                const sizes = computeCoordinationLineZoomSizes(sourceFeature.properties, currentZoom);
                Object.assign(sourceFeature.properties, sizes);
                Object.assign(feature.properties, sizes);
            }

            // `createdAtZoom` and `zoomCorrectionEnabled` are geometry inputs too:
            // on a screen-pinned line they move the diamonds' size in kilometres,
            // which only the geometry can express.
            if (['baseCoordinates', 'symbol_code', 'symbol_size', 'symbol_spacing', 'createdAtZoom', 'zoomCorrectionEnabled']
                .includes(property)) {
                const newGeometry = this.geometry.generate(sourceFeature.properties, currentZoom);
                sourceFeature.geometry = newGeometry;
                feature.geometry = newGeometry;
            }
        }

        source.setData(data);
    }

    /**
     * Persist the features whose properties actually changed. Serialized shell.
     * @param {Array} features - Selected features
     * @param {Map} initialPropertiesMap - Properties captured when the panel opened
     * @returns {Promise<void>} Resolves once every change is persisted
     */
    saveFeatures = async (features, initialPropertiesMap) =>
        this._sourceQueue(() => this._saveFeaturesUnlocked(features, initialPropertiesMap))

    /**
     * @param {Array} features - Selected features
     * @param {Map} initialPropertiesMap - Properties captured when the panel opened
     * @returns {Promise<void>} Resolves once every change is persisted
     * @private
     */
    _saveFeaturesUnlocked = async (features, initialPropertiesMap) => {
        const source = this.map?.getSource('coordination_lines');
        if (!source) return;

        const currentData = await source.getData();

        for (const selectedFeature of features) {
            if (!this.hasFeatureChanged(selectedFeature, initialPropertiesMap.get(selectedFeature.properties.id))) {
                continue;
            }
            const currentFeature = currentData.features.find(f =>
                f.properties.id === selectedFeature.properties.id);
            if (currentFeature) {
                await updateFeature('coordination_lines', currentFeature);
            }
        }
    }

    discardChangeFeatures = async (features, initialPropertiesMap) => {
        features.forEach(f => {
            Object.assign(f.properties, initialPropertiesMap.get(f.properties.id));
            f.geometry = this.geometry.generate(f.properties, this.getCurrentZoom());
        });

        // `updateFeatures` is the serialized shell, and this method is NOT itself
        // inside a task, so this is a plain call, not reentrancy.
        await this.updateFeatures(features, true);
    }

    /**
     * Remove the given coordination lines. Serialized shell.
     * @param {Array} features - Features to delete
     * @returns {Promise<void>} Resolves once the source is written
     */
    deleteFeatures = async (features) =>
        this._sourceQueue(() => this._deleteFeaturesUnlocked(features))

    /**
     * @param {Array} features - Features to delete
     * @returns {Promise<void>} Resolves once the source is written
     * @private
     */
    _deleteFeaturesUnlocked = async (features) => {
        if (features.length === 0) return;

        const source = this.map?.getSource('coordination_lines');
        if (!source) return;

        const data = await source.getData();

        for (const feature of features) {
            try {
                const featureId = feature.properties.id;
                await removeFeature('coordination_lines', featureId);
                const idString = String(featureId);
                data.features = data.features.filter(f => String(f.properties.id) !== idString);
            } catch (error) {
                console.error(`Error removing coordination line ${feature.properties.id}:`, error);
            }
        }

        source.setData(data);
    }

    setDefaultProperties = (properties) => {
        const {
            id: _id,
            nome: _nome,
            baseCoordinates: _baseCoordinates,
            // The anchor and everything derived from it belong to ONE feature:
            // inheriting them would make every new coordination line scale from an old zoom.
            createdAtZoom: _createdAtZoom,
            calculatedLineWidth: _calculatedLineWidth,
            calculatedSymbolSize: _calculatedSymbolSize,
            calculatedSymbolSpacing: _calculatedSymbolSpacing,
            ...styleProperties
        } = properties;

        Object.assign(AddCoordinationLineControl.DEFAULT_PROPERTIES, styleProperties);
    }

    hasFeatureChanged = (feature, initialProperties) => {
        if (!initialProperties) return true;

        return (
            feature.properties.color !== initialProperties.color
            || feature.properties.lineWidth !== initialProperties.lineWidth
            || feature.properties.opacity !== initialProperties.opacity
            || feature.properties.symbol_code !== initialProperties.symbol_code
            || feature.properties.symbol_size !== initialProperties.symbol_size
            || feature.properties.symbol_spacing !== initialProperties.symbol_spacing
            || feature.properties.createdAtZoom !== initialProperties.createdAtZoom
            || feature.properties.zoomCorrectionEnabled !== initialProperties.zoomCorrectionEnabled
            || feature.properties.nome !== initialProperties.nome
            || feature.properties.descricao !== initialProperties.descricao
            || feature.properties.visivel !== initialProperties.visivel
            || feature.properties.bloqueado !== initialProperties.bloqueado
            || !deepEqual(feature.properties.baseCoordinates, initialProperties.baseCoordinates)
        );
    }

    /**
     * Replace the given features in the source (and optionally persist them).
     * Serialized shell.
     * @param {Array} features - Features to write
     * @param {boolean} [save] - Also persist through the store
     * @returns {Promise<void>} Resolves once the source is written
     */
    updateFeatures = async (features, save = false) =>
        this._sourceQueue(() => this._updateFeaturesUnlocked(features, save))

    /**
     * @param {Array} features - Features to write
     * @param {boolean} [save] - Also persist through the store
     * @returns {Promise<void>} Resolves once the source is written
     * @private
     */
    _updateFeaturesUnlocked = async (features, save = false) => {
        if (features.length === 0) return;

        const source = this.map?.getSource('coordination_lines');
        if (!source) return;

        const data = await source.getData();

        for (const feature of features) {
            const featureIndex = data.features.findIndex(f => f.properties.id === feature.properties.id);
            if (featureIndex === -1) continue;

            data.features[featureIndex] = feature;
            if (save) {
                await updateFeature('coordination_lines', feature);
            }
        }

        source.setData(data);
        this.updateSelectionManagerFeatures(features);
    }

    /**
     * Write ONE feature's properties and geometry straight into the source.
     * Serialized shell.
     * @param {Object} feature - Feature to write
     * @returns {Promise<void>} Resolves once the source is written
     */
    forceUpdateMainSource = async (feature) =>
        this._sourceQueue(() => this._forceUpdateMainSourceUnlocked(feature))

    /**
     * No drag guard. This tool read the LIVE flag through `selectionManager`,
     * where the other three read a `this.uiManager` a control is never handed,
     * and the measure found the live one had nothing to protect either: a
     * feature drag keeps its position in the selection boxes and writes the
     * geometry only after the flag is down, so the source never holds a partial
     * position. What the live guard did do was drop a forced write outright,
     * with nothing to reapply it. Removed 2026-09-04, measured by
     * tests/unit/force-update-during-drag-military.test.js.
     *
     * @param {Object} feature - Feature to write
     * @returns {Promise<void>} Resolves once the source is written
     * @private
     */
    _forceUpdateMainSourceUnlocked = async (feature) => {
        const source = this.map?.getSource('coordination_lines');
        if (!source) return;

        const data = await source.getData();
        const sourceFeature = data.features.find(f => f.properties.id === feature.properties.id);
        if (sourceFeature) {
            sourceFeature.properties = { ...feature.properties };
            sourceFeature.geometry = { ...feature.geometry };
            source.setData(data);
        }
    }

    // ========================================================================
    // SELECTION MANAGER INTEGRATION
    // ========================================================================

    updateSelectionManagerFeature(feature) {
        this.selectionManager.updateSelectedFeature('coordination_line', feature.properties.id, feature);
    }

    updateSelectionManagerFeatures(features) {
        features.forEach(feature => {
            if (feature.properties.source === 'coordination_line') {
                this.updateSelectionManagerFeature(feature);
            }
        });
    }

    updateUIAfterEdit = () => {
        this.selectionManager.uiManager.updateSelectionHighlight();
        this.selectionManager.uiManager.updatePanels();
        this.selectionManager.updateUI();
    }

    saveFeatureChanges = async (feature) => {
        try {
            await updateFeature('coordination_lines', feature);
        } catch (error) {
            console.error('Error saving coordination line changes:', error);
        }
    }

    // ========================================================================
    // TOUCH HELPERS AND TEARDOWN
    // ========================================================================

    _finishFromTouch = async () => {
        if (!this.isActive || this.drawPoints.length < 2) return;

        getSnappingService()?.hideIndicator(this.map);

        if (this._extending) {
            await this.finishExtending();
            return;
        }

        await this.createFeature();
        this.stopDrawing();
    }

    _undoLastPoint = () => {
        // While continuing, index 0 is the ANCHOR (the endpoint the user clicked
        // the handle on), not a point they drew: undoing past it would detach the
        // continuation from the coordination line.
        const floor = this._extending ? 1 : 0;
        if (!this.isActive || this.drawPoints.length <= floor) return;

        this.drawPoints.pop();

        if (this.drawPoints.length === 0) {
            this.map.off('mousemove', this.handlePreviewMouseMove);
            this.map.on('mousemove', this._onPreClickMouseMove);
            this.clearPreview();
        }

        if (this._finishButton) {
            this._finishButton.updateState(this.drawPoints.length, 2);
        }
    }

    cancelPendingUpdates = () => {
        // Both gates: the drawing/drag preview and the pre-click indicator.
        this._previewScheduler.cancel();
        this._preClickScheduler.cancel();
        this.lastPreviewPosition = null;
        this.lastPreviewPoints = null;
        this.activeHandleType = null;
        this.activeHandleIndex = null;
    }

    removeAllEventListeners = () => {
        if (!this.map) return;
        hideExtensionHandles(this.map);
        this.map.getCanvas().removeEventListener('contextmenu', this.handleRightClick);
        this.map.off('mousemove', this._onPreClickMouseMove);
        this.map.off('mousemove', this.handlePreviewMouseMove);
        this.removeEditEventListeners();
        this.removeHoverListeners();
        this.removeEditRightClickListener();
        this.cancelPendingUpdates();
    }

    /**
     * The diamond ceiling, so the panel can name it without importing the model.
     * @returns {number} Maximum diamonds per feature
     */
    get maxGlyphs() {
        return COORDINATION_LINE_ZOOM_LIMITS.MAX_GLYPHS;
    }
}

export default AddCoordinationLineControl;

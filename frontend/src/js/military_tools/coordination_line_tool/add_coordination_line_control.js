// Path: js/military_tools/coordination_line_tool/add_coordination_line_control.js

import {
    addFeature,
    updateFeature,
    removeFeature,
    getActiveLayerIdSync,
    getFeatureById,
    getStateManager,
} from '@store';
import { IDUtils, deepClone, deepEqual, createSerialQueue, showToast, showWarning } from '@utils';
import { getPointerPosition, isTouchDevice } from '@utils/pointer-utils';
import { BaseControl } from '@tools';
import { DrawingFinishButton } from '@js/draw_tools/drawing-touch-helpers';
import { getSnappingService } from '@js/snapping/snapping.service.js';
import { getGeoJsonDispatcher, destroyGeoJsonDispatcher } from '@layers/geojson-dispatcher.js';
import {
    anchorFor,
    buildExtendedProperties,
    extendCoordinates,
    previewCoordinates,
    resolveEndpoints,
    storedSpineMatches,
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
} from '@tools/helpers/coordination-line-zoom.model.js';

/**
 * The dispatcher that owns the `coordination_lines` source.
 *
 * EVERY write to `coordination_lines` made in this file goes through it. The reason is not
 * style: a raw `source.setData()` issued while a diff is queued replaces MapLibre's
 * pending-update slot and the diff disappears with no error at all.
 *
 * Each public method here also awaits `flush()` before it returns. Two reasons, and the
 * second is the one that matters:
 * - the deferred write would otherwise land one animation frame after the caller resumed;
 * - `coordination_lines` has co-writers outside this file (the linear conversion in
 *   `tool_manager/helpers/linear-conversion.helpers.js`, plus the generic by-storageType
 *   writers: attribute table, features tab, import, clipboard, multi-selection actions,
 *   context menu, phone layout). Draining inside the awaited method keeps the queue empty
 *   between gestures, so no co-writer can read a collection that is missing what this tool
 *   just wrote.
 *
 * THE TWO SOURCES THIS DOES NOT OWN keep their plain `setData`: `coordination-line-feedback`
 * and `coordination-line-edit-handles` are ephemeral, rebuilt whole on every mousemove, a
 * handful of features with no stable `properties.id`, so they are declared without
 * `promoteId` and are not diffable at all. A dropped frame there is a stuttering rubber band.
 *
 * @param {Object} map - MapLibre map instance
 * @returns {Object} dispatcher owning the `coordination_lines` source
 */
function coordinationLinesSource(map) {
    return getGeoJsonDispatcher(map, 'coordination_lines');
}

/**
 * Coordination Line control: the five MD33 linear symbols, chosen from a combo box
 * (290100, 290199, 290302, 290303 and 290307). See coordination_line_catalog.js.
 *
 * A polyline carrying a glyph repeated at a regular spacing. Modelled on the boundary tool,
 * which is the other military line with a repeating symbol and a zoom anchor, minus
 * everything the boundary needs for its labels and echelon circles: this tool draws into ONE
 * source, so it has no dependent features to rebuild, no sibling sources to keep in step, and
 * no restore hook.
 */
class AddCoordinationLineControl extends BaseControl {
    featureType = 'coordination_line';

    /**
     * Sizes a freshly drawn coordination line is born with.
     *
     * The glyph is sized from the zoom so that a line drawn at any scale looks the same on
     * screen, exactly as the boundary sizes its echelon. The spacing follows the size, which
     * keeps the gap fraction at 1/3, safely under the model's 0.5 ceiling.
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
        // Zoom anchor: ONE switch for the whole feature. On (the default), the stroke scales
        // 2x per zoom level from `createdAtZoom` and the glyphs keep their ground size, so
        // everything stays glued to the TERRAIN; off, the stroke stays put and the glyphs
        // shrink in kilometres instead, so everything stays glued to the SCREEN. See
        // tool_manager/helpers/coordination-line-zoom.model.js.
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

        // Every read-modify-write of `coordination_lines` goes through this queue. The
        // dispatcher above coalesces the WRITES, but not the READS that precede them:
        // `getData()` is a round trip to the worker, so two overlapping cycles both read the
        // pre-mutation clone, and since `add` is a total replacement in MapLibre the second
        // upsert would silently discard the first one's property change. The zoom pass, a
        // panel edit and a paste can all land in the same frame, so one source is enough to
        // need it. Public methods below are the serialized shells; the `_xxxUnlocked` bodies
        // are what runs inside a task, and they call only each other (calling a shell from
        // inside a task waits for the task itself: it deadlocks).
        this._sourceQueue = createSerialQueue();

        this.previewRafId = null;
        this.pendingPreviewUpdate = false;
        this.zoomRafId = null;
        // `pendingZoomUpdate` is held for the whole (async) pass so the frames of a zoom
        // gesture cannot stack; `missedZoomUpdate` records the frames that arrive meanwhile,
        // so the last zoom of the gesture is replayed, not lost.
        this.pendingZoomUpdate = false;
        this.missedZoomUpdate = false;
        this.lastPreviewPosition = null;
        this.lastPreviewPoints = null;
        this.geometryDebounceTimer = null;

        this.clickTimer = null;
        this.lastClickCoords = null;
        this._finishButton = null;
        this._name = 'AddCoordinationLineControl';

        // Continuation session, set while the user is extending an existing coordination line
        // from one of its ends. See startExtending / finishExtending.
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
     * Glyph size for a coordination line born at a given zoom.
     * @param {number} zoom - Current map zoom level
     * @returns {number} Glyph size in kilometres
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
     * Spacing that goes with a given glyph size.
     * @param {number} sizeKm - Glyph size in kilometres
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
        if (this.zoomRafId) {
            cancelAnimationFrame(this.zoomRafId);
            this.zoomRafId = null;
        }
        this.pendingZoomUpdate = false;
        this.missedZoomUpdate = false;
        this.deactivate();
        this.removeAllEventListeners();
        // Releases the queue, its settle timers and the two map listeners the dispatcher opens
        // per dispatch. Dropping a batch here cannot lose a line: the store write always
        // precedes the source write, so the redraw that follows a style switch repopulates
        // `coordination_lines` from persistence.
        destroyGeoJsonDispatcher(this.map, 'coordination_lines');
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
     * Named against `tactical.layers.js` on purpose: the boundary tool returns an id that no
     * layer carries, which nothing reads today but would mislead the first caller that did.
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

        // THE DERIVED SIZES ARE RECOMPUTED, not carried over: the pasted copy carries the
        // values cached at the zoom it was COPIED at, and `calculatedLineWidth` is what the
        // layer reads. `withCoordinationLineZoomSizes` is a pure recompute from the authored
        // pair, so it is idempotent and cannot invent a size the zoom pass would not.
        const properties = withCoordinationLineZoomSizes(
            { ...feature.properties, baseCoordinates: newCoords },
            this.getCurrentZoom(),
        );

        return {
            ...feature,
            properties,
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

        // Same recompute as `prepareForPaste`, and for the same reason: the move handler hands
        // back its OWN copy of the feature, derived values and all. A drag does not change the
        // zoom, so this is normally a no-op; it stops being one when the copy the handler
        // holds predates a zoom pass.
        const properties = withCoordinationLineZoomSizes(
            { ...feature.properties, baseCoordinates: newBaseCoords },
            this.getCurrentZoom(),
        );

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
        this.lastClickCoords = null;
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
        // Dropped FIRST: Esc and switching tools both land here, and a continuation writes
        // nothing before it is committed, so forgetting the session leaves the original
        // coordination line untouched by construction. The 250 ms click timer is cleared
        // further down, by clearPreview -> cancelPendingUpdates.
        this._extending = null;
        this.isActive = false;
        this.map.off('mousemove', this._onPreClickMouseMove);
        this.map.off('mousemove', this.handlePreviewMouseMove);
        this.drawPoints = [];
        this.lastClickCoords = null;
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

    /** Snap indicator before the first click, when there is nothing to preview yet. */
    _onPreClickMouseMove = (e) => {
        const snapping = getSnappingService();
        const snap = snapping?.resolve(this.map, e.point, e.lngLat);
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
        // While continuing, exclude the feature itself: its own vertices would otherwise
        // capture every click, exactly as they do for a handle drag.
        const snap = snapping?.resolve(this.map, e.point, e.lngLat, this._extending?.featureId) ?? e.lngLat;
        const newPoint = [snap.lng, snap.lat];

        if (this.geometry.isPointTooClose(newPoint, this.drawPoints)) return;

        // A click that lands while an earlier one is still pending, inside the 250 ms window
        // below, used to REPLACE it: the timer was cleared and re-armed with the new
        // coordinates, so two quick clicks at different spots kept only the second vertex,
        // silently. Measured in real Chromium on 2026-09-03: 100 ms apart, one vertex; 400 ms
        // apart, two. A pending point far from the new one is a vertex the user drew, so it
        // is committed now; only a repeat click on the same spot keeps re-arming the timer.
        if (this.lastClickCoords && !this.geometry.isPointTooClose(newPoint, [this.lastClickCoords])) {
            clearTimeout(this.clickTimer);
            this._commitPendingClick();
        }

        this.lastClickCoords = newPoint;
        clearTimeout(this.clickTimer);
        this.clickTimer = setTimeout(() => this._commitPendingClick(), 250);
    }

    /**
     * Moves the pending click (the one the 250 ms timer is holding) into `drawPoints`.
     * Shared by the timer, by the next distinct click and by the right-click that finishes.
     * @private
     */
    _commitPendingClick = () => {
        if (!this.lastClickCoords) return;
        this.drawPoints.push(this.lastClickCoords);
        this.lastClickCoords = null;

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

        clearTimeout(this.clickTimer);
        this.clickTimer = null;
        // The pending left click is a vertex, not noise: a right-click within 250 ms of it
        // used to discard it and finish with the point under the cursor instead.
        this._commitPendingClick();

        const screenPoint = { x: e.offsetX, y: e.offsetY };
        const coordinates = this.map.unproject([screenPoint.x, screenPoint.y]);
        const snapping = getSnappingService();
        const snap = snapping?.resolve(this.map, screenPoint, coordinates, this._extending?.featureId) ?? coordinates;
        snapping?.hideIndicator(this.map);
        const finalPoint = [snap.lng, snap.lat];

        if (!this.geometry.isPointTooClose(finalPoint, this.drawPoints)) {
            this.drawPoints.push(finalPoint);
        }

        // AFTER the push of the point under the cursor, which is how this tool already
        // finishes a drawing. The `return` skips `stopDrawing()`: `finishExtending`
        // deactivates the tool, and `deactivate()` already does everything it would.
        if (this._extending) {
            await this.finishExtending();
            return;
        }

        if (this.drawPoints.length >= 2) {
            await this.createFeature();
        }

        this.stopDrawing();
    }

    handlePreviewMouseMove = (e) => {
        if (this.drawPoints.length < 1) return;

        const snapping = getSnappingService();
        // While continuing, exclude the feature itself: its own vertices would otherwise
        // capture every click, exactly as they do for a handle drag.
        const snap = snapping?.resolve(this.map, e.point, e.lngLat, this._extending?.featureId) ?? e.lngLat;

        if (snap.snapped) {
            snapping.showIndicator(this.map, snap, snap.snapType);
        } else {
            snapping?.hideIndicator(this.map);
        }

        this.lastPreviewPoints = [...this.drawPoints];
        this.lastPreviewPosition = [snap.lng, snap.lat];

        if (!this.pendingPreviewUpdate) {
            this.pendingPreviewUpdate = true;
            this.previewRafId = requestAnimationFrame(this.performPreviewUpdate);
        }
    }

    performPreviewUpdate = () => {
        if (!this.lastPreviewPosition) {
            this.pendingPreviewUpdate = false;
            return;
        }

        if (this.isDraggingHandle && this.getSelectedFeature() && this.activeHandleType) {
            this.updateCoordinationLinePreview(this.lastPreviewPosition);
        } else if (this._extending) {
            this._updateExtensionPreview();
        } else if (this.lastPreviewPoints && this.lastPreviewPoints.length >= 1) {
            const previewPoints = [...this.lastPreviewPoints];
            if (this.lastClickCoords) previewPoints.push(this.lastClickCoords);
            previewPoints.push(this.lastPreviewPosition);

            clearTimeout(this.geometryDebounceTimer);
            this.geometryDebounceTimer = setTimeout(() => {
                const currentZoom = this.map.getZoom();
                const previewSize = this.calculateSymbolSizeForZoom(currentZoom);

                // Derive the sizes instead of inheriting the defaults': the shared
                // DEFAULT_PROPERTIES carries derived values belonging to another size, and
                // the preview overrides only the authored pair.
                const previewProperties = withCoordinationLineZoomSizes({
                    ...AddCoordinationLineControl.DEFAULT_PROPERTIES,
                    symbol_size: previewSize,
                    symbol_spacing: this.calculateSpacingForSize(previewSize),
                    createdAtZoom: Math.round(currentZoom * 10) / 10,
                    baseCoordinates: previewPoints,
                }, currentZoom);

                this.showPreview(this.geometry.generate(previewProperties, currentZoom));
            }, 8);
        }

        this.pendingPreviewUpdate = false;
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
        this.lastClickCoords = null;
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

        // At creation the factor is 1 by construction; computing it anyway keeps the derived
        // properties written in one place only.
        Object.assign(properties, computeCoordinationLineZoomSizes(properties, currentZoom));

        const geometry = this.geometry.generate(properties, currentZoom);

        if (!geometry || !geometry.coordinates) {
            console.error('Failed to generate valid geometry for coordination line');
            return;
        }

        const feature = { type: 'Feature', id: geoJsonId, properties, geometry };

        try {
            await addFeature('coordination_lines', feature);

            const dispatcher = coordinationLinesSource(this.map);
            dispatcher.add(feature);
            await dispatcher.flush();

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
     * Called by the continuation buttons that `showExtensionHandles` draws on the two
     * endpoints of the selected feature.
     * @param {Object} feature - The coordination line to continue
     * @param {string} end - Which end, `'start'` or `'end'`
     */
    startExtending = (feature, end) => {
        // Asked again here, not only when the handle was drawn: a peer can lock the map while
        // the handle sits on screen, and this is where the state gets to name itself.
        const reason = extensionDenialReason(feature);
        if (reason) {
            showWarning(reason);
            return;
        }

        // The same tool already active means a drawing is in progress. Seeding the anchor
        // below overwrites `drawPoints`, so without this the gesture would discard that work
        // in silence. Length 1 is the anchor of a continuation already open (a double click on
        // the handle), which is safe to re-seed.
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

        // `activate()` armed the pre-click snap indicator, which the drawing preview normally
        // replaces on the FIRST click. Here that click already happened (on the handle), so
        // the swap is done by hand.
        this.map.off('mousemove', this._onPreClickMouseMove);
        this.map.off('mousemove', this.handlePreviewMouseMove);
        this.map.on('mousemove', this.handlePreviewMouseMove);
        this.map.getCanvas().style.cursor = 'crosshair';
        this._finishButton?.updateState(this.drawPoints.length, 2);

        showToast('Clique no mapa para continuar a linha de coordenação. Botão direito para concluir.', 'info');
    }

    /**
     * Draw the WHOLE feature (existing spine plus what is being added) while the cursor
     * moves, instead of only the new segment.
     * @private
     */
    _updateExtensionPreview = () => {
        const session = this._extending;
        if (!session) return;

        // The 250 ms click timer means a just-clicked vertex can still be pending in
        // `lastClickCoords` instead of in `drawPoints`; without it the preview drops back a
        // vertex for a quarter of a second after every click.
        const pending = this.drawPoints.slice(1);
        if (this.lastClickCoords) {
            pending.push(this.lastClickCoords);
        }

        const coordinates = previewCoordinates(
            session.existing,
            pending,
            this.lastPreviewPosition,
            session.end,
        );
        if (coordinates.length < 2) return;

        // The FEATURE's own properties, never the tool defaults: the glyph size and spacing
        // carve the gaps, so defaults would preview a symbol the feature does not have.
        const properties = buildExtendedProperties(session.sourceFeature, coordinates);

        clearTimeout(this.geometryDebounceTimer);
        this.geometryDebounceTimer = setTimeout(() => {
            const previewGeometry = this.geometry.generate(properties, this.getCurrentZoom());
            if (previewGeometry) {
                this.showPreview(previewGeometry);
            }
        }, 8);
    }

    /**
     * Commit the continuation: ONE `updateFeature` on the SAME feature, so the id, the name
     * and every style survive and a single Ctrl+Z undoes it.
     *
     * `createdAtZoom` and `zoomCorrectionEnabled` are carried over untouched (re-stamping them
     * would resize the whole feature under the user) and the `calculated*` cache is left to
     * the zoom pass that owns it.
     *
     * The glyphs need no remapping, unlike the boundary's echelon: they are placed by an
     * absolute spacing in kilometres, not by a ratio of the total length, so a longer line
     * simply carries more of them at the same spacing, and the ones already drawn do not move.
     *
     * THE ORDER OF WRITES IS THE CONTRACT, and it is the reverse of the other edit paths in
     * this file: gate BEFORE any write, then the store, then a RE-READ, and only a re-read
     * that carries the new spine authorizes touching the source. `updateFeature` returns
     * `undefined` on every path, success included, so the re-read is the only confirmation
     * there is; painting first would leave the screen showing a continuation nothing
     * persisted. That is also why there is no restore branch here: nothing was painted.
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

        const reason = extensionDenialReason(session.sourceFeature);
        if (reason) {
            showWarning(reason);
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

            // `updateFeature` directly, not `saveFeatureChanges`: that helper swallows its own
            // errors, so a failure would reach the re-read below dressed as a refusal.
            await updateFeature('coordination_lines', updatedFeature);

            const stored = await getFeatureById('coordination_lines', session.featureId);
            if (!storedSpineMatches(stored, coordinates)) {
                // Refused (rank, lock, or a feature that is no longer there). The source was
                // never touched, so nothing has to be undone.
                this.toolManager.deactivateCurrentTool();
                await this.selectionManager.selectFeature(
                    'coordination_line', session.featureId, session.sourceFeature,
                );
                this.updateUIAfterEdit();
                return;
            }

            await this.forceUpdateMainSource(stored);

            this.toolManager.deactivateCurrentTool();

            await this.selectionManager.selectFeature('coordination_line', session.featureId, stored);
            this.updateUIAfterEdit();
        } catch (error) {
            console.error('Error continuing coordination line:', error);
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

        // The continuation buttons ride with the vertex handles: every path that moves a
        // vertex (drag, move, insert, remove, property change) ends here, and this is also
        // what keeps them out of a locked map, where `selectFeature` returns before this.
        showExtensionHandles(this.map, feature, this);
    }

    clearEditHandles = () => {
        // Mirror of createEditHandles: whoever tears down the vertex circles tears down the
        // continuation buttons with them.
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

    _onEditPointerMove(e) {
        if (!e.isPrimary) return;

        const selectedFeature = this.getSelectedFeature();
        if (!this.isDraggingHandle || !selectedFeature) return;

        const canvas = this.map.getCanvasContainer();
        const point = getPointerPosition(e, canvas);
        const lngLat = this.map.unproject([point.x, point.y]);

        const snapping = getSnappingService();
        // Exclude the feature itself: its own vertices would otherwise capture every move of
        // one of its own handles.
        const snap = snapping?.resolve(this.map, point, lngLat, selectedFeature.properties?.id) ?? lngLat;

        if (snap.snapped) {
            snapping.showIndicator(this.map, snap, snap.snapType);
        } else {
            snapping?.hideIndicator(this.map);
        }

        this.lastPreviewPosition = [snap.lng, snap.lat];

        if (!this.pendingPreviewUpdate) {
            this.pendingPreviewUpdate = true;
            this.previewRafId = requestAnimationFrame(this.performPreviewUpdate);
        }
    }

    _onEditPointerUp = async (_e) => {
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

        // The zoom pass steps aside while a handle is being dragged; replay the zoom it
        // skipped now that the source is ours again.
        this.replayMissedZoomUpdate();
    }

    updateCoordinationLinePreview = (newPosition) => {
        const selectedFeature = this.getSelectedFeature();
        if (!selectedFeature || !this.activeHandleType) return;

        clearTimeout(this.geometryDebounceTimer);
        this.geometryDebounceTimer = setTimeout(() => {
            const currentHandleType = this.activeHandleType;
            const currentHandleIndex = this.activeHandleIndex;
            const currentFeature = this.getSelectedFeature();
            if (!currentHandleType || !currentFeature) return;

            const result = this.geometry.updateFromHandle(
                currentHandleType,
                newPosition,
                currentFeature,
                currentHandleIndex,
                this.getCurrentZoom(),
            );

            if (result) {
                this.showEditPreview(result.geometry, result.properties);
            }
        }, 8);
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

        const features = this.map.queryRenderedFeatures(e.point);

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

    setupZoomListener = () => {
        this.map.on('zoom', this.handleZoomChange);
    }

    handleZoomChange = () => {
        // `pendingZoomUpdate` stays true for the WHOLE pass, not just until it starts: the
        // pass is async (a `getData` read, and a geometry rebuild for the screen-pinned
        // features), so clearing it early would let every frame of a zoom gesture stack
        // another pass, and the one that started at the OLD zoom could finish last and write
        // stale sizes.
        if (this.pendingZoomUpdate) {
            this.missedZoomUpdate = true;
            return;
        }

        this.pendingZoomUpdate = true;
        this.zoomRafId = requestAnimationFrame(this.updateAllCoordinationLineZoomSizes);
    }

    replayMissedZoomUpdate = () => {
        if (this.missedZoomUpdate && this.map) {
            this.handleZoomChange();
        }
    }

    getCurrentZoom = () => (this.map ? this.map.getZoom() : NaN)

    /**
     * Whether a feature drag owns the screen right now.
     *
     * READ FROM THE STATE MANAGER, which is where the flag actually lives (`ui.isDragging`,
     * written by `tool_manager/move_handler.js` and by `ui_manager.js`). A control is never
     * handed a `uiManager` of its own, so `this.uiManager?.isDragging` is a guard that never
     * fires; `selectionManager.uiManager` would work, but it is assigned after construction,
     * so it is one more thing that can be absent.
     *
     * Best-effort: no services container means no drag either.
     * @returns {boolean} True while a drag is in progress
     * @private
     */
    _isDragging() {
        try {
            return getStateManager().getUnsafe('ui.isDragging') || false;
        } catch (_e) {
            return false;
        }
    }

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
     * Used on map load, before the source is first written. Unlike the per-frame pass, this
     * rebuilds the geometry of EVERY feature and not only the screen-pinned ones: a feature
     * pinned to the screen and reopened at another zoom would otherwise draw at the wrong
     * scale, and one saved before the glyph cap existed may carry a geometry the cap would now
     * refuse.
     *
     * The stand-in that `tool-registry.js` registers before this control loads answers the
     * same call with the NUMBERS only (it has no geometry and no Turf); the geometry catches
     * up on the first zoom event after the real control arrives.
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
     * The per-frame zoom pass. Writes the live source only, never the store: the derived
     * sizes are recomputed on read, and what persists is the authored pair (`createdAtZoom`,
     * `zoomCorrectionEnabled`).
     * @returns {Promise<void>} Resolves once the source is written
     */
    updateAllCoordinationLineZoomSizes = async () => {
        this.zoomRafId = null;

        // A drag OWNS the source for its duration (the move handler and the handle drag both
        // write it from outside this pass), and a pass landing mid-drag would rewrite what the
        // drag has not committed yet. Stand down and leave the flag up: the end of the drag
        // replays it.
        if (this.isDraggingHandle || this._isDragging()) {
            this.pendingZoomUpdate = false;
            this.missedZoomUpdate = true;
            return;
        }

        // Frames that arrived before this line are covered by the zoom this pass is about to
        // read; only what arrives from here on has to be replayed.
        this.missedZoomUpdate = false;

        try {
            if (!this.map) return;
            const currentZoom = this.map.getZoom();
            await this._sourceQueue(() => this._refreshSourceZoomSizes(currentZoom));
        } catch (error) {
            // Nothing consumes this promise (it is a rAF callback), so a rejection here would
            // be an unhandled one and the correction would freeze in silence. A style swap can
            // remove a source mid-zoom; log and move on.
            console.warn('Error refreshing coordination line zoom sizes:', error);
        } finally {
            this.pendingZoomUpdate = false;
            if (this.missedZoomUpdate && this.map) {
                this.missedZoomUpdate = false;
                this.handleZoomChange();
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

        // The read is what decides whether there IS a change, so the queue has to be drained
        // before the collection comes back.
        const dispatcher = coordinationLinesSource(this.map);
        await dispatcher.flush();
        const data = await source.getData();
        // The map can be gone (or restyled) by the time the read resolves.
        if (!this.map || !data?.features?.length) return;

        const upserts = [];

        for (const feature of data.features) {
            if (!feature?.properties) continue;

            const sizes = computeCoordinationLineZoomSizes(feature.properties, currentZoom);
            let changed = false;

            if (feature.properties.calculatedLineWidth !== sizes.calculatedLineWidth) {
                feature.properties.calculatedLineWidth = sizes.calculatedLineWidth;
                changed = true;
            }

            // The kilometre pair is only written where it can differ from the authored one;
            // elsewhere it would be a stale copy waiting to be read.
            if (isScreenAnchored(feature.properties)
                && (feature.properties.calculatedSymbolSize !== sizes.calculatedSymbolSize
                    || feature.properties.calculatedSymbolSpacing !== sizes.calculatedSymbolSpacing)) {
                feature.properties.calculatedSymbolSize = sizes.calculatedSymbolSize;
                feature.properties.calculatedSymbolSpacing = sizes.calculatedSymbolSpacing;
                feature.geometry = this.geometry.generate(feature.properties, currentZoom);
                changed = true;
            }

            if (changed) upserts.push(feature);
        }

        // An upsert of only what moved, never the whole collection: on a map with no anchored
        // line the pass costs the read and nothing else.
        if (upserts.length > 0) {
            dispatcher.add(upserts);
            await dispatcher.flush();
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

        // The collection read survives here on purpose. Two things below need the PREVIOUS
        // source feature and no diff hands them back: whether the feature exists at all (an
        // unknown id must be skipped, not created, which is what `add` would do) and its full
        // property set, which `geometry.generate` consumes. Draining first keeps that read
        // from being stale.
        const dispatcher = coordinationLinesSource(this.map);
        await dispatcher.flush();
        const data = await source.getData();
        const currentZoom = this.getCurrentZoom();
        const upserts = [];

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

            // `createdAtZoom` and `zoomCorrectionEnabled` are geometry inputs too: on a
            // screen-pinned line they move the glyphs' size in kilometres, which only the
            // geometry can express.
            if (['baseCoordinates', 'symbol_code', 'symbol_size', 'symbol_spacing', 'createdAtZoom', 'zoomCorrectionEnabled']
                .includes(property)) {
                const newGeometry = this.geometry.generate(sourceFeature.properties, currentZoom);
                sourceFeature.geometry = newGeometry;
                feature.geometry = newGeometry;
            }

            upserts.push(sourceFeature);
        }

        // An upsert, not a property patch: a change to `baseCoordinates` and friends also
        // rewrites the geometry, and `add` is a total replacement in MapLibre, which is what
        // the whole-collection write did to this entry, minus the other N-1.
        if (upserts.length > 0) {
            dispatcher.add(upserts);
            await dispatcher.flush();
        }
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

        // Reads only, and it persists the SOURCE's version of each feature rather than the
        // selected one, so the queue has to be drained before the collection comes back.
        await coordinationLinesSource(this.map).flush();
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

        // `updateFeatures` is the serialized shell, and this method is NOT itself inside a
        // task, so this is a plain call, not reentrancy.
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
        if (!this.map?.getSource('coordination_lines')) return;

        const removed = [];

        for (const feature of features) {
            try {
                await removeFeature('coordination_lines', feature.properties.id);
                removed.push(feature.properties.id);
            } catch (error) {
                console.error(`Error removing coordination line ${feature.properties.id}:`, error);
            }
        }

        if (removed.length === 0) return;

        // Removal by promoted key, with no collection read. The keys go in raw, never coerced:
        // MapLibre keyed the feature by the very value that sits in `properties.id`, so a
        // `String()` around it would miss a numeric key instead of protecting anything.
        const dispatcher = coordinationLinesSource(this.map);
        dispatcher.remove(removed);
        await dispatcher.flush();
    }

    setDefaultProperties = (properties) => {
        const {
            id: _id,
            nome: _nome,
            baseCoordinates: _baseCoordinates,
            // The anchor and everything derived from it belong to ONE feature: inheriting them
            // would make every new coordination line scale from an old zoom.
            createdAtZoom: _createdAtZoom,
            calculatedLineWidth: _calculatedLineWidth,
            calculatedSymbolSize: _calculatedSymbolSize,
            calculatedSymbolSpacing: _calculatedSymbolSpacing,
            ...styleProperties
        } = properties;

        Object.assign(AddCoordinationLineControl.DEFAULT_PROPERTIES, styleProperties);
    }

    // The three `calculated*` properties are DELIBERATELY absent from the comparison below.
    // They are a cache the zoom pass rewrites on every frame of a zoom gesture, so counting
    // them as a change would enqueue an outbound sync operation per line per frame. The peer
    // recomputes them on arrival.
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

        // The collection read survives here too, and only for the existence check: an unknown
        // id must be skipped rather than created, which is what `add` would do.
        const dispatcher = coordinationLinesSource(this.map);
        await dispatcher.flush();
        const data = await source.getData();
        const upserts = [];

        for (const feature of features) {
            const featureIndex = data.features.findIndex(f => f.properties.id === feature.properties.id);
            if (featureIndex === -1) continue;

            // The incoming feature is COMPLETE, so it ships as an upsert.
            upserts.push(feature);
            if (save) {
                await updateFeature('coordination_lines', feature);
            }
        }

        if (upserts.length > 0) {
            dispatcher.add(upserts);
            await dispatcher.flush();
        }

        this.updateSelectionManagerFeatures(features);
    }

    /**
     * Writes ONE edited coordination line back into the source, unless a drag owns the screen.
     *
     * The read is kept, and only for the existence check: this is called from the handle-drag
     * and vertex-removal paths with a feature derived from the SELECTION, and `add` would
     * CREATE an id the source no longer has instead of the silent skip.
     *
     * IT IS THE ONE WRITER THAT STAYS OUT OF `_sourceQueue`, and that is a decision, not an
     * omission: it touches `coordination_lines` and nothing else, and that source is the
     * dispatcher's, which already coalesces concurrent writes into one diff. Putting it in the
     * queue would only make a handle drag wait behind a zoom pass it does not conflict with.
     * @param {Object} feature - Edited coordination line feature
     * @returns {Promise<void>} Resolves once the source is written
     */
    forceUpdateMainSource = async (feature) => {
        if (this._isDragging()) return;

        const source = this.map?.getSource('coordination_lines');
        if (!source) return;

        const dispatcher = coordinationLinesSource(this.map);
        await dispatcher.flush();
        const data = await source.getData();
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

        clearTimeout(this.clickTimer);
        this.clickTimer = null;
        this.lastClickCoords = null;

        getSnappingService()?.hideIndicator(this.map);

        if (this._extending) {
            await this.finishExtending();
            return;
        }

        await this.createFeature();
        this.stopDrawing();
    }

    _undoLastPoint = () => {
        // While continuing, index 0 is the ANCHOR (the endpoint the user clicked the handle
        // on), not a point they drew: undoing past it would detach the continuation from the
        // coordination line.
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
     * The glyph ceiling, so the panel can name it without importing the model.
     * @returns {number} Maximum glyphs per feature
     */
    get maxGlyphs() {
        return COORDINATION_LINE_ZOOM_LIMITS.MAX_GLYPHS;
    }
}

export default AddCoordinationLineControl;

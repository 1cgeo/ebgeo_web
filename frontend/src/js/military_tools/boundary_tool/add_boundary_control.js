// Path: js/military_tools/boundary_tool/add_boundary_control.js

import {
    addFeature,
    updateFeature,
    removeFeature,
    getActiveLayerIdSync,
    getFeatureById,
    getStateManager,
} from '../../store';
import { IDUtils, deepClone, deepEqual, createSerialQueue, showToast, showWarning } from '../../utilities';
import { getPointerPosition, isTouchDevice } from '../../utilities/pointer-utils';
import { addBoundaryAttributesToPanel } from './boundary_attributes_panel.js';
import AddBoundaryGeometry from './add_boundary_geometry.js';
import {
    computeBoundaryZoomSizes,
    withBoundaryZoomSizes,
    isScreenAnchored,
} from '@tools/helpers/boundary-zoom.model.js';
import { BaseControl } from '../../tool_manager';
import { createPreviewScheduler } from '@tools/helpers/preview-scheduler.js';
import { DrawingFinishButton } from '../../draw_tools/drawing-touch-helpers';
import { getSnappingService } from '../../snapping/snapping.service.js';
import { getGeoJsonDispatcher, destroyGeoJsonDispatcher } from '@layers/geojson-dispatcher.js';
import {
    anchorFor,
    buildExtendedProperties,
    extendCoordinates,
    previewCoordinates,
    resolveEndpoints,
    storedSpineMatches
} from '@tools/helpers/line-extension.model.js';
import {
    extensionDenialReason,
    hideExtensionHandles,
    showExtensionHandles
} from '@tools/helpers/line-extension.helpers.js';

/**
 * The dispatcher that owns the `boundarys` source.
 *
 * EVERY write to `boundarys` made in this file goes through it. The reason is not style: a raw
 * `source.setData()` issued while a diff is queued replaces MapLibre's pending-update slot and the
 * diff disappears with no error at all.
 *
 * Each public method here also awaits `flush()` before it returns. Two reasons, and the second is
 * the one that matters:
 * - the deferred write would otherwise land one animation frame after the caller resumed;
 * - `boundarys` still has co-writers outside this file (the line-to-boundary conversion in
 *   `tool_manager/helpers/feature-header.helpers.js`, plus the generic by-storageType writers:
 *   attribute table, features tab, import, clipboard, multi-selection actions, context menu, phone
 *   layout), and they all do read-modify-write with a raw `setData`. Draining inside the awaited
 *   method keeps the queue empty between gestures, so no co-writer can read a collection that is
 *   missing what this tool just wrote.
 *
 * THE THREE SOURCES THIS DOES NOT OWN, and why each one keeps its plain `setData`:
 * - `boundary-feedback` and `boundary-edit-handles` are ephemeral: rebuilt whole on every
 *   mousemove, a handful of features with no stable `properties.id`, so they are declared without
 *   `promoteId` and are not diffable at all. A dropped frame there is a stuttering rubber band.
 * - `boundary-circles` and `boundary-texts` are BLOCKED, not merely skipped. Their derived features
 *   carry a stable TOP-LEVEL id (`<paiId>-circle-<i>-<j>`) but `properties` WITHOUT any `id`, so a
 *   `promoteId: 'id'` would resolve every key to null and leave the source permanently
 *   non-diffable. Enabling them means writing `properties.id` in `add_boundary_geometry.js` first,
 *   which is a separate change. The declaration side of this is recorded in
 *   `layers/styles/layer.helpers.js`. Because they keep the raw
 *   `getData -> mutate -> setData` cycle, THEY are what `this._sourceQueue` serializes; see the
 *   constructor.
 * @param {Object} map - MapLibre map instance
 * @returns {Object} dispatcher owning the `boundarys` source
 */
function boundarysSource(map) {
    return getGeoJsonDispatcher(map, 'boundarys');
}

/**
 * Boundary Tool Control
 * Manages drawing, editing, and interaction for boundary line features with echelon symbols
 */
class AddBoundaryControl extends BaseControl {
    featureType = 'boundary';
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

        // Every read-modify-write of `boundary-texts` and `boundary-circles` goes
        // through this queue. `getData()` is a round trip to the worker, so two
        // overlapping cycles both read the pre-mutation clone and the second
        // `setData` silently discards the first one's work. The `boundarys` source
        // needs no help here (the dispatcher above coalesces its writes into a
        // diff), but every method that touches BOTH runs inside a task anyway, so
        // the pair stays consistent with the parent.
        // Public methods below are the serialized shells; the `_xxxUnlocked` bodies
        // are what runs inside a task, and they call only each other (calling a
        // shell from inside a task waits for the task itself: it deadlocks).
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
        // `pendingZoomUpdate` is held for the whole (async) pass so the frames of a
        // zoom gesture cannot stack; `missedZoomUpdate` records the frames that
        // arrive meanwhile, so the last zoom of the gesture is replayed, not lost.
        this.pendingZoomUpdate = false;
        this.missedZoomUpdate = false;
        this.lastPreviewPosition = null;
        this.lastPreviewPoints = null;

        this._name = 'AddBoundaryControl';

        // Continuation session, set while the user is extending an existing boundary from one
        // of its ends. See startExtending / finishExtending.
        this._extending = null;

        // Pointer event state for edit handles
        this._activePointerId = null;

        // Bind pointer event handlers
        this._onEditPointerDown = this._onEditPointerDown.bind(this);
        this._onEditPointerMove = this._onEditPointerMove.bind(this);
        this._onEditPointerUp = this._onEditPointerUp.bind(this);
    }

    static DEFAULT_PROPERTIES = {
        color: '#000000',
        lineWidth: 4,
        opacity: 1,
        source: 'boundary',
        type: 'boundary',
        symbol_instances: [{ ratio: 0.5, showLabels: true }],
        symbol_size: 1,
        text_size: 35,
        echelon: 'XXX',
        text_top: '',
        text_bottom: '',
        text_distance_ratio: 0.9,
        // Zoom anchor: ONE switch for the whole feature. On (the default), the
        // pixel-sized parts (line, labels, circle stroke) scale 2x per zoom level
        // from `createdAtZoom` and everything stays glued to the TERRAIN; off,
        // they stay put and the echelon (km) shrinks instead, so everything stays
        // glued to the SCREEN. See tool_manager/helpers/boundary-zoom.model.js.
        createdAtZoom: 0,
        zoomCorrectionEnabled: true,
        calculatedLineWidth: 4,
        calculatedTextSize: 35,
        calculatedStrokeWidth: 2,
        calculatedSymbolSize: 1,
        // Label axis: pin the glyphs to map north instead of to the line.
        text_north_facing: false,
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

    // ===== MAPBOX CONTROL INTERFACE =====

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
        // Releases the queue, its settle timers and the two map listeners the dispatcher opens per
        // dispatch. Dropping a batch here cannot lose a boundary: the store write always precedes
        // the source write, so the redraw that follows a style switch repopulates `boundarys` from
        // persistence.
        destroyGeoJsonDispatcher(this.map, 'boundarys');
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

    canCopy(_feature) {
        return true;
    }

    canPaste(_feature) {
        return true;
    }

    prepareForPaste(feature, offset) {
        const oldCoords = this.geometry.normalizeBaseCoordinates(feature.properties.baseCoordinates);
        if (!oldCoords) return feature;

        const newCoords = oldCoords.map(coord => [
            coord[0] + offset.dx,
            coord[1] + offset.dy
        ]);

        // THE DERIVED PIXEL SIZES ARE RECOMPUTED, not carried over. `generate` resolves the
        // echelon (km on the ground) from the zoom it is handed, so the GEOMETRY was already
        // right; the paint properties are not geometry. `calculatedLineWidth`,
        // `calculatedTextSize` and `calculatedStrokeWidth` are what the layers read, and the
        // copy carries the ones cached at the zoom it was COPIED at: a boundary copied at z18
        // and pasted at z12 drew its line at the z18 width until the next zoom event happened
        // to rewrite the source. `withBoundaryZoomSizes` is a pure recompute from the authored
        // sizes, so it is idempotent and cannot invent a size the zoom pass would not.
        const properties = withBoundaryZoomSizes(
            { ...feature.properties, baseCoordinates: newCoords },
            this.getCurrentZoom(),
        );

        return {
            ...feature,
            properties,
            geometry: this.geometry.generate(properties, this.getCurrentZoom())
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

    updateFeatureForMove(feature, dx, dy, _newCoords) {
        const oldCoords = this.geometry.normalizeBaseCoordinates(feature.properties.baseCoordinates);
        if (!oldCoords) return feature;

        const newBaseCoords = oldCoords.map(coord => [
            coord[0] + dx,
            coord[1] + dy
        ]);

        // Same recompute as `prepareForPaste`, and for the same reason: the move handler hands
        // back its OWN copy of the feature, derived values and all. A drag does not change the
        // zoom, so this is normally a no-op; it stops being one when the copy the handler holds
        // predates a zoom pass, which is the state the paste bug was the loud version of.
        const properties = withBoundaryZoomSizes(
            { ...feature.properties, baseCoordinates: newBaseCoords },
            this.getCurrentZoom(),
        );

        const updatedFeature = {
            ...feature,
            properties,
            geometry: this.geometry.generate(properties, this.getCurrentZoom())
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
        this.map.on('mousemove', this._onPreClickMouseMove);

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
        // Dropped FIRST: Esc and switching tools both land here, and a continuation writes
        // nothing before it is committed, so forgetting the session leaves the original
        // boundary untouched by construction.
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

    // ===== PRE-CLICK SNAP INDICATOR =====

    /**
     * Snap indicator before the first click, when there is nothing to preview yet.
     *
     * The raw `mousemove` only PARKS the pointer: `snapping.resolve` is a
     * rendered-feature query, and a mouse fires several moves inside one frame,
     * so it runs once per frame from the gate's callback below. The indicator
     * lands on the same pixel either way, since only the last position of the
     * frame is ever drawn.
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

        const snapping = getSnappingService();
        // While continuing, exclude the feature itself: its own vertices would otherwise
        // capture every click, exactly as they do for a handle drag.
        const snap = snapping?.resolve(this.map, e.point, e.lngLat, this._extending?.featureId) ?? e.lngLat;
        const newPoint = [snap.lng, snap.lat];

        // The rejection that also does the dedup: a repeat click on the spot the previous
        // click just committed is within MIN_DISTANCE_METERS of the LAST vertex, so it is
        // dropped here. That is why the 250 ms hold this click used to sit in could go: it
        // existed only to catch the repeat, and it caught it by re-arming a pending point,
        // which silently kept the SECOND set of coordinates. Measured in real Chromium on
        // 2026-09-04: 260 to 290 ms from click to vertex, invisible behind the preview on a
        // mouse and plainly late on the touch finish button. Removed 2026-09-04.
        if (this.geometry.isPointTooClose(newPoint, this.drawPoints)) {
            return;
        }

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

        // AFTER the push of the point under the cursor, which is how this tool already finishes
        // a drawing. The `return` skips `stopDrawing()`: `finishExtending` deactivates the tool,
        // and `deactivate()` already does everything `stopDrawing` would.
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
            const snap = snapping?.resolve(this.map, pointer.point, pointer.lngLat, excludeId) ?? pointer.lngLat;

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
            this.updateBoundaryPreview(this.lastPreviewPosition);
        } else if (this._extending) {
            this._updateExtensionPreview();
        } else if (this.lastPreviewPoints && this.lastPreviewPoints.length >= 1) {
            // No pending click to append: the click already put it in
            // `drawPoints`, which is what `lastPreviewPoints` was copied from.
            const previewPoints = [...this.lastPreviewPoints, this.lastPreviewPosition];

            const currentZoom = this.map.getZoom();
            const previewSize = this.calculateSymbolSizeForZoom(currentZoom);

            // Derive the sizes instead of inheriting the defaults': the
            // shared DEFAULT_PROPERTIES carries a `calculatedSymbolSize`
            // belonging to another size, and the preview overrides only
            // the base.
            const previewProperties = withBoundaryZoomSizes({
                ...AddBoundaryControl.DEFAULT_PROPERTIES,
                symbol_size: previewSize,
                createdAtZoom: Math.round(currentZoom * 10) / 10,
                baseCoordinates: previewPoints
            }, currentZoom);
            // No timer: this already runs at most once per frame, and the 8 ms
            // debounce it used to carry coalesced nothing (8 ms is under the
            // 16.7 ms of a frame). Removed 2026-09-04.
            const previewGeometry = this.geometry.generate(previewProperties, currentZoom);
            this.showPreview(previewGeometry);
        }
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
        getSnappingService()?.hideIndicator(this.map);
        this.drawPoints = [];
        this.clearPreview();
    }

    createFeature = async () => {
        if (this.drawPoints.length < 2) return;

        if (!this.geometry.validate(this.drawPoints)) {
            console.warn('Insufficient valid points for boundary creation');
            return;
        }

        const { id: featureId, geoJsonId } = IDUtils.generateFeatureIds();
        const featureName = await IDUtils.generateFeatureName('boundary', this.map);

        const currentZoom = this.map.getZoom();
        const adaptiveSymbolSize = this.calculateSymbolSizeForZoom(currentZoom);

        const properties = {
            ...AddBoundaryControl.DEFAULT_PROPERTIES,
            // Clone so each feature owns its instances (the default is shared by reference).
            symbol_instances: deepClone(AddBoundaryControl.DEFAULT_PROPERTIES.symbol_instances),
            symbol_size: adaptiveSymbolSize,
            baseCoordinates: [...this.drawPoints],
            createdAtZoom: Math.round(currentZoom * 10) / 10,
            id: featureId,
            nome: featureName,
            layerId: getActiveLayerIdSync(),
        };

        // At creation the factor is 1 by construction; computing it anyway keeps
        // the derived properties written in one place only.
        Object.assign(properties, computeBoundaryZoomSizes(properties, currentZoom));

        const geometry = this.geometry.generate(properties, currentZoom);

        if (!geometry || !geometry.coordinates) {
            console.error('Failed to generate valid geometry for boundary');
            return;
        }

        const feature = {
            type: 'Feature',
            id: geoJsonId,
            properties: properties,
            geometry: geometry
        };

        try {
            await addFeature('boundarys', feature);

            const dispatcher = boundarysSource(this.map);
            dispatcher.add(feature);
            await dispatcher.flush();

            await this.updateDependentFeatures(feature);

            this.drawPoints = [];
            this.toolManager.deactivateCurrentTool();
            await this.selectionManager.toggleFeatureSelection('boundary', featureId, feature);
            this.selectionManager.updateUI();
        } catch (error) {
            console.error('Error creating boundary:', error);
        }
    }

    // ===== CONTINUING AN EXISTING BOUNDARY =====

    /**
     * Enter "continue this boundary" mode from one of its ends.
     *
     * THE ORDER IS THE CONTRACT: `setActiveTool` deselects everything (which is what removes
     * the handle the user just clicked) and then calls `activate()`, which empties
     * `drawPoints`. The anchor is therefore seeded AFTER the tool switch, never before, or the
     * switch would throw it away.
     *
     * @param {Object} feature - Boundary feature to continue
     * @param {string} end - Which end to continue from ('start' | 'end')
     */
    startExtending = (feature, end) => {
        // Asked again here, not only when the handle was drawn: a peer can lock the map while
        // the handle sits on screen, and this is where the state gets to name itself.
        const reason = extensionDenialReason(feature);
        if (reason) {
            showWarning(reason);
            return;
        }

        // The same tool already active means a drawing is in progress. Seeding the anchor below
        // overwrites `drawPoints`, so without this the gesture would discard that work in
        // silence. Length 1 is the anchor of a continuation already open (a double click on the
        // handle), which is safe to re-seed.
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

        // `activate()` armed the pre-click snap indicator, which the drawing preview normally
        // replaces on the FIRST click. Here that click already happened (on the handle), so the
        // swap is done by hand.
        this.map.off('mousemove', this._onPreClickMouseMove);
        this.map.off('mousemove', this.handlePreviewMouseMove);
        this.map.on('mousemove', this.handlePreviewMouseMove);
        this.map.getCanvas().style.cursor = 'crosshair';
        this._finishButton?.updateState(this.drawPoints.length, 2);

        showToast('Clique no mapa para continuar a linha de limite. Botão direito para concluir.', 'info');
    }

    /**
     * Draw the WHOLE feature (existing spine plus what is being added) while the cursor moves,
     * instead of only the new segment.
     * @private
     */
    _updateExtensionPreview = () => {
        const session = this._extending;
        if (!session) return;

        // Every click is already a vertex, so there is nothing pending to append here.
        const pending = this.drawPoints.slice(1);

        const coordinates = previewCoordinates(
            session.existing,
            pending,
            this.lastPreviewPosition,
            session.end
        );
        if (coordinates.length < 2) return;

        // The FEATURE's own properties, never the tool defaults: the echelon and the symbol
        // instances carve the gaps in the line, so defaults would preview a boundary with an
        // echelon the feature does not have.
        const properties = buildExtendedProperties(session.sourceFeature, coordinates);

        // No timer: reached from inside the frame gate, which already caps this at one build
        // per frame.
        const previewGeometry = this.geometry.generate(properties, this.getCurrentZoom());
        if (previewGeometry) {
            this.showPreview(previewGeometry);
        }
    }

    /**
     * Commit the continuation: ONE `updateFeature` on the SAME feature, so the id, the name and
     * every style survive and a single Ctrl+Z undoes it.
     *
     * `createdAtZoom` and `zoomCorrectionEnabled` are carried over untouched (re-stamping them
     * would resize the whole feature under the user) and the `calculated*` cache is left to the
     * zoom pass that owns it; the symbol ratios are kept, so the echelon slides along the longer
     * line exactly as it does when a vertex is inserted.
     *
     * THE ORDER OF WRITES IS THE CONTRACT, and it is the reverse of what the other edit paths in
     * this file do: gate BEFORE any write, then the store, then a RE-READ, and only a re-read
     * that carries the new spine authorizes touching the `boundarys` source and rebuilding the
     * dependents. `updateFeature` returns `undefined` on every path, success included, so the
     * re-read is the only confirmation there is; painting first would leave the screen showing a
     * continuation nothing persisted, plus circles and labels rebuilt on a line that does not
     * exist. See `finishExtending` in `add_line_control.js` for the long form.
     *
     * @returns {Promise<void>} Resolves once the boundary and its dependents are rebuilt, saved
     *   and reselected
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
                showWarning('Não foi possível gerar a linha de limite continuada');
                this.toolManager.deactivateCurrentTool();
                return;
            }

            const updatedFeature = {
                ...session.sourceFeature,
                properties,
                geometry
            };

            // `updateFeature` directly, not `saveFeatureChanges`: that helper swallows its own
            // errors, so a failure would reach the re-read below dressed as a refusal.
            await updateFeature('boundarys', updatedFeature);

            const stored = await getFeatureById('boundarys', session.featureId);
            if (!storedSpineMatches(stored, coordinates)) {
                // Refused (rank, lock, or a feature that is no longer there). Neither the main
                // source nor the two derived sources were touched, so nothing has to be undone.
                this.toolManager.deactivateCurrentTool();
                await this.selectionManager.selectFeature('boundary', session.featureId, session.sourceFeature);
                this.updateUIAfterEdit();
                return;
            }

            await this.forceUpdateMainSource(stored);
            // The serialized shell, never `_updateDependentFeaturesUnlocked`: the circles and
            // the labels share `_sourceQueue` with the zoom pass.
            await this.updateDependentFeatures(stored);

            this.toolManager.deactivateCurrentTool();

            await this.selectionManager.selectFeature('boundary', session.featureId, stored);
            this.updateUIAfterEdit();
        } catch (error) {
            console.error('Error continuing boundary:', error);
            showWarning('Erro ao continuar a linha de limite');
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
        const handles = this.geometry.createHandles(feature, this.getCurrentZoom());
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

        // The continuation buttons ride with the vertex handles: every path that moves a vertex
        // (drag, move, insert, remove, property change) ends here, and this is also what keeps
        // them out of a locked map, where `selectFeature` never calls this method at all.
        showExtensionHandles(this.map, feature, this);
    }

    clearEditHandles = () => {
        // Mirror of createEditHandles: whoever tears down the vertex circles (deselection, but
        // also the attribute table) tears down the continuation buttons with them.
        hideExtensionHandles(this.map);
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
            const result = this.geometry.updateFromHandle(
                this.activeHandleType,
                this.lastPreviewPosition,
                selectedFeature,
                this.activeHandleIndex,
                this.getCurrentZoom()
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
        // zoom it skipped now that the sources are ours again.
        this.replayMissedZoomUpdate();
    }

    updateBoundaryPreview = (newPosition) => {
        const selectedFeature = this.getSelectedFeature();
        if (!selectedFeature || !this.activeHandleType) return;

        // No timer, same reason as `performPreviewUpdate`: this is reached from
        // inside the frame callback, which already runs once per frame. The
        // "recapture the state after the debounce" step went with the timer.
        const result = this.geometry.updateFromHandle(
            this.activeHandleType,
            newPosition,
            selectedFeature,
            this.activeHandleIndex,
            this.getCurrentZoom()
        );

        if (result) {
            this.showEditPreview(result.geometry, result.properties);
        }
    }

    showEditPreview = (geometry, properties) => {
        this.map.getSource('boundary-feedback').setData({
            type: 'Feature',
            geometry: geometry,
            properties: {}
        });

        const tempFeature = { properties, geometry };
        const handles = this.geometry.createHandles(tempFeature, this.getCurrentZoom());
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
            geometry: this.geometry.generate(updatedProperties, this.getCurrentZoom())
        };

        // Apply updates
        await this.forceUpdateMainSource(updatedFeature);
        this.updateSelectionManagerFeature(updatedFeature);
        await this.updateDependentFeatures(updatedFeature);
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
        warning.textContent = 'Linha de limite deve ter no mínimo 2 vértices';

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

    /**
     * Rebuild the circles and labels of ONE boundary. Serialized shell.
     * @param {Object} boundaryFeature - Boundary feature
     * @returns {Promise<void>} Resolves once both sources are written
     */
    updateDependentFeatures = async (boundaryFeature) =>
        this._sourceQueue(() => this._updateDependentFeaturesUnlocked(boundaryFeature))

    /**
     * Rebuild the dependents of every boundary among the moved features.
     * Serialized as ONE task: N separate tasks would be correct but would let a
     * zoom pass interleave halfway through a multi-selection drag.
     * @param {Array} movedFeatures - Features the move handler produced
     * @returns {Promise<void>} Resolves once every boundary has been rebuilt
     */
    updateDependentFeaturesFromMovedFeatures = async (movedFeatures) => {
        await this._sourceQueue(async () => {
            for (const feature of movedFeatures) {
                if (feature.properties.source === 'boundary') {
                    await this._updateDependentFeaturesUnlocked(feature);
                }
            }
        });

        // A drag makes the zoom pass stand down; replay what it skipped.
        this.replayMissedZoomUpdate();
    }

    /**
     * Replace the dependents of ALL boundaries in one write per source.
     *
     * The restore path (`restoreBoundaryDependentFeatures`) used to call the
     * per-feature update once per boundary WITHOUT awaiting: every call read the
     * same empty collection and wrote back only its own children, so on a map
     * with N boundaries the labels of N-1 of them never appeared until something
     * else touched the feature. Building the whole set at once has no read to
     * lose.
     *
     * @param {Array} boundaryFeatures - Every boundary of the current map
     * @returns {Promise<void>} Resolves once both sources are written
     */
    rebuildAllDependentFeatures = async (boundaryFeatures) =>
        this._sourceQueue(() => this._rebuildAllDependentFeaturesUnlocked(boundaryFeatures))

    /**
     * @param {Object} boundaryFeature - Boundary feature
     * @returns {Promise<void>} Resolves once both sources are written
     * @private
     */
    _updateDependentFeaturesUnlocked = async (boundaryFeature) => {
        await this._updateBoundaryCirclesUnlocked(boundaryFeature);
        await this._updateBoundaryTextsUnlocked(boundaryFeature);
    }

    /**
     * @param {Array} boundaryFeatures - Every boundary of the current map
     * @returns {Promise<void>} Resolves once both sources are written
     * @private
     */
    _rebuildAllDependentFeaturesUnlocked = async (boundaryFeatures) => {
        try {
            const circleSource = this.map?.getSource('boundary-circles');
            const textSource = this.map?.getSource('boundary-texts');
            if (!circleSource && !textSource) return;

            const zoom = this.getCurrentZoom();
            const prepared = (boundaryFeatures || []).map(feature => this.withZoomSizes(feature));
            const { circles, texts } = this.geometry.buildDependentFeatures(prepared, zoom);

            circleSource?.setData({ type: 'FeatureCollection', features: circles });
            textSource?.setData({ type: 'FeatureCollection', features: texts });
        } catch (error) {
            // Called from a rAF callback that nobody awaits: a rejection here
            // would be an unhandled one and the restore would fail in silence.
            console.error('Error rebuilding boundary dependent features:', error);
        }
    }

    /**
     * @param {Object} boundaryFeature - Boundary feature
     * @returns {Promise<void>} Resolves once the circle source is written
     * @private
     */
    _updateBoundaryCirclesUnlocked = async (boundaryFeature) => {
        const circleData = await this.map.getSource('boundary-circles').getData();
        const featureId = boundaryFeature.properties.id;

        circleData.features = circleData.features.filter(f => f.properties.parent !== featureId);

        const circles = this.geometry.generateBoundaryCircles(
            this.withZoomSizes(boundaryFeature), this.getCurrentZoom(),
        );
        circleData.features.push(...circles);

        this.map.getSource('boundary-circles').setData(circleData);
    }

    /**
     * @param {Object} boundaryFeature - Boundary feature
     * @returns {Promise<void>} Resolves once the text source is written
     * @private
     */
    _updateBoundaryTextsUnlocked = async (boundaryFeature) => {
        const textData = await this.map.getSource('boundary-texts').getData();
        const featureId = boundaryFeature.properties.id;

        textData.features = textData.features.filter(f => f.properties.parent !== featureId);

        const texts = this.geometry.generateBoundaryTexts(
            this.withZoomSizes(boundaryFeature), this.getCurrentZoom(),
        );
        textData.features.push(...texts);

        this.map.getSource('boundary-texts').setData(textData);
    }

    // ===== ZOOM CORRECTION =====

    setupZoomListener = () => {
        this.map.on('zoom', this.handleZoomChange);
    }

    handleZoomChange = () => {
        // `pendingZoomUpdate` stays true for the WHOLE pass, not just until it
        // starts: the pass is async (three `getData` reads, and a geometry rebuild
        // for the screen-pinned boundaries), so clearing it early would let every
        // frame of a zoom gesture stack another pass, and the one that started at
        // the OLD zoom could finish last and write stale sizes.
        if (this.pendingZoomUpdate) {
            this.missedZoomUpdate = true;
            return;
        }

        this.pendingZoomUpdate = true;
        this.zoomRafId = requestAnimationFrame(this.updateAllBoundaryZoomSizes);
    }

    /**
     * Run the zoom pass that a drag made stand down, if there was one.
     * Called at the end of both drag paths (edit handle, feature move).
     * @returns {void}
     */
    replayMissedZoomUpdate = () => {
        if (this.missedZoomUpdate && this.map) {
            this.handleZoomChange();
        }
    }

    /**
     * Current map zoom, or NaN when there is no map. The model reads a non-finite
     * zoom as "no correction", which is the legacy render.
     * @returns {number} Zoom level
     */
    getCurrentZoom = () => (this.map ? this.map.getZoom() : NaN)

    /**
     * Non-mutating copy of a boundary feature with its derived sizes refreshed.
     * The restore path (`restoreBoundaryDependentFeatures`) hands us the raw
     * stored feature, whose derived values were computed at another zoom.
     * @param {Object} boundaryFeature - Boundary feature
     * @returns {Object} Feature copy carrying fresh derived sizes
     */
    withZoomSizes = (boundaryFeature) => ({
        ...boundaryFeature,
        properties: withBoundaryZoomSizes(boundaryFeature.properties, this.getCurrentZoom()),
    })

    /**
     * Bulk refresh used by `setupBoundaryLayers` before the source is written and
     * by the PDF/Garmin export for its own zoom.
     *
     * EVERY boundary gets its GEOMETRY rebuilt, not only the screen-pinned ones.
     * For a pinned one the echelon size in kilometres is a function of the zoom,
     * so a map reopened at another zoom would draw it at the wrong scale; for the
     * others the size is zoom-invariant but still bounded by the length of the
     * line, and the stored geometry may predate that cap (or any other change to
     * the drawing). It costs one rebuild per load, which is nothing next to a
     * boundary that draws differently from how it will draw after the next zoom.
     *
     * The stand-in `tool-registry.js` registers before this control loads answers
     * the same call with the NUMBERS only (it has no geometry and no Turf); the
     * geometry catches up on the first zoom event after the real control arrives.
     *
     * @param {Array} features - Boundary features
     * @param {number} [zoom] - Target zoom (defaults to the current map zoom)
     * @returns {Array} New array with derived sizes (and geometry) for that zoom
     */
    applyZoomCorrections = (features, zoom = this.getCurrentZoom()) => {
        if (!Array.isArray(features)) return [];

        return features.map(feature => {
            const properties = withBoundaryZoomSizes(feature.properties, zoom);
            return { ...feature, properties, geometry: this.geometry.generate(properties, zoom) };
        });
    }

    /**
     * Whether a feature drag owns the screen right now.
     *
     * READ FROM THE STATE MANAGER, which is where the flag actually lives
     * (`ui.isDragging`, written by `tool_manager/move_handler.js` and by
     * `ui_manager.js`). The two call sites used to read `this.uiManager`, and this
     * control has no such field: nothing ever assigns it, so both guards were dead
     * and a zoom pass (or a handle-drag write) could land in the middle of a move.
     * `selectionManager.uiManager` would work too, but it is set from `map_sig.js`
     * after construction, so it is one more thing that can be absent; the state
     * manager is the single source both writers agree on.
     *
     * Best-effort, like the sibling in `managers/selection-highlight.manager.js`: no
     * services container means no drag either.
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
     * Rewrite the derived sizes of every boundary and of its dependent texts and
     * circles for the current zoom. Runs at most once per animation frame while
     * zooming; the sources are only written when something actually changed, so a
     * map with no anchored boundary costs nothing but the reads.
     * @returns {Promise<void>} Resolves once the pass has finished
     */
    updateAllBoundaryZoomSizes = async () => {
        this.zoomRafId = null;

        // A drag OWNS the three sources for its duration (the move handler and
        // the handle drag both write them from outside this pass), and a pass
        // landing mid-drag would rewrite what the drag has not committed yet.
        // Stand down and leave the flag up: the end of the drag replays it.
        if (this.isDraggingHandle || this._isDragging()) {
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

            // One task for the whole pass: three sources are read and written
            // here, and a restore or a panel edit landing between the read and
            // the write of any of them would be silently overwritten.
            await this._sourceQueue(async () => {
                const regenerated = await this._refreshBoundarySourceZoomSizes(currentZoom);

                // The two derived sources are written HERE, with their ids
                // spelled out, and not inside a helper taking the id as an
                // argument. That is not style: `tests/unit/despachante-sem-escrita-crua.test.js`
                // proves statically that no raw `setData` lands on a source the
                // dispatcher owns, and a `getSource(variable)` is a target it
                // cannot resolve, so it reports the write as unprovable.
                const textSource = this.map?.getSource('boundary-texts');
                if (textSource) {
                    const textData = await textSource.getData();
                    if (this.map && this._applyDerivedSizes(textData, currentZoom, ['calculatedTextSize'])) {
                        textSource.setData(textData);
                    }
                }

                const circleSource = this.map?.getSource('boundary-circles');
                if (circleSource) {
                    const circleData = await circleSource.getData();
                    if (this.map && this._applyDerivedSizes(circleData, currentZoom, ['calculatedStrokeWidth'])) {
                        circleSource.setData(circleData);
                    }
                }

                // Only the screen-pinned boundaries changed shape, and only those
                // need their circles and labels rebuilt (both placed in km).
                for (const feature of regenerated) {
                    if (!this.map) return;
                    await this._updateDependentFeaturesUnlocked(feature);
                }
            });
        } catch (error) {
            // Nothing consumes this promise (it is a rAF callback), so a rejection
            // here would be an unhandled one and the correction would freeze in
            // silence. A style swap can remove a source mid-zoom; log and move on.
            console.warn('Error refreshing boundary zoom sizes:', error);
        } finally {
            this.pendingZoomUpdate = false;
            if (this.missedZoomUpdate && this.map) {
                this.missedZoomUpdate = false;
                this.handleZoomChange();
            }
        }
    }

    /**
     * Recompute the `boundarys` source for a zoom level: derived pixel sizes for
     * every feature, plus a geometry rebuild for the screen-pinned ones whose
     * echelon size in kilometres moved.
     *
     * The write goes through the dispatcher as an upsert of only what changed,
     * which is also why this method reads the collection: the previous property
     * set is what decides whether there IS a change.
     *
     * @param {number} currentZoom - Current map zoom
     * @returns {Promise<Array>} The features whose geometry was rebuilt
     */
    _refreshBoundarySourceZoomSizes = async (currentZoom) => {
        const source = this.map?.getSource('boundarys');
        if (!source) return [];

        const dispatcher = boundarysSource(this.map);
        await dispatcher.flush();
        const data = await source.getData();
        // The map can be gone (or restyled) by the time the read resolves.
        if (!this.map || !data?.features?.length) return [];

        const upserts = [];
        const regenerated = [];

        for (const feature of data.features) {
            if (!feature?.properties) continue;

            const sizes = computeBoundaryZoomSizes(feature.properties, currentZoom);
            let changed = false;

            for (const key of ['calculatedLineWidth', 'calculatedTextSize', 'calculatedStrokeWidth']) {
                if (feature.properties[key] !== sizes[key]) {
                    feature.properties[key] = sizes[key];
                    changed = true;
                }
            }

            // The kilometre value is only written where it can differ from the
            // authored size; elsewhere it would be a stale copy waiting to be read.
            if (isScreenAnchored(feature.properties)
                && feature.properties.calculatedSymbolSize !== sizes.calculatedSymbolSize) {
                feature.properties.calculatedSymbolSize = sizes.calculatedSymbolSize;
                feature.geometry = this.geometry.generate(feature.properties, currentZoom);
                changed = true;
                regenerated.push(feature);
            }

            if (changed) upserts.push(feature);
        }

        if (upserts.length > 0) {
            dispatcher.add(upserts);
            await dispatcher.flush();
        }

        return regenerated;
    }

    /**
     * Rewrite the listed derived properties on a collection ALREADY READ, in
     * place, and say whether anything moved.
     *
     * It touches no source of its own on purpose: the caller keeps the
     * `getSource` and the `setData`, with the id spelled out, so the static
     * guard on raw writes can prove the target. It is also what keeps the write
     * conditional, because on a map with no anchored boundary the pass must cost
     * the reads and nothing else.
     *
     * @param {Object} data - Collection returned by `getData()`
     * @param {number} currentZoom - Current map zoom
     * @param {Array<string>} keys - Derived property names to write
     * @returns {boolean} True when at least one value changed
     * @private
     */
    _applyDerivedSizes = (data, currentZoom, keys) => {
        if (!data?.features?.length) return false;

        let hasChanges = false;

        for (const feature of data.features) {
            if (!feature?.properties) continue;

            const sizes = computeBoundaryZoomSizes(feature.properties, currentZoom);
            for (const key of keys) {
                if (feature.properties[key] !== sizes[key]) {
                    feature.properties[key] = sizes[key];
                    hasChanges = true;
                }
            }
        }

        return hasChanges;
    }

    // ===== FEATURE MANAGEMENT INTERFACE =====

    /**
     * Write one property on every given feature and rebuild what depends on it.
     * Serialized shell.
     * @param {Array} features - Selected features
     * @param {string} property - Property name
     * @param {*} value - New value
     * @returns {Promise<void>} Resolves once the sources are written
     */
    updateFeaturesProperty = async (features, property, value) =>
        this._sourceQueue(() => this._updateFeaturesPropertyUnlocked(features, property, value))

    /**
     * @param {Array} features - Selected features
     * @param {string} property - Property name
     * @param {*} value - New value
     * @returns {Promise<void>} Resolves once the sources are written
     * @private
     */
    _updateFeaturesPropertyUnlocked = async (features, property, value) => {
        // The collection read survives here on purpose. Two things below need the PREVIOUS source
        // feature and no diff hands them back: whether the feature exists at all (an unknown id
        // must be skipped, not created) and its full property set, which `geometry.generate` and
        // `updateDependentFeatures` both consume. Draining first keeps that read from being stale.
        const dispatcher = boundarysSource(this.map);
        await dispatcher.flush();
        const data = await this.map.getSource('boundarys').getData();
        const upserts = [];

        for (const feature of features) {
            const sourceFeature = data.features.find(f => f.properties.id === feature.properties.id);
            if (sourceFeature) {
                upserts.push(sourceFeature);
                sourceFeature.properties[property] = value;
                feature.properties[property] = value;

                if (property === 'symbol_instances') {
                    // Drop the migrated legacy scalar so storage converges to the array model.
                    delete sourceFeature.properties.symbol_position_ratio;
                    delete feature.properties.symbol_position_ratio;
                }

                if (property === 'createdAtZoom') {
                    const roundedZoom = Math.round(value * 10) / 10;
                    sourceFeature.properties[property] = roundedZoom;
                    feature.properties[property] = roundedZoom;
                }

                // Any input of the zoom model invalidates the derived sizes.
                if (['createdAtZoom', 'zoomCorrectionEnabled', 'lineWidth', 'text_size', 'symbol_size'].includes(property)) {
                    const sizes = computeBoundaryZoomSizes(sourceFeature.properties, this.getCurrentZoom());
                    Object.assign(sourceFeature.properties, sizes);
                    Object.assign(feature.properties, sizes);
                }

                // `createdAtZoom` and `zoomCorrectionEnabled` are geometry inputs
                // too: on a screen-pinned boundary they move the echelon's size in
                // kilometres, which only the geometry can express.
                if ([
                    'baseCoordinates', 'symbol_instances', 'symbol_size', 'echelon', 'text_distance_ratio',
                    'createdAtZoom', 'zoomCorrectionEnabled',
                ].includes(property)) {
                    const newGeometry = this.geometry.generate(sourceFeature.properties, this.getCurrentZoom());
                    sourceFeature.geometry = newGeometry;
                    feature.geometry = newGeometry;
                }

                if ([
                    'color', 'lineWidth', 'opacity', 'text_top', 'text_bottom', 'text_size',
                    'text_distance_ratio', 'echelon', 'symbol_instances', 'symbol_size',
                    'createdAtZoom', 'zoomCorrectionEnabled', 'text_north_facing',
                ].includes(property)) {
                    await this._updateDependentFeaturesUnlocked(sourceFeature);
                }
            }
        }

        // An upsert, not a property patch. Two reasons: a change to `baseCoordinates` and friends
        // also rewrites the geometry, and the `symbol_instances` branch DELETES the legacy
        // `symbol_position_ratio`, which a property patch would have to spell out as an unset.
        // `add` is a total replacement in MapLibre, which is what the whole-collection write did
        // to this entry, minus the other N-1.
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

    /**
     * Persist the features whose properties changed. Serialized shell: it only
     * READS the source, but it reads it to decide what to persist, so it must
     * not see a half-applied state from another cycle.
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
        // Reads only, and it persists the SOURCE's version of each feature rather than the
        // selected one, so the queue has to be drained before the collection comes back.
        await boundarysSource(this.map).flush();
        const currentData = await this.map.getSource('boundarys').getData();

        for (const selectedFeature of features) {
            if (this.hasFeatureChanged(selectedFeature, initialPropertiesMap.get(selectedFeature.properties.id))) {
                const currentFeature = currentData.features.find(f => f.properties.id === selectedFeature.properties.id);

                if (currentFeature) {
                    await updateFeature('boundarys', currentFeature);
                }
            }
        }
    }

    discardChangeFeatures = async (features, initialPropertiesMap) => {
        features.forEach(f => {
            Object.assign(f.properties, initialPropertiesMap.get(f.properties.id));
            f.geometry = this.geometry.generate(f.properties, this.getCurrentZoom());
        });

        // `updateFeatures` is the serialized shell, and this method is NOT
        // itself inside a task, so this is a plain call, not reentrancy.
        await this.updateFeatures(features, true);
    }

    /**
     * Remove the given boundaries and their dependents. Serialized shell.
     * @param {Array} features - Features to delete
     * @returns {Promise<void>} Resolves once the three sources are written
     */
    deleteFeatures = async (features) =>
        this._sourceQueue(() => this._deleteFeaturesUnlocked(features))

    /**
     * @param {Array} features - Features to delete
     * @returns {Promise<void>} Resolves once the three sources are written
     * @private
     */
    _deleteFeaturesUnlocked = async (features) => {
        if (features.length === 0) return;

        // The two derived sources still go through a read-filter-write: they are NOT diffable (see
        // the note on `boundarysSource`), and their features are keyed by `parent`, not by an id
        // the diff format could address.
        const textData = await this.map.getSource('boundary-texts').getData();
        const circleData = await this.map.getSource('boundary-circles').getData();

        for (const feature of features) {
            try {
                const featureId = feature.properties.id;
                await removeFeature('boundarys', featureId);

                textData.features = textData.features.filter(f => f.properties.parent !== featureId);
                circleData.features = circleData.features.filter(f => f.properties.parent !== featureId);

            } catch (error) {
                console.error(`Error removing boundary ${feature.properties.id}:`, error);
            }
        }

        // Removal by promoted key, with no collection read. The keys go in raw, never coerced:
        // MapLibre keyed the feature by the very value that sits in `properties.id`, so a
        // `String()` around it would miss a numeric key instead of protecting anything.
        const dispatcher = boundarysSource(this.map);
        dispatcher.remove(features.map(f => f.properties.id));
        await dispatcher.flush();

        this.map.getSource('boundary-texts').setData(textData);
        this.map.getSource('boundary-circles').setData(circleData);
    }

    /**
     * Swap a boundary for the two halves a cut produced, across the three
     * sources. Serialized shell.
     * @param {string} originalId - Id of the boundary that was cut
     * @param {Array} halves - The features that replace it
     * @returns {Promise<void>} Resolves once the three sources are written
     */
    replaceSplitBoundary = async (originalId, halves) =>
        this._sourceQueue(() => this._replaceSplitBoundaryUnlocked(originalId, halves))

    /**
     * ONE task, and one read per derived source. Removing the original and
     * appending the halves through the public per-feature shells would be three
     * tasks, and a zoom pass landing between them would rebuild the sources from
     * a state holding neither the original nor both halves.
     * @param {string} originalId - Id of the boundary that was cut
     * @param {Array} halves - The features that replace it
     * @returns {Promise<void>} Resolves once the three sources are written
     * @private
     */
    _replaceSplitBoundaryUnlocked = async (originalId, halves) => {
        const textData = await this.map.getSource('boundary-texts').getData();
        const circleData = await this.map.getSource('boundary-circles').getData();

        textData.features = textData.features.filter(f => f.properties.parent !== originalId);
        circleData.features = circleData.features.filter(f => f.properties.parent !== originalId);

        const zoom = this.getCurrentZoom();
        for (const half of halves) {
            const prepared = this.withZoomSizes(half);
            circleData.features.push(...this.geometry.generateBoundaryCircles(prepared, zoom));
            textData.features.push(...this.geometry.generateBoundaryTexts(prepared, zoom));
        }

        // One removal plus two adds IS the diff a cut produces, so `boundarys` takes it
        // as a diff and never a collection read. The key goes in raw, like
        // `_deleteFeaturesUnlocked`: MapLibre keyed the feature by the very value sitting
        // in `properties.id`, so a `String()` around it would miss a numeric key instead
        // of protecting anything.
        const dispatcher = boundarysSource(this.map);
        dispatcher.remove(originalId);
        dispatcher.add(halves);
        await dispatcher.flush();

        this.map.getSource('boundary-texts').setData(textData);
        this.map.getSource('boundary-circles').setData(circleData);
    }

    setDefaultProperties = (properties) => {
        const {
            id: _id,
            nome: _nome,
            baseCoordinates: _baseCoordinates,
            symbol_instances: _symbolInstances,
            // The anchor and everything derived from it belong to ONE feature:
            // inheriting them would make every new boundary scale from an old zoom.
            createdAtZoom: _createdAtZoom,
            calculatedLineWidth: _calculatedLineWidth,
            calculatedTextSize: _calculatedTextSize,
            calculatedStrokeWidth: _calculatedStrokeWidth,
            calculatedSymbolSize: _calculatedSymbolSize,
            ...styleProperties
        } = properties;

        Object.assign(AddBoundaryControl.DEFAULT_PROPERTIES, styleProperties);
    }

    // The four `calculated*` properties are DELIBERATELY absent from the
    // comparison below. They are a cache the zoom pass rewrites on every frame
    // of a zoom gesture, so counting them as a change would enqueue an outbound
    // sync operation per boundary per frame: hundreds of ops for a gesture that
    // changed nothing the user authored. The peer recomputes them on arrival.
    hasFeatureChanged = (feature, initialProperties) => {
        if (!initialProperties) return true;

        return (
            feature.properties.color !== initialProperties.color ||
            feature.properties.lineWidth !== initialProperties.lineWidth ||
            feature.properties.echelon !== initialProperties.echelon ||
            feature.properties.text_top !== initialProperties.text_top ||
            feature.properties.text_bottom !== initialProperties.text_bottom ||
            feature.properties.text_size !== initialProperties.text_size ||
            feature.properties.text_north_facing !== initialProperties.text_north_facing ||
            feature.properties.createdAtZoom !== initialProperties.createdAtZoom ||
            feature.properties.zoomCorrectionEnabled !== initialProperties.zoomCorrectionEnabled ||
            feature.properties.symbol_size !== initialProperties.symbol_size ||
            !deepEqual(feature.properties.symbol_instances, initialProperties.symbol_instances) ||
            feature.properties.text_distance_ratio !== initialProperties.text_distance_ratio ||
            feature.properties.nome !== initialProperties.nome ||
            feature.properties.descricao !== initialProperties.descricao ||
            feature.properties.visivel !== initialProperties.visivel ||
            feature.properties.bloqueado !== initialProperties.bloqueado ||
            !deepEqual(feature.properties.baseCoordinates, initialProperties.baseCoordinates)
        );
    }

    /**
     * Replace the given features in the source (and optionally persist them).
     * Serialized shell.
     * @param {Array} features - Features to write
     * @param {boolean} [save] - Also persist through the store
     * @returns {Promise<void>} Resolves once the sources are written
     */
    updateFeatures = async (features, save = false) =>
        this._sourceQueue(() => this._updateFeaturesUnlocked(features, save))

    /**
     * @param {Array} features - Features to write
     * @param {boolean} [save] - Also persist through the store
     * @returns {Promise<void>} Resolves once the sources are written
     * @private
     */
    _updateFeaturesUnlocked = async (features, save = false) => {
        if (features.length > 0) {
            // The collection read survives here too, and only for the existence check: an unknown
            // id must be skipped rather than created, which is what `add` would do. Draining first
            // keeps that read from being stale.
            const dispatcher = boundarysSource(this.map);
            await dispatcher.flush();
            const data = await this.map.getSource('boundarys').getData();
            const upserts = [];

            for (const feature of features) {
                const featureIndex = data.features.findIndex(f => f.properties.id === feature.properties.id);
                if (featureIndex !== -1) {
                    // The incoming feature is COMPLETE, so it ships as an upsert (`add` is a total
                    // replacement in MapLibre): the same result the whole-collection write
                    // produced, without the other N-1 features riding along.
                    upserts.push(feature);
                    await this._updateDependentFeaturesUnlocked(feature);

                    if (save) {
                        await updateFeature('boundarys', feature);
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
        // Both gates: the drawing/drag preview and the pre-click indicator.
        this._previewScheduler.cancel();
        this._preClickScheduler.cancel();
        this.lastPreviewPosition = null;
        this.lastPreviewPoints = null;
        this.activeHandleType = null;
        this.activeHandleIndex = null;
    }

    /**
     * Writes one edited boundary back into the source.
     *
     * The read is kept, and only for the existence check: this is called from the handle-drag and
     * vertex-removal paths with a feature derived from the SELECTION, and `add` would CREATE an id
     * the source no longer has instead of the silent skip the old `if (sourceFeature)` produced.
     * The write itself is now a one-feature upsert rather than the whole collection.
     *
     * IT IS THE ONE WRITER THAT STAYS OUT OF `_sourceQueue`, and that is a
     * decision, not an omission: it touches `boundarys` and nothing else, and
     * that source is the dispatcher's, which already coalesces concurrent writes
     * into one diff. Putting it in the queue would only make a handle drag wait
     * behind a zoom pass it does not conflict with.
     *
     * NO DRAG GUARD, and the `_isDragging()` that stood here went with the dead
     * `this.uiManager` guards of the other eight controls. The measure is in
     * `move_handler.js`: `_performDragUpdate` writes `selection-boxes` alone,
     * and `_endDrag` puts `isDragging` down (line 503) BEFORE it hands the
     * geometry over (line 517 and 523). So `boundarys` never holds a partial
     * position for a guard to protect, and a live guard here could only DISCARD
     * a write that nothing reapplies. The zoom pass keeps its `_isDragging()`:
     * that one runs per frame DURING the drag and is a different question.
     * Removed 2026-09-04, measured by
     * tests/unit/force-update-during-drag-military.test.js.
     * @param {Object} feature - Edited boundary feature
     */
    forceUpdateMainSource = async (feature) => {
        const dispatcher = boundarysSource(this.map);
        await dispatcher.flush();
        const data = await this.map.getSource('boundarys').getData();
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
            await updateFeature('boundarys', feature);
        } catch (error) {
            console.error('Error saving feature changes:', error);
        }
    }

    /**
     * Finish drawing from touch device (replaces right-click)
     */
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

    /**
     * Undo last drawn point (touch device helper)
     */
    _undoLastPoint = () => {
        // While continuing, index 0 is the ANCHOR (the endpoint the user clicked the handle
        // on), not a point they drew: undoing past it would detach the continuation from the
        // boundary.
        const floor = this._extending ? 1 : 0;
        if (!this.isActive || this.drawPoints.length <= floor) return;

        this.drawPoints.pop();

        if (this.drawPoints.length === 0) {
            // Go back to pre-click snap indicator mode
            this.map.off('mousemove', this.handlePreviewMouseMove);
            this.map.on('mousemove', this._onPreClickMouseMove);
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
        this.map.off('mousemove', this._onPreClickMouseMove);
        this.map.off('mousemove', this.handlePreviewMouseMove);
        this.removeEditEventListeners();
        this.removeHoverListeners();
        this.removeEditRightClickListener();
        this.cancelPendingUpdates();
    }
}

export default AddBoundaryControl;

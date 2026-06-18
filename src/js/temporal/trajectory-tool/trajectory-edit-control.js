// Path: js/temporal/trajectory-tool/trajectory-edit-control.js

/**
 * @fileoverview Trajectory editor for the selected feature, modelled on the line
 * tool's vertex editing.
 *
 * When a trajectory-capable feature (point / military_symbol /
 * coordination_measure) is selected, its trajectory is shown as a connecting path
 * plus edit handles in a GeoJSON layer: a numbered VERTEX handle per keypoint and
 * a MIDPOINT handle per segment. Drag a vertex to move it (keeps its time); drag a
 * midpoint to INSERT a keypoint (time = average of its neighbours); right-click or
 * long-press a vertex to remove it. "Adicionar no mapa" enters append mode — each
 * map click appends a keypoint at the current timeline instant. Per-point time
 * editing and the waypoint list live in the feature's attribute panel (the
 * `onChange` callback keeps it in sync).
 */

import { showToast, showSuccess } from '@utils/index.js';
import { deepClone } from '@utils/deep-utils.js';
import {
    registerControl,
    getControl,
    getEventBus,
    getStateManager,
    updateFeatureProperty,
    getStorageTypeFromSource,
    getMapTemporalConfigSync,
} from '@store';
import { EventTypes } from '@events/event_types.js';
import { getSnappingService } from '@js/snapping/snapping.service.js';
import { isTouchDevice } from '@utils/pointer-utils.js';
import { setupVertexRemoveLongPress } from '@js/draw_tools/drawing-touch-helpers.js';
import { normalizeTrajectory } from '../temporal-model.js';
import { unitToMs } from '../temporal.utils.js';
import { TRAJECTORY_TYPE_TO_SOURCE, TRAJECTORY_TYPE_TO_CONTROL } from '../temporal.constants.js';
import { updateSourceFeatureProperty } from '../temporal-render.service.js';
import {
    buildPathCollection,
    buildHandleCollection,
    moveKeypoint,
    insertKeypointAtSegment,
    removeKeypoint,
} from './trajectory-edit-geometry.js';

const PATH_SOURCE = 'trajectory-edit-path';
const HANDLE_SOURCE = 'trajectory-edit-handles';
const HIGHLIGHT_SOURCE = 'trajectory-edit-highlight';
const PATH_LAYER = 'trajectory-edit-path-layer';
const MIDPOINT_LAYER = 'trajectory-edit-midpoint-layer';
const HIGHLIGHT_LAYER = 'trajectory-edit-highlight-layer';
const VERTEX_LAYER = 'trajectory-edit-vertex-layer';
const VERTEX_LABEL_LAYER = 'trajectory-edit-vertex-label-layer';

export class TrajectoryEditControl {
    constructor() {
        this._map = null;
        this._toolManager = null;
        this._feature = null;
        this._featureType = null;
        this._onChange = null;

        this._adding = false;
        this._addSnapshot = null;
        this._lastAdded = null;
        this._toolbar = null;
        this._countEl = null;
        this._toolbarLayoutUnsub = null;
        this._unsubscribers = [];

        // Handle drag state (vertex move / midpoint insert).
        this._editing = false;
        this._dragType = null;   // 'vertex' | 'midpoint'
        this._dragIndex = null;
        this._dragMoved = false;
        this._previewPos = null; // [lng, lat]
        this._rafId = null;
        this._pendingPreview = false;
        this._cleanupLongPress = null;

        this._onClick = this._onClick.bind(this);
        this._onKeyDown = this._onKeyDown.bind(this);
        this._onEditMouseDown = this._onEditMouseDown.bind(this);
        this._onEditMouseMove = this._onEditMouseMove.bind(this);
        this._onEditMouseUp = this._onEditMouseUp.bind(this);
        this._onHandleEnter = this._onHandleEnter.bind(this);
        this._onHandleLeave = this._onHandleLeave.bind(this);
        this._onCanvasContextMenu = this._onCanvasContextMenu.bind(this);
        this._performPreview = this._performPreview.bind(this);
    }

    onAdd(map, toolManager = null) {
        this._map = map;
        this._toolManager = toolManager;
        const bus = getEventBus();
        if (bus) {
            // Clear the trajectory display when the feature panel closes (deselect).
            this._unsubscribers.push(bus.on(EventTypes.FEATURE_PANEL_CLOSED, () => this.hide()));
        }
        // Mutual exclusivity with tools: activating any tool/viewer stops trajectory
        // editing (and entering add mode deactivates the active tool — see startAdding).
        if (toolManager?.on) {
            const onToolActivated = () => this.hide();
            toolManager.on('toolActivated', onToolActivated);
            toolManager.on('viewerActivated', onToolActivated);
            this._unsubscribers.push(() => {
                toolManager.off('toolActivated', onToolActivated);
                toolManager.off('viewerActivated', onToolActivated);
            });
        }
        return null;
    }

    onRemove() {
        this.hide();
        this._unsubscribers.forEach((off) => off && off());
        this._unsubscribers = [];
        this._map = null;
    }

    /** @returns {boolean} Whether append mode is active. */
    isAdding() {
        return this._adding;
    }

    // ===== Display (shown while the feature is selected) =====

    /**
     * Shows the trajectory of a feature (path + edit handles). Replaces any
     * previously shown feature.
     * @param {Object} feature - The selected trajectory feature.
     * @param {{onChange?: function}} [options] - onChange fires after edits (panel sync).
     */
    show(feature, options = {}) {
        if (!this._map || !feature?.properties) return;

        if (typeof options.onChange === 'function') this._onChange = options.onChange;

        if (this._feature && this._feature.properties?.id !== feature.properties.id) {
            this._exitAdding(false);
        }
        this._feature = feature;
        this._featureType = feature.properties.source;

        this._ensureLayers();
        this._renderAll();
        // Re-show for the same feature must not stack listeners: tear down first so
        // _setupEditListeners is idempotent (avoids duplicate map.on / long-press leak).
        this._teardownEditListeners();
        this._setupEditListeners();
    }

    /** Re-renders the path + handles for the currently shown feature (after a panel edit). */
    refreshDisplay() {
        if (this._feature) this._renderAll();
    }

    /**
     * Emphasises the vertex at `index` with a halo (driven by the panel's waypoint
     * list on hover). Pass a non-index (e.g. null) to clear the highlight.
     * @param {number|null} index - Keypoint index (time-ordered), or null to clear.
     */
    highlightVertex(index) {
        const source = this._map?.getSource(HIGHLIGHT_SOURCE);
        if (!source) return;
        const pts = normalizeTrajectory(this._feature?.properties?.trajetoria);
        const kp = Number.isInteger(index) && index >= 0 && index < pts.length ? pts[index] : null;
        source.setData({
            type: 'FeatureCollection',
            features: kp
                ? [{ type: 'Feature', geometry: { type: 'Point', coordinates: [kp.lng, kp.lat] }, properties: {} }]
                : [],
        });
    }

    /** Clears the trajectory display and exits add/edit mode. */
    hide() {
        this._exitAdding(false);
        this._teardownEditListeners();
        this._removeLayers();
        this._feature = null;
        this._featureType = null;
        this._onChange = null;
    }

    // ===== Append mode (point by point at the end) =====

    /** Enters append mode for the currently-shown feature. */
    startAdding() {
        if (!this._feature || this._adding) return;
        // Trajectory editing and tools are mutually exclusive: turn off any active tool.
        this._toolManager?.deactivateCurrentTool?.();
        this._adding = true;
        this._addSnapshot = deepClone(this._feature.properties?.trajetoria || []);
        this._lastAdded = null;

        // Seed the anchor (point 0) at the feature's established position when the
        // trajectory is empty, so the path always starts where the feature already is.
        this._ensureAnchorPoint();

        this._buildToolbar();
        this._map.on('click', this._onClick);
        document.addEventListener('keydown', this._onKeyDown, true);
        this._map.getCanvas().style.cursor = 'crosshair';
    }

    _onClick(e) {
        const arr = this._ensureArray();
        const kp = { t: this._nextAppendTime(), lng: e.lngLat.lng, lat: e.lngLat.lat };
        arr.push(kp);
        this._lastAdded = kp;
        this._normalizeInPlace();
        this._renderAll();
        this._updateCount();
        this._onChange?.();
    }

    /** Removes the most recently appended keypoint (append mode right-click / undo). */
    _removeLastAdded() {
        const arr = this._feature?.properties?.trajetoria;
        if (!Array.isArray(arr) || arr.length === 0) return;
        const i = this._lastAdded ? arr.indexOf(this._lastAdded) : arr.length - 1;
        if (i < 0) return;
        // Never undo away the anchor (earliest keypoint = the feature's start position).
        if (arr[i] === normalizeTrajectory(arr)[0]) return;
        arr.splice(i, 1);
        this._lastAdded = null;
        this._renderAll();
        this._updateCount();
        this._onChange?.();
    }

    _onKeyDown(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            this._exitAdding(true);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            this._exitAdding(false);
        }
    }

    _exitAdding(commit) {
        if (!this._adding) return;
        this._adding = false;

        this._map.off('click', this._onClick);
        document.removeEventListener('keydown', this._onKeyDown, true);
        this._map.getCanvas().style.cursor = '';
        this._removeToolbar();

        if (!commit && this._addSnapshot && this._feature?.properties) {
            const arr = this._ensureArray();
            arr.length = 0;
            arr.push(...this._addSnapshot.map((k) => ({ ...k })));
        }
        this._normalizeInPlace();
        this._renderAll();
        this._persist();

        if (commit) {
            const n = (this._feature?.properties?.trajetoria || []).length;
            showSuccess(`Trajetória salva (${n} ponto${n === 1 ? '' : 's'})`);
        }

        this._addSnapshot = null;
        this._lastAdded = null;
        this._onChange?.();
    }

    _currentCursorTime() {
        const t = getControl('TemporalControl')?.getCursor?.();
        if (Number.isFinite(t)) return t;
        const step = unitToMs(getMapTemporalConfigSync().unidade);
        const arr = this._feature?.properties?.trajetoria || [];
        const last = arr[arr.length - 1];
        return last ? last.t + step : Date.now();
    }

    /**
     * Time for the next appended keypoint: one timeline step past the current last
     * keypoint, so each map click extends the path forward (append to the END) —
     * re-entering append mode on an existing trajectory keeps adding at the tail
     * instead of dropping points at the cursor instant. Falls back to the cursor
     * (then now) only when there are no keypoints yet.
     * @returns {number} Epoch ms for the appended keypoint.
     */
    _nextAppendTime() {
        const arr = this._feature?.properties?.trajetoria;
        if (Array.isArray(arr) && arr.length > 0) {
            const sorted = normalizeTrajectory(arr);
            const last = sorted[sorted.length - 1];
            const step = unitToMs(getMapTemporalConfigSync().unidade);
            return last.t + (Number.isFinite(step) && step > 0 ? step : 60_000);
        }
        return this._currentCursorTime();
    }

    /**
     * Seeds keypoint 0 at the feature's established position when the trajectory is
     * empty, timed at the earliest timeline instant so it sorts first and stays the
     * undeletable anchor (the start of the movement path).
     */
    _ensureAnchorPoint() {
        const arr = this._ensureArray();
        if (arr.length > 0) return;
        const home = this._featureHomeCoords();
        if (!home) return;
        arr.push({ t: this._anchorTime(), lng: home[0], lat: home[1] });
        this._renderAll();
        this._onChange?.();
    }

    /** The feature's home (authored, non-displaced) coordinates, or null. */
    _featureHomeCoords() {
        const props = this._feature?.properties;
        if (Array.isArray(props?._temporalHome) && props._temporalHome.length >= 2) {
            return props._temporalHome;
        }
        const coords = this._feature?.geometry?.coordinates;
        return Array.isArray(coords) && coords.length >= 2 ? coords : null;
    }

    /** Earliest sensible instant for the anchor: timeline start, else feature start, else cursor. */
    _anchorTime() {
        const bounds = getControl('TemporalControl')?.getBounds?.();
        if (bounds && Number.isFinite(bounds.inicio)) return bounds.inicio;
        const inicio = this._feature?.properties?.temporalInicio;
        if (Number.isFinite(inicio)) return inicio;
        return this._currentCursorTime();
    }

    /** @returns {boolean} Whether `index` is the undeletable anchor (earliest keypoint). */
    _isAnchorIndex(index) {
        return index === 0;
    }

    // ===== Handle editing (move / insert / remove) =====

    _setupEditListeners() {
        const map = this._map;
        if (!map) return;
        map.on('mousedown', this._onEditMouseDown);
        map.on('mousemove', this._onEditMouseMove);
        map.on('mouseup', this._onEditMouseUp);
        map.on('mouseenter', VERTEX_LAYER, this._onHandleEnter);
        map.on('mouseenter', MIDPOINT_LAYER, this._onHandleEnter);
        map.on('mouseleave', VERTEX_LAYER, this._onHandleLeave);
        map.on('mouseleave', MIDPOINT_LAYER, this._onHandleLeave);
        map.getCanvas().addEventListener('contextmenu', this._onCanvasContextMenu, true);

        if (isTouchDevice()) {
            this._cleanupLongPress = setupVertexRemoveLongPress(map, {
                handleLayerId: VERTEX_LAYER,
                onVertexRemove: (handle) => this._commitRemove(handle?.properties?.index),
            });
        }
    }

    _teardownEditListeners() {
        const map = this._map;
        this._cancelPreview();
        if (!map) return;
        map.off('mousedown', this._onEditMouseDown);
        map.off('mousemove', this._onEditMouseMove);
        map.off('mouseup', this._onEditMouseUp);
        map.off('mouseenter', VERTEX_LAYER, this._onHandleEnter);
        map.off('mouseenter', MIDPOINT_LAYER, this._onHandleEnter);
        map.off('mouseleave', VERTEX_LAYER, this._onHandleLeave);
        map.off('mouseleave', MIDPOINT_LAYER, this._onHandleLeave);
        map.getCanvas().removeEventListener('contextmenu', this._onCanvasContextMenu, true);
        map.dragPan.enable();
        map.getCanvas().style.cursor = '';
        if (this._cleanupLongPress) {
            this._cleanupLongPress();
            this._cleanupLongPress = null;
        }
        this._resetDrag();
    }

    _onHandleEnter() {
        if (this._adding || this._editing) return;
        this._map.getCanvas().style.cursor = 'pointer';
    }

    _onHandleLeave() {
        if (this._adding || this._editing) return;
        this._map.getCanvas().style.cursor = '';
    }

    _onEditMouseDown(e) {
        if (this._adding) return;
        if (e.originalEvent && e.originalEvent.button === 2) return; // right-click → contextmenu

        const handle = this._queryHandle(e.point);
        if (!handle) return;

        this._editing = true;
        this._dragType = handle.properties.handleType;
        this._dragIndex = handle.properties.index;
        this._dragMoved = false;
        this._previewPos = handle.geometry.coordinates.slice();
        this._map.dragPan.disable();
        this._map.getCanvas().style.cursor = 'grabbing';
        e.preventDefault();
    }

    _onEditMouseMove(e) {
        if (!this._editing) return;
        const excludeId = this._feature?.properties?.id;
        const snapping = getSnappingService();
        const snap = snapping?.resolve(this._map, e.point, e.lngLat, excludeId) ?? e.lngLat;
        this._previewPos = [snap.lng, snap.lat];
        this._dragMoved = true;

        if (snap.snapped) snapping.showIndicator(this._map, snap, snap.snapType);
        else snapping?.hideIndicator(this._map);

        if (!this._pendingPreview) {
            this._pendingPreview = true;
            this._rafId = requestAnimationFrame(this._performPreview);
        }
    }

    _performPreview() {
        this._pendingPreview = false;
        this._rafId = null;
        if (!this._editing || !this._previewPos) return;
        const preview = this._applyDrag(this._dragType, this._dragIndex, this._previewPos);
        if (!preview) return;
        this._map.getSource(PATH_SOURCE)?.setData(buildPathCollection(preview));
        this._map.getSource(HANDLE_SOURCE)?.setData(buildHandleCollection(preview));
    }

    _onEditMouseUp() {
        if (!this._editing) return;
        const type = this._dragType;
        const index = this._dragIndex;
        const pos = this._previewPos;
        const moved = this._dragMoved;

        getSnappingService()?.hideIndicator(this._map);
        this._map.dragPan.enable();
        this._map.getCanvas().style.cursor = '';
        this._resetDrag();

        if (!pos) return;
        // A vertex needs an actual drag to move; a midpoint commits on click or drag
        // (clicking a midpoint splits the segment at its centre).
        if (type === 'vertex' && !moved) {
            this._renderAll(); // discard any preview, restore the real positions
            return;
        }
        const next = this._applyDrag(type, index, pos);
        if (!next) {
            this._renderAll();
            return;
        }
        this._setTrajectory(next);
        this._renderAll();
        this._persist();
        this._onChange?.();
    }

    /** Pure preview/commit transform for a drag (no side effects). */
    _applyDrag(type, index, [lng, lat]) {
        const traj = this._feature?.properties?.trajetoria;
        return type === 'midpoint'
            ? insertKeypointAtSegment(traj, index, lng, lat)
            : moveKeypoint(traj, index, lng, lat);
    }

    /** Removes the keypoint at `index` (right-click / long-press), then persists. */
    _commitRemove(index) {
        // The first keypoint anchors the feature's start position and is fixed.
        if (this._isAnchorIndex(index)) {
            showToast('O ponto inicial (posição da feição) não pode ser removido.', 'info');
            return;
        }
        const next = removeKeypoint(this._feature?.properties?.trajetoria, index);
        if (!next) return;
        this._setTrajectory(next);
        this._renderAll();
        this._persist();
        this._onChange?.();
    }

    _onCanvasContextMenu(e) {
        if (!this._feature) return;
        if (this._adding) {
            e.preventDefault();
            this._removeLastAdded();
            return;
        }
        const canvas = this._map.getCanvas();
        const rect = canvas.getBoundingClientRect();
        const point = [e.clientX - rect.left, e.clientY - rect.top];
        const handles = this._map.queryRenderedFeatures(point, { layers: [VERTEX_LAYER] });
        const vertex = handles.find((f) => f.properties?.handleType === 'vertex');
        if (!vertex) return; // let the app context menu show
        e.preventDefault();
        e.stopPropagation();
        this._commitRemove(vertex.properties.index);
    }

    _queryHandle(point) {
        // Vertex layer sits above the midpoint layer, so an overlapping vertex wins.
        const handles = this._map.queryRenderedFeatures(point, { layers: [VERTEX_LAYER, MIDPOINT_LAYER] });
        return handles.find((f) => f.properties?.role === 'handle') || null;
    }

    _resetDrag() {
        this._editing = false;
        this._dragType = null;
        this._dragIndex = null;
        this._dragMoved = false;
        this._previewPos = null;
    }

    _cancelPreview() {
        if (this._rafId) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }
        this._pendingPreview = false;
    }

    // ===== Trajectory array (kept by reference so the panel list stays in sync) =====

    _ensureArray() {
        if (!Array.isArray(this._feature.properties.trajetoria)) {
            this._feature.properties.trajetoria = [];
        }
        return this._feature.properties.trajetoria;
    }

    /** Replaces the live array's contents in place, preserving its reference. */
    _setTrajectory(next) {
        const arr = this._ensureArray();
        arr.length = 0;
        arr.push(...next);
    }

    /** Sorts/validates the live array in place, preserving its reference. */
    _normalizeInPlace() {
        const arr = this._feature?.properties?.trajetoria;
        if (!Array.isArray(arr)) return;
        const sorted = normalizeTrajectory(arr);
        arr.length = 0;
        arr.push(...sorted);
    }

    // ===== Rendering =====

    _renderAll() {
        const traj = this._feature?.properties?.trajetoria;
        this._map?.getSource(PATH_SOURCE)?.setData(buildPathCollection(traj));
        this._map?.getSource(HANDLE_SOURCE)?.setData(buildHandleCollection(traj));
    }

    _ensureLayers() {
        const map = this._map;
        if (!map.getSource(PATH_SOURCE)) {
            map.addSource(PATH_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        }
        if (!map.getSource(HANDLE_SOURCE)) {
            map.addSource(HANDLE_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        }
        if (!map.getSource(HIGHLIGHT_SOURCE)) {
            map.addSource(HIGHLIGHT_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        }
        if (!map.getLayer(PATH_LAYER)) {
            map.addLayer({
                id: PATH_LAYER,
                type: 'line',
                source: PATH_SOURCE,
                paint: { 'line-color': '#16a34a', 'line-width': 2, 'line-dasharray': [2, 1.5] },
            });
        }
        if (!map.getLayer(MIDPOINT_LAYER)) {
            map.addLayer({
                id: MIDPOINT_LAYER,
                type: 'circle',
                source: HANDLE_SOURCE,
                filter: ['==', ['get', 'handleType'], 'midpoint'],
                paint: {
                    'circle-radius': 4,
                    'circle-color': '#ffffff',
                    'circle-opacity': 0.9,
                    'circle-stroke-color': '#16a34a',
                    'circle-stroke-width': 1.5,
                },
            });
        }
        if (!map.getLayer(HIGHLIGHT_LAYER)) {
            map.addLayer({
                id: HIGHLIGHT_LAYER,
                type: 'circle',
                source: HIGHLIGHT_SOURCE,
                paint: {
                    'circle-radius': 11,
                    'circle-opacity': 0,
                    'circle-stroke-color': '#f59e0b',
                    'circle-stroke-width': 3,
                },
            });
        }
        if (!map.getLayer(VERTEX_LAYER)) {
            map.addLayer({
                id: VERTEX_LAYER,
                type: 'circle',
                source: HANDLE_SOURCE,
                filter: ['==', ['get', 'handleType'], 'vertex'],
                paint: {
                    'circle-radius': 7,
                    'circle-color': '#16a34a',
                    'circle-stroke-color': '#ffffff',
                    'circle-stroke-width': 2,
                },
            });
        }
        if (!map.getLayer(VERTEX_LABEL_LAYER)) {
            map.addLayer({
                id: VERTEX_LABEL_LAYER,
                type: 'symbol',
                source: HANDLE_SOURCE,
                filter: ['==', ['get', 'handleType'], 'vertex'],
                layout: {
                    'text-field': ['get', 'label'],
                    'text-size': 10,
                    'text-allow-overlap': true,
                    'text-ignore-placement': true,
                },
                paint: { 'text-color': '#ffffff' },
            });
        }
    }

    _removeLayers() {
        const map = this._map;
        if (!map) return;
        for (const id of [VERTEX_LABEL_LAYER, VERTEX_LAYER, HIGHLIGHT_LAYER, MIDPOINT_LAYER, PATH_LAYER]) {
            if (map.getLayer(id)) map.removeLayer(id);
        }
        if (map.getSource(HIGHLIGHT_SOURCE)) map.removeSource(HIGHLIGHT_SOURCE);
        if (map.getSource(HANDLE_SOURCE)) map.removeSource(HANDLE_SOURCE);
        if (map.getSource(PATH_SOURCE)) map.removeSource(PATH_SOURCE);
    }

    // ===== Persistence =====

    _persist() {
        const props = this._feature?.properties;
        if (!props) return;
        const sorted = normalizeTrajectory(props.trajetoria);

        // The anchor (kp 0) is bound 1:1 to the feature's home position. If it moved
        // (anchor vertex dragged), relocate the feature too and persist geometry +
        // trajectory together through the owning control, so both land consistently.
        if (this._syncHomeToAnchor(sorted[0])) {
            const control = getControl(TRAJECTORY_TYPE_TO_CONTROL[this._featureType]);
            if (control?.updateFeatures) {
                control.updateFeatures([this._feature], true);
            } else {
                // updateFeatureProperty keys by STORAGE type — convert the source type.
                updateFeatureProperty(getStorageTypeFromSource(this._featureType), props.id, 'trajetoria', sorted);
            }
            getControl('TemporalControl')?.sync();
            return;
        }

        const sourceId = TRAJECTORY_TYPE_TO_SOURCE[this._featureType];
        if (sourceId) {
            updateSourceFeatureProperty(this._map, sourceId, props.id, 'trajetoria', sorted);
        }
        // updateFeatureProperty keys by STORAGE type ('points'), not the source type
        // ('point') held in _featureType — convert or the store write silently fails.
        updateFeatureProperty(getStorageTypeFromSource(this._featureType), props.id, 'trajetoria', sorted);
        getControl('TemporalControl')?.sync();
    }

    /**
     * Binds the feature's home (authoring) position to the trajectory anchor (kp 0):
     * relocating the anchor relocates the feature's initial position. Updates
     * `_temporalHome` when the feature is currently displaced (temporal active), else
     * its geometry coordinates. The owning control then persists geometry + store.
     * @param {{lng:number, lat:number}|undefined} anchor - The earliest keypoint.
     * @returns {boolean} True when the home position changed.
     */
    _syncHomeToAnchor(anchor) {
        const feature = this._feature;
        if (!anchor || !feature?.properties) return false;
        if (!Number.isFinite(anchor.lng) || !Number.isFinite(anchor.lat)) return false;

        const props = feature.properties;
        if (Array.isArray(props._temporalHome)) {
            if (props._temporalHome[0] === anchor.lng && props._temporalHome[1] === anchor.lat) return false;
            props._temporalHome = [anchor.lng, anchor.lat];
            return true;
        }
        const cur = feature.geometry?.coordinates;
        if (Array.isArray(cur) && cur[0] === anchor.lng && cur[1] === anchor.lat) return false;
        if (feature.geometry && Array.isArray(cur)) {
            feature.geometry.coordinates = [anchor.lng, anchor.lat];
            return true;
        }
        return false;
    }

    // ===== On-screen append toolbar =====

    _buildToolbar() {
        this._removeToolbar();
        const bar = document.createElement('div');
        bar.className = 'trajectory-edit-toolbar';
        bar.innerHTML = `
            <span class="trajectory-edit-toolbar__hint">Clique no mapa</span>
            <span class="trajectory-edit-toolbar__count"></span>
            <button type="button" class="trajectory-edit-toolbar__btn trajectory-edit-toolbar__cancel">Cancelar</button>
            <button type="button" class="trajectory-edit-toolbar__btn trajectory-edit-toolbar__done">Concluir</button>
        `;
        document.body.appendChild(bar);
        this._toolbar = bar;
        this._countEl = bar.querySelector('.trajectory-edit-toolbar__count');

        bar.querySelector('.trajectory-edit-toolbar__cancel').addEventListener('click', () => this._exitAdding(false));
        bar.querySelector('.trajectory-edit-toolbar__done').addEventListener('click', () => this._exitAdding(true));
        this._updateCount();

        // Keep the bar aligned with the active-tool chip slot: shift with the
        // sidebar / feature panel exactly like the chip does (via data-sidebar-state).
        this._updateToolbarSidebarState();
        this._toolbarLayoutUnsub = getEventBus()?.on(
            EventTypes.UI_LAYOUT_CHANGED,
            () => this._updateToolbarSidebarState()
        );
    }

    _updateToolbarSidebarState() {
        if (!this._toolbar) return;
        let sm;
        try {
            sm = getStateManager();
        } catch {
            sm = null;
        }
        const expanded = sm?.getUnsafe?.('sidebar.expanded') || sm?.getUnsafe?.('ui.featurePanelOpen') || false;
        this._toolbar.dataset.sidebarState = expanded ? 'expanded' : 'collapsed';
    }

    _updateCount() {
        if (!this._countEl) return;
        const n = (this._feature?.properties?.trajetoria || []).length;
        this._countEl.textContent = `${n} ponto${n === 1 ? '' : 's'}`;
    }

    _removeToolbar() {
        if (this._toolbarLayoutUnsub) {
            this._toolbarLayoutUnsub();
            this._toolbarLayoutUnsub = null;
        }
        if (this._toolbar) {
            this._toolbar.remove();
            this._toolbar = null;
            this._countEl = null;
        }
    }

    destroy() {
        this.onRemove();
    }
}

/**
 * Creates, attaches and registers the trajectory edit control.
 * @param {Object} map - MapLibre map instance.
 * @param {Object} [toolManager] - ToolManager, for mutual exclusivity with tools.
 * @returns {TrajectoryEditControl}
 */
export function createTrajectoryEditControl(map, toolManager) {
    const control = new TrajectoryEditControl();
    control.onAdd(map, toolManager);
    registerControl('TrajectoryEditControl', control);
    return control;
}

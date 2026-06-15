// Path: js/temporal/trajectory-tool/trajectory-edit-control.js

/**
 * @fileoverview Trajectory editor for the selected feature.
 *
 * When a trajectory-capable feature (point / military_symbol /
 * coordination_measure) is selected, its trajectory is shown on the map: a
 * connecting path plus a numbered, DRAGGABLE marker per keypoint (drag to move a
 * point's position). "Adicionar no mapa" enters add mode — each map click
 * appends a keypoint at the current timeline instant, with an on-screen
 * Concluir/Cancelar toolbar. Per-point time editing and the waypoint list live
 * in the feature's attribute panel (the `onChange` callback keeps it in sync).
 */

import { showToast, showSuccess } from '@utils/index.js';
import { deepClone } from '@utils/deep-utils.js';
import {
    registerControl,
    getControl,
    getEventBus,
    updateFeatureProperty,
    getMapTemporalConfigSync,
} from '@store';
import { EventTypes } from '@events/event_types.js';
import { normalizeTrajectory } from '../temporal-model.js';
import { unitToMs } from '../temporal.utils.js';
import { TRAJECTORY_TYPE_TO_SOURCE } from '../temporal.constants.js';
import { updateSourceFeatureProperty } from '../temporal-render.service.js';
import { buildPathCollection } from './trajectory-edit-geometry.js';

const PATH_SOURCE = 'trajectory-edit-path';
const PATH_LAYER = 'trajectory-edit-path-layer';

export class TrajectoryEditControl {
    constructor() {
        this._map = null;
        this._feature = null;
        this._featureType = null;
        this._onChange = null;

        this._markers = [];
        this._adding = false;
        this._addSnapshot = null;
        this._lastAdded = null;
        this._toolbar = null;
        this._countEl = null;
        this._unsubscribers = [];

        this._onClick = this._onClick.bind(this);
        this._onContextMenu = this._onContextMenu.bind(this);
        this._onKeyDown = this._onKeyDown.bind(this);
    }

    onAdd(map) {
        this._map = map;
        const bus = getEventBus();
        if (bus) {
            // Clear the trajectory display when the feature panel closes (deselect).
            this._unsubscribers.push(bus.on(EventTypes.FEATURE_PANEL_CLOSED, () => this.hide()));
        }
        return null;
    }

    onRemove() {
        this.hide();
        this._unsubscribers.forEach((off) => off && off());
        this._unsubscribers = [];
        this._map = null;
    }

    /** @returns {boolean} Whether add mode is active. */
    isAdding() {
        return this._adding;
    }

    // ===== Display (shown while the feature is selected) =====

    /**
     * Shows the trajectory of a feature (path + draggable markers). Replaces any
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

        this._ensurePathLayer();
        this._renderAll();
    }

    /** Re-renders the path + markers for the currently shown feature (after a panel edit). */
    refreshDisplay() {
        if (this._feature) this._renderAll();
    }

    /** Clears the trajectory display and exits add mode. */
    hide() {
        this._exitAdding(false);
        this._clearMarkers();
        this._removePathLayer();
        this._feature = null;
        this._featureType = null;
        this._onChange = null;
    }

    // ===== Add mode (point by point) =====

    /** Enters add mode for the currently-shown feature. */
    startAdding() {
        if (!this._feature || this._adding) return;
        this._adding = true;
        this._addSnapshot = deepClone(this._feature.properties?.trajetoria || []);
        this._lastAdded = null;

        this._buildToolbar();
        this._map.on('click', this._onClick);
        this._map.on('contextmenu', this._onContextMenu);
        document.addEventListener('keydown', this._onKeyDown, true);
        this._map.getCanvas().style.cursor = 'crosshair';
        showToast('Clique no mapa para adicionar pontos à trajetória. "Concluir" salva.', 'info');
    }

    _onClick(e) {
        const arr = this._ensureArray();
        const kp = { t: this._currentCursorTime(), lng: e.lngLat.lng, lat: e.lngLat.lat };
        arr.push(kp);
        this._lastAdded = kp;
        this._normalizeInPlace();
        this._renderAll();
        this._updateCount();
        this._onChange?.();
    }

    _onContextMenu(e) {
        e?.preventDefault?.();
        const arr = this._feature?.properties?.trajetoria;
        if (!Array.isArray(arr) || arr.length === 0) return;
        const i = this._lastAdded ? arr.indexOf(this._lastAdded) : arr.length - 1;
        if (i >= 0) arr.splice(i, 1);
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
        this._map.off('contextmenu', this._onContextMenu);
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

    // ===== Rendering =====

    _ensureArray() {
        if (!Array.isArray(this._feature.properties.trajetoria)) {
            this._feature.properties.trajetoria = [];
        }
        return this._feature.properties.trajetoria;
    }

    /** Sorts/validates the live array in place, preserving its reference. */
    _normalizeInPlace() {
        const arr = this._feature?.properties?.trajetoria;
        if (!Array.isArray(arr)) return;
        const sorted = normalizeTrajectory(arr);
        arr.length = 0;
        arr.push(...sorted);
    }

    _renderAll() {
        this._renderPath();
        this._renderMarkers();
    }

    _renderPath() {
        const source = this._map?.getSource(PATH_SOURCE);
        if (source) source.setData(buildPathCollection(this._feature?.properties?.trajetoria));
    }

    _renderMarkers() {
        this._clearMarkers();
        const waypoints = normalizeTrajectory(this._feature?.properties?.trajetoria);
        waypoints.forEach((kp, index) => {
            const el = document.createElement('div');
            el.className = 'trajectory-point-marker';
            el.textContent = String(index + 1);

            const marker = new maplibregl.Marker({ element: el, draggable: true, anchor: 'center' })
                .setLngLat([kp.lng, kp.lat])
                .addTo(this._map);

            marker.on('drag', () => {
                const ll = marker.getLngLat();
                kp.lng = ll.lng;
                kp.lat = ll.lat;
                this._renderPath();
            });
            marker.on('dragend', () => {
                this._persist();
                this._onChange?.();
            });
            this._markers.push(marker);
        });
    }

    _clearMarkers() {
        this._markers.forEach((m) => m.remove());
        this._markers = [];
    }

    _ensurePathLayer() {
        const map = this._map;
        if (!map.getSource(PATH_SOURCE)) {
            map.addSource(PATH_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        }
        if (!map.getLayer(PATH_LAYER)) {
            map.addLayer({
                id: PATH_LAYER,
                type: 'line',
                source: PATH_SOURCE,
                paint: {
                    'line-color': '#16a34a',
                    'line-width': 2,
                    'line-dasharray': [2, 1.5],
                },
            });
        }
    }

    _removePathLayer() {
        const map = this._map;
        if (!map) return;
        if (map.getLayer(PATH_LAYER)) map.removeLayer(PATH_LAYER);
        if (map.getSource(PATH_SOURCE)) map.removeSource(PATH_SOURCE);
    }

    // ===== Persistence =====

    _persist() {
        const props = this._feature?.properties;
        if (!props) return;
        const sorted = normalizeTrajectory(props.trajetoria);
        const sourceId = TRAJECTORY_TYPE_TO_SOURCE[this._featureType];
        if (sourceId) {
            updateSourceFeatureProperty(this._map, sourceId, props.id, 'trajetoria', sorted);
        }
        updateFeatureProperty(this._featureType, props.id, 'trajetoria', sorted);
        getControl('TemporalControl')?.sync();
    }

    // ===== On-screen add toolbar =====

    _buildToolbar() {
        this._removeToolbar();
        const bar = document.createElement('div');
        bar.className = 'trajectory-edit-toolbar';
        bar.innerHTML = `
            <span class="trajectory-edit-toolbar__hint">Clique no mapa para adicionar pontos à trajetória</span>
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
    }

    _updateCount() {
        if (!this._countEl) return;
        const n = (this._feature?.properties?.trajetoria || []).length;
        this._countEl.textContent = `${n} ponto${n === 1 ? '' : 's'}`;
    }

    _removeToolbar() {
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
 * @returns {TrajectoryEditControl}
 */
export function createTrajectoryEditControl(map) {
    const control = new TrajectoryEditControl();
    control.onAdd(map);
    registerControl('TrajectoryEditControl', control);
    return control;
}

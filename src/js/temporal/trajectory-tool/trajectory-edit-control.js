// Path: js/temporal/trajectory-tool/trajectory-edit-control.js

/**
 * @fileoverview Interactive map tool to author a feature's trajectory.
 *
 * Activated for a single point / military_symbol / coordination_measure feature.
 * Each map click adds a keypoint at the clicked position, timestamped with the
 * current timeline cursor (so the workflow is: scrub the bar to a time, click
 * the map to set the position at that time). Right-click removes the last
 * keypoint; Enter commits; Esc cancels.
 */

import { showToast, showSuccess } from '@utils/index.js';
import { deepClone } from '@utils/deep-utils.js';
import { registerControl, getControl, updateFeatureProperty, getMapTemporalConfigSync } from '@store';
import { normalizeTrajectory } from '../temporal-model.js';
import { unitToMs } from '../temporal.utils.js';
import { TRAJECTORY_TYPE_TO_SOURCE } from '../temporal.constants.js';
import { updateSourceFeatureProperty } from '../temporal-render.service.js';
import { buildPreviewCollection, appendKeypoint, removeLastKeypoint } from './trajectory-edit-geometry.js';

const PREVIEW_SOURCE = 'trajectory-edit-preview';
const PATH_LAYER = 'trajectory-edit-path';
const POINTS_LAYER = 'trajectory-edit-points';
const LABELS_LAYER = 'trajectory-edit-labels';

export class TrajectoryEditControl {
    constructor() {
        this._map = null;
        this._active = false;
        this._feature = null;
        this._featureType = null;
        this._keypoints = [];
        this._original = [];

        this._onClick = this._onClick.bind(this);
        this._onContextMenu = this._onContextMenu.bind(this);
        this._onKeyDown = this._onKeyDown.bind(this);
    }

    onAdd(map) {
        this._map = map;
        return null;
    }

    onRemove() {
        if (this._active) this.finish(false);
        this._map = null;
    }

    /** @returns {boolean} */
    isActive() {
        return this._active;
    }

    /**
     * Enters trajectory edit mode for a feature.
     * @param {Object} feature - The feature to edit.
     */
    start(feature) {
        if (!this._map || !feature) return;
        if (this._active) this.finish(false);

        this._feature = feature;
        this._featureType = feature.properties?.source;
        this._keypoints = normalizeTrajectory(deepClone(feature.properties?.trajetoria || []));
        this._original = deepClone(feature.properties?.trajetoria || []);
        this._active = true;

        this._addPreviewLayers();
        this._renderPreview();

        this._map.on('click', this._onClick);
        this._map.on('contextmenu', this._onContextMenu);
        document.addEventListener('keydown', this._onKeyDown, true);
        this._map.getCanvas().style.cursor = 'crosshair';

        getControl('TemporalControl')?.focusFeature(feature);
        showToast('Trajetória: clique no mapa para adicionar pontos no instante atual. Enter conclui, Esc cancela, botão direito remove o último.', 'info');
    }

    _onClick(e) {
        const controller = getControl('TemporalControl');
        let t = controller?.getCursor?.();
        if (!Number.isFinite(t)) {
            const step = unitToMs(getMapTemporalConfigSync().unidade);
            const last = this._keypoints[this._keypoints.length - 1];
            t = last ? last.t + step : Date.now();
        }
        this._keypoints = appendKeypoint(this._keypoints, t, e.lngLat.lng, e.lngLat.lat);
        this._syncFocusedFeature();
        this._renderPreview();
    }

    _onContextMenu(e) {
        if (e?.preventDefault) e.preventDefault();
        this._keypoints = removeLastKeypoint(this._keypoints);
        this._syncFocusedFeature();
        this._renderPreview();
    }

    _onKeyDown(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            this.finish(true);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            this.finish(false);
        }
    }

    /** Keeps the focused feature + bar pins in sync while authoring. */
    _syncFocusedFeature() {
        if (this._feature?.properties) {
            this._feature.properties.trajetoria = this._keypoints;
        }
        getControl('TemporalControl')?.focusFeature(this._feature);
    }

    /**
     * Finishes editing.
     * @param {boolean} commit - True to persist; false to revert.
     */
    finish(commit) {
        if (!this._active) return;
        this._active = false;

        this._map.off('click', this._onClick);
        this._map.off('contextmenu', this._onContextMenu);
        document.removeEventListener('keydown', this._onKeyDown, true);
        this._map.getCanvas().style.cursor = '';
        this._removePreviewLayers();

        const props = this._feature?.properties;
        if (props) {
            const finalTrajectory = commit ? normalizeTrajectory(this._keypoints) : normalizeTrajectory(this._original);
            props.trajetoria = finalTrajectory;

            if (commit) {
                const sourceId = TRAJECTORY_TYPE_TO_SOURCE[this._featureType];
                if (sourceId) {
                    updateSourceFeatureProperty(this._map, sourceId, props.id, 'trajetoria', finalTrajectory);
                }
                updateFeatureProperty(this._featureType, props.id, 'trajetoria', finalTrajectory);
                showSuccess(`Trajetória salva (${finalTrajectory.length} ponto${finalTrajectory.length === 1 ? '' : 's'})`);
            }

            const controller = getControl('TemporalControl');
            controller?.focusFeature(commit ? this._feature : null);
            controller?.sync();
        }

        this._feature = null;
        this._featureType = null;
        this._keypoints = [];
        this._original = [];
    }

    // ===== Preview rendering =====

    _addPreviewLayers() {
        const map = this._map;
        if (!map.getSource(PREVIEW_SOURCE)) {
            map.addSource(PREVIEW_SOURCE, {
                type: 'geojson',
                data: { type: 'FeatureCollection', features: [] },
            });
        }
        if (!map.getLayer(PATH_LAYER)) {
            map.addLayer({
                id: PATH_LAYER,
                type: 'line',
                source: PREVIEW_SOURCE,
                filter: ['==', ['get', 'kind'], 'path'],
                paint: {
                    'line-color': '#16a34a',
                    'line-width': 2,
                    'line-dasharray': [2, 1.5],
                },
            });
        }
        if (!map.getLayer(POINTS_LAYER)) {
            map.addLayer({
                id: POINTS_LAYER,
                type: 'circle',
                source: PREVIEW_SOURCE,
                filter: ['==', ['geometry-type'], 'Point'],
                paint: {
                    'circle-radius': 9,
                    'circle-color': '#ffffff',
                    'circle-stroke-color': '#16a34a',
                    'circle-stroke-width': 2,
                },
            });
        }
        if (!map.getLayer(LABELS_LAYER)) {
            map.addLayer({
                id: LABELS_LAYER,
                type: 'symbol',
                source: PREVIEW_SOURCE,
                filter: ['==', ['geometry-type'], 'Point'],
                layout: {
                    'text-field': ['get', 'label'],
                    'text-size': 11,
                    'text-allow-overlap': true,
                },
                paint: { 'text-color': '#15803d' },
            });
        }
    }

    _removePreviewLayers() {
        const map = this._map;
        if (!map) return;
        for (const id of [LABELS_LAYER, POINTS_LAYER, PATH_LAYER]) {
            if (map.getLayer(id)) map.removeLayer(id);
        }
        if (map.getSource(PREVIEW_SOURCE)) map.removeSource(PREVIEW_SOURCE);
    }

    _renderPreview() {
        const source = this._map?.getSource(PREVIEW_SOURCE);
        if (source) source.setData(buildPreviewCollection(this._keypoints));
    }

    destroy() {
        if (this._active) this.finish(false);
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

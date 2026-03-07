// Path: js/measurement_tool/measurement-distance.control.js

/**
 * @module measurement_tool/measurement-distance.control
 * @description Ephemeral distance measurement tool for 2D map.
 * Click to add vertices, right-click to finalize. No persistent features created.
 * After finalize, clicking on the map restarts a new measurement.
 * @dependencies turf (global), maplibregl (global)
 */

import {
    calculateSegmentDistance,
    getSegmentMidpoint,
    calculateLineLength,
    formatDistanceAuto,
    formatDistance,
} from './measurement-geometry.js';
import {
    updateLabels,
    updatePreviewLine,
    updateVertices,
    clearAllSources,
} from './measurement-labels.js';
import { createDistanceResultsPanel } from './measurement-results-panel.js';
import { addFeature, getActiveLayerIdSync, getControl, isCurrentMapLockedSync } from '@store';
import { IDUtils, showToast } from '@utils';

export class MeasurementDistanceControl {
    constructor(toolManager) {
        this.toolManager = toolManager;
        this.map = null;
        this.isActive = false;

        /** @type {number[][]} Collected vertex coordinates [lng, lat] */
        this._vertices = [];
        /** @type {number[]|null} */
        this._cursorPos = null;
        /** @type {HTMLElement|null} */
        this._resultsPanel = null;
        /** @type {boolean} Whether measurement has been finalized */
        this._finalized = false;

        this._onMapClick = this._onMapClick.bind(this);
        this._onMouseMove = this._onMouseMove.bind(this);
        this._onContextMenu = this._onContextMenu.bind(this);
        this._onDblClick = this._onDblClick.bind(this);
    }

    onAdd(map) {
        this.map = map;
        this._container = document.createElement('div');
        return this._container;
    }

    onRemove() {
        this.deactivate();
        this.map = null;
    }

    activate() {
        if (!this.map || this.isActive) return;
        this.isActive = true;
        this._vertices = [];
        this._cursorPos = null;
        this._finalized = false;
        this._removeResultsPanel();

        this.map.getCanvas().style.cursor = 'crosshair';
        this.map.on('click', this._onMapClick);
        this.map.on('mousemove', this._onMouseMove);
        this.map.on('contextmenu', this._onContextMenu);
        this.map.on('dblclick', this._onDblClick);
    }

    deactivate() {
        if (!this.map) return;
        this.isActive = false;
        this._finalized = false;

        this.map.getCanvas().style.cursor = '';
        this.map.off('click', this._onMapClick);
        this.map.off('mousemove', this._onMouseMove);
        this.map.off('contextmenu', this._onContextMenu);
        this.map.off('dblclick', this._onDblClick);

        this._vertices = [];
        this._cursorPos = null;
        clearAllSources(this.map);
        this._removeResultsPanel();
    }

    _onMapClick(e) {
        if (!this.isActive) return;

        if (this._finalized) {
            this._restart();
        }

        const coord = [e.lngLat.lng, e.lngLat.lat];
        this._vertices.push(coord);
        this._updateVisualization();
    }

    _onMouseMove(e) {
        if (!this.isActive || this._vertices.length === 0) return;

        this._cursorPos = [e.lngLat.lng, e.lngLat.lat];
        this._updateVisualization();
    }

    _onContextMenu(e) {
        e.preventDefault();
        if (this._finalized) return;

        const coord = [e.lngLat.lng, e.lngLat.lat];
        this._vertices.push(coord);
        this._finalize();
    }

    _onDblClick(e) {
        e.preventDefault();
        if (this._finalized) return;
        if (this._vertices.length > 1) {
            this._vertices.pop();
        }
        this._finalize();
    }

    _updateVisualization() {
        if (!this.map) return;

        const coords = [...this._vertices];
        if (this._cursorPos && this.isActive && !this._finalized) {
            coords.push(this._cursorPos);
        }

        updatePreviewLine(this.map, coords);
        updateVertices(this.map, this._vertices);

        const labels = [];
        for (let i = 1; i < coords.length; i++) {
            const dist = calculateSegmentDistance(coords[i - 1], coords[i]);
            const mid = getSegmentMidpoint(coords[i - 1], coords[i]);
            labels.push({ coordinates: mid, text: formatDistanceAuto(dist) });
        }

        if (coords.length > 2) {
            const total = calculateLineLength(coords);
            const last = coords[coords.length - 1];
            labels.push({ coordinates: last, text: `Total: ${formatDistanceAuto(total)}` });
        }

        updateLabels(this.map, labels);
    }

    _finalize() {
        if (this._vertices.length < 2) {
            this.deactivate();
            this.toolManager.deactivateCurrentTool();
            return;
        }

        this._finalized = true;

        this.map.off('mousemove', this._onMouseMove);
        this.map.getCanvas().style.cursor = '';
        this._cursorPos = null;

        const segmentDistances = [];
        for (let i = 1; i < this._vertices.length; i++) {
            segmentDistances.push(calculateSegmentDistance(this._vertices[i - 1], this._vertices[i]));
        }
        const totalDistance = calculateLineLength(this._vertices);

        this._updateVisualization();
        this._showResultsPanel(segmentDistances, totalDistance);
    }

    _restart() {
        this._finalized = false;
        this._vertices = [];
        this._cursorPos = null;
        clearAllSources(this.map);
        this._removeResultsPanel();
        this.map.getCanvas().style.cursor = 'crosshair';
        this.map.on('mousemove', this._onMouseMove);
    }

    _showResultsPanel(segmentDistances, totalDistance) {
        this._removeResultsPanel();

        const vertices = [...this._vertices];

        this._resultsPanel = createDistanceResultsPanel({
            segmentDistances,
            totalDistance,
            onSave: isCurrentMapLockedSync() ? null : () => this._saveAsFeature(vertices),
            onClear: () => {
                this.deactivate();
                this.toolManager.deactivateCurrentTool();
            },
            onUnitChange: ({ unit }) => this._updateMapLabels(unit),
        });

        const sidebarControl = getControl('sidebarControl');
        if (sidebarControl?.showToolPanel) {
            sidebarControl.showToolPanel(
                this._resultsPanel,
                'Medição de Distância',
                () => { this._resultsPanel = null; },
                () => {
                    this.deactivate();
                    this.toolManager.deactivateCurrentTool();
                }
            );
        }
    }

    _removeResultsPanel() {
        if (this._resultsPanel) {
            const sidebarControl = getControl('sidebarControl');
            if (sidebarControl?.hideToolPanel) {
                sidebarControl.hideToolPanel(false, false);
            }
            this._resultsPanel = null;
        }
    }

    /**
     * Redraws map labels using the selected distance unit.
     * @param {Object} unit - Distance unit definition
     */
    _updateMapLabels(unit) {
        if (!this.map || this._vertices.length < 2) return;

        const coords = this._vertices;
        const labels = [];

        for (let i = 1; i < coords.length; i++) {
            const dist = calculateSegmentDistance(coords[i - 1], coords[i]);
            const mid = getSegmentMidpoint(coords[i - 1], coords[i]);
            labels.push({ coordinates: mid, text: formatDistance(dist, unit) });
        }

        if (coords.length > 2) {
            const total = calculateLineLength(coords);
            const last = coords[coords.length - 1];
            labels.push({ coordinates: last, text: `Total: ${formatDistance(total, unit)}` });
        }

        updateLabels(this.map, labels);
    }

    /** @param {number[][]} coordinates */
    async _saveAsFeature(coordinates) {
        if (isCurrentMapLockedSync()) {
            showToast('Mapa bloqueado. Desbloqueie para salvar a medição.', 'warning');
            return;
        }

        const layerId = getActiveLayerIdSync();
        const { id: featureId, geoJsonId } = IDUtils.generateFeatureIds();

        const feature = {
            type: 'Feature',
            id: geoJsonId,
            properties: {
                id: featureId,
                source: 'line',
                layerId,
                nome: `Medição ${formatDistanceAuto(calculateLineLength(coordinates))}`,
                descricao: '',
                lineColor: '#ff6600',
                lineWidth: 2.5,
                opacity: 1,
                lineStyle: 'solid',
                measure: true,
                visivel: true,
                bloqueado: false,
                baseCoordinates: coordinates,
            },
            geometry: {
                type: 'LineString',
                coordinates,
            },
        };

        await addFeature('lines', feature);

        const data = await this.map.getSource('lines').getData();
        data.features.push(feature);
        this.map.getSource('lines').setData(data);

        this.deactivate();
        this.toolManager.deactivateCurrentTool();
    }
}

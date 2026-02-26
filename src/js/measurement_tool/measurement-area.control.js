// Path: js/measurement_tool/measurement-area.control.js

/**
 * @module measurement_tool/measurement-area.control
 * @description Ephemeral area measurement tool for 2D map.
 * Click to add polygon vertices, right-click to finalize.
 * After finalize, clicking on the map restarts a new measurement.
 * @dependencies turf (global), maplibregl (global)
 */

import {
    calculatePolygonMetrics,
    getPolygonCentroid,
    formatAreaAuto,
    formatDistanceAuto,
    formatArea,
} from './measurement-geometry.js';
import {
    updateLabels,
    updatePreviewLine,
    updatePreviewFill,
    updateVertices,
    clearAllSources,
} from './measurement-labels.js';
import { createAreaResultsPanel } from './measurement-results-panel.js';
import { addFeature, getActiveLayerIdSync, getControl, isCurrentMapLockedSync } from '@store';
import { IDUtils, showToast } from '@utils';

// ============================================================================
// CONTROL CLASS
// ============================================================================

export class MeasurementAreaControl {
    constructor(toolManager) {
        this.toolManager = toolManager;
        this.map = null;
        this.isActive = false;

        /** @type {number[][]} Collected vertex coordinates [lng, lat] */
        this._vertices = [];
        /** @type {number[]|null} Current cursor position */
        this._cursorPos = null;
        /** @type {HTMLElement|null} Results panel DOM element */
        this._resultsPanel = null;
        /** @type {boolean} Whether measurement has been finalized (awaiting new click to restart) */
        this._finalized = false;

        this._onMapClick = this._onMapClick.bind(this);
        this._onMouseMove = this._onMouseMove.bind(this);
        this._onContextMenu = this._onContextMenu.bind(this);
        this._onDblClick = this._onDblClick.bind(this);
    }

    // --- MapLibre IControl interface ---

    onAdd(map) {
        this.map = map;
        this._container = document.createElement('div');
        return this._container;
    }

    onRemove() {
        this.deactivate();
        this.map = null;
    }

    // --- Tool activation ---

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

    // --- Event handlers ---

    _onMapClick(e) {
        if (!this.isActive) return;

        // Clicking after finalize restarts a new measurement
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
        // Include right-click position as final vertex before finalizing
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

    // --- Visualization ---

    _updateVisualization() {
        if (!this.map) return;

        const coords = [...this._vertices];
        if (this._cursorPos && this.isActive && !this._finalized) {
            coords.push(this._cursorPos);
        }

        // Update vertices
        updateVertices(this.map, this._vertices);

        if (coords.length >= 3) {
            // Show polygon fill + outline
            updatePreviewFill(this.map, coords);
            // Closed ring for outline
            updatePreviewLine(this.map, [...coords, coords[0]]);

            // Area label at centroid
            const { area, perimeter } = calculatePolygonMetrics(coords);
            const centroid = getPolygonCentroid(coords);
            updateLabels(this.map, [{
                coordinates: centroid,
                text: `${formatAreaAuto(area)}\n⌀ ${formatDistanceAuto(perimeter)}`,
            }]);
        } else if (coords.length === 2) {
            // Just show line between first two points
            updatePreviewLine(this.map, coords);
            updatePreviewFill(this.map, []);
            updateLabels(this.map, []);
        } else {
            updatePreviewLine(this.map, []);
            updatePreviewFill(this.map, []);
            updateLabels(this.map, []);
        }
    }

    // --- Finalize ---

    _finalize() {
        if (this._vertices.length < 3) {
            this.deactivate();
            this.toolManager.deactivateCurrentTool();
            return;
        }

        this._finalized = true;

        // Stop rubber-band but keep click listener for restart
        this.map.off('mousemove', this._onMouseMove);
        this.map.getCanvas().style.cursor = '';
        this._cursorPos = null;

        // Final static visualization
        this._updateVisualization();

        // Compute final values
        const { area, perimeter } = calculatePolygonMetrics(this._vertices);

        // Show results panel
        this._showResultsPanel(area, perimeter);
    }

    // --- Restart (new measurement, keeping tool active) ---

    _restart() {
        this._finalized = false;
        this._vertices = [];
        this._cursorPos = null;
        clearAllSources(this.map);
        this._removeResultsPanel();
        this.map.getCanvas().style.cursor = 'crosshair';
        // Re-add mousemove for rubber-band
        this.map.on('mousemove', this._onMouseMove);
    }

    // --- Results panel ---

    _showResultsPanel(area, perimeter) {
        this._removeResultsPanel();

        const vertices = [...this._vertices];

        this._resultsPanel = createAreaResultsPanel({
            area,
            perimeter,
            onSave: isCurrentMapLockedSync() ? null : () => this._saveAsFeature(vertices),
            onClear: () => {
                this.deactivate();
                this.toolManager.deactivateCurrentTool();
            },
            onUnitChange: ({ areaUnit }) => this._updateMapLabels(areaUnit, area, perimeter),
        });

        // Use sidebar's showToolPanel API for proper panel display
        const sidebarControl = getControl('sidebarControl');
        if (sidebarControl?.showToolPanel) {
            sidebarControl.showToolPanel(
                this._resultsPanel,
                'Medição de Área',
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

    // --- Map label update on unit change ---

    /**
     * Redraws the map label using the selected area unit.
     * @param {Object} areaUnit - Area unit definition
     * @param {number} area - Area in m²
     * @param {number} perimeter - Perimeter in meters
     */
    _updateMapLabels(areaUnit, area, perimeter) {
        if (!this.map || this._vertices.length < 3) return;

        const centroid = getPolygonCentroid(this._vertices);
        updateLabels(this.map, [{
            coordinates: centroid,
            text: `${formatArea(area, areaUnit)}\n⌀ ${formatDistanceAuto(perimeter)}`,
        }]);
    }

    // --- Save as feature ---

    async _saveAsFeature(coordinates) {
        if (isCurrentMapLockedSync()) {
            showToast('Mapa bloqueado. Desbloqueie para salvar a medição.', 'warning');
            return;
        }

        const layerId = getActiveLayerIdSync();
        const { id: featureId, geoJsonId } = IDUtils.generateFeatureIds();
        const { area } = calculatePolygonMetrics(coordinates);
        const ring = [...coordinates, coordinates[0]];

        const feature = {
            type: 'Feature',
            id: geoJsonId,
            properties: {
                id: featureId,
                source: 'polygon',
                layerId,
                nome: `Medição ${formatAreaAuto(area)}`,
                descricao: '',
                fillColor: '#ff6600',
                lineColor: '#ff6600',
                lineWidth: 2.5,
                opacity: 0.12,
                lineStyle: 'solid',
                measure: true,
                visivel: true,
                bloqueado: false,
                baseCoordinates: coordinates,
            },
            geometry: {
                type: 'Polygon',
                coordinates: [ring],
            },
        };

        await addFeature('polygons', feature);

        // Push to MapLibre source for immediate rendering
        const data = await this.map.getSource('polygons').getData();
        data.features.push(feature);
        this.map.getSource('polygons').setData(data);

        this.deactivate();
        this.toolManager.deactivateCurrentTool();
    }
}

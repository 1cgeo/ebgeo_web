// Path: js/measurement_tool/measurement-angle.control.js

/**
 * @module measurement_tool/measurement-angle.control
 * @description Ephemeral angle measurement tool for 2D map.
 * 3-click interaction: P1 (ray end) → P2 (vertex) → P3 (ray end).
 * Displays angle arc, rays, and label at the vertex.
 * After finalize, clicking on the map restarts a new measurement.
 * @dependencies turf (global), maplibregl (global)
 */

import {
    calculateAngle,
    generateArcCoordinates,
    getBearing,
    formatAngle,
} from './measurement-geometry.js';
import {
    updateLabels,
    updateVertices,
    updateAngleArc,
    updateAngleRays,
    clearAllSources,
} from './measurement-labels.js';
import { ANGLE_UNITS } from './measurement.constants.js';
import { createAngleResultsPanel } from './measurement-results-panel.js';
import { getControl } from '@store';

// ============================================================================
// CONTROL CLASS
// ============================================================================

export class MeasurementAngleControl {
    constructor(toolManager) {
        this.toolManager = toolManager;
        this.map = null;
        this.isActive = false;

        /** @type {number[][]} Up to 3 collected points: [P1, P2, P3] */
        this._points = [];
        /** @type {number[]|null} Current cursor position */
        this._cursorPos = null;
        /** @type {HTMLElement|null} Results panel */
        this._resultsPanel = null;
        /** @type {boolean} Whether measurement has been finalized (awaiting new click to restart) */
        this._finalized = false;

        this._onMapClick = this._onMapClick.bind(this);
        this._onMouseMove = this._onMouseMove.bind(this);
        this._onContextMenu = this._onContextMenu.bind(this);
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
        this._points = [];
        this._cursorPos = null;
        this._finalized = false;
        this._removeResultsPanel();

        this.map.getCanvas().style.cursor = 'crosshair';
        this.map.on('click', this._onMapClick);
        this.map.on('mousemove', this._onMouseMove);
        this.map.on('contextmenu', this._onContextMenu);
    }

    deactivate() {
        if (!this.map) return;
        this.isActive = false;
        this._finalized = false;

        this.map.getCanvas().style.cursor = '';
        this.map.off('click', this._onMapClick);
        this.map.off('mousemove', this._onMouseMove);
        this.map.off('contextmenu', this._onContextMenu);

        this._points = [];
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
        this._points.push(coord);

        if (this._points.length === 3) {
            this._finalize();
        } else {
            this._updateVisualization();
        }
    }

    _onMouseMove(e) {
        if (!this.isActive || this._points.length === 0) return;

        this._cursorPos = [e.lngLat.lng, e.lngLat.lat];
        this._updateVisualization();
    }

    _onContextMenu(e) {
        e.preventDefault();
        if (this._finalized) return;

        // If 2 points placed, treat right-click as the 3rd point
        if (this._points.length === 2) {
            const coord = [e.lngLat.lng, e.lngLat.lat];
            this._points.push(coord);
            this._finalize();
            return;
        }

        // Otherwise cancel
        this.deactivate();
        this.toolManager.deactivateCurrentTool();
    }

    // --- Visualization ---

    _updateVisualization() {
        if (!this.map) return;

        const pts = [...this._points];
        const cursor = this._cursorPos;

        // Always show vertices
        updateVertices(this.map, pts);

        if (pts.length === 1 && cursor) {
            // Show ray from P1 to cursor
            updateAngleRays(this.map, [[pts[0], cursor]]);
            updateAngleArc(this.map, []);
            updateLabels(this.map, []);
        } else if (pts.length === 2 && cursor) {
            // P1 and P2 placed; show ray P2→P1, rubber-band P2→cursor, arc + label
            const p1 = pts[0];
            const p2 = pts[1]; // vertex
            const p3 = cursor;

            updateAngleRays(this.map, [[p2, p1], [p2, p3]]);

            // Compute angle and arc
            const angleDeg = calculateAngle(p1, p2, p3);
            const bearing1 = getBearing(p2, p1);
            const bearing2 = getBearing(p2, p3);
            const arcRadius = this._getArcRadiusMeters();
            const arcCoords = generateArcCoordinates(p2, bearing1, bearing2, arcRadius);

            updateAngleArc(this.map, arcCoords);

            // Label at arc midpoint
            const defaultUnit = ANGLE_UNITS[0]; // degrees
            const midIndex = Math.floor(arcCoords.length / 2);
            const labelCoord = arcCoords[midIndex] || p2;
            updateLabels(this.map, [{
                coordinates: labelCoord,
                text: formatAngle(angleDeg, defaultUnit),
            }]);
        } else {
            updateAngleRays(this.map, []);
            updateAngleArc(this.map, []);
            updateLabels(this.map, []);
        }
    }

    /**
     * Computes arc radius in meters proportional to current zoom level.
     * Larger radius at lower zoom so the arc is visible.
     * @returns {number} Radius in meters
     */
    _getArcRadiusMeters() {
        if (!this.map) return 100;
        const zoom = this.map.getZoom();
        // ~50px on screen → scale inversely with zoom
        // At zoom 15 ≈ 50m, at zoom 10 ≈ 1500m
        return 50 * Math.pow(2, 15 - zoom);
    }

    // --- Finalize ---

    _finalize() {
        if (this._points.length < 3) {
            this.deactivate();
            this.toolManager.deactivateCurrentTool();
            return;
        }

        this._finalized = true;

        // Stop rubber-band but keep click listener for restart
        this.map.off('mousemove', this._onMouseMove);
        this.map.getCanvas().style.cursor = '';
        this._cursorPos = null;

        const [p1, p2, p3] = this._points;
        const angleDeg = calculateAngle(p1, p2, p3);

        // Final static visualization
        updateVertices(this.map, this._points);
        updateAngleRays(this.map, [[p2, p1], [p2, p3]]);

        const bearing1 = getBearing(p2, p1);
        const bearing2 = getBearing(p2, p3);
        const arcRadius = this._getArcRadiusMeters();
        const arcCoords = generateArcCoordinates(p2, bearing1, bearing2, arcRadius);
        updateAngleArc(this.map, arcCoords);

        const midIndex = Math.floor(arcCoords.length / 2);
        const labelCoord = arcCoords[midIndex] || p2;
        const defaultUnit = ANGLE_UNITS[0];
        updateLabels(this.map, [{
            coordinates: labelCoord,
            text: formatAngle(angleDeg, defaultUnit),
        }]);

        // Show results panel
        this._showResultsPanel(angleDeg);
    }

    // --- Restart (new measurement, keeping tool active) ---

    _restart() {
        this._finalized = false;
        this._points = [];
        this._cursorPos = null;
        clearAllSources(this.map);
        this._removeResultsPanel();
        this.map.getCanvas().style.cursor = 'crosshair';
        // Re-add mousemove for rubber-band
        this.map.on('mousemove', this._onMouseMove);
    }

    // --- Results panel ---

    _showResultsPanel(angleDegrees) {
        this._removeResultsPanel();

        this._resultsPanel = createAngleResultsPanel({
            angleDegrees,
            onClear: () => {
                this.deactivate();
                this.toolManager.deactivateCurrentTool();
            },
        });

        // Use sidebar's showToolPanel API for proper panel display
        const sidebarControl = getControl('sidebarControl');
        if (sidebarControl?.showToolPanel) {
            sidebarControl.showToolPanel(
                this._resultsPanel,
                'Medição de Ângulo',
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
}

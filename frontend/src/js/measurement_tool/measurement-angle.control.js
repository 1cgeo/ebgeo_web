// Path: js/measurement_tool/measurement-angle.control.js

/**
 * @module measurement_tool/measurement-angle.control
 * @description Ephemeral angle measurement tool for 2D map.
 * 3-click interaction: P1 (ray end) -> P2 (vertex) -> P3 (ray end).
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
// Por ARQUIVO, de dois modulos folha: a contagem nao pode participar da ativacao.
import { registrarUso } from '@js/session/uso-lote.js';
import { EventoDeUso } from '@js/session/eventos-de-uso.js';

export class MeasurementAngleControl {
    constructor(toolManager) {
        this.toolManager = toolManager;
        this.map = null;
        this.isActive = false;

        /** @type {number[][]} Up to 3 collected points: [P1, P2, P3] */
        this._points = [];
        /** @type {number[]|null} */
        this._cursorPos = null;
        /** @type {HTMLElement|null} */
        this._resultsPanel = null;
        /** @type {boolean} Whether measurement has been finalized */
        this._finalized = false;

        this._onMapClick = this._onMapClick.bind(this);
        this._onMouseMove = this._onMouseMove.bind(this);
        this._onContextMenu = this._onContextMenu.bind(this);
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
        // A GUARDA ACIMA E O QUE TORNA ISTO UMA CONTAGEM DE ABERTURA: `isActive` ja saiu com
        // `return`, entao reativar a ferramenta que ja esta ativa nao conta de novo. As tres
        // medicoes compartilham este evento de proposito: a pergunta e quanto se mede, e a
        // distincao entre distancia, area e angulo ja vem por `ferramenta.ativada`.
        registrarUso(EventoDeUso.MEDICAO_ABERTA);
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

    _onMapClick(e) {
        if (!this.isActive) return;

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

        // With 2 points placed, treat right-click as the 3rd point
        if (this._points.length === 2) {
            const coord = [e.lngLat.lng, e.lngLat.lat];
            this._points.push(coord);
            this._finalize();
            return;
        }

        this.deactivate();
        this.toolManager.deactivateCurrentTool();
    }

    _updateVisualization() {
        if (!this.map) return;

        const pts = [...this._points];
        const cursor = this._cursorPos;

        updateVertices(this.map, pts);

        if (pts.length === 1 && cursor) {
            updateAngleRays(this.map, [[pts[0], cursor]]);
            updateAngleArc(this.map, []);
            updateLabels(this.map, []);
        } else if (pts.length === 2 && cursor) {
            const [p1, p2] = pts;
            const p3 = cursor;

            updateAngleRays(this.map, [[p2, p1], [p2, p3]]);

            const angleDeg = calculateAngle(p1, p2, p3);
            const bearing1 = getBearing(p2, p1);
            const bearing2 = getBearing(p2, p3);
            const arcRadius = this._getArcRadiusMeters();
            const arcCoords = generateArcCoordinates(p2, bearing1, bearing2, arcRadius);

            updateAngleArc(this.map, arcCoords);

            const defaultUnit = ANGLE_UNITS[0];
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
     * At zoom 15 ~ 50m, at zoom 10 ~ 1500m.
     * @returns {number} Radius in meters
     */
    _getArcRadiusMeters() {
        if (!this.map) return 100;
        const zoom = this.map.getZoom();
        return 50 * Math.pow(2, 15 - zoom);
    }

    _finalize() {
        if (this._points.length < 3) {
            this.deactivate();
            this.toolManager.deactivateCurrentTool();
            return;
        }

        this._finalized = true;

        this.map.off('mousemove', this._onMouseMove);
        this.map.getCanvas().style.cursor = '';
        this._cursorPos = null;

        const [p1, p2, p3] = this._points;
        const angleDeg = calculateAngle(p1, p2, p3);

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

        this._showResultsPanel(angleDeg);
    }

    _restart() {
        this._finalized = false;
        this._points = [];
        this._cursorPos = null;
        clearAllSources(this.map);
        this._removeResultsPanel();
        this.map.getCanvas().style.cursor = 'crosshair';
        this.map.on('mousemove', this._onMouseMove);
    }

    _showResultsPanel(angleDegrees) {
        this._removeResultsPanel();

        this._resultsPanel = createAngleResultsPanel({
            angleDegrees,
            onClear: () => {
                this.deactivate();
                this.toolManager.deactivateCurrentTool();
            },
        });

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

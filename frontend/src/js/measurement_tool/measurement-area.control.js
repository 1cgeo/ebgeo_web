// Path: js/measurement_tool/measurement-area.control.js
import { captureFeatureCreation } from '@tools/helpers/feature-creation-context.js';

/**
 * @module measurement_tool/measurement-area.control
 * @description Ephemeral area measurement tool for 2D map.
 * Click to add polygon vertices, right-click to finalize.
 * After finalize, clicking on the map restarts a new measurement.
 * @dependencies turf (global), maplibregl (global)
 */

import {
    calculatePolygonMetrics,
    calculateSegmentDistance,
    getSegmentMidpoint,
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
import { getControl, isCurrentMapLockedSync } from '@store';
import { getGeoJsonDispatcher } from '@layers/geojson-dispatcher.js';
import { IDUtils, showToast } from '@utils';
// Por ARQUIVO, de dois modulos folha: a contagem nao pode participar da ativacao.
import { registrarUso } from '@js/session/uso-lote.js';
import { EventoDeUso, PropDeUso } from '@js/session/eventos-de-uso.js';
import { DrawingFinishButton } from '@js/draw_tools/drawing-touch-helpers.js';

export class MeasurementAreaControl {
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
        /** @type {number|null} Pending rAF handle for the cursor preview */
        this._previewRafId = null;

        this._onMapClick = this._onMapClick.bind(this);
        this._onMouseMove = this._onMouseMove.bind(this);
        this._onContextMenu = this._onContextMenu.bind(this);
        this._onDblClick = this._onDblClick.bind(this);
        this._runPreviewUpdate = this._runPreviewUpdate.bind(this);
    }

    /**
     * Cancel a preview frame that has not run yet.
     * @private
     */
    _cancelPendingPreview() {
        if (this._previewRafId !== null) {
            cancelAnimationFrame(this._previewRafId);
            this._previewRafId = null;
        }
    }

    /**
     * rAF callback: redraw once per frame with the cursor position last seen.
     * @private
     */
    _runPreviewUpdate() {
        this._previewRafId = null;
        if (!this.isActive) return;
        this._updateVisualization();
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
        this._activationId = (this._activationId ?? 0) + 1;
        if (!this.map || this.isActive) return;
        this.isActive = true;
        // A GUARDA ACIMA E O QUE TORNA ISTO UMA CONTAGEM DE ABERTURA: `isActive` ja saiu com
        // `return`, entao reativar a ferramenta que ja esta ativa nao conta de novo. As tres
        // medicoes compartilham este evento de proposito: a pergunta e quanto se mede, e a
        // distincao entre distancia, area e angulo ja vem por `ferramenta.ativada`.
        registrarUso(EventoDeUso.MEDICAO_ABERTA, PropDeUso.MEDICAO_AREA);
        this._vertices = [];
        this._cursorPos = null;
        this._finalized = false;
        this._removeResultsPanel();

        this.map.getCanvas().style.cursor = 'crosshair';
        this.map.on('click', this._onMapClick);
        this.map.on('mousemove', this._onMouseMove);
        this.map.on('contextmenu', this._onContextMenu);
        this.map.on('dblclick', this._onDblClick);
        this._mostrarBotaoDeConcluir();
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
        this._finishButton?.hide();
        this._finishButton = null;

        this._cancelPendingPreview();
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
        this._finishButton?.updateState(this._vertices.length, 3);
    }

    /**
     * @private O botão de CONCLUIR, que só nasce em aparelho de toque.
     *
     * SEM ELE A MEDIÇÃO NÃO TERMINA COM O DEDO. As duas únicas saídas eram o clique direito e
     * o clique duplo: no iOS o toque longo não emite `contextmenu` (emite o menu nativo de
     * seleção) e o toque duplo não produz `dblclick` de forma confiável com `touch-action`
     * declarado, e no Android o `contextmenu` pode sair, de modo que o comportamento divergia
     * por plataforma sem o código saber. Os rótulos de segmento apareciam a cada toque e o
     * painel de resultado, que é onde moram o total, o salvar e o limpar, nunca chegava.
     *
     * O BOTÃO JÁ EXISTIA, e é o mesmo de cinco ferramentas de desenho: linha, polígono, seta,
     * limite e linha de coordenação. As três medições eram as únicas que desenham ponto a
     * ponto e não o usavam. A de ÂNGULO fica de fora de propósito: ela se fecha sozinha no
     * terceiro toque, então um botão de concluir ali seria um comando sem estado em que valha.
     * @returns {void}
     */
    _mostrarBotaoDeConcluir() {
        this._finishButton = new DrawingFinishButton({
            onFinish: () => {
                // O MESMO CAMINHO DO CLIQUE DIREITO, e não um atalho próprio: `_finalize` é
                // quem desenha o painel de resultado, e duplicar a finalização aqui abriria
                // espaço para as duas divergirem.
                if (!this._finalized) this._finalize();
            },
            onUndo: () => {
                if (this._finalized || this._vertices.length === 0) return;
                this._vertices.pop();
                this._updateVisualization();
                this._finishButton?.updateState(this._vertices.length, 3);
            },
        });
        // `show()` SÓ DESENHA EM APARELHO DE TOQUE (ele pergunta por `isTouchDevice`), então
        // não há gate de papel nem de largura aqui: no desktop a chamada é inócua.
        this._finishButton.show();
        this._finishButton.updateState(this._vertices.length, 3);
    }

    _onMouseMove(e) {
        if (!this.isActive || this._vertices.length === 0) return;

        // Coalesce by frame: _updateVisualization runs turf.area, turf.length,
        // turf.centroid and two turf calls per side, then writes 4 sources. With
        // V vertices that is ~4(V+1)+8 throwaway GeoJSON objects; once per frame
        // draws the same preview as once per event.
        this._cursorPos = [e.lngLat.lng, e.lngLat.lat];
        if (this._previewRafId === null) {
            this._previewRafId = requestAnimationFrame(this._runPreviewUpdate);
        }
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

        updateVertices(this.map, this._vertices);

        if (coords.length >= 3) {
            updatePreviewFill(this.map, coords);
            updatePreviewLine(this.map, [...coords, coords[0]]);

            const { area, perimeter } = calculatePolygonMetrics(coords);
            const centroid = getPolygonCentroid(coords);

            // Area/perimeter label at centroid
            const labels = [{
                coordinates: centroid,
                text: `${formatAreaAuto(area)}\n\u2300 ${formatDistanceAuto(perimeter)}`,
                labelType: 'segment',
            }];

            // Side length labels at each segment midpoint
            const closedCoords = [...coords, coords[0]];
            for (let i = 0; i < closedCoords.length - 1; i++) {
                const dist = calculateSegmentDistance(closedCoords[i], closedCoords[i + 1]);
                const mid = getSegmentMidpoint(closedCoords[i], closedCoords[i + 1]);
                labels.push({ coordinates: mid, text: formatDistanceAuto(dist), labelType: 'segment' });
            }

            updateLabels(this.map, labels);
        } else if (coords.length === 2) {
            updatePreviewLine(this.map, coords);
            updatePreviewFill(this.map, []);
            updateLabels(this.map, []);
        } else {
            updatePreviewLine(this.map, []);
            updatePreviewFill(this.map, []);
            updateLabels(this.map, []);
        }
    }

    _finalize() {
        if (this._vertices.length < 3) {
            this.deactivate();
            this.toolManager.deactivateCurrentTool();
            return;
        }

        this._finalized = true;

        this.map.off('mousemove', this._onMouseMove);
        this.map.getCanvas().style.cursor = '';
        this._cancelPendingPreview();
        this._cursorPos = null;

        this._updateVisualization();

        const { area, perimeter } = calculatePolygonMetrics(this._vertices);
        this._showResultsPanel(area, perimeter);
    }

    _restart() {
        this._finalized = false;
        this._cancelPendingPreview();
        this._vertices = [];
        this._cursorPos = null;
        clearAllSources(this.map);
        this._removeResultsPanel();
        this.map.getCanvas().style.cursor = 'crosshair';
        this.map.on('mousemove', this._onMouseMove);
    }

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

    /**
     * Redraws the map label using the selected area unit.
     * @param {Object} areaUnit - Area unit definition
     * @param {number} area - Area in m2
     * @param {number} perimeter - Perimeter in meters
     */
    _updateMapLabels(areaUnit, area, perimeter) {
        if (!this.map || this._vertices.length < 3) return;

        const centroid = getPolygonCentroid(this._vertices);

        const labels = [{
            coordinates: centroid,
            text: `${formatArea(area, areaUnit)}\n\u2300 ${formatDistanceAuto(perimeter)}`,
            labelType: 'segment',
        }];

        // Side length labels
        const closedCoords = [...this._vertices, this._vertices[0]];
        for (let i = 0; i < closedCoords.length - 1; i++) {
            const dist = calculateSegmentDistance(closedCoords[i], closedCoords[i + 1]);
            const mid = getSegmentMidpoint(closedCoords[i], closedCoords[i + 1]);
            labels.push({ coordinates: mid, text: formatDistanceAuto(dist), labelType: 'segment' });
        }

        updateLabels(this.map, labels);
    }

    /** @param {number[][]} coordinates */
    async _saveAsFeature(coordinates) {
        if (isCurrentMapLockedSync()) {
            showToast('Mapa bloqueado. Desbloqueie para salvar a medição.', 'warning');
            return;
        }

        const activation = this._activationId;
        this._pendingSaves ??= new Set();
        if (this._pendingSaves.has(activation)) return;
        this._pendingSaves.add(activation);
        try {
            const creation = captureFeatureCreation(this);
            const layerId = creation.layerId;
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

            if (!(await creation.save('polygons', feature))) return;
            if (!creation.isCurrent()) return;

            // Through the dispatcher, not a read-modify-write on `polygons`: the source is
            // dispatcher-owned, so a raw `setData` would replace MapLibre's pending-update slot and
            // silently drop whatever the polygon or azimuth tool had queued. A single append also has
            // nothing to read back for.
            const dispatcher = getGeoJsonDispatcher(this.map, 'polygons');
            dispatcher.add(feature);
            await dispatcher.flush();

            if (creation.isActiveTool()) this.toolManager.deactivateCurrentTool();
        } finally {
            this._pendingSaves.delete(activation);
        }
    }
}

// Path: js/import_export/pdf-export.tab.js
import { showError } from '@utils/toast_service.js'
// GDAL entra SOB DEMANDA, e nao mais por `<script>` no `index.html`. Eram 187 kB
// que a pagina do mapa baixava em toda carga sem ninguem ler no boot. O `/* global
// initGdalJs */` que estava aqui saiu junto: o global agora chega pelo retorno de
// `ensureGdal()`, e nao por uma tag que o eslint precisava aprender de cor.
import { ensureGdal } from '@utils/gdal-loader.js'
import { ensureTurf } from '@utils/turf-loader.js'
import {
    correctZoomInvariantFeatures,
    transferMapImages,
    createExportProgressModal,
    getCleanMapStyle,
} from './export-utils.js'
import {
    GRID_MARGIN_MM,
    UTM_MAX_SCALE_DENOM,
    parseScaleDenom,
    MOSAIC_MAX_DIM,
    MOSAIC_WARN_TILES,
    MOSAIC_OVERLAP_MM,
} from './pdf-export.constants.js'
import {
    computeMosaicZoom,
    pageMercatorSpan,
    pageContainerCssPx,
    computeTileCenters,
    computeMosaicBounds,
    tileBounds,
} from './pdf-mosaic-geometry.js'
// Static import: pdf-cartographic-elements is already pinned to the import-export
// chunk by pdf-mosaic-export.js (static import), so a dynamic import here would not
// split it into a separate chunk — it only triggered a Rollup mixed-import warning.
// Cartographic layout is composed on every PDF export (see "Always compose" below).
import { composeLayout, loadLogoImage } from './pdf-cartographic-elements.js'
import { isMapTemporalEnabledSync, getControl } from '@store'
import { isTemporallyVisible } from '@js/temporal/temporal-model.js'
// Por ARQUIVO, de dois modulos folha. A `prop` separa os DOIS motores do mesmo painel: `folha` e
// o caminho do GDAL (saida georreferenciada) e `mosaico` e o do jsPDF, que nao georreferencia.
import { registrarUso } from '@js/session/uso-lote.js'
import { EventoDeUso, PropDeUso } from '@js/session/eventos-de-uso.js'
import { maplibregl } from '@js/map/maplibre.js'

export default class PDFExportTab {
    constructor(map) {
        this.map = map;
        this.orientation = 'landscape';
        this.scale = '1:25000';
        this.previewLayer = null;
        this.isVisible = false;

        this.marginMM = 5;
        this.paperBounds = null;
        this.usableBounds = null;

        // Mosaic (multi-page) options. rows×cols > 1 switches to full-bleed,
        // multi-page jsPDF export with double-sided assembly aids.
        this.rows = 1;
        this.cols = 1;

        // Cartographic layout options
        this.showTitle = false;
        this.mapTitle = '';
        this.showLegend = false;
        this.showScaleBar = false;
        this.showNorthArrow = false;
        this.showLatLongGrid = false;
        this.showUTMGrid = false;

        // Extra margin (mm) for grid labels. Added to marginMM when any grid is on.
        this._gridMarginMM = GRID_MARGIN_MM;

        // DPI quality option
        this.dpi = 300;
        this.availableDPI = [
            { value: 150, label: '150 DPI (rascunho)' },
            { value: 200, label: '200 DPI (normal)' },
            { value: 300, label: '300 DPI (alta qualidade)' },
        ];

        // GDAL pre-initialization flag
        this._gdalPreInitStarted = false;

        this.availableScales = [
            { value: '1:1000', label: '1:1.000' },
            { value: '1:5000', label: '1:5.000' },
            { value: '1:10000', label: '1:10.000' },
            { value: '1:25000', label: '1:25.000' },
            { value: '1:50000', label: '1:50.000' },
            { value: '1:100000', label: '1:100.000' },
            { value: '1:250000', label: '1:250.000' },
            { value: '1:500000', label: '1:500.000' },
            { value: '1:1000000', label: '1:1.000.000' },
            { value: '1:2500000', label: '1:2.500.000' },
            { value: '1:5000000', label: '1:5.000.000' }
        ];

        this.onOrientationChange = this.onOrientationChange.bind(this);
        this.onScaleChange = this.onScaleChange.bind(this);
        this.onDPIChange = this.onDPIChange.bind(this);
        this.onRowsChange = this.onRowsChange.bind(this);
        this.onColsChange = this.onColsChange.bind(this);
        this.onExportClick = this.onExportClick.bind(this);
        this.onMapMove = this.onMapMove.bind(this);
        this._onStyleData = this._onStyleData.bind(this);
    }

    /**
     * Re-adds the preview after a base-layer change. setStyle() destroys all custom
     * sources/layers; this restores them while the tab is open. Registered in show()
     * and removed in hide() so the listener stays detachable (no app-lifetime leak).
     */
    _onStyleData() {
        if (this.isVisible && !this.map.getSource('pdf-export-preview')) {
            this.showPreview();
            this.updateBounds();
        }
    }

    createUI() {
        const scaleOptions = this.availableScales.map(scale =>
            `<option value="${scale.value}" ${scale.value === this.scale ? 'selected' : ''}>${scale.label}</option>`
        ).join('');

        const dpiOptions = this.availableDPI.map(dpi =>
            `<option value="${dpi.value}" ${dpi.value === this.dpi ? 'selected' : ''}>${dpi.label}</option>`
        ).join('');

        const dimOptions = (selected) => {
            let out = '';
            for (let n = 1; n <= MOSAIC_MAX_DIM; n++) {
                out += `<option value="${n}" ${n === selected ? 'selected' : ''}>${n}</option>`;
            }
            return out;
        };

        return `
            <div class="pdf-export-container">
                <div class="scale-selector">
                    <label for="pdf-scale-select" class="scale-label">Escala:</label>
                    <select id="pdf-scale-select" class="scale-select">
                        ${scaleOptions}
                    </select>
                </div>

                <div class="dpi-selector">
                    <label for="pdf-dpi-select" class="dpi-label">Qualidade:</label>
                    <select id="pdf-dpi-select" class="dpi-select">
                        ${dpiOptions}
                    </select>
                </div>

                <div class="orientation-selector">
                    <label>
                        <input type="radio" name="pdf-orientation" value="landscape" checked>
                        Paisagem (A4)
                    </label>
                    <label>
                        <input type="radio" name="pdf-orientation" value="portrait">
                        Retrato (A4)
                    </label>
                </div>

                <div class="pdf-mosaic-section">
                    <div class="pdf-mosaic-title">Mosaico (várias páginas)</div>
                    <div class="pdf-mosaic-dims">
                        <label class="pdf-mosaic-dim">
                            <span>Linhas</span>
                            <select id="pdf-rows-select" class="pdf-mosaic-select">
                                ${dimOptions(this.rows)}
                            </select>
                        </label>
                        <label class="pdf-mosaic-dim">
                            <span>Colunas</span>
                            <select id="pdf-cols-select" class="pdf-mosaic-select">
                                ${dimOptions(this.cols)}
                            </select>
                        </label>
                    </div>
                    <div class="pdf-mosaic-count" id="pdf-mosaic-count">1 folha A4</div>
                    <div class="pdf-mosaic-hint" id="pdf-mosaic-hint">
                        Imprima em <strong>frente e verso</strong>, em tamanho real. As folhas
                        compartilham uma <strong>sobreposição de ${MOSAIC_OVERLAP_MM} mm</strong>
                        nas emendas: corte cada folha pela linha vermelha do verso,
                        <strong>no meio da faixa repetida</strong>, e ponha por baixo da
                        vizinha — assim a margem que a impressora não imprime some e não fica
                        <strong>faixa branca</strong>. A capa traz o passo a passo e o verso traz as
                        etiquetas de montagem (com o mapa para baixo). Ligue a
                        <strong>Grade Lat/Long ou UTM</strong> para emoldurar o perímetro com as
                        coordenadas. Título, legenda, barra de escala e seta-norte são posicionados
                        como se o mosaico fosse um único mapa (podem cair divididos entre folhas).
                    </div>
                </div>

                <div class="pdf-cartographic-section">
                    <div class="pdf-cartographic-title">Elementos Cartográficos</div>

                    <label class="pdf-cartographic-option">
                        <input type="checkbox" id="pdf-show-title">
                        Título do mapa
                    </label>
                    <input type="text" id="pdf-map-title" class="pdf-title-input" placeholder="Título do mapa..." disabled>

                    <label class="pdf-cartographic-option">
                        <input type="checkbox" id="pdf-show-legend">
                        Legenda
                    </label>

                    <label class="pdf-cartographic-option">
                        <input type="checkbox" id="pdf-show-scalebar">
                        Barra de escala
                    </label>

                    <label class="pdf-cartographic-option">
                        <input type="checkbox" id="pdf-show-north">
                        Seta norte
                    </label>

                    <label class="pdf-cartographic-option">
                        <input type="checkbox" id="pdf-show-latlong-grid">
                        Grade Lat/Long
                    </label>

                    <label class="pdf-cartographic-option">
                        <input type="checkbox" id="pdf-show-utm-grid">
                        Grade UTM
                    </label>
                </div>

                <button id="pdf-export-btn" class="export-pdf-btn pure-material-button-contained">
                    Exportar PDF
                </button>
            </div>
        `;
    }

    show() {
        this.isVisible = true;
        this.showPreview();
        this.updateBounds();
        this.attachEventListeners();

        this.zoomToPreviewArea();

        this.map.on('move', this.onMapMove);
        this.map.on('styledata', this._onStyleData);

        // Pre-initialize GDAL WASM in background so it's ready when user clicks export
        this._preInitGdal();
    }

    hide() {
        this.isVisible = false;
        clearTimeout(this.updateTimeout);
        this.hidePreview();
        this.detachEventListeners();

        this.map.off('move', this.onMapMove);
        this.map.off('styledata', this._onStyleData);
    }

    attachEventListeners() {
        const scaleSelect = document.getElementById('pdf-scale-select');
        if (scaleSelect) {
            scaleSelect.addEventListener('change', this.onScaleChange);
        }

        const dpiSelect = document.getElementById('pdf-dpi-select');
        if (dpiSelect) {
            dpiSelect.addEventListener('change', this.onDPIChange);
        }

        const orientationInputs = document.querySelectorAll('input[name="pdf-orientation"]');
        for (const input of orientationInputs) {
            input.addEventListener('change', this.onOrientationChange);
        }

        const rowsSelect = document.getElementById('pdf-rows-select');
        if (rowsSelect) {
            rowsSelect.addEventListener('change', this.onRowsChange);
        }

        const colsSelect = document.getElementById('pdf-cols-select');
        if (colsSelect) {
            colsSelect.addEventListener('change', this.onColsChange);
        }

        const exportBtn = document.getElementById('pdf-export-btn');
        if (exportBtn) {
            exportBtn.addEventListener('click', this.onExportClick);
        }

        // Cartographic options
        this._attachCartographicListeners();
        this._updateMosaicUIState();
    }

    detachEventListeners() {
        const scaleSelect = document.getElementById('pdf-scale-select');
        if (scaleSelect) {
            scaleSelect.removeEventListener('change', this.onScaleChange);
        }

        const dpiSelect = document.getElementById('pdf-dpi-select');
        if (dpiSelect) {
            dpiSelect.removeEventListener('change', this.onDPIChange);
        }

        const orientationInputs = document.querySelectorAll('input[name="pdf-orientation"]');
        for (const input of orientationInputs) {
            input.removeEventListener('change', this.onOrientationChange);
        }

        const rowsSelect = document.getElementById('pdf-rows-select');
        if (rowsSelect) {
            rowsSelect.removeEventListener('change', this.onRowsChange);
        }

        const colsSelect = document.getElementById('pdf-cols-select');
        if (colsSelect) {
            colsSelect.removeEventListener('change', this.onColsChange);
        }

        const exportBtn = document.getElementById('pdf-export-btn');
        if (exportBtn) {
            exportBtn.removeEventListener('click', this.onExportClick);
        }
    }

    _attachCartographicListeners() {
        const titleCheckbox = document.getElementById('pdf-show-title');
        const titleInput = document.getElementById('pdf-map-title');
        const legendCheckbox = document.getElementById('pdf-show-legend');
        const scalebarCheckbox = document.getElementById('pdf-show-scalebar');
        const northCheckbox = document.getElementById('pdf-show-north');

        if (titleCheckbox) {
            titleCheckbox.addEventListener('change', (e) => {
                this.showTitle = e.target.checked;
                if (titleInput) {
                    titleInput.disabled = !e.target.checked;
                }
            });
        }
        if (titleInput) {
            titleInput.addEventListener('input', (e) => {
                this.mapTitle = e.target.value;
            });
        }
        if (legendCheckbox) {
            legendCheckbox.addEventListener('change', (e) => {
                this.showLegend = e.target.checked;
            });
        }
        if (scalebarCheckbox) {
            scalebarCheckbox.addEventListener('change', (e) => {
                this.showScaleBar = e.target.checked;
            });
        }
        if (northCheckbox) {
            northCheckbox.addEventListener('change', (e) => {
                this.showNorthArrow = e.target.checked;
            });
        }

        const latlongGridCheckbox = document.getElementById('pdf-show-latlong-grid');
        const utmGridCheckbox = document.getElementById('pdf-show-utm-grid');

        if (latlongGridCheckbox) {
            latlongGridCheckbox.addEventListener('change', (e) => {
                this.showLatLongGrid = e.target.checked;
            });
        }
        if (utmGridCheckbox) {
            utmGridCheckbox.addEventListener('change', (e) => {
                this.showUTMGrid = e.target.checked;
            });
        }

        // Enforce UTM availability for the initial scale
        this._enforceUTMGridAvailability();
    }

    onDPIChange(event) {
        this.dpi = parseInt(event.target.value, 10);
    }

    onScaleChange(event) {
        this.scale = event.target.value;
        this._enforceUTMGridAvailability();
        this.updateBounds();
        this.zoomToPreviewArea();
    }

    /**
     * Disables UTM grid option for scales where UTM is not meaningful
     * (1:2.500.000 and 1:5.000.000).
     */
    _enforceUTMGridAvailability() {
        const scaleDenom = this._parseScaleDenom();
        const utmCheckbox = document.getElementById('pdf-show-utm-grid');
        if (!utmCheckbox) return;

        const utmDisabled = scaleDenom >= UTM_MAX_SCALE_DENOM;
        utmCheckbox.disabled = utmDisabled;
        if (utmDisabled && utmCheckbox.checked) {
            utmCheckbox.checked = false;
            this.showUTMGrid = false;
        }
    }

    onOrientationChange(event) {
        this.orientation = event.target.value;
        this.updateBounds();
        this.zoomToPreviewArea();
    }

    onRowsChange(event) {
        this.rows = this._clampDim(event.target.value);
        this._afterDimChange();
    }

    onColsChange(event) {
        this.cols = this._clampDim(event.target.value);
        this._afterDimChange();
    }

    /** Parses and clamps a dimension select value to [1, MOSAIC_MAX_DIM]. */
    _clampDim(value) {
        const n = parseInt(value, 10) || 1;
        return Math.min(MOSAIC_MAX_DIM, Math.max(1, n));
    }

    /** Refreshes preview and dependent UI after a rows/cols change. */
    _afterDimChange() {
        this._updateMosaicUIState();
        this.updateBounds();
        this.zoomToPreviewArea();
    }

    /** Whether the current selection spans more than one A4 page. */
    get isMosaic() {
        return this.rows * this.cols > 1;
    }

    /**
     * Reflects mosaic state in the panel: shows the assembly hint and updates the
     * sheet count + export button label. Title/legend/scale bar/north arrow are
     * positioned across the whole mosaic (as if it were a single map), so they stay
     * available in mosaic mode.
     */
    _updateMosaicUIState() {
        const mosaic = this.isMosaic;
        const total = this.rows * this.cols;

        const countEl = document.getElementById('pdf-mosaic-count');
        if (countEl) {
            countEl.textContent = total === 1 ? '1 folha A4' : `${total} folhas A4 (${this.rows}×${this.cols})`;
        }

        const hintEl = document.getElementById('pdf-mosaic-hint');
        if (hintEl) {
            hintEl.classList.toggle('pdf-mosaic-hint--visible', mosaic);
        }

        const exportBtn = document.getElementById('pdf-export-btn');
        if (exportBtn) {
            exportBtn.textContent = mosaic ? 'Exportar mosaico PDF' : 'Exportar PDF';
        }
    }

    /**
     * Public method to update the preview when settings change externally.
     * Called by ExportTab when scale or orientation is changed from sidebar UI.
     */
    updatePreview() {
        if (this.isVisible) {
            this.updateBounds();
            this.zoomToPreviewArea();
        }
    }

    /**
     * Get the visible center of the map, accounting for sidebar offset.
     * When sidebar is open (376px width), the visible map area is offset to the right.
     * @returns {{lng: number, lat: number}} The visible center coordinates
     */
    getVisibleCenter() {
        const container = this.map.getContainer();
        const containerWidth = container.clientWidth;
        const containerHeight = container.clientHeight;

        const sidebarOffset = this.getSidebarOffset();

        // Calculate the center of the visible map area (excluding sidebar)
        const visibleWidth = containerWidth - sidebarOffset;
        const visibleCenterX = sidebarOffset + (visibleWidth / 2);
        const visibleCenterY = containerHeight / 2;

        // Convert pixel coordinates to map coordinates
        const centerPoint = this.map.unproject([visibleCenterX, visibleCenterY]);

        return { lng: centerPoint.lng, lat: centerPoint.lat };
    }

    onMapMove() {
        if (this.isVisible) {
            clearTimeout(this.updateTimeout);
            this.updateTimeout = setTimeout(() => {
                this.updateBounds();
            }, 100);
        }
    }

    /**
     * Calculates the paper and usable bounds for a given scale at a specific center point.
     * @param {string} scale - Scale string like "1:25000"
     * @param {string} orientation - "landscape" or "portrait"
     * @param {Object} center - Center point with lng and lat properties
     * @returns {Object} Object with paper and usable bounds
     */
    calculateBoundsFromScaleAtCenter(scale, orientation, center) {
        const denominator = this._parseScaleDenom(scale);

        const isLandscape = orientation === 'landscape';
        const [longSide, shortSide] = [297, 210];
        const realWidthMeters = ((isLandscape ? longSide : shortSide) / 1000) * denominator;
        const realHeightMeters = ((isLandscape ? shortSide : longSide) / 1000) * denominator;

        const latCorrection = Math.cos(center.lat * Math.PI / 180);

        const heightDegrees = realHeightMeters / 111320;
        const widthDegrees = realWidthMeters / (111320 * latCorrection);

        const offsetLat = heightDegrees / 2;
        const offsetLng = widthDegrees / 2;

        const paper = {
            topLeft: [center.lng - offsetLng, center.lat + offsetLat],
            topRight: [center.lng + offsetLng, center.lat + offsetLat],
            bottomRight: [center.lng + offsetLng, center.lat - offsetLat],
            bottomLeft: [center.lng - offsetLng, center.lat - offsetLat]
        };

        const marginDegrees = this.convertMMToMapUnitsFromScale(this.effectiveMarginMM, scale);

        const usable = {
            topLeft: [paper.topLeft[0] + marginDegrees / latCorrection, paper.topLeft[1] - marginDegrees],
            topRight: [paper.topRight[0] - marginDegrees / latCorrection, paper.topRight[1] - marginDegrees],
            bottomRight: [paper.bottomRight[0] - marginDegrees / latCorrection, paper.bottomRight[1] + marginDegrees],
            bottomLeft: [paper.bottomLeft[0] + marginDegrees / latCorrection, paper.bottomLeft[1] + marginDegrees]
        };

        return { paper, usable };
    }

    convertMMToMapUnitsFromScale(marginMM, scale) {
        const denominator = this._parseScaleDenom(scale);
        const marginMeters = (marginMM / 1000) * denominator;
        return marginMeters / 111320;
    }

    updateBounds() {
        const center = this.getVisibleCenter();
        this.updateBoundsAtCenter(center);
    }

    /**
     * Updates the preview bounds centered at a specific point.
     * Preview is always axis-aligned (north-up) because the exported PDF
     * is always rendered north-up for correct GDAL georeferencing.
     * @param {Object} center - The center point with lng and lat properties
     */
    updateBoundsAtCenter(center) {
        if (this.isMosaic) {
            this._updateMosaicBoundsAtCenter(center);
            return;
        }

        const bounds = this.calculateBoundsFromScaleAtCenter(this.scale, this.orientation, center);

        // Preview is always north-up — no rotation applied.
        // The export renders the hidden map north-up so GDAL's -a_ullr
        // produces correct georeferencing.
        this.paperBounds = bounds.paper;
        this.usableBounds = bounds.usable;

        const paperFeature = {
            type: 'Feature',
            properties: { type: 'paper', orientation: this.orientation, scale: this.scale },
            geometry: {
                type: 'Polygon',
                coordinates: [[
                    this.paperBounds.topLeft,
                    this.paperBounds.topRight,
                    this.paperBounds.bottomRight,
                    this.paperBounds.bottomLeft,
                    this.paperBounds.topLeft
                ]]
            }
        };

        const usableFeature = {
            type: 'Feature',
            properties: { type: 'usable', orientation: this.orientation, scale: this.scale },
            geometry: {
                type: 'Polygon',
                coordinates: [[
                    this.usableBounds.topLeft,
                    this.usableBounds.topRight,
                    this.usableBounds.bottomRight,
                    this.usableBounds.bottomLeft,
                    this.usableBounds.topLeft
                ]]
            }
        };

        const source = this.map.getSource('pdf-export-preview');
        if (source) {
            source.setData({
                type: 'FeatureCollection',
                features: [paperFeature, usableFeature]
            });
        }
    }

    /**
     * Builds the multi-page mosaic preview: one rectangle per A4 tile, laid out
     * with the same Mercator geometry the export uses (so the preview matches the
     * printed result exactly). Also sets paperBounds to the whole mosaic so
     * zoomToPreviewArea() frames the full area.
     * @param {{lng:number, lat:number}} center
     */
    _updateMosaicBoundsAtCenter(center) {
        const span = this._mosaicPageSpan(center.lat);
        const tiles = computeTileCenters({
            rows: this.rows, cols: this.cols,
            centerLng: center.lng, centerLat: center.lat,
            pageMercW: span.width, pageMercH: span.height,
            overlapMercW: span.overlap, overlapMercH: span.overlap,
        });

        const features = tiles.map(t => {
            const b = tileBounds({
                centerLng: t.centerLng, centerLat: t.centerLat,
                pageMercW: span.width, pageMercH: span.height,
            });
            return {
                type: 'Feature',
                properties: { type: 'paper', row: t.row, col: t.col },
                geometry: {
                    type: 'Polygon',
                    coordinates: [[
                        [b.west, b.north], [b.east, b.north],
                        [b.east, b.south], [b.west, b.south],
                        [b.west, b.north],
                    ]],
                },
            };
        });

        const mb = computeMosaicBounds({
            centerLng: center.lng, centerLat: center.lat,
            rows: this.rows, cols: this.cols,
            pageMercW: span.width, pageMercH: span.height,
            overlapMercW: span.overlap, overlapMercH: span.overlap,
        });
        this.paperBounds = {
            topLeft: [mb.west, mb.north], topRight: [mb.east, mb.north],
            bottomRight: [mb.east, mb.south], bottomLeft: [mb.west, mb.south],
        };
        this.usableBounds = this.paperBounds;

        const source = this.map.getSource('pdf-export-preview');
        if (source) {
            source.setData({ type: 'FeatureCollection', features });
        }
    }

    /**
     * Per-page Mercator span (width/height in metres) and the seam overlap (metres)
     * at the current scale, orientation and the given latitude. Shared by preview
     * and (implicitly) the export, which recomputes the same values.
     * @param {number} lat - Centre latitude
     * @returns {{ width: number, height: number, overlap: number }}
     */
    _mosaicPageSpan(lat) {
        const [pageWmm, pageHmm] = this.orientation === 'landscape' ? [297, 210] : [210, 297];
        const zoom = computeMosaicZoom(this._parseScaleDenom(), lat);
        const span = pageMercatorSpan(zoom, pageContainerCssPx(pageWmm), pageContainerCssPx(pageHmm));
        // Seam overlap (Mercator metres) so the preview tiles overlap exactly like
        // the exported sheets do.
        const overlapCss = pageContainerCssPx(MOSAIC_OVERLAP_MM);
        const overlap = pageMercatorSpan(zoom, overlapCss, overlapCss).width;
        return { width: span.width, height: span.height, overlap };
    }

    zoomToPreviewArea() {
        if (!this.paperBounds) return;

        // Preview is always axis-aligned, so bottomLeft/topRight are the bbox
        const sw = this.paperBounds.bottomLeft;
        const ne = this.paperBounds.topRight;

        // Calculate sidebar offset for asymmetric padding
        const sidebarOffset = this.getSidebarOffset();

        this.map.fitBounds([sw, ne], {
            padding: {
                top: 50,
                bottom: 50,
                left: sidebarOffset + 50,
                right: 50
            },
            duration: 1000
        });
    }

    /**
     * Gets the current sidebar offset in pixels.
     * @returns {number} Sidebar width in pixels
     */
    getSidebarOffset() {
        const panelElement = document.querySelector('.sidebar-panel[data-expanded="true"]');
        if (panelElement) {
            return 376; // Sidebar (56px) + panel (320px)
        }

        const featurePanel = document.querySelector('.feature-panel[data-expanded="true"]');
        if (featurePanel) {
            return 376;
        }

        return 56; // Just collapsed sidebar
    }

    showPreview() {
        if (!this.map.getSource('pdf-export-preview')) {
            this.map.addSource('pdf-export-preview', {
                type: 'geojson',
                data: { type: 'FeatureCollection', features: [] }
            });
        }

        if (!this.map.getLayer('pdf-export-preview-fill')) {
            this.map.addLayer({
                id: 'pdf-export-preview-fill',
                type: 'fill',
                source: 'pdf-export-preview',
                filter: ['==', 'type', 'paper'],
                paint: {
                    'fill-color': '#508D4E',
                    'fill-opacity': 0.15
                }
            });
        }

        if (!this.map.getLayer('pdf-export-preview-stroke')) {
            this.map.addLayer({
                id: 'pdf-export-preview-stroke',
                type: 'line',
                source: 'pdf-export-preview',
                filter: ['==', 'type', 'paper'],
                paint: {
                    'line-color': '#508D4E',
                    'line-width': 2,
                    'line-dasharray': [8, 4]
                }
            });
        }

        if (!this.map.getLayer('pdf-export-usable-stroke')) {
            this.map.addLayer({
                id: 'pdf-export-usable-stroke',
                type: 'line',
                source: 'pdf-export-preview',
                filter: ['==', 'type', 'usable'],
                paint: {
                    'line-color': '#508D4E',
                    'line-width': 2,
                    'line-dasharray': [1]
                }
            });
        }
    }

    hidePreview() {
        const layerIds = [
            'pdf-export-preview-fill', 'pdf-export-preview-stroke',
            'pdf-export-usable-stroke'
        ];

        for (const layerId of layerIds) {
            if (this.map.getLayer(layerId)) {
                this.map.removeLayer(layerId);
            }
        }

        if (this.map.getSource('pdf-export-preview')) {
            this.map.removeSource('pdf-export-preview');
        }
    }

    getCleanStyle() {
        try {
            return getCleanMapStyle(this.map);
        } catch (error) {
            console.error('Error creating clean style:', error);
            return this.map.getStyle();
        }
    }

    showExportModal() {
        this._exportCancelled = false;
        this._progress = createExportProgressModal({
            title: 'Exportando mapa...',
            onCancel: () => { this._exportCancelled = true; },
        });
        return this._progress;
    }

    updateProgress(percent, text) {
        if (this._progress) {
            this._progress.updateProgress(percent, text);
        }
    }

    /**
     * Whether UTM grid is effectively enabled (disabled at scales >= 1:2.500.000).
     * @returns {boolean}
     */
    get isUTMGridAllowed() {
        return this.showUTMGrid && this._parseScaleDenom() < UTM_MAX_SCALE_DENOM;
    }

    /**
     * Total effective margin in mm. Includes grid label margin when any grid is on.
     * @returns {number}
     */
    get effectiveMarginMM() {
        return (this.showLatLongGrid || this.isUTMGridAllowed)
            ? this.marginMM + this._gridMarginMM
            : this.marginMM;
    }

    /**
     * Whether any grid overlay is enabled.
     * @returns {boolean}
     */
    get hasGrids() {
        return this.showLatLongGrid || this.isUTMGridAllowed;
    }

    calculateA4PixelSize() {
        const targetDPI = this.dpi;
        // Ratio between print DPI and screen DPI (~96).
        // Using a higher pixelRatio with a proportionally smaller container
        // makes MapLibre render tile labels larger, improving print legibility.
        // 300/96 ≈ 3.125 so labels on the PDF match their physical screen size.
        const printScaleFactor = targetDPI / 96;
        // When grids are enabled, the effective margin is larger to accommodate labels.
        // composeLayout() bakes these margins into the canvas, so GDAL MARGIN=0.
        const marginMM = this.effectiveMarginMM;

        const isLandscape = this.orientation === 'landscape';
        const usableWidthMM = (isLandscape ? 297 : 210) - (2 * marginMM);
        const usableHeightMM = (isLandscape ? 210 : 297) - (2 * marginMM);

        const usableWidthInches = usableWidthMM / 25.4;
        const usableHeightInches = usableHeightMM / 25.4;

        // Full output dimensions at target DPI
        const outputWidth = Math.round(usableWidthInches * targetDPI);
        const outputHeight = Math.round(usableHeightInches * targetDPI);

        return {
            width: outputWidth,
            height: outputHeight,
            // Smaller container; MapLibre canvas = container * pixelRatio ≈ output
            containerWidth: Math.round(outputWidth / printScaleFactor),
            containerHeight: Math.round(outputHeight / printScaleFactor),
            pixelRatio: printScaleFactor,
        };
    }

    /**
     * Runs the multi-page mosaic export via the jsPDF pipeline. The hidden map,
     * tile rendering and PDF assembly live in pdf-mosaic-export.js (lazy-loaded);
     * this method owns the progress modal and cancellation flag.
     */
    async _runMosaicExport() {
        this.showExportModal();
        this.updateProgress(5, 'Inicializando...');

        try {
            const total = this.rows * this.cols;
            if (total > MOSAIC_WARN_TILES) {
                this.updateProgress(5, `Mosaico grande (${total} folhas) — isso pode levar um tempo...`);
            }

            const { exportMosaicPdf } = await import('./pdf-mosaic-export.js');

            // Collect legend stats over the WHOLE mosaic area (usableBounds spans the
            // full mosaic in mosaic mode) so the legend reflects the assembled map.
            const featuresByType = this.showLegend
                ? await this._collectFeatureStats(this._buildExportBoundsPolygon())
                : {};

            const ok = await exportMosaicPdf({
                map: this.map,
                cleanStyle: this.getCleanStyle(),
                center: this.getVisibleCenter(),
                scale: this.scale,
                dpi: this.dpi,
                orientation: this.orientation,
                rows: this.rows,
                cols: this.cols,
                showLatLongGrid: this.showLatLongGrid,
                showUTMGrid: this.isUTMGridAllowed,
                showLegend: this.showLegend,
                showScaleBar: this.showScaleBar,
                showNorthArrow: this.showNorthArrow,
                featuresByType,
                title: this.showTitle ? this.mapTitle : '',
                includeCover: true,
                includeVerso: true,
                updateProgress: (percent, text) => this.updateProgress(percent, text),
                isCancelled: () => this._exportCancelled,
            });

            if (ok) {
                // DENTRO DO `ok`, e nao depois do `try`: `exportMosaicPdf` devolve falso quando a
                // pessoa CANCELA no meio, e um mosaico cancelado nao e um PDF exportado.
                registrarUso(EventoDeUso.PDF_EXPORTADO, PropDeUso.PDF_MOSAICO);
                // Capture the modal locally so a quick second export (which reassigns
                // this._progress) is not dismissed by this stale timeout.
                const progress = this._progress;
                setTimeout(() => progress?.remove(), 800);
            } else {
                this._progress?.remove();
            }
        } catch (error) {
            if (!this._exportCancelled) {
                console.error('Error exporting mosaic PDF:', error);
                showError('Não foi possível exportar o mosaico: ' + error.message);
            }
            this._progress?.remove();
        }
    }

    async onExportClick() {
        // Prevent concurrent exports
        if (this._exporting) return;
        this._exporting = true;

        // O TURF DA LEGENDA, e ele vem DEPOIS da trava `_exporting`, nao antes.
        //
        // Os cinco sitios de Turf deste arquivo estao em `_buildExportBoundsPolygon` e
        // `_featureIntersectsBounds`, os dois SINCRONOS e chamados no meio do desenho da
        // legenda, tanto no caminho de folha unica quanto no de mosaico. Este metodo e o
        // unico ponto por onde os dois passam.
        //
        // A ORDEM COM A TRAVA E O QUE IMPORTA. Um `await` acrescentado ANTES de
        // `this._exporting = true` abriria uma janela entre o primeiro clique e a trava, e
        // dois cliques rapidos no botao entrariam os dois na exportacao. A trava e o
        // `disabled` do botao continuam sendo a primeira coisa que este metodo faz, de forma
        // sincrona, e o `await` so entra depois de a porta estar fechada.
        await ensureTurf().catch((erro) => {
            // Turf ausente degrada a LEGENDA, e nao a exportacao: `_buildExportBoundsPolygon`
            // devolve null no catch dele, e o filtro espacial cai para "conta todas". Parar a
            // exportacao aqui seria pior do que uma legenda mais larga.
            console.warn('Turf nao carregou para o filtro espacial da legenda:', erro);
        });

        const exportBtn = document.getElementById('pdf-export-btn');
        if (exportBtn) exportBtn.disabled = true;

        // Multi-page mosaic uses a separate, full-bleed jsPDF pipeline.
        if (this.isMosaic) {
            try {
                await this._runMosaicExport();
            } finally {
                this._exporting = false;
                this._exportCancelled = false;
                const btn = document.getElementById('pdf-export-btn');
                if (btn) btn.disabled = false;
            }
            return;
        }

        let hiddenMapContainer;
        let hiddenMap;
        let Gdal = null;
        let rasterDataset = null;
        let outputDataset = null;

        try {
            this.showExportModal();
            this.updateProgress(10, 'Inicializando...');

            // ESTE E O CHOKEPOINT REAL do GDAL, e nao o `_preInitGdal()`. MEDIDO em
            // navegador em 2026-08-25: no caminho normal da interface,
            // `sidebar/tabs/export.tab.js:_renderPdfContent` INLINA o que `show()`
            // faz (preview, bounds, zoom, listener de `move`) e nunca chama `show()`.
            // So o `_createFallbackPdfUI` chama. Ou seja, `_preInitGdal()` ja era
            // codigo morto na interface normal ANTES de o GDAL sair do `index.html`:
            // a sonda abriu a aba de PDF, esperou 5 s e nao viu um pedido de GDAL.
            // Entao o `await` aqui nao e uma rede de seguranca, e a unica garantia.
            //
            // Dois cliques rapidos nao entram duas vezes: `this._exporting` fecha a
            // porta antes deste `await`, e o botao ja saiu desabilitado acima.
            const initGdalJs = await ensureGdal()
            Gdal = await initGdalJs({ path: this._getGdalPath(), useWorker: false })

            if (this._exportCancelled) return;

            const canvasSize = this.calculateA4PixelSize();

            this.updateProgress(20, 'Preparando dados...');

            hiddenMapContainer = document.createElement('div');
            hiddenMapContainer.className = 'pdf-export-hidden-map';
            // Use smaller container with higher pixelRatio so MapLibre renders
            // tile labels at print-legible size (canvas output stays the same)
            hiddenMapContainer.style.width = `${canvasSize.containerWidth}px`;
            hiddenMapContainer.style.height = `${canvasSize.containerHeight}px`;
            document.body.appendChild(hiddenMapContainer);

            this.updateProgress(30, 'Criando mapa de exportação...');

            hiddenMap = new maplibregl.Map({
                container: hiddenMapContainer,
                style: this.getCleanStyle(),
                center: this.map.getCenter(),
                zoom: this.map.getZoom(),
                // Reset pitch to 0 — perspective distortion breaks cartographic output
                pitch: 0,
                pixelRatio: canvasSize.pixelRatio,
                preserveDrawingBuffer: true,
                interactive: false,
                fadeDuration: 0,
                validateStyle: false,
                // MapLibre 6.x: mesmo motivo do construtor principal em map_sig.js. Sem isto o
                // padrão novo (4) fatia os tiles e desloca o rótulo de centro de polígono, e a
                // imagem exportada deixaria de bater com a da tela.
                zoomLevelsToOverscale: undefined,
            });

            this.updateProgress(40, 'Transferindo recursos...');

            transferMapImages(this.map, hiddenMap);

            if (this._exportCancelled) return;

            this.updateProgress(60, 'Enquadrando área...');

            // Start feature stats collection in parallel with hidden map rendering.
            // _collectFeatureStats reads from the MAIN map, not the hidden one,
            // so it can run concurrently with tile loading.
            const featureStatsPromise = this._collectFeatureStats(this._buildExportBoundsPolygon());

            // Bounds are always axis-aligned (north-up)
            const mapBounds = [this.usableBounds.bottomLeft, this.usableBounds.topRight];
            hiddenMap.fitBounds(mapBounds, { padding: 0, duration: 0 });

            await new Promise(resolve => hiddenMap.once('idle', resolve));

            // Hidden map is always rendered north-up (bearing = 0).
            // GDAL's -a_ullr only supports axis-aligned georeferencing;
            // applying a bearing would rotate the canvas content while
            // -a_ullr still assumes north-up, causing every pixel to map
            // to the wrong geographic coordinate.

            if (this._exportCancelled) return;

            this.updateProgress(70, 'Corrigindo feições...');

            const finalZoom = hiddenMap.getZoom();
            const hadChanges = await correctZoomInvariantFeatures(hiddenMap, finalZoom);

            if (hadChanges) {
                await new Promise(resolve => hiddenMap.once('idle', resolve));
            }

            this.updateProgress(80, 'Finalizando...');

            // Always compose cartographic layout (at minimum draws map border)
            let exportCanvas = hiddenMap.getCanvas();
            {
                const logoImage = await loadLogoImage();
                exportCanvas = composeLayout(exportCanvas, {
                    title: this.showTitle ? this.mapTitle : null,
                    showLegend: this.showLegend,
                    showScaleBar: this.showScaleBar,
                    showNorthArrow: this.showNorthArrow,
                    showLatLongGrid: this.showLatLongGrid,
                    showUTMGrid: this.showUTMGrid,
                    scale: this.scale,
                    dpi: this.dpi,
                    // Always 0 — hidden map is rendered north-up for correct georeferencing
                    bearing: 0,
                    featuresByType: await featureStatsPromise,
                    mapBounds: {
                        west: hiddenMap.getBounds().getWest(),
                        east: hiddenMap.getBounds().getEast(),
                        south: hiddenMap.getBounds().getSouth(),
                        north: hiddenMap.getBounds().getNorth(),
                    },
                    projectionFn: (lngLat) => {
                        const pt = hiddenMap.project(lngLat);
                        return { x: pt.x * canvasSize.pixelRatio, y: pt.y * canvasSize.pixelRatio };
                    },
                    logoImage,
                });
            }

            // Use toBlob() instead of toDataURL() to avoid base64 encode/decode round-trip.
            // toBlob is async and produces binary directly, saving ~30MB memory at 300 DPI.
            const pngBlob = await new Promise((resolve, reject) => {
                exportCanvas.toBlob(
                    blob => blob ? resolve(blob) : reject(new Error('Canvas toBlob returned null')),
                    'image/png'
                );
            });

            this.updateProgress(90, 'Gerando PDF...');

            const result = await Gdal.open([new File([pngBlob], 'input.png', { type: 'image/png' })]);
            rasterDataset = result.datasets[0];
            const bounds = hiddenMap.getBounds();
            let minX = bounds.getWest();
            let minY = bounds.getSouth();
            let maxX = bounds.getEast();
            let maxY = bounds.getNorth();

            // GDAL adds the regular margin (5mm) as outer page padding
            const marginPoints = Math.round(this.marginMM * 2.83465);
            if (this.hasGrids) {
                // Grid label margins are baked into the canvas by composeLayout().
                // Expand geographic bounds to cover the grid margin bands.
                const mapCanvasW = hiddenMap.getCanvas().width;
                const mapCanvasH = hiddenMap.getCanvas().height;
                const gridMarginPx = Math.round(this._gridMarginMM * (this.dpi / 25.4));
                const degPerPxX = (maxX - minX) / mapCanvasW;
                const degPerPxY = (maxY - minY) / mapCanvasH;
                minX -= gridMarginPx * degPerPxX;
                maxX += gridMarginPx * degPerPxX;
                minY -= gridMarginPx * degPerPxY;
                maxY += gridMarginPx * degPerPxY;
            }

            const translateOptions = [
                '-of', 'PDF',
                '-a_ullr', String(minX), String(maxY), String(maxX), String(minY),
                '-a_srs', 'EPSG:4326',
                '-co', `DPI=${this.dpi}`,
                '-co', `MARGIN=${marginPoints}`,
            ];
            outputDataset = await Gdal.gdal_translate(rasterDataset, translateOptions);

            this.updateProgress(100, 'Fazendo download...');

            const fileName = `mapa-${this.scale.replace(':', '-')}-${this.dpi}dpi-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.pdf`;

            const pdfBytes = await Gdal.getFileBytes(outputDataset);
            const blob = new Blob([pdfBytes], { type: 'application/pdf' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            a.click();
            URL.revokeObjectURL(url);

            // DEPOIS DO DOWNLOAD DISPARADO, dentro do `try`: todo caminho de cancelamento acima
            // sai por `return` e todo erro cai no `catch`, entao esta linha so e alcancada quando
            // o arquivo de fato saiu.
            registrarUso(EventoDeUso.PDF_EXPORTADO, PropDeUso.PDF_FOLHA);

            // Capture locally so a quick second export does not get its modal
            // dismissed by this stale timeout (this._progress may be reassigned).
            const progress = this._progress;
            setTimeout(() => progress?.remove(), 800);

        } catch (error) {
            if (!this._exportCancelled) {
                console.error('Error exporting PDF:', error);
                showError('Não foi possível exportar o PDF: ' + error.message);
            }
            this._progress?.remove();
        } finally {
            // Free GDAL WASM datasets on every path (including errors); leaving them
            // open grows the WASM heap unboundedly across repeated/failed exports.
            if (Gdal && rasterDataset) Gdal.close(rasterDataset);
            if (Gdal && outputDataset) Gdal.close(outputDataset);

            this._exporting = false;
            this._exportCancelled = false;
            const btn = document.getElementById('pdf-export-btn');
            if (btn) btn.disabled = false;

            if (hiddenMap) {
                hiddenMap.remove();
            }
            hiddenMapContainer?.remove();
        }
    }

    /**
     * Builds the base path for GDAL WASM files.
     * Uses Vite's BASE_URL to resolve the correct path in any deployment.
     * @returns {string} GDAL directory path
     */
    _getGdalPath() {
        const base = import.meta.env.BASE_URL || '/';
        return `${window.location.origin}${base}vendors/gdal`;
    }

    /**
     * Pre-initializes GDAL WASM in the background, aquecendo o export.
     *
     * `initGdalJs()` returns a cached promise on subsequent calls, so this is safe
     * to call more than once.
     *
     * ATENCAO, ISTO HOJE QUASE NUNCA RODA. So `show()` o chama, e no caminho normal
     * da interface ninguem chama `show()`: `sidebar/tabs/export.tab.js`
     * (`_renderPdfContent`) inlina o corpo de `show()` e segue. Sobra o
     * `_createFallbackPdfUI`, que e o caminho de excecao. MEDIDO por sonda de
     * navegador em 2026-08-25: abrir a aba de PDF nao dispara pedido nenhum de
     * GDAL. Quem de fato carrega o GDAL e o `await ensureGdal()` do
     * `handleExport`. Nao confie neste metodo como garantia; ele e so aquecimento
     * oportunista, e o dia em que a aba voltar a chamar `show()` ele volta a valer.
     *
     * AGORA SAO DUAS ETAPAS, e a primeira e nova: `ensureGdal()` baixa o proprio
     * `gdal3.js`, que ate 2026-08-25 vinha por `<script defer>` no `index.html`.
     * Este metodo continua SINCRONO de proposito. Ele so dispara a corrente e
     * volta, entao `show()` nao virou `async` e nenhum chamador de `show()`
     * precisou mudar. Um `await` aqui atrasaria a abertura da aba para esperar
     * 187 kB de script mais 39 MB de WASM, que e exatamente o oposto do objetivo.
     */
    _preInitGdal() {
        if (this._gdalPreInitStarted) return;
        this._gdalPreInitStarted = true;

        ensureGdal()
            .then((initGdalJs) => initGdalJs({ path: this._getGdalPath(), useWorker: false }))
            .catch(() => {
                // Reset flag so it can be retried on next show()
                this._gdalPreInitStarted = false;
            });
    }

    /**
     * Extracts the denominator from a scale string like "1:25000".
     * @param {string} [scale] - Scale string (defaults to this.scale)
     * @returns {number} Scale denominator
     */
    _parseScaleDenom(scale = this.scale) {
        return parseScaleDenom(scale);
    }

    /**
     * Builds a turf polygon from the current (rotated) usable bounds.
     * Used to spatially filter features for the legend.
     * @returns {Object|null} Turf polygon or null
     */
    _buildExportBoundsPolygon() {
        if (!this.usableBounds) return null;
        try {
            return turf.polygon([[
                this.usableBounds.topLeft,
                this.usableBounds.topRight,
                this.usableBounds.bottomRight,
                this.usableBounds.bottomLeft,
                this.usableBounds.topLeft,
            ]]);
        } catch {
            return null;
        }
    }

    /**
     * Extracts a representative coordinate from any GeoJSON feature geometry.
     * @param {Object} feature - GeoJSON Feature
     * @returns {number[]|null} [lng, lat] or null
     */
    _getFeatureCoord(feature) {
        const geom = feature?.geometry;
        if (!geom?.coordinates) return null;
        switch (geom.type) {
            case 'Point': return geom.coordinates;
            case 'LineString': return geom.coordinates[0];
            case 'Polygon': return geom.coordinates[0]?.[0];
            case 'MultiPoint': return geom.coordinates[0];
            case 'MultiLineString': return geom.coordinates[0]?.[0];
            case 'MultiPolygon': return geom.coordinates[0]?.[0]?.[0];
            default: return null;
        }
    }

    /**
     * Checks whether a feature intersects the export bounds polygon.
     * Uses booleanIntersects for area/line features to catch features
     * whose centroid lies outside but whose geometry overlaps the area.
     * Falls back to centroid test for point features.
     * @param {Object} feature - GeoJSON Feature
     * @param {Object} boundsPolygon - Turf polygon
     * @returns {boolean}
     */
    _featureIntersectsBounds(feature, boundsPolygon) {
        try {
            const geomType = feature?.geometry?.type;
            if (!geomType) return false;

            if (geomType === 'Point') {
                return turf.booleanPointInPolygon(feature, boundsPolygon);
            }
            return turf.booleanIntersects(feature, boundsPolygon);
        } catch {
            // Fallback to centroid check on malformed geometry
            const coord = this._getFeatureCoord(feature);
            if (!coord) return false;
            return turf.booleanPointInPolygon(turf.point(coord), boundsPolygon);
        }
    }

    /**
     * Collects feature counts and representative colors by type,
     * filtered to the export area. Uses geometric intersection for
     * accurate filtering of area/line features.
     * @param {Object} [boundsPolygon] - Turf polygon for spatial filtering (null = count all)
     * @returns {Promise<Object>} Stats keyed by source type: { count, color }
     */
    async _collectFeatureStats(boundsPolygon) {
        const stats = {};
        const sourceTypes = [
            'points', 'lines', 'polygons', 'texts', 'images',
            'circles', 'rectangles', 'ellipses', 'brushes',
            'arrows', 'boundarys', 'occupied_fronts', 'coordination_lines',
            'military_symbols', 'coordination_measures',
            'los', 'visibility', 'setores',
        ];

        // Reverse map from storage name to source type
        const storageToSource = {
            points: 'point', lines: 'line', polygons: 'polygon',
            texts: 'text', images: 'image', circles: 'circle',
            rectangles: 'rectangle', ellipses: 'ellipse', brushes: 'brush',
            arrows: 'arrow', boundarys: 'boundary', occupied_fronts: 'occupied_front',
            coordination_lines: 'coordination_line',
            military_symbols: 'military_symbol', coordination_measures: 'coordination_measure',
            los: 'los', visibility: 'visibility', setores: 'sector',
        };

        // When temporal control is active, exclude features hidden at the current
        // cursor so the legend mirrors what is actually rendered. NaN cursor (off)
        // makes isTemporallyVisible() return true for everything.
        const temporalActive = isMapTemporalEnabledSync();
        const cursor = temporalActive ? getControl('TemporalControl')?.getCursor() : NaN;

        for (const sourceName of sourceTypes) {
            try {
                const source = this.map.getSource(sourceName);
                if (!source) continue;
                const data = await source.getData();
                if (!data?.features?.length) continue;

                let count = 0;
                let representativeColor = null;

                for (const feature of data.features) {
                    // Skip features hidden by the active temporal cursor.
                    if (temporalActive && !isTemporallyVisible(feature.properties, cursor)) {
                        continue;
                    }

                    const inBounds = boundsPolygon
                        ? this._featureIntersectsBounds(feature, boundsPolygon)
                        : true;

                    if (inBounds) {
                        count++;
                        // Grab the first available color as representative
                        if (!representativeColor && feature.properties) {
                            representativeColor = feature.properties.color
                                || feature.properties.fillColor
                                || feature.properties.lineColor
                                || null;
                        }
                    }
                }

                if (count > 0) {
                    const sourceType = storageToSource[sourceName] || sourceName;
                    stats[sourceType] = { count, color: representativeColor };
                }
            } catch {
                // Source may not support getData()
            }
        }

        return stats;
    }
}

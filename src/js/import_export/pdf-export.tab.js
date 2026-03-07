// Path: js/import_export/pdf-export.tab.js
/* global initGdalJs */
import { showError } from '../utilities/toast_service.js'
import {
    correctZoomInvariantFeatures,
    transferMapImages,
    createExportProgressModal,
    getCleanMapStyle,
} from './export-utils.js'

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

        // Cartographic layout options
        this.showTitle = false;
        this.mapTitle = '';
        this.showLegend = false;
        this.showScaleBar = false;
        this.showNorthArrow = false;
        this.showLatLongGrid = false;
        this.showUTMGrid = false;

        // Extra margin (mm) for grid labels. Added to marginMM when any grid is on.
        this._gridMarginMM = 5;

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
        this.onExportClick = this.onExportClick.bind(this);
        this.onMapMove = this.onMapMove.bind(this);

        // Auto-recover preview after base layer changes.
        // setStyle() destroys all custom sources/layers; this re-adds them.
        this.map.on('styledata', () => {
            if (this.isVisible && !this.map.getSource('pdf-export-preview')) {
                this.showPreview();
                this.updateBounds();
            }
        });
    }

    createUI() {
        const scaleOptions = this.availableScales.map(scale =>
            `<option value="${scale.value}" ${scale.value === this.scale ? 'selected' : ''}>${scale.label}</option>`
        ).join('');

        const dpiOptions = this.availableDPI.map(dpi =>
            `<option value="${dpi.value}" ${dpi.value === this.dpi ? 'selected' : ''}>${dpi.label}</option>`
        ).join('');

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

        // Pre-initialize GDAL WASM in background so it's ready when user clicks export
        this._preInitGdal();
    }

    hide() {
        this.isVisible = false;
        this.hidePreview();
        this.detachEventListeners();

        this.map.off('move', this.onMapMove);
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
        orientationInputs.forEach(input => {
            input.addEventListener('change', this.onOrientationChange);
        });

        const exportBtn = document.getElementById('pdf-export-btn');
        if (exportBtn) {
            exportBtn.addEventListener('click', this.onExportClick);
        }

        // Cartographic options
        this._attachCartographicListeners();
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
        orientationInputs.forEach(input => {
            input.removeEventListener('change', this.onOrientationChange);
        });

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
        const scaleDenom = parseInt(this.scale.split(':')[1], 10);
        const utmCheckbox = document.getElementById('pdf-show-utm-grid');
        if (!utmCheckbox) return;

        const utmDisabled = scaleDenom >= 2500000;
        utmCheckbox.disabled = utmDisabled;
        if (utmDisabled && utmCheckbox.checked) {
            utmCheckbox.checked = false;
            this.showUTMGrid = false;
        }
    }

    onOrientationChange(event) {
        this.orientation = event.target.value;
        this.updateBounds();
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
                this.updateBoundsOnly();
            }, 100);
        }
    }

    updateBoundsOnly() {
        // Reuse updateBounds which now delegates to updateBoundsAtCenter
        this.updateBounds();
    }

    calculateBoundsFromScale(scale, orientation) {
        // Use visible center that accounts for sidebar offset
        const center = this.getVisibleCenter();
        return this.calculateBoundsFromScaleAtCenter(scale, orientation, center);
    }

    /**
     * Calculates the paper and usable bounds for a given scale at a specific center point.
     * @param {string} scale - Scale string like "1:25000"
     * @param {string} orientation - "landscape" or "portrait"
     * @param {Object} center - Center point with lng and lat properties
     * @returns {Object} Object with paper and usable bounds
     */
    calculateBoundsFromScaleAtCenter(scale, orientation, center) {
        const denominator = parseInt(scale.split(':')[1], 10);

        let realWidthMeters, realHeightMeters;

        if (orientation === 'landscape') {
            realWidthMeters = (297 / 1000) * denominator;
            realHeightMeters = (210 / 1000) * denominator;
        } else {
            realWidthMeters = (210 / 1000) * denominator;
            realHeightMeters = (297 / 1000) * denominator;
        }

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
        const denominator = parseInt(scale.split(':')[1], 10);
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

        layerIds.forEach(layerId => {
            if (this.map.getLayer(layerId)) {
                this.map.removeLayer(layerId);
            }
        });

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

    /**
     * Delegates to shared utility.
     * @param {maplibregl.Map} hiddenMap
     * @param {number} finalZoom
     * @returns {Promise<boolean>}
     */
    async correctZoomInvariantFeatures(hiddenMap, finalZoom) {
        return correctZoomInvariantFeatures(hiddenMap, finalZoom);
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
        const scaleDenom = this.scale ? parseInt(this.scale.split(':')[1], 10) : 25000;
        return this.showUTMGrid && scaleDenom < 2500000;
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

        let usableWidthMM, usableHeightMM;
        if (this.orientation === 'landscape') {
            usableWidthMM = 297 - (2 * marginMM);
            usableHeightMM = 210 - (2 * marginMM);
        } else {
            usableWidthMM = 210 - (2 * marginMM);
            usableHeightMM = 297 - (2 * marginMM);
        }

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

    async onExportClick() {
        // Prevent concurrent exports
        if (this._exporting) return;
        this._exporting = true;

        const exportBtn = document.getElementById('pdf-export-btn');
        if (exportBtn) exportBtn.disabled = true;

        let hiddenMapContainer;
        let hiddenMap;

        try {
            this.showExportModal();
            this.updateProgress(10, 'Inicializando...');

            const Gdal = await initGdalJs({ path: this._getGdalPath(), useWorker: false })

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
                validateStyle: false
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
            const hadChanges = await this.correctZoomInvariantFeatures(hiddenMap, finalZoom);

            if (hadChanges) {
                await new Promise(resolve => hiddenMap.once('idle', resolve));
            }

            this.updateProgress(80, 'Finalizando...');

            // Always compose cartographic layout (at minimum draws map border)
            let exportCanvas = hiddenMap.getCanvas();
            {
                const { composeLayout, loadLogoImage } = await import('./pdf-cartographic-elements.js');
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
            const rasterDataset = result.datasets[0];
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
            const outputDataset = await Gdal.gdal_translate(rasterDataset, translateOptions);

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

            Gdal.close(rasterDataset);
            Gdal.close(outputDataset);

            setTimeout(() => this._progress?.remove(), 800);

        } catch (error) {
            if (!this._exportCancelled) {
                console.error('Error exporting PDF:', error);
                showError('Não foi possível exportar o PDF: ' + error.message);
            }
            this._progress?.remove();
        } finally {
            this._exporting = false;
            this._exportCancelled = false;
            const btn = document.getElementById('pdf-export-btn');
            if (btn) btn.disabled = false;

            if (hiddenMap) {
                hiddenMap.remove();
            }
            if (hiddenMapContainer && hiddenMapContainer.parentNode) {
                document.body.removeChild(hiddenMapContainer);
            }
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
     * Pre-initializes GDAL WASM in the background.
     * Called when the export tab is shown to avoid WASM load latency during export.
     * initGdalJs() returns a cached promise on subsequent calls, so this is safe.
     */
    _preInitGdal() {
        if (this._gdalPreInitStarted) return;
        this._gdalPreInitStarted = true;

        initGdalJs({ path: this._getGdalPath(), useWorker: false }).catch(() => {
            // Reset flag so it can be retried on next show()
            this._gdalPreInitStarted = false;
        });
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
            'arrows', 'boundarys', 'occupied_fronts',
            'military_symbols', 'coordination_measures',
            'los', 'visibility', 'setores',
        ];

        // Reverse map from storage name to source type
        const storageToSource = {
            points: 'point', lines: 'line', polygons: 'polygon',
            texts: 'text', images: 'image', circles: 'circle',
            rectangles: 'rectangle', ellipses: 'ellipse', brushes: 'brush',
            arrows: 'arrow', boundarys: 'boundary', occupied_fronts: 'occupied_front',
            military_symbols: 'military_symbol', coordination_measures: 'coordination_measure',
            los: 'los', visibility: 'visibility', setores: 'sector',
        };

        for (const sourceName of sourceTypes) {
            try {
                const source = this.map.getSource(sourceName);
                if (!source) continue;
                const data = await source.getData();
                if (!data?.features?.length) continue;

                let count = 0;
                let representativeColor = null;

                for (const feature of data.features) {
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

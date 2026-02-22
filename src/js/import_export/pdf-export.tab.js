// Path: js/import_export/pdf-export.tab.js
/* global initGdalJs */
import config from '../config.js'
import { showError } from '../utilities/toast_service.js'
import { deepClone } from '../utilities/deep-utils.js'

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

        this.availableScales = [
            { value: '1:1000', label: '1:1.000' },
            { value: '1:5000', label: '1:5.000' },
            { value: '1:10000', label: '1:10.000' },
            { value: '1:25000', label: '1:25.000' },
            { value: '1:50000', label: '1:50.000' },
            { value: '1:100000', label: '1:100.000' },
            { value: '1:250000', label: '1:250.000' },
            { value: '1:500000', label: '1:500.000' },
            { value: '1:1000000', label: '1:1.000.000' }
        ];

        this.onOrientationChange = this.onOrientationChange.bind(this);
        this.onScaleChange = this.onScaleChange.bind(this);
        this.onExportClick = this.onExportClick.bind(this);
        this.onMapMove = this.onMapMove.bind(this);
    }

    createUI() {
        const scaleOptions = this.availableScales.map(scale =>
            `<option value="${scale.value}" ${scale.value === this.scale ? 'selected' : ''}>${scale.label}</option>`
        ).join('');

        return `
            <div class="pdf-export-container">
                <div class="scale-selector">
                    <label for="pdf-scale-select" class="scale-label">Escala:</label>
                    <select id="pdf-scale-select" class="scale-select">
                        ${scaleOptions}
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
    }

    onScaleChange(event) {
        this.scale = event.target.value;
        this.updateBounds();
        this.zoomToPreviewArea();
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

        const marginDegrees = this.convertMMToMapUnitsFromScale(this.marginMM, scale);

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
     * Rotates the preview rectangle by the current map bearing so it
     * always appears aligned with the viewport (screen edges).
     * @param {Object} center - The center point with lng and lat properties
     */
    updateBoundsAtCenter(center) {
        const bounds = this.calculateBoundsFromScaleAtCenter(this.scale, this.orientation, center);

        // Store unrotated bounds for fitBounds / zoom calculation
        this._unrotatedPaperBounds = bounds.paper;
        this._unrotatedUsableBounds = bounds.usable;

        // Rotate corners by map bearing so preview aligns with viewport
        const bearing = this.map.getBearing();
        const centerCoord = [center.lng, center.lat];

        this.paperBounds = this._rotateBounds(bounds.paper, centerCoord, bearing);
        this.usableBounds = this._rotateBounds(bounds.usable, centerCoord, bearing);

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
     * Rotates all four corners of a bounds object around a center point.
     * @param {Object} bounds - Bounds with topLeft, topRight, bottomRight, bottomLeft
     * @param {number[]} center - [lng, lat] center of rotation
     * @param {number} bearingDeg - Rotation angle in degrees (clockwise)
     * @returns {Object} Rotated bounds
     */
    _rotateBounds(bounds, center, bearingDeg) {
        if (Math.abs(bearingDeg) < 0.01) return bounds;
        return {
            topLeft: this._rotateCorner(center, bounds.topLeft, bearingDeg),
            topRight: this._rotateCorner(center, bounds.topRight, bearingDeg),
            bottomRight: this._rotateCorner(center, bounds.bottomRight, bearingDeg),
            bottomLeft: this._rotateCorner(center, bounds.bottomLeft, bearingDeg),
        };
    }

    /**
     * Rotates a geographic point around a center by a given bearing.
     * Uses turf.js destination/bearing for geodesic accuracy.
     * @param {number[]} center - [lng, lat] center of rotation
     * @param {number[]} corner - [lng, lat] point to rotate
     * @param {number} angleDeg - Rotation angle in degrees (clockwise)
     * @returns {number[]} Rotated [lng, lat]
     */
    _rotateCorner(center, corner, angleDeg) {
        const from = turf.point(center);
        const to = turf.point(corner);
        const dist = turf.distance(from, to);
        if (dist < 0.0001) return corner;
        const currentBearing = turf.bearing(from, to);
        const rotated = turf.destination(from, dist, currentBearing + angleDeg);
        return rotated.geometry.coordinates;
    }

    zoomToPreviewArea() {
        if (!this.paperBounds) return;

        // Compute axis-aligned bbox of the (possibly rotated) preview polygon
        const corners = [
            this.paperBounds.topLeft,
            this.paperBounds.topRight,
            this.paperBounds.bottomRight,
            this.paperBounds.bottomLeft,
        ];
        const lngs = corners.map(c => c[0]);
        const lats = corners.map(c => c[1]);
        const sw = [Math.min(...lngs), Math.min(...lats)];
        const ne = [Math.max(...lngs), Math.max(...lats)];

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
            const currentStyle = this.map.getStyle();

            if (!currentStyle) {
                throw new Error('Map style not available');
            }

            const cleanStyle = deepClone(currentStyle);

            const previewLayerIds = [
                'pdf-export-preview-fill',
                'pdf-export-preview-stroke',
                'pdf-export-usable-stroke'
            ];

            cleanStyle.layers = cleanStyle.layers.filter(layer =>
                !previewLayerIds.includes(layer.id)
            );

            if (cleanStyle.sources && cleanStyle.sources['pdf-export-preview']) {
                delete cleanStyle.sources['pdf-export-preview'];
            }

            return cleanStyle;

        } catch (error) {
            console.error('Error creating clean style:', error);
            return this.map.getStyle();
        }
    }

    async correctZoomInvariantFeatures(hiddenMap, finalZoom) {
        const zoomInvariantSources = [
            {
                sourceName: 'texts',
                property: 'calculatedSize',
                baseProperty: 'size',
                maxValue: 255
            },
            {
                sourceName: 'brushes',
                property: 'calculatedLineWidth',
                baseProperty: 'lineWidth',
                maxValue: Infinity
            },
            {
                sourceName: 'images',
                property: 'calculatedSize',
                baseProperty: 'size',
                maxValue: 10
            },
            {
                sourceName: 'military_symbols',
                property: 'calculatedSize',
                baseProperty: 'size',
                maxValue: 10
            },
            {
                sourceName: 'coordination-measures-source',
                property: 'calculatedSize',
                baseProperty: 'size',
                maxValue: 10
            }
        ];

        let anyChanges = false;

        for (const sourceConfig of zoomInvariantSources) {
            const sourceHasChanges = await this.correctSourceFeatures(hiddenMap, sourceConfig, finalZoom);
            if (sourceHasChanges) {
                anyChanges = true;
            }
        }

        return anyChanges;
    }

    async correctSourceFeatures(hiddenMap, sourceConfig, finalZoom) {
        try {
            const source = hiddenMap.getSource(sourceConfig.sourceName);
            if (!source) {
                // Source doesn't exist - this is expected if user hasn't created features of this type
                return false;
            }

            const data = await source.getData();
            if (!data?.features?.length) return false;

            let hasChanges = false;

            data.features.forEach(feature => {
                if (!feature?.properties) return;
                if (typeof feature.properties.createdAtZoom !== 'number') return;
                if (typeof feature.properties[sourceConfig.baseProperty] !== 'number') return;

                const zoomDifference = finalZoom - feature.properties.createdAtZoom;
                const scaleFactor = Math.pow(2, zoomDifference);
                const baseValue = feature.properties[sourceConfig.baseProperty];

                if (baseValue <= 0) return;

                const newValue = Math.min(baseValue * scaleFactor, sourceConfig.maxValue);

                if (Math.abs(feature.properties[sourceConfig.property] - newValue) > 0.001) {
                    feature.properties[sourceConfig.property] = newValue;
                    hasChanges = true;
                }
            });

            if (hasChanges) {
                source.setData(data);
            }

            return hasChanges;

        } catch (error) {
            console.error(`Error correcting features from source ${sourceConfig.sourceName}:`, error);
            return false;
        }
    }

    showExportModal() {
        this._exportCancelled = false;

        const modal = document.createElement('div');
        modal.id = 'pdf-export-modal';
        modal.className = 'pdf-export-modal';

        const content = document.createElement('div');
        content.className = 'pdf-export-modal__content';

        const title = document.createElement('div');
        title.className = 'pdf-export-modal__title';
        title.textContent = 'Exportando mapa...';

        const progressText = document.createElement('div');
        progressText.id = 'export-progress-text';
        progressText.className = 'pdf-export-modal__progress-text';
        progressText.textContent = 'Preparando...';

        const barContainer = document.createElement('div');
        barContainer.className = 'pdf-export-modal__bar-container';

        const bar = document.createElement('div');
        bar.id = 'export-progress-bar';
        bar.className = 'pdf-export-modal__bar';
        barContainer.appendChild(bar);

        const hint = document.createElement('div');
        hint.className = 'pdf-export-modal__hint';
        hint.textContent = 'Isso pode levar alguns segundos...';

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'pdf-export-modal__cancel-btn';
        cancelBtn.textContent = 'Cancelar';
        cancelBtn.addEventListener('click', () => {
            this._exportCancelled = true;
            if (modal.parentNode) {
                document.body.removeChild(modal);
            }
        });

        content.appendChild(title);
        content.appendChild(progressText);
        content.appendChild(barContainer);
        content.appendChild(hint);
        content.appendChild(cancelBtn);
        modal.appendChild(content);

        document.body.appendChild(modal);
        return modal;
    }

    updateProgress(percent, text) {
        const progressBar = document.getElementById('export-progress-bar');
        const progressText = document.getElementById('export-progress-text');

        if (progressBar) {
            progressBar.style.width = percent + '%';
        }
        if (progressText) {
            progressText.textContent = text;
        }
    }

    calculateA4PixelSize() {
        const targetDPI = 300;
        const marginMM = this.marginMM;

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

        return {
            width: Math.round(usableWidthInches * targetDPI),
            height: Math.round(usableHeightInches * targetDPI)
        };
    }

    async onExportClick() {
        // Prevent concurrent exports
        if (this._exporting) return;
        this._exporting = true;

        const exportBtn = document.getElementById('pdf-export-btn');
        if (exportBtn) exportBtn.disabled = true;

        let modal;
        let hiddenMapContainer;
        let hiddenMap;

        try {
            modal = this.showExportModal();
            this.updateProgress(10, 'Inicializando...');

            // Build GDAL path - use window.location for local dev or configured URL for production
            let gdalBasePath;
            if (config.url_paths.url && config.url_paths.url !== 'IP:PORT') {
                const protocol = window.location.protocol;
                gdalBasePath = `${protocol}//${config.url_paths.url}${config.url_paths.prefix_name ? `/${config.url_paths.prefix_name}` : ''}`;
            } else {
                gdalBasePath = window.location.origin;
            }
            const gdalPath = `${gdalBasePath}/vendors/gdal`;

            const Gdal = await initGdalJs({ path: gdalPath, useWorker: false })

            if (this._exportCancelled) return;

            await new Promise(resolve => setTimeout(resolve, 200));

            const canvasSize = this.calculateA4PixelSize();

            this.updateProgress(20, 'Preparando dados...');

            hiddenMapContainer = document.createElement('div');
            hiddenMapContainer.className = 'pdf-export-hidden-map';
            // Dynamic dimensions depend on the computed A4 pixel size
            hiddenMapContainer.style.width = `${canvasSize.width}px`;
            hiddenMapContainer.style.height = `${canvasSize.height}px`;
            document.body.appendChild(hiddenMapContainer);

            this.updateProgress(30, 'Criando mapa de exportação...');

            hiddenMap = new maplibregl.Map({
                container: hiddenMapContainer,
                style: this.getCleanStyle(),
                center: this.map.getCenter(),
                zoom: this.map.getZoom(),
                // Reset pitch to 0 — perspective distortion breaks cartographic output
                pitch: 0,
                pixelRatio: 1,
                preserveDrawingBuffer: true,
                interactive: false,
                fadeDuration: 0,
                validateStyle: false
            });

            this.updateProgress(40, 'Transferindo recursos...');

            const loadedImages = this.map.listImages();
            const imagePromises = loadedImages.map(id => {
                return new Promise((resolve) => {
                    const image = this.map.getImage(id);
                    if (image) {
                        hiddenMap.addImage(id, image.data, { sdf: image.sdf });
                    }
                    resolve();
                });
            });
            await Promise.all(imagePromises);

            if (this._exportCancelled) return;

            this.updateProgress(60, 'Enquadrando área...');

            // Use unrotated (axis-aligned) bounds for zoom calculation
            const unrotatedUsable = this._unrotatedUsableBounds || this.usableBounds;
            const mapBounds = [unrotatedUsable.bottomLeft, unrotatedUsable.topRight];
            hiddenMap.fitBounds(mapBounds, { padding: 0, duration: 0 });

            await new Promise(resolve => hiddenMap.once('idle', resolve));

            // Apply map bearing so the export matches the user's rotated view
            const exportBearing = this.map.getBearing();
            if (Math.abs(exportBearing) > 0.01) {
                hiddenMap.setBearing(exportBearing);
                await new Promise(resolve => hiddenMap.once('idle', resolve));
            }

            if (this._exportCancelled) return;

            this.updateProgress(70, 'Corrigindo feições...');

            const finalZoom = hiddenMap.getZoom();
            const hadChanges = await this.correctZoomInvariantFeatures(hiddenMap, finalZoom);

            if (hadChanges) {
                await new Promise(resolve => hiddenMap.once('idle', resolve));
            }

            this.updateProgress(80, 'Finalizando...');

            // Compose cartographic layout if any element is enabled
            const hasCartographicElements = this.showTitle || this.showLegend || this.showScaleBar || this.showNorthArrow;
            let exportCanvas = hiddenMap.getCanvas();
            if (hasCartographicElements) {
                const { composeLayout } = await import('./pdf-cartographic-elements.js');
                exportCanvas = composeLayout(exportCanvas, {
                    title: this.showTitle ? this.mapTitle : null,
                    showLegend: this.showLegend,
                    showScaleBar: this.showScaleBar,
                    showNorthArrow: this.showNorthArrow,
                    scale: this.scale,
                    bearing: this.map.getBearing(),
                    featuresByType: await this._collectFeatureStats(this._buildExportBoundsPolygon()),
                });
            }

            const imageData = exportCanvas.toDataURL('image/png');
            const arr = imageData.split(',');
            const mimeMatch = arr[0].match(/:(.*?);/);
            const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
            const bstr = atob(arr[1]);
            let n = bstr.length;
            const u8arr = new Uint8Array(n);
            while (n--) {
                u8arr[n] = bstr.charCodeAt(n);
            }

            this.updateProgress(90, 'Gerando PDF...');

            const marginPoints = Math.round(this.marginMM * 2.83465);
            const result = await Gdal.open([new File([u8arr], "input.png", { type: mime })]);
            const rasterDataset = result.datasets[0];
            const bounds = hiddenMap.getBounds();
            const minX = bounds.getWest();
            const minY = bounds.getSouth();
            const maxX = bounds.getEast();
            const maxY = bounds.getNorth();
            // When title is enabled, the composite canvas is taller than the map area.
            // Extend the upper-left latitude proportionally so GDAL maps
            // only the map portion to the correct geographic bounds.
            const mapCanvasHeight = hiddenMap.getCanvas().height;
            const compositeHeight = exportCanvas.height;
            let adjustedMaxY = maxY;
            if (compositeHeight > mapCanvasHeight) {
                const latRange = maxY - minY;
                const extraRatio = (compositeHeight - mapCanvasHeight) / mapCanvasHeight;
                adjustedMaxY = maxY + latRange * extraRatio;
            }

            const translateOptions = [
                '-of', 'PDF',
                '-a_ullr', String(minX), String(adjustedMaxY), String(maxX), String(minY),
                '-a_srs', 'EPSG:4326',
                '-co', 'DPI=300',
                '-co', `MARGIN=${marginPoints}`,
            ];
            const outputDataset = await Gdal.gdal_translate(rasterDataset, translateOptions);

            this.updateProgress(100, 'Fazendo download...');

            const fileName = `mapa-${this.scale.replace(':', '-')}-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.pdf`;

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

            setTimeout(() => {
                if (modal && modal.parentNode) {
                    document.body.removeChild(modal);
                }
            }, 800);

        } catch (error) {
            if (!this._exportCancelled) {
                console.error('Error exporting PDF:', error);
                showError('Não foi possível exportar o PDF: ' + error.message);
            }
            if (modal && modal.parentNode) {
                document.body.removeChild(modal);
            }
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

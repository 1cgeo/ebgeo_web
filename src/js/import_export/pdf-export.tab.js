// Path: js/import_export/pdf-export.tab.js
/* global initGdalJs */
import config from '../config.js'

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
     * @param {Object} center - The center point with lng and lat properties
     */
    updateBoundsAtCenter(center) {
        const bounds = this.calculateBoundsFromScaleAtCenter(this.scale, this.orientation, center);
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

        const mapBounds = [
            this.paperBounds.bottomLeft,
            this.paperBounds.topRight
        ];

        // Calculate sidebar offset for asymmetric padding
        const sidebarOffset = this.getSidebarOffset();

        this.map.fitBounds(mapBounds, {
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

            const cleanStyle = JSON.parse(JSON.stringify(currentStyle));

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
        const modal = document.createElement('div');
        modal.id = 'export-modal';
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: rgba(80, 141, 78, 0.9);
            color: white;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            z-index: 99999;
            backdrop-filter: blur(2px);
            font-family: Arial, sans-serif;
        `;

        modal.innerHTML = `
            <div style="text-align: center;">
                <div style="font-size: 24px; font-weight: 600; margin-bottom: 20px;">
                    Exportando mapa...
                </div>
                <div id="export-progress-text" style="font-size: 16px; margin-bottom: 15px; opacity: 0.9;">
                    Preparando...
                </div>
                <div style="width: 300px; height: 8px; background: rgba(255,255,255,0.3); border-radius: 4px; overflow: hidden;">
                    <div id="export-progress-bar" style="
                        height: 100%;
                        background: #B4E380;
                        width: 0%;
                        border-radius: 4px;
                        transition: width 0.3s ease;
                    "></div>
                </div>
                <div style="font-size: 12px; margin-top: 10px; opacity: 0.7;">
                    Isso pode levar alguns segundos...
                </div>
            </div>
        `;

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
        let modal;
        let hiddenMapContainer;
        let hiddenMap;

        try {
            modal = this.showExportModal();
            this.updateProgress(10, 'Inicializando...');

            // Build GDAL path - use window.location for local dev or configured URL for production
            let gdalBasePath;
            if (config.url_paths.url && config.url_paths.url !== 'IP:PORT') {
                gdalBasePath = `http://${config.url_paths.url}${config.url_paths.prefix_name ? `/${config.url_paths.prefix_name}` : ''}`;
            } else {
                // Local development - use current origin
                gdalBasePath = window.location.origin;
            }
            const gdalPath = `${gdalBasePath}/vendors/gdal`;

            const Gdal = await initGdalJs({ path: gdalPath, useWorker: false })

            await new Promise(resolve => setTimeout(resolve, 200));

            const canvasSize = this.calculateA4PixelSize();

            this.updateProgress(20, 'Preparando dados...');

            hiddenMapContainer = document.createElement('div');
            hiddenMapContainer.style.cssText = `
                position: absolute; top: -9999px; left: -9999px;
                width: ${canvasSize.width}px; height: ${canvasSize.height}px;
            `;
            document.body.appendChild(hiddenMapContainer);

            this.updateProgress(30, 'Criando mapa de exportação...');

            hiddenMap = new maplibregl.Map({
                container: hiddenMapContainer,
                style: this.getCleanStyle(),
                center: this.map.getCenter(),
                zoom: this.map.getZoom(),
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

            this.updateProgress(60, 'Enquadrando área...');

            const mapBounds = [this.usableBounds.bottomLeft, this.usableBounds.topRight];
            hiddenMap.fitBounds(mapBounds, { padding: 0, duration: 0 });

            await new Promise(resolve => hiddenMap.once('idle', resolve));

            this.updateProgress(70, 'Corrigindo elementos...');

            const finalZoom = hiddenMap.getZoom();
            const hadChanges = await this.correctZoomInvariantFeatures(hiddenMap, finalZoom);

            if (hadChanges) {
                await new Promise(resolve => hiddenMap.once('idle', resolve));
            }

            this.updateProgress(80, 'Finalizando...');

            const imageData = hiddenMap.getCanvas().toDataURL('image/jpeg', 0.85);
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
            const result = await Gdal.open([new File([u8arr], "input.jpeg", { type: mime })]);
            const rasterDataset = result.datasets[0];
            const bounds = hiddenMap.getBounds();
            const minX = bounds.getWest();
            const minY = bounds.getSouth();
            const maxX = bounds.getEast();
            const maxY = bounds.getNorth();
            const translateOptions = [
                '-of', 'PDF',
                '-a_ullr', String(minX), String(maxY), String(maxX), String(minY),
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
            console.error('Error exporting PDF:', error);
            alert('Não foi possível exportar o PDF: ' + error.message);
            if (modal && modal.parentNode) {
                document.body.removeChild(modal);
            }
        } finally {
            if (hiddenMap) {
                hiddenMap.remove();
            }
            if (hiddenMapContainer && hiddenMapContainer.parentNode) {
                document.body.removeChild(hiddenMapContainer);
            }
        }
    }
}

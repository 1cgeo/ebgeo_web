// Path: js/import_export/garmin-kmz-export.js

/**
 * @fileoverview Garmin Custom Maps KMZ export.
 * Renders the current map (base layer + features) into georeferenced JPEG tiles
 * and packages them as a KMZ file compatible with Garmin handheld GPS devices.
 *
 * Garmin constraints:
 * - Max 100 tiles per KMZ
 * - Each tile max 1024x1024 pixels
 * - JPEG format inside KMZ
 * - KMZ placed in Garmin/CustomMaps/ on device
 *
 * Tiles are computed in Web Mercator pixel space so each tile maps exactly to
 * a 1024x1024 canvas. Geographic bounds for the KML are derived from the
 * actual rendered extent, avoiding Mercator/geographic aspect-ratio mismatch.
 */

import JSZip from 'jszip';
import { showError } from '@utils/toast_service.js';
import {
    correctZoomInvariantFeatures,
    transferMapImages,
    createExportProgressModal,
    getCleanMapStyle,
} from './export-utils.js';

const MAX_TILES = 100;
const TILE_SIZE = 1024;
const JPEG_QUALITY = 0.85;
const EXPORT_ZOOM = 16;
const MAX_CANVAS_DIM = 16384;

const PREVIEW_SOURCE = 'garmin-kmz-preview';
const PREVIEW_LAYERS = [
    'garmin-kmz-preview-fill',
    'garmin-kmz-preview-stroke',
    'garmin-kmz-preview-grid',
];

// ===== WEB MERCATOR PROJECTION HELPERS =====
// MapLibre GL JS uses 512px as its default tile size (not the standard 256px).
// All pixel ↔ geographic conversions must use 512 to match MapLibre's internal
// coordinate system, otherwise rendered extent will be off by a factor of 2.
const ML_TILE_BASE = 512;

/**
 * Converts longitude to MapLibre pixel X at a given zoom.
 * @param {number} lng - Longitude in degrees
 * @param {number} zoom - Map zoom level
 * @returns {number} Pixel X coordinate
 */
function lngToPixelX(lng, zoom) {
    return ((lng + 180) / 360) * ML_TILE_BASE * Math.pow(2, zoom);
}

/**
 * Converts latitude to MapLibre pixel Y at a given zoom.
 * @param {number} lat - Latitude in degrees
 * @param {number} zoom - Map zoom level
 * @returns {number} Pixel Y coordinate (Y increases southward)
 */
function latToPixelY(lat, zoom) {
    const latRad = lat * Math.PI / 180;
    return ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2)
        * ML_TILE_BASE * Math.pow(2, zoom);
}

/**
 * Converts MapLibre pixel X to longitude.
 * @param {number} x - Pixel X coordinate
 * @param {number} zoom - Map zoom level
 * @returns {number} Longitude in degrees
 */
function pixelXToLng(x, zoom) {
    return (x / (ML_TILE_BASE * Math.pow(2, zoom))) * 360 - 180;
}

/**
 * Converts MapLibre pixel Y to latitude.
 * @param {number} y - Pixel Y coordinate
 * @param {number} zoom - Map zoom level
 * @returns {number} Latitude in degrees
 */
function pixelYToLat(y, zoom) {
    const n = Math.PI - (2 * Math.PI * y) / (ML_TILE_BASE * Math.pow(2, zoom));
    return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

/**
 * Garmin KMZ exporter.
 */
export class GarminKmzExport {
    /**
     * @param {maplibregl.Map} map - The main MapLibre map instance
     */
    constructor(map) {
        this.map = map;

        /** @type {{ west: number, south: number, east: number, north: number } | null} */
        this._bbox = null;
        this._tileGrid = null;
        this._drawPoints = [];
        this._isDrawing = false;
        this._exporting = false;
        this._exportCancelled = false;

        /** @type {Function|null} Callback invoked when bbox drawing ends */
        this._onDrawComplete = null;

        // Bind handlers
        this._handleClick = this._handleClick.bind(this);
        this._handleMouseMove = this._handleMouseMove.bind(this);
        this._handleKeyDown = this._handleKeyDown.bind(this);
    }

    // ===== BBOX DRAWING =====

    /**
     * Activates two-click bbox drawing mode on the map.
     * @param {Function} [onComplete] - Called when drawing finishes (complete or cancel)
     */
    startBboxDrawing(onComplete) {
        this.clearBbox();
        this._onDrawComplete = onComplete || null;
        this._isDrawing = true;
        this._drawPoints = [];
        this.map.getCanvas().style.cursor = 'crosshair';
        this.map.on('click', this._handleClick);
        document.addEventListener('keydown', this._handleKeyDown);
    }

    /**
     * Cancels the current drawing without clearing an existing bbox.
     */
    cancelDrawing() {
        if (!this._isDrawing) return;
        this._isDrawing = false;
        this._drawPoints = [];
        this.map.getCanvas().style.cursor = '';
        this.map.off('click', this._handleClick);
        this.map.off('mousemove', this._handleMouseMove);
        document.removeEventListener('keydown', this._handleKeyDown);
        this._hidePreview();
        if (this._onDrawComplete) {
            this._onDrawComplete();
            this._onDrawComplete = null;
        }
    }

    /**
     * Resets bbox, tile grid, and preview.
     */
    clearBbox() {
        this.cancelDrawing();
        this._bbox = null;
        this._tileGrid = null;
        this._hidePreview();
    }

    /** @private */
    _handleKeyDown(e) {
        if (e.key === 'Escape') {
            this.cancelDrawing();
        }
    }

    /** @private */
    _handleClick(e) {
        if (!this._isDrawing || !e.lngLat) return;

        // Prevent click from propagating to feature selection and other handlers
        e.preventDefault();

        const point = [e.lngLat.lng, e.lngLat.lat];

        if (this._drawPoints.length === 0) {
            // First click
            this._drawPoints.push(point);
            this.map.on('mousemove', this._handleMouseMove);
        } else {
            // Second click - complete bbox
            this._drawPoints.push(point);
            this._completeBbox();
        }
    }

    /** @private */
    _handleMouseMove(e) {
        if (this._drawPoints.length !== 1 || !e.lngLat) return;

        const corner1 = this._drawPoints[0];
        const corner2 = [e.lngLat.lng, e.lngLat.lat];
        const bbox = this._cornersToBox(corner1, corner2);

        this._showPreview(bbox, null);
    }

    /** @private */
    _completeBbox() {
        const [corner1, corner2] = this._drawPoints;
        this._bbox = this._cornersToBox(corner1, corner2);

        // Stop drawing
        this._isDrawing = false;
        this.map.getCanvas().style.cursor = '';
        this.map.off('click', this._handleClick);
        this.map.off('mousemove', this._handleMouseMove);
        document.removeEventListener('keydown', this._handleKeyDown);

        // Calculate tile grid at fixed export zoom
        this._tileGrid = this._calculateTileGrid(this._bbox);

        if (!this._tileGrid) {
            showError('Area muito grande para exportacao Garmin. Desenhe uma area menor.');
            this._bbox = null;
            this._hidePreview();
            return;
        }

        // Show final preview with tile grid
        this._showPreview(this._bbox, this._tileGrid);

        if (this._onDrawComplete) {
            this._onDrawComplete();
            this._onDrawComplete = null;
        }
    }

    /**
     * Converts two arbitrary corners to a normalized bbox.
     * @private
     */
    _cornersToBox(c1, c2) {
        return {
            west: Math.min(c1[0], c2[0]),
            east: Math.max(c1[0], c2[0]),
            south: Math.min(c1[1], c2[1]),
            north: Math.max(c1[1], c2[1]),
        };
    }

    // ===== TILE GRID CALCULATION (MERCATOR PIXEL SPACE) =====

    /**
     * Calculates the tile grid at fixed EXPORT_ZOOM.
     * Edge tiles may be smaller than TILE_SIZE so the grid covers
     * exactly the bbox with no excess.
     *
     * @param {{ west: number, south: number, east: number, north: number }} bbox
     * @returns {{ cols: number, rows: number, zoom: number, tiles: Array } | null}
     * @private
     */
    _calculateTileGrid(bbox) {
        const zoom = EXPORT_ZOOM;
        const pxWest = lngToPixelX(bbox.west, zoom);
        const pxEast = lngToPixelX(bbox.east, zoom);
        const pxNorth = latToPixelY(bbox.north, zoom);
        const pxSouth = latToPixelY(bbox.south, zoom);

        const totalWidth = Math.round(pxEast - pxWest);
        const totalHeight = Math.round(pxSouth - pxNorth);

        if (totalWidth < 1 || totalHeight < 1) return null;

        const cols = Math.max(1, Math.ceil(totalWidth / TILE_SIZE));
        const rows = Math.max(1, Math.ceil(totalHeight / TILE_SIZE));

        if (cols * rows > MAX_TILES) return null;
        if (totalWidth > MAX_CANVAS_DIM || totalHeight > MAX_CANVAS_DIM) return null;

        return this._buildMercatorTileGrid(pxWest, pxNorth, cols, rows, totalWidth, totalHeight, zoom);
    }

    /**
     * Builds the tile array from Mercator pixel coordinates.
     * Edge tiles (last column/row) may be smaller than TILE_SIZE so the
     * union of all tiles covers exactly the bbox pixel extent.
     *
     * @param {number} originX - Pixel X of the bbox top-left corner
     * @param {number} originY - Pixel Y of the bbox top-left corner
     * @param {number} cols
     * @param {number} rows
     * @param {number} totalWidth - Total bbox pixel width
     * @param {number} totalHeight - Total bbox pixel height
     * @param {number} zoom
     * @returns {{ cols: number, rows: number, zoom: number, tiles: Array }}
     * @private
     */
    _buildMercatorTileGrid(originX, originY, cols, rows, totalWidth, totalHeight, zoom) {
        const tiles = [];

        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const pxLeft = originX + c * TILE_SIZE;
                const pxTop = originY + r * TILE_SIZE;

                // Edge tiles may be smaller than TILE_SIZE
                const tileW = Math.min(TILE_SIZE, Math.round(originX + totalWidth - pxLeft));
                const tileH = Math.min(TILE_SIZE, Math.round(originY + totalHeight - pxTop));

                const centerLng = pixelXToLng(pxLeft + tileW / 2, zoom);
                const centerLat = pixelYToLat(pxTop + tileH / 2, zoom);

                const west = pixelXToLng(pxLeft, zoom);
                const east = pixelXToLng(pxLeft + tileW, zoom);
                const north = pixelYToLat(pxTop, zoom);
                const south = pixelYToLat(pxTop + tileH, zoom);

                tiles.push({
                    row: r,
                    col: c,
                    width: tileW,
                    height: tileH,
                    centerLng,
                    centerLat,
                    west,
                    east,
                    north,
                    south,
                });
            }
        }

        const centerLng = pixelXToLng(originX + totalWidth / 2, zoom);
        const centerLat = pixelYToLat(originY + totalHeight / 2, zoom);

        return { cols, rows, zoom, tiles, totalWidth, totalHeight, centerLng, centerLat };
    }

    // ===== MAP PREVIEW =====

    /**
     * Shows the bbox and optional tile grid on the map.
     * @private
     */
    _showPreview(bbox, tileGrid) {
        this._ensurePreviewSource();

        const features = [];

        // Bbox outline (tiles exactly match bbox, no excess)
        features.push({
            type: 'Feature',
            properties: { kind: 'bbox' },
            geometry: {
                type: 'Polygon',
                coordinates: [[
                    [bbox.west, bbox.north],
                    [bbox.east, bbox.north],
                    [bbox.east, bbox.south],
                    [bbox.west, bbox.south],
                    [bbox.west, bbox.north],
                ]],
            },
        });

        // Tile grid lines (use actual tile bounds from Mercator grid)
        if (tileGrid) {
            const { tiles, cols, rows } = tileGrid;

            // Vertical grid lines (between columns)
            for (let c = 1; c < cols; c++) {
                // Get the east edge of tile in column (c-1), which equals west edge of column c
                const leftTile = tiles[(0) * cols + (c - 1)];
                const lng = leftTile.east;
                const topTile = tiles[0];
                const bottomTile = tiles[(rows - 1) * cols];
                features.push({
                    type: 'Feature',
                    properties: { kind: 'grid' },
                    geometry: {
                        type: 'LineString',
                        coordinates: [
                            [lng, bottomTile.south],
                            [lng, topTile.north],
                        ],
                    },
                });
            }

            // Horizontal grid lines (between rows)
            for (let r = 1; r < rows; r++) {
                // Get the south edge of tile in row (r-1), which equals north edge of row r
                const aboveTile = tiles[(r - 1) * cols];
                const lat = aboveTile.south;
                const leftTile = tiles[0];
                const rightTile = tiles[cols - 1];
                features.push({
                    type: 'Feature',
                    properties: { kind: 'grid' },
                    geometry: {
                        type: 'LineString',
                        coordinates: [
                            [leftTile.west, lat],
                            [rightTile.east, lat],
                        ],
                    },
                });
            }
        }

        const source = this.map.getSource(PREVIEW_SOURCE);
        if (source) {
            source.setData({ type: 'FeatureCollection', features });
        }
    }

    /** @private */
    _ensurePreviewSource() {
        if (!this.map.getSource(PREVIEW_SOURCE)) {
            this.map.addSource(PREVIEW_SOURCE, {
                type: 'geojson',
                data: { type: 'FeatureCollection', features: [] },
            });
        }

        if (!this.map.getLayer(PREVIEW_LAYERS[0])) {
            this.map.addLayer({
                id: PREVIEW_LAYERS[0],
                type: 'fill',
                source: PREVIEW_SOURCE,
                filter: ['==', ['get', 'kind'], 'bbox'],
                paint: {
                    'fill-color': '#2196F3',
                    'fill-opacity': 0.1,
                },
            });
        }

        if (!this.map.getLayer(PREVIEW_LAYERS[1])) {
            this.map.addLayer({
                id: PREVIEW_LAYERS[1],
                type: 'line',
                source: PREVIEW_SOURCE,
                filter: ['==', ['get', 'kind'], 'bbox'],
                paint: {
                    'line-color': '#2196F3',
                    'line-width': 2,
                    'line-dasharray': [6, 3],
                },
            });
        }

        if (!this.map.getLayer(PREVIEW_LAYERS[2])) {
            this.map.addLayer({
                id: PREVIEW_LAYERS[2],
                type: 'line',
                source: PREVIEW_SOURCE,
                filter: ['==', ['get', 'kind'], 'grid'],
                paint: {
                    'line-color': '#2196F3',
                    'line-width': 1,
                    'line-opacity': 0.5,
                    'line-dasharray': [4, 4],
                },
            });
        }
    }

    /** @private */
    _hidePreview() {
        for (const id of PREVIEW_LAYERS) {
            if (this.map.getLayer(id)) {
                this.map.removeLayer(id);
            }
        }
        if (this.map.getSource(PREVIEW_SOURCE)) {
            this.map.removeSource(PREVIEW_SOURCE);
        }
    }

    // ===== KMZ EXPORT =====

    /**
     * Returns info about the current tile grid for display.
     * @returns {{ cols: number, rows: number, total: number, zoom: number } | null}
     */
    getTileInfo() {
        if (!this._tileGrid) return null;
        const { cols, rows, zoom } = this._tileGrid;
        return { cols, rows, total: cols * rows, zoom };
    }

    /** @returns {boolean} Whether a bbox has been defined. */
    hasBbox() {
        return this._bbox !== null;
    }

    /** @returns {boolean} */
    isDrawing() {
        return this._isDrawing;
    }

    /**
     * Exports the current bbox as a Garmin KMZ file.
     *
     * Renders each tile individually in a fixed-size hidden map (TILE_SIZE x
     * TILE_SIZE) by jumping to each tile's center. This avoids WebGL canvas
     * size limits (MAX_VIEWPORT_DIMS / MAX_RENDERBUFFER_SIZE) that cause
     * incomplete rendering when using a single oversized canvas.
     */
    async exportKmz() {
        if (!this._bbox || !this._tileGrid) {
            showError('Selecione uma area no mapa primeiro');
            return;
        }
        if (this._exporting) return;
        this._exporting = true;
        this._exportCancelled = false;

        let progress;
        let hiddenMapContainer;
        let hiddenMap;

        try {
            progress = createExportProgressModal({
                title: 'Exportando Garmin KMZ...',
                onCancel: () => { this._exportCancelled = true; },
            });
            progress.updateProgress(5, 'Preparando...');

            const { tiles, zoom } = this._tileGrid;
            const totalTiles = tiles.length;

            // Create a fixed-size hidden map. Each tile is rendered
            // individually by jumping to its center, keeping the canvas
            // within safe WebGL dimensions.
            hiddenMapContainer = document.createElement('div');
            hiddenMapContainer.className = 'garmin-kmz-hidden-map';
            hiddenMapContainer.style.width = `${TILE_SIZE}px`;
            hiddenMapContainer.style.height = `${TILE_SIZE}px`;
            document.body.appendChild(hiddenMapContainer);

            progress.updateProgress(10, 'Criando mapa de exportacao...');

            hiddenMap = new maplibregl.Map({
                container: hiddenMapContainer,
                style: getCleanMapStyle(this.map),
                center: [tiles[0].centerLng, tiles[0].centerLat],
                zoom,
                pitch: 0,
                bearing: 0,
                pixelRatio: 1,
                preserveDrawingBuffer: true,
                interactive: false,
                fadeDuration: 0,
                validateStyle: false,
            });

            // Transfer custom images
            transferMapImages(this.map, hiddenMap);

            // Wait for initial load
            await new Promise(resolve => hiddenMap.once('idle', resolve));
            if (this._exportCancelled) return;

            progress.updateProgress(15, 'Corrigindo feicoes...');

            // Correct zoom-invariant features once (all tiles share the same zoom)
            const hadChanges = await correctZoomInvariantFeatures(hiddenMap, zoom);
            if (hadChanges) {
                await new Promise(resolve => hiddenMap.once('idle', resolve));
            }
            if (this._exportCancelled) return;

            progress.updateProgress(20, 'Renderizando tiles...');

            const zip = new JSZip();
            const filesFolder = zip.folder('files');
            const renderedTiles = [];

            // Reuse a single offscreen canvas + context across tiles
            const tileCanvas = document.createElement('canvas');
            tileCanvas.width = TILE_SIZE;
            tileCanvas.height = TILE_SIZE;
            const ctx = tileCanvas.getContext('2d');

            for (let i = 0; i < totalTiles; i++) {
                if (this._exportCancelled) return;

                const tile = tiles[i];
                const pct = 20 + Math.round((i / totalTiles) * 70);
                progress.updateProgress(pct, `Renderizando tile ${i + 1} de ${totalTiles}...`);

                // Jump to this tile's center and wait for full render
                hiddenMap.jumpTo({ center: [tile.centerLng, tile.centerLat], zoom });
                await new Promise(resolve => hiddenMap.once('idle', resolve));

                const sourceCanvas = hiddenMap.getCanvas();

                // Resize only for edge tiles that are smaller than TILE_SIZE
                if (tileCanvas.width !== tile.width || tileCanvas.height !== tile.height) {
                    tileCanvas.width = tile.width;
                    tileCanvas.height = tile.height;
                }

                // For full-size tiles the entire canvas is copied.
                // Edge tiles are smaller than TILE_SIZE; crop from the center
                // of the rendered canvas since the map is centered on the tile.
                const srcX = Math.round((TILE_SIZE - tile.width) / 2);
                const srcY = Math.round((TILE_SIZE - tile.height) / 2);
                ctx.drawImage(
                    sourceCanvas,
                    srcX, srcY, tile.width, tile.height,
                    0, 0, tile.width, tile.height
                );

                const blob = await new Promise((resolve, reject) => {
                    tileCanvas.toBlob(
                        b => b ? resolve(b) : reject(new Error('Canvas toBlob returned null')),
                        'image/jpeg',
                        JPEG_QUALITY
                    );
                });

                const fileName = `tile_${tile.row}_${tile.col}.jpg`;
                filesFolder.file(fileName, blob);

                renderedTiles.push({
                    row: tile.row,
                    col: tile.col,
                    north: tile.north,
                    south: tile.south,
                    east: tile.east,
                    west: tile.west,
                });
            }

            if (this._exportCancelled) return;

            progress.updateProgress(92, 'Gerando KML...');

            const kml = this._generateKml(renderedTiles);
            zip.file('doc.kml', kml);

            progress.updateProgress(95, 'Compactando KMZ...');

            const kmzBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });

            progress.updateProgress(100, 'Fazendo download...');

            const timestamp = new Date().toISOString().slice(0, 10);
            const fileName = `ebgeo-garmin-${timestamp}.kmz`;

            const url = URL.createObjectURL(kmzBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            a.click();
            URL.revokeObjectURL(url);

            setTimeout(() => progress.remove(), 800);

        } catch (error) {
            if (!this._exportCancelled) {
                console.error('Error exporting Garmin KMZ:', error);
                showError('Erro ao exportar KMZ: ' + error.message);
            }
            progress?.remove();
        } finally {
            this._exporting = false;
            this._exportCancelled = false;
            if (hiddenMap) hiddenMap.remove();
            if (hiddenMapContainer?.parentNode) {
                document.body.removeChild(hiddenMapContainer);
            }
        }
    }

    // ===== KML GENERATION =====

    /**
     * Generates the doc.kml content for the KMZ.
     * @param {Array} tiles - Tiles with actual rendered bounds
     * @returns {string}
     * @private
     */
    _generateKml(tiles) {
        let overlays = '';
        for (const tile of tiles) {
            overlays += `
    <GroundOverlay>
      <name>tile_${tile.row}_${tile.col}</name>
      <drawOrder>50</drawOrder>
      <Icon>
        <href>files/tile_${tile.row}_${tile.col}.jpg</href>
      </Icon>
      <LatLonBox>
        <north>${tile.north}</north>
        <south>${tile.south}</south>
        <east>${tile.east}</east>
        <west>${tile.west}</west>
      </LatLonBox>
    </GroundOverlay>`;
        }

        return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>EBGeo - Mapa Garmin</name>
    <description>Mapa exportado pelo EBGeo Web</description>${overlays}
  </Document>
</kml>`;
    }

    // ===== CLEANUP =====

    /**
     * Removes preview layers and event listeners.
     */
    destroy() {
        this._exportCancelled = true;
        this.cancelDrawing();
        this._hidePreview();
    }
}

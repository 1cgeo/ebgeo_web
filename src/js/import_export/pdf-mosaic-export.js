// Path: js/import_export/pdf-mosaic-export.js

/**
 * @module import_export/pdf-mosaic-export
 * @description Orchestrates the multi-page "mosaic" PDF export — an R×C grid of
 * full-bleed A4 pages that tape together into one large, continuous map, with
 * a double-sided assembly aid printed on the back of every page.
 *
 * Strategy:
 *   - One off-screen map is reused for every tile (shared tile cache → fast).
 *   - All tiles render at a SINGLE zoom; their centres are spaced by the exact
 *     Mercator extent one page covers at that zoom, so seams are pixel-continuous.
 *   - Pages are assembled with jsPDF (already a dependency) as
 *       [cover, overview, (mapFront, verso) × tiles]
 *     which keeps every map/verso pair on one physical duplex sheet.
 *
 * @see pdf-mosaic-geometry.js   geometry (pure, tested)
 * @see pdf-mosaic-pages.js      cover / overview / verso drawing
 */

import {
    computeMosaicZoom,
    pageMercatorSpan,
    pageContainerCssPx,
    computeTileCenters,
} from './pdf-mosaic-geometry.js';
import { drawCoverPage, drawOverviewPage, drawVersoPage } from './pdf-mosaic-pages.js';
import { drawMosaicGridLines, drawMosaicTileBorder } from './pdf-cartographic-elements.js';
import { transferMapImages, correctZoomInvariantFeatures } from './export-utils.js';
import { parseScaleDenom, MOSAIC_BORDER_MM } from './pdf-export.constants.js';

/** Page dimensions (mm) for each orientation. */
function pageSizeMm(orientation) {
    return orientation === 'landscape'
        ? { w: 297, h: 210 }
        : { w: 210, h: 297 };
}

/** Human label for a scale string, e.g. "1:25000" → "1:25.000". */
function scaleLabel(scale) {
    const denom = parseScaleDenom(scale);
    return `1:${denom.toLocaleString('pt-BR')}`;
}

/** Resolves once the off-screen map finishes rendering (with a safety timeout). */
function waitForIdle(hiddenMap, timeoutMs = 20000) {
    return new Promise((resolve) => {
        let done = false;
        const finish = () => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            resolve();
        };
        const timer = setTimeout(finish, timeoutMs);
        hiddenMap.once('idle', finish);
    });
}

/**
 * Renders the mosaic and triggers a PDF download.
 *
 * @param {Object} config
 * @param {maplibregl.Map} config.map - The main map (source of style + images)
 * @param {Object} config.cleanStyle - Style object stripped of preview layers
 * @param {{lng:number, lat:number}} config.center - Mosaic centre
 * @param {string} config.scale - Scale string like "1:25000"
 * @param {number} config.dpi
 * @param {'landscape'|'portrait'} config.orientation
 * @param {number} config.rows
 * @param {number} config.cols
 * @param {boolean} [config.showLatLongGrid]
 * @param {boolean} [config.showUTMGrid]
 * @param {string} [config.title]
 * @param {boolean} [config.includeCover=true]
 * @param {boolean} [config.includeVerso=true]
 * @param {(percent:number, text:string) => void} [config.updateProgress]
 * @param {() => boolean} [config.isCancelled]
 * @returns {Promise<boolean>} true if a PDF was produced, false if cancelled
 */
export async function exportMosaicPdf(config) {
    const {
        map,
        cleanStyle,
        center,
        scale,
        dpi,
        orientation,
        rows,
        cols,
        showLatLongGrid = false,
        showUTMGrid = false,
        title = '',
        includeCover = true,
        includeVerso = true,
        updateProgress = () => {},
        isCancelled = () => false,
    } = config;

    const page = pageSizeMm(orientation);
    const containerWcss = pageContainerCssPx(page.w);
    const containerHcss = pageContainerCssPx(page.h);
    const pixelRatio = dpi / 96;

    const scaleDenom = parseScaleDenom(scale);
    const zoom = computeMosaicZoom(scaleDenom, center.lat);
    const span = pageMercatorSpan(zoom, containerWcss, containerHcss);
    const tiles = computeTileCenters({
        rows, cols,
        centerLng: center.lng, centerLat: center.lat,
        pageMercW: span.width, pageMercH: span.height,
    });
    const drawGrid = showLatLongGrid || showUTMGrid;
    // When a grid is on, the mosaic's outer perimeter gets a coordinate border band.
    const bandPx = drawGrid ? Math.round((MOSAIC_BORDER_MM / 25.4) * dpi) : 0;

    let hiddenContainer = null;
    let hiddenMap = null;

    try {
        updateProgress(15, 'Criando mapa de exportação...');

        hiddenContainer = document.createElement('div');
        hiddenContainer.className = 'pdf-export-hidden-map';
        hiddenContainer.style.width = `${containerWcss}px`;
        hiddenContainer.style.height = `${containerHcss}px`;
        document.body.appendChild(hiddenContainer);

        hiddenMap = new maplibregl.Map({
            container: hiddenContainer,
            style: cleanStyle,
            center: [center.lng, center.lat],
            zoom,
            pitch: 0,
            bearing: 0,
            pixelRatio,
            preserveDrawingBuffer: true,
            interactive: false,
            fadeDuration: 0,
            validateStyle: false,
        });

        await new Promise((resolve) => hiddenMap.once('load', resolve));
        transferMapImages(map, hiddenMap);

        if (isCancelled()) return false;

        // The map is constructed at (center, zoom). Zoom is identical for every
        // tile, so correct zoom-invariant features once, up front.
        const changed = await correctZoomInvariantFeatures(hiddenMap, zoom);
        if (changed) {
            hiddenMap.triggerRepaint();
            await waitForIdle(hiddenMap);
        }

        if (isCancelled()) return false;

        // --- Lazy-load jsPDF and start the document ---
        updateProgress(20, 'Preparando documento...');
        const { jsPDF } = await import('jspdf');
        const doc = new jsPDF({ orientation, unit: 'mm', format: 'a4' });

        let pageStarted = false; // whether the current jsPDF page is already used
        const newPage = () => {
            if (pageStarted) doc.addPage('a4', orientation);
            pageStarted = true;
        };

        if (includeCover) {
            newPage();
            drawCoverPage(doc, {
                rows, cols, scaleLabel: scaleLabel(scale), dpi, orientation, title,
                pageW: page.w, pageH: page.h,
            });
            newPage();
            drawOverviewPage(doc, { rows, cols, pageW: page.w, pageH: page.h });
        }

        // --- Render each tile and append its [map, verso] pages ---
        for (let i = 0; i < tiles.length; i++) {
            if (isCancelled()) return false;

            const tile = tiles[i];
            updateProgress(
                25 + Math.round((i / tiles.length) * 65),
                `Renderizando folha ${i + 1} de ${tiles.length}...`
            );

            hiddenMap.jumpTo({ center: [tile.centerLng, tile.centerLat], zoom, bearing: 0, pitch: 0 });
            // Force at least one render so 'idle' fires even when a tile centre
            // coincides with the current view (e.g. the middle tile of an odd grid).
            hiddenMap.triggerRepaint();
            await waitForIdle(hiddenMap);

            // A tile is on the mosaic perimeter when it sits on the first/last row/column.
            const bands = {
                left: tile.col === 0,
                right: tile.col === cols - 1,
                top: tile.row === 0,
                bottom: tile.row === rows - 1,
            };
            const dataUrl = captureTile(hiddenMap, {
                drawGrid, scale, showLatLongGrid, showUTMGrid, dpi, pixelRatio, bands, bandPx,
            });

            newPage();
            doc.addImage(dataUrl, 'JPEG', 0, 0, page.w, page.h, undefined, 'FAST');

            if (includeVerso) {
                newPage();
                drawVersoPage(doc, {
                    row: tile.row, col: tile.col, rows, cols,
                    pageW: page.w, pageH: page.h,
                });
            }
        }

        if (isCancelled()) return false;

        updateProgress(95, 'Gerando PDF...');
        const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
        const fileName = `mosaico-${rows}x${cols}-${scale.replace(':', '-')}-${dpi}dpi-${stamp}.pdf`;
        doc.save(fileName);

        updateProgress(100, 'Download concluído!');
        return true;
    } finally {
        if (hiddenMap) hiddenMap.remove();
        hiddenContainer?.remove();
    }
}

/**
 * Captures the current off-screen map view as a JPEG data URL. When a grid is
 * on, it overlays continuous grid lines onto a 2D copy of the WebGL canvas and,
 * for perimeter tiles, draws the coordinate border band.
 * @returns {string} JPEG data URL
 */
function captureTile(hiddenMap, { drawGrid, scale, showLatLongGrid, showUTMGrid, dpi, pixelRatio, bands, bandPx }) {
    const glCanvas = hiddenMap.getCanvas();

    if (!drawGrid) {
        return glCanvas.toDataURL('image/jpeg', 0.92);
    }

    const out = document.createElement('canvas');
    out.width = glCanvas.width;
    out.height = glCanvas.height;
    const ctx = out.getContext('2d');
    ctx.drawImage(glCanvas, 0, 0);

    const b = hiddenMap.getBounds();
    const mapBounds = { west: b.getWest(), east: b.getEast(), south: b.getSouth(), north: b.getNorth() };
    const projectionFn = (lngLat) => {
        const pt = hiddenMap.project(lngLat);
        return { x: pt.x * pixelRatio, y: pt.y * pixelRatio };
    };

    drawMosaicGridLines(ctx, {
        mapBounds,
        mapW: out.width,
        mapH: out.height,
        projectionFn,
        scale,
        showLatLong: showLatLongGrid,
        showUTM: showUTMGrid,
        dpi,
    });

    if (bandPx > 0) {
        drawMosaicTileBorder(ctx, {
            mapBounds,
            pageWpx: out.width,
            pageHpx: out.height,
            bands,
            bandPx,
            projectionFn,
            scale,
            showLatLong: showLatLongGrid,
            showUTM: showUTMGrid,
            dpi,
        });
    }

    return out.toDataURL('image/jpeg', 0.92);
}

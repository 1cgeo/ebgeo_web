// Path: js/import_export/pdf-mosaic-geometry.js

/**
 * @module import_export/pdf-mosaic-geometry
 * @description Pure geometry helpers for the multi-page (mosaic) PDF export.
 *
 * The mosaic splits a large map into an R×C grid of full-bleed A4 pages.
 * For the printed pages to join seamlessly, every tile must be rendered at the
 * SAME zoom and the tile centers must be spaced by the EXACT Mercator extent
 * that one page covers at that zoom. Subdividing in Web Mercator (the projection
 * MapLibre renders in) — rather than in degrees — guarantees adjacent tiles share
 * an identical scale at their seam, so the map is continuous across page borders.
 *
 * All functions here are pure (no DOM, no MapLibre) so they are node-testable.
 */

/** Web Mercator world circumference in metres (EPSG:3857). */
const EARTH_CIRCUMFERENCE = 2 * Math.PI * 6378137;
/** Half-circumference — the Mercator axis half-extent (±20037508.34). */
const ORIGIN_SHIFT = EARTH_CIRCUMFERENCE / 2;
/** MapLibre default tile size in CSS pixels (zoom is defined against this). */
const TILE_SIZE = 512;
/** CSS reference resolution: 1 CSS pixel = 1/96 inch. */
const CSS_DPI = 96;
/** Metres per inch. */
const INCH_M = 0.0254;

/**
 * Projects lng/lat (WGS84 degrees) to Web Mercator metres.
 * @param {number} lng - Longitude in degrees
 * @param {number} lat - Latitude in degrees
 * @returns {{ x: number, y: number }} Mercator coordinates in metres
 */
export function lngLatToMercator(lng, lat) {
    const x = (lng * ORIGIN_SHIFT) / 180;
    const yDeg = Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / (Math.PI / 180);
    const y = (yDeg * ORIGIN_SHIFT) / 180;
    return { x, y };
}

/**
 * Inverse of {@link lngLatToMercator}.
 * @param {number} x - Mercator easting in metres
 * @param {number} y - Mercator northing in metres
 * @returns {{ lng: number, lat: number }} WGS84 degrees
 */
export function mercatorToLngLat(x, y) {
    const lng = (x / ORIGIN_SHIFT) * 180;
    const latDeg = (y / ORIGIN_SHIFT) * 180;
    const lat = (180 / Math.PI) * (2 * Math.atan(Math.exp((latDeg * Math.PI) / 180)) - Math.PI / 2);
    return { lng, lat };
}

/**
 * CSS-pixel size of an A4 page side at the 96-dpi CSS reference resolution.
 * This is the off-screen map's container size; it is intentionally independent
 * of the export DPI (DPI only supersamples via pixelRatio, it does not change
 * the geographic scale / zoom).
 * @param {number} pageMm - Page dimension in millimetres (297 or 210)
 * @returns {number} CSS pixels (rounded)
 */
export function pageContainerCssPx(pageMm) {
    return Math.round((pageMm / 25.4) * CSS_DPI);
}

/**
 * Computes the MapLibre zoom at which a printed page reproduces the given map
 * scale at the page's centre latitude.
 *
 * At 96 CSS dpi one CSS pixel equals 1/96 inch on paper, i.e. `denom/96` inches
 * = `denom·0.0254/96` true ground metres. Web Mercator stretches by `1/cos(lat)`,
 * so the Mercator resolution is that value divided by `cos(lat)`, and
 * `mercRes = EARTH_CIRCUMFERENCE / (TILE_SIZE · 2^z)` yields the zoom.
 *
 * @param {number} scaleDenom - Scale denominator (e.g. 25000 for 1:25000)
 * @param {number} centerLat - Centre latitude in degrees
 * @returns {number} Fractional zoom level
 */
export function computeMosaicZoom(scaleDenom, centerLat) {
    const trueResCssPx = (scaleDenom * INCH_M) / CSS_DPI;
    const cosLat = Math.cos((centerLat * Math.PI) / 180);
    const mercResCssPx = trueResCssPx / cosLat;
    return Math.log2(EARTH_CIRCUMFERENCE / (TILE_SIZE * mercResCssPx));
}

/**
 * Mercator metres spanned by one page (width and height) at a given zoom.
 * Uses the actual (rounded) container CSS size so the spacing matches exactly
 * what MapLibre renders into the capture canvas — the key to seamless joins.
 * @param {number} zoom - MapLibre zoom level
 * @param {number} containerWidthCssPx - Off-screen container width in CSS px
 * @param {number} containerHeightCssPx - Off-screen container height in CSS px
 * @returns {{ width: number, height: number }} Mercator span in metres
 */
export function pageMercatorSpan(zoom, containerWidthCssPx, containerHeightCssPx) {
    const mercPerCssPx = EARTH_CIRCUMFERENCE / (TILE_SIZE * Math.pow(2, zoom));
    return {
        width: containerWidthCssPx * mercPerCssPx,
        height: containerHeightCssPx * mercPerCssPx,
    };
}

/**
 * Computes the centre lng/lat of every tile in an R×C mosaic, row-major
 * (top-left first, reading left→right then top→bottom). Tiles abut exactly:
 * neighbouring centres are one full page span apart in Mercator.
 * @param {Object} params
 * @param {number} params.rows
 * @param {number} params.cols
 * @param {number} params.centerLng - Mosaic centre longitude
 * @param {number} params.centerLat - Mosaic centre latitude
 * @param {number} params.pageMercW - Page Mercator width (m)
 * @param {number} params.pageMercH - Page Mercator height (m)
 * @returns {Array<{ row: number, col: number, centerLng: number, centerLat: number }>}
 */
export function computeTileCenters({ rows, cols, centerLng, centerLat, pageMercW, pageMercH }) {
    const c = lngLatToMercator(centerLng, centerLat);
    const leftX = c.x - (cols * pageMercW) / 2;
    const topY = c.y + (rows * pageMercH) / 2;

    const tiles = [];
    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            const tx = leftX + (col + 0.5) * pageMercW;
            const ty = topY - (row + 0.5) * pageMercH;
            const ll = mercatorToLngLat(tx, ty);
            tiles.push({ row, col, centerLng: ll.lng, centerLat: ll.lat });
        }
    }
    return tiles;
}

/**
 * Geographic bounds of a single tile, given its centre and the page span.
 * @param {Object} params
 * @param {number} params.centerLng
 * @param {number} params.centerLat
 * @param {number} params.pageMercW
 * @param {number} params.pageMercH
 * @returns {{ west: number, south: number, east: number, north: number }}
 */
export function tileBounds({ centerLng, centerLat, pageMercW, pageMercH }) {
    const c = lngLatToMercator(centerLng, centerLat);
    const tl = mercatorToLngLat(c.x - pageMercW / 2, c.y + pageMercH / 2);
    const br = mercatorToLngLat(c.x + pageMercW / 2, c.y - pageMercH / 2);
    return { west: tl.lng, north: tl.lat, east: br.lng, south: br.lat };
}

/**
 * Geographic bounds of the whole mosaic (for preview and fit-to-view).
 * @param {Object} params
 * @param {number} params.centerLng
 * @param {number} params.centerLat
 * @param {number} params.rows
 * @param {number} params.cols
 * @param {number} params.pageMercW
 * @param {number} params.pageMercH
 * @returns {{ west: number, south: number, east: number, north: number }}
 */
export function computeMosaicBounds({ centerLng, centerLat, rows, cols, pageMercW, pageMercH }) {
    const c = lngLatToMercator(centerLng, centerLat);
    const tl = mercatorToLngLat(c.x - (cols * pageMercW) / 2, c.y + (rows * pageMercH) / 2);
    const br = mercatorToLngLat(c.x + (cols * pageMercW) / 2, c.y - (rows * pageMercH) / 2);
    return { west: tl.lng, north: tl.lat, east: br.lng, south: br.lat };
}

/**
 * Maps a tile's FINAL grid position to the position the operator must place it
 * at while assembling the mosaic FACE-DOWN. The agreed workflow flips the taped
 * block left↔right at the end, which mirrors columns; rows are unchanged.
 * @param {Object} params
 * @param {number} params.row - Final 0-based row
 * @param {number} params.col - Final 0-based column
 * @param {number} params.cols - Total columns
 * @returns {{ assemblyRow: number, assemblyCol: number }} 0-based face-down position
 */
export function mirrorAssemblyPosition({ row, col, cols }) {
    return { assemblyRow: row, assemblyCol: cols - 1 - col };
}

/**
 * Convenience: full per-page Mercator span derived straight from scale + page
 * size + latitude (closed form, container-rounding aside). Handy for previews
 * where an off-screen container does not exist.
 * @param {Object} params
 * @param {number} params.pageWidthMm
 * @param {number} params.pageHeightMm
 * @param {number} params.scaleDenom
 * @param {number} params.centerLat
 * @returns {{ width: number, height: number }}
 */
export function pageMercatorSpanFromScale({ pageWidthMm, pageHeightMm, scaleDenom, centerLat }) {
    const zoom = computeMosaicZoom(scaleDenom, centerLat);
    return pageMercatorSpan(
        zoom,
        pageContainerCssPx(pageWidthMm),
        pageContainerCssPx(pageHeightMm)
    );
}

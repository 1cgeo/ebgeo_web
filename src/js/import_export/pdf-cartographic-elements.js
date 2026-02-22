// Path: js/import_export/pdf-cartographic-elements.js

/**
 * @module import_export/pdf-cartographic-elements
 * @description Pure Canvas 2D drawing functions for cartographic layout elements.
 * Used by pdf-export.tab.js to compose title, legend, scale bar, north arrow,
 * and geographic/UTM grids onto the captured map canvas before sending to GDAL.
 *
 * Overlays (title, legend, scale bar, north arrow) are drawn on top of the map.
 * Grids expand the canvas with margin bands for labels.
 */

import proj4 from 'proj4';

// ============================================================================
// CONSTANTS
// ============================================================================

const TITLE_HEIGHT = 60;
const LEGEND_ROW_HEIGHT = 28;
const LEGEND_PADDING = 20;
const SCALE_BAR_HEIGHT = 60;
const NORTH_ARROW_SIZE = 90;
const FONT_FAMILY = 'Arial, Helvetica, sans-serif';

/** Margin added around the map for grid labels (mm). Must match _gridMarginMM in pdf-export.tab.js */
const GRID_MARGIN_MM = 5;

/** Number of sample points for drawing curved grid lines */
const GRID_LINE_SAMPLES = 80;

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Composes a cartographic layout onto the map canvas.
 * Returns a new canvas with map + cartographic elements.
 *
 * When grids are enabled, the canvas is expanded with margin bands
 * for grid labels. Overlays are drawn on top of the map area.
 *
 * @param {HTMLCanvasElement} mapCanvas - The captured map canvas
 * @param {Object} options
 * @param {string|null} options.title - Map title (null = no title)
 * @param {boolean} options.showLegend - Whether to draw legend
 * @param {boolean} options.showScaleBar - Whether to draw scale bar
 * @param {boolean} options.showNorthArrow - Whether to draw north arrow
 * @param {boolean} [options.showLatLongGrid] - Whether to draw lat/long grid
 * @param {boolean} [options.showUTMGrid] - Whether to draw UTM grid
 * @param {string} options.scale - Scale string like "1:25000"
 * @param {number} options.bearing - Map bearing in degrees
 * @param {Object} options.featuresByType - { type: { count, color } } for legend
 * @param {Object} [options.mapBounds] - { west, east, south, north } in degrees
 * @param {Function} [options.projectionFn] - (lngLat) => { x, y } canvas pixels
 * @param {number} [options.dpi=300] - Output DPI for pixel calculations
 * @returns {HTMLCanvasElement} Composite canvas
 */
export function composeLayout(mapCanvas, options) {
    const {
        title,
        showLegend,
        showScaleBar,
        showNorthArrow,
        showLatLongGrid = false,
        showUTMGrid = false,
        scale,
        bearing = 0,
        featuresByType = {},
        mapBounds,
        projectionFn,
        dpi = 300,
    } = options;

    const mapW = mapCanvas.width;
    const mapH = mapCanvas.height;
    const hasGrids = showLatLongGrid || showUTMGrid;

    // When grids are on, add margin bands for labels
    const marginPx = hasGrids ? Math.round(GRID_MARGIN_MM * (dpi / 25.4)) : 0;

    const totalWidth = mapW + 2 * marginPx;
    const totalHeight = mapH + 2 * marginPx;

    const canvas = document.createElement('canvas');
    canvas.width = totalWidth;
    canvas.height = totalHeight;
    const ctx = canvas.getContext('2d');

    // White background for margin bands
    if (hasGrids) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, totalWidth, totalHeight);
    }

    // Map image (offset by margin when grids are on)
    ctx.drawImage(mapCanvas, marginPx, marginPx);

    // Adjusted projection function that accounts for margin offset
    const adjProjFn = projectionFn && marginPx > 0
        ? (lngLat) => {
            const pt = projectionFn(lngLat);
            return { x: pt.x + marginPx, y: pt.y + marginPx };
        }
        : projectionFn;

    const scaleDenom = scale ? parseInt(scale.split(':')[1], 10) : 25000;

    // Scale factor for overlay elements. At 200 DPI the constant pixel sizes
    // produce correctly proportioned output; scale proportionally for other DPIs.
    // Canvas scaling is applied around each element so internal drawing code
    // stays unchanged — only position coordinates are divided by uiScale.
    const uiScale = dpi / 200;

    // Draw UTM grid first (black, heavier), then lat/long (blue, lighter) on top
    const hasBothGrids = showUTMGrid && showLatLongGrid;
    if (showUTMGrid && mapBounds && adjProjFn) {
        _drawUTMGrid(ctx, mapBounds, mapW, mapH, marginPx, adjProjFn, scaleDenom, hasBothGrids, uiScale);
    }
    if (showLatLongGrid && mapBounds && adjProjFn) {
        _drawLatLongGrid(ctx, mapBounds, mapW, mapH, marginPx, adjProjFn, scaleDenom, hasBothGrids, uiScale);
    }

    // Map border — always drawn for cartographic framing
    ctx.strokeStyle = '#333333';
    ctx.lineWidth = Math.max(1, 2 * uiScale);
    ctx.strokeRect(marginPx, marginPx, mapW, mapH);

    // Title (overlaid on map area, pushed below margin band when grids are on)
    if (title) {
        ctx.save();
        ctx.scale(uiScale, uiScale);
        _drawTitle(ctx, title, totalWidth / uiScale, marginPx / uiScale);
        ctx.restore();
    }

    // North arrow (top-right of map area)
    if (showNorthArrow) {
        ctx.save();
        ctx.scale(uiScale, uiScale);
        const northY = marginPx / uiScale + (title ? (TITLE_HEIGHT + 40) : 30);
        const northX = (marginPx + mapW) / uiScale - NORTH_ARROW_SIZE - 30;
        _drawNorthArrow(ctx, northX, northY, bearing);
        ctx.restore();
    }

    // Scale bar (bottom-left of map area)
    if (showScaleBar) {
        ctx.save();
        ctx.scale(uiScale, uiScale);
        const barX = marginPx / uiScale + 40;
        const barY = (marginPx + mapH) / uiScale - SCALE_BAR_HEIGHT - 30;
        // Pass reference DPI (200) because the canvas scale transform
        // accounts for the actual DPI ratio already
        _drawScaleBar(ctx, barX, barY, scale, mapW / uiScale, 200);
        ctx.restore();
    }

    // Legend (bottom-right of map area)
    const legendEntries = Object.entries(featuresByType)
        .map(([type, value]) => {
            if (typeof value === 'number') return [type, value, null];
            return [type, value.count, value.color || null];
        })
        .filter(([, count]) => count > 0);
    if (showLegend && legendEntries.length > 0) {
        ctx.save();
        ctx.scale(uiScale, uiScale);
        _drawLegend(ctx, (marginPx + mapW) / uiScale, (marginPx + mapH) / uiScale, legendEntries);
        ctx.restore();
    }

    return canvas;
}

// ============================================================================
// PRIVATE DRAWING FUNCTIONS
// ============================================================================

/**
 * Draws the map title as an overlay badge centered at the top.
 * When grids are on (marginPx > 0), the title sits inside the map area
 * below the margin band so it does not overlap grid labels.
 * @param {number} [marginPx=0] - Grid margin band height in pixels
 */
function _drawTitle(ctx, title, width, marginPx = 0) {
    // When grids are on, position title inside the map area (below grid labels)
    const topMargin = marginPx > 0 ? marginPx + 20 : 20;
    const paddingX = 28;
    const paddingY = 14;

    ctx.font = `bold 36px ${FONT_FAMILY}`;
    const textMetrics = ctx.measureText(title);
    const textWidth = textMetrics.width;

    const bgWidth = Math.min(textWidth + paddingX * 2, width - 60);
    const bgHeight = TITLE_HEIGHT;
    const bgX = (width - bgWidth) / 2;
    const bgY = topMargin;

    // Semi-transparent background with rounded corners
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.strokeStyle = '#999999';
    ctx.lineWidth = 1;
    _roundRect(ctx, bgX, bgY, bgWidth, bgHeight, 6);
    ctx.fill();
    _roundRect(ctx, bgX, bgY, bgWidth, bgHeight, 6);
    ctx.stroke();

    // Title text (clipped to background width)
    ctx.save();
    ctx.beginPath();
    ctx.rect(bgX + paddingX / 2, bgY, bgWidth - paddingX, bgHeight);
    ctx.clip();

    ctx.fillStyle = '#1a1a1a';
    ctx.font = `bold 36px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(title, width / 2, bgY + bgHeight / 2 + paddingY / 4);

    ctx.restore();
}

/**
 * Draws a north arrow at the given position.
 * Larger circle with N label clearly inside.
 */
function _drawNorthArrow(ctx, x, y, bearing) {
    const size = NORTH_ARROW_SIZE;
    const cx = x + size / 2;
    const cy = y + size / 2;
    const r = size / 2;
    const rotation = -bearing * Math.PI / 180;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rotation);

    // Background circle
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.strokeStyle = '#333333';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Arrow + N centered in circle
    const tipY = -12;
    const baseY = 24;
    const splitY = 14;
    const wingX = 13;

    // North half (filled dark)
    ctx.fillStyle = '#333333';
    ctx.beginPath();
    ctx.moveTo(0, tipY);
    ctx.lineTo(-wingX, baseY);
    ctx.lineTo(0, splitY);
    ctx.closePath();
    ctx.fill();

    // South half (outline only)
    ctx.strokeStyle = '#333333';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, tipY);
    ctx.lineTo(wingX, baseY);
    ctx.lineTo(0, splitY);
    ctx.closePath();
    ctx.stroke();

    // "N" label — centered above the arrow tip
    ctx.fillStyle = '#333333';
    ctx.font = `bold 20px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText('N', 0, tipY - 2);

    ctx.restore();
}

/**
 * Draws a scale bar at the given position with labels at each division.
 */
function _drawScaleBar(ctx, x, y, scale, canvasWidth, dpi = 300) {
    const denominator = parseInt(scale.split(':')[1], 10);

    // Calculate a "nice" distance for the scale bar (roughly 1/5 of map width)
    const mapWidthMM = canvasWidth / (dpi / 25.4);
    const mapWidthMeters = (mapWidthMM / 1000) * denominator;
    const targetBarMeters = mapWidthMeters / 5;

    // Round to a nice number
    const niceDistance = _niceNumber(targetBarMeters);
    const barWidthPx = (niceDistance / mapWidthMeters) * canvasWidth;

    // Background
    const bgPad = 10;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.fillRect(x - bgPad, y - bgPad, barWidthPx + bgPad * 2, SCALE_BAR_HEIGHT + bgPad + 4);

    // Scale text (top, larger, with dot separator)
    ctx.fillStyle = '#333333';
    ctx.textAlign = 'left';
    ctx.font = `bold 16px ${FONT_FAMILY}`;
    ctx.textBaseline = 'top';
    ctx.fillText(_formatScaleText(denominator), x, y);

    // Scale bar body (alternating black/white segments)
    const segments = 4;
    const segWidth = barWidthPx / segments;
    const barY = y + 22;
    const barH = 10;

    for (let i = 0; i < segments; i++) {
        ctx.fillStyle = i % 2 === 0 ? '#333333' : '#ffffff';
        ctx.fillRect(x + i * segWidth, barY, segWidth, barH);
    }

    // Border around bar
    ctx.strokeStyle = '#333333';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, barY, barWidthPx, barH);

    // Labels at each division
    ctx.fillStyle = '#333333';
    ctx.font = `13px ${FONT_FAMILY}`;
    ctx.textBaseline = 'top';
    const labelY = barY + barH + 4;

    for (let i = 0; i <= segments; i++) {
        const distAtSegment = (niceDistance / segments) * i;
        const label = _formatBarLabel(distAtSegment);

        if (i === 0) {
            ctx.textAlign = 'left';
        } else if (i === segments) {
            ctx.textAlign = 'right';
        } else {
            ctx.textAlign = 'center';
        }

        ctx.fillText(label, x + i * segWidth, labelY);
    }
}

/**
 * Draws a legend overlaid on the map area (bottom-right corner).
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} canvasWidth - Total canvas width (for right-align)
 * @param {number} mapBottom - Bottom Y coordinate of map area
 * @param {Array} legendEntries - Array of [type, count, color|null]
 */
function _drawLegend(ctx, canvasWidth, mapBottom, legendEntries) {
    const padding = LEGEND_PADDING;
    const titleH = 28;
    const contentH = legendEntries.length * LEGEND_ROW_HEIGHT;
    const totalH = padding * 2 + titleH + contentH;
    const totalW = 260;

    // Position: bottom-right of map area with margin
    const boxX = canvasWidth - totalW - 30;
    const boxY = mapBottom - totalH - 30;

    // Background with rounded corners and border
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.strokeStyle = '#999999';
    ctx.lineWidth = 1;
    _roundRect(ctx, boxX, boxY, totalW, totalH, 6);
    ctx.fill();
    ctx.stroke();

    // Title
    ctx.fillStyle = '#333333';
    ctx.font = `bold 16px ${FONT_FAMILY}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('Legenda', boxX + padding, boxY + padding);

    // Separator line
    const sepY = boxY + padding + titleH - 4;
    ctx.strokeStyle = '#dddddd';
    ctx.beginPath();
    ctx.moveTo(boxX + padding, sepY);
    ctx.lineTo(boxX + totalW - padding, sepY);
    ctx.stroke();

    // Entries
    let offsetY = boxY + padding + titleH;
    ctx.font = `14px ${FONT_FAMILY}`;

    for (const [type, count, color] of legendEntries) {
        const displayName = _getTypeDisplayName(type);

        // Symbol swatch — use actual feature color when available
        _drawLegendSwatch(ctx, boxX + padding, offsetY + 4, type, color);

        // Label
        ctx.fillStyle = '#333333';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${displayName} (${count})`, boxX + padding + 30, offsetY + LEGEND_ROW_HEIGHT / 2);

        offsetY += LEGEND_ROW_HEIGHT;
    }
}

// ============================================================================
// GRID DRAWING FUNCTIONS
// ============================================================================

/**
 * Returns grid spacing for a given scale denominator.
 * @param {number} scaleDenom - Scale denominator (e.g. 25000)
 * @returns {{ utmMeters: number, degreesInterval: number }}
 */
function _getGridSpacing(scaleDenom) {
    if (scaleDenom <= 5000) return { utmMeters: 100, degreesInterval: 0.001 };
    if (scaleDenom <= 25000) return { utmMeters: 1000, degreesInterval: 0.01 };
    if (scaleDenom <= 100000) return { utmMeters: 5000, degreesInterval: 0.05 };
    if (scaleDenom <= 1000000) return { utmMeters: 10000, degreesInterval: 0.1 };
    return { utmMeters: 50000, degreesInterval: 0.5 };
}

/**
 * Draws lat/long grid lines with labels in the margin bands.
 * Lines are blue and dashed. Labels in DMS format.
 * Side labels are rotated vertically.
 * @param {boolean} hasBothGrids - When true, labels sit farther from map frame
 */
function _drawLatLongGrid(ctx, mapBounds, mapW, mapH, marginPx, projFn, scaleDenom, hasBothGrids, uiScale = 1) {
    const { degreesInterval } = _getGridSpacing(scaleDenom);
    const { west, east, south, north } = mapBounds;

    const mapLeft = marginPx;
    const mapTop = marginPx;
    const mapRight = marginPx + mapW;
    const mapBottom = marginPx + mapH;

    // Label offset from map frame — close when alone, farther when UTM labels are closer
    const labelOffset = (hasBothGrids ? 28 : 6) * uiScale;
    const fontSize = Math.round(13 * uiScale);

    ctx.save();
    ctx.strokeStyle = 'rgba(0, 80, 180, 0.4)';
    ctx.lineWidth = Math.max(0.5, 0.8 * uiScale);
    ctx.setLineDash([6 * uiScale, 4 * uiScale]);
    ctx.fillStyle = 'rgba(0, 80, 180, 0.9)';
    ctx.font = `${fontSize}px ${FONT_FAMILY}`;

    // Horizontal lines (constant latitude, west → east)
    // Extend sampling 5% beyond bounds so endpoints land outside the map rect,
    // ensuring _findEdgeIntersection detects clear edge crossings for labels.
    const lngPad = (east - west) * 0.05;
    const latPad = (north - south) * 0.05;

    const firstLat = Math.ceil(south / degreesInterval) * degreesInterval;
    for (let lat = firstLat; lat <= north; lat += degreesInterval) {
        const points = [];
        for (let i = 0; i <= GRID_LINE_SAMPLES; i++) {
            const lng = (west - lngPad) + ((east - west) + 2 * lngPad) * (i / GRID_LINE_SAMPLES);
            points.push(projFn([lng, lat]));
        }

        _drawClippedPolyline(ctx, points, mapLeft, mapTop, mapRight, mapBottom);

        const leftPt = _findEdgeIntersection(points, mapLeft, 'left', mapTop, mapBottom);
        const rightPt = _findEdgeIntersection(points, mapRight, 'right', mapTop, mapBottom);
        const label = _formatDMS(lat, 'lat');

        // Left margin — rotated -90° (bottom-to-top), text extends into margin
        if (leftPt) {
            ctx.save();
            ctx.translate(mapLeft - labelOffset, leftPt.y);
            ctx.rotate(-Math.PI / 2);
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillText(label, 0, 0);
            ctx.restore();
        }
        // Right margin — rotated +90° (top-to-bottom), text extends into margin
        if (rightPt) {
            ctx.save();
            ctx.translate(mapRight + labelOffset, rightPt.y);
            ctx.rotate(Math.PI / 2);
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillText(label, 0, 0);
            ctx.restore();
        }
    }

    // Vertical lines (constant longitude, south → north)
    const firstLng = Math.ceil(west / degreesInterval) * degreesInterval;
    for (let lng = firstLng; lng <= east; lng += degreesInterval) {
        const points = [];
        for (let i = 0; i <= GRID_LINE_SAMPLES; i++) {
            const lat = (south - latPad) + ((north - south) + 2 * latPad) * (i / GRID_LINE_SAMPLES);
            points.push(projFn([lng, lat]));
        }

        _drawClippedPolyline(ctx, points, mapLeft, mapTop, mapRight, mapBottom);

        const topPt = _findEdgeIntersection(points, mapTop, 'top', mapLeft, mapRight);
        const bottomPt = _findEdgeIntersection(points, mapBottom, 'bottom', mapLeft, mapRight);
        const label = _formatDMS(lng, 'lng');

        if (topPt) {
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillText(label, topPt.x, mapTop - labelOffset);
        }
        if (bottomPt) {
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(label, bottomPt.x, mapBottom + labelOffset);
        }
    }

    ctx.restore();
}

/**
 * Draws UTM grid lines with labels in the margin bands.
 * Lines are black and solid. Labels show full easting/northing with units.
 * Handles multiple UTM zones when the map spans a zone boundary.
 * Side labels are rotated vertically.
 * @param {boolean} hasBothGrids - When true, labels always sit close to frame
 */
function _drawUTMGrid(ctx, mapBounds, mapW, mapH, marginPx, projFn, scaleDenom, _hasBothGrids, uiScale = 1) {
    const { utmMeters } = _getGridSpacing(scaleDenom);
    const { west, east, south, north } = mapBounds;

    const mapLeft = marginPx;
    const mapTop = marginPx;
    const mapRight = marginPx + mapW;
    const mapBottom = marginPx + mapH;

    // UTM labels always close to the map frame
    const labelOffset = 8 * uiScale;
    const fontSize = Math.round(13 * uiScale);

    const westZone = _utmZone(west);
    const eastZone = _utmZone(east);

    ctx.save();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.lineWidth = Math.max(0.5, 1.0 * uiScale);
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.font = `bold ${fontSize}px ${FONT_FAMILY}`;

    for (let zone = westZone; zone <= eastZone; zone++) {
        const isSouth = ((south + north) / 2) < 0;
        const utmProj = `+proj=utm +zone=${zone} ${isSouth ? '+south' : ''} +datum=WGS84 +units=m +no_defs`;
        const wgs84 = '+proj=longlat +datum=WGS84 +no_defs';

        const zoneLngWest = Math.max((zone - 1) * 6 - 180, west);
        const zoneLngEast = Math.min(zone * 6 - 180, east);

        const corners = [
            [zoneLngWest, south], [zoneLngEast, south],
            [zoneLngWest, north], [zoneLngEast, north],
        ];
        let minE = Infinity, maxE = -Infinity, minN = Infinity, maxN = -Infinity;
        for (const [lng, lat] of corners) {
            const [e, n] = proj4(wgs84, utmProj, [lng, lat]);
            if (e < minE) minE = e;
            if (e > maxE) maxE = e;
            if (n < minN) minN = n;
            if (n > maxN) maxN = n;
        }

        const firstE = Math.ceil(minE / utmMeters) * utmMeters;
        const firstN = Math.ceil(minN / utmMeters) * utmMeters;

        // Extend sampling 5% beyond UTM extent so endpoints land outside
        // the map rect, ensuring lines reach the frame and labels are found.
        const nPad = (maxN - minN) * 0.1;
        const ePad = (maxE - minE) * 0.1;

        // Easting lines (vertical — constant easting, varying northing)
        for (let e = firstE; e <= maxE; e += utmMeters) {
            const points = [];
            for (let i = 0; i <= GRID_LINE_SAMPLES; i++) {
                const n = (minN - nPad) + ((maxN - minN) + 2 * nPad) * (i / GRID_LINE_SAMPLES);
                try {
                    const [lng, lat] = proj4(utmProj, wgs84, [e, n]);
                    if (lng >= zoneLngWest - 0.01 && lng <= zoneLngEast + 0.01) {
                        points.push(projFn([lng, lat]));
                    }
                } catch { /* skip invalid projections */ }
            }
            if (points.length < 2) continue;

            _drawClippedPolyline(ctx, points, mapLeft, mapTop, mapRight, mapBottom);

            const topPt = _findEdgeIntersection(points, mapTop, 'top', mapLeft, mapRight);
            const bottomPt = _findEdgeIntersection(points, mapBottom, 'bottom', mapLeft, mapRight);
            const label = _formatUTMValue(e, 'E');

            if (topPt) {
                ctx.textAlign = 'center';
                ctx.textBaseline = 'bottom';
                ctx.fillText(label, topPt.x, mapTop - labelOffset);
            }
            if (bottomPt) {
                ctx.textAlign = 'center';
                ctx.textBaseline = 'top';
                ctx.fillText(label, bottomPt.x, mapBottom + labelOffset);
            }
        }

        // Northing lines (horizontal — constant northing, varying easting)
        for (let n = firstN; n <= maxN; n += utmMeters) {
            const points = [];
            for (let i = 0; i <= GRID_LINE_SAMPLES; i++) {
                const e = (minE - ePad) + ((maxE - minE) + 2 * ePad) * (i / GRID_LINE_SAMPLES);
                try {
                    const [lng, lat] = proj4(utmProj, wgs84, [e, n]);
                    if (lng >= zoneLngWest - 0.01 && lng <= zoneLngEast + 0.01) {
                        points.push(projFn([lng, lat]));
                    }
                } catch { /* skip invalid projections */ }
            }
            if (points.length < 2) continue;

            _drawClippedPolyline(ctx, points, mapLeft, mapTop, mapRight, mapBottom);

            const leftPt = _findEdgeIntersection(points, mapLeft, 'left', mapTop, mapBottom);
            const rightPt = _findEdgeIntersection(points, mapRight, 'right', mapTop, mapBottom);
            const label = _formatUTMValue(n, 'N');

            // Left margin — rotated -90°, text extends into margin
            if (leftPt) {
                ctx.save();
                ctx.translate(mapLeft - labelOffset, leftPt.y);
                ctx.rotate(-Math.PI / 2);
                ctx.textAlign = 'center';
                ctx.textBaseline = 'bottom';
                ctx.fillText(label, 0, 0);
                ctx.restore();
            }
            // Right margin — rotated +90°, text extends into margin
            if (rightPt) {
                ctx.save();
                ctx.translate(mapRight + labelOffset, rightPt.y);
                ctx.rotate(Math.PI / 2);
                ctx.textAlign = 'center';
                ctx.textBaseline = 'bottom';
                ctx.fillText(label, 0, 0);
                ctx.restore();
            }
        }

        // Zone boundary lines with heavier stroke
        if (zone < eastZone) {
            const boundaryLng = zone * 6 - 180;
            const latRange = north - south;
            const latBoundaryPad = latRange * 0.1;
            const points = [];
            for (let i = 0; i <= GRID_LINE_SAMPLES; i++) {
                const lat = (south - latBoundaryPad) + (latRange + 2 * latBoundaryPad) * (i / GRID_LINE_SAMPLES);
                points.push(projFn([boundaryLng, lat]));
            }
            ctx.save();
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
            ctx.lineWidth = 2 * uiScale;
            ctx.setLineDash([10 * uiScale, 5 * uiScale]);
            _drawClippedPolyline(ctx, points, mapLeft, mapTop, mapRight, mapBottom);
            ctx.restore();
        }
    }

    ctx.restore();
}

/**
 * Draws a polyline clipped to the map rectangle.
 * Only segments inside the rect are stroked.
 */
function _drawClippedPolyline(ctx, points, left, top, right, bottom) {
    if (points.length < 2) return;

    ctx.beginPath();
    let drawing = false;

    for (let i = 0; i < points.length; i++) {
        const p = points[i];
        const inside = p.x >= left && p.x <= right && p.y >= top && p.y <= bottom;

        if (inside) {
            if (!drawing) {
                // If previous point was outside, find edge crossing to start cleanly.
                // _clipSegment handles any inside/outside combination and returns
                // the entry point (x1, y1) at the rectangle edge.
                if (i > 0) {
                    const prev = points[i - 1];
                    const seg = _clipSegment(prev, p, left, top, right, bottom);
                    if (seg) ctx.moveTo(seg.x1, seg.y1);
                    else ctx.moveTo(p.x, p.y);
                } else {
                    ctx.moveTo(p.x, p.y);
                }
                drawing = true;
            }
            ctx.lineTo(p.x, p.y);
        } else if (drawing) {
            // Just left the rect — clip to exit edge
            const prev = points[i - 1];
            const seg = _clipSegment(prev, p, left, top, right, bottom);
            if (seg) ctx.lineTo(seg.x2, seg.y2);
            drawing = false;
        } else if (i > 0) {
            // Both outside — check if segment crosses the rect
            const prev = points[i - 1];
            const segment = _clipSegment(prev, p, left, top, right, bottom);
            if (segment) {
                ctx.moveTo(segment.x1, segment.y1);
                ctx.lineTo(segment.x2, segment.y2);
            }
        }
    }

    ctx.stroke();
}

/**
 * Finds where a polyline crosses a specific edge of the map rectangle.
 * Returns the intersection point closest to the middle of the edge.
 * @param {Array} points - Array of {x, y}
 * @param {number} edgeVal - The coordinate value of the edge
 * @param {'left'|'right'|'top'|'bottom'} edgeType
 * @param {number} minOrtho - Min value on the orthogonal axis
 * @param {number} maxOrtho - Max value on the orthogonal axis
 * @returns {{x: number, y: number}|null}
 */
function _findEdgeIntersection(points, edgeVal, edgeType, minOrtho, maxOrtho) {
    const isHorizontal = edgeType === 'left' || edgeType === 'right';
    let best = null;
    let bestDist = Infinity;
    const mid = (minOrtho + maxOrtho) / 2;

    for (let i = 1; i < points.length; i++) {
        const a = points[i - 1];
        const b = points[i];

        let cross;
        if (isHorizontal) {
            // Edge is vertical line x = edgeVal
            if ((a.x - edgeVal) * (b.x - edgeVal) > 0) continue;
            if (Math.abs(b.x - a.x) < 0.001) continue;
            const t = (edgeVal - a.x) / (b.x - a.x);
            const y = a.y + t * (b.y - a.y);
            if (y < minOrtho || y > maxOrtho) continue;
            cross = { x: edgeVal, y };
        } else {
            // Edge is horizontal line y = edgeVal
            if ((a.y - edgeVal) * (b.y - edgeVal) > 0) continue;
            if (Math.abs(b.y - a.y) < 0.001) continue;
            const t = (edgeVal - a.y) / (b.y - a.y);
            const x = a.x + t * (b.x - a.x);
            if (x < minOrtho || x > maxOrtho) continue;
            cross = { x, y: edgeVal };
        }

        // Prefer intersection closest to the middle of the edge
        const dist = isHorizontal
            ? Math.abs(cross.y - mid)
            : Math.abs(cross.x - mid);
        if (dist < bestDist) {
            bestDist = dist;
            best = cross;
        }
    }

    return best;
}

/**
 * Clips a segment (both points outside) to a rectangle.
 * Returns { x1, y1, x2, y2 } of the visible portion, or null.
 */
function _clipSegment(a, b, left, top, right, bottom) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    let tMin = 0;
    let tMax = 1;

    const edges = [
        { p: -dx, q: a.x - left },
        { p: dx, q: right - a.x },
        { p: -dy, q: a.y - top },
        { p: dy, q: bottom - a.y },
    ];

    for (const { p, q } of edges) {
        if (Math.abs(p) < 0.0001) {
            if (q < 0) return null;
            continue;
        }
        const t = q / p;
        if (p < 0) {
            if (t > tMin) tMin = t;
        } else {
            if (t < tMax) tMax = t;
        }
        if (tMin > tMax) return null;
    }

    return {
        x1: a.x + tMin * dx, y1: a.y + tMin * dy,
        x2: a.x + tMax * dx, y2: a.y + tMax * dy,
    };
}

/**
 * Formats a degree value in degrees, minutes, seconds with hemisphere.
 * Omits seconds when 0, omits minutes+seconds when both 0.
 * @param {number} value - Degrees (signed)
 * @param {'lat'|'lng'} axis
 * @returns {string} e.g. "22°15'30"S" or "43°W"
 */
function _formatDMS(value, axis) {
    const abs = Math.abs(value);
    const deg = Math.floor(abs);
    const minFloat = (abs - deg) * 60;
    const min = Math.floor(minFloat);
    const sec = Math.round((minFloat - min) * 60);

    const hemisphere = axis === 'lat'
        ? (value >= 0 ? 'N' : 'S')
        : (value >= 0 ? 'E' : 'W');

    if (sec === 0 && min === 0) return `${deg}°${hemisphere}`;
    if (sec === 0) return `${deg}°${min}'${hemisphere}`;
    return `${deg}°${min}'${sec}"${hemisphere}`;
}

/**
 * Formats a UTM easting or northing value with unit.
 * @param {number} meters - Value in meters
 * @param {'E'|'N'} axis - Easting or Northing
 * @returns {string} e.g. "680000 m E" or "7517000 m N"
 */
function _formatUTMValue(meters, axis) {
    return `${Math.round(meters)} m ${axis}`;
}

/**
 * Returns the UTM zone number for a longitude.
 * @param {number} lng - Longitude in degrees
 * @returns {number} Zone 1..60
 */
function _utmZone(lng) {
    return Math.min(60, Math.max(1, Math.floor((lng + 180) / 6) + 1));
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Draws a rounded rectangle path.
 */
function _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

const DEFAULT_SWATCH_COLOR = '#3f4fb5';

/**
 * Draws a small symbol swatch for the legend.
 * Uses the actual feature color when available.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {string} type - Feature type
 * @param {string|null} color - Representative color from features (null = default)
 */
function _drawLegendSwatch(ctx, x, y, type, color) {
    const swatchColor = color || DEFAULT_SWATCH_COLOR;
    ctx.fillStyle = swatchColor;
    ctx.strokeStyle = swatchColor;
    ctx.lineWidth = 2;

    switch (type) {
        case 'point':
            ctx.beginPath();
            ctx.arc(x + 8, y + 8, 5, 0, Math.PI * 2);
            ctx.fill();
            break;
        case 'line':
        case 'brush':
            ctx.beginPath();
            ctx.moveTo(x, y + 12);
            ctx.lineTo(x + 16, y + 4);
            ctx.stroke();
            break;
        case 'polygon':
        case 'rectangle':
        case 'circle':
        case 'ellipse':
        case 'sector':
            ctx.globalAlpha = 0.3;
            ctx.fillRect(x, y + 2, 16, 12);
            ctx.globalAlpha = 1;
            ctx.strokeRect(x, y + 2, 16, 12);
            break;
        case 'text':
            ctx.font = `bold 14px ${FONT_FAMILY}`;
            ctx.fillText('T', x + 2, y + 14);
            break;
        case 'arrow':
            ctx.beginPath();
            ctx.moveTo(x, y + 10);
            ctx.lineTo(x + 12, y + 10);
            ctx.lineTo(x + 10, y + 6);
            ctx.moveTo(x + 12, y + 10);
            ctx.lineTo(x + 10, y + 14);
            ctx.stroke();
            break;
        default:
            // Generic square
            ctx.fillRect(x + 2, y + 2, 12, 12);
            break;
    }
}

/**
 * Returns a "nice" rounded number for scale bar distances.
 */
function _niceNumber(value) {
    const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
    const fraction = value / magnitude;

    if (fraction <= 1) return magnitude;
    if (fraction <= 2) return 2 * magnitude;
    if (fraction <= 5) return 5 * magnitude;
    return 10 * magnitude;
}

/**
 * Formats a scale bar label value (distance).
 * @param {number} meters - Distance in meters
 * @returns {string}
 */
function _formatBarLabel(meters) {
    if (meters === 0) return '0';
    if (meters >= 1000) {
        const km = meters / 1000;
        return Number.isInteger(km) ? `${km} km` : `${km.toFixed(1)} km`;
    }
    return `${Math.round(meters)} m`;
}

/**
 * Formats the scale text with dot separator (e.g., 25000 → "1:25.000").
 * @param {number} denominator - Scale denominator
 * @returns {string}
 */
function _formatScaleText(denominator) {
    const formatted = denominator.toLocaleString('pt-BR');
    return `1:${formatted}`;
}

/**
 * Returns a Portuguese display name for a feature type.
 */
function _getTypeDisplayName(type) {
    const names = {
        point: 'Pontos',
        line: 'Linhas',
        polygon: 'Polígonos',
        text: 'Textos',
        image: 'Imagens',
        circle: 'Círculos',
        rectangle: 'Retângulos',
        ellipse: 'Elipses',
        brush: 'Pincel',
        arrow: 'Setas',
        boundary: 'Limites',
        occupied_front: 'Frentes Ocupadas',
        military_symbol: 'Símbolos Militares',
        coordination_measure: 'Medidas de Coordenação',
        los: 'Linhas de Visada',
        visibility: 'Visibilidade',
        sector: 'Setores',
    };
    return names[type] || type;
}

// Path: js/import_export/pdf-cartographic-elements.js

/**
 * @module import_export/pdf-cartographic-elements
 * @description Pure Canvas 2D drawing functions for cartographic layout elements.
 * Used by pdf-export.tab.js to compose title, legend, scale bar, and north arrow
 * onto the captured map canvas before sending to GDAL.
 *
 * Legend, scale bar, and north arrow are overlaid on the map area so they don't
 * alter the A4 page dimensions. Only the title (when enabled) adds height above.
 */

// ============================================================================
// CONSTANTS
// ============================================================================

const TITLE_HEIGHT = 80;
const LEGEND_ROW_HEIGHT = 28;
const LEGEND_PADDING = 20;
const SCALE_BAR_HEIGHT = 60;
const NORTH_ARROW_SIZE = 90;
const FONT_FAMILY = 'Arial, Helvetica, sans-serif';

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Composes a cartographic layout onto the map canvas.
 * Returns a new canvas with map + cartographic elements.
 *
 * Legend, scale bar, and north arrow are overlaid on the map area
 * so they don't expand the A4 page dimensions.
 * Only the title adds height above the map when enabled.
 *
 * @param {HTMLCanvasElement} mapCanvas - The captured map canvas
 * @param {Object} options
 * @param {string|null} options.title - Map title (null = no title)
 * @param {boolean} options.showLegend - Whether to draw legend
 * @param {boolean} options.showScaleBar - Whether to draw scale bar
 * @param {boolean} options.showNorthArrow - Whether to draw north arrow
 * @param {string} options.scale - Scale string like "1:25000"
 * @param {number} options.bearing - Map bearing in degrees
 * @param {Object} options.featuresByType - { type: count } for legend
 * @returns {HTMLCanvasElement} Composite canvas
 */
export function composeLayout(mapCanvas, options) {
    const {
        title,
        showLegend,
        showScaleBar,
        showNorthArrow,
        scale,
        bearing = 0,
        featuresByType = {},
    } = options;

    const titleH = title ? TITLE_HEIGHT : 0;

    // Canvas includes title above map; legend/scale/north are overlaid on map
    const totalWidth = mapCanvas.width;
    const totalHeight = mapCanvas.height + titleH;

    const canvas = document.createElement('canvas');
    canvas.width = totalWidth;
    canvas.height = totalHeight;
    const ctx = canvas.getContext('2d');

    // White background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, totalWidth, totalHeight);

    // Title above map
    if (title) {
        _drawTitle(ctx, title, totalWidth, titleH);
    }

    // Map image
    ctx.drawImage(mapCanvas, 0, titleH);

    // North arrow (top-right corner of map area, overlaid)
    if (showNorthArrow) {
        _drawNorthArrow(ctx, totalWidth - NORTH_ARROW_SIZE - 30, titleH + 30, bearing);
    }

    // Scale bar (bottom-left corner of map area, overlaid)
    if (showScaleBar) {
        _drawScaleBar(ctx, 40, titleH + mapCanvas.height - SCALE_BAR_HEIGHT - 30, scale, mapCanvas.width);
    }

    // Legend (bottom-right corner of map area, overlaid)
    const legendEntries = Object.entries(featuresByType).filter(([, count]) => count > 0);
    if (showLegend && legendEntries.length > 0) {
        _drawLegend(ctx, totalWidth, titleH + mapCanvas.height, legendEntries);
    }

    return canvas;
}

// ============================================================================
// PRIVATE DRAWING FUNCTIONS
// ============================================================================

/**
 * Draws the map title centered at the top.
 */
function _drawTitle(ctx, title, width, height) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    // Bottom border
    ctx.strokeStyle = '#cccccc';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, height - 1);
    ctx.lineTo(width, height - 1);
    ctx.stroke();

    // Title text
    ctx.fillStyle = '#1a1a1a';
    ctx.font = `bold 36px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(title, width / 2, height / 2);
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
function _drawScaleBar(ctx, x, y, scale, canvasWidth) {
    const denominator = parseInt(scale.split(':')[1], 10);

    // Calculate a "nice" distance for the scale bar (roughly 1/5 of map width)
    const mapWidthMM = canvasWidth / (300 / 25.4); // pixels to mm at 300 DPI
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
 * @param {Array} legendEntries - Array of [type, count]
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

    for (const [type, count] of legendEntries) {
        const displayName = _getTypeDisplayName(type);

        // Symbol swatch
        _drawLegendSwatch(ctx, boxX + padding, offsetY + 4, type);

        // Label
        ctx.fillStyle = '#333333';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${displayName} (${count})`, boxX + padding + 30, offsetY + LEGEND_ROW_HEIGHT / 2);

        offsetY += LEGEND_ROW_HEIGHT;
    }
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

/**
 * Draws a small symbol swatch for the legend.
 */
function _drawLegendSwatch(ctx, x, y, type) {
    ctx.fillStyle = '#3f4fb5';
    ctx.strokeStyle = '#3f4fb5';
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

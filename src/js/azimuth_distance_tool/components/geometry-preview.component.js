// Path: js/azimuth_distance_tool/components/geometry-preview.component.js

/**
 * @fileoverview Geometry Preview SVG component.
 * Digital protractor / map preview for the azimuth distance tool.
 *
 * @module azimuth_distance_tool/components/geometry-preview
 */

import { COLORS, OUTPUT_MODE, NORTH_REFERENCE } from '../azimuth_distance_constants.js';
import { calculatePreviewPoints } from '../azimuth_distance_geometry.js';

/**
 * Create geometry preview SVG element.
 *
 * @param {Object} options - Component options
 * @param {Array<Object>} options.legs - Array of leg objects
 * @param {string} options.outputMode - Output mode (point, route, area)
 * @param {number} [options.declination=0] - Magnetic declination
 * @param {string} [options.northRef='true'] - North reference
 * @param {string} [options.angularUnit='degrees'] - Angular unit
 * @param {string} [options.distanceUnit='meters'] - Distance unit
 * @param {number} [options.width=210] - SVG width
 * @param {number} [options.height=210] - SVG height
 * @returns {SVGElement} SVG element
 */
export function createGeometryPreview(options) {
    const {
        legs = [],
        outputMode = OUTPUT_MODE.ROUTE,
        declination = 0,
        northRef = NORTH_REFERENCE.TRUE,
        angularUnit = 'degrees',
        distanceUnit = 'meters',
        width = 210,
        height = 210
    } = options;

    const pad = 24;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', width);
    svg.setAttribute('height', height);
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.classList.add('azd-geometry-preview');

    const rawPoints = calculatePreviewPoints(legs, angularUnit, distanceUnit, declination, northRef);
    const pts = normalizePoints(rawPoints, width, height, pad);

    let content = '';

    // Grid lines
    [0.25, 0.5, 0.75].forEach(f => {
        content += `<g opacity="0.5">
            <line x1="${width * f}" y1="0" x2="${width * f}" y2="${height}"
                stroke="${COLORS.gray200}" stroke-width="0.5"/>
            <line x1="0" y1="${height * f}" x2="${width}" y2="${height * f}"
                stroke="${COLORS.gray200}" stroke-width="0.5"/>
        </g>`;
    });

    // North arrow
    content += `<defs>
        <marker id="arrowN" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
            <path d="M0,6 L3,0 L6,6" fill="none" stroke="${COLORS.red600}" stroke-width="1"/>
        </marker>
    </defs>`;
    content += `<line x1="${width - 16}" y1="18" x2="${width - 16}" y2="8"
        stroke="${COLORS.red600}" stroke-width="1.5" marker-end="url(#arrowN)"/>`;
    content += `<text x="${width - 16}" y="26" text-anchor="middle" font-size="7"
        fill="${COLORS.red600}" font-weight="700"
        font-family="'SF Mono', 'Cascadia Code', 'Consolas', monospace">N</text>`;

    // Path and labels
    if (pts.length > 1) {
        const pathD = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
        const closedPath = outputMode === OUTPUT_MODE.AREA && pts.length > 2 ? pathD + ' Z' : pathD;

        // Area fill
        if (outputMode === OUTPUT_MODE.AREA && pts.length > 2) {
            content += `<path d="${closedPath}" fill="rgba(22,163,74,0.1)" stroke="none"/>`;
        }

        // Route line
        content += `<path d="${closedPath}" fill="none" stroke="${COLORS.primary600}"
            stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;

        // Leg labels at midpoints
        pts.slice(1).forEach((p, i) => {
            const prev = pts[i];
            const mx = (prev.x + p.x) / 2;
            const my = (prev.y + p.y) / 2;

            content += `<g>
                <rect x="${mx - 8}" y="${my - 12}" width="16" height="11" rx="2"
                    fill="${COLORS.white}" stroke="${COLORS.gray300}" stroke-width="0.5"/>
                <text x="${mx}" y="${my - 4}" text-anchor="middle" font-size="7"
                    fill="${COLORS.gray600}" font-family="'SF Mono', 'Cascadia Code', 'Consolas', monospace"
                    font-weight="600">P${i + 1}</text>
            </g>`;
        });
    }

    // Waypoint dots
    pts.forEach((p, i) => {
        const isOrigin = i === 0;
        const radius = isOrigin ? 5 : 4;
        const fillColor = isOrigin ? COLORS.red600 : COLORS.primary600;

        content += `<circle cx="${p.x}" cy="${p.y}" r="${radius}"
            fill="${fillColor}" stroke="${COLORS.white}" stroke-width="1.5"/>`;

        if (isOrigin) {
            content += `<text x="${p.x + 9}" y="${p.y - 7}" font-size="8"
                fill="${COLORS.red600}" font-weight="700"
                font-family="'SF Mono', 'Cascadia Code', 'Consolas', monospace">ORIG</text>`;
        }
    });

    svg.innerHTML = content;
    return svg;
}

/**
 * Normalize points to fit within viewport.
 *
 * @param {Array<{x: number, y: number}>} raw - Raw points
 * @param {number} W - Viewport width
 * @param {number} H - Viewport height
 * @param {number} pad - Padding
 * @returns {Array<{x: number, y: number}>} Normalized points
 */
function normalizePoints(raw, W, H, pad) {
    if (raw.length < 2) {
        return [{ x: W / 2, y: H / 2 }];
    }

    const xs = raw.map(p => p.x);
    const ys = raw.map(p => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;

    const scale = (Math.min(W, H) - pad * 2) / Math.max(rangeX, rangeY);
    const oX = pad + ((W - pad * 2) - rangeX * scale) / 2;
    const oY = pad + ((H - pad * 2) - rangeY * scale) / 2;

    return raw.map(p => ({
        x: oX + (p.x - minX) * scale,
        y: oY + (p.y - minY) * scale
    }));
}

/**
 * Create geometry preview container with wrapper.
 *
 * @param {Object} options - Options
 * @returns {{container: HTMLElement, update: Function}}
 */
export function createGeometryPreviewComponent(options) {
    const container = document.createElement('div');
    container.className = 'azimuth-distance-preview-container';

    let currentSvg = createGeometryPreview(options);
    container.appendChild(currentSvg);

    return {
        container,
        update: (newOptions) => {
            const newSvg = createGeometryPreview(newOptions);
            container.replaceChild(newSvg, currentSvg);
            currentSvg = newSvg;
        }
    };
}

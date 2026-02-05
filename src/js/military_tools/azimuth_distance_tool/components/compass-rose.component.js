// Path: js/military_tools/azimuth_distance_tool/components/compass-rose.component.js

/**
 * @fileoverview Compass Rose SVG component.
 * Replicates the lensatic compass bezel with azimuth indicator.
 *
 * @module military_tools/azimuth_distance_tool/components/compass-rose
 */

import { COLORS, NORTH_REFERENCE } from '../azimuth_distance_constants.js';

/**
 * Create a compass rose SVG element.
 *
 * @param {Object} options - Component options
 * @param {number} options.azimuthDeg - Current azimuth in degrees
 * @param {number} [options.size=156] - Size in pixels
 * @param {number} [options.declination=0] - Magnetic declination in degrees
 * @param {string} [options.northRef='true'] - North reference
 * @returns {SVGElement} SVG element
 */
export function createCompassRose(options) {
    const {
        azimuthDeg = 0,
        size = 180, // Increased default size
        declination = 0,
        northRef = NORTH_REFERENCE.TRUE
    } = options;

    // When magnetic north is active, show declination offset
    const showDecl = northRef === NORTH_REFERENCE.MAGNETIC && declination !== 0;
    const declDeg = showDecl ? declination : 0;

    // Extra space for labels outside compass
    const extraTop = showDecl ? 24 : 0;
    const extraBottom = showDecl ? 26 : 0;
    const totalHeight = size + extraTop + extraBottom;

    // Center of compass (offset by extraTop)
    const c = size / 2;
    const cy = c + extraTop; // Y center is offset
    const outerR = c - 8;
    const innerR = outerR - 16;
    const labelR = innerR - 14;
    const needleR = outerR - 6;
    const azRad = ((azimuthDeg - 90) * Math.PI) / 180;
    const declRad = ((declDeg - 90) * Math.PI) / 180;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', size);
    svg.setAttribute('height', totalHeight);
    svg.setAttribute('viewBox', `0 0 ${size} ${totalHeight}`);
    svg.style.display = 'block';

    // Build SVG content
    let content = '';

    // Outer circle
    content += `<circle cx="${c}" cy="${cy}" r="${outerR}" fill="none" stroke="${COLORS.gray300}" stroke-width="1.5"/>`;

    // Inner circle
    content += `<circle cx="${c}" cy="${cy}" r="${innerR}" fill="none" stroke="${COLORS.gray200}" stroke-width="0.8"/>`;

    // Tick marks
    for (let i = 0; i < 360; i += 5) {
        const rad = ((i - 90) * Math.PI) / 180;
        const major = i % 30 === 0;
        const mid = i % 10 === 0 && !major;
        const r1 = major ? innerR + 2 : mid ? outerR - 9 : outerR - 6;
        const r2 = outerR - 2;
        const strokeColor = major ? COLORS.gray700 : COLORS.gray400;
        const strokeWidth = major ? 2 : 0.8;

        content += `<line
            x1="${c + r1 * Math.cos(rad)}" y1="${cy + r1 * Math.sin(rad)}"
            x2="${c + r2 * Math.cos(rad)}" y2="${cy + r2 * Math.sin(rad)}"
            stroke="${strokeColor}" stroke-width="${strokeWidth}"/>`;
    }

    // Declination indicator (when active)
    if (showDecl) {
        // Dashed line from center to magnetic north position
        content += `<line x1="${c}" y1="${cy}"
            x2="${c + (outerR + 8) * Math.cos(declRad)}"
            y2="${cy + (outerR + 8) * Math.sin(declRad)}"
            stroke="${COLORS.amber500}" stroke-width="2.5" stroke-dasharray="5 4"/>`;

        // Arc between NV and NM
        const sr = outerR + 6;
        const startDeg = -90;
        const endDeg = declDeg - 90;
        const minDeg = Math.min(startDeg, endDeg);
        const maxDeg = Math.max(startDeg, endDeg);
        const sPoint = polar(c, cy, sr, minDeg);
        const ePoint = polar(c, cy, sr, maxDeg);
        const sweep = Math.abs(declDeg) > 180 ? '1' : '0';

        content += `<path d="M ${sPoint.x} ${sPoint.y} A ${sr} ${sr} 0 ${sweep} 1 ${ePoint.x} ${ePoint.y}"
            fill="none" stroke="${COLORS.amber500}" stroke-width="2.5" stroke-dasharray="4 4"/>`;

        // NM label at magnetic north - positioned outside compass
        const nmLabelR = outerR + 18;
        content += `<text
            x="${c + nmLabelR * Math.cos(declRad)}"
            y="${cy + nmLabelR * Math.sin(declRad)}"
            text-anchor="middle" dominant-baseline="central"
            fill="${COLORS.amber600}" font-size="13" font-weight="700"
            font-family="'SF Mono', 'Cascadia Code', 'Consolas', monospace">NM</text>`;

        // NV label at true north (top) - positioned outside compass in extra top space
        content += `<text x="${c}" y="${12}"
            text-anchor="middle" dominant-baseline="central"
            fill="${COLORS.blue500}" font-size="13" font-weight="700"
            font-family="'SF Mono', 'Cascadia Code', 'Consolas', monospace">NV</text>`;

        // Declination value label at bottom
        const declText = declination > 0 ? `+${declination.toFixed(1)}` : declination.toFixed(1);
        content += `<text x="${c}" y="${totalHeight - 8}"
            text-anchor="middle" fill="${COLORS.amber600}"
            font-size="13" font-weight="700"
            font-family="'SF Mono', 'Cascadia Code', 'Consolas', monospace">Decl: ${declText}°</text>`;
    }

    // Cardinal labels - INCREASED SIZE
    const cardinals = [
        { l: 'N', deg: 0, color: COLORS.red600, bold: true },
        { l: 'E', deg: 90, color: COLORS.gray700, bold: false },
        { l: 'S', deg: 180, color: COLORS.gray700, bold: false },
        { l: 'O', deg: 270, color: COLORS.gray700, bold: false }
    ];

    for (const { l, deg, color, bold } of cardinals) {
        const rad = ((deg - 90) * Math.PI) / 180;
        content += `<text x="${c + labelR * Math.cos(rad)}" y="${cy + labelR * Math.sin(rad)}"
            text-anchor="middle" dominant-baseline="central"
            fill="${color}" font-size="15" font-weight="${bold ? '800' : '600'}"
            font-family="'SF Mono', 'Cascadia Code', 'Consolas', monospace">${l}</text>`;
    }

    // Sweep fill arc (from 0 to current azimuth)
    if (azimuthDeg > 0) {
        const sweepR = innerR - 16;
        const startAng = -90;
        const endAng = azimuthDeg - 90;
        const start = polar(c, cy, sweepR, endAng);
        const end = polar(c, cy, sweepR, startAng);
        const large = azimuthDeg > 180 ? '1' : '0';

        content += `<path d="M ${c} ${cy} L ${start.x} ${start.y} A ${sweepR} ${sweepR} 0 ${large} 0 ${end.x} ${end.y} Z"
            fill="rgba(22,163,74,0.1)" stroke="none"/>`;
    }

    // Needle
    content += `<line x1="${c}" y1="${cy}"
        x2="${c + needleR * Math.cos(azRad)}" y2="${cy + needleR * Math.sin(azRad)}"
        stroke="${COLORS.primary600}" stroke-width="3" stroke-linecap="round"/>`;

    // Needle tip circle
    content += `<circle cx="${c + needleR * Math.cos(azRad)}" cy="${cy + needleR * Math.sin(azRad)}"
        r="4.5" fill="${COLORS.primary600}"/>`;

    // Center dot
    content += `<circle cx="${c}" cy="${cy}" r="4" fill="${COLORS.gray700}"/>`;

    // Value readout box - positioned relative to compass center
    const boxY = cy + outerR - 14;
    content += `<rect x="${c - 34}" y="${boxY}" width="68" height="20" rx="5"
        fill="${COLORS.primary50}" stroke="${COLORS.primary600}" stroke-width="1"/>`;

    content += `<text x="${c}" y="${boxY + 12}" text-anchor="middle" fill="${COLORS.primary700}"
        font-size="13" font-weight="700"
        font-family="'SF Mono', 'Cascadia Code', 'Consolas', monospace">${azimuthDeg.toFixed(1)}°</text>`;

    svg.innerHTML = content;
    return svg;
}

/**
 * Update compass rose with new azimuth.
 *
 * @param {SVGElement} svg - Existing SVG element
 * @param {Object} options - Update options
 */
export function updateCompassRose(svg, options) {
    // For simplicity, recreate the SVG content
    const parent = svg.parentElement;
    if (parent) {
        const newSvg = createCompassRose(options);
        parent.replaceChild(newSvg, svg);
        return newSvg;
    }
    return svg;
}

/**
 * Helper function to calculate polar coordinates.
 *
 * @param {number} cx - Center X
 * @param {number} cy - Center Y
 * @param {number} r - Radius
 * @param {number} deg - Angle in degrees
 * @returns {{x: number, y: number}} Cartesian coordinates
 */
function polar(cx, cy, r, deg) {
    const rad = (deg * Math.PI) / 180;
    return {
        x: cx + r * Math.cos(rad),
        y: cy + r * Math.sin(rad)
    };
}

/**
 * Create compass rose container with wrapper.
 *
 * @param {Object} options - Options
 * @returns {{container: HTMLElement, svg: SVGElement, update: Function}}
 */
export function createCompassRoseComponent(options) {
    const container = document.createElement('div');
    container.className = 'azimuth-distance-compass-container';
    container.style.cssText = `
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 14px;
        background: ${COLORS.white};
        border-radius: 12px;
        border: 1px solid ${COLORS.gray200};
        box-shadow: 0 1px 2px rgba(0,0,0,0.05);
    `;

    let currentSvg = createCompassRose(options);
    container.appendChild(currentSvg);

    return {
        container,
        svg: currentSvg,
        update: (newOptions) => {
            const newSvg = createCompassRose(newOptions);
            container.replaceChild(newSvg, currentSvg);
            currentSvg = newSvg;
            return newSvg;
        }
    };
}

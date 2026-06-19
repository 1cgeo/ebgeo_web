// Path: js/military_tools/declination_tool/declination_svg_generator.js

/**
 * @fileoverview Generates SVG diagrams of the three norths:
 * True North (NV), Grid North (NQ) and Magnetic North (NM).
 * Reference north (vertical) is NV, matching the Web Mercator map vertical
 * at the diagram location. Shows magnetic declination (NV→NM) and meridian
 * convergence (NV→NQ).
 */

import { formatSignedDegrees } from '@utils/angle-format.js';

const SVG_WIDTH = 400;
const SVG_HEIGHT = 500;

/** Origin point (base of the arrows) */
const ORIGIN_X = SVG_WIDTH / 2;
const ORIGIN_Y = 380;

/** Arrow length in pixels */
const ARROW_LENGTH = 300;

/** Diagram colors (military standard blue/cyan) */
const LINE_COLOR = '#0077CC';
const TEXT_COLOR = '#0077CC';
const ARC_COLOR = '#0077CC';

/** Arrow head size */
const ARROW_HEAD_SIZE = 12;

/** Base line half-width */
const BASE_LINE_HALF = 80;

/** Arc radii (px): convergence inner, declination outer (avoid overlap). */
const ARC_RADIUS_CONV = 48;
const ARC_RADIUS_DECL = 80;

/**
 * Below this convergence magnitude (deg) the NV and NQ arrows are nearly
 * collinear, so their tip labels would overlap — nudge them apart horizontally.
 */
const LABEL_SEPARATION_DEG = 8;
/** Horizontal nudge (px) applied to each of NV/NQ when they are too close. */
const LABEL_NUDGE = 18;

/**
 * Generates an SVG string for the three-norths declination diagram.
 *
 * @param {number} declinationDeg - Magnetic declination (+East, −West), NV→NM
 * @param {number} [convergenceDeg=0] - Meridian convergence (+East, −West), NV→NQ
 * @returns {string} SVG markup string
 */
export function generateDeclinationSvg(declinationDeg, convergenceDeg = 0) {
    const nv = endpointFor(0);
    const nq = endpointFor(convergenceDeg);
    const nm = endpointFor(declinationDeg);

    // When convergence is small, NV (vertical) and NQ nearly coincide; push their
    // labels to opposite sides (NV away from the side NQ leans) so they stay legible.
    let nvDx = 0;
    let nqDx = 0;
    if (Math.abs(convergenceDeg) < LABEL_SEPARATION_DEG) {
        const nqLeansEast = convergenceDeg >= 0;
        nvDx = nqLeansEast ? -LABEL_NUDGE : LABEL_NUDGE;
        nqDx = nqLeansEast ? LABEL_NUDGE : -LABEL_NUDGE;
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_WIDTH}" height="${SVG_HEIGHT}" viewBox="0 0 ${SVG_WIDTH} ${SVG_HEIGHT}">
  <defs>
    <marker id="arrowHead" markerWidth="${ARROW_HEAD_SIZE}" markerHeight="${ARROW_HEAD_SIZE}" refX="${ARROW_HEAD_SIZE / 2}" refY="${ARROW_HEAD_SIZE / 2}" orient="auto-start-reverse">
      <polygon points="0,0 ${ARROW_HEAD_SIZE},${ARROW_HEAD_SIZE / 2} 0,${ARROW_HEAD_SIZE}" fill="${LINE_COLOR}"/>
    </marker>
  </defs>
  ${buildBaseLines()}
  ${buildArrow(nv.x, nv.y)}
  ${buildArrow(nq.x, nq.y)}
  ${buildArrow(nm.x, nm.y)}
  ${buildAngleArc(convergenceDeg, ARC_RADIUS_CONV)}
  ${buildAngleArc(declinationDeg, ARC_RADIUS_DECL)}
  ${buildTipLabel(nv, 'NV', nvDx)}
  ${buildTipLabel(nq, 'NQ', nqDx)}
  ${buildTipLabel(nm, 'NM')}
  ${buildLegend(declinationDeg, convergenceDeg)}
</svg>`;
}

/**
 * Computes an arrow tip endpoint for an angle measured clockwise from vertical (NV).
 * @param {number} angleDeg - Angle in degrees (clockwise positive = East)
 * @returns {{ x: number, y: number, sinA: number, cosA: number }}
 */
function endpointFor(angleDeg) {
    const a = (angleDeg * Math.PI) / 180;
    const sinA = Math.sin(a);
    const cosA = Math.cos(a);
    return {
        x: ORIGIN_X + sinA * ARROW_LENGTH,
        y: ORIGIN_Y - cosA * ARROW_LENGTH,
        sinA,
        cosA,
    };
}

/**
 * Builds the dashed horizontal reference line at the origin.
 * @returns {string} SVG line
 */
function buildBaseLines() {
    const y = ORIGIN_Y;
    return `<line x1="${ORIGIN_X - BASE_LINE_HALF}" y1="${y}" x2="${ORIGIN_X + BASE_LINE_HALF}" y2="${y}" stroke="${LINE_COLOR}" stroke-width="1.5" stroke-dasharray="6,3"/>`;
}

/**
 * Builds an arrow line from the origin to a tip, with arrowhead marker.
 * @param {number} x2 - Tip X
 * @param {number} y2 - Tip Y
 * @returns {string} SVG line with marker
 */
function buildArrow(x2, y2) {
    return `<line x1="${ORIGIN_X}" y1="${ORIGIN_Y}" x2="${x2}" y2="${y2}" stroke="${LINE_COLOR}" stroke-width="2" marker-end="url(#arrowHead)"/>`;
}

/**
 * Builds a small arc from vertical (NV) to the given angle.
 * @param {number} angleDeg - Angle in degrees (clockwise positive = East)
 * @param {number} arcRadius - Arc radius in pixels
 * @returns {string} SVG arc path (empty when angle is negligible)
 */
function buildAngleArc(angleDeg, arcRadius) {
    if (Math.abs(angleDeg) < 0.1) return '';

    const startRad = -Math.PI / 2; // vertical up
    const endRad = startRad + (angleDeg * Math.PI) / 180;

    const sx = ORIGIN_X + Math.cos(startRad) * arcRadius;
    const sy = ORIGIN_Y + Math.sin(startRad) * arcRadius;
    const ex = ORIGIN_X + Math.cos(endRad) * arcRadius;
    const ey = ORIGIN_Y + Math.sin(endRad) * arcRadius;

    const largeArc = Math.abs(angleDeg) > 180 ? 1 : 0;
    const sweep = angleDeg > 0 ? 1 : 0;

    return `<path d="M ${sx} ${sy} A ${arcRadius} ${arcRadius} 0 ${largeArc} ${sweep} ${ex} ${ey}" fill="none" stroke="${ARC_COLOR}" stroke-width="1.5"/>`;
}

/**
 * Builds a two-letter label just beyond an arrow tip, offset radially outward.
 * @param {{ x: number, y: number, sinA: number, cosA: number }} tip - Arrow tip endpoint
 * @param {string} text - Label text (e.g., 'NV')
 * @param {number} [dx=0] - Horizontal nudge (px) to separate near-collinear labels
 * @returns {string} SVG text element
 */
function buildTipLabel(tip, text, dx = 0) {
    const off = 22;
    const x = tip.x + tip.sinA * off + dx;
    const y = tip.y - tip.cosA * off + 8;
    return `<text x="${x}" y="${y}" font-family="Arial, sans-serif" font-size="22" font-weight="bold" fill="${TEXT_COLOR}" text-anchor="middle">${text}</text>`;
}

/**
 * Builds an always-legible textual legend at the top of the diagram.
 * @param {number} declinationDeg - Magnetic declination
 * @param {number} convergenceDeg - Meridian convergence
 * @returns {string} SVG text elements
 */
function buildLegend(declinationDeg, convergenceDeg) {
    const fontSize = 20;
    const x = 20;
    // Convergence sits above declination, and both lines are kept high enough
    // to clear the arrow-tip labels (NV/NQ/NM) that land just below (~y=66).
    return `
  <text x="${x}" y="22" font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="bold" fill="${TEXT_COLOR}">Conv. (NV-NQ): ${formatSignedDegrees(convergenceDeg)}</text>
  <text x="${x}" y="46" font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="bold" fill="${TEXT_COLOR}">Decl. (NV-NM): ${formatSignedDegrees(declinationDeg)}</text>`;
}

// Path: js/military_tools/declination_tool/declination_svg_generator.js

/**
 * @fileoverview Generates SVG diagrams for magnetic declination (G-M angle).
 * Shows Grid North (NQ) and Magnetic North (NM) with the correct angle.
 */

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

/**
 * Generates an SVG string for a magnetic declination diagram.
 *
 * @param {number} declinationDeg - Declination in degrees (positive=East, negative=West)
 * @returns {string} SVG markup string
 */
export function generateDeclinationSvg(declinationDeg) {
    const absAngle = Math.abs(declinationDeg);
    const isEast = declinationDeg >= 0;
    const direction = isEast ? 'E' : 'W';

    // Grid North (NQ) is always vertical (straight up)
    const nqEndX = ORIGIN_X;
    const nqEndY = ORIGIN_Y - ARROW_LENGTH;

    // Magnetic North (NM) is rotated by declination from vertical
    // East declination = clockwise rotation (positive angle from NQ)
    // West declination = counter-clockwise rotation (negative angle from NQ)
    const angleRad = (declinationDeg * Math.PI) / 180;
    const nmEndX = ORIGIN_X + Math.sin(angleRad) * ARROW_LENGTH;
    const nmEndY = ORIGIN_Y - Math.cos(angleRad) * ARROW_LENGTH;

    // Build SVG parts
    const baseLines = buildBaseLines();
    const nqArrow = buildArrow(ORIGIN_X, ORIGIN_Y, nqEndX, nqEndY, 'nq');
    const nmArrow = buildArrow(ORIGIN_X, ORIGIN_Y, nmEndX, nmEndY, 'nm');
    const arc = buildAngleArc(declinationDeg);
    const labels = buildLabels(nqEndX, nqEndY, nmEndX, nmEndY, absAngle, direction, declinationDeg);

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_WIDTH}" height="${SVG_HEIGHT}" viewBox="0 0 ${SVG_WIDTH} ${SVG_HEIGHT}">
  <defs>
    <marker id="arrowHead-nq" markerWidth="${ARROW_HEAD_SIZE}" markerHeight="${ARROW_HEAD_SIZE}" refX="${ARROW_HEAD_SIZE / 2}" refY="${ARROW_HEAD_SIZE / 2}" orient="auto-start-reverse">
      <polygon points="0,0 ${ARROW_HEAD_SIZE},${ARROW_HEAD_SIZE / 2} 0,${ARROW_HEAD_SIZE}" fill="${LINE_COLOR}"/>
    </marker>
    <marker id="arrowHead-nm" markerWidth="${ARROW_HEAD_SIZE}" markerHeight="${ARROW_HEAD_SIZE}" refX="${ARROW_HEAD_SIZE / 2}" refY="${ARROW_HEAD_SIZE / 2}" orient="auto-start-reverse">
      <polygon points="0,0 ${ARROW_HEAD_SIZE},${ARROW_HEAD_SIZE / 2} 0,${ARROW_HEAD_SIZE}" fill="${LINE_COLOR}"/>
    </marker>
  </defs>
  ${baseLines}
  ${nqArrow}
  ${nmArrow}
  ${arc}
  ${labels}
</svg>`;
}

/**
 * Builds horizontal reference lines at the origin.
 * @returns {string} SVG lines
 */
function buildBaseLines() {
    const y = ORIGIN_Y;
    const leftX = ORIGIN_X - BASE_LINE_HALF;
    const rightX = ORIGIN_X + BASE_LINE_HALF;

    return `<line x1="${leftX}" y1="${y}" x2="${rightX}" y2="${y}" stroke="${LINE_COLOR}" stroke-width="1.5" stroke-dasharray="6,3"/>`;
}

/**
 * Builds an arrow line with arrowhead marker.
 * @param {number} x1 - Start X
 * @param {number} y1 - Start Y
 * @param {number} x2 - End X
 * @param {number} y2 - End Y
 * @param {string} id - Arrow identifier for marker reference
 * @returns {string} SVG line with marker
 */
function buildArrow(x1, y1, x2, y2, id) {
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${LINE_COLOR}" stroke-width="2" marker-end="url(#arrowHead-${id})"/>`;
}

/**
 * Builds an arc between Grid North and Magnetic North.
 * @param {number} declinationDeg - Declination angle in degrees
 * @returns {string} SVG arc path
 */
function buildAngleArc(declinationDeg) {
    if (Math.abs(declinationDeg) < 0.1) return '';

    const arcRadius = 70;
    const startAngleRad = -Math.PI / 2; // vertical up
    const endAngleRad = startAngleRad + (declinationDeg * Math.PI) / 180;

    const startX = ORIGIN_X + Math.cos(startAngleRad) * arcRadius;
    const startY = ORIGIN_Y + Math.sin(startAngleRad) * arcRadius;
    const endX = ORIGIN_X + Math.cos(endAngleRad) * arcRadius;
    const endY = ORIGIN_Y + Math.sin(endAngleRad) * arcRadius;

    const largeArc = Math.abs(declinationDeg) > 180 ? 1 : 0;
    const sweep = declinationDeg > 0 ? 1 : 0;

    return `<path d="M ${startX} ${startY} A ${arcRadius} ${arcRadius} 0 ${largeArc} ${sweep} ${endX} ${endY}" fill="none" stroke="${ARC_COLOR}" stroke-width="1.5"/>`;
}

/**
 * Builds text labels for the diagram (NQ, NM, and angle value).
 * @param {number} nqX - Grid North arrow end X
 * @param {number} nqY - Grid North arrow end Y
 * @param {number} nmX - Magnetic North arrow end X
 * @param {number} nmY - Magnetic North arrow end Y
 * @param {number} absAngle - Absolute declination angle
 * @param {string} direction - 'E' or 'W'
 * @param {number} declinationDeg - Raw declination value
 * @returns {string} SVG text elements
 */
function buildLabels(nqX, nqY, nmX, nmY, absAngle, direction, declinationDeg) {
    const fontSize = 24;
    const labelOffset = 20;

    // NQ label (opposite side of NM arrow)
    const nqSide = declinationDeg >= 0 ? -1 : 1;
    const nqLabelX = nqX + nqSide * labelOffset;
    const nqLabelY = nqY + 30;
    const nqAnchor = declinationDeg >= 0 ? 'end' : 'start';

    // NM label (to the side of the Magnetic North arrow tip)
    const nmSide = declinationDeg >= 0 ? 1 : -1;
    const nmLabelX = nmX + nmSide * labelOffset;
    const nmLabelY = nmY + 30;
    const nmAnchor = declinationDeg >= 0 ? 'start' : 'end';

    let labels = '';

    // NQ short label
    labels += `<text x="${nqLabelX}" y="${nqLabelY}" font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="bold" fill="${TEXT_COLOR}" text-anchor="${nqAnchor}">NQ</text>`;

    // NM short label
    labels += `<text x="${nmLabelX}" y="${nmLabelY}" font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="bold" fill="${TEXT_COLOR}" text-anchor="${nmAnchor}">NM</text>`;

    // Angle value placed outside the arc, away from the arrows
    // Positive (East) declination → label to the LEFT (outside the arc)
    // Negative (West) declination → label to the RIGHT (outside the arc)
    if (Math.abs(declinationDeg) >= 0.1) {
        const angleText = absAngle.toFixed(1).replace('.', ',') + '° ' + direction;
        const arcRadius = 70;
        // Position at the arc height, pushed well to the outside
        const angleLabelY = ORIGIN_Y - arcRadius + 10;
        const sideOffset = 10;
        let angleLabelX;
        let anchor;

        if (declinationDeg >= 0) {
            // East: NM is to the right, label goes LEFT
            angleLabelX = ORIGIN_X - sideOffset;
            anchor = 'end';
        } else {
            // West: NM is to the left, label goes RIGHT
            angleLabelX = ORIGIN_X + sideOffset;
            anchor = 'start';
        }

        labels += `<text x="${angleLabelX}" y="${angleLabelY}" font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="bold" fill="${TEXT_COLOR}" text-anchor="${anchor}" dominant-baseline="middle">${angleText}</text>`;
    }

    return labels;
}

// Path: js/3d_models_viewer_tool/services/viewshed-geometry.js

/**
 * @module 3d_models_viewer_tool/services/viewshed-geometry
 * @description The pure arithmetic behind the 3D viewshed: how a sector wider than one instance
 * can render is split, how much each piece is narrowed at the seam, the field of view of the
 * observer camera, and the wireframe of the drawn sector.
 *
 * ZERO IMPORTS, BY CONTRACT, and that is what this file is for. The two callers
 * (`viewshed-3d.js` and `tools/viewshed_tool_3d.js`) both pull in Cesium, the store or both, so
 * neither can be loaded by a node test; the numbers that decide the DRAWING were therefore
 * unmeasurable except through a browser and a screenshot. Here they are functions over numbers.
 *
 * THE ONE THING THAT IS NOT OBVIOUS FROM THE CODE: the seam narrowing and the shader's comparison
 * operator are a PAIR. The fragment shader refuses a pixel whose angle is STRICTLY greater than
 * half the opening, so a pixel exactly on the boundary between two neighbouring sub-viewsheds
 * passes both and gets mixed twice, which reads as a saturated band. `subViewshedLayout` narrows
 * each piece so the band becomes an imperceptible gap instead. Whoever changes the shader to `>=`
 * has to change `SEAM_NARROWING_DEGREES` to zero in the same commit, or the gap becomes visible.
 */

/** Widest horizontal opening a single viewshed instance renders acceptably, in degrees. */
export const MAX_SINGLE_VIEWSHED_ANGLE = 150;

/**
 * How much each sub-viewshed is narrowed, in degrees, when a sector is split.
 *
 * It is a TOTAL, not a half: the piece renders this much less than its share of the sector, so the
 * gap at each seam is this wide. Read the module header for why it exists at all.
 */
export const SEAM_NARROWING_DEGREES = 1.5;

/** Widest field of view a perspective frustum takes before it degenerates, in degrees. */
export const MAX_FRUSTUM_FOV_DEGREES = 170;

/** Fallbacks when an opening arrives absent, zero or not a number. */
const FALLBACK = Object.freeze({ horizontalAngle: 120, verticalAngle: 90 });

/**
 * A positive, finite opening, or the declared fallback.
 * @param {number} valor
 * @param {number} padrao
 * @returns {number}
 */
function aberturaValida(valor, padrao) {
    return Number.isFinite(valor) && valor > 0 ? valor : padrao;
}

/**
 * How the requested horizontal sector is covered by one, two or three instances.
 *
 * @param {number} horizontalAngle - Total horizontal opening in degrees.
 * @returns {{ count: number, subAngle: number, renderAngle: number, offsets: number[] }}
 *   `count` instances, each covering `subAngle` degrees of the sector but RENDERING
 *   `renderAngle` (narrowed at the seams when split), rotated by `offsets` degrees of heading
 *   from the sector's centre direction.
 */
export function subViewshedLayout(horizontalAngle) {
    const total = aberturaValida(horizontalAngle, FALLBACK.horizontalAngle);

    let count = 3;
    if (total <= MAX_SINGLE_VIEWSHED_ANGLE) count = 1;
    else if (total <= MAX_SINGLE_VIEWSHED_ANGLE * 2) count = 2;

    const subAngle = total / count;

    // ONE PIECE IS NEVER NARROWED, and that is the whole asymmetry: with no neighbour there is no
    // seam, so narrowing it would just shrink the answer the person asked for.
    const renderAngle = count > 1 ? subAngle - SEAM_NARROWING_DEGREES : subAngle;

    // Symmetric tiling around the centre direction. Note that the three-piece case uses the FULL
    // sub-angle as the step, not half of it, which is what puts the middle piece on the centre.
    let offsets;
    if (count === 1) offsets = [0];
    else if (count === 2) offsets = [-subAngle / 2, subAngle / 2];
    else offsets = [-subAngle, 0, subAngle];

    return { count, subAngle, renderAngle, offsets };
}

/**
 * Field of view, in degrees, of the camera that renders the observer's depth map.
 *
 * It is the WIDER of the two openings, because one perspective frustum has to contain both, and it
 * is clamped because a perspective frustum degenerates as it approaches 180 degrees.
 * @param {number} horizontalAngle - Horizontal opening in degrees.
 * @param {number} verticalAngle - Vertical opening in degrees.
 * @returns {number} Field of view in degrees.
 */
export function observerFovDegrees(horizontalAngle, verticalAngle) {
    const horizontal = aberturaValida(horizontalAngle, FALLBACK.horizontalAngle);
    const vertical = aberturaValida(verticalAngle, FALLBACK.verticalAngle);
    return Math.min(Math.max(horizontal, vertical), MAX_FRUSTUM_FOV_DEGREES);
}

/** Subdivisions per axis in the drawn frustum outline. */
export const OUTLINE_SLICES = 8;

/**
 * The (azimuth, elevation) pairs, in degrees, of the polylines that draw the sector's wireframe.
 *
 * Each entry is one polyline. `apex: true` means the line starts at the observer and ends at its
 * single point; the others run along the far surface.
 * @param {number} horizontalAngle - Horizontal opening in degrees.
 * @param {number} verticalAngle - Vertical opening in degrees.
 * @param {number} [slices] - Subdivisions per axis.
 * @returns {Array<{ apex: boolean, points: Array<{ azimuth: number, elevation: number }> }>}
 */
export function frustumOutlineAngles(horizontalAngle, verticalAngle, slices = OUTLINE_SLICES) {
    const halfH = Math.abs(aberturaValida(horizontalAngle, FALLBACK.horizontalAngle)) / 2;
    const halfV = Math.abs(aberturaValida(verticalAngle, FALLBACK.verticalAngle)) / 2;
    const steps = Math.max(1, Math.floor(Number.isFinite(slices) ? slices : OUTLINE_SLICES));
    const lines = [];

    const azimuthAt = (i) => -halfH + (2 * halfH * i) / steps;
    const elevationAt = (j) => -halfV + (2 * halfV * j) / steps;

    // Meridians: azimuth fixed, elevation sweeping.
    for (let i = 0; i <= steps; i++) {
        const azimuth = azimuthAt(i);
        const points = [];
        for (let j = 0; j <= steps; j++) points.push({ azimuth, elevation: elevationAt(j) });
        lines.push({ apex: false, points });
    }

    // Parallels: elevation fixed, azimuth sweeping.
    for (let j = 0; j <= steps; j++) {
        const elevation = elevationAt(j);
        const points = [];
        for (let i = 0; i <= steps; i++) points.push({ azimuth: azimuthAt(i), elevation });
        lines.push({ apex: false, points });
    }

    // Four edges from the apex to the corners, which is what reads as "a cone from the observer".
    for (const azimuth of [-halfH, halfH]) {
        for (const elevation of [-halfV, halfV]) {
            lines.push({ apex: true, points: [{ azimuth, elevation }] });
        }
    }

    return lines;
}

/**
 * Unit direction for one (azimuth, elevation) pair in the observer's local frame.
 *
 * Plain triples in, plain triple out, so it is testable without Cesium. The parameterization is
 * the one the shader's horizontal test implies: azimuth is measured around `up`, in the plane
 * perpendicular to it, from `forward` towards `right`.
 * @param {{x: number, y: number, z: number}} forward - Unit forward axis.
 * @param {{x: number, y: number, z: number}} right - Unit right axis.
 * @param {{x: number, y: number, z: number}} up - Unit up axis.
 * @param {number} azimuthDegrees - Angle around `up`, positive towards `right`.
 * @param {number} elevationDegrees - Angle around `right`, positive towards `up`.
 * @returns {{x: number, y: number, z: number}} Unit direction.
 */
export function directionFromAngles(forward, right, up, azimuthDegrees, elevationDegrees) {
    const az = (azimuthDegrees * Math.PI) / 180;
    const el = (elevationDegrees * Math.PI) / 180;
    const cosEl = Math.cos(el);
    const sinEl = Math.sin(el);
    const cosAz = Math.cos(az);
    const sinAz = Math.sin(az);
    return {
        x: cosEl * (cosAz * forward.x + sinAz * right.x) + sinEl * up.x,
        y: cosEl * (cosAz * forward.y + sinAz * right.y) + sinEl * up.y,
        z: cosEl * (cosAz * forward.z + sinAz * right.z) + sinEl * up.z,
    };
}

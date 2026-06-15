// Path: js/temporal/temporal-model.js

/**
 * @fileoverview Pure temporal model: visibility windows and trajectory
 * interpolation. No DOM, no MapLibre, no store — safe to unit-test directly.
 *
 * Conventions:
 * - All timestamps are absolute epoch milliseconds (numbers).
 * - A feature with no temporal data is PERMANENT (visible at any cursor).
 * - A trajectory keypoint is `{ t: epochMs, lng: number, lat: number }`.
 */

/**
 * Decides whether a feature is visible at the given timeline cursor.
 * Permanent (no `temporalInicio`/`temporalFim`) features are always visible.
 * A non-finite cursor (temporal off / unknown) is treated as "show everything".
 *
 * @param {Object} props - Feature properties (may carry temporalInicio/temporalFim).
 * @param {number} cursor - Current timeline cursor (epoch ms).
 * @returns {boolean} True when the feature should be shown at `cursor`.
 */
export function isTemporallyVisible(props, cursor) {
    if (!props) return true;
    if (!Number.isFinite(cursor)) return true;

    const inicio = props.temporalInicio;
    const fim = props.temporalFim;

    if (Number.isFinite(inicio) && cursor < inicio) return false;
    if (Number.isFinite(fim) && cursor > fim) return false;
    return true;
}

/**
 * Returns a defensive, validated, chronologically-sorted copy of a trajectory.
 * Invalid keypoints (missing/NaN fields) are dropped.
 *
 * @param {Array<{t:number, lng:number, lat:number}>} trajetoria
 * @returns {Array<{t:number, lng:number, lat:number}>}
 */
export function normalizeTrajectory(trajetoria) {
    if (!Array.isArray(trajetoria)) return [];
    return trajetoria
        .filter(
            (kp) =>
                kp &&
                Number.isFinite(kp.t) &&
                Number.isFinite(kp.lng) &&
                Number.isFinite(kp.lat)
        )
        .slice()
        .sort((a, b) => a.t - b.t);
}

/**
 * Linearly interpolates a position along a trajectory at the cursor time.
 * Clamps to the first/last keypoint outside the trajectory's time span.
 *
 * @param {Array<{t:number, lng:number, lat:number}>} trajetoria
 * @param {number} cursor - Timeline cursor (epoch ms).
 * @returns {[number, number]|null} `[lng, lat]`, or null when there are no valid keypoints.
 */
export function interpolatePosition(trajetoria, cursor) {
    const pts = normalizeTrajectory(trajetoria);
    if (pts.length === 0) return null;
    if (pts.length === 1) return [pts[0].lng, pts[0].lat];

    const first = pts[0];
    const last = pts[pts.length - 1];

    if (!Number.isFinite(cursor) || cursor <= first.t) return [first.lng, first.lat];
    if (cursor >= last.t) return [last.lng, last.lat];

    for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        if (cursor >= a.t && cursor <= b.t) {
            const span = b.t - a.t;
            const frac = span === 0 ? 0 : (cursor - a.t) / span;
            return [a.lng + (b.lng - a.lng) * frac, a.lat + (b.lat - a.lat) * frac];
        }
    }
    // Unreachable for sorted input, but stay defensive.
    return [last.lng, last.lat];
}

/**
 * Decides where a trajectory-capable feature should be drawn and whether the
 * renderer should keep its stashed "home" (authoring) position. Pure helper so
 * the renderer's home/interpolation bookkeeping is unit-testable.
 *
 * - usable trajectory (≥2 kp) and a finite cursor → interpolated position, keep home;
 * - trajectory cleared/reduced, or cursor null (temporal off) → snap to home, drop it;
 * - nothing to draw → target null.
 *
 * @param {Array<{t:number, lng:number, lat:number}>} trajetoria
 * @param {[number, number]|null|undefined} home - Stashed home coords (or null/absent).
 * @param {number|null} cursor - Timeline cursor (epoch ms), or null when temporal is off.
 * @returns {{target: ([number, number]|null), keepHome: boolean}}
 */
export function resolveTrajectoryTarget(trajetoria, home, cursor) {
    const usable = normalizeTrajectory(trajetoria).length >= 2;
    const hasHome = Array.isArray(home);

    if (!usable && !hasHome) return { target: null, keepHome: false };
    if (!usable || cursor === null) return { target: hasHome ? home : null, keepHome: false };

    const interpolated = interpolatePosition(trajetoria, cursor);
    return { target: interpolated || (hasHome ? home : null), keepHome: true };
}

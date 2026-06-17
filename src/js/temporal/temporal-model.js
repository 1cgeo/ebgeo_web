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
 * Merges a list of feature property bags into the UNION of their temporal
 * validity windows: `[min(temporalInicio), max(temporalFim)]`. A missing bound
 * means "unbounded" on that side, so if any input is unbounded the union is
 * unbounded there and that key is omitted (the result stays permanent on that
 * side). Used to give a processing output (e.g. a convex hull of N features, or a
 * 1:1 buffer of one feature) a sensible validity instead of silently permanent.
 *
 * @param {Array<Object>} propsList - Feature property objects (temporalInicio/Fim).
 * @returns {{temporalInicio?: number, temporalFim?: number}} Only the finite bounds.
 */
export function mergeTemporalWindows(propsList) {
    let minInicio = Infinity;
    let maxFim = -Infinity;
    let inicioUnbounded = false;
    let fimUnbounded = false;

    for (const p of propsList || []) {
        const i = p?.temporalInicio;
        const f = p?.temporalFim;
        if (Number.isFinite(i)) minInicio = Math.min(minInicio, i);
        else inicioUnbounded = true;
        if (Number.isFinite(f)) maxFim = Math.max(maxFim, f);
        else fimUnbounded = true;
    }

    const out = {};
    if (!inicioUnbounded && minInicio !== Infinity) out.temporalInicio = minInicio;
    if (!fimUnbounded && maxFim !== -Infinity) out.temporalFim = maxFim;
    return out;
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

/** Great-circle distance in metres between two `{lng, lat}` points (haversine). */
function haversineMeters(a, b) {
    const R = 6371000;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Summary statistics for a trajectory, for the feature panel: keypoint count,
 * total wall-clock duration (last − first time), and total path length in metres
 * (sum of great-circle segments). Pure.
 *
 * @param {Array<{t:number, lng:number, lat:number}>} keypoints
 * @returns {{count: number, durationMs: number, distanceMeters: number}}
 */
export function trajectoryStats(keypoints) {
    const pts = normalizeTrajectory(keypoints);
    const count = pts.length;
    if (count < 2) return { count, durationMs: 0, distanceMeters: 0 };

    let distanceMeters = 0;
    for (let i = 0; i < count - 1; i++) {
        distanceMeters += haversineMeters(pts[i], pts[i + 1]);
    }
    return { count, durationMs: pts[count - 1].t - pts[0].t, distanceMeters };
}

/** Bearing (azimuth degrees, 0–360) from keypoint a to b ({lng,lat}). */
function segmentBearing(a, b) {
    const toRad = (d) => (d * Math.PI) / 180;
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const dLng = toRad(b.lng - a.lng);
    const y = Math.sin(dLng) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
    return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Index of the segment [i, i+1] whose span brackets the cursor (sorted pts), or -1. */
function segmentIndexAt(pts, cursor) {
    if (pts.length < 2) return -1;
    if (!Number.isFinite(cursor) || cursor <= pts[0].t) return 0;
    if (cursor >= pts[pts.length - 1].t) return pts.length - 2;
    let lo = 0;
    let hi = pts.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (pts[mid].t <= cursor) lo = mid;
        else hi = mid - 1;
    }
    return Math.min(lo, pts.length - 2);
}

/**
 * Heading (azimuth 0–360) of travel along the trajectory at the cursor: the
 * bearing of the segment the cursor falls in (clamped to the first/last segment
 * outside the span). Null when there are fewer than 2 valid keypoints. Used to
 * auto-drive a moving symbol's direction-of-movement modifier.
 *
 * @param {Array<{t:number, lng:number, lat:number}>} trajetoria
 * @param {number} cursor - Timeline cursor (epoch ms).
 * @returns {number|null} Azimuth in degrees [0, 360), or null.
 */
export function headingAt(trajetoria, cursor) {
    const pts = normalizeTrajectory(trajetoria);
    const i = segmentIndexAt(pts, cursor);
    if (i < 0) return null;
    return segmentBearing(pts[i], pts[i + 1]);
}

/**
 * Speed (metres per second) along the trajectory at the cursor: the bracketing
 * segment's length / its duration. 0 for a zero-duration segment; null when there
 * are fewer than 2 valid keypoints.
 *
 * @param {Array<{t:number, lng:number, lat:number}>} trajetoria
 * @param {number} cursor - Timeline cursor (epoch ms).
 * @returns {number|null} Speed in m/s, or null.
 */
export function speedAt(trajetoria, cursor) {
    const pts = normalizeTrajectory(trajetoria);
    const i = segmentIndexAt(pts, cursor);
    if (i < 0) return null;
    const dtSec = (pts[i + 1].t - pts[i].t) / 1000;
    if (!(dtSec > 0)) return 0;
    return haversineMeters(pts[i], pts[i + 1]) / dtSec;
}

/**
 * Average speed (m/s) over the whole trajectory (total distance / total duration).
 * 0 when the trajectory has no duration or fewer than 2 keypoints.
 *
 * @param {Array<{t:number, lng:number, lat:number}>} trajetoria
 * @returns {number} Speed in m/s.
 */
export function averageSpeed(trajetoria) {
    const s = trajectoryStats(trajetoria);
    if (!(s.durationMs > 0)) return 0;
    return s.distanceMeters / (s.durationMs / 1000);
}

/**
 * Thins a trajectory so consecutive keypoints are at least `resolutionMs` apart in
 * time, always keeping the first and last keypoint. Used on import to drop
 * sub-resolution detail (e.g. 1 Hz GPS fixes) the timeline can never distinguish —
 * the finest timeline unit is one minute — without capping the keypoint count.
 * Lossy but shape-preserving at the resolution. Input is normalized (sorted,
 * validated) first.
 *
 * @param {Array<{t:number, lng:number, lat:number}>} trajetoria
 * @param {number} resolutionMs - Minimum time gap between kept keypoints (ms).
 * @returns {Array<{t:number, lng:number, lat:number}>} Thinned, normalized trajectory.
 */
export function decimateTrajectory(trajetoria, resolutionMs) {
    const pts = normalizeTrajectory(trajetoria);
    if (pts.length <= 2 || !(resolutionMs > 0)) return pts;

    const out = [pts[0]];
    let lastKeptT = pts[0].t;
    for (let i = 1; i < pts.length - 1; i++) {
        if (pts[i].t - lastKeptT >= resolutionMs) {
            out.push(pts[i]);
            lastKeptT = pts[i].t;
        }
    }
    out.push(pts[pts.length - 1]); // always keep the last keypoint (exact end time)
    return out;
}

/**
 * Linearly interpolates a position along an ALREADY-NORMALIZED trajectory. Kept
 * internal so the per-frame render path can normalize once and reuse it (the
 * public interpolatePosition / resolveTrajectoryTarget normalize then delegate).
 * Binary-searches the containing segment so it scales to long (e.g. GPX) tracks.
 *
 * @param {Array<{t:number, lng:number, lat:number}>} pts - Normalized keypoints.
 * @param {number} cursor - Timeline cursor (epoch ms).
 * @returns {[number, number]|null} `[lng, lat]`, or null when there are no keypoints.
 */
function interpolateNormalized(pts, cursor) {
    if (pts.length === 0) return null;
    if (pts.length === 1) return [pts[0].lng, pts[0].lat];

    const first = pts[0];
    const last = pts[pts.length - 1];

    if (!Number.isFinite(cursor) || cursor <= first.t) return [first.lng, first.lat];
    if (cursor >= last.t) return [last.lng, last.lat];

    // Largest index whose time is <= cursor; cursor is strictly inside the span,
    // so this lands on a real segment [lo, lo + 1].
    let lo = 0;
    let hi = pts.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (pts[mid].t <= cursor) lo = mid;
        else hi = mid - 1;
    }
    const a = pts[lo];
    const b = pts[lo + 1];
    const span = b.t - a.t;
    const frac = span === 0 ? 0 : (cursor - a.t) / span;
    return [a.lng + (b.lng - a.lng) * frac, a.lat + (b.lat - a.lat) * frac];
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
    return interpolateNormalized(normalizeTrajectory(trajetoria), cursor);
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
    return resolveTrajectoryTargetNormalized(normalizeTrajectory(trajetoria), home, cursor);
}

/**
 * Like resolveTrajectoryTarget but takes an ALREADY-NORMALIZED trajectory, so the
 * per-frame render path can normalize once and skip the redundant re-sorts (it
 * previously normalized three times per feature per frame).
 *
 * @param {Array<{t:number, lng:number, lat:number}>} pts - Normalized keypoints.
 * @param {[number, number]|null|undefined} home - Stashed home coords (or null/absent).
 * @param {number|null} cursor - Timeline cursor (epoch ms), or null when temporal is off.
 * @returns {{target: ([number, number]|null), keepHome: boolean}}
 */
export function resolveTrajectoryTargetNormalized(pts, home, cursor) {
    const usable = pts.length >= 2;
    const hasHome = Array.isArray(home);

    if (!usable && !hasHome) return { target: null, keepHome: false };
    if (!usable || cursor === null) return { target: hasHome ? home : null, keepHome: false };

    const interpolated = interpolateNormalized(pts, cursor);
    return { target: interpolated || (hasHome ? home : null), keepHome: true };
}

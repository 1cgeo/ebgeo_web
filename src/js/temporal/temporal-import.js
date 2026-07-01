// Path: js/temporal/temporal-import.js

/**
 * @fileoverview Pure helpers for reading temporal data during import.
 *  - extractTemporalProperties: normalizes assorted temporal attribute names
 *    (GeoJSON/CSV/KML) into { temporalInicio, temporalFim } (epoch ms);
 *  - buildTrajectoryFromGpxFeature: turns a GPX/KML timed track (coordinates +
 *    per-point times) into a trajectory keypoint array;
 *  - sanitizeImportedTrajectory: cleans a trajectory carried in on a GeoJSON/.ebgeo
 *    import (coerce times, drop invalid, decimate).
 */

import { toEpoch } from './temporal.utils.js';
import { decimateTrajectory } from './temporal-model.js';
import { TEMPORAL_UNITS, TEMPORAL_UNIT_KEYS } from './temporal.constants.js';

/**
 * Finest timeline unit (currently 1 minute). Trackpoints recorded more often than
 * this carry detail the cursor can never resolve, so imported trajectories are
 * decimated down to this resolution (one keypoint per minute, no count cap).
 */
const TRAJECTORY_TIME_RESOLUTION_MS = TEMPORAL_UNITS[TEMPORAL_UNIT_KEYS[0]].ms;

const START_KEYS = new Set([
    'temporalinicio', 'temporal_inicio', 'begin', 'start', 'starttime', 'start_time',
    'startdate', 'start_date', 'datainicio', 'data_inicio', 'inicio',
]);
const END_KEYS = new Set([
    'temporalfim', 'temporal_fim', 'end', 'endtime', 'end_time',
    'enddate', 'end_date', 'datafim', 'data_fim', 'fim',
]);
// A single instant (e.g. KML <TimeStamp><when>): the feature appears from then on.
const INSTANT_KEYS = new Set(['when', 'timestamp', 'time', 'date', 'datetime']);

/**
 * Extracts temporal validity from a feature's raw properties, recognising the
 * accepted attribute names (case-insensitive). Returns only the fields found.
 *
 * @param {Object} props - Raw imported properties.
 * @returns {{temporalInicio?: number, temporalFim?: number}}
 */
export function extractTemporalProperties(props) {
    const out = {};
    if (!props || typeof props !== 'object') return out;

    for (const [rawKey, rawVal] of Object.entries(props)) {
        const key = String(rawKey).toLowerCase();
        if (START_KEYS.has(key)) {
            const ms = toEpoch(rawVal);
            if (ms !== null && out.temporalInicio === undefined) out.temporalInicio = ms;
        } else if (END_KEYS.has(key)) {
            const ms = toEpoch(rawVal);
            if (ms !== null && out.temporalFim === undefined) out.temporalFim = ms;
        } else if (INSTANT_KEYS.has(key)) {
            const ms = toEpoch(rawVal);
            if (ms !== null && out.temporalInicio === undefined) out.temporalInicio = ms;
        }
    }
    return out;
}

/**
 * Reads the per-vertex time array that @tmcw/togeojson attaches to GPX tracks.
 * @param {Object} feature - GeoJSON feature from togeojson.gpx().
 * @returns {Array<string|number>} Times aligned with the geometry coordinates.
 */
export function extractGpxTimes(feature) {
    const props = feature?.properties || {};
    return (
        props.coordinateProperties?.times ||
        props.coordTimes ||
        props.times ||
        []
    );
}

/**
 * Builds a trajectory keypoint array from a GPX track feature (LineString /
 * MultiPoint) whose vertices have aligned timestamps.
 *
 * @param {Object} feature - GeoJSON feature from togeojson.gpx().
 * @returns {Array<{t:number, lng:number, lat:number}>} Normalized trajectory.
 */
export function buildTrajectoryFromGpxFeature(feature) {
    const geom = feature?.geometry;
    if (!geom) return [];

    let coords = [];
    if (geom.type === 'LineString' || geom.type === 'MultiPoint') {
        coords = geom.coordinates || [];
    } else if (geom.type === 'MultiLineString') {
        coords = (geom.coordinates || []).flat();
    } else {
        return [];
    }

    const times = extractGpxTimes(feature);
    const flatTimes = Array.isArray(times[0]) ? times.flat() : times;

    const traj = [];
    for (let i = 0; i < coords.length; i++) {
        const c = coords[i];
        const t = toEpoch(flatTimes[i]);
        if (Number.isFinite(t) && Array.isArray(c) && c.length >= 2) {
            traj.push({ t, lng: c[0], lat: c[1] });
        }
    }
    // Decimate to the finest timeline unit (1 min): sub-minute GPS fixes can't be
    // distinguished by the cursor and only bloat the trajectory + per-frame cost.
    return decimateTrajectory(traj, TRAJECTORY_TIME_RESOLUTION_MS);
}

/**
 * Sanitizes a trajectory carried in on a GeoJSON/.ebgeo-style import: coerces each
 * keypoint's `t` via toEpoch (tolerates ISO strings / Date / number), drops invalid
 * keypoints, and decimates to the finest timeline unit — the same treatment a GPX
 * track gets — so a foreign or hand-authored `trajetoria` can't bloat or break the
 * render path. Idempotent on an already-clean numeric trajectory.
 * @param {Array} trajetoria - Raw imported trajectory keypoints.
 * @returns {Array<{t:number, lng:number, lat:number}>} Clean, decimated trajectory.
 */
export function sanitizeImportedTrajectory(trajetoria) {
    if (!Array.isArray(trajetoria)) return [];
    const coerced = trajetoria.map((kp) => ({
        t: toEpoch(kp?.t),
        lng: Number(kp?.lng),
        lat: Number(kp?.lat),
    }));
    return decimateTrajectory(coerced, TRAJECTORY_TIME_RESOLUTION_MS);
}

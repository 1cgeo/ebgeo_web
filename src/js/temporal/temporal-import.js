// Path: js/temporal/temporal-import.js

/**
 * @fileoverview Pure helpers for reading temporal data during import.
 *  - extractTemporalProperties: normalizes assorted temporal attribute names
 *    (GeoJSON/CSV/KML) into { temporalInicio, temporalFim } (epoch ms);
 *  - buildTrajectoryFromGpxFeature: turns a GPX track (coordinates + per-point
 *    times) into a trajectory keypoint array.
 */

import { toEpoch } from './temporal.utils.js';
import { normalizeTrajectory } from './temporal-model.js';

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
    return normalizeTrajectory(traj);
}

// Path: js/temporal/temporal-import.js

/**
 * @fileoverview Pure helpers for reading temporal data during import.
 *  - extractTemporalProperties: normalizes assorted temporal attribute names
 *    (GeoJSON/CSV/KML) into { temporalInicio, temporalFim } (epoch ms), by a
 *    DECLARED precedence between competing names, dropping the end of an
 *    inverted window and tallying both degradations into an optional report;
 *  - buildTrajectoryFromGpxFeature: turns a GPX/KML timed track (coordinates +
 *    per-point times) into a trajectory keypoint array;
 *  - sanitizeImportedTrajectory: cleans a trajectory carried in on a GeoJSON/.ebgeo
 *    import (coerce times, drop invalid, decimate);
 *  - describeTemporalIssues: the pt-BR sentences for that report, in ONE copy,
 *    shared by the CSV panel and the generic importer.
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

/**
 * ATTRIBUTE NAMES THAT CARRY A TIME, IN DECLARED ORDER OF PRECEDENCE — and the
 * order IS the contract, not a coincidence of how the arrays were typed.
 *
 * A file may spell the same instant twice (`when` next to `begin`, `inicio` next
 * to `start`). Until 2026-09-21 the reader walked `Object.entries(props)` and
 * kept the FIRST name it recognised, so which one won was the insertion order of
 * a foreign JSON object: the same two columns in a different order produced a
 * different window, and nothing said so. Now every candidate is scored by its
 * position in these lists and the best-placed one that actually parses wins,
 * whatever order the properties arrive in.
 *
 * The ranking, in words: EBGeo's own canonical names first (they were written by
 * this product and mean exactly what they say), then the pt-BR names a Brazilian
 * CSV uses, then the foreign interval names, and last the single-instant names —
 * an instant only ever fills the START, and only when no start name did.
 *
 * Lowercase, because every lookup lowercases the key first.
 * @constant {string[]}
 */
export const START_KEY_ORDER = [
    'temporalinicio', 'temporal_inicio',
    'datainicio', 'data_inicio', 'inicio',
    'begin', 'start', 'starttime', 'start_time', 'startdate', 'start_date',
];
/** End-of-window attribute names, same precedence rule as {@link START_KEY_ORDER}. */
export const END_KEY_ORDER = [
    'temporalfim', 'temporal_fim',
    'datafim', 'data_fim', 'fim',
    'end', 'endtime', 'end_time', 'enddate', 'end_date',
];
/**
 * A single instant (e.g. KML `<TimeStamp><when>`): the feature appears from then
 * on. Used for the START only, and only when no {@link START_KEY_ORDER} name
 * produced a value.
 * @constant {string[]}
 */
export const INSTANT_KEY_ORDER = ['when', 'timestamp', 'datetime', 'date', 'time'];

const START_KEYS = new Set(START_KEY_ORDER);
const END_KEYS = new Set(END_KEY_ORDER);
const INSTANT_KEYS = new Set(INSTANT_KEY_ORDER);

/**
 * Every attribute name this module consumes into the validity window, lowercase.
 * Exported so the import path that decides what becomes a USER attribute derives
 * its reserved list from here instead of keeping a hand-copied excerpt: the copy
 * in `user_data/user_data_manager.js` knew 8 of these 26, so the other 18 became
 * the window AND stayed on the feature as a duplicate user attribute.
 * @constant {Set<string>}
 */
export const TEMPORAL_SOURCE_KEYS = new Set([
    ...START_KEY_ORDER, ...END_KEY_ORDER, ...INSTANT_KEY_ORDER,
]);

/** Picks the best-ranked candidate; `rank` is the index in the ordered list. */
function betterCandidate(current, rank, ms) {
    if (ms === null) return current;
    if (current && current.rank <= rank) return current;
    return { rank, ms };
}

/**
 * Extracts temporal validity from a feature's raw properties, recognising the
 * accepted attribute names (case-insensitive) by declared precedence. Returns
 * only the fields found.
 *
 * AN INVERTED WINDOW LOSES ITS END, and the choice is deliberate. A row whose
 * end precedes its start is a data error, and with it no cursor ever satisfies
 * the visibility predicate: the feature vanishes for good from the 3D, the 360
 * and the PDF legend while still being drawn on the map. Swapping the two would
 * invent an interval the file never stated and hand it back looking
 * authoritative; dropping the end keeps the one field that can be defended and
 * leaves the feature visible from a stated instant, which is the same shape a
 * KML `<TimeStamp>` already produces. The caller is told, through `report`, so
 * the importer can COUNT the rows it degraded instead of degrading them mutely.
 *
 * @param {Object} props - Raw imported properties.
 * @param {{invertidas?: number, naoLidas?: number}} [report] - Optional tally,
 *   incremented in place: `invertidas` counts windows whose end was dropped,
 *   `naoLidas` counts recognised names whose value no reader could parse.
 * @returns {{temporalInicio?: number, temporalFim?: number}}
 */
export function extractTemporalProperties(props, report = null) {
    const out = {};
    if (!props || typeof props !== 'object') return out;

    let start = null;
    let end = null;
    let instant = null;
    let unreadable = 0;

    for (const [rawKey, rawVal] of Object.entries(props)) {
        const key = String(rawKey).toLowerCase();
        const isStart = START_KEYS.has(key);
        const isEnd = !isStart && END_KEYS.has(key);
        const isInstant = !isStart && !isEnd && INSTANT_KEYS.has(key);
        if (!isStart && !isEnd && !isInstant) continue;

        const ms = toEpoch(rawVal);
        if (ms === null) {
            // An empty cell is an absent value, not an unreadable one.
            if (rawVal !== null && rawVal !== undefined && String(rawVal).trim() !== '') unreadable++;
            continue;
        }
        if (isStart) start = betterCandidate(start, START_KEY_ORDER.indexOf(key), ms);
        else if (isEnd) end = betterCandidate(end, END_KEY_ORDER.indexOf(key), ms);
        else instant = betterCandidate(instant, INSTANT_KEY_ORDER.indexOf(key), ms);
    }

    const inicio = start ? start.ms : (instant ? instant.ms : null);
    if (inicio !== null) out.temporalInicio = inicio;
    if (end !== null) out.temporalFim = end.ms;

    if (out.temporalInicio !== undefined && out.temporalFim !== undefined
        && out.temporalFim < out.temporalInicio) {
        delete out.temporalFim;
        if (report) report.invertidas = (report.invertidas || 0) + 1;
    }
    if (unreadable > 0 && report) report.naoLidas = (report.naoLidas || 0) + unreadable;

    return out;
}

/**
 * Turns a temporal import report into the pt-BR sentences the UI shows.
 *
 * IT LIVES HERE, beside the counting, and there is exactly ONE copy. It was born
 * in `import_export/csv/csv-to-geojson.js` when only the CSV panel counted, and
 * moved the moment the generic importer needed the same words: two copies would
 * have let the same degradation be named differently depending on which door the
 * file came through, and the CSV panel is one tab away from the generic one.
 * The generic importer must not depend on the CSV module to say them, either.
 *
 * Pure, and it takes the SAME report object `extractTemporalProperties` fills, so
 * there is no translation step in the middle where a count could be renamed.
 * @param {{invertidas?: number, naoLidas?: number}} [report] - Tally of degradations.
 * @returns {string[]} One sentence per degradation that happened (empty when none did).
 */
export function describeTemporalIssues(report = {}) {
    const messages = [];
    const naoLidas = Number(report?.naoLidas) || 0;
    const invertidas = Number(report?.invertidas) || 0;

    if (naoLidas > 0) {
        messages.push(naoLidas === 1
            ? '1 célula de data não reconhecida: o texto foi mantido como atributo'
            : `${naoLidas} células de data não reconhecidas: o texto foi mantido como atributo`);
    }
    if (invertidas > 0) {
        messages.push(invertidas === 1
            ? '1 linha com fim anterior ao início: o fim foi descartado'
            : `${invertidas} linhas com fim anterior ao início: o fim foi descartado`);
    }
    return messages;
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
 * Reads a coordinate WITHOUT inventing one. `Number()` is not a reader: it turns
 * `null`, `''`, `[]` and `false` into 0, and 0 is a perfectly finite latitude and
 * longitude — the Gulf of Guinea — so a keypoint with no coordinate passed every
 * downstream check and the moving feature crossed the Atlantic during playback.
 * The same class was already closed on the EXPORT side (`roundCoordinates` in
 * `import_export/export-import.service.js`, the comment marked INVENTADA).
 * @param {*} v - Raw coordinate from an imported keypoint.
 * @returns {number|null} The finite number, or null when there is nothing to read.
 */
function readCoordinate(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v !== 'string') return null;
    const s = v.trim();
    if (s === '') return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
}

/**
 * Sanitizes a trajectory carried in on a GeoJSON/.ebgeo-style import: reads each
 * keypoint's `t` via toEpoch and its coordinates via {@link readCoordinate},
 * DROPS any keypoint that is missing one of the three, and decimates to the
 * finest timeline unit — the same treatment a GPX track gets — so a foreign or
 * hand-authored `trajetoria` can't bloat or break the render path. Idempotent on
 * an already-clean numeric trajectory.
 * @param {Array} trajetoria - Raw imported trajectory keypoints.
 * @returns {Array<{t:number, lng:number, lat:number}>} Clean, decimated trajectory.
 */
export function sanitizeImportedTrajectory(trajetoria) {
    if (!Array.isArray(trajetoria)) return [];
    const coerced = [];
    for (const kp of trajetoria) {
        const t = toEpoch(kp?.t);
        const lng = readCoordinate(kp?.lng);
        const lat = readCoordinate(kp?.lat);
        if (t === null || lng === null || lat === null) continue;
        coerced.push({ t, lng, lat });
    }
    return decimateTrajectory(coerced, TRAJECTORY_TIME_RESOLUTION_MS);
}

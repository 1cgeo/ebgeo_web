// Path: js/temporal/temporal.utils.js

/**
 * @fileoverview Pure helpers for the Temporal Module: unit math, cursor
 * snapping/clamping, scrubber ticks, datetime-local conversion, explicit
 * timestamp reading (for imports) and pt-BR formatting. No DOM/store deps.
 *
 * TIMESTAMP READING IS EXPLICIT, NEVER `Date.parse`. Until 2026-09-21 `toEpoch`
 * ended in `Date.parse(str)`, and the engine's fallback is American and UTC:
 * `05/11/2024` came back as 11 May, `25/12/2024` came back as null, and the
 * date-only `2024-01-01` came in as midnight UTC while every formatter here and
 * the panel's `<input type="datetime-local">` are LOCAL, so it was displayed as
 * 31/12/2023. In one CSV column the rows with a day up to 12 entered with day
 * and month swapped and the rest entered with no time at all, silently. The
 * reader below accepts a declared list of shapes and returns null for anything
 * else: a null is a refusal the importer can count, a guess is not.
 */

import {
    TEMPORAL_UNITS,
    TEMPORAL_UNIT_LETTERS,
    TEMPORAL_MODES,
    DEFAULT_TEMPORAL_UNIT,
    MAX_TIMELINE_TICKS,
} from './temporal.constants.js';

/**
 * Length of a division unit in milliseconds.
 * @param {string} unidade - One of MINUTO | HORA | DIA | SEMANA.
 * @returns {number} Milliseconds per unit (falls back to the default unit).
 */
export function unitToMs(unidade) {
    return (TEMPORAL_UNITS[unidade] || TEMPORAL_UNITS[DEFAULT_TEMPORAL_UNIT]).ms;
}

/**
 * Snaps a cursor down to the start of its step cell, measured from `origin`.
 * Used to drive the show/hide layer filters at the timeline's unit granularity:
 * within a step cell the snapped value is constant, so the filters rebuild only
 * when the cursor crosses into the next cell (instead of every animation frame).
 * Trajectory interpolation keeps using the raw cursor, so movement stays smooth.
 *
 * Falls back to the raw cursor when the step is non-positive or the cursor is
 * non-finite, so callers can pass it unconditionally.
 * @param {number} cursor - Cursor (epoch ms).
 * @param {number} step - Step length (ms); a non-positive step disables snapping.
 * @param {number} [origin=0] - Grid origin the cells are measured from (e.g. timeline start).
 * @returns {number} Cursor snapped to the cell start, or the raw cursor.
 */
export function quantizeCursor(cursor, step, origin = 0) {
    if (!Number.isFinite(cursor) || !(step > 0)) return cursor;
    const base = Number.isFinite(origin) ? origin : 0;
    return base + Math.floor((cursor - base) / step) * step;
}

/**
 * Clamps a cursor to the [inicio, fim] timeline bounds (each optional).
 * @param {number} cursor - Cursor to clamp (epoch ms).
 * @param {number|null} inicio - Lower bound or null.
 * @param {number|null} fim - Upper bound or null.
 * @returns {number} Clamped cursor.
 */
export function clampCursor(cursor, inicio, fim) {
    let c = cursor;
    if (Number.isFinite(inicio) && c < inicio) c = inicio;
    if (Number.isFinite(fim) && c > fim) c = fim;
    return c;
}

/**
 * Builds evenly-spaced tick timestamps across [inicio, fim], capped in density.
 * @param {number} inicio - Range start (epoch ms).
 * @param {number} fim - Range end (epoch ms).
 * @param {string} unidade - Division unit.
 * @param {number} [maxTicks=MAX_TIMELINE_TICKS] - Density cap.
 * @returns {number[]} Tick timestamps (empty for invalid ranges).
 */
export function buildTicks(inicio, fim, unidade, maxTicks = MAX_TIMELINE_TICKS) {
    if (!Number.isFinite(inicio) || !Number.isFinite(fim) || fim <= inicio) return [];
    const step = unitToMs(unidade);
    if (step <= 0) return [];

    const count = Math.floor((fim - inicio) / step);
    const stride = Math.max(1, Math.ceil((count + 1) / Math.max(1, maxTicks)));
    const ticks = [];
    for (let i = 0; i <= count; i += stride) {
        ticks.push(inicio + i * step);
    }
    return ticks;
}

/**
 * Fraction (0..1) of `cursor` along the [inicio, fim] range.
 * @param {number} cursor - Cursor (epoch ms).
 * @param {number} inicio - Range start.
 * @param {number} fim - Range end.
 * @returns {number} Clamped fraction in [0, 1]; 0 for a degenerate range.
 */
export function cursorToFraction(cursor, inicio, fim) {
    if (!Number.isFinite(cursor) || !Number.isFinite(inicio) || !Number.isFinite(fim) || fim <= inicio) {
        return 0;
    }
    const f = (cursor - inicio) / (fim - inicio);
    return f < 0 ? 0 : f > 1 ? 1 : f;
}

/**
 * Maps a fraction (0..1) back to a timestamp in [inicio, fim].
 * @param {number} fraction - Position fraction.
 * @param {number} inicio - Range start.
 * @param {number} fim - Range end.
 * @returns {number} Timestamp (epoch ms).
 */
export function fractionToCursor(fraction, inicio, fim) {
    if (!Number.isFinite(inicio) || !Number.isFinite(fim)) return inicio;
    const f = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
    return inicio + (fim - inicio) * f;
}

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * Zero-pads a calendar year to the 4 digits `<input type="datetime-local">`
 * requires. `String(year)` alone emitted `999-01-15T00:00`, which the control
 * rejects as malformed and renders as an empty field, so a feature dated before
 * the year 1000 could be read but never edited.
 */
const pad4Year = (n) => (n < 0 ? `-${String(-n).padStart(4, '0')}` : String(n).padStart(4, '0'));

/**
 * Converts an epoch timestamp to a `YYYY-MM-DDTHH:mm` string for
 * `<input type="datetime-local">` (interpreted in the browser's local zone).
 * @param {number} epoch - Timestamp (epoch ms).
 * @returns {string} datetime-local value, or '' when non-finite.
 */
export function epochToDatetimeLocal(epoch) {
    if (!Number.isFinite(epoch)) return '';
    const d = new Date(epoch);
    return `${pad4Year(d.getFullYear())}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * Parses a `datetime-local` input value into an epoch timestamp. The control's
 * value carries NO zone and means local wall time, so it is read with the local
 * reader rather than handed to `new Date()`, whose zone rules differ by shape.
 * @param {string} value - datetime-local string.
 * @returns {number|null} Epoch ms, or null when empty/invalid.
 */
export function datetimeLocalToEpoch(value) {
    if (!value) return null;
    const m = RE_ISO_LOCAL.exec(String(value).trim());
    if (!m) return null;
    return localFieldsToEpoch(+m[1], +m[2], +m[3], +m[4], +m[5], m[6] ? +m[6] : 0, m[7] ? +m[7].padEnd(3, '0') : 0);
}

// ===== Timestamp reading (imports) =====

/**
 * Plausibility band for an imported instant (epoch ms), inclusive: 1900-01-01Z
 * to 2200-01-01Z. Anything outside is REFUSED (null) instead of entering the
 * map, because the timeline's automatic window is the exact extent of the
 * features: one instant in the year 10800 stretches the ruler by millennia and
 * collapses every real feature into a single pixel.
 *
 * The year 10800 is not hypothetical: it is what `Date.parse` returned for
 * `010800MAR24`, the military GDH that `formatDTG` in this very file WRITES
 * into symbol amplifiers.
 *
 * WHAT THE BAND DOES NOT CATCH, declared so nobody reads the guard as wider
 * than it is: an epoch expressed in SECONDS (1726876800) read as milliseconds
 * lands on 1970-01-20, which is INSIDE the band. Catching it would take either
 * the seconds-vs-milliseconds guess this module refuses to make (it silently
 * corrupts every genuine pre-2001 millisecond stamp) or a floor above 1970,
 * which would refuse both legitimate mid-century dates and the 1970-anchored
 * relative times that trajectory fixtures and decimation use. A wrong instant
 * from a guess is worse than a wrong instant from the data.
 */
export const EPOCH_PLAUSIBLE_MIN = Date.UTC(1900, 0, 1);
/** Upper end of the plausibility band; see {@link EPOCH_PLAUSIBLE_MIN}. */
export const EPOCH_PLAUSIBLE_MAX = Date.UTC(2200, 0, 1);

/** Returns the instant when it is finite and inside the plausibility band, else null. */
function inBand(ms) {
    if (ms === null || !Number.isFinite(ms)) return null;
    return ms >= EPOCH_PLAUSIBLE_MIN && ms <= EPOCH_PLAUSIBLE_MAX ? ms : null;
}

/** pt-BR 3-letter uppercase month abbreviations, shared by `formatDTG` and the GDH reader. */
const DTG_MONTHS_PT = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];

/** Bare integer → canonical epoch MILLISECONDS (no unit guessing). */
const RE_BARE_INT = /^[+-]?\d+$/;
/** dd/mm/aaaa or dd-mm-aaaa, optional hh:mm[:ss]. Day FIRST: the audience is Brazilian. */
const RE_BR_DATE = /^(\d{1,2})([/-])(\d{1,2})\2(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;
/** aaaa-mm-dd (or aaaa/mm/dd) with no time: unambiguous because the year leads. */
const RE_ISO_DATE = /^(\d{4})([/-])(\d{1,2})\2(\d{1,2})$/;
/** ISO date-time with NO zone → local wall time. */
const RE_ISO_LOCAL = /^(\d{4})-(\d{1,2})-(\d{1,2})[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3})\d*)?)?$/;
/** ISO date-time WITH a zone (Z or ±hh[:]mm) → that zone is honoured. */
const RE_ISO_ZONED = /^(\d{4})-(\d{1,2})-(\d{1,2})[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3})\d*)?)?(Z|z|[+-]\d{2}:?\d{2})$/;
/** Military GDH as `formatDTG` writes it: DDHHMM<MON><YY>, Zulu by definition. */
const RE_DTG = /^(\d{2})(\d{2})(\d{2})([A-Za-z]{3})(\d{2})$/;

/**
 * Two-digit year → full year, POSIX pivot: 00-69 is the 2000s, 70-99 the 1900s.
 * Only the GDH carries a two-digit year; every other shape here demands four.
 */
function expandTwoDigitYear(yy) {
    return yy <= 69 ? 2000 + yy : 1900 + yy;
}

/** True when the clock fields are in range (leap seconds are not a thing here). */
function clockFieldsOk(h, mi, s) {
    return h >= 0 && h <= 23 && mi >= 0 && mi <= 59 && s >= 0 && s <= 59;
}

/**
 * Builds an epoch from LOCAL calendar fields, refusing impossible dates (31/02)
 * and out-of-range clock fields.
 *
 * The year is set through `setFullYear`, never through the `new Date(y, ...)`
 * constructor, whose two-digit-year rule would turn the year 24 into 1924.
 * The base instant is midday so that validating the DATE cannot be disturbed by
 * a daylight-saving jump at midnight; the clock is applied afterwards, which is
 * exactly what `<input type="datetime-local">` does with the same wall time.
 * @returns {number|null} Epoch ms, or null when the fields are not a real instant.
 */
function localFieldsToEpoch(y, mo, d, h = 0, mi = 0, s = 0, ms = 0) {
    if (!(mo >= 1 && mo <= 12) || !(d >= 1 && d <= 31) || !clockFieldsOk(h, mi, s)) return null;
    const dt = new Date(2000, 0, 1, 12, 0, 0, 0);
    dt.setFullYear(y, mo - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
    dt.setHours(h, mi, s, ms);
    const t = dt.getTime();
    return Number.isFinite(t) ? t : null;
}

/**
 * Builds an epoch from UTC calendar fields, refusing impossible dates the same
 * way `localFieldsToEpoch` does (`Date.UTC` silently rolls 31/02 into March).
 * @returns {number|null} Epoch ms, or null.
 */
function utcFieldsToEpoch(y, mo, d, h = 0, mi = 0, s = 0, ms = 0) {
    if (!(mo >= 1 && mo <= 12) || !(d >= 1 && d <= 31) || !clockFieldsOk(h, mi, s)) return null;
    const t = Date.UTC(y, mo - 1, d, h, mi, s, ms);
    if (!Number.isFinite(t)) return null;
    const dt = new Date(t);
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
    return t;
}

/** Minutes east of UTC for an ISO zone designator (`Z`, `+hh:mm`, `-hhmm`). */
function zoneOffsetMinutes(designator) {
    if (designator === 'Z' || designator === 'z') return 0;
    const sign = designator[0] === '-' ? -1 : 1;
    const digits = designator.slice(1).replace(':', '');
    return sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4)));
}

/**
 * Reads an imported timestamp into epoch milliseconds. EXPLICIT shapes only —
 * whatever does not match one of them returns null rather than a guess from the
 * engine's date parser (see the fileoverview for what that cost).
 *
 * Accepted:
 *  - a finite number, or a bare integer string → canonical epoch MILLISECONDS,
 *    with no seconds/ms rescaling (that heuristic corrupts every pre-2001 ms
 *    stamp and every historical/negative date, so EBGeo's own exports round-trip);
 *  - a `Date` instance;
 *  - `dd/mm/aaaa` and `dd-mm-aaaa`, with optional `hh:mm[:ss]` → LOCAL. Day
 *    before month: the audience is Brazilian, and the separator must be the same
 *    on both sides;
 *  - `aaaa-mm-dd` / `aaaa/mm/dd` with no time → LOCAL midnight, not UTC midnight,
 *    so it is displayed on the day that was written;
 *  - ISO date-time with no zone → LOCAL wall time;
 *  - ISO date-time with a zone (`Z` or `±hh:mm`) → that zone is honoured;
 *  - the military GDH `DDHHMM<MON><YY>` that `formatDTG` writes (Zulu), which is
 *    the only shape the product itself PRODUCES into a feature property, and
 *    which the old reader turned into the year 10800.
 *
 * Every result is checked against the plausibility band (see
 * {@link EPOCH_PLAUSIBLE_MIN}); outside it, the answer is null.
 * @param {(number|string|Date|null|undefined)} value
 * @returns {number|null} Epoch ms, or null when the value is not one of the shapes above.
 */
export function toEpoch(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number') return inBand(value);
    if (value instanceof Date) return inBand(value.getTime());
    if (typeof value === 'boolean') return null;

    const str = String(value).trim();
    if (str === '') return null;

    if (RE_BARE_INT.test(str)) return inBand(Number(str));

    let m = RE_BR_DATE.exec(str);
    if (m) {
        return inBand(localFieldsToEpoch(+m[4], +m[3], +m[1], m[5] ? +m[5] : 0, m[6] ? +m[6] : 0, m[7] ? +m[7] : 0));
    }

    m = RE_ISO_DATE.exec(str);
    if (m) return inBand(localFieldsToEpoch(+m[1], +m[3], +m[4]));

    m = RE_ISO_ZONED.exec(str);
    if (m) {
        const base = utcFieldsToEpoch(
            +m[1], +m[2], +m[3], +m[4], +m[5],
            m[6] ? +m[6] : 0,
            m[7] ? +m[7].padEnd(3, '0') : 0
        );
        if (base === null) return null;
        return inBand(base - zoneOffsetMinutes(m[8]) * 60_000);
    }

    m = RE_ISO_LOCAL.exec(str);
    if (m) {
        return inBand(localFieldsToEpoch(
            +m[1], +m[2], +m[3], +m[4], +m[5],
            m[6] ? +m[6] : 0,
            m[7] ? +m[7].padEnd(3, '0') : 0
        ));
    }

    m = RE_DTG.exec(str);
    if (m) {
        const mon = DTG_MONTHS_PT.indexOf(m[4].toUpperCase());
        if (mon === -1) return null;
        return inBand(utcFieldsToEpoch(expandTwoDigitYear(+m[5]), mon + 1, +m[1], +m[2], +m[3]));
    }

    return null;
}

/**
 * Formats an instant for display, with granularity matching the unit.
 * @param {number} epoch - Timestamp (epoch ms).
 * @param {string} [unidade=DEFAULT_TEMPORAL_UNIT] - Division unit.
 * @returns {string} pt-BR formatted string (em-dash for non-finite).
 */
export function formatInstant(epoch, unidade = DEFAULT_TEMPORAL_UNIT) {
    if (!Number.isFinite(epoch)) return '—';
    const d = new Date(epoch);
    const date = `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
    const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    return unidade === 'DIA' || unidade === 'SEMANA' ? date : `${date} ${time}`;
}

// ===== Relative-time (military D+N) display & conversion =====

/**
 * Letter prefix for a unit in relative mode (D/H/S/M). Falls back to the default unit.
 * @param {string} unidade - Division unit.
 * @returns {string}
 */
export function unitLetter(unidade) {
    return TEMPORAL_UNIT_LETTERS[unidade] || TEMPORAL_UNIT_LETTERS[DEFAULT_TEMPORAL_UNIT];
}

/**
 * Converts an epoch to a unit offset from an origin (`(epoch - origem) / unitMs`).
 * @param {number} epoch - Timestamp (epoch ms).
 * @param {number} origem - Origin/anchor (epoch ms).
 * @param {string} unidade - Division unit.
 * @returns {number|null} Offset in units, or null when either input is non-finite.
 */
export function epochToOffset(epoch, origem, unidade) {
    if (!Number.isFinite(epoch) || !Number.isFinite(origem)) return null;
    return (epoch - origem) / unitToMs(unidade);
}

/**
 * Converts a unit offset back to an epoch (`origem + n * unitMs`).
 * @param {number} n - Offset in units.
 * @param {number} origem - Origin/anchor (epoch ms).
 * @param {string} unidade - Division unit.
 * @returns {number|null} Epoch ms, or null when either input is non-finite.
 */
export function offsetToEpoch(n, origem, unidade) {
    if (!Number.isFinite(n) || !Number.isFinite(origem)) return null;
    return origem + n * unitToMs(unidade);
}

/**
 * Formats an instant as a relative military offset: "D", "D+5", "D-2", "D+5,3"
 * (integer when whole; up to 2 decimals with pt-BR comma).
 * @param {number} epoch - Timestamp (epoch ms).
 * @param {number} origem - Origin/anchor (epoch ms, offset 0).
 * @param {string} unidade - Division unit.
 * @returns {string} pt-BR offset label (em-dash when undeterminable).
 */
export function formatRelative(epoch, origem, unidade) {
    const raw = epochToOffset(epoch, origem, unidade);
    if (raw === null) return '—';
    const n = Math.round(raw * 100) / 100;
    const letter = unitLetter(unidade);
    if (n === 0) return letter;
    const abs = Math.abs(n);
    const num = Number.isInteger(abs) ? String(abs) : String(abs).replace('.', ',');
    return `${letter}${n > 0 ? '+' : '-'}${num}`;
}

/**
 * Formats a timeline instant for the active mode: relative offset (D+N) when the
 * map is in relative mode with a finite origin, otherwise the absolute date/time.
 * @param {number} epoch - Timestamp (epoch ms).
 * @param {{modo: string, origem: (number|null), unidade: string}} ctx - Time context.
 * @returns {string}
 */
export function formatTimelineLabel(epoch, ctx = {}) {
    const { modo, origem, unidade } = ctx;
    if (modo === TEMPORAL_MODES.RELATIVO && Number.isFinite(origem)) {
        return formatRelative(epoch, origem, unidade);
    }
    return formatInstant(epoch, unidade);
}

/**
 * Formats an epoch as a military Date-Time Group (GDH) in Zulu (UTC), for the
 * auto-fill of symbol DTG amplifiers from the temporal window.
 *  - 'military' style → `DDHHMM<MON><YY>`   e.g. `201400NOV24` (dateTimeGroup / W)
 *  - 'coordination' style → `DDHHMMZ <MON>`  e.g. `121400Z JUN` (gdhIni/gdhFim / W,W1)
 * @param {number} epoch - Timestamp (epoch ms).
 * @param {('military'|'coordination')} [style='military'] - Output format.
 * @returns {string} GDH string (UTC), or '' when the epoch is non-finite.
 */
export function formatDTG(epoch, style = 'military') {
    if (!Number.isFinite(epoch)) return '';
    const d = new Date(epoch);
    const p2 = (n) => String(n).padStart(2, '0');
    const dd = p2(d.getUTCDate());
    const hh = p2(d.getUTCHours());
    const mm = p2(d.getUTCMinutes());
    const mon = DTG_MONTHS_PT[d.getUTCMonth()];
    if (style === 'coordination') return `${dd}${hh}${mm}Z ${mon}`;
    return `${dd}${hh}${mm}${mon}${p2(d.getUTCFullYear() % 100)}`;
}

/**
 * Scans features for the min/max temporal extent (temporalInicio/Fim + trajectory).
 * @param {Array<Object>} featureList - GeoJSON features (or bare property objects).
 * @returns {{min: number, max: number}|null} Extent, or null when no temporal data.
 */
export function computeTemporalExtent(featureList) {
    let min = Infinity;
    let max = -Infinity;
    const consider = (v) => {
        if (Number.isFinite(v)) {
            if (v < min) min = v;
            if (v > max) max = v;
        }
    };

    const features = Array.isArray(featureList) ? featureList : [];
    for (const f of features) {
        const p = (f && f.properties) || f;
        if (!p) continue;
        consider(p.temporalInicio);
        consider(p.temporalFim);
        const traj = Array.isArray(p.trajetoria) ? p.trajetoria : [];
        for (const kp of traj) consider(kp && kp.t);
    }

    if (min === Infinity || max === -Infinity) return null;
    return { min, max };
}

/**
 * Span, in division units, used to COMPLETE a timeline whose other end cannot be
 * derived. It matches the 24-step window the controller invents when there is
 * nothing at all to go on, so a half-configured map and an empty one show a
 * ruler of the same length.
 */
export const DEFAULT_TIMELINE_SPAN_UNITS = 24;

/**
 * Resolves the effective [inicio, fim] timeline bounds for a map: explicit
 * config bounds win; a missing bound comes from the features' exact extent;
 * and a bound that is STILL missing is completed from the one that exists.
 *
 * THE COMPLETION IS THE POINT. This used to return null whenever a single bound
 * was configured and the map had no temporal feature to derive the other from,
 * and the caller read that null as "nothing is known" and invented a window
 * starting at `Date.now()` — recomputed on every layer visibility toggle, so the
 * ruler's labels walked by themselves while the value the person had typed sat
 * in the config being ignored. One configured bound is a real answer; only two
 * nulls with no temporal feature is not.
 * @param {{inicio: (number|null), fim: (number|null), unidade: string}} config
 * @param {Array<Object>} features - Features to derive a fallback extent from.
 * @returns {{inicio: number, fim: number}|null} Bounds, or null when NOTHING is known.
 */
export function resolveTimelineBounds(config, features) {
    const cfg = config || {};
    let inicio = Number.isFinite(cfg.inicio) ? cfg.inicio : null;
    let fim = Number.isFinite(cfg.fim) ? cfg.fim : null;

    if (inicio === null || fim === null) {
        const extent = computeTemporalExtent(features);
        if (extent) {
            if (inicio === null) inicio = extent.min;
            if (fim === null) fim = extent.max;
        }
    }

    const span = DEFAULT_TIMELINE_SPAN_UNITS * unitToMs(cfg.unidade);
    if (inicio !== null && fim === null) fim = inicio + span;
    else if (fim !== null && inicio === null) inicio = fim - span;

    if (!Number.isFinite(inicio) || !Number.isFinite(fim)) return null;
    if (fim <= inicio) fim = inicio + unitToMs(cfg.unidade);
    return { inicio, fim };
}

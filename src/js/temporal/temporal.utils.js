// Path: js/temporal/temporal.utils.js

/**
 * @fileoverview Pure helpers for the Temporal Module: unit math, cursor
 * snapping/clamping, scrubber ticks, datetime-local conversion, flexible
 * timestamp parsing (for imports) and pt-BR formatting. No DOM/store deps.
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
 * Converts an epoch timestamp to a `YYYY-MM-DDTHH:mm` string for
 * `<input type="datetime-local">` (interpreted in the browser's local zone).
 * @param {number} epoch - Timestamp (epoch ms).
 * @returns {string} datetime-local value, or '' when non-finite.
 */
export function epochToDatetimeLocal(epoch) {
    if (!Number.isFinite(epoch)) return '';
    const d = new Date(epoch);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * Parses a `datetime-local` input value into an epoch timestamp.
 * @param {string} value - datetime-local string.
 * @returns {number|null} Epoch ms, or null when empty/invalid.
 */
export function datetimeLocalToEpoch(value) {
    if (!value) return null;
    const ms = new Date(value).getTime();
    return Number.isFinite(ms) ? ms : null;
}

/**
 * Flexible timestamp parser for imports. Accepts numbers (canonical epoch ms),
 * Date objects, and ISO-8601 / parseable date strings.
 *
 * Bare numbers (and bare-integer strings) are interpreted as epoch
 * MILLISECONDS — the module's canonical unit — with no seconds/ms guessing: a
 * seconds-vs-ms heuristic silently corrupts any pre-2001 millisecond timestamp
 * (and historical/negative dates), so EBGeo's own ms exports round-trip exactly.
 * @param {(number|string|Date|null|undefined)} value
 * @returns {number|null} Epoch ms, or null when unparseable.
 */
export function toEpoch(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (value instanceof Date) {
        const t = value.getTime();
        return Number.isFinite(t) ? t : null;
    }
    const str = String(value).trim();
    if (str === '') return null;

    // Bare integer string → epoch ms (canonical unit, no unit guessing).
    if (/^-?\d+$/.test(str)) {
        const n = Number(str);
        return Number.isFinite(n) ? n : null;
    }

    const ms = Date.parse(str);
    return Number.isFinite(ms) ? ms : null;
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

/** pt-BR 3-letter uppercase month abbreviations for DTG formatting. */
const DTG_MONTHS_PT = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];

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
 * Resolves the effective [inicio, fim] timeline bounds for a map: explicit
 * config bounds win; otherwise fall back to the features' extent (padded by one unit).
 * @param {{inicio: (number|null), fim: (number|null), unidade: string}} config
 * @param {Array<Object>} features - Features to derive a fallback extent from.
 * @returns {{inicio: number, fim: number}|null} Bounds, or null when undeterminable.
 */
export function resolveTimelineBounds(config, features) {
    const cfg = config || {};
    let inicio = Number.isFinite(cfg.inicio) ? cfg.inicio : null;
    let fim = Number.isFinite(cfg.fim) ? cfg.fim : null;

    if (inicio === null || fim === null) {
        const extent = computeTemporalExtent(features);
        if (extent) {
            const step = unitToMs(cfg.unidade);
            if (inicio === null) inicio = extent.min;
            if (fim === null) fim = extent.max + step;
        }
    }

    if (!Number.isFinite(inicio) || !Number.isFinite(fim)) return null;
    if (fim <= inicio) fim = inicio + unitToMs(cfg.unidade);
    return { inicio, fim };
}

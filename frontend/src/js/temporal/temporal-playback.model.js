// Path: js/temporal/temporal-playback.model.js

/**
 * @fileoverview Pure playback math for the Temporal Module: how far the cursor
 * advances per frame, which step cell drives the show/hide filters, and which
 * cursor a sync must adopt for a given map. No DOM, no rAF, no store, no
 * MapLibre — every function here is unit-testable in plain node.
 *
 * The controller owns the state; this module owns the three rules that were
 * wrong inside it and are cheap to pin down in isolation:
 *  - playback duration must not depend on the division unit (C5);
 *  - the final instant must keep the last WHOLE cell, never a collapsed point (M10);
 *  - a cursor asked for map B must not be clamped against the bounds of map A (V10).
 */

import { clampCursor, quantizeCursor } from './temporal.utils.js';

/**
 * How far the cursor advances in one frame, as a fraction of the WHOLE timeline
 * window rather than a number of division units.
 *
 * The unit (Minuto/Hora/Dia/Semana) is a display granularity the person picks to
 * read the bar, so tying playback speed to it made the same "1x" mean a two-frame
 * flash on a four-week exercise in Semana and over seven minutes on a three-day
 * exercise in Minuto. Anchoring on the window instead makes 1x always take
 * `durationS` seconds end to end, whatever the unit, and the multipliers scale
 * that: 2x takes half the time, 0,5x twice.
 *
 * @param {Object} input
 * @param {number} input.inicio - Timeline start (epoch ms).
 * @param {number} input.fim - Timeline end (epoch ms).
 * @param {number} input.speed - Speed multiplier (1 = the full target duration).
 * @param {number} input.dtSeconds - Real seconds elapsed since the last frame.
 * @param {number} input.durationS - Target seconds for one full pass at 1x.
 * @returns {number} Milliseconds to advance (0 for any non-finite/degenerate input).
 */
export function playbackAdvanceMs({ inicio, fim, speed, dtSeconds, durationS }) {
    if (!Number.isFinite(inicio) || !Number.isFinite(fim)) return 0;
    if (!Number.isFinite(speed) || !Number.isFinite(dtSeconds) || !Number.isFinite(durationS)) return 0;
    const span = fim - inicio;
    if (span <= 0 || speed <= 0 || dtSeconds <= 0 || durationS <= 0) return 0;
    return (span * speed * dtSeconds) / durationS;
}

/**
 * The timeline step cell `[start, end]` that drives the show/hide filters at the
 * given cursor. Cells are measured from `inicio` and are one division unit wide,
 * divided by `substeps`.
 *
 * The end of the range is the case that used to be wrong: it collapsed to the
 * point `[fim, fim]`, so the very last frame hid every feature whose validity had
 * ended anywhere inside the cell the previous frame was still showing. The final
 * instant now keeps the LAST WHOLE cell, which is the same cell the frame just
 * before `fim` was showing.
 *
 * @param {Object} input
 * @param {number} input.cursor - Raw cursor (epoch ms); may sit at or past `fim`.
 * @param {number} input.inicio - Timeline start (epoch ms), the cell grid origin.
 * @param {number} input.fim - Timeline end (epoch ms).
 * @param {number} input.unitMs - Division unit length (ms).
 * @param {number} [input.substeps=1] - Cells per unit (positive; anything else = 1).
 * @returns {{start: number, end: number}} Window for the visibility filters; the
 *   degenerate `{start: cursor, end: cursor}` only when the inputs cannot form a grid.
 */
export function filterWindow({ cursor, inicio, fim, unitMs, substeps = 1 }) {
    if (!Number.isFinite(cursor)) return { start: cursor, end: cursor };
    if (!Number.isFinite(inicio) || !Number.isFinite(fim) || !Number.isFinite(unitMs)) {
        return { start: cursor, end: cursor };
    }
    const cells = Number.isFinite(substeps) && substeps > 0 ? substeps : 1;
    const step = unitMs / cells;
    if (!(step > 0)) return { start: cursor, end: cursor };

    let start = quantizeCursor(Math.min(cursor, fim), step, inicio);
    // `fim` exactly on a cell boundary: quantizing it opens the NEXT cell, which
    // starts where the timeline ends. Step back to the last cell that has width
    // inside the timeline (the span is a whole number of cells here, so this
    // never falls below `inicio`).
    if (start >= fim) start = fim - step;
    return { start, end: start + step };
}

/**
 * Whether a cursor request must wait for the sync of its own map instead of being
 * clamped now. The caller names the map it means; the controller answers with the
 * map whose bounds it has actually published.
 *
 * Clamping against the wrong map is not a rounding error: a briefing slide that
 * pins an instant of map B, restored while the controller still holds the bounds
 * of map A, lands on A's start and then gets clamped a second time by B's sync,
 * so the slide opens at the beginning of the timeline instead of its instant.
 *
 * @param {(string|null|undefined)} requestedMapName - Map the caller means (optional).
 * @param {(string|null|undefined)} publishedMapName - Map whose bounds are published.
 * @returns {boolean} True when the request must be parked as pending.
 */
export function shouldDeferCursor(requestedMapName, publishedMapName) {
    if (requestedMapName === null || requestedMapName === undefined || requestedMapName === '') {
        return false;
    }
    return requestedMapName !== publishedMapName;
}

/**
 * The cursor a sync should adopt for `mapName`, clamped EXACTLY ONCE against that
 * map's bounds. Priority: a pending request aimed at this map, then the cursor
 * already on screen, then the cursor this person last had on this map, then the
 * timeline start.
 *
 * The remembered value is what makes the cursor personal per map: turning temporal
 * off wipes the public cursor (`getCursor()` must read NaN), and turning it back on
 * should return the person to where they were, not to the start of the timeline.
 *
 * @param {Object} input
 * @param {({mapName: string, cursor: number}|null)} input.pending - Parked request, if any.
 * @param {string} input.mapName - Map being synced.
 * @param {number} input.current - Cursor currently on screen (NaN when none).
 * @param {number} [input.remembered] - Last cursor this person had on this map.
 * @param {number} input.inicio - Timeline start (epoch ms).
 * @param {number} input.fim - Timeline end (epoch ms).
 * @returns {{cursor: number, usedPending: boolean}} Clamped cursor, and whether the
 *   pending request was the one consumed (so the caller can drop it).
 */
export function adoptSyncCursor({ pending, mapName, current, remembered, inicio, fim }) {
    if (pending && pending.mapName === mapName && Number.isFinite(pending.cursor)) {
        return { cursor: clampCursor(pending.cursor, inicio, fim), usedPending: true };
    }
    let raw;
    if (Number.isFinite(current)) raw = current;
    else if (Number.isFinite(remembered)) raw = remembered;
    else raw = inicio;
    return { cursor: clampCursor(raw, inicio, fim), usedPending: false };
}

// Path: js/temporal/temporal.constants.js

/**
 * @fileoverview Shared constants for the Temporal Module.
 * The temporal dimension lets features appear, disappear and move along a
 * per-map timeline. All timestamps in the module are absolute epoch milliseconds.
 */

/**
 * Division units for the timeline (scrubber step + tick granularity).
 * Values are the unit length in milliseconds. Labels are pt-BR.
 * @type {Object<string, {ms: number, label: string, plural: string}>}
 */
export const TEMPORAL_UNITS = {
    MINUTO: { ms: 60_000, label: 'Minuto', plural: 'Minutos' },
    HORA: { ms: 3_600_000, label: 'Hora', plural: 'Horas' },
    DIA: { ms: 86_400_000, label: 'Dia', plural: 'Dias' },
    SEMANA: { ms: 604_800_000, label: 'Semana', plural: 'Semanas' },
};

/** Ordered unit keys (coarsest navigation in the settings dropdown). */
export const TEMPORAL_UNIT_KEYS = ['MINUTO', 'HORA', 'DIA', 'SEMANA'];

/**
 * Letter prefix for each unit in relative (military) mode: D-Day, H-Hour, etc.
 * (e.g. DIA → "D" → D+5; HORA → "H" → H+2).
 * @type {Object<string, string>}
 */
export const TEMPORAL_UNIT_LETTERS = {
    MINUTO: 'M',
    HORA: 'H',
    DIA: 'D',
    SEMANA: 'S',
};

/** Default division unit when a map enables temporal control. */
export const DEFAULT_TEMPORAL_UNIT = 'HORA';

/** Timeline reference modes: real calendar dates vs military relative offsets (D+N). */
export const TEMPORAL_MODES = Object.freeze({ ABSOLUTO: 'absoluto', RELATIVO: 'relativo' });

/**
 * Default per-map temporal configuration (stored in appStore as `temporal_<map>`).
 * `inicio`/`fim` are epoch ms bounds of the whole map timeline (null = auto from features).
 * `modo` selects absolute (real dates) vs relative (D+N) display/entry; `origem` is the
 * relative anchor (epoch of "D", offset 0), null until set.
 * @type {{ativo: boolean, unidade: string, inicio: (number|null), fim: (number|null), modo: string, origem: (number|null)}}
 */
export const DEFAULT_TEMPORAL_CONFIG = Object.freeze({
    ativo: false,
    unidade: DEFAULT_TEMPORAL_UNIT,
    inicio: null,
    fim: null,
    modo: TEMPORAL_MODES.ABSOLUTO,
    origem: null,
});

/** Feature types that support a movement trajectory (interpolated keypoints). */
export const TRAJECTORY_FEATURE_TYPES = ['point', 'military_symbol', 'coordination_measure'];

/** MapLibre GeoJSON source IDs whose geometry can be moved by a trajectory. */
export const TRAJECTORY_SOURCE_IDS = ['points', 'military_symbols', 'coordination_measures'];

/** Maps a trajectory-capable feature type to its MapLibre source ID. */
export const TRAJECTORY_TYPE_TO_SOURCE = {
    point: 'points',
    military_symbol: 'military_symbols',
    coordination_measure: 'coordination_measures',
};

/** Maps a trajectory-capable feature type to its registered control name. */
export const TRAJECTORY_TYPE_TO_CONTROL = {
    point: 'AddPointControl',
    military_symbol: 'AddMilitarySymbolControl',
    coordination_measure: 'AddCoordinationMeasureControl',
};

/**
 * Real seconds one full pass over the timeline takes at speed 1x.
 *
 * Playback used to advance a number of DIVISION UNITS per real second, which made
 * the length of the show depend on a display choice: the same "1x" ran a three-day
 * exercise in Minuto for over seven minutes and finished a four-week one in Semana
 * in two frames. The unit is how the person wants to READ the bar, not how long
 * they want to watch. Anchoring on the window instead makes every exercise take the
 * same time to play, whatever its span and unit.
 *
 * 60 s is the target: long enough for the eye to follow movement across the whole
 * window, short enough to watch the whole thing without reaching for 10x, and it
 * leaves the existing multipliers meaningful at both ends (10x = 6 s for a quick
 * survey, 0,5x = 2 min for a detailed pass).
 */
export const TEMPORAL_PLAYBACK_DURATION_S = 60;

/**
 * Playback speeds, as multipliers of `TEMPORAL_PLAYBACK_DURATION_S`: 1x plays the
 * whole timeline window in that many seconds, 2x in half of it, 0,5x in twice.
 * The labels on the bar stay "0,5x ... 10x"; what changed is that they no longer
 * mean "units per real second", so the same multiplier now behaves the same way on
 * any map, whatever its division unit.
 */
export const TEMPORAL_SPEED_OPTIONS = [0.5, 1, 2, 5, 10];

/** Default playback speed (multiplier of the target duration). */
export const DEFAULT_TEMPORAL_SPEED = 1;

/** Max number of tick marks rendered on the scrubber (density cap). */
export const MAX_TIMELINE_TICKS = 240;

/**
 * How many show/hide steps each timeline unit is divided into during playback.
 * Show/hide (the layer visibility filters) only recomputes when the cursor
 * crosses one of these sub-steps, so this trades update granularity for cost:
 * 1 = step by whole unit (coarsest, cheapest); 2 = half-unit steps (features
 * appear/disappear within half a unit of their real time, ~2 filter rebuilds per
 * unit at speed 1). Trajectory movement always uses the raw continuous cursor and
 * is unaffected. Must be a positive integer.
 */
export const TEMPORAL_RENDER_SUBSTEPS = 2;

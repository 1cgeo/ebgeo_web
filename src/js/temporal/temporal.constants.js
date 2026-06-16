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

/**
 * Playback speeds, expressed as timeline-units advanced per real second.
 * (e.g. with unit HORA, speed 2 advances 2 hours per wall-clock second.)
 */
export const TEMPORAL_SPEED_OPTIONS = [0.5, 1, 2, 5, 10];

/** Default playback speed (units per second). */
export const DEFAULT_TEMPORAL_SPEED = 1;

/** Max number of tick marks rendered on the scrubber (density cap). */
export const MAX_TIMELINE_TICKS = 240;

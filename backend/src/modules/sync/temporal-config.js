// Path: src/modules/sync/temporal-config.js
//
// THE CLOSED VOCABULARY OF `maps.temporal_config`: the per-map timeline (window, unit, lens and
// D-Day anchor) that the temporal module reads on every render.
//
// MIRROR of `DEFAULT_TEMPORAL_CONFIG`, `TEMPORAL_UNIT_KEYS` and `TEMPORAL_MODES` in
// `frontend/src/js/temporal/temporal.constants.js`. The contract has always lived on the CLIENT
// only: the column is JSONB, and until 2026-09-21 the server wrote into it whatever six loose keys
// the op carried. `unidade: 'banana'`, `ativo: 'sim'`, `modo: {}` and a window whose end precedes
// its start were all stored and relayed to every peer, because the one rule that named the column
// (`GRID_AND_TEMPORAL` in `free-field.schemas.js`) matches the keys `temporal_config`/
// `temporalConfig`, and the client never sends either: `mapTemporal` carries the six fields LOOSE
// and `normalizeMapChanges` assembles them afterwards. A rule that matches nothing reports success
// without checking anything.
//
// DISCARD, NEVER REJECT, which is the doctrine of the other write border and the reason this is a
// normalizer and not a Joi shape that fails: a 4xx on one op freezes the whole outbound queue of
// that client. An unusable value degrades to the DEFAULT of its own field, which is a complete
// state of the module (that is what `withDefaults` in `frontend/src/js/store/temporal.operations.js`
// already gives every reader for a key that is absent), never to an error.
//
// WHY `fim` IS THE ONE DROPPED WHEN THE WINDOW IS INVERTED. An inverted pair cannot be honoured:
// one of the two bounds has to go. Dropping `fim` leaves `inicio` with an AUTOMATIC upper bound
// (null = derive from the features), which is the widest honest reading and can never hide a
// feature. Keeping the inverted pair, or dropping `inicio` instead, produces an EMPTY window: every
// feature filtered out and a map that reads as broken. The failure direction is a window that is
// too wide, never one that shows nothing.
//
// ZERO IMPORTS, by contract: the sync write path, the import Joi and the mirror test all read it,
// and the mirror test loads it in plain node alongside the frontend constants
// (`frontend/tests/unit/configuracao-temporal-espelha-cliente.test.js`).

/** Division units of the timeline. Mirror of `TEMPORAL_UNIT_KEYS`. */
export const TEMPORAL_UNIT_KEYS = Object.freeze(['MINUTO', 'HORA', 'DIA', 'SEMANA']);

/** Display lenses. Mirror of the VALUES of `TEMPORAL_MODES` (`absoluto`/`relativo`). */
export const TEMPORAL_MODE_VALUES = Object.freeze(['absoluto', 'relativo']);

/**
 * The default of every field, which is also what an unusable value degrades to. Mirror of
 * `DEFAULT_TEMPORAL_CONFIG`; the key ORDER is the mirror too, since both sides enumerate it.
 */
export const DEFAULT_TEMPORAL_CONFIG = Object.freeze({
  ativo: false,
  unidade: 'HORA',
  inicio: null,
  fim: null,
  modo: 'absoluto',
  origem: null,
});

/** The six keys the column may hold. Anything else is dropped. */
export const TEMPORAL_CONFIG_KEYS = Object.freeze(Object.keys(DEFAULT_TEMPORAL_CONFIG));

/**
 * The widest epoch ms a `Date` can represent (`±8.64e15`). Outside it `new Date(v)` is an Invalid
 * Date on BOTH sides of the wire, so such a value cannot name an instant at all — it is degraded
 * rather than stored as a number that every reader will fail to render.
 */
export const TEMPORAL_EPOCH_LIMIT_MS = 8.64e15;

/**
 * THE RULE FOR EVERY INSTANT THIS PRODUCT STORES: an epoch ms number, or null.
 *
 * It is exported because FOUR columns hold one and they must agree: the three bounds of
 * `maps.temporal_config` below, and `slides.temporal_cursor`, which is the instant a briefing slide
 * freezes. That last one reaches it by three doors (the sync write path, the clone and the import),
 * and a second copy of this arithmetic in any of them is the copy that drifts.
 *
 * Returns null and never throws: `transition.service.js` only applies a finite cursor and the
 * timeline only reads finite bounds, so a value of another shape is noise, not content, and
 * refusing the operation over it would freeze the client's outbound queue.
 *
 * @param {*} v
 * @returns {number|null}
 */
export function normalizeEpochMs(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return Math.abs(v) <= TEMPORAL_EPOCH_LIMIT_MS ? v : null;
}

/**
 * The per-field rules. Each one answers with a STORABLE value for every input, never throws, and
 * never widens: a key absent from the payload stays absent from the output, because the column is
 * REPLACED wholesale by what the op carries and filling a missing key here would write a default
 * over a value the client never mentioned.
 */
const FIELD_RULES = {
  ativo: (v) => v === true,
  unidade: (v) => (TEMPORAL_UNIT_KEYS.includes(v) ? v : DEFAULT_TEMPORAL_CONFIG.unidade),
  modo: (v) => (TEMPORAL_MODE_VALUES.includes(v) ? v : DEFAULT_TEMPORAL_CONFIG.modo),
  inicio: normalizeEpochMs,
  fim: normalizeEpochMs,
  origem: normalizeEpochMs,
};

/**
 * The document this server will store in `maps.temporal_config`.
 *
 * @param {*} raw - The assembled config, from the six loose keys of a `mapTemporal` op, from a
 *   nested `temporal_config` of a plain `map` op, or from an `.ebgeo` import payload.
 * @returns {Object} A document holding only known keys with usable values. `{}` for anything that
 *   is not a plain object, including `null`: the column is `NOT NULL DEFAULT '{}'`, so a null there
 *   raises 23502 and takes the whole push batch down with it.
 */
export function normalizeTemporalConfig(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};

  const out = {};
  for (const key of TEMPORAL_CONFIG_KEYS) {
    if (!Object.hasOwn(raw, key)) continue;
    out[key] = FIELD_RULES[key](raw[key]);
  }

  // The window, read as a pair. Both bounds survive the per-field rules on their own; only
  // together are they impossible. See the header for why `fim` is the one that goes.
  if (typeof out.inicio === 'number' && typeof out.fim === 'number' && out.fim < out.inicio) {
    out.fim = null;
  }

  return out;
}

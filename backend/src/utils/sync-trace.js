// Path: src/utils/sync-trace.js

/**
 * Backend half of the SyncLedger observability layer: a flag-gated, in-memory ring
 * buffer of server-side pipeline Spans (server.inserted / server.applied /
 * server.broadcast), keyed by atlasId. Independent of pino, so test runs that silence
 * the logger still get a server-side signal.
 *
 * Disabled unless EBGEO_TRACE=1 or NODE_ENV=test, so production keeps ~zero overhead
 * (every recordSpan is a single boolean early-return when off).
 *
 * The stage/outcome vocabulary MIRRORS the frontend
 * (ebgeo_web/src/js/store/sync/diag/trace-stages.js) and MUST stay in lockstep — the
 * ledger merger validates Span stages across both halves.
 */

/** Server-side pipeline stages (subset of the shared contract). */
export const TraceStage = Object.freeze({
  SERVER_INSERTED: 'server.inserted',
  SERVER_APPLIED: 'server.applied',
  SERVER_BROADCAST: 'server.broadcast',
});

/** Outcome a server stage can carry. */
export const TraceOutcome = Object.freeze({
  OK: 'ok',
  IDEMPOTENT: 'idempotent',
  NO_EFFECT: 'no-effect',
  FAILED: 'failed',
});

/** Default ring capacity per atlas (spans). */
const DEFAULT_CAPACITY = 5000;

/**
 * Max number of per-atlas rings retained at once. The per-atlas ring is already
 * bounded (DEFAULT_CAPACITY), but without this cap the top-level `buffers` Map grew
 * one entry per distinct atlasId forever (unbounded key count). When exceeded, the
 * oldest key is evicted FIFO (Map iteration order is insertion order).
 */
const MAX_ATLAS_RINGS = 64;

const state = {
  enabled: process.env.EBGEO_TRACE === '1' || process.env.NODE_ENV === 'test',
  capacity: DEFAULT_CAPACITY,
  /** @type {Map<string, Object[]>} atlasId -> ring of spans */
  buffers: new Map(),
  seq: 0,
};

/** @returns {boolean} Whether server-side capture is on. */
export function isTraceEnabled() {
  return state.enabled;
}

/** Enables/disables capture (used by tests). */
export function setTraceEnabled(on) {
  state.enabled = !!on;
}

/**
 * Records one server Span into the atlas ring. No-op when disabled or atlasId is
 * missing; never throws.
 * @param {string} atlasId
 * @param {string} stage - A TraceStage value.
 * @param {Object} [fields] - Span fields (scalars/ids/counts only).
 */
export function recordSpan(atlasId, stage, fields = {}) {
  if (!state.enabled || !atlasId) return;
  try {
    let buf = state.buffers.get(atlasId);
    if (!buf) {
      buf = [];
      state.buffers.set(atlasId, buf);
      // FIFO-evict the oldest ring(s) once the key count exceeds the cap, so the
      // top-level Map stays bounded no matter how many distinct atlases are traced.
      while (state.buffers.size > MAX_ATLAS_RINGS) {
        const oldest = state.buffers.keys().next().value;
        state.buffers.delete(oldest);
      }
    }
    buf.push({ seq: ++state.seq, ts: Date.now(), actor: 'server', atlasId, stage, ...fields });
    if (buf.length > state.capacity) buf.splice(0, buf.length - state.capacity);
  } catch {
    // Tracing must never break the request it observes.
  }
}

/**
 * Returns a copy of an atlas's spans, optionally filtered by opId/traceId. Does NOT
 * clear the ring (the debug endpoint reads; the caller clears explicitly).
 * @param {string} atlasId
 * @param {{ opId?: string, traceId?: string }} [filter]
 * @returns {Object[]}
 */
export function getTrace(atlasId, { opId, traceId } = {}) {
  const buf = state.buffers.get(atlasId) || [];
  let out = buf.slice();
  if (opId) out = out.filter((s) => s.opId === opId);
  if (traceId) out = out.filter((s) => s.traceId === traceId);
  return out;
}

/** Clears one atlas's ring, or all rings when atlasId is omitted. */
export function clearTrace(atlasId) {
  if (atlasId) state.buffers.delete(atlasId);
  else state.buffers.clear();
}

// Path: js/store/sync/diag/trace-stages.js

/**
 * @fileoverview Shared vocabulary for the SyncLedger observability layer — the single
 * contract that the frontend tracer, the backend tracer, and the ledger merger all
 * agree on. The backend keeps a MIRROR copy
 * (backend/src/utils/sync-trace.js) that MUST stay in lockstep:
 * the merger validates every Span's `stage` against this enum and flags unknown stages
 * rather than silently dropping them.
 */

/** Schema version of a ledger Span. Bump on any breaking field change. */
export const SPAN_SCHEMA_VERSION = 1;

/**
 * Canonical pipeline stages — one Span is emitted per stage-event per actor. The
 * order here mirrors the end-to-end flow (outbound author → server → inbound peer →
 * ack back to author).
 */
export const TraceStage = Object.freeze({
    // Outbound (author)
    ACTION_ORIGIN: 'action.origin',
    ENQUEUE: 'enqueue',
    PREFLUSH_DROP: 'preflush.drop',
    FLUSH_PUSH: 'flush.push',
    FLUSH_SKIP: 'flush.skip',
    PUSH_ACK: 'push.ack',
    // Server
    SERVER_INSERTED: 'server.inserted',
    SERVER_APPLIED: 'server.applied',
    SERVER_BROADCAST: 'server.broadcast',
    // Inbound (peer)
    WS_INBOUND: 'ws.inbound',
    WS_SELF_ECHO: 'ws.self-echo',
    GATEWAY_GATE: 'gateway.gate',
    APPLY_PERSIST: 'apply.persist',
    REMOTE_APPLIED: 'remote.applied',
    RENDER_SOURCE: 'render.source',
    PRESENCE: 'presence',
    CONN_TRANSITION: 'conn.transition',
});

/** Outcome a stage can carry. */
export const TraceOutcome = Object.freeze({
    OK: 'ok',
    DROPPED: 'dropped',
    FILTERED: 'filtered',
    FAILED: 'failed',
    IDEMPOTENT: 'idempotent',
    NO_EFFECT: 'no-effect',
});

/** Reason codes for preflush.drop / gateway.gate / ws.self-echo / ws.inbound drops. */
export const DropReason = Object.freeze({
    LOGGING_DISABLED: 'logging_disabled',
    NON_UUID_MAPID: 'non_uuid_mapId',
    NON_UUID_SETTING_ID: 'non_uuid_setting_id',
    BATCH_FILTERED: 'batch_filtered',
    ECHO_SELF: 'echo_self',
    OFFLINE: 'offline',
    PARSE_ERROR: 'parse_error',
    UNKNOWN_TYPE: 'unknown_type',
});

/** Frozen set of every known stage string — the merger uses it to reject drift. */
export const KNOWN_STAGES = Object.freeze(new Set(Object.values(TraceStage)));

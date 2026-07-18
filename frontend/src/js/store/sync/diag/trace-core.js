// Path: js/store/sync/diag/trace-core.js

/**
 * @fileoverview Core of the SyncLedger frontend tracer: a flag-gated, low-overhead
 * ring buffer of pipeline Spans plus the `window.__ebgeoSyncTrace` bridge that
 * Playwright and AI agents read.
 *
 * Hot-path contract: when disabled, `record()` returns on the first line without
 * allocating anything (a single boolean check), and it NEVER throws — a capture bug
 * must not break the pipeline it observes. Safe to import under Node (tests/e2e):
 * every browser global (window/localStorage/performance) is accessed defensively.
 *
 * Spans hold ONLY scalars/ids/counts — never feature geometry or full payloads — so
 * memory stays bounded and no PII beyond ids already on the wire is retained.
 */

import { SPAN_SCHEMA_VERSION } from './trace-stages.js';

/** Default ring capacity (spans). Tunable per-test to survive long mega runs. */
const DEFAULT_CAPACITY = 5000;

const state = {
    enabled: false,
    capacity: DEFAULT_CAPACITY,
    /** @type {Array<Object>} ring buffer; length capped at `capacity` */
    buffer: [],
    seq: 0,
    /** @type {string|null} author identity, stamped on every span */
    clientId: null,
};

/** High-resolution monotonic clock; 0 when `performance` is unavailable. */
function monoNow() {
    try {
        if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
            return performance.now();
        }
    } catch {
        // performance may be absent/guarded in some runtimes.
    }
    return 0;
}

/** Enables/disables capture. Zero-cost guard: `record()` early-returns when off. */
export function setTracing(on) {
    state.enabled = !!on;
}

/** @returns {boolean} Whether capture is currently on. */
export function isTracing() {
    return state.enabled;
}

/** Sets the ring capacity (spans). Ignored for non-positive/non-finite values. */
export function setTraceCapacity(n) {
    if (Number.isFinite(n) && n > 0) state.capacity = Math.floor(n);
}

/** Stamps `clientId` on subsequent spans (the author identity). */
export function setTraceClientId(id) {
    if (id) state.clientId = id;
}

/**
 * Records one Span. No-op (no allocation) when disabled; never throws.
 *
 * @param {string} stage - A `TraceStage` value.
 * @param {Object} [fields] - Span fields (scalars/ids/counts only).
 */
export function record(stage, fields) {
    if (!state.enabled) return;
    try {
        const entry = {
            v: SPAN_SCHEMA_VERSION,
            seq: ++state.seq,
            monoTs: monoNow(),
            ts: Date.now(),
            clientId: state.clientId,
            stage,
            ...fields,
        };
        const buf = state.buffer;
        buf.push(entry);
        if (buf.length > state.capacity) buf.splice(0, buf.length - state.capacity);
    } catch {
        // Tracing must never break the pipeline it observes.
    }
}

/**
 * Returns a shallow copy of the buffer, optionally filtered.
 * @param {(span: Object) => boolean} [filter]
 * @returns {Object[]}
 */
export function getTrace(filter) {
    if (typeof filter === 'function') return state.buffer.filter(filter);
    return state.buffer.slice();
}

/** All spans for one op id, in seq order — the "history" of that op. */
export function byOpId(opId) {
    return state.buffer.filter((e) => e.opId === opId).sort((a, b) => a.seq - b.seq);
}

/** All spans sharing a trace id (the gesture and every op it produced). */
export function byTraceId(traceId) {
    return state.buffer.filter((e) => e.traceId === traceId).sort((a, b) => a.seq - b.seq);
}

/** Synchronous "did opId reach stage" check — the primitive Playwright polls. */
export function hasSpan(opId, stage) {
    return state.buffer.some((e) => e.opId === opId && e.stage === stage);
}

/** Empties the ring (call at the start of each test). */
export function clearTrace() {
    state.buffer.length = 0;
    state.seq = 0;
}

/** Returns a copy of the buffer and empties it (for end-of-test collection). */
export function drainTrace() {
    const out = state.buffer.slice();
    clearTrace();
    return out;
}

/**
 * Resolves whether the tracer should be enabled in the current runtime, from any of:
 * a global flag (`globalThis.__EBGEO_TRACE__`, set by Playwright addInitScript), the
 * `?trace=sync` query param, or `localStorage['ebgeo_trace'] === '1'`.
 * @returns {boolean}
 */
export function resolveTraceFlag() {
    try {
        if (typeof globalThis !== 'undefined' && globalThis.__EBGEO_TRACE__) return true;
    } catch {
        // globalThis may be guarded.
    }
    try {
        if (typeof window !== 'undefined' && window.location && /[?&]trace=sync\b/.test(window.location.search || '')) {
            return true;
        }
    } catch {
        // window/location may be absent.
    }
    try {
        if (typeof localStorage !== 'undefined' && localStorage.getItem('ebgeo_trace') === '1') return true;
    } catch {
        // localStorage may throw in privacy mode.
    }
    return false;
}

/**
 * Installs `window.__ebgeoSyncTrace` — the only public, stable surface that Playwright
 * specs and AI agents read. No-op outside the browser. Idempotent.
 * @returns {void}
 */
export function installWindowBridge() {
    if (typeof window === 'undefined') return;
    window.__ebgeoSyncTrace = {
        get enabled() { return state.enabled; },
        enable() { setTracing(true); },
        disable() { setTracing(false); },
        setCapacity: setTraceCapacity,
        get: getTrace,
        byOpId,
        byTraceId,
        has: hasSpan,
        clear: clearTrace,
        drain: drainTrace,
        /**
         * Resolves with the first span matching `predicate`, or null on timeout.
         * @param {(span: Object) => boolean} predicate
         * @param {number} [timeoutMs=10000]
         */
        async waitFor(predicate, timeoutMs = 10000) {
            const deadline = Date.now() + timeoutMs;
            for (;;) {
                const hit = state.buffer.find((e) => {
                    try { return predicate(e); } catch { return false; }
                });
                if (hit) return hit;
                if (Date.now() >= deadline) return null;
                await new Promise((r) => setTimeout(r, 25));
            }
        },
    };
}

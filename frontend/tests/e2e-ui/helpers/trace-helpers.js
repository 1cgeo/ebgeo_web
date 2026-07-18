// Path: tests/e2e-ui/helpers/trace-helpers.js

/**
 * SyncLedger Playwright helpers — deterministic, stage-precise waits that replace the
 * blind `expect.poll(... , { timeout: 20000 })` pattern. They read the in-page ring
 * buffer (`window.__ebgeoSyncTrace`) the app installs when tracing is enabled.
 *
 * Enable tracing on a fresh context BEFORE navigation with `enableTrace(page)` (the
 * shared `openClient` already does this). On timeout, dump `opHistory`/`getClientLedger`
 * to see EXACTLY which pipeline stage the op last reached.
 */

/** Enables the tracer in a page before app boot. Call on a fresh context/page. */
export async function enableTrace(page) {
    await page.addInitScript(() => { window.__EBGEO_TRACE__ = true; });
}

/**
 * Waits until a peer APPLIED a remote op for `entityId` (store write + lifecycle event
 * emitted) — the deterministic replacement for `pollPeerFeature`.
 * @param {import('@playwright/test').Page} page
 * @param {string} entityId
 * @param {Object} [opts]
 * @param {string} [opts.operationType] - Narrow to 'create'|'update'|'delete'.
 * @param {number} [opts.timeout=15000]
 * @returns {Promise<boolean>} True if it waited on the trace signal; false if tracing was
 *   off (the caller should then fall back to its own store assertion with a full timeout).
 */
export async function waitForRemoteEntity(page, entityId, { operationType, timeout = 15000 } = {}) {
    // If tracing is off (e.g. EBGEO_E2E_NO_TRACE), don't block on a signal that will never
    // come — return false so the caller's store assertion is the source of truth (original
    // behaviour, no fixed-timeout penalty).
    const tracing = await page.evaluate(() => !!(window.__ebgeoSyncTrace && window.__ebgeoSyncTrace.enabled));
    if (!tracing) return false;
    await page.waitForFunction(
        (q) => {
            const t = window.__ebgeoSyncTrace;
            if (!t) return false;
            return t.get((s) => s.stage === 'remote.applied'
                && s.entityId === q.entityId
                && (!q.operationType || s.operationType === q.operationType)).length > 0;
        },
        { entityId, operationType },
        { timeout },
    );
    return true;
}

/** Waits until a specific op id reaches a specific stage on this page. */
export async function waitForStage(page, opId, stage, timeout = 15000) {
    await page.waitForFunction(
        (q) => !!(window.__ebgeoSyncTrace && window.__ebgeoSyncTrace.has(q.opId, q.stage)),
        { opId, stage },
        { timeout },
    );
}

/** Waits until the server acked an op the author flushed (outbound confirmation). */
export async function waitForAcked(page, opId, timeout = 15000) {
    await waitForStage(page, opId, 'push.ack', timeout);
}

/** Reads the full client ring (for ledger collection / assertions). */
export function getClientLedger(page) {
    return page.evaluate(() => (window.__ebgeoSyncTrace ? window.__ebgeoSyncTrace.get() : []));
}

/** Reads the ordered history of one op id on this page. */
export function opHistory(page, opId) {
    return page.evaluate((id) => (window.__ebgeoSyncTrace ? window.__ebgeoSyncTrace.byOpId(id) : []), opId);
}

/** Clears the page ring (call at the start of a scenario for a clean ledger). */
export function clearClientTrace(page) {
    return page.evaluate(() => { if (window.__ebgeoSyncTrace) window.__ebgeoSyncTrace.clear(); });
}

// ============================================================================
// Span-returning waits — used by the full-chain DSL. Unlike waitForStage (which
// throws a generic Playwright timeout), these resolve to the matching SPAN or to
// `null` on timeout, so the caller can throw a precise "broke at link N" error.
// ============================================================================

/**
 * Waits for (and returns) the first span on this page matching stage + entityId
 * (+ optional operationType). Returns null on timeout.
 */
export function waitForEntitySpan(page, { entityId, operationType, stage }, timeout = 15000) {
    return page.evaluate((q) => {
        const t = window.__ebgeoSyncTrace;
        if (!t) return null;
        return t.waitFor((s) => s.stage === q.stage
            && s.entityId === q.entityId
            && (!q.operationType || s.operationType === q.operationType), q.timeout);
    }, { entityId, operationType, stage, timeout });
}

/** Waits for (and returns) the first span where stage + opId match. Null on timeout. */
export function tryWaitStage(page, opId, stage, timeout = 15000) {
    return page.evaluate((q) => {
        const t = window.__ebgeoSyncTrace;
        if (!t) return null;
        return t.waitFor((s) => s.stage === q.stage && s.opId === q.opId, q.timeout);
    }, { opId, stage, timeout });
}

/**
 * Waits for a flush.push span whose batched `opIds` includes opId. flush.push is
 * batch-keyed (carries opIds[], not a single opId), so it needs its own matcher.
 */
export function waitForFlushPush(page, opId, timeout = 15000) {
    return page.evaluate((q) => {
        const t = window.__ebgeoSyncTrace;
        if (!t) return null;
        return t.waitFor((s) => s.stage === 'flush.push'
            && Array.isArray(s.opIds) && s.opIds.includes(q.opId), q.timeout);
    }, { opId, timeout });
}

/**
 * Waits until a feature reached (present=true) or left (present=false) the rendered
 * MapLibre source, per the render.source probe (entity-keyed; requires the probe flag
 * __EBGEO_TRACE_RENDER__). Returns the span or null on timeout.
 */
export function waitForRenderSource(page, entityId, { present = true, timeout = 15000 } = {}) {
    return page.evaluate((q) => {
        const t = window.__ebgeoSyncTrace;
        if (!t) return null;
        return t.waitFor((s) => s.stage === 'render.source'
            && s.entityId === q.entityId && s.inSource === q.present, q.timeout);
    }, { entityId, present, timeout });
}

/** Whether the entity-render probe (render.source spans) is enabled on this page. */
export function renderProbeOn(page) {
    return page.evaluate(() => !!globalThis.__EBGEO_TRACE_RENDER__);
}

/** True if this page ever recorded remote.applied for entityId (+ optional opType). */
export function peerSawRemoteApplied(page, entityId, operationType) {
    return page.evaluate((q) => {
        const t = window.__ebgeoSyncTrace;
        if (!t) return false;
        return t.get((s) => s.stage === 'remote.applied'
            && s.entityId === q.entityId
            && (!q.operationType || s.operationType === q.operationType)).length > 0;
    }, { entityId, operationType });
}

/** Returns the first preflush.drop span for entityId (optionally a specific reason), or null. */
export function findDropSpan(page, entityId, reason) {
    return page.evaluate((q) => {
        const t = window.__ebgeoSyncTrace;
        if (!t) return null;
        const hits = t.get((s) => s.stage === 'preflush.drop'
            && s.entityId === q.entityId
            && (!q.reason || s.reason === q.reason));
        return hits[0] || null;
    }, { entityId, reason });
}

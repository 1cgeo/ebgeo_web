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

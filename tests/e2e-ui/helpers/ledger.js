// Path: tests/e2e-ui/helpers/ledger.js

/**
 * SyncLedger merge + reduce — the unified causal artifact that ties client A + the
 * server + client B into one timeline per op, and the oracle an AI agent (or a human)
 * reads to judge correctness.
 *
 * `collectLedger` drains each browser's ring (`window.__ebgeoSyncTrace`) and the
 * backend ring (`GET /api/v1/debug/trace`), merging them by the keys that already
 * survive the wire (opId primary; serverVersion for ordering; traceId for the gesture
 * link). `reduceLedger` is a PURE function (no Playwright / no DOM) so it is unit-tested
 * under node like the rest of the project's pure logic.
 */

/**
 * Drains the per-page client rings and (optionally) the backend ring into one span list.
 * @param {import('@playwright/test').Page[]} pages - One per browser; labeled clientA, clientB, …
 * @param {Object} [opts]
 * @param {string} [opts.baseUrl] - Backend origin (to fetch server spans).
 * @param {string} [opts.token] - Bearer token of a user who can read the atlas trace.
 * @param {string} [opts.atlasId]
 * @returns {Promise<Object[]>} The merged span list.
 */
export async function collectLedger(pages, { baseUrl, token, atlasId } = {}) {
    const all = [];
    for (let i = 0; i < pages.length; i++) {
        const actor = `client${String.fromCharCode(65 + i)}`;
        const spans = await pages[i].evaluate(() => (window.__ebgeoSyncTrace ? window.__ebgeoSyncTrace.get() : []));
        for (const s of spans) all.push({ ...s, actor: s.actor || actor });
    }
    if (baseUrl && token && atlasId) {
        try {
            const res = await fetch(`${baseUrl}/api/v1/debug/trace?atlasId=${encodeURIComponent(atlasId)}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (res.ok) {
                const body = await res.json();
                for (const s of (body?.data?.spans || [])) all.push({ ...s, actor: s.actor || 'server' });
            }
        } catch {
            // Server trace is best-effort enrichment; the client rings carry the core signal.
        }
    }
    return all;
}

/** Stable sort key: serverVersion (LWW truth) → ts → per-actor seq. NEVER wall ts across actors. */
function orderKey(a, b) {
    const sv = (a.serverVersion ?? Number.POSITIVE_INFINITY) - (b.serverVersion ?? Number.POSITIVE_INFINITY);
    if (sv !== 0 && Number.isFinite(sv)) return sv;
    if ((a.ts ?? 0) !== (b.ts ?? 0)) return (a.ts ?? 0) - (b.ts ?? 0);
    return (a.seq ?? 0) - (b.seq ?? 0);
}

/** Best-effort root-cause for an orphan op, from the last stage it reached. */
function suspectCause(group) {
    const last = group[group.length - 1];
    if (last && last.stage === 'preflush.drop') return `dropped:${last.reason}`;
    if (group.some((s) => s.stage === 'flush.push' && s.outcome === 'failed')) return 'flush_failed_poison_batch';
    if (group.some((s) => s.stage === 'server.applied' && s.outcome === 'no-effect')) return 'acked_but_no_effect';
    if (group.some((s) => s.stage === 'gateway.gate')) return 'gated_offline_on_peer';
    if (group.some((s) => s.stage === 'flush.push') && !group.some((s) => s.stage === 'push.ack')) return 'pushed_no_ack';
    if (group.some((s) => s.stage === 'enqueue') && !group.some((s) => s.stage === 'flush.push')) return 'enqueued_not_flushed';
    return 'applied_nowhere';
}

/**
 * Reduces a merged span list into the consumable views. Pure & node-testable.
 *
 * @param {Object[]} spans
 * @returns {{
 *   summary: { ops: number, orphans: number, noEffects: number, conflicts: number },
 *   timelines: Object[], orphans: Object[], noEffects: Object[], conflicts: Object[]
 * }}
 */
export function reduceLedger(spans) {
    const list = Array.isArray(spans) ? spans : [];

    // Group by opId (the durable cross-stage, cross-actor join key).
    const byOp = new Map();
    for (const s of list) {
        if (!s || !s.opId) continue;
        if (!byOp.has(s.opId)) byOp.set(s.opId, []);
        byOp.get(s.opId).push(s);
    }

    const timelines = [];
    const orphans = [];
    const noEffects = [];

    for (const [opId, group] of byOp) {
        group.sort(orderKey);
        const appliedOn = [...new Set(group.filter((s) => s.stage === 'remote.applied').map((s) => s.actor))];
        const hasOutbound = group.some((s) => s.stage === 'enqueue' || s.stage === 'flush.push');
        const entityId = (group.find((s) => s.entityId) || {}).entityId;
        const traceId = (group.find((s) => s.traceId) || {}).traceId;

        timelines.push({
            opId,
            traceId,
            entityId,
            appliedOn,
            stages: group.map((s) => ({
                actor: s.actor, stage: s.stage, outcome: s.outcome,
                serverVersion: s.serverVersion, rowsAffected: s.rowsAffected, reason: s.reason,
            })),
        });

        // Orphan: the op left an author but never applied on any PEER (multi-client ledger).
        if (hasOutbound && appliedOn.length === 0) {
            const last = group[group.length - 1];
            orphans.push({
                opId, entityId,
                lastStage: last ? last.stage : null,
                lastOutcome: last ? last.outcome : null,
                suspectedCause: suspectCause(group),
            });
        }

        const ne = group.find((s) => s.stage === 'server.applied' && s.outcome === 'no-effect');
        if (ne) noEffects.push({ opId, entityId, rowsAffected: ne.rowsAffected });
    }

    // Conflicts: an entity with >1 distinct non-idempotent server.inserted. Winner = max
    // serverVersion (LWW by arrival order — NEVER timestamp/lamport).
    const insertsByEntity = new Map();
    for (const s of list) {
        if (s && s.stage === 'server.inserted' && s.outcome !== 'idempotent' && s.entityId) {
            if (!insertsByEntity.has(s.entityId)) insertsByEntity.set(s.entityId, []);
            insertsByEntity.get(s.entityId).push(s);
        }
    }
    const conflicts = [];
    for (const [entityId, inserts] of insertsByEntity) {
        if (inserts.length > 1) {
            const sorted = inserts.slice().sort((a, b) => (a.serverVersion ?? 0) - (b.serverVersion ?? 0));
            const winner = sorted[sorted.length - 1];
            conflicts.push({
                entityId,
                winnerOpId: winner.opId,
                winnerServerVersion: winner.serverVersion,
                superseded: sorted.slice(0, -1).map((s) => ({ opId: s.opId, serverVersion: s.serverVersion })),
            });
        }
    }

    return {
        summary: { ops: byOp.size, orphans: orphans.length, noEffects: noEffects.length, conflicts: conflicts.length },
        timelines, orphans, noEffects, conflicts,
    };
}

/**
 * Verifiable invariants (subset of the proposal's I1–I11) checkable from a merged ledger.
 * Returns an array of violations (empty = clean). By-design exclusions (I10) are NOT flagged.
 * @param {Object[]} spans
 * @returns {{ invariant: string, detail: string }[]}
 */
export function findViolations(spans) {
    const report = reduceLedger(spans);
    const violations = [];
    for (const o of report.orphans) {
        violations.push({ invariant: 'I1/I5', detail: `op ${o.opId} (entity ${o.entityId}) never applied on a peer — ${o.suspectedCause}` });
    }
    for (const n of report.noEffects) {
        violations.push({ invariant: 'I2', detail: `op ${n.opId} (entity ${n.entityId}) acked but rowsAffected=0` });
    }
    return violations;
}

/**
 * Renders a compact human/AI-readable report (markdown) suitable for testInfo.attach.
 * @param {Object} report - Output of reduceLedger.
 * @returns {string}
 */
export function renderReport(report) {
    const lines = [];
    lines.push('# SyncLedger report');
    lines.push('');
    lines.push(`- ops: ${report.summary.ops}`);
    lines.push(`- orphans: ${report.summary.orphans}`);
    lines.push(`- acked-but-no-effect: ${report.summary.noEffects}`);
    lines.push(`- conflicts: ${report.summary.conflicts}`);
    if (report.orphans.length) {
        lines.push('', '## Orphans (left an author, never applied on a peer)');
        for (const o of report.orphans) lines.push(`- op ${o.opId} entity=${o.entityId} lastStage=${o.lastStage} cause=${o.suspectedCause}`);
    }
    if (report.noEffects.length) {
        lines.push('', '## Acked but no effect (I2)');
        for (const n of report.noEffects) lines.push(`- op ${n.opId} entity=${n.entityId} rows=${n.rowsAffected}`);
    }
    if (report.conflicts.length) {
        lines.push('', '## Conflicts (winner by serverVersion)');
        for (const c of report.conflicts) lines.push(`- entity ${c.entityId} winner=${c.winnerOpId}@v${c.winnerServerVersion} superseded=${c.superseded.length}`);
    }
    return lines.join('\n');
}

// Path: tests/unit/ledger-reduce.test.js

/**
 * Unit tests for the SyncLedger reducer — the pure function that turns a merged span
 * list (client A + server + client B) into the AI/Playwright oracle. Pure logic, so it
 * is node-tested like the rest of the project's calculations (no Playwright/DOM).
 */

import { describe, it, expect } from 'vitest';
import { reduceLedger, findViolations, renderReport } from '../e2e-ui/helpers/ledger.js';

/** Builds a minimal span with sane defaults. */
function span(actor, stage, fields = {}) {
    return { actor, stage, seq: fields.seq ?? 0, ts: fields.ts ?? 0, ...fields };
}

describe('reduceLedger', () => {
    it('treats an op applied on a peer as converged (no orphan)', () => {
        const spans = [
            span('clientA', 'enqueue', { opId: 'op1', entityId: 'f1' }),
            span('clientA', 'flush.push', { opId: 'op1' }),
            span('server', 'server.inserted', { opId: 'op1', entityId: 'f1', serverVersion: 10, outcome: 'ok' }),
            span('server', 'server.applied', { opId: 'op1', entityId: 'f1', rowsAffected: 1, outcome: 'ok' }),
            span('clientA', 'push.ack', { opId: 'op1', serverVersion: 10, outcome: 'ok' }),
            span('clientB', 'ws.inbound', { opId: 'op1', entityId: 'f1' }),
            span('clientB', 'remote.applied', { opId: 'op1', entityId: 'f1', operationType: 'create' }),
        ];
        const r = reduceLedger(spans);
        expect(r.summary.orphans).toBe(0);
        const tl = r.timelines.find((t) => t.opId === 'op1');
        expect(tl.appliedOn).toContain('clientB');
        expect(findViolations(spans)).toHaveLength(0);
    });

    it('flags an op that left an author but never applied on a peer as an orphan, with a cause', () => {
        const spans = [
            span('clientA', 'enqueue', { opId: 'op2', entityId: 'f2' }),
            span('clientA', 'flush.push', { opId: 'op2', outcome: 'failed', error: 'boom' }),
        ];
        const r = reduceLedger(spans);
        expect(r.summary.orphans).toBe(1);
        expect(r.orphans[0]).toMatchObject({ opId: 'op2', entityId: 'f2', suspectedCause: 'flush_failed_poison_batch' });
        const v = findViolations(spans);
        expect(v.some((x) => x.invariant === 'I1/I5')).toBe(true);
    });

    it('attributes a preflush drop as the orphan cause', () => {
        const spans = [
            span('clientA', 'preflush.drop', { opId: undefined, entityId: 'f9', reason: 'non_uuid_mapId', outcome: 'dropped' }),
            span('clientA', 'enqueue', { opId: 'op9', entityId: 'f9' }),
            span('clientA', 'preflush.drop', { opId: 'op9', reason: 'logging_disabled', outcome: 'dropped' }),
        ];
        const r = reduceLedger(spans);
        // op9 left no flush and never applied → orphan; last stage is the drop.
        expect(r.orphans.find((o) => o.opId === 'op9').suspectedCause).toBe('dropped:logging_disabled');
    });

    it('surfaces an acked-but-no-effect op (I2) even when it applied on a peer', () => {
        const spans = [
            span('clientA', 'enqueue', { opId: 'op3', entityId: 'f3' }),
            span('server', 'server.inserted', { opId: 'op3', entityId: 'f3', serverVersion: 12, outcome: 'ok' }),
            span('server', 'server.applied', { opId: 'op3', entityId: 'f3', rowsAffected: 0, outcome: 'no-effect' }),
            span('clientB', 'remote.applied', { opId: 'op3', entityId: 'f3', operationType: 'update' }),
        ];
        const r = reduceLedger(spans);
        expect(r.summary.orphans).toBe(0); // applied on B
        expect(r.summary.noEffects).toBe(1);
        expect(r.noEffects[0]).toMatchObject({ opId: 'op3', rowsAffected: 0 });
        expect(findViolations(spans).some((x) => x.invariant === 'I2')).toBe(true);
    });

    it('resolves a conflict by max serverVersion (LWW by arrival order), ignoring idempotent re-arrivals', () => {
        const spans = [
            span('server', 'server.inserted', { opId: 'op4a', entityId: 'f4', serverVersion: 20, outcome: 'ok' }),
            span('server', 'server.inserted', { opId: 'op4b', entityId: 'f4', serverVersion: 21, outcome: 'ok' }),
            // an idempotent re-arrival of op4a must NOT count as a third competitor
            span('server', 'server.inserted', { opId: 'op4a', entityId: 'f4', serverVersion: 20, outcome: 'idempotent' }),
        ];
        const r = reduceLedger(spans);
        expect(r.summary.conflicts).toBe(1);
        expect(r.conflicts[0]).toMatchObject({ entityId: 'f4', winnerOpId: 'op4b', winnerServerVersion: 21 });
        expect(r.conflicts[0].superseded).toEqual([{ opId: 'op4a', serverVersion: 20 }]);
    });

    it('renders a markdown report with the summary counters', () => {
        const spans = [
            span('clientA', 'enqueue', { opId: 'op2', entityId: 'f2' }),
            span('clientA', 'flush.push', { opId: 'op2' }),
        ];
        const md = renderReport(reduceLedger(spans));
        expect(md).toContain('# SyncLedger report');
        expect(md).toContain('orphans: 1');
    });

    it('is defensive against empty / malformed input', () => {
        expect(reduceLedger().summary.ops).toBe(0);
        expect(reduceLedger(null).summary.ops).toBe(0);
        expect(reduceLedger([null, {}, { stage: 'x' }]).summary.ops).toBe(0);
    });
});

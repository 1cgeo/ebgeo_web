// Path: tests/unit/ledger-chain-invariants.test.js

/**
 * Unit tests for findChainViolations — the full-chain IndexedDB-write invariants the
 * apply.persist instrumentation unlocks (I-AP1 author, I-AP2 peer). Pure logic over a
 * merged span list, so it is node-tested like the rest of the ledger reducer.
 */

import { describe, it, expect } from 'vitest';
import { findChainViolations } from '../e2e-ui/helpers/ledger.js';

/** Builds a minimal merged span (actor-labelled) with sane defaults. */
function span(actor, stage, fields = {}) {
    return { actor, stage, ...fields };
}

describe('findChainViolations', () => {
    it('is clean when author and peer both confirm their IndexedDB write', () => {
        const spans = [
            span('clientA', 'apply.persist', { opId: 'op1', entityId: 'f1' }),
            span('clientA', 'enqueue', { opId: 'op1', entityId: 'f1' }),
            span('clientA', 'flush.push', { opId: 'op1' }),
            span('clientA', 'push.ack', { opId: 'op1', outcome: 'ok' }),
            span('clientB', 'ws.inbound', { opId: 'op1', entityId: 'f1' }),
            span('clientB', 'apply.persist', { opId: 'op1', entityId: 'f1', entityType: 'feature' }),
            span('clientB', 'remote.applied', { opId: 'op1', entityId: 'f1', entityType: 'feature', operationType: 'create' }),
        ];
        expect(findChainViolations(spans)).toHaveLength(0);
    });

    it('flags I-AP1 when an author enqueues without confirming its IndexedDB write', () => {
        const spans = [
            span('clientA', 'enqueue', { opId: 'op2', entityId: 'f2' }),
            span('clientA', 'flush.push', { opId: 'op2' }),
        ];
        const v = findChainViolations(spans);
        expect(v.some((x) => x.invariant === 'I-AP1')).toBe(true);
    });

    it('flags I-AP2 when a peer applies a feature op without confirming its IndexedDB write', () => {
        const spans = [
            span('clientB', 'ws.inbound', { opId: 'op3', entityId: 'f3' }),
            span('clientB', 'remote.applied', { opId: 'op3', entityId: 'f3', entityType: 'feature', operationType: 'create' }),
        ];
        const v = findChainViolations(spans);
        expect(v.some((x) => x.invariant === 'I-AP2')).toBe(true);
    });

    it('exempts SLIDE (a redundant inbound no-op) from I-AP2', () => {
        const spans = [
            span('clientB', 'remote.applied', { opId: 'op4', entityId: 's4', entityType: 'slide', operationType: 'update' }),
        ];
        expect(findChainViolations(spans)).toHaveLength(0);
    });

    it('does not flag a peer apply that DID confirm its write', () => {
        const spans = [
            span('clientB', 'apply.persist', { opId: 'op5', entityId: 'f5', entityType: 'feature' }),
            span('clientB', 'remote.applied', { opId: 'op5', entityId: 'f5', entityType: 'feature', operationType: 'create' }),
        ];
        expect(findChainViolations(spans)).toHaveLength(0);
    });

    it('ignores spans without an opId or actor, and is defensive about bad input', () => {
        expect(findChainViolations()).toHaveLength(0);
        expect(findChainViolations(null)).toHaveLength(0);
        expect(findChainViolations([null, {}, { stage: 'enqueue' }, { actor: 'x', stage: 'enqueue' }])).toHaveLength(0);
    });
});

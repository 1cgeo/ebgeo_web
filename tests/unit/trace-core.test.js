// Path: tests/unit/trace-core.test.js

/**
 * Regression tests for the frontend SyncLedger ring buffer. The load-bearing
 * properties: zero capture when disabled, op-history reconstruction by op.id, the
 * synchronous "reached a stage" check Playwright polls, ring eviction, and never
 * throwing (a capture bug must not break the pipeline it observes).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    record,
    setTracing,
    getTrace,
    byOpId,
    hasSpan,
    clearTrace,
    drainTrace,
    setTraceCapacity,
} from '../../src/js/store/sync/diag/trace-core.js';
import { TraceStage } from '../../src/js/store/sync/diag/trace-stages.js';

describe('trace-core — frontend SyncLedger ring', () => {
    beforeEach(() => {
        clearTrace();
        setTraceCapacity(5000);
        setTracing(true);
    });

    it('records only when enabled (zero-cost guard)', () => {
        setTracing(false);
        record(TraceStage.ENQUEUE, { opId: 'op1' });
        expect(getTrace()).toHaveLength(0);
        setTracing(true);
        record(TraceStage.ENQUEUE, { opId: 'op1' });
        expect(getTrace()).toHaveLength(1);
    });

    it('byOpId returns the op history in seq order', () => {
        record(TraceStage.ENQUEUE, { opId: 'op1' });
        record(TraceStage.FLUSH_PUSH, { opId: 'op1' });
        record(TraceStage.PUSH_ACK, { opId: 'op2' });
        expect(byOpId('op1').map((s) => s.stage)).toEqual([TraceStage.ENQUEUE, TraceStage.FLUSH_PUSH]);
    });

    it('hasSpan checks whether an op reached a stage (the Playwright primitive)', () => {
        record(TraceStage.REMOTE_APPLIED, { opId: 'op3' });
        expect(hasSpan('op3', TraceStage.REMOTE_APPLIED)).toBe(true);
        expect(hasSpan('op3', TraceStage.PUSH_ACK)).toBe(false);
    });

    it('evicts the oldest spans beyond capacity (bounded ring)', () => {
        setTraceCapacity(3);
        for (let i = 0; i < 5; i++) record(TraceStage.ENQUEUE, { opId: `op${i}` });
        const t = getTrace();
        expect(t).toHaveLength(3);
        expect(t[0].opId).toBe('op2'); // op0 and op1 evicted
    });

    it('drain returns a copy and empties the ring', () => {
        record(TraceStage.ENQUEUE, { opId: 'op1' });
        expect(drainTrace()).toHaveLength(1);
        expect(getTrace()).toHaveLength(0);
    });

    it('never throws (capture must not break the pipeline)', () => {
        expect(() => record(TraceStage.ENQUEUE)).not.toThrow();
    });
});

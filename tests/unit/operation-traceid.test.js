// Path: tests/unit/operation-traceid.test.js

/**
 * Regression tests for the SyncLedger gesture id (traceId) on the op envelope. The
 * gesture link is best-effort enrichment — but when a gesture is active it MUST stamp
 * every op it produces, so a peer can tie an applied op back to the user action.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    createOperation,
    createBatchOperations,
    setActionTraceId,
    getActionTraceId,
} from '../../src/js/store/sync/operation-factory.js';

describe('operation-factory — action traceId', () => {
    beforeEach(() => setActionTraceId(null));

    it('stamps the ambient gesture id on a single op', () => {
        setActionTraceId('gesture-1');
        const op = createOperation('feature', 'create', 'f1', 'm1', { x: 1 });
        expect(op.traceId).toBe('gesture-1');
    });

    it('is null when no gesture is active (best-effort, never required)', () => {
        const op = createOperation('feature', 'create', 'f2', 'm1', {});
        expect(op.traceId).toBeNull();
    });

    it('stamps every op of a batch with the SAME gesture id', () => {
        setActionTraceId('gesture-2');
        const ops = createBatchOperations([
            { entityType: 'feature', operationType: 'create', entityId: 'a', mapId: 'm', data: {} },
            { entityType: 'feature', operationType: 'create', entityId: 'b', mapId: 'm', data: {} },
        ]);
        expect(ops).toHaveLength(2);
        expect(ops.every((o) => o.traceId === 'gesture-2')).toBe(true);
    });

    it('clears the ambient with null', () => {
        setActionTraceId('g');
        setActionTraceId(null);
        expect(getActionTraceId()).toBeNull();
        expect(createOperation('feature', 'create', 'f3', 'm', {}).traceId).toBeNull();
    });

    it('still produces a stable op.id even without a gesture (op.id is the real key)', () => {
        const op = createOperation('feature', 'create', 'f4', 'm', {});
        expect(typeof op.id).toBe('string');
        expect(op.id.length).toBeGreaterThan(0);
    });
});

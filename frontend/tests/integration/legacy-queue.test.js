import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { getStoreFor, localScope, remoteScope, StoreName } from '../../src/js/store/atlas-namespace.js';
import { OperationQueue } from '../../src/js/store/sync/operation-queue.js';
import { reconcileLegacyQueue, LEGACY_QUEUE_CODE } from '../../src/js/store/sync/legacy-queue.js';
import { createOperation, createBatchOperations } from '../../src/js/store/sync/operation-factory.js';
import { EntityType } from '../../src/js/store/sync/operation-types.js';

const operation = (extra = {}) => ({ id: crypto.randomUUID(), entityId: crypto.randomUUID(),
    entityType: 'map', operationType: 'create', timestamp: 1, data: { name: 'Antigo' }, ...extra });
const queue = () => new OperationQueue(remoteScope(crypto.randomUUID()));

describe('Legacy queue reconciliation without replay', () => {
    it('stamps every newly produced entity, including batch operations', () => {
        for (const entityType of Object.values(EntityType)) {
            expect(createOperation(entityType, 'create', 'entity', 'map').protocolVersion).toBe(2);
            expect(createBatchOperations([{ entityType, operationType: 'create', entityId: 'entity' }])[0].protocolVersion).toBe(2);
        }
    });

    it('quarantines old work and dependencies before snapshot projection or push, preserving envelopes', async () => {
        const q = queue();
        const parent = operation();
        const child = operation({ protocolVersion: 2, mapId: parent.entityId });
        const independent = operation({ protocolVersion: 2 });
        await q.enqueueAll([parent, child, independent]);
        expect(await q.getPendingProjection()).toEqual([independent]);
        expect(await q.peek()).toEqual([independent]);
        expect(await q.getAll()).toEqual([parent, child, independent]);
        const issues = await q.getIssues();
        expect(issues).toHaveLength(1);
        expect(issues[0].result.code).toBe(LEGACY_QUEUE_CODE);
        const reopened = new OperationQueue(q._scope);
        expect(await reopened.getPendingProjection()).toEqual([independent]);
    });

    it('does not quarantine local atlas work', async () => {
        const q = new OperationQueue(localScope(crypto.randomUUID(), crypto.randomUUID()));
        const old = operation();
        await q.enqueue(old);
        expect(await q.peek()).toEqual([old]);
        expect(await q.getIssues()).toEqual([]);
    });

    it('only removes an exact confirmed receipt; unknown, rejected and duplicate replies stay on disk', async () => {
        const q = queue();
        const ops = Array.from({ length: 4 }, () => operation());
        await q.enqueueAll(ops);
        const lookup = vi.fn(async () => ({ results: [
            { opId: ops[0].id, status: 'confirmed' },
            { opId: ops[1].id, status: 'unknown' },
            { opId: ops[2].id, status: 'review' },
            { opId: ops[3].id, status: 'confirmed' },
            { opId: ops[3].id, status: 'confirmed' },
        ] }));
        expect(await reconcileLegacyQueue(q, lookup, () => {})).toBe(3);
        expect(lookup).toHaveBeenCalledWith(ops);
        expect(await q.getAll()).toEqual(ops.slice(1));
    });

    it('preserves previous refusal and all envelopes after failed lookup and reopens safely', async () => {
        const q = queue();
        const old = operation();
        await q.enqueue(old);
        await q.recordIssue(old, { code: 'earlier-refusal', reason: 'Já recusada' });
        await expect(reconcileLegacyQueue(q, async () => { throw new Error('offline'); }, () => {})).rejects.toThrow('offline');
        const reopened = new OperationQueue(q._scope);
        expect(await reopened.getAll()).toEqual([old]);
        expect((await reopened.getIssues())[0].result.code).toBe('earlier-refusal');
        expect(await reopened.peek()).toEqual([]);
    });

    it('does not dequeue after the mounted session changes during lookup', async () => {
        const q = queue();
        const old = operation();
        await q.enqueue(old);
        let active = true;
        const lookup = async () => { active = false; return { results: [{ opId: old.id, status: 'confirmed' }] }; };
        await expect(reconcileLegacyQueue(q, lookup, () => { if (!active) throw new Error('stale'); })).rejects.toThrow('stale');
        expect(await q.getAll()).toEqual([old]);
    });

    it('retains original legacy storage keys and future versions instead of inventing compatibility', async () => {
        const scope = remoteScope(crypto.randomUUID());
        const store = getStoreFor(StoreName.OPERATION_QUEUE, scope);
        const old = operation({ protocolVersion: 99 });
        const key = `op_1_${old.id}`;
        await store.setItem(key, old);
        const q = new OperationQueue(scope);
        expect(await q.peek()).toEqual([]);
        expect(await store.getItem(key)).toEqual(old);
        expect((await q.getIssues())[0].result.code).toBe(LEGACY_QUEUE_CODE);
    });
});

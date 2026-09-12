import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { getStoreFor, remoteScope, StoreName } from '../../src/js/store/atlas-namespace.js';
import { OperationQueue } from '../../src/js/store/sync/operation-queue.js';

describe('Pending issue dependencies', () => {
    it('blocks refused parents and descendants while independent work can proceed', async () => {
        const scope = remoteScope('33333333-3333-4333-8333-333333333333');
        await getStoreFor(StoreName.OPERATION_QUEUE, scope).clear();
        const queue = new OperationQueue(scope);
        const parent = { protocolVersion: 2, id: 'parent', entityId: 'briefing', entityType: 'briefing' };
        await queue.enqueueAll([
            parent,
            { protocolVersion: 2, id: 'slide', entityId: 'slide', entityType: 'slide', data: { briefingId: 'briefing' } },
            { protocolVersion: 2, id: 'child', entityId: 'child', dependsOn: ['slide'] },
            { protocolVersion: 2, id: 'independent', entityId: 'other' },
        ]);
        await queue.recordIssue(parent, { success: false, reason: 'Permissão revogada' });
        expect((await queue.peek()).map(op => op.id)).toEqual(['independent']);
        expect((await queue.getPendingProjection()).map(op => op.id)).toEqual(['independent']);
        expect(await queue.count()).toBe(4);
        expect(await queue.getIssues()).toHaveLength(1);
    });

    it('acknowledges opaque IDs beginning with twelve digits without truncation', async () => {
        const scope = remoteScope('44444444-4444-4444-8444-444444444444');
        await getStoreFor(StoreName.OPERATION_QUEUE, scope).clear();
        const queue = new OperationQueue(scope);
        const id = '123456789012_opaque';
        await queue.enqueue({ id, entityId: 'one' });
        expect(await queue.dequeue([id])).toBe(1);
        expect(await queue.count()).toBe(0);
    });
});

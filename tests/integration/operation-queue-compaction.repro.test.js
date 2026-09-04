import { describe, it, expect, vi } from 'vitest';
import { OperationType, EntityType } from '../../src/js/store/sync/operation-types.js';

// Root cause pinned here: past MAX_QUEUE_SIZE, a queue whose operations belong to
// DISTINCT entities has nothing to merge, so compaction removed nothing, rebuilt
// the index at the same size, and the NEXT enqueue compacted again. Every edit
// then paid one IndexedDB read per queued operation, for good.

const { queueMap, reads } = vi.hoisted(() => ({ queueMap: new Map(), reads: { n: 0 } }));

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            setItem: vi.fn(async (key, value) => { queueMap.set(key, value); }),
            getItem: vi.fn(async (key) => { reads.n++; return queueMap.get(key) ?? null; }),
            removeItem: vi.fn(async (key) => { queueMap.delete(key); }),
            keys: vi.fn(async () => [...queueMap.keys()]),
            clear: vi.fn(async () => { queueMap.clear(); })
        })
    }
}));

import { OperationQueue } from '../../src/js/store/sync/operation-queue.js';

function op(i) {
    return {
        id: `op-${i}`,
        entityType: EntityType.FEATURE,
        operationType: OperationType.CREATE,
        entityId: `entity-${i}`,
        mapId: 'map-1',
        data: { i },
        previousData: null,
        timestamp: 1000 + i,
        lamportTimestamp: i,
        clientId: 'test-client'
    };
}

describe('OperationQueue compaction re-arm', () => {
    it('does not re-read the whole queue on every enqueue once nothing can be merged', async () => {
        const queue = new OperationQueue();
        const ops = Array.from({ length: 10001 }, (_, i) => op(i));
        await queue.enqueueAll(ops);
        // The first crossing of MAX_QUEUE_SIZE compacts once and reads everything.
        expect(reads.n).toBeGreaterThanOrEqual(10001);

        reads.n = 0;
        await queue.enqueue(op(10001));
        await queue.enqueue(op(10002));
        await queue.enqueue(op(10003));
        // Before the fix each of these three enqueues read 10001+ operations back.
        expect(reads.n).toBe(0);
        expect(await queue.size()).toBe(10004);
    });
});

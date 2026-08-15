import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OperationType, EntityType } from '../../src/js/store/sync/operation-types.js';

// ============================================================================
// Mock localforage (shared Map store for the OperationQueue)
// ============================================================================

const { queueMap } = vi.hoisted(() => ({ queueMap: new Map() }));

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            setItem: vi.fn(async (key, value) => { queueMap.set(key, value); }),
            getItem: vi.fn(async (key) => queueMap.get(key) ?? null),
            removeItem: vi.fn(async (key) => { queueMap.delete(key); }),
            keys: vi.fn(async () => [...queueMap.keys()]),
            clear: vi.fn(async () => { queueMap.clear(); })
        })
    }
}));

import { OperationQueue } from '../../src/js/store/sync/operation-queue.js';

// ============================================================================
// HELPERS
// ============================================================================

function createOp(id, entityType, operationType, entityId, mapId, data, timestamp) {
    return {
        id,
        entityType: entityType || EntityType.FEATURE,
        operationType: operationType || OperationType.CREATE,
        entityId: entityId || 'entity-1',
        mapId: mapId !== undefined ? mapId : 'map-1',
        data: data || null,
        previousData: null,
        timestamp: timestamp || Date.now(),
        lamportTimestamp: 0,
        clientId: 'test-client'
    };
}

// ============================================================================
// TESTS
// ============================================================================

describe('OperationQueue lifecycle', () => {
    let queue;

    beforeEach(() => {
        queueMap.clear();
        queue = new OperationQueue();
    });

    // ========================================================================
    // Enqueue and dequeue lifecycle
    // ========================================================================

    describe('enqueue and dequeue lifecycle', () => {
        it('enqueue single op → peek returns it → dequeue removes it → count = 0', async () => {
            const op = createOp('op-1', EntityType.FEATURE, OperationType.CREATE, 'feat-1', 'map-1', { nome: 'Test' });

            await queue.enqueue(op);
            expect(await queue.count()).toBe(1);

            const peeked = await queue.peek(1);
            expect(peeked).toHaveLength(1);
            expect(peeked[0].id).toBe('op-1');

            // Peek should NOT remove
            expect(await queue.count()).toBe(1);

            const removed = await queue.dequeue(['op-1']);
            expect(removed).toBe(1);
            expect(await queue.count()).toBe(0);
        });

        it('enqueue multiple ops → peek(2) returns first 2 in chronological order', async () => {
            const op1 = createOp('op-1', EntityType.FEATURE, OperationType.CREATE, 'feat-1', 'map-1', null, 1000);
            const op2 = createOp('op-2', EntityType.FEATURE, OperationType.UPDATE, 'feat-1', 'map-1', null, 2000);
            const op3 = createOp('op-3', EntityType.FEATURE, OperationType.UPDATE, 'feat-1', 'map-1', null, 3000);

            await queue.enqueue(op1);
            await queue.enqueue(op2);
            await queue.enqueue(op3);

            const peeked = await queue.peek(2);
            expect(peeked).toHaveLength(2);
            expect(peeked[0].id).toBe('op-1');
            expect(peeked[1].id).toBe('op-2');
        });

        it('dequeue non-existent ID returns 0 removed', async () => {
            const op = createOp('op-1', EntityType.FEATURE, OperationType.CREATE, 'feat-1');
            await queue.enqueue(op);

            const removed = await queue.dequeue(['non-existent']);
            expect(removed).toBe(0);
            expect(await queue.count()).toBe(1);
        });

        it('enqueue → clear → count = 0', async () => {
            await queue.enqueue(createOp('op-1'));
            await queue.enqueue(createOp('op-2'));
            expect(await queue.count()).toBe(2);

            await queue.clear();
            expect(await queue.count()).toBe(0);
        });

        it('getAll returns all enqueued operations', async () => {
            await queue.enqueue(createOp('op-1', EntityType.FEATURE, OperationType.CREATE, 'feat-1', 'map-1', null, 1000));
            await queue.enqueue(createOp('op-2', EntityType.LAYER, OperationType.UPDATE, 'layer-1', 'map-1', null, 2000));

            const all = await queue.getAll();
            expect(all).toHaveLength(2);
        });
    });

    // ========================================================================
    // Key resolution comes from DISK (there is no in-memory reverse index)
    //
    // These three cases used to assert the shape of a module-level `opId -> key`
    // Map. It was removed in E2B: it was built from whatever scope happened to be
    // active when the module first touched storage, and `dequeue` counted removals
    // through it while `peek` read the disk, so an operation enqueued by ANOTHER TAB
    // was peeked, pushed and never removed. What the index was there for is the
    // OBSERVABLE property asserted below.
    // ========================================================================

    describe('key resolution from disk', () => {
        it('a second instance (another tab) sees and can dequeue what the first wrote', async () => {
            await queue.enqueue(createOp('op-1', EntityType.FEATURE, OperationType.CREATE, 'feat-1', 'map-1', null, 1000));
            await queue.peek(10); // warms whatever internal state instance #1 keeps

            const outraAba = new OperationQueue();
            await outraAba.enqueue(createOp('op-2', EntityType.FEATURE, OperationType.CREATE, 'feat-2', 'map-1', null, 2000));

            const seen = await queue.peek(10);
            expect(seen.map(o => o.id)).toEqual(['op-1', 'op-2']);
            expect(await queue.dequeue(['op-1', 'op-2'])).toBe(2);
            expect(await queue.count()).toBe(0);
            expect(queueMap.size).toBe(0);
        });

        it('count is correct for a fresh instance (simulates a page reload)', async () => {
            await queue.enqueue(createOp('op-1', EntityType.FEATURE, OperationType.CREATE, 'feat-1', 'map-1', null, 1000));
            await queue.enqueue(createOp('op-2', EntityType.FEATURE, OperationType.UPDATE, 'feat-1', 'map-1', null, 2000));

            expect(await new OperationQueue().count()).toBe(2);
        });

        it('dequeue removes exactly the named ops and leaves the rest', async () => {
            await queue.enqueue(createOp('op-1', EntityType.FEATURE, OperationType.CREATE, 'feat-1', 'map-1', null, 1000));
            await queue.enqueue(createOp('op-2', EntityType.FEATURE, OperationType.CREATE, 'feat-2', 'map-1', null, 2000));
            await queue.enqueue(createOp('op-3', EntityType.FEATURE, OperationType.CREATE, 'feat-3', 'map-1', null, 3000));

            expect(await queue.dequeue(['op-2'])).toBe(1);
            expect(await queue.dequeue(['op-2'])).toBe(0); // and it is idempotent

            const all = await queue.getAll();
            expect(all.map(o => o.id)).toEqual(['op-1', 'op-3']);
        });
    });

    // ========================================================================
    // Chronological ordering
    // ========================================================================

    describe('chronological ordering', () => {
        it('ops enqueued with different timestamps → getAll returns in timestamp order', async () => {
            // Enqueue out of order
            await queue.enqueue(createOp('op-3', EntityType.FEATURE, OperationType.CREATE, 'f3', 'map-1', null, 3000));
            await queue.enqueue(createOp('op-1', EntityType.FEATURE, OperationType.CREATE, 'f1', 'map-1', null, 1000));
            await queue.enqueue(createOp('op-2', EntityType.FEATURE, OperationType.CREATE, 'f2', 'map-1', null, 2000));

            const all = await queue.getAll();
            expect(all[0].id).toBe('op-1');
            expect(all[1].id).toBe('op-2');
            expect(all[2].id).toBe('op-3');
        });

        it('ops with same timestamp → stable lexicographic order by ID', async () => {
            const ts = 1000;
            await queue.enqueue(createOp('bbb', EntityType.FEATURE, OperationType.CREATE, 'f1', 'map-1', null, ts));
            await queue.enqueue(createOp('aaa', EntityType.FEATURE, OperationType.CREATE, 'f2', 'map-1', null, ts));

            const all = await queue.getAll();
            // With same timestamp, key is op_1000_aaa vs op_1000_bbb
            expect(all[0].id).toBe('aaa');
            expect(all[1].id).toBe('bbb');
        });
    });

    // ========================================================================
    // Filtering
    // ========================================================================

    describe('filtering', () => {
        beforeEach(async () => {
            queueMap.clear();
            queue = new OperationQueue();
            await queue.enqueue(createOp('op-1', EntityType.FEATURE, OperationType.CREATE, 'feat-1', 'map-1', null, 1000));
            await queue.enqueue(createOp('op-2', EntityType.LAYER, OperationType.CREATE, 'layer-1', 'map-1', null, 2000));
            await queue.enqueue(createOp('op-3', EntityType.FEATURE, OperationType.UPDATE, 'feat-2', 'map-2', null, 3000));
            await queue.enqueue(createOp('op-4', EntityType.MAP, OperationType.CREATE, 'map-2', null, null, 4000));
        });

        it('getByEntityType returns only matching entity type', async () => {
            const features = await queue.getByEntityType(EntityType.FEATURE);
            expect(features).toHaveLength(2);
            expect(features.every(op => op.entityType === EntityType.FEATURE)).toBe(true);

            const layers = await queue.getByEntityType(EntityType.LAYER);
            expect(layers).toHaveLength(1);
            expect(layers[0].entityId).toBe('layer-1');
        });

        it('getByMapId returns only matching map ID', async () => {
            // Verify total ops first to ensure clean state
            const all = await queue.getAll();
            expect(all).toHaveLength(4);

            const map1Ops = await queue.getByMapId('map-1');
            // op-1 (map-1), op-2 (map-1) = 2 ops
            const map1Ids = map1Ops.map(o => o.id).sort();
            expect(map1Ids).toEqual(['op-1', 'op-2']);

            const map2Ops = await queue.getByMapId('map-2');
            expect(map2Ops).toHaveLength(1);
            expect(map2Ops[0].entityId).toBe('feat-2');
        });

        it('getByEntityType with no matches returns empty array', async () => {
            const briefings = await queue.getByEntityType(EntityType.BRIEFING);
            expect(briefings).toHaveLength(0);
        });
    });

    // ========================================================================
    // Compaction trigger
    // ========================================================================

    describe('compaction trigger', () => {
        it('_compactEntityOps merges CREATE+UPDATEs in queue instance', () => {
            // Test the pure compaction function on a queue instance
            const ops = [
                createOp('op-1', EntityType.FEATURE, OperationType.CREATE, 'feat-1', 'map-1', { nome: 'v1' }, 1000),
                createOp('op-2', EntityType.FEATURE, OperationType.UPDATE, 'feat-1', 'map-1', { nome: 'v2' }, 2000),
                createOp('op-3', EntityType.FEATURE, OperationType.UPDATE, 'feat-1', 'map-1', { nome: 'v3' }, 3000)
            ];

            const result = queue._compactEntityOps(ops);
            expect(result).toHaveLength(1);
            expect(result[0].operationType).toBe(OperationType.CREATE);
            expect(result[0].data.nome).toBe('v3');
        });

        it('_compact only runs when queue exceeds MAX_QUEUE_SIZE', async () => {
            // With only 3 ops, _compact returns early (guard: allOps.length <= MAX_QUEUE_SIZE)
            await queue.enqueue(createOp('op-1', EntityType.FEATURE, OperationType.CREATE, 'feat-1', 'map-1', { nome: 'v1' }, 1000));
            await queue.enqueue(createOp('op-2', EntityType.FEATURE, OperationType.UPDATE, 'feat-1', 'map-1', { nome: 'v2' }, 2000));
            await queue.enqueue(createOp('op-3', EntityType.FEATURE, OperationType.UPDATE, 'feat-1', 'map-1', { nome: 'v3' }, 3000));

            await queue._compact();

            // Should NOT compact (below MAX_QUEUE_SIZE threshold)
            const all = await queue.getAll();
            expect(all).toHaveLength(3);
        });

        it('compaction flag prevents re-entrancy (and releasing it lets compaction run)', async () => {
            // MAX_QUEUE_SIZE is 10000 and is not exported, so the queue has to be filled
            // past it for real: only above that threshold does _compact() do any work.
            // 5001 entities x (CREATE + UPDATE) = 10002 ops.
            const ENTITIES = 5001;
            const TOTAL = ENTITIES * 2;
            // Fixed-width (13-digit) timestamps so the lexicographic key sort
            // `op_{timestamp}_{id}` matches chronological order for every op.
            const BASE_TS = 1700000000000;

            // Fill with the guard already ON: enqueueAll's own auto-compact is suppressed,
            // so the queue is deliberately left oversized and un-compacted.
            queue._compacting = true;
            const ops = [];
            for (let i = 0; i < ENTITIES; i++) {
                ops.push(createOp(`c-${i}`, EntityType.FEATURE, OperationType.CREATE, `feat-${i}`, 'map-1', { nome: `v1-${i}` }, BASE_TS + i * 2));
                ops.push(createOp(`u-${i}`, EntityType.FEATURE, OperationType.UPDATE, `feat-${i}`, 'map-1', { nome: `v2-${i}` }, BASE_TS + i * 2 + 1));
            }
            await queue.enqueueAll(ops);

            const before = await queue.getAll();
            expect(before).toHaveLength(TOTAL);
            expect(TOTAL).toBeGreaterThan(10000); // above the compaction threshold
            const beforeIds = before.map(o => o.id);

            // GUARD ON: _compact() must be a no-op even though the queue IS oversized.
            // Nothing may be dropped, merged or rewritten.
            await queue._compact();

            const during = await queue.getAll();
            expect(during.map(o => o.id)).toEqual(beforeIds);
            expect(during[0].data.nome).toBe('v1-0');
            expect(during[1].data.nome).toBe('v2-0');
            expect(await queue.count()).toBe(TOTAL);

            // GUARD OFF: the very same call now compacts. Without this second half the
            // test would also pass with a _compact() that never compacts anything.
            queue._compacting = false;
            await queue._compact();

            const after = await queue.getAll();
            expect(after).toHaveLength(ENTITIES);                    // CREATE+UPDATE merged per entity
            expect(after.every(op => op.operationType === OperationType.CREATE)).toBe(true);
            expect(after[0].id).toBe('c-0');
            expect(after[0].data.nome).toBe('v2-0');                 // merged CREATE carries latest data
            expect(after.at(-1).data.nome).toBe(`v2-${ENTITIES - 1}`);
            expect(await queue.count()).toBe(ENTITIES);              // index rebuilt to match storage
            expect(queue._compacting).toBe(false);                   // flag released on the way out
        });

        it('enqueueAll with batch works correctly', async () => {
            const ops = [
                createOp('op-1', EntityType.FEATURE, OperationType.CREATE, 'feat-1', 'map-1', { nome: 'A' }, 1000),
                createOp('op-2', EntityType.FEATURE, OperationType.CREATE, 'feat-2', 'map-1', { nome: 'B' }, 2000),
                createOp('op-3', EntityType.LAYER, OperationType.CREATE, 'layer-1', 'map-1', { nome: 'L' }, 3000)
            ];

            await queue.enqueueAll(ops);
            expect(await queue.count()).toBe(3);

            const all = await queue.getAll();
            expect(all[0].id).toBe('op-1');
            expect(all[1].id).toBe('op-2');
            expect(all[2].id).toBe('op-3');
        });

        it('_compactEntityOps removes CREATE+DELETE pair', () => {
            const ops = [
                createOp('op-1', EntityType.FEATURE, OperationType.CREATE, 'feat-1', 'map-1', { nome: 'v1' }, 1000),
                createOp('op-2', EntityType.FEATURE, OperationType.UPDATE, 'feat-1', 'map-1', { nome: 'v2' }, 2000),
                createOp('op-3', EntityType.FEATURE, OperationType.DELETE, 'feat-1', 'map-1', null, 3000)
            ];

            const result = queue._compactEntityOps(ops);
            expect(result).toHaveLength(0);
        });
    });

    // ========================================================================
    // Queue persistence simulation
    // ========================================================================

    describe('queue persistence simulation', () => {
        it('ops survive a page reload (a fresh instance reads the same store)', async () => {
            await queue.enqueue(createOp('op-1', EntityType.FEATURE, OperationType.CREATE, 'feat-1', 'map-1', { nome: 'Ponto 1' }, 1000));
            await queue.enqueue(createOp('op-2', EntityType.FEATURE, OperationType.CREATE, 'feat-2', 'map-1', { nome: 'Ponto 2' }, 2000));

            const queue2 = new OperationQueue();
            const all = await queue2.getAll();
            expect(all).toHaveLength(2);
            expect(all[0].data.nome).toBe('Ponto 1');
            expect(all[1].data.nome).toBe('Ponto 2');
        });

        it('count is correct for a fresh instance', async () => {
            await queue.enqueue(createOp('op-1', EntityType.FEATURE, OperationType.CREATE, 'feat-1', 'map-1', null, 1000));
            await queue.enqueue(createOp('op-2', EntityType.FEATURE, OperationType.CREATE, 'feat-2', 'map-1', null, 2000));
            await queue.enqueue(createOp('op-3', EntityType.FEATURE, OperationType.CREATE, 'feat-3', 'map-1', null, 3000));

            expect(await new OperationQueue().count()).toBe(3);
        });
    });

    // ========================================================================
    // Key format
    // ========================================================================

    describe('key format', () => {
        it('key format enables chronological sorting', () => {
            // Keys: op_{timestamp}_{id}
            const keys = [
                'op_1706123456789_aaa',
                'op_1706123456790_bbb',
                'op_1706123456788_ccc'
            ];
            const sorted = [...keys].sort();
            expect(sorted).toEqual([
                'op_1706123456788_ccc',
                'op_1706123456789_aaa',
                'op_1706123456790_bbb'
            ]);
        });
    });

    // ========================================================================
    // Key parsing edge case
    // ========================================================================

    describe('key parsing', () => {
        it('an id containing underscores round-trips (the old parse truncated it)', async () => {
            // The key is `op_{timestamp}_{id}` and the id used to be recovered with
            // lastIndexOf('_'), which truncated such an id to its last segment: after a
            // reload the operation could be peeked and never dequeued. The parse now cuts
            // at the FIRST separator after the prefix (a timestamp has no underscore), so
            // the whole id survives. Real ids are UUIDs, so this is the guard, not the bug.
            const op = createOp('id_with_underscores', EntityType.FEATURE, OperationType.CREATE, 'feat-1', 'map-1', null, 1000);
            await queue.enqueue(op);

            // A fresh instance has nothing in memory: everything comes from the key.
            const depoisDoReload = new OperationQueue();
            expect((await depoisDoReload.getAll())[0].id).toBe('id_with_underscores');
            expect(await depoisDoReload.dequeue(['id_with_underscores'])).toBe(1);
            expect(await depoisDoReload.count()).toBe(0);
        });
    });

    // ========================================================================
    // Multi-entity compaction
    // ========================================================================

    describe('multi-entity compaction (pure logic)', () => {
        it('compacts each entity group independently', () => {
            // Test compaction logic per entity group using _compactEntityOps

            // Entity A: CREATE + UPDATE → merged CREATE
            const entityAResult = queue._compactEntityOps([
                createOp('op-1', EntityType.FEATURE, OperationType.CREATE, 'feat-A', 'map-1', { nome: 'A-v1' }, 1000),
                createOp('op-2', EntityType.FEATURE, OperationType.UPDATE, 'feat-A', 'map-1', { nome: 'A-v2' }, 2000)
            ]);
            expect(entityAResult).toHaveLength(1);
            expect(entityAResult[0].operationType).toBe(OperationType.CREATE);
            expect(entityAResult[0].data.nome).toBe('A-v2');

            // Entity B: UPDATE + DELETE → keep DELETE
            const entityBResult = queue._compactEntityOps([
                createOp('op-3', EntityType.FEATURE, OperationType.UPDATE, 'feat-B', 'map-1', { nome: 'B-v1' }, 3000),
                createOp('op-4', EntityType.FEATURE, OperationType.DELETE, 'feat-B', 'map-1', null, 4000)
            ]);
            expect(entityBResult).toHaveLength(1);
            expect(entityBResult[0].operationType).toBe(OperationType.DELETE);

            // Entity C: single CREATE → unchanged
            const entityCResult = queue._compactEntityOps([
                createOp('op-5', EntityType.FEATURE, OperationType.CREATE, 'feat-C', 'map-1', { nome: 'C' }, 5000)
            ]);
            expect(entityCResult).toHaveLength(1);
            expect(entityCResult[0].operationType).toBe(OperationType.CREATE);
        });

        it('multiple UPDATEs → keep only last', () => {
            const result = queue._compactEntityOps([
                createOp('op-1', EntityType.FEATURE, OperationType.UPDATE, 'feat-1', 'map-1', { nome: 'v1' }, 1000),
                createOp('op-2', EntityType.FEATURE, OperationType.UPDATE, 'feat-1', 'map-1', { nome: 'v2' }, 2000),
                createOp('op-3', EntityType.FEATURE, OperationType.UPDATE, 'feat-1', 'map-1', { nome: 'v3' }, 3000),
                createOp('op-4', EntityType.FEATURE, OperationType.UPDATE, 'feat-1', 'map-1', { nome: 'v4' }, 4000)
            ]);
            expect(result).toHaveLength(1);
            expect(result[0].id).toBe('op-4');
            expect(result[0].data.nome).toBe('v4');
        });
    });
});

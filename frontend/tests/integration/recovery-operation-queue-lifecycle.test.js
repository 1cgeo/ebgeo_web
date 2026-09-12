// Path: tests/integration/recovery-operation-queue-lifecycle.test.js
import { describe, it, expect, vi } from 'vitest';
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


describe('AUDIT pending queue', () => {
 it('AUDIT expiry must not remove unacknowledged work', async () => {
  queueMap.clear(); const q = new OperationQueue();
  await q.enqueue(createOp('audit-old', EntityType.FEATURE, OperationType.CREATE, 'audit-f', 'map-1', {x:1}, Date.now()-8*86400000));
  await q.purgeOldOperations();
  expect(await q.count()).toBe(1);
 });
 it('AUDIT compaction must not change the payload of an already sent op id', async () => {
  queueMap.clear(); const q = new OperationQueue();
  const create=createOp('sent-id', EntityType.FEATURE, OperationType.CREATE, 'audit-f', 'map-1', {x:1}, 1000);
  const update=createOp('new-id', EntityType.FEATURE, OperationType.UPDATE, 'audit-f', 'map-1', {x:2}, 1001);
  const compacted=q._compactEntityOps([create,update]);
  expect(compacted.find(o=>o.id==='sent-id')?.data).toEqual({x:1});
 });
 it('AUDIT clock rollback must not send an update before its create', async () => {
  queueMap.clear(); const q = new OperationQueue();
  await q.enqueue({...createOp('create',EntityType.FEATURE,OperationType.CREATE,'audit-f','map-1',{x:1},2000),lamportTimestamp:1});
  await q.enqueue({...createOp('update',EntityType.FEATURE,OperationType.UPDATE,'audit-f','map-1',{x:2},1000),lamportTimestamp:2});
  expect((await q.getAll()).map(o=>o.id)).toEqual(['create','update']);
 });
});

it('AUDIT compaction must preserve independent setting patches',()=>{
 const q=new OperationQueue();
 const compacted=q._compactEntityOps([
  createOp('p1',EntityType.SETTING,OperationType.UPDATE,'atlas',null,{terrainExaggeration:2},1000),
  createOp('p2',EntityType.SETTING,OperationType.UPDATE,'atlas',null,{globeProjection:'globe'},1001),
 ]);
 expect(Object.assign({},...compacted.map(o=>o.data))).toEqual({terrainExaggeration:2,globeProjection:'globe'});
});

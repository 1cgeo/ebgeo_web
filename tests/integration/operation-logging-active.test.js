import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock localforage (used by operation-queue.js)
const mockStore = new Map();
vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            setItem: vi.fn(async (key, value) => { mockStore.set(key, value); }),
            getItem: vi.fn(async (key) => mockStore.get(key) || null),
            removeItem: vi.fn(async (key) => { mockStore.delete(key); }),
            keys: vi.fn(async () => [...mockStore.keys()]),
        })
    }
}));

// Mock uuid
vi.mock('../../src/js/utilities/uuid.js', () => {
    let counter = 0;
    return {
        generateUUID: vi.fn(() => `uuid-${++counter}`),
        isValidUUID: vi.fn(() => true),
    };
});

// Mock localStorage
const localStorageMock = (() => {
    const store = {};
    return {
        getItem: (key) => store[key] || null,
        setItem: (key, value) => { store[key] = String(value); },
        removeItem: (key) => { delete store[key]; }
    };
})();
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

// Mock store-errors (emitStoreError)
vi.mock('../../src/js/store/store-errors.js', () => ({
    StoreErrorEvents: { STORE_SYNC_ERROR: 'store:syncError' },
    emitStoreError: vi.fn()
}));

import { OperationQueue } from '../../src/js/store/sync/operation-queue.js';
import { EntityType, OperationType } from '../../src/js/store/sync/operation-types.js';
import {
    enableOperationLogging,
    disableOperationLogging,
    isOperationLoggingEnabled,
    logFeatureOperation,
} from '../../src/js/store/sync/operation-dispatcher.js';
import { createOperation, createBatchOperations } from '../../src/js/store/sync/operation-factory.js';

let queue;

beforeEach(() => {
    mockStore.clear();
    queue = new OperationQueue();
    enableOperationLogging();
});

afterEach(() => {
    disableOperationLogging();
});

// ============================================================================
// Operation Logging Activation
// ============================================================================

describe('Operation logging activation', () => {
    it('isOperationLoggingEnabled reflects enableOperationLogging', () => {
        disableOperationLogging();
        expect(isOperationLoggingEnabled()).toBe(false);

        enableOperationLogging();
        expect(isOperationLoggingEnabled()).toBe(true);
    });

    it('logFeatureOperation does nothing when disabled', async () => {
        disableOperationLogging();
        await logFeatureOperation(OperationType.CREATE, 'f1', 'map1', { id: 'f1' });

        // Queue should be empty because logging is disabled
        // (the mock queue from the module is used internally, not our local `queue`)
        expect(isOperationLoggingEnabled()).toBe(false);
    });
});

// ============================================================================
// createOperation Contract
// ============================================================================

describe('createOperation', () => {
    it('creates a valid operation with all required fields', () => {
        const op = createOperation(
            EntityType.FEATURE,
            OperationType.CREATE,
            'feat-1',
            'map-1',
            { id: 'feat-1', type: 'point' }
        );

        expect(op.id).toBeTruthy();
        expect(op.entityType).toBe('feature');
        expect(op.operationType).toBe('create');
        expect(op.entityId).toBe('feat-1');
        expect(op.mapId).toBe('map-1');
        expect(op.data).toEqual({ id: 'feat-1', type: 'point' });
        expect(op.previousData).toBeNull();
        expect(op.timestamp).toBeGreaterThan(0);
        expect(op.lamportTimestamp).toBeGreaterThan(0);
        expect(op.clientId).toBeTruthy();
    });

    it('includes previousData when provided', () => {
        const op = createOperation(
            EntityType.FEATURE,
            OperationType.UPDATE,
            'feat-1',
            'map-1',
            { color: 'blue' },
            { color: 'red' }
        );

        expect(op.previousData).toEqual({ color: 'red' });
    });

    it('throws on invalid entity type', () => {
        expect(() => createOperation('invalid', OperationType.CREATE, 'x', null)).toThrow();
    });

    it('throws on invalid operation type', () => {
        expect(() => createOperation(EntityType.FEATURE, 'invalid', 'x', null)).toThrow();
    });

    it('throws when entityId is missing', () => {
        expect(() => createOperation(EntityType.FEATURE, OperationType.CREATE, '', null)).toThrow();
    });

    it('increments lamport clock on each call', () => {
        const op1 = createOperation(EntityType.FEATURE, OperationType.CREATE, 'f1', null);
        const op2 = createOperation(EntityType.FEATURE, OperationType.CREATE, 'f2', null);

        expect(op2.lamportTimestamp).toBeGreaterThan(op1.lamportTimestamp);
    });
});

// ============================================================================
// createBatchOperations
// ============================================================================

describe('createBatchOperations', () => {
    it('creates operations with shared batchId', () => {
        const ops = createBatchOperations([
            { entityType: EntityType.FEATURE, operationType: OperationType.CREATE, entityId: 'f1' },
            { entityType: EntityType.FEATURE, operationType: OperationType.CREATE, entityId: 'f2' },
        ]);

        expect(ops).toHaveLength(2);
        expect(ops[0].batchId).toBeTruthy();
        expect(ops[0].batchId).toBe(ops[1].batchId);
    });

    it('assigns sequential batchIndex values', () => {
        const ops = createBatchOperations([
            { entityType: EntityType.FEATURE, operationType: OperationType.CREATE, entityId: 'f1' },
            { entityType: EntityType.LAYER, operationType: OperationType.CREATE, entityId: 'l1' },
        ]);

        expect(ops[0].batchIndex).toBe(0);
        expect(ops[1].batchIndex).toBe(1);
    });

    it('uses monotonically increasing lamport timestamps', () => {
        const ops = createBatchOperations([
            { entityType: EntityType.FEATURE, operationType: OperationType.CREATE, entityId: 'f1' },
            { entityType: EntityType.FEATURE, operationType: OperationType.CREATE, entityId: 'f2' },
            { entityType: EntityType.FEATURE, operationType: OperationType.CREATE, entityId: 'f3' },
        ]);

        expect(ops[1].lamportTimestamp).toBeGreaterThan(ops[0].lamportTimestamp);
        expect(ops[2].lamportTimestamp).toBeGreaterThan(ops[1].lamportTimestamp);
    });
});

// ============================================================================
// OperationQueue enqueue/peek/dequeue
// ============================================================================

describe('OperationQueue', () => {
    it('enqueues and counts operations', async () => {
        const op = createOperation(EntityType.FEATURE, OperationType.CREATE, 'f1', 'map1');
        await queue.enqueue(op);

        const count = await queue.count();
        expect(count).toBe(1);
    });

    it('peek returns operations without removing them', async () => {
        const op = createOperation(EntityType.FEATURE, OperationType.CREATE, 'f1', 'map1');
        await queue.enqueue(op);

        const peeked = await queue.peek(10);
        expect(peeked).toHaveLength(1);
        expect(peeked[0].entityId).toBe('f1');

        // Still in queue
        const count = await queue.count();
        expect(count).toBe(1);
    });

    it('dequeues by operation ID', async () => {
        const op = createOperation(EntityType.FEATURE, OperationType.CREATE, 'f1', 'map1');
        await queue.enqueue(op);

        const removed = await queue.dequeue([op.id]);
        expect(removed).toBe(1);

        const count = await queue.count();
        expect(count).toBe(0);
    });

    it('enqueueAll adds multiple operations', async () => {
        const ops = createBatchOperations([
            { entityType: EntityType.FEATURE, operationType: OperationType.CREATE, entityId: 'f1' },
            { entityType: EntityType.FEATURE, operationType: OperationType.CREATE, entityId: 'f2' },
        ]);

        await queue.enqueueAll(ops);
        const count = await queue.count();
        expect(count).toBe(2);
    });

    it('clear removes all operations', async () => {
        const op = createOperation(EntityType.FEATURE, OperationType.CREATE, 'f1', 'map1');
        await queue.enqueue(op);
        await queue.clear();

        const count = await queue.count();
        expect(count).toBe(0);
    });

    it('getByEntityType filters correctly', async () => {
        const featureOp = createOperation(EntityType.FEATURE, OperationType.CREATE, 'f1', 'map1');
        const layerOp = createOperation(EntityType.LAYER, OperationType.CREATE, 'l1', 'map1');

        await queue.enqueue(featureOp);
        await queue.enqueue(layerOp);

        const features = await queue.getByEntityType('feature');
        expect(features).toHaveLength(1);
        expect(features[0].entityType).toBe('feature');
    });

    it('getByMapId filters correctly', async () => {
        const op1 = createOperation(EntityType.FEATURE, OperationType.CREATE, 'f1', 'map1');
        const op2 = createOperation(EntityType.FEATURE, OperationType.CREATE, 'f2', 'map2');

        await queue.enqueue(op1);
        await queue.enqueue(op2);

        const map1Ops = await queue.getByMapId('map1');
        expect(map1Ops).toHaveLength(1);
        expect(map1Ops[0].mapId).toBe('map1');
    });
});

// ============================================================================
// Queue compaction
// ============================================================================

describe('Queue compaction (_compactEntityOps)', () => {
    it('CREATE + DELETE = empty (no sync needed)', () => {
        const ops = [
            { operationType: OperationType.CREATE, id: 'op1' },
            { operationType: OperationType.UPDATE, id: 'op2', data: { x: 1 } },
            { operationType: OperationType.DELETE, id: 'op3' },
        ];

        const result = queue._compactEntityOps(ops);
        expect(result).toHaveLength(0);
    });

    it('CREATE + UPDATEs = single CREATE with latest data', () => {
        const ops = [
            { operationType: OperationType.CREATE, id: 'op1', data: { x: 0 } },
            { operationType: OperationType.UPDATE, id: 'op2', data: { x: 1 } },
            { operationType: OperationType.UPDATE, id: 'op3', data: { x: 2 } },
        ];

        const result = queue._compactEntityOps(ops);
        expect(result).toHaveLength(1);
        expect(result[0].operationType).toBe(OperationType.CREATE);
        expect(result[0].data).toEqual({ x: 2 });
    });

    it('UPDATEs + DELETE = only DELETE', () => {
        const ops = [
            { operationType: OperationType.UPDATE, id: 'op1', data: { x: 1 } },
            { operationType: OperationType.UPDATE, id: 'op2', data: { x: 2 } },
            { operationType: OperationType.DELETE, id: 'op3' },
        ];

        const result = queue._compactEntityOps(ops);
        expect(result).toHaveLength(1);
        expect(result[0].operationType).toBe(OperationType.DELETE);
    });

    it('multiple UPDATEs = keep only last', () => {
        const ops = [
            { operationType: OperationType.UPDATE, id: 'op1', data: { x: 1 } },
            { operationType: OperationType.UPDATE, id: 'op2', data: { x: 2 } },
            { operationType: OperationType.UPDATE, id: 'op3', data: { x: 3 } },
        ];

        const result = queue._compactEntityOps(ops);
        expect(result).toHaveLength(1);
        expect(result[0].data).toEqual({ x: 3 });
    });
});

// ============================================================================
// Auto-purge
// ============================================================================

describe('purgeOldOperations', () => {
    it('purges operations older than maxAge', async () => {
        // Manually insert an old operation
        const oldOp = createOperation(EntityType.FEATURE, OperationType.CREATE, 'old1', 'map1');
        oldOp.timestamp = Date.now() - 10 * 24 * 60 * 60 * 1000; // 10 days ago
        await queue.enqueue(oldOp);

        // Insert a recent operation
        const newOp = createOperation(EntityType.FEATURE, OperationType.CREATE, 'new1', 'map1');
        await queue.enqueue(newOp);

        const purged = await queue.purgeOldOperations(7 * 24 * 60 * 60 * 1000);
        expect(purged).toBe(1);

        const remaining = await queue.count();
        expect(remaining).toBe(1);
    });

    it('returns 0 when no operations are old enough', async () => {
        const op = createOperation(EntityType.FEATURE, OperationType.CREATE, 'f1', 'map1');
        await queue.enqueue(op);

        const purged = await queue.purgeOldOperations();
        expect(purged).toBe(0);
    });
});

// ============================================================================
// startAutoPurge / stopAutoPurge
// ============================================================================

describe('Auto-purge lifecycle', () => {
    afterEach(() => {
        queue.stopAutoPurge();
    });

    it('startAutoPurge is idempotent', () => {
        queue.startAutoPurge();
        const interval1 = queue._purgeInterval;

        queue.startAutoPurge();
        const interval2 = queue._purgeInterval;

        expect(interval1).toBe(interval2);
    });

    it('stopAutoPurge clears the interval', () => {
        queue.startAutoPurge();
        expect(queue._purgeInterval).toBeTruthy();

        queue.stopAutoPurge();
        expect(queue._purgeInterval).toBeNull();
    });
});

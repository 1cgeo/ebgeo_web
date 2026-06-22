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
    operationQueue,
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

    it('logFeatureOperation enqueues only when logging is enabled', async () => {
        await operationQueue.clear();

        // Disabled → the op must NOT reach the queue (assert the EFFECT, not just the flag).
        disableOperationLogging();
        await logFeatureOperation(OperationType.CREATE, 'f1', 'map1', { id: 'f1' });
        expect(await operationQueue.size()).toBe(0);

        // Enabled → the same call DOES enqueue exactly one op.
        enableOperationLogging();
        await logFeatureOperation(OperationType.CREATE, 'f2', 'map1', { id: 'f2' });
        expect(await operationQueue.size()).toBe(1);
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

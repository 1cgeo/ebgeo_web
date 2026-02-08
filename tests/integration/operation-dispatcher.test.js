import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock localforage before importing dispatcher (operation-queue uses it)
vi.mock('localforage', () => {
    const store = new Map();
    return {
        default: {
            createInstance: () => ({
                setItem: vi.fn(async (key, value) => { store.set(key, value); }),
                getItem: vi.fn(async (key) => store.get(key) ?? null),
                removeItem: vi.fn(async (key) => { store.delete(key); }),
                keys: vi.fn(async () => [...store.keys()]),
                clear: vi.fn(async () => { store.clear(); })
            })
        }
    };
});

// Mock store-errors
vi.mock('../../src/js/store/store-errors.js', () => ({
    StoreErrorEvents: {
        STORE_SYNC_ERROR: 'store:syncError',
        STORE_PERSIST_ERROR: 'store:persistError'
    },
    emitStoreError: vi.fn()
}));

// Mock localStorage for operation-factory
const localStorageMock = (() => {
    let store = {};
    return {
        getItem: (key) => store[key] ?? null,
        setItem: (key, value) => { store[key] = String(value); },
        removeItem: (key) => { delete store[key]; },
        clear: () => { store = {}; }
    };
})();
if (typeof globalThis.localStorage === 'undefined') {
    Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });
}

import {
    enableOperationLogging,
    disableOperationLogging,
    isOperationLoggingEnabled,
    logFeatureOperation,
    logMapOperation,
    logBatchOperations
} from '../../src/js/store/sync/operation-dispatcher.js';
import { OperationType } from '../../src/js/store/sync/operation-types.js';
import { operationQueue } from '../../src/js/store/sync/operation-queue.js';
import { emitStoreError } from '../../src/js/store/store-errors.js';

beforeEach(async () => {
    disableOperationLogging();
    vi.clearAllMocks();
    localStorageMock.clear();
    // Reset queue index
    operationQueue._index = null;
});

// ============================================================================
// Enable/disable toggle
// ============================================================================

describe('Operation logging toggle', () => {
    it('starts disabled', () => {
        expect(isOperationLoggingEnabled()).toBe(false);
    });

    it('can be enabled and disabled', () => {
        enableOperationLogging();
        expect(isOperationLoggingEnabled()).toBe(true);
        disableOperationLogging();
        expect(isOperationLoggingEnabled()).toBe(false);
    });
});

// ============================================================================
// Logging when disabled
// ============================================================================

describe('Logging when disabled', () => {
    it('logFeatureOperation does nothing when disabled', async () => {
        disableOperationLogging();
        await logFeatureOperation(OperationType.CREATE, 'f1', 'map-1', { nome: 'test' });
        const count = await operationQueue.count();
        expect(count).toBe(0);
    });

    it('logBatchOperations does nothing when disabled', async () => {
        disableOperationLogging();
        await logBatchOperations([
            { entityType: 'feature', operationType: OperationType.CREATE, entityId: 'f1' }
        ]);
        const count = await operationQueue.count();
        expect(count).toBe(0);
    });
});

// ============================================================================
// Logging when enabled
// ============================================================================

describe('Logging when enabled', () => {
    beforeEach(async () => {
        enableOperationLogging();
        await operationQueue.clear();
    });

    it('logFeatureOperation enqueues operation', async () => {
        await logFeatureOperation(OperationType.CREATE, 'f1', 'map-1', { nome: 'Ponto A' });
        const count = await operationQueue.count();
        expect(count).toBe(1);

        const ops = await operationQueue.peek(1);
        expect(ops[0].entityType).toBe('feature');
        expect(ops[0].operationType).toBe(OperationType.CREATE);
        expect(ops[0].entityId).toBe('f1');
        expect(ops[0].data.nome).toBe('Ponto A');
    });

    it('logMapOperation enqueues with null mapId for atlas-level', async () => {
        await logMapOperation(OperationType.CREATE, 'map-1', { name: 'Mapa 1' });
        const ops = await operationQueue.peek(1);
        expect(ops[0].entityType).toBe('map');
        expect(ops[0].mapId).toBeNull();
    });

    it('logBatchOperations enqueues all operations', async () => {
        await logBatchOperations([
            { entityType: 'feature', operationType: OperationType.CREATE, entityId: 'f1', mapId: 'm1' },
            { entityType: 'feature', operationType: OperationType.CREATE, entityId: 'f2', mapId: 'm1' }
        ]);
        const count = await operationQueue.count();
        expect(count).toBe(2);
    });
});

// ============================================================================
// Error handling
// ============================================================================

describe('Dispatcher error handling', () => {
    it('emits STORE_SYNC_ERROR on queue failure', async () => {
        enableOperationLogging();

        // Make queue fail
        const origEnqueue = operationQueue.enqueue.bind(operationQueue);
        operationQueue.enqueue = vi.fn().mockRejectedValue(new Error('DB full'));

        await logFeatureOperation(OperationType.CREATE, 'f1', 'map-1');

        expect(emitStoreError).toHaveBeenCalledWith(
            'store:syncError',
            expect.objectContaining({
                operation: 'create feature',
                entityId: 'f1'
            })
        );

        // Restore
        operationQueue.enqueue = origEnqueue;
    });
});

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
    logOperation,
    logFeatureOperation,
    logMapOperation,
    logBaseLayerOperation,
    logBatchOperations
} from '../../src/js/store/sync/operation-dispatcher.js';
import { EntityType, OperationType } from '../../src/js/store/sync/operation-types.js';
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

    // Regression — bug D: a map-setting op (baseLayer/mapPosition/mapNotes) keyed by a
    // NON-UUID map id (e.g. the local "Principal" default) can never be pushed; the
    // backend rejects the non-UUID id and that one op fails the ENTIRE flush batch,
    // blocking all sync. Such ops must NOT be enqueued.
    it('logBaseLayerOperation skips a non-UUID map id (un-syncable — would poison the flush)', async () => {
        await logBaseLayerOperation(OperationType.UPDATE, 'Principal', { baseLayer: 'osm' });
        expect(await operationQueue.count()).toBe(0);
    });

    it('logBaseLayerOperation enqueues for a real UUID map id', async () => {
        const mapId = '4a22f7df-df6d-47df-80bb-f26df86d31ec';
        await logBaseLayerOperation(OperationType.UPDATE, mapId, { baseLayer: 'osm' });

        const ops = await operationQueue.peek(1);
        expect(await operationQueue.count()).toBe(1);
        expect(ops[0].entityType).toBe('baseLayer');
        expect(ops[0].entityId).toBe(mapId);
        expect(ops[0].mapId).toBe(mapId);
    });

    // Regression — bug D (extended): a SETTING op keyed by a non-UUID LOCAL key (e.g.
    // 'lastActiveMap', the per-client active map) can never be pushed — the backend
    // rejects it (22P02) and that one op fails the whole flush batch, blocking sync.
    it('logOperation skips a SETTING op with a non-UUID local key', async () => {
        await logOperation(EntityType.SETTING, OperationType.UPDATE, 'lastActiveMap', null, { value: 'Mapa A' });
        expect(await operationQueue.count()).toBe(0);
    });

    it('logOperation enqueues a SETTING op scoped to the atlas (UUID id or "atlas" sentinel)', async () => {
        await logOperation(EntityType.SETTING, OperationType.UPDATE, '1b2d5b48-d232-4672-b6ce-fee86375df52', null, { mapBadgeColors: {} });
        await logOperation(EntityType.SETTING, OperationType.UPDATE, 'atlas', null, { customIcons: [] });
        expect(await operationQueue.count()).toBe(2);
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

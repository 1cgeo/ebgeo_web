import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Temporal Sync Operation Tests
 *
 * Validates that setMapTemporalConfig() emits a 'mapTemporal' UPDATE sync op
 * (entityId === mapId) when operation logging is enabled, while still emitting
 * the local TEMPORAL_CONFIG_CHANGED event. The backend maps 'mapTemporal' to
 * maps.temporal_config.
 */

// ============================================================================
// Mocks
// ============================================================================

// localforage backs the operation-queue persistence.
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

// localStorage backs the operation-factory client id / lamport clock.
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

vi.mock('../../src/js/store/store-errors.js', () => ({
    StoreErrorEvents: { STORE_SYNC_ERROR: 'store:syncError' },
    emitStoreError: vi.fn()
}));

// In-memory setting store standing in for IndexedDB persistence.
const settingStore = new Map();
vi.mock('../../src/js/store/repositories/index.js', () => ({
    getSettingCompat: vi.fn(async (key) => settingStore.get(key) ?? null),
    setSettingCompat: vi.fn(async (key, value) => { settingStore.set(key, value); })
}));

// mapManager only needs to resolve the current map name.
vi.mock('../../src/js/store/store-state-manager.js', () => ({
    default: {
        getCurrentMapName: vi.fn(() => '4a22f7df-df6d-47df-80bb-f26df86d31ec'),
        getMapId: vi.fn((m) => m)
    }
}));

// memoryStore only needs a temporalConfigs Map for the cache writes.
vi.mock('../../src/js/store/memory-store.js', () => ({
    memoryStore: { temporalConfigs: new Map() }
}));

// services.getEventBus() returns the mock bus.
let eventBus;
vi.mock('../../src/js/store/services.js', () => ({
    getEventBus: vi.fn(() => eventBus)
}));

// ============================================================================
// Imports
// ============================================================================

import { setMapTemporalConfig } from '../../src/js/store/temporal.operations.js';
import {
    enableOperationLogging,
    disableOperationLogging
} from '../../src/js/store/sync/operation-dispatcher.js';
import { operationQueue } from '../../src/js/store/sync/operation-queue.js';
import { EntityType, OperationType } from '../../src/js/store/sync/operation-types.js';
import { EventTypes } from '../../src/js/events/event_types.js';

// ============================================================================
// Helpers
// ============================================================================

function createMockEventBus() {
    return { emit: vi.fn(), on: vi.fn(), off: vi.fn() };
}

beforeEach(async () => {
    settingStore.clear();
    eventBus = createMockEventBus();
    disableOperationLogging();
    operationQueue._index = null;
    await operationQueue.clear();
});

// ============================================================================
// Tests
// ============================================================================

describe('setMapTemporalConfig sync op', () => {
    it('enqueues a mapTemporal UPDATE op with entityId === mapId when logging enabled', async () => {
        enableOperationLogging();

        const next = await setMapTemporalConfig('4a22f7df-df6d-47df-80bb-f26df86d31ec', { ativo: true, unidade: 'DIA' });

        const ops = await operationQueue.peek(10);
        expect(ops).toHaveLength(1);

        const op = ops[0];
        expect(op.entityType).toBe(EntityType.MAP_TEMPORAL);
        expect(op.entityType).toBe('mapTemporal');
        expect(op.operationType).toBe(OperationType.UPDATE);
        expect(op.entityId).toBe('4a22f7df-df6d-47df-80bb-f26df86d31ec');
        expect(op.mapId).toBe('4a22f7df-df6d-47df-80bb-f26df86d31ec');
        expect(op.data).toEqual(next);
        expect(op.data.ativo).toBe(true);
        expect(op.data.unidade).toBe('DIA');
    });

    it('still emits TEMPORAL_CONFIG_CHANGED', async () => {
        enableOperationLogging();

        await setMapTemporalConfig('4a22f7df-df6d-47df-80bb-f26df86d31ec', { ativo: true });

        expect(eventBus.emit).toHaveBeenCalledWith(
            EventTypes.TEMPORAL_CONFIG_CHANGED,
            expect.objectContaining({
                mapName: '4a22f7df-df6d-47df-80bb-f26df86d31ec',
                config: expect.objectContaining({ ativo: true })
            })
        );
    });

    it('does not enqueue any op when logging is disabled (offline-safe)', async () => {
        disableOperationLogging();

        await setMapTemporalConfig('4a22f7df-df6d-47df-80bb-f26df86d31ec', { ativo: true });

        const count = await operationQueue.count();
        expect(count).toBe(0);

        // Local event must still fire even without logging.
        expect(eventBus.emit).toHaveBeenCalledWith(
            EventTypes.TEMPORAL_CONFIG_CHANGED,
            expect.objectContaining({ mapName: '4a22f7df-df6d-47df-80bb-f26df86d31ec' })
        );
    });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Temporal Operations — real sync-op behavior (map-id-must-be-UUID class).
 *
 * temporal.operations.js emits a per-map temporal config as a 'mapTemporal'
 * sync op via logMapTemporalOperation (built from createMapSettingLogger, where
 * entityId === mapId). That logger carries a UUID guard: a non-UUID map id means
 * the map is a LOCAL map (e.g. the default "Principal", whose id is its name),
 * so the op can never be pushed to the backend. Without the guard, the backend
 * would reject the non-UUID map id (22P02) and that single op would fail the
 * ENTIRE flush batch, blocking all sync (the flush-poison bug class).
 *
 * These tests pin:
 *  - a UUID mapId DOES emit a mapTemporal UPDATE op (entityId === mapId === UUID),
 *  - a NON-UUID local map name does NOT enqueue any sync op,
 *  - the per-map config round-trips through the side (setting) store.
 */

// ============================================================================
// Mocks
// ============================================================================

// localforage backs the operation-queue persistence (in-memory map).
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

// In-memory setting store standing in for IndexedDB persistence (the "side store").
// Captured here so we can assert the per-map config round-trips.
const settingStore = new Map();
vi.mock('../../src/js/store/repositories/index.js', () => ({
    getSettingCompat: vi.fn(async (key) => settingStore.get(key) ?? null),
    setSettingCompat: vi.fn(async (key, value) => { settingStore.set(key, value); })
}));

// mapManager resolves the current map name (when mapName is null) and resolves a
// map name → UUID for the sync op. getMapId is identity here: a real UUID stays a UUID
// (op enqueued), a local name stays a name (guard drops it) — so both the UUID-syncs and
// the local-name-doesn't-sync expectations hold, while the production path resolves a real
// atlas map's NAME to its UUID so temporal config actually travels (see the Playwright
// browser-collab-briefing-temporal spec).
const CURRENT_MAP_NAME = 'Principal';
vi.mock('../../src/js/store/store-state-manager.js', () => ({
    default: {
        getCurrentMapName: vi.fn(() => CURRENT_MAP_NAME),
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

import {
    setMapTemporalConfig,
    getMapTemporalConfig
} from '../../src/js/store/temporal.operations.js';
import {
    enableOperationLogging,
    disableOperationLogging
} from '../../src/js/store/sync/operation-dispatcher.js';
import { operationQueue } from '../../src/js/store/sync/operation-queue.js';
import { EntityType, OperationType } from '../../src/js/store/sync/operation-types.js';
import { isValidUUID } from '../../src/js/utilities/uuid.js';
import { DEFAULT_TEMPORAL_CONFIG } from '../../src/js/temporal/temporal.constants.js';

// ============================================================================
// Fixtures / Helpers
// ============================================================================

// A real atlas map id (valid UUID v4) — pushable.
const MAP_UUID = '4a22f7df-df6d-47df-80bb-f26df86d31ec';
// A local map name (NOT a UUID) — its op can never be pushed.
const LOCAL_MAP_NAME = 'Principal';

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

describe('temporal.operations — map-id-must-be-UUID (flush-poison guard)', () => {
    it('sanity: the fixtures sort into the UUID / non-UUID buckets', () => {
        expect(isValidUUID(MAP_UUID)).toBe(true);
        expect(isValidUUID(LOCAL_MAP_NAME)).toBe(false);
    });

    it('UUID mapId → emits a mapTemporal UPDATE op (entityId === mapId === the UUID)', async () => {
        enableOperationLogging();

        const next = await setMapTemporalConfig(MAP_UUID, { ativo: true, unidade: 'DIA' });

        const ops = await operationQueue.peek(10);
        expect(ops).toHaveLength(1);

        const op = ops[0];
        // 'mapTemporal' is what the backend maps to maps.temporal_config.
        expect(op.entityType).toBe(EntityType.MAP_TEMPORAL);
        expect(op.entityType).toBe('mapTemporal');
        expect(op.operationType).toBe(OperationType.UPDATE);

        // The defining property of this op class: entityId === mapId === the UUID.
        expect(op.entityId).toBe(MAP_UUID);
        expect(op.mapId).toBe(MAP_UUID);
        expect(isValidUUID(op.entityId)).toBe(true);

        // Documented config shape { ativo, unidade, inicio, fim, ... } merged w/ defaults.
        expect(op.data).toEqual(next);
        expect(op.data.ativo).toBe(true);
        expect(op.data.unidade).toBe('DIA');
        expect(op.data).toMatchObject({
            ativo: true,
            unidade: 'DIA',
            inicio: null,
            fim: null
        });
    });

    it('NON-UUID local map name → does NOT enqueue any sync op (cannot be pushed)', async () => {
        enableOperationLogging();

        // A local map (name == id, not a UUID): the op would be un-pushable, so
        // the UUID guard in createMapSettingLogger must drop it before it ever
        // reaches the queue. (If it leaked, it would poison the whole flush batch.)
        const next = await setMapTemporalConfig(LOCAL_MAP_NAME, { ativo: true, unidade: 'DIA' });

        const count = await operationQueue.count();
        expect(count).toBe(0);

        const ops = await operationQueue.peek(10);
        expect(ops).toHaveLength(0);

        // The local write + event still happen — only the (un-pushable) sync op is skipped.
        expect(next.ativo).toBe(true);
        expect(eventBus.emit).toHaveBeenCalled();
    });

    it('current-map default (null mapName resolves to a non-UUID name) → no sync op', async () => {
        enableOperationLogging();

        // null → resolveMapName falls back to getCurrentMapName() === 'Principal' (non-UUID).
        await setMapTemporalConfig(null, { ativo: true });

        const count = await operationQueue.count();
        expect(count).toBe(0);
    });

    it('per-map temporal config round-trips through the side store (set then read back)', async () => {
        // No logging needed for the persistence path; keep it off to prove the
        // round-trip is independent of sync.
        disableOperationLogging();

        const written = await setMapTemporalConfig(MAP_UUID, {
            ativo: true,
            unidade: 'DIA',
            inicio: 1000,
            fim: 5000
        });

        // It was persisted under the documented `temporal_<mapName>` key.
        expect(settingStore.has(`temporal_${MAP_UUID}`)).toBe(true);

        // Read it back through the public reader → identical merged config.
        const readBack = await getMapTemporalConfig(MAP_UUID);
        expect(readBack).toEqual(written);
        expect(readBack).toMatchObject({
            ativo: true,
            unidade: 'DIA',
            inicio: 1000,
            fim: 5000
        });

        // A different map is unaffected → defaults (isolation between maps).
        const other = await getMapTemporalConfig('11111111-1111-4111-8111-111111111111');
        expect(other).toEqual({ ...DEFAULT_TEMPORAL_CONFIG });
        expect(other.ativo).toBe(false);
    });

    it('round-trip merges partial patches over the previously stored config', async () => {
        await setMapTemporalConfig(MAP_UUID, { ativo: true, unidade: 'DIA', inicio: 1000 });
        const merged = await setMapTemporalConfig(MAP_UUID, { fim: 9000 });

        // Earlier keys survive; the new patch is layered on top.
        expect(merged).toMatchObject({
            ativo: true,
            unidade: 'DIA',
            inicio: 1000,
            fim: 9000
        });

        const readBack = await getMapTemporalConfig(MAP_UUID);
        expect(readBack).toEqual(merged);
    });
});

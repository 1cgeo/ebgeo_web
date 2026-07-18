// Path: tests/integration/queue-poison-invariant.test.js
//
// INVARIANT (bug class d/d²): NO un-pushable sync op may ever be enqueued.
//
// A map-setting op (baseLayer/mapPosition/mapNotes) keyed by a NON-UUID map id,
// or a SETTING op keyed by a NON-UUID local key, can never be pushed to the
// backend: the id is rejected (Postgres 22P02 invalid uuid) and that ONE op
// fails the ENTIRE flush batch — blocking ALL sync. So such ops must never reach
// the queue in the first place.
//
// This test drives the REAL operation-dispatcher and captures every op the
// dispatcher tries to enqueue (by mocking operation-queue). If an un-pushable op
// IS enqueued, that is a real bug — the test fails (we do NOT patch src).

import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ queued: [] }));

// Capture every enqueue at the queue boundary — the dispatcher above it is real.
vi.mock('../../src/js/store/sync/operation-queue.js', () => ({
    operationQueue: {
        enqueue: vi.fn(async (op) => { h.queued.push(op); }),
        enqueueAll: vi.fn(async (ops) => { h.queued.push(...ops); }),
        _index: null,
    },
}));

vi.mock('../../src/js/store/store-errors.js', () => ({
    StoreErrorEvents: { STORE_SYNC_ERROR: 'store:syncError', STORE_PERSIST_ERROR: 'store:persistError' },
    emitStoreError: vi.fn(),
}));

// localStorage shim for operation-factory (clientId persistence).
const localStorageMock = (() => {
    let store = {};
    return {
        getItem: (k) => store[k] ?? null,
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: (k) => { delete store[k]; },
        clear: () => { store = {}; },
    };
})();
if (typeof globalThis.localStorage === 'undefined') {
    Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });
}

import {
    enableOperationLogging,
    disableOperationLogging,
    logOperation,
    logFeatureOperation,
    logBaseLayerOperation,
    logMapPositionOperation,
    logMapNotesOperation,
} from '../../src/js/store/sync/operation-dispatcher.js';
import { EntityType, OperationType } from '../../src/js/store/sync/operation-types.js';

// A real, well-formed UUID v4 — the only kind of id the backend will accept.
const UUID = '4a22f7df-df6d-47df-80bb-f26df86d31ec';

// Non-UUID map ids that exist only in local (offline) state. None can be pushed.
const NON_UUID_MAP_IDS = ['Principal', 'Mapa Tático', 'default'];

// Non-UUID SETTING keys: per-client / local-only view state. None can be pushed.
const NON_UUID_SETTING_KEYS = ['lastActiveMap', 'mapOrder', 'schemaVersion', 'currentMap'];

// Each map-setting logger has signature (opType, mapId, data) and the invariant
// that entityId === mapId === a UUID. logMapPosition has no fixed payload shape;
// the keys here are illustrative.
const MAP_SETTING_LOGGERS = [
    ['logBaseLayerOperation', logBaseLayerOperation, { baseLayer: 'osm' }],
    ['logMapPositionOperation', logMapPositionOperation, { center: [0, 0], zoom: 5 }],
    ['logMapNotesOperation', logMapNotesOperation, { notes: 'x' }],
];

beforeEach(() => {
    h.queued = [];
    localStorageMock.clear();
    vi.clearAllMocks();
    enableOperationLogging();
});

// ============================================================================
// 1. Map-setting loggers: non-UUID mapId → nothing; UUID mapId → exactly one op
// ============================================================================

describe('map-setting loggers reject a non-UUID map id (un-pushable — poisons the flush)', () => {
    for (const [name, logger, data] of MAP_SETTING_LOGGERS) {
        for (const mapId of NON_UUID_MAP_IDS) {
            it(`${name} enqueues NOTHING for non-UUID mapId "${mapId}"`, async () => {
                await logger(OperationType.UPDATE, mapId, data);
                expect(h.queued).toHaveLength(0);
            });
        }

        it(`${name} enqueues exactly one op for a real UUID mapId (entityId === mapId === UUID)`, async () => {
            await logger(OperationType.UPDATE, UUID, data);

            expect(h.queued).toHaveLength(1);
            const op = h.queued[0];
            expect(op.entityId).toBe(UUID);
            expect(op.mapId).toBe(UUID);
            expect(op.operationType).toBe(OperationType.UPDATE);
        });
    }
});

// ============================================================================
// 2. SETTING ops: non-UUID local key → nothing; UUID id or 'atlas' sentinel → one op
// ============================================================================

describe('SETTING ops reject a non-UUID local key (un-pushable — poisons the flush)', () => {
    for (const key of NON_UUID_SETTING_KEYS) {
        it(`logOperation(SETTING, UPDATE, "${key}", …) enqueues NOTHING`, async () => {
            await logOperation(EntityType.SETTING, OperationType.UPDATE, key, null, { value: 'whatever' });
            expect(h.queued).toHaveLength(0);
        });
    }

    it('logOperation(SETTING, …) enqueues one op for a real UUID atlas id', async () => {
        await logOperation(EntityType.SETTING, OperationType.UPDATE, UUID, null, { mapBadgeColors: {} });

        expect(h.queued).toHaveLength(1);
        const op = h.queued[0];
        expect(op.entityType).toBe(EntityType.SETTING);
        expect(op.entityId).toBe(UUID);
        expect(op.mapId).toBeNull();
    });

    it('logOperation(SETTING, …) enqueues one op for the literal "atlas" sentinel', async () => {
        await logOperation(EntityType.SETTING, OperationType.UPDATE, 'atlas', null, { customIcons: [] });

        expect(h.queued).toHaveLength(1);
        const op = h.queued[0];
        expect(op.entityType).toBe(EntityType.SETTING);
        expect(op.entityId).toBe('atlas');
        expect(op.mapId).toBeNull();
    });
});

// ============================================================================
// 3. Control: a feature op with a UUID mapId always enqueues
// ============================================================================

describe('control: a feature op with a UUID mapId always enqueues', () => {
    it('logFeatureOperation enqueues exactly one op', async () => {
        await logFeatureOperation(OperationType.CREATE, 'f1', UUID, { nome: 'Ponto A' });

        expect(h.queued).toHaveLength(1);
        const op = h.queued[0];
        expect(op.entityType).toBe(EntityType.FEATURE);
        expect(op.entityId).toBe('f1');
        expect(op.mapId).toBe(UUID);
    });

    it('is offline-safe: nothing is enqueued while logging is disabled', async () => {
        disableOperationLogging();
        await logFeatureOperation(OperationType.CREATE, 'f1', UUID, { nome: 'Ponto A' });
        await logBaseLayerOperation(OperationType.UPDATE, UUID, { baseLayer: 'osm' });
        await logOperation(EntityType.SETTING, OperationType.UPDATE, UUID, null, { customIcons: [] });
        expect(h.queued).toHaveLength(0);
    });
});

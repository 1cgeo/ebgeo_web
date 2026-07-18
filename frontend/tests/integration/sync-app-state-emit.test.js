// Path: tests/integration/sync-app-state-emit.test.js
// datamodel-13/14: the three app-state pieces that were local-only now emit a
// `setting` UPDATE op when they change, via logAtlasSetting (mirrors the
// terrainExaggeration logger). Offline-safe: logAtlasSetting no-ops while operation
// logging is disabled. These tests assert the EXACT op shape the backend whitelist
// expects:
//   - mapBadgeColors → data: { mapBadgeColors: { [mapName]: color } }  (full object)
//   - colorUsage     → data: { colorUsage: { [mapName]: counts } }     (per-map nested)
//   - customIcons    → data: { customIcons: [ ...registry ] }          (full list)

import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
    queued: [],
    enabled: { value: true },
    atlas: { id: '550e8400-e29b-41d4-a716-446655440000' },
}));

// Capture what logAtlasSetting enqueues by mocking the dispatcher's logSettingOperation
// dependency chain at the queue level. We mock the operation-queue so logOperation's
// enqueue lands in h.queued, and mock the repositories so logAtlasSetting resolves the
// atlas id. The dispatcher's `enabled` flag is controlled via the real enable fn.

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

// localStorage shim for operation-factory (clientId persistence)
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

// Repositories: logAtlasSetting resolves atlas id from getRepository().getAtlas().
vi.mock('../../src/js/store/repositories/index.js', () => ({
    getRepository: () => ({ getAtlas: async () => h.atlas }),
}));

import {
    enableOperationLogging,
    disableOperationLogging,
    logAtlasSetting,
} from '../../src/js/store/sync/operation-dispatcher.js';

beforeEach(() => {
    h.queued = [];
    h.atlas = { id: '550e8400-e29b-41d4-a716-446655440000' };
    localStorageMock.clear();
    enableOperationLogging();
});

describe('logAtlasSetting emit shape (datamodel-13/14)', () => {
    it('datamodel-13: mapBadgeColors emits a setting UPDATE op carrying the full color object', async () => {
        const mapBadgeColors = { Alfa: '#3b82f6', Bravo: '#f59e0b' };
        await logAtlasSetting({ mapBadgeColors });

        expect(h.queued).toHaveLength(1);
        const op = h.queued[0];
        expect(op.entityType).toBe('setting');
        expect(op.operationType).toBe('update');
        expect(op.entityId).toBe('550e8400-e29b-41d4-a716-446655440000');
        expect(op.mapId).toBeNull();
        expect(op.data).toEqual({ mapBadgeColors });
    });

    it('datamodel-13: colorUsage emits a per-map nested object ({ [mapName]: counts })', async () => {
        await logAtlasSetting({ colorUsage: { Alfa: { '#ff0000': 3 } } });

        expect(h.queued).toHaveLength(1);
        expect(h.queued[0].entityType).toBe('setting');
        expect(h.queued[0].data).toEqual({ colorUsage: { Alfa: { '#ff0000': 3 } } });
    });

    it('datamodel-14: customIcons emits the full registry list', async () => {
        const customIcons = [{ id: 'i1', name: 'Tank', type: 'image/png', createdAt: 1 }];
        await logAtlasSetting({ customIcons });

        expect(h.queued).toHaveLength(1);
        expect(h.queued[0].entityType).toBe('setting');
        expect(h.queued[0].data).toEqual({ customIcons });
    });

    it('falls back to the "atlas" sentinel entityId when the atlas has no id', async () => {
        h.atlas = {};
        await logAtlasSetting({ mapBadgeColors: { X: '#000000' } });
        expect(h.queued[0].entityId).toBe('atlas');
    });

    it('is offline-safe: no op is queued when operation logging is disabled', async () => {
        disableOperationLogging();
        await logAtlasSetting({ mapBadgeColors: { X: '#000000' } });
        expect(h.queued).toHaveLength(0);
    });
});

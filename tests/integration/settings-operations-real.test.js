// Path: tests/integration/settings-operations-real.test.js
// Covers settings.operations.js and the SETTING-op emit/drop invariant behind it.
//
// Invariant under test (bug d²): a LOCAL-only / per-client setting must NEVER enqueue
// a sync `setting` op. Syncing a per-client local key (e.g. 'lastActiveMap', 'mapOrder',
// 'schemaVersion') poisoned the whole flush — the backend rejects the non-UUID entityId
// (22P02) and that single op fails the ENTIRE batch, blocking all sync. The guard lives
// in logOperation: a SETTING op whose entityId is neither a valid UUID nor the 'atlas'
// sentinel is silently dropped before it can be enqueued.
//
// Conversely, the genuinely-synced app-state settings (mapBadgeColors / customIcons /
// colorUsage) DO emit a `setting` UPDATE op, scoped to the atlas UUID (or 'atlas'
// sentinel), with the documented data shape — exactly as sync-app-state-emit.test.js
// asserts for the wrapper logAtlasSetting.
//
// Two concerns, two mock graphs, isolated into separate describe blocks via dynamic
// import after vi.resetModules() — the image part stubs settings.operations.js's import
// graph; the emit part mocks the queue + repositories like sync-app-state-emit.test.js.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ===========================================================================
// PART A — settings.operations.js image fallback (§17.14)
// Mirrors settings-image-fallback.test.js and extends it with an edge case.
// ===========================================================================

const img = vi.hoisted(() => ({ images: new Map(), fetchImageBlob: vi.fn() }));

vi.mock('../../src/js/store/repositories/index.js', () => ({
    deleteImageCompat: async (id) => { img.images.delete(id); },
    getGridStyleCompat: vi.fn(),
    getImageCompat: async (id) => img.images.get(id) || null,
    getMapDataCompat: vi.fn(),
    getMapNotesCompat: vi.fn(),
    hasImageCompat: async (id) => img.images.has(id),
    saveImageCompat: async (id, b) => { img.images.set(id, b); },
    setGridStyleCompat: vi.fn(),
    setMapNotesCompat: vi.fn(),
    updateMapDataCompat: vi.fn(),
    // Used by the PART B graph (logAtlasSetting resolves the atlas id from here).
    getRepository: () => ({ getAtlas: async () => emit.atlas }),
}));
vi.mock('../../src/js/store/sync/image-sync.js', () => ({
    fetchImageBlob: (...a) => img.fetchImageBlob(...a),
}));
// Stub the rest of settings.operations.js's import graph so it loads in node.
vi.mock('../../src/js/catalog/catalog.constants.js', () => ({ CATALOG_ITEM_TYPES: {} }));
vi.mock('../../src/js/store/catalog.operations.js', () => ({ getCatalogLayers: vi.fn() }));
vi.mock('../../src/js/store/map.operations.js', () => ({ isCurrentMapLockedSync: () => false }));
vi.mock('../../src/js/store/services/map-resolver.service.js', () => ({ mapResolver: { resolveToId: (x) => x } }));
vi.mock('../../src/js/store/store-state-manager.js', () => ({ default: {} }));
vi.mock('../../src/js/store/sync/index.js', () => ({
    logGridStyleOperation: vi.fn(),
    logMapNotesOperation: vi.fn(),
    OperationType: { UPDATE: 'update' },
}));

import { getImage, storeImage, hasImage, removeImage } from '../../src/js/store/settings.operations.js';

const blob = () => new Blob([new Uint8Array([9])], { type: 'image/png' });

describe('settings.operations image multiuser fallback (§17.14)', () => {
    beforeEach(() => {
        img.images.clear();
        img.fetchImageBlob.mockReset();
    });

    it('getImage returns the local blob without hitting the backend', async () => {
        const b = blob();
        await storeImage('img-1', b);
        expect(await getImage('img-1')).toBe(b);
        expect(img.fetchImageBlob).not.toHaveBeenCalled();
    });

    it('getImage fetches from the backend and caches when missing locally', async () => {
        const remote = blob();
        img.fetchImageBlob.mockResolvedValue(remote);
        expect(await getImage('backend-img')).toBe(remote);
        expect(img.fetchImageBlob).toHaveBeenCalledWith('backend-img');
        // Cached now → a second render does not re-fetch.
        expect(await getImage('backend-img')).toBe(remote);
        expect(img.fetchImageBlob).toHaveBeenCalledTimes(1);
    });

    it('getImage returns null when neither local nor backend has it', async () => {
        img.fetchImageBlob.mockResolvedValue(null);
        expect(await getImage('ghost')).toBeNull();
    });

    // Edge: a backend fetch succeeds but the local cache write rejects (e.g. quota /
    // private-mode IndexedDB). getImage swallows the cache error (.catch(() => {})) and
    // still returns the remote blob — the render must not break on a cache failure.
    it('getImage returns the remote blob even if caching it locally throws', async () => {
        const remote = blob();
        img.fetchImageBlob.mockResolvedValue(remote);
        const repo = await import('../../src/js/store/repositories/index.js');
        const spy = vi.spyOn(repo, 'saveImageCompat').mockRejectedValueOnce(new Error('quota'));
        expect(await getImage('flaky-cache')).toBe(remote);
        spy.mockRestore();
    });

    it('hasImage / removeImage operate on the local cache', async () => {
        await storeImage('img-2', blob());
        expect(await hasImage('img-2')).toBe(true);
        await removeImage('img-2');
        expect(await hasImage('img-2')).toBe(false);
    });
});

// ===========================================================================
// PART B — the SETTING-op emit/drop invariant (bug d²)
// Exercises the real dispatcher (the authoritative point where a `setting` op is
// either enqueued or dropped). Mocks the queue + store-errors like
// sync-app-state-emit.test.js so we capture exactly what would be flushed.
// ===========================================================================

const emit = vi.hoisted(() => ({
    queued: [],
    atlas: { id: '550e8400-e29b-41d4-a716-446655440000' },
}));

vi.mock('../../src/js/store/sync/operation-queue.js', () => ({
    operationQueue: {
        enqueue: vi.fn(async (op) => { emit.queued.push(op); }),
        enqueueAll: vi.fn(async (ops) => { emit.queued.push(...ops); }),
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
    logSettingOperation,
    logAtlasSetting,
    logMapNotesOperation,
    EntityType,
    OperationType,
} from '../../src/js/store/sync/operation-dispatcher.js';

const ATLAS_UUID = '550e8400-e29b-41d4-a716-446655440000';

describe('SETTING-op local-vs-synced invariant (bug d²)', () => {
    beforeEach(() => {
        emit.queued = [];
        emit.atlas = { id: ATLAS_UUID };
        localStorageMock.clear();
        enableOperationLogging();
    });

    // --- LOCAL-only settings must NOT enqueue a sync op -------------------------
    // These per-client keys carry a non-UUID, non-'atlas' entityId. If they reached
    // the queue the backend would reject the id (22P02) and poison the whole flush.

    it.each([
        ['lastActiveMap', 'Principal'],
        ['mapOrder', ['Principal', 'Alfa']],
        ['schemaVersion', '2.2'],
    ])('LOCAL key %s does NOT enqueue a setting op (dropped before enqueue)', async (key, value) => {
        // Simulate a (mistaken) attempt to log a per-client local setting as a SETTING
        // op keyed by its local key — the guard in logOperation must drop it.
        await logOperation(EntityType.SETTING, OperationType.UPDATE, key, null, { [key]: value });
        expect(emit.queued).toHaveLength(0);
    });

    it('logSettingOperation with a non-UUID local entityId is dropped (no enqueue)', async () => {
        await logSettingOperation(OperationType.UPDATE, 'lastActiveMap', { lastActiveMap: 'Principal' });
        expect(emit.queued).toHaveLength(0);
    });

    it('a map-notes op for a NON-synced (non-UUID) local map id is skipped', async () => {
        // createMapSettingLogger guards the same class of bug for per-map settings:
        // the local "Principal" map id is its name, not a UUID → no op.
        await logMapNotesOperation(OperationType.UPDATE, 'Principal', { title: 'x' });
        expect(emit.queued).toHaveLength(0);
    });

    // --- Synced app-state settings DO enqueue, scoped to the atlas UUID ---------

    it('mapBadgeColors emits a setting UPDATE op scoped to the atlas UUID', async () => {
        const mapBadgeColors = { Alfa: '#3b82f6', Bravo: '#f59e0b' };
        await logAtlasSetting({ mapBadgeColors });

        expect(emit.queued).toHaveLength(1);
        const op = emit.queued[0];
        expect(op.entityType).toBe('setting');
        expect(op.operationType).toBe('update');
        expect(op.entityId).toBe(ATLAS_UUID);
        expect(op.mapId).toBeNull();
        expect(op.data).toEqual({ mapBadgeColors });
    });

    it('customIcons emits the full registry list as a setting op', async () => {
        const customIcons = [{ id: 'i1', name: 'Tank', type: 'image/png', createdAt: 1 }];
        await logAtlasSetting({ customIcons });

        expect(emit.queued).toHaveLength(1);
        expect(emit.queued[0].entityType).toBe('setting');
        expect(emit.queued[0].entityId).toBe(ATLAS_UUID);
        expect(emit.queued[0].data).toEqual({ customIcons });
    });

    it('colorUsage emits a per-map nested object scoped to the atlas UUID', async () => {
        await logAtlasSetting({ colorUsage: { Alfa: { '#ff0000': 3 } } });

        expect(emit.queued).toHaveLength(1);
        expect(emit.queued[0].entityType).toBe('setting');
        expect(emit.queued[0].entityId).toBe(ATLAS_UUID);
        expect(emit.queued[0].data).toEqual({ colorUsage: { Alfa: { '#ff0000': 3 } } });
    });

    it('falls back to the "atlas" sentinel entityId when the atlas has no id', async () => {
        emit.atlas = {};
        await logAtlasSetting({ mapBadgeColors: { X: '#000000' } });
        expect(emit.queued).toHaveLength(1);
        expect(emit.queued[0].entityId).toBe('atlas');
    });

    it('the "atlas" sentinel IS allowed past the guard (it is not a local key)', async () => {
        await logSettingOperation(OperationType.UPDATE, 'atlas', { mapBadgeColors: { X: '#000' } });
        expect(emit.queued).toHaveLength(1);
        expect(emit.queued[0].entityId).toBe('atlas');
    });

    it('is offline-safe: nothing is queued for a synced setting while logging is disabled', async () => {
        disableOperationLogging();
        await logAtlasSetting({ mapBadgeColors: { X: '#000000' } });
        expect(emit.queued).toHaveLength(0);
    });
});

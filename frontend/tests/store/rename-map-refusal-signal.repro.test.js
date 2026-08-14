/**
 * @fileoverview Regression: `renameMap` used to resolve to `undefined` on success AND on both
 * refusals (missing permission, locked map), so no caller could tell them apart. The locked
 * branch was worse still: it only wrote a `console.warn`, so nothing was emitted on the bus
 * either. The damage lands in the caller (`MapManager.renameMap`), which reported success and
 * then pointed the current map at a name that was never created.
 *
 * Root cause: a refusal that returns the same value as a success is not a signal.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getEmptyMapData } from '../../src/js/store/repository.utils.js';

const { mockMapManager, mockLockedMaps, mockMemoryStore, mockSettings, mockMaps } = vi.hoisted(() => ({
    mockMapManager: {
        getCurrentMapName: vi.fn(() => 'TestMap'),
        renameMapInMemory: vi.fn(),
        setCurrentMap: vi.fn(async () => {})
    },
    mockLockedMaps: { value: new Set() },
    mockMemoryStore: {
        get lockedMaps() { return mockLockedMaps.value; },
        set lockedMaps(v) { mockLockedMaps.value = v; },
        currentMap: 'TestMap'
    },
    mockSettings: { value: {} },
    mockMaps: { value: {} }
}));

vi.mock('../../src/js/store/store-errors.js', () => ({
    StoreErrorEvents: {
        STORE_OPERATION_BLOCKED: 'store:operationBlocked',
        STORE_PERSIST_ERROR: 'store:persistError',
        STORE_SYNC_ERROR: 'store:syncError'
    },
    emitStoreError: vi.fn()
}));

vi.mock('../../src/js/store/sync/index.js', () => ({
    logMapOperation: vi.fn(),
    logMapPositionOperation: vi.fn(),
    logBaseLayerOperation: vi.fn(),
    logAtlasSetting: vi.fn(),
    isOperationLoggingEnabled: vi.fn(() => false),
    OperationType: { CREATE: 'CREATE', UPDATE: 'UPDATE', DELETE: 'DELETE' }
}));

vi.mock('../../src/js/store/sync/permission-guard.js', () => ({
    checkPermission: vi.fn(() => ({ allowed: true })),
    GuardAction: { UPDATE_MAP: 'EDIT' }
}));

vi.mock('../../src/js/store/sync/sync-metadata.js', () => ({
    createSyncMetadata: vi.fn(() => ({ createdAt: 1, updatedAt: 1, version: 1 })),
    touchSyncMetadata: vi.fn((sync) => ({ ...sync, version: (sync?.version || 0) + 1 }))
}));

vi.mock('../../src/js/store/repositories/index.js', () => ({
    getMapDataCompat: vi.fn(async (mapName) => mockMaps.value[mapName] || getEmptyMapData()),
    updateMapDataCompat: vi.fn(async (mapName, data) => { mockMaps.value[mapName] = data; }),
    createMapCompat: vi.fn(async () => ({})),
    deleteMapCompat: vi.fn(async (mapName) => { delete mockMaps.value[mapName]; }),
    renameMapCompat: vi.fn(async (oldName, newName) => {
        mockMaps.value[newName] = mockMaps.value[oldName];
        delete mockMaps.value[oldName];
    }),
    getAllMapKeysCompat: vi.fn(async () => Object.keys(mockMaps.value)),
    getSettingCompat: vi.fn(async (key) => mockSettings.value[key] ?? null),
    setSettingCompat: vi.fn(async (key, value) => { mockSettings.value[key] = value; }),
    setMapNotesCompat: vi.fn(async () => {}),
    getRepository: vi.fn(() => ({ getAllMaps: vi.fn(async () => []) }))
}));

vi.mock('../../src/js/store/store-state-manager.js', () => ({ default: mockMapManager }));
vi.mock('../../src/js/store/memory-store.js', () => ({ memoryStore: mockMemoryStore }));

vi.mock('../../src/js/store/services/map-resolver.service.js', () => ({
    mapResolver: {
        registerMap: vi.fn(),
        unregisterMapById: vi.fn(),
        renameMap: vi.fn(),
        resolveToId: vi.fn((name) => `uuid-${name}`),
        resolveToName: vi.fn((idOrName) => idOrName)
    }
}));

vi.mock('../../src/js/config.js', () => ({
    default: { basemaps: {}, getValidBasemapFallback: vi.fn(() => 'osm') }
}));

vi.mock('../../src/js/utilities/uuid.js', () => ({
    generateUUID: vi.fn(() => 'generated-uuid'),
    isValidUUID: vi.fn((v) => typeof v === 'string' && v.startsWith('uuid-'))
}));

vi.mock('../../src/js/events', () => ({
    EventTypes: { MAP_LOCK_CHANGED: 'map:lockChanged', LAYERS_CHANGED: 'layers:changed' }
}));

import { renameMap, setMapDependencies } from '../../src/js/store/map.operations.js';
import { checkPermission } from '../../src/js/store/sync/permission-guard.js';
import { emitStoreError } from '../../src/js/store/store-errors.js';

beforeEach(() => {
    vi.clearAllMocks();
    mockLockedMaps.value = new Set();
    mockSettings.value = {};
    mockMaps.value = { 'TestMap': { ...getEmptyMapData(), id: 'uuid-TestMap' } };
    mockMapManager.getCurrentMapName.mockReturnValue('TestMap');
    checkPermission.mockReturnValue({ allowed: true });

    setMapDependencies({
        eventBus: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
        groupManager: { loadGroupsToMemory: vi.fn(async () => {}), clearMapGroups: vi.fn(async () => {}) },
        layerManager: { loadLayersToMemory: vi.fn(async () => {}) }
    });
});

describe('renameMap — refusal is distinguishable from success', () => {
    it('returns true when the rename actually happened', async () => {
        const result = await renameMap('TestMap', 'RenamedMap');

        expect(result).toBe(true);
        expect(mockMaps.value['RenamedMap']).toBeDefined();
        expect(mockMaps.value['TestMap']).toBeUndefined();
    });

    it('returns false and emits STORE_OPERATION_BLOCKED(map_locked) on a locked map', async () => {
        mockLockedMaps.value = new Set(['TestMap']);

        const result = await renameMap('TestMap', 'NewName');

        expect(result).toBe(false);
        expect(emitStoreError).toHaveBeenCalledWith(
            'store:operationBlocked',
            expect.objectContaining({ operation: 'renameMap', reason: 'map_locked' })
        );
        // And the refusal really refused.
        expect(mockMaps.value['TestMap']).toBeDefined();
        expect(mockMaps.value['NewName']).toBeUndefined();
        expect(mockMapManager.renameMapInMemory).not.toHaveBeenCalled();
    });

    it('returns false when permission is denied', async () => {
        checkPermission.mockReturnValue({ allowed: false, reason: 'NO_EDIT' });

        const result = await renameMap('TestMap', 'NewName');

        expect(result).toBe(false);
        expect(emitStoreError).toHaveBeenCalledWith(
            'store:operationBlocked',
            expect.objectContaining({ operation: 'renameMap', reason: 'NO_EDIT' })
        );
        expect(mockMaps.value['NewName']).toBeUndefined();
    });

    // Edge case: a map locked under a name OTHER than the one being renamed must not be
    // mistaken for a refusal — the lock is keyed by the OLD name, never the new one.
    it('does not refuse when the lock belongs to a different map', async () => {
        mockLockedMaps.value = new Set(['OtherMap', 'RenamedMap']);

        const result = await renameMap('TestMap', 'RenamedMap');

        expect(result).toBe(true);
        expect(mockMaps.value['RenamedMap']).toBeDefined();
    });
});

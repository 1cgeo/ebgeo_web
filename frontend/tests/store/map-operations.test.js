import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getEmptyMapData } from '../../src/js/store/repository.utils.js';
import { mapBadgeColorForName } from '../../src/js/store/map-badge-colors.js';

// ============================================================================
// Hoisted shared state
// ============================================================================

const { mockMapManager, mockLockedMaps, mockMemoryStore, mockSettings, mockMaps, mockRepoMaps } = vi.hoisted(() => {
    return {
        mockMapManager: {
            getCurrentMapName: vi.fn(() => 'TestMap'),
            getCurrentMapId: vi.fn(() => 'map-uuid-123'),
            getCurrentMapInfo: vi.fn(() => ({ name: 'TestMap', id: 'map-uuid-123' })),
            addMapToMemory: vi.fn(),
            processMapColors: vi.fn(async () => {}),
            removeMapFromMemory: vi.fn(async () => {}),
            renameMapInMemory: vi.fn(),
            setCurrentMap: vi.fn(async () => {}),
            // No undoLastAction/redoLastAction here on purpose: map.operations.js no
            // longer forwards to the state manager (see undo-redo-lock-guard.test.js).
            getFrequentColors: vi.fn(() => [])
        },
        mockLockedMaps: { value: new Set() },
        mockMemoryStore: {
            get lockedMaps() { return mockLockedMaps.value; },
            set lockedMaps(v) { mockLockedMaps.value = v; },
            currentMap: 'TestMap'
        },
        mockSettings: { value: {} },
        mockMaps: { value: {} },
        mockRepoMaps: { value: [] }
    };
});

// ============================================================================
// Mock dependencies
// ============================================================================

vi.mock('../../src/js/store/store-errors.js', () => ({
    StoreErrorEvents: {
        STORE_OPERATION_BLOCKED: 'store:operationBlocked',
        STORE_PERSIST_ERROR: 'store:persistError'
    },
    emitStoreError: vi.fn()
}));

vi.mock('../../src/js/store/sync/index.js', () => ({
    logMapOperation: vi.fn(),
    logMapPositionOperation: vi.fn(),
    logBaseLayerOperation: vi.fn(),
    logAtlasSetting: vi.fn(),
    // Sync OFF in unit tests → addMap keeps the name-keyed storage these tests assert.
    isOperationLoggingEnabled: vi.fn(() => false),
    OperationType: { CREATE: 'CREATE', UPDATE: 'UPDATE', DELETE: 'DELETE' }
}));

vi.mock('../../src/js/store/sync/permission-guard.js', () => ({
    checkPermission: vi.fn(() => ({ allowed: true })),
    GuardAction: {
        CREATE_MAP: 'EDIT',
        UPDATE_MAP: 'EDIT',
        DELETE_MAP: 'DELETE',
        LOCK_MAP: 'LOCK_MAPS'
    }
}));

vi.mock('../../src/js/store/sync/sync-metadata.js', () => ({
    createSyncMetadata: vi.fn(() => ({ createdAt: Date.now(), updatedAt: Date.now(), version: 1 })),
    touchSyncMetadata: vi.fn((sync) => ({ ...sync, updatedAt: Date.now(), version: (sync.version || 0) + 1 }))
}));

vi.mock('../../src/js/store/repositories/index.js', () => ({
    getMapDataCompat: vi.fn(async (mapName) => {
        return mockMaps.value[mapName] || getEmptyMapData();
    }),
    updateMapDataCompat: vi.fn(async (mapName, data) => {
        mockMaps.value[mapName] = data;
    }),
    createMapCompat: vi.fn(async (mapName, data) => {
        const mapData = data || getEmptyMapData();
        // Mirror the real createMapCompat: a fresh map (no caller data) takes the
        // requested name, not the getEmptyMapData() placeholder.
        if (!data || !mapData.name) mapData.name = mapName;
        mapData.id = `uuid-${mapName}`;
        mockMaps.value[mapName] = mapData;
        return mapData;
    }),
    deleteMapCompat: vi.fn(async (mapName) => {
        delete mockMaps.value[mapName];
    }),
    renameMapCompat: vi.fn(async (oldName, newName) => {
        mockMaps.value[newName] = mockMaps.value[oldName];
        delete mockMaps.value[oldName];
    }),
    getAllMapKeysCompat: vi.fn(async () => Object.keys(mockMaps.value)),
    getSettingCompat: vi.fn(async (key) => mockSettings.value[key] ?? null),
    setSettingCompat: vi.fn(async (key, value) => { mockSettings.value[key] = value; }),
    setMapNotesCompat: vi.fn(async () => {}),
    getRepository: vi.fn(() => ({ getAllMaps: vi.fn(async () => mockRepoMaps.value) }))
}));

vi.mock('../../src/js/store/store-state-manager.js', () => ({
    default: mockMapManager
}));

vi.mock('../../src/js/store/memory-store.js', () => ({
    memoryStore: mockMemoryStore
}));

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
    default: {
        basemaps: {
            'carta-topografica': { enabled: true },
            'osm': { enabled: true }
        },
        getValidBasemapFallback: vi.fn(() => 'carta-topografica')
    }
}));

vi.mock('../../src/js/utilities/uuid.js', () => ({
    generateUUID: vi.fn(() => 'generated-uuid-' + Math.random().toString(36).slice(2, 8)),
    isValidUUID: vi.fn((v) => v?.startsWith('uuid-') || v?.startsWith('generated-uuid-'))
}));

vi.mock('../../src/js/events', () => ({
    EventTypes: {
        MAP_LOCK_CHANGED: 'map:lockChanged',
        LAYERS_CHANGED: 'layers:changed',
        MAP_CREATED: 'map:created'
    }
}));

// ============================================================================
// Imports (after mocks)
// ============================================================================

import {
    getAllMapNamesStore,
    getMapOrder,
    setMapOrder,
    addMap,
    removeMap,
    renameMap,
    setCurrentMap,
    activateAtlasInitialMap,
    hasAnyMapFeatures,
    getCurrentMapName,
    getCurrentMapNameSync,
    getCurrentMapIdSync,
    getCurrentMapInfoSync,
    getCurrentBaseLayer,
    setBaseLayer,
    updateMapPosition,
    getMapPosition,
    hasMapSavedPosition,
    clearMapPosition,
    isMapLocked,
    isCurrentMapLockedSync,
    toggleMapLock,
    setBriefingLockOverride,
    getMapBadgeColor,
    removeMapBadgeColor,
    getAllMapBadgeColors,
    getOrderedMapBadgeColors,
    setMapDependencies
} from '../../src/js/store/map.operations.js';

import { checkPermission } from '../../src/js/store/sync/permission-guard.js';
import { emitStoreError } from '../../src/js/store/store-errors.js';
import { logMapOperation, logAtlasSetting } from '../../src/js/store/sync/index.js';
import { setSettingCompat } from '../../src/js/store/repositories/index.js';

// ============================================================================
// Setup
// ============================================================================

const mockEventBus = {
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn()
};

const mockGroupManager = {
    loadGroupsToMemory: vi.fn(async () => {}),
    clearMapGroups: vi.fn(async () => {})
};

const mockLayerManager = {
    loadLayersToMemory: vi.fn(async () => {})
};

beforeEach(() => {
    vi.clearAllMocks();
    mockLockedMaps.value = new Set();
    mockMemoryStore.currentMap = 'TestMap';
    mockSettings.value = {};
    mockMaps.value = {
        'TestMap': { ...getEmptyMapData(), id: 'uuid-TestMap' }
    };
    mockRepoMaps.value = [];
    mockMapManager.getCurrentMapName.mockReturnValue('TestMap');
    checkPermission.mockReturnValue({ allowed: true });

    setMapDependencies({
        eventBus: mockEventBus,
        groupManager: mockGroupManager,
        layerManager: mockLayerManager
    });
});

// ============================================================================
// activateAtlasInitialMap — bug B regression
// ============================================================================

describe('activateAtlasInitialMap (bug B)', () => {
    // Opening a server atlas pulls its maps but leaves the app on the local default
    // "Principal" map; the user could not see or sync onto the shared content. Atlas
    // maps carry a UUID id, the local default does not — so we activate the UUID one.
    it('activates the atlas map (UUID id), not the local default "Principal"', async () => {
        mockRepoMaps.value = [
            { name: 'Principal' },                       // local default — no UUID id
            { id: 'uuid-tatico', name: 'Mapa Tático' },  // atlas map — UUID id
        ];

        const activated = await activateAtlasInitialMap();

        expect(activated).toBe('Mapa Tático');
        expect(mockMapManager.setCurrentMap).toHaveBeenCalledWith('Mapa Tático');
    });

    it('creates and activates a first atlas map when the atlas has no UUID-keyed map', async () => {
        // A brand-new EMPTY atlas has only the local default 'Principal' (no UUID). Rather
        // than stranding the user on the un-syncable local map, activateAtlasInitialMap now
        // creates a first atlas map (UUID-keyed) and switches to it (§item3).
        mockRepoMaps.value = [{ name: 'Principal' }];

        const activated = await activateAtlasInitialMap();

        expect(activated).toBeTruthy();
        expect(mockMapManager.setCurrentMap).toHaveBeenCalled();
    });

    it('returns null when no UUID map exists and creation is blocked (e.g. viewer)', async () => {
        mockRepoMaps.value = [{ name: 'Principal' }];
        checkPermission.mockReturnValue({ allowed: false, reason: 'NO_EDIT' });

        const activated = await activateAtlasInitialMap();

        expect(activated).toBeNull();
        expect(mockMapManager.setCurrentMap).not.toHaveBeenCalled();
    });

    it('accepts a Map-shaped getAllMaps() return', async () => {
        mockRepoMaps.value = new Map([
            ['uuid-tatico', { id: 'uuid-tatico', name: 'Mapa Tático' }],
        ]);

        const activated = await activateAtlasInitialMap();

        expect(activated).toBe('Mapa Tático');
        expect(mockMapManager.setCurrentMap).toHaveBeenCalledWith('Mapa Tático');
    });
});

// ============================================================================
// MAP CRUD
// ============================================================================

describe('getAllMapNamesStore', () => {
    it('returns maps in saved order', async () => {
        mockMaps.value = {
            'MapA': getEmptyMapData(),
            'MapB': getEmptyMapData(),
            'MapC': getEmptyMapData()
        };
        mockSettings.value.mapOrder = ['MapC', 'MapA', 'MapB'];

        const names = await getAllMapNamesStore();

        expect(names).toEqual(['MapC', 'MapA', 'MapB']);
    });

    it('appends maps not in saved order', async () => {
        mockMaps.value = {
            'MapA': getEmptyMapData(),
            'MapB': getEmptyMapData(),
            'MapNew': getEmptyMapData()
        };
        mockSettings.value.mapOrder = ['MapB', 'MapA'];

        const names = await getAllMapNamesStore();

        expect(names).toEqual(['MapB', 'MapA', 'MapNew']);
    });

    it('returns all maps when no saved order exists', async () => {
        mockMaps.value = {
            'MapA': getEmptyMapData(),
            'MapB': getEmptyMapData()
        };

        const names = await getAllMapNamesStore();

        expect(names).toEqual(['MapA', 'MapB']);
    });
});

describe('hasAnyMapFeatures', () => {
    it('returns false when no map has features', async () => {
        mockMaps.value = { 'MapA': getEmptyMapData(), 'MapB': getEmptyMapData() };
        expect(await hasAnyMapFeatures()).toBe(false);
    });

    it('returns true when any map has at least one feature', async () => {
        const withFeature = getEmptyMapData();
        withFeature.features.points.push({ properties: { id: 'p1' } });
        mockMaps.value = { 'MapA': getEmptyMapData(), 'MapB': withFeature };
        expect(await hasAnyMapFeatures()).toBe(true);
    });
});

describe('addMap', () => {
    it('creates a new map and stores it in repository', async () => {
        const result = await addMap('NewMap');

        expect(result).toBeDefined();
        expect(result.id).toBe('uuid-NewMap');
        // Verify the map was actually stored
        expect(mockMaps.value['NewMap']).toBeDefined();
        expect(mockMaps.value['NewMap'].id).toBe('uuid-NewMap');
        expect(mockMapManager.addMapToMemory).toHaveBeenCalledWith('NewMap');
    });

    it('logs CREATE operation with map ID and data', async () => {
        await addMap('NewMap');

        expect(logMapOperation).toHaveBeenCalledWith(
            'CREATE',
            'uuid-NewMap',
            expect.objectContaining({ id: 'uuid-NewMap' })
        );
    });

    it('blocks when permission denied - no map created', async () => {
        checkPermission.mockReturnValue({ allowed: false, reason: 'NO_EDIT' });
        const mapCountBefore = Object.keys(mockMaps.value).length;

        const result = await addMap('NewMap');

        expect(result).toBeNull();
        // Verify nothing was stored
        expect(Object.keys(mockMaps.value).length).toBe(mapCountBefore);
        expect(emitStoreError).toHaveBeenCalledWith(
            'store:operationBlocked',
            expect.objectContaining({ operation: 'addMap', reason: 'NO_EDIT' })
        );
    });

    it('stores notes when provided', async () => {
        const { setMapNotesCompat } = await import('../../src/js/store/repositories/index.js');

        await addMap('NewMap', null, null, { title: 'Test', description: 'Notes' });

        expect(setMapNotesCompat).toHaveBeenCalledWith('NewMap', { title: 'Test', description: 'Notes' });
    });

    it('does NOT store notes when notes are empty', async () => {
        const { setMapNotesCompat } = await import('../../src/js/store/repositories/index.js');

        await addMap('NewMap', null, null, {});

        expect(setMapNotesCompat).not.toHaveBeenCalled();
    });
});

describe('removeMap', () => {
    it('removes a map from storage and memory', async () => {
        mockMaps.value = {
            'TestMap': { ...getEmptyMapData(), id: 'uuid-TestMap' },
            'OtherMap': { ...getEmptyMapData(), id: 'uuid-OtherMap' }
        };

        const result = await removeMap('OtherMap');

        expect(result.success).toBe(true);
        expect(result.wasCurrentMap).toBe(false);
        expect(result.remainingMapsCount).toBe(1);
        // Verify storage was actually cleaned
        expect(mockMaps.value['OtherMap']).toBeUndefined();
        expect(mockMaps.value['TestMap']).toBeDefined();
        expect(mockMapManager.removeMapFromMemory).toHaveBeenCalledWith('OtherMap');
    });

    it('prevents deleting the last map - storage untouched', async () => {
        mockMaps.value = {
            'TestMap': { ...getEmptyMapData(), id: 'uuid-TestMap' }
        };

        const result = await removeMap('TestMap');

        expect(result.success).toBe(false);
        expect(result.reason).toBe('LAST_MAP');
        // Verify map was NOT removed from storage
        expect(mockMaps.value['TestMap']).toBeDefined();
    });

    it('switches to first remaining map when removing current', async () => {
        mockMaps.value = {
            'TestMap': { ...getEmptyMapData(), id: 'uuid-TestMap' },
            'OtherMap': { ...getEmptyMapData(), id: 'uuid-OtherMap' }
        };

        const result = await removeMap('TestMap');

        expect(result.success).toBe(true);
        expect(result.wasCurrentMap).toBe(true);
        expect(result.newCurrentMap).toBe('OtherMap');
    });

    it('clears groups for removed map', async () => {
        mockMaps.value = {
            'TestMap': { ...getEmptyMapData(), id: 'uuid-TestMap' },
            'OtherMap': { ...getEmptyMapData(), id: 'uuid-OtherMap' }
        };

        await removeMap('OtherMap');

        expect(mockGroupManager.clearMapGroups).toHaveBeenCalledWith('OtherMap');
    });

    it('returns MAP_NOT_FOUND for nonexistent map', async () => {
        mockMaps.value = {
            'TestMap': { ...getEmptyMapData(), id: 'uuid-TestMap' },
            'OtherMap': { ...getEmptyMapData(), id: 'uuid-OtherMap' }
        };

        // Override getMapDataCompat to return empty for specific map
        const { getMapDataCompat } = await import('../../src/js/store/repositories/index.js');
        getMapDataCompat.mockResolvedValueOnce({});

        const result = await removeMap('Ghost');

        expect(result.success).toBe(false);
        expect(result.reason).toBe('MAP_NOT_FOUND');
    });

    it('blocks when permission denied', async () => {
        checkPermission.mockReturnValue({ allowed: false, reason: 'NO_DELETE' });

        const result = await removeMap('TestMap');

        expect(result).toEqual({ success: false, reason: 'PERMISSION_DENIED' });
    });

    it('removes badge color for deleted map', async () => {
        mockMaps.value = {
            'TestMap': { ...getEmptyMapData(), id: 'uuid-TestMap' },
            'OtherMap': { ...getEmptyMapData(), id: 'uuid-OtherMap' }
        };
        mockSettings.value.mapBadgeColors = { TestMap: '#3b82f6', OtherMap: '#f59e0b' };

        await removeMap('OtherMap');

        expect(setSettingCompat).toHaveBeenCalledWith(
            'mapBadgeColors',
            expect.not.objectContaining({ OtherMap: expect.anything() })
        );
    });
});

describe('renameMap', () => {
    it('renames map in storage: old key gone, new key present', async () => {
        await renameMap('TestMap', 'RenamedMap');

        // Storage should have new name, not old
        expect(mockMaps.value['TestMap']).toBeUndefined();
        expect(mockMaps.value['RenamedMap']).toBeDefined();
        expect(mockMapManager.renameMapInMemory).toHaveBeenCalledWith('TestMap', 'RenamedMap');
    });

    it('updates map order: old name replaced with new name', async () => {
        mockSettings.value.mapOrder = ['TestMap', 'OtherMap'];

        await renameMap('TestMap', 'RenamedMap');

        // Verify the actual stored order, not just the mock call
        expect(mockSettings.value.mapOrder).toEqual(['RenamedMap', 'OtherMap']);
    });

    it('transfers badge color: old key removed, new key has same color', async () => {
        mockSettings.value.mapBadgeColors = { TestMap: '#3b82f6', Other: '#f59e0b' };

        await renameMap('TestMap', 'RenamedMap');

        const colors = mockSettings.value.mapBadgeColors;
        expect(colors.TestMap).toBeUndefined();
        expect(colors.RenamedMap).toBe('#3b82f6');
        expect(colors.Other).toBe('#f59e0b');
    });

    it('blocks rename on locked map - storage unchanged', async () => {
        mockLockedMaps.value = new Set(['TestMap']);

        await renameMap('TestMap', 'NewName');

        // Map should still exist under old name
        expect(mockMaps.value['TestMap']).toBeDefined();
        expect(mockMaps.value['NewName']).toBeUndefined();
    });

    it('blocks when permission denied', async () => {
        checkPermission.mockReturnValue({ allowed: false, reason: 'NO_EDIT' });

        await renameMap('TestMap', 'NewName');

        expect(mockMaps.value['TestMap']).toBeDefined();
        expect(mockMaps.value['NewName']).toBeUndefined();
        expect(emitStoreError).toHaveBeenCalledWith(
            'store:operationBlocked',
            expect.objectContaining({ operation: 'renameMap', reason: 'NO_EDIT' })
        );
    });
});

describe('setCurrentMap', () => {
    it('sets current map and loads groups and layers', async () => {
        await setCurrentMap('OtherMap');

        expect(mockMapManager.setCurrentMap).toHaveBeenCalledWith('OtherMap');
        expect(mockGroupManager.loadGroupsToMemory).toHaveBeenCalledWith('OtherMap');
        expect(mockLayerManager.loadLayersToMemory).toHaveBeenCalledWith('OtherMap');
    });

    it('emits MAP_LOCK_CHANGED event', async () => {
        await setCurrentMap('OtherMap');

        expect(mockEventBus.emit).toHaveBeenCalledWith(
            'map:lockChanged',
            expect.objectContaining({ mapName: 'OtherMap' })
        );
    });

    it('emits locked=true for locked map', async () => {
        mockLockedMaps.value = new Set(['LockedMap']);

        await setCurrentMap('LockedMap');

        expect(mockEventBus.emit).toHaveBeenCalledWith(
            'map:lockChanged',
            { mapName: 'LockedMap', locked: true }
        );
    });
});

// ============================================================================
// MAP GETTERS
// ============================================================================

describe('getCurrentMapName', () => {
    it('returns from setting', async () => {
        mockSettings.value.lastActiveMap = 'SavedMap';
        const name = await getCurrentMapName();
        expect(name).toBe('SavedMap');
    });
});

describe('getCurrentMapNameSync', () => {
    it('returns from mapManager', () => {
        expect(getCurrentMapNameSync()).toBe('TestMap');
    });
});

describe('getCurrentMapIdSync', () => {
    it('returns from mapManager', () => {
        expect(getCurrentMapIdSync()).toBe('map-uuid-123');
    });
});

describe('getCurrentMapInfoSync', () => {
    it('returns name and id', () => {
        const info = getCurrentMapInfoSync();
        expect(info).toEqual({ name: 'TestMap', id: 'map-uuid-123' });
    });
});

// ============================================================================
// MAP LOCK
// ============================================================================

describe('isCurrentMapLockedSync', () => {
    it('returns false when unlocked', () => {
        expect(isCurrentMapLockedSync()).toBe(false);
    });

    it('returns true when map is in locked set', () => {
        mockLockedMaps.value = new Set(['TestMap']);
        expect(isCurrentMapLockedSync()).toBe(true);
    });
});

describe('setBriefingLockOverride', () => {
    it('makes isCurrentMapLockedSync return true', () => {
        setBriefingLockOverride(true);
        expect(isCurrentMapLockedSync()).toBe(true);
    });

    it('emits MAP_LOCK_CHANGED', () => {
        setBriefingLockOverride(true);
        expect(mockEventBus.emit).toHaveBeenCalledWith(
            'map:lockChanged',
            expect.objectContaining({ locked: true })
        );
    });

    it('restores normal behavior when deactivated', () => {
        setBriefingLockOverride(true);
        expect(isCurrentMapLockedSync()).toBe(true);
        setBriefingLockOverride(false);
        expect(isCurrentMapLockedSync()).toBe(false);
    });
});

describe('toggleMapLock', () => {
    it('toggles lock state from unlocked to locked', async () => {
        const newState = await toggleMapLock();

        expect(newState).toBe(true);
        expect(mockLockedMaps.value.has('TestMap')).toBe(true);
        expect(mockEventBus.emit).toHaveBeenCalledWith(
            'map:lockChanged',
            { mapName: 'TestMap', locked: true }
        );
    });

    it('toggles lock state from locked to unlocked', async () => {
        // First, set the map as locked
        mockSettings.value['mapLocked_TestMap'] = true;
        mockLockedMaps.value = new Set(['TestMap']);

        const newState = await toggleMapLock();

        expect(newState).toBe(false);
        expect(mockLockedMaps.value.has('TestMap')).toBe(false);
    });

    it('blocks when permission denied', async () => {
        checkPermission.mockReturnValue({ allowed: false, reason: 'NO_LOCK' });

        const result = await toggleMapLock();

        expect(result).toBeNull();
        expect(emitStoreError).toHaveBeenCalled();
    });
});

describe('isMapLocked', () => {
    it('returns lock state from settings', async () => {
        mockSettings.value['mapLocked_TestMap'] = true;

        const locked = await isMapLocked('TestMap');

        expect(locked).toBe(true);
    });

    it('returns false when no setting exists', async () => {
        const locked = await isMapLocked('TestMap');
        expect(locked).toBe(false);
    });
});

// ============================================================================
// BASE LAYER
// ============================================================================

describe('getCurrentBaseLayer', () => {
    it('returns base layer for map', async () => {
        mockMaps.value.TestMap.baseLayer = 'osm';

        const bl = await getCurrentBaseLayer();

        expect(bl).toBe('osm');
    });
});

describe('setBaseLayer', () => {
    it('sets base layer', async () => {
        const { updateMapDataCompat } = await import('../../src/js/store/repositories/index.js');

        await setBaseLayer('osm');

        expect(updateMapDataCompat).toHaveBeenCalledWith(
            'TestMap',
            expect.objectContaining({ baseLayer: 'osm' })
        );
    });

    it('blocks on locked map', async () => {
        mockLockedMaps.value = new Set(['TestMap']);
        const { updateMapDataCompat } = await import('../../src/js/store/repositories/index.js');

        await setBaseLayer('osm');

        expect(updateMapDataCompat).not.toHaveBeenCalled();
    });
});

// ============================================================================
// MAP POSITION
// ============================================================================

describe('updateMapPosition', () => {
    it('saves position with sync metadata', async () => {
        const { updateMapDataCompat } = await import('../../src/js/store/repositories/index.js');

        await updateMapPosition(-22.9, -43.17, 12, 0, 0);

        expect(updateMapDataCompat).toHaveBeenCalledWith(
            'TestMap',
            expect.objectContaining({
                center_lat: -22.9,
                center_long: -43.17,
                zoom: 12,
                bearing: 0,
                pitch: 0,
                savedPosition: expect.objectContaining({
                    center_lat: -22.9,
                    center_long: -43.17,
                    zoom: 12
                })
            })
        );
    });

    it('blocks on locked map', async () => {
        mockLockedMaps.value = new Set(['TestMap']);
        const { updateMapDataCompat } = await import('../../src/js/store/repositories/index.js');

        await updateMapPosition(-22.9, -43.17, 12, 0, 0);

        expect(updateMapDataCompat).not.toHaveBeenCalled();
    });
});

describe('getMapPosition', () => {
    it('returns position data', async () => {
        mockMaps.value.TestMap.center_lat = -22.9;
        mockMaps.value.TestMap.center_long = -43.17;
        mockMaps.value.TestMap.zoom = 12;
        mockMaps.value.TestMap.bearing = 45;
        mockMaps.value.TestMap.pitch = 30;

        const pos = await getMapPosition('TestMap');

        expect(pos).toEqual({
            center_lat: -22.9,
            center_long: -43.17,
            zoom: 12,
            bearing: 45,
            pitch: 30
        });
    });
});

describe('hasMapSavedPosition', () => {
    it('returns true when all position fields are set', async () => {
        mockMaps.value.TestMap.center_lat = -22.9;
        mockMaps.value.TestMap.center_long = -43.17;
        mockMaps.value.TestMap.zoom = 12;
        mockMaps.value.TestMap.bearing = 0;
        mockMaps.value.TestMap.pitch = 0;

        const result = await hasMapSavedPosition('TestMap');
        expect(result).toBe(true);
    });

    it('returns false when position fields are null', async () => {
        const result = await hasMapSavedPosition('TestMap');
        expect(result).toBe(false);
    });
});

describe('clearMapPosition', () => {
    it('clears position data', async () => {
        mockMaps.value.TestMap.center_lat = -22.9;
        mockMaps.value.TestMap.center_long = -43.17;
        mockMaps.value.TestMap.zoom = 12;
        mockMaps.value.TestMap.bearing = 0;
        mockMaps.value.TestMap.pitch = 0;
        mockMaps.value.TestMap.savedPosition = { id: 'pos-1', center_lat: -22.9 };

        const { updateMapDataCompat } = await import('../../src/js/store/repositories/index.js');

        await clearMapPosition('TestMap');

        expect(updateMapDataCompat).toHaveBeenCalledWith(
            'TestMap',
            expect.objectContaining({
                center_lat: null,
                center_long: null,
                zoom: null,
                bearing: null,
                pitch: null
            })
        );
    });

    it('blocks on locked map', async () => {
        mockLockedMaps.value = new Set(['TestMap']);
        const { updateMapDataCompat } = await import('../../src/js/store/repositories/index.js');

        await clearMapPosition();

        expect(updateMapDataCompat).not.toHaveBeenCalled();
    });
});

// ============================================================================
// MAP BADGE COLORS
// ============================================================================

describe('getMapBadgeColor', () => {
    it('returns existing color', async () => {
        mockSettings.value.mapBadgeColors = { TestMap: '#ff0000' };

        const color = await getMapBadgeColor('TestMap');

        expect(color).toBe('#ff0000');
    });

    it('auto-assigns a new color for uncolored map', async () => {
        mockSettings.value.mapBadgeColors = {};

        const color = await getMapBadgeColor('NewMap');

        expect(color).toBeDefined();
        expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    });
});

describe('getAllMapBadgeColors', () => {
    it('assigns colors to all maps and removes stale entries', async () => {
        mockMaps.value = {
            'MapA': getEmptyMapData(),
            'MapB': getEmptyMapData()
        };
        mockSettings.value.mapBadgeColors = { 'DeletedMap': '#ff0000' };

        const colors = await getAllMapBadgeColors();

        expect(colors.DeletedMap).toBeUndefined();
        expect(colors.MapA).toBeDefined();
        expect(colors.MapB).toBeDefined();
    });
});

describe('getOrderedMapBadgeColors', () => {
    it('assigns each map a palette color keyed by display name (stable, name-based)', async () => {
        mockMaps.value = {
            'MapA': getEmptyMapData(),
            'MapB': getEmptyMapData(),
            'MapC': getEmptyMapData()
        };
        mockSettings.value.mapOrder = ['MapC', 'MapA', 'MapB'];

        const colors = await getOrderedMapBadgeColors();

        // Keyed by display name; each color is a valid palette hue equal to the pure name-based color.
        for (const name of ['MapA', 'MapB', 'MapC']) {
            expect(colors[name]).toMatch(/^#[0-9a-f]{6}$/i);
            expect(colors[name]).toBe(mapBadgeColorForName(name));
        }
    });

    it('a map KEEPS its color when the list is reordered (does not recolor on reorder)', async () => {
        mockMaps.value = {
            'MapA': getEmptyMapData(),
            'MapB': getEmptyMapData(),
            'MapC': getEmptyMapData()
        };

        mockSettings.value.mapOrder = ['MapC', 'MapA', 'MapB'];
        const before = await getOrderedMapBadgeColors();

        // Reorder the maps — each map's color must be UNCHANGED (the previous behavior recolored
        // every map by its new position, which the user found confusing).
        mockSettings.value.mapOrder = ['MapB', 'MapC', 'MapA'];
        const after = await getOrderedMapBadgeColors();

        for (const name of ['MapA', 'MapB', 'MapC']) {
            expect(after[name]).toBe(before[name]);
        }
    });

    it('returns an empty map when there are no maps', async () => {
        mockMaps.value = {};
        delete mockSettings.value.mapOrder;

        const colors = await getOrderedMapBadgeColors();

        expect(colors).toEqual({});
    });
});

describe('removeMapBadgeColor', () => {
    it('removes color for a map', async () => {
        mockSettings.value.mapBadgeColors = { TestMap: '#ff0000', Other: '#00ff00' };

        await removeMapBadgeColor('TestMap');

        expect(setSettingCompat).toHaveBeenCalledWith(
            'mapBadgeColors',
            { Other: '#00ff00' }
        );
    });
});

// ============================================================================
// MAP ORDER
// ============================================================================

describe('getMapOrder / setMapOrder', () => {
    it('gets map order from settings', async () => {
        mockSettings.value.mapOrder = ['MapA', 'MapB'];
        const order = await getMapOrder();
        expect(order).toEqual(['MapA', 'MapB']);
    });

    it('sets map order', async () => {
        await setMapOrder(['MapB', 'MapA']);
        expect(setSettingCompat).toHaveBeenCalledWith('mapOrder', ['MapB', 'MapA']);
    });

    it('logs the order as an atlas-level setting op so it syncs across peers', async () => {
        // The maps-list ordering must travel to collaborators: setMapOrder mirrors the local
        // persist with a `setting` op carrying { mapOrder } (offline-safe no-op when not connected).
        // This is the outbound leg the inbound apply (remote-operation-handler › mapOrder) and the
        // 2-peer e2e (browser-collab-map-order) complete.
        await setMapOrder(['MapB', 'MapA']);
        expect(logAtlasSetting).toHaveBeenCalledWith({ mapOrder: ['MapB', 'MapA'] });
    });
});

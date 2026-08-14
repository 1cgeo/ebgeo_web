import { describe, it, expect, beforeEach, vi } from 'vitest';

// Regression: MapManager.renameMap ignored the store's answer. When the store REFUSED the
// rename (locked map / missing permission) the manager still called setCurrentMap(newName)
// and returned { success: true }, so the Maps tab showed "Mapa renomeado para X" AND the app
// pointed its current map at a name that does not exist in storage — the larger damage.

const { storeMock, idUtilsMock } = vi.hoisted(() => ({
    storeMock: {
        renameMap: vi.fn(async () => true),
        setCurrentMap: vi.fn(async () => {}),
        getAllMapNamesStore: vi.fn(async () => ['TestMap', 'OtherMap'])
    },
    idUtilsMock: { regenerateMapIds: vi.fn() }
}));

vi.mock('../../src/js/store', () => ({
    addMap: vi.fn(),
    addFeature: vi.fn(),
    removeMap: vi.fn(),
    renameMap: storeMock.renameMap,
    setCurrentMap: storeMock.setCurrentMap,
    updateMapPosition: vi.fn(),
    hasMapSavedPosition: vi.fn(),
    clearMapPosition: vi.fn(),
    getAllMapNamesStore: storeMock.getAllMapNamesStore,
    getCurrentMapName: vi.fn(async () => 'TestMap'),
    moveFeaturesToMap: vi.fn(),
    clearAllDataStore: vi.fn(),
    getMapDataStore: vi.fn(),
    getColorUsage: vi.fn(),
    getMapNotes: vi.fn(),
    setMapOrder: vi.fn(),
    getLayerManager: vi.fn(),
    getLayersRepo: vi.fn(),
    getGroupManager: vi.fn(),
    getCesium3dDataForExport: vi.fn(),
    setCesium3dDataForImport: vi.fn(),
    getStreetview360DataForExport: vi.fn(),
    setStreetview360DataForImport: vi.fn(),
    getEmptyCesium3dData: vi.fn(),
    isMapLocked: vi.fn(async () => false)
}));

vi.mock('../../src/js/utilities', () => ({ IDUtils: idUtilsMock }));

vi.mock('../../src/js/store/sync/permission-guard.js', () => ({
    checkPermission: vi.fn(() => ({ allowed: true })),
    GuardAction: { UPDATE_MAP: 'EDIT', DELETE_MAP: 'DELETE', CREATE_MAP: 'EDIT' }
}));

vi.mock('../../src/js/store/store.constants.js', () => ({ DEFAULT_MAP_NAME: 'Principal' }));

import MapManager from '../../src/js/map/map.manager.js';

let manager;

beforeEach(() => {
    vi.clearAllMocks();
    storeMock.renameMap.mockResolvedValue(true);
    manager = new MapManager(null, null);
});

describe('MapManager.renameMap — honours the store refusal', () => {
    it('reports success and switches the current map when the store renamed it', async () => {
        const result = await manager.renameMap('TestMap', 'NovoNome');

        expect(result.success).toBe(true);
        expect(storeMock.renameMap).toHaveBeenCalledWith('TestMap', 'NovoNome');
        expect(storeMock.setCurrentMap).toHaveBeenCalledWith('NovoNome');
    });

    it('reports failure and does NOT switch the current map when the store refused', async () => {
        storeMock.renameMap.mockResolvedValue(false);

        const result = await manager.renameMap('TestMap', 'NovoNome');

        expect(result.success).toBe(false);
        expect(typeof result.message).toBe('string');
        // The load-bearing half: the current map must not follow a name that was never created.
        expect(storeMock.setCurrentMap).not.toHaveBeenCalled();
    });

    // Edge case: the name is trimmed BEFORE the store call, so a refusal of the trimmed name
    // must still be seen as a refusal (an untrimmed comparison would miss it).
    it('passes the trimmed name to the store and still stops on refusal', async () => {
        storeMock.renameMap.mockResolvedValue(false);

        const result = await manager.renameMap('TestMap', '   NovoNome   ');

        expect(storeMock.renameMap).toHaveBeenCalledWith('TestMap', 'NovoNome');
        expect(result.success).toBe(false);
        expect(storeMock.setCurrentMap).not.toHaveBeenCalled();
    });

    // Edge case: an invalid name never reaches the store at all.
    it('rejects a blank name without touching the store', async () => {
        const result = await manager.renameMap('TestMap', '   ');

        expect(result.success).toBe(false);
        expect(storeMock.renameMap).not.toHaveBeenCalled();
        expect(storeMock.setCurrentMap).not.toHaveBeenCalled();
    });
});

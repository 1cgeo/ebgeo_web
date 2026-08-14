import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    validateRepository,
    getMissingMethods,
    RepositoryMethods
} from '../../src/js/store/repositories/repository.interface.js';

// ============================================================================
// Mock localforage for LocalRepository
// ============================================================================

const { stores } = vi.hoisted(() => ({ stores: {} }));

vi.mock('localforage', () => ({
    default: {
        createInstance: vi.fn(({ name }) => {
            if (!stores[name]) {
                const map = new Map();
                stores[name] = {
                    setItem: vi.fn(async (key, value) => { map.set(key, value); }),
                    getItem: vi.fn(async (key) => {
                        const val = map.get(key);
                        return val !== undefined ? val : null;
                    }),
                    removeItem: vi.fn(async (key) => { map.delete(key); }),
                    keys: vi.fn(async () => [...map.keys()]),
                    clear: vi.fn(async () => { map.clear(); }),
                    iterate: vi.fn(async (callback) => {
                        for (const [key, value] of map.entries()) {
                            callback(value, key);
                        }
                    }),
                    _map: map
                };
            }
            return stores[name];
        })
    }
}));

// Mock dependencies used by local.repository.js
vi.mock('../../src/js/store/atlas/atlas.entity.js', () => ({
    createAtlas: vi.fn((name) => ({
        id: 'atlas-uuid',
        name: name || 'Projeto sem nome',
        maps: [],
        sync: { createdAt: Date.now(), updatedAt: Date.now(), version: 1, ownerId: null, dirty: true, deleted: false, deletedAt: null }
    })),
    isValidAtlas: vi.fn(() => true)
}));

vi.mock('../../src/js/store/services/map-resolver.service.js', () => ({
    mapResolver: {
        resolveToId: vi.fn((nameOrId) => nameOrId),
        resolveToName: vi.fn((id) => id),
        registerMap: vi.fn()
    }
}));

// ============================================================================
// Import after mocks
// ============================================================================

import { LocalRepository } from '../../src/js/store/repositories/local.repository.js';

// ============================================================================
// SETUP
// ============================================================================

let repo;

beforeEach(() => {
    // Clear all store Maps
    for (const storeName of Object.keys(stores)) {
        stores[storeName]._map.clear();
        vi.clearAllMocks();
    }
    repo = new LocalRepository();
});

// ============================================================================
// TESTS
// ============================================================================

describe('Repository contract tests', () => {

    // ========================================================================
    // Interface compliance
    // ========================================================================

    describe('interface compliance', () => {
        it('validateRepository(localRepo) returns true', () => {
            expect(validateRepository(repo)).toBe(true);
        });

        it('getMissingMethods(localRepo) returns empty array', () => {
            const missing = getMissingMethods(repo);
            expect(missing).toEqual([]);
        });

        it('validateRepository({}) returns false', () => {
            expect(validateRepository({})).toBe(false);
        });

        it('validateRepository(null) returns false', () => {
            expect(validateRepository(null)).toBe(false);
        });

        it('all required methods are functions', () => {
            for (const method of RepositoryMethods) {
                expect(typeof repo[method]).toBe('function');
            }
        });
    });

    // ========================================================================
    // Atlas CRUD
    // ========================================================================

    describe('atlas operations', () => {
        it('ensureAtlas creates an atlas if none exists', async () => {
            const atlas = await repo.ensureAtlas('Meu Projeto');
            expect(atlas).toBeDefined();
            expect(atlas.name).toBe('Meu Projeto');
        });

        it('getAtlas returns null when no atlas exists', async () => {
            const atlas = await repo.getAtlas();
            expect(atlas).toBeNull();
        });

        it('saveAtlas + getAtlas round-trips and adds sync metadata', async () => {
            const atlas = { id: 'a1', name: 'Test', maps: [] };
            await repo.saveAtlas(atlas);
            const loaded = await repo.getAtlas();
            expect(loaded).toBeDefined();
            expect(loaded.name).toBe('Test');
            // saveAtlas calls touchSyncMetadata which adds sync fields
            expect(loaded.sync).toBeDefined();
            expect(loaded.sync.updatedAt).toEqual(expect.any(Number));
        });
    });

    // ========================================================================
    // Settings CRUD
    // ========================================================================

    describe('settings operations', () => {
        it('saveSetting + getSetting round-trips', async () => {
            await repo.saveSetting('theme', 'dark');
            const value = await repo.getSetting('theme');
            expect(value).toBe('dark');
        });

        it('getSetting returns null for non-existent key', async () => {
            const value = await repo.getSetting('non-existent');
            expect(value).toBeNull();
        });

        it('deleteSetting removes the value', async () => {
            await repo.saveSetting('temp', 'value');
            await repo.deleteSetting('temp');
            const value = await repo.getSetting('temp');
            expect(value).toBeNull();
        });
    });

    // ========================================================================
    // Layer operations
    // ========================================================================

    describe('layer operations', () => {
        it('saveLayers + getLayers round-trips', async () => {
            const layers = [
                { id: 'layer-1', name: 'Camada 1', visible: true, locked: false },
                { id: 'layer-2', name: 'Camada 2', visible: true, locked: false }
            ];
            await repo.saveLayers('map-1', layers);
            const loaded = await repo.getLayers('map-1');
            expect(loaded).toHaveLength(2);
            expect(loaded[0].name).toBe('Camada 1');
        });

        it('getLayers returns default layer when none saved', async () => {
            const layers = await repo.getLayers('nonexistent-map');
            expect(layers).toHaveLength(1);
            expect(layers[0]).toEqual(expect.objectContaining({
                id: 'default',
                name: 'Padrão',
                visible: true,
                locked: false
            }));
        });

        it('saveActiveLayerId + getActiveLayerId round-trips', async () => {
            await repo.saveActiveLayerId('map-1', 'layer-2');
            const activeId = await repo.getActiveLayerId('map-1');
            expect(activeId).toBe('layer-2');
        });
    });

    // ========================================================================
    // Group operations
    // ========================================================================

    describe('group operations', () => {
        it('saveGroups + getGroups round-trips', async () => {
            const groups = { 'group-1': { name: 'Grupo 1', features: ['feat-1', 'feat-2'] } };
            await repo.saveGroups('map-1', groups);
            const loaded = await repo.getGroups('map-1');
            expect(loaded['group-1'].name).toBe('Grupo 1');
        });

        it('getGroups returns empty object for non-existent map', async () => {
            const groups = await repo.getGroups('nonexistent');
            expect(groups).toEqual({});
        });
    });

    // ========================================================================
    // Map CRUD
    // ========================================================================

    describe('map CRUD operations', () => {
        it('saveMap + getMap round-trips', async () => {
            await repo.saveMap('map-1', { name: 'Mapa 1', features: {} });
            const loaded = await repo.getMap('map-1');
            expect(loaded).toBeDefined();
            expect(loaded.name).toBe('Mapa 1');
            expect(loaded.id).toBe('map-1');
        });

        it('saveMap adds sync metadata automatically', async () => {
            await repo.saveMap('map-2', { name: 'Mapa 2' });
            const loaded = await repo.getMap('map-2');
            expect(loaded.sync).toBeDefined();
            expect(loaded.sync.createdAt).toEqual(expect.any(Number));
            expect(loaded.sync.version).toEqual(expect.any(Number));
        });

        it('getMapById returns map by direct key', async () => {
            await repo.saveMap('map-3', { name: 'Mapa 3' });
            const loaded = await repo.getMapById('map-3');
            expect(loaded).toBeDefined();
            expect(loaded.name).toBe('Mapa 3');
        });

        it('getMap returns null for non-existent map', async () => {
            const loaded = await repo.getMap('nonexistent');
            expect(loaded).toBeNull();
        });

        it('getAllMaps returns all saved maps', async () => {
            await repo.saveMap('map-a', { name: 'Map A' });
            await repo.saveMap('map-b', { name: 'Map B' });
            const allMaps = await repo.getAllMaps();
            expect(allMaps.size).toBe(2);
        });

        it('getAllMapIds returns all map keys', async () => {
            await repo.saveMap('map-x', { name: 'Map X' });
            await repo.saveMap('map-y', { name: 'Map Y' });
            const ids = await repo.getAllMapIds();
            expect(ids).toContain('map-x');
            expect(ids).toContain('map-y');
        });

        it('deleteMap removes map and all associated data', async () => {
            // Save map + associated data
            await repo.saveMap('map-del', { name: 'To Delete' });
            await repo.saveLayers('map-del', [{ id: 'l1', name: 'Layer' }]);
            await repo.saveGroups('map-del', { g1: { name: 'Group' } });

            // Delete
            await repo.deleteMap('map-del');

            // Verify map is gone
            const map = await repo.getMapById('map-del');
            expect(map).toBeNull();

            // Verify layers fall back to default
            const layers = await repo.getLayers('map-del');
            expect(layers[0].id).toBe('default');
        });

        it('deleteMap also clears notes, grid style, comments and color usage', async () => {
            await repo.saveMap('map-side', { name: 'Com laterais' });
            await repo.saveMapNotes('map-side', { title: 'T', description: 'D' });
            await repo.saveGridStyle('map-side', { lineColor: '#fff' });
            await repo.saveMapComments('map-side', { c1: { id: 'c1', text: 'oi' } });
            await repo.saveSetting('color_usage_map-side', { '#ff0000': 3 });

            await repo.deleteMap('map-side');

            expect(await repo.getMapNotes('map-side')).toEqual({ title: '', description: '' });
            expect(await repo.getGridStyle('map-side')).toBeNull();
            expect(await repo.getMapComments('map-side')).toEqual({});
            expect(await repo.getSetting('color_usage_map-side')).toBeNull();
        });

        it('deleteMap clears the NAME-keyed lock and temporal config (no resurrection)', async () => {
            // These two are read back by NAME on setCurrentMap, so leaving them behind makes
            // a NEW map of the same name be born locked and with the dead map's timeline.
            await repo.saveMap('map-tmp', { name: 'map-tmp' });
            await repo.saveSetting('mapLocked_map-tmp', true);
            await repo.saveSetting('temporal_map-tmp', { ativo: true, modo: 'absoluto' });

            await repo.deleteMap('map-tmp');

            expect(await repo.getSetting('mapLocked_map-tmp')).toBeNull();
            expect(await repo.getSetting('temporal_map-tmp')).toBeNull();
        });

        it('deleteMap by UUID resolves the display name for the name-keyed side stores', async () => {
            // Remote path: the caller only has the UUID, so the name must come from the record.
            const uuid = '11111111-2222-4333-8444-555555555555';
            await repo.saveMap(uuid, { name: 'Mapa Remoto' });
            await repo.saveSetting('mapLocked_Mapa Remoto', true);
            await repo.saveSetting('temporal_Mapa Remoto', { ativo: true });

            await repo.deleteMap(uuid);

            expect(await repo.getSetting('mapLocked_Mapa Remoto')).toBeNull();
            expect(await repo.getSetting('temporal_Mapa Remoto')).toBeNull();
        });

        it('deleteMap of a missing map is a no-op that does not throw (edge)', async () => {
            await expect(repo.deleteMap('never-existed')).resolves.toBeUndefined();
        });
    });

    // ========================================================================
    // clearAll
    // ========================================================================

    describe('clearAll', () => {
        it('clears all stored data', async () => {
            // Save data in multiple stores
            await repo.saveMap('map-1', { name: 'Test Map' });
            await repo.saveLayers('map-1', [{ id: 'l1', name: 'Layer' }]);
            await repo.saveSetting('theme', 'dark');
            // Spatial comments must be part of the full clear (regression: "Limpar Tudo" used to
            // leave them — the clear sequence had no comment-store step).
            await repo.saveMapComments('map-1', { c1: { id: 'c1', text: 'Comentário' } });

            // Clear everything
            await repo.clearAll();

            // Verify everything is gone
            const atlas = await repo.getAtlas();
            expect(atlas).toBeNull();
            const map = await repo.getMapById('map-1');
            expect(map).toBeNull();
            const setting = await repo.getSetting('theme');
            expect(setting).toBeNull();
            const comments = await repo.getMapComments('map-1');
            expect(Object.keys(comments)).toHaveLength(0);
        });
    });
});

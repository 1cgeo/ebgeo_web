import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Active-map resolution regression.
//
// Origin bug: opening a SERVER atlas left the app sitting on the local default
// 'Principal' map instead of the atlas map. The active map a fresh boot lands on
// is decided by repository.js `initializeRepository()` (reads `ebgeo_maps` keys +
// the `lastActiveMap` app setting), while NAME -> UUID resolution for the freshly
// pulled atlas map is owned by the map-resolver service. This suite locks both:
//  1. a sensible active map name comes out of initializeRepository(), and
//  2. the resolver maps the atlas map NAME -> its UUID after a fresh pull.
//
// Storage shape mirrors production: the local default 'Principal' is keyed by its
// NAME (no UUID), while an atlas map is keyed by its server UUID and carries the
// display name in `.name`.
// ============================================================================

// In-memory localforage mock (mirrors local-repository-real-shape.test.js: a
// single hoisted registry keyed by instance name, each backed by a Map, with a
// deep clone on the way in/out to emulate IndexedDB structured-clone semantics so
// a verbatim round-trip can't pass by reference).
const { stores } = vi.hoisted(() => ({ stores: {} }));

const clone = (v) =>
    typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v));

vi.mock('localforage', () => ({
    default: {
        createInstance: vi.fn(({ name }) => {
            if (!stores[name]) {
                const map = new Map();
                stores[name] = {
                    setItem: vi.fn(async (key, value) => { map.set(key, clone(value)); return value; }),
                    getItem: vi.fn(async (key) => {
                        const val = map.get(key);
                        return val !== undefined ? clone(val) : null;
                    }),
                    removeItem: vi.fn(async (key) => { map.delete(key); }),
                    keys: vi.fn(async () => [...map.keys()]),
                    clear: vi.fn(async () => { map.clear(); }),
                    iterate: vi.fn(async (callback) => {
                        for (const [key, value] of map.entries()) {
                            callback(clone(value), key);
                        }
                    }),
                    _map: map
                };
            }
            return stores[name];
        })
    }
}));

// operation-dispatcher pulls in the queue/network sync machinery via its module
// graph; repository.js imports `logAtlasSetting` from it. initializeRepository()
// never calls it, but stubbing keeps the import hermetic.
vi.mock('../../src/js/store/sync/operation-dispatcher.js', () => ({
    logAtlasSetting: vi.fn(async () => {})
}));

// ============================================================================
// Import after mocks. Everything else (migration service, atlas entity, the REAL
// map-resolver singleton + factory, sync metadata, config) runs unmocked.
// ============================================================================

import localforage from 'localforage';
import { initializeRepository, memoryStore } from '../../src/js/store/repository.js';
import { LocalRepository } from '../../src/js/store/repositories/local.repository.js';
import { getRepository } from '../../src/js/store/repositories/index.js';
import { mapResolver, createMapResolver } from '../../src/js/store/services/map-resolver.service.js';
import { ATLAS_SCHEMA_VERSION } from '../../src/js/store/atlas/atlas.entity.js';
import { createSyncMetadata } from '../../src/js/store/sync/sync-metadata.js';
import { DEFAULT_MAP_NAME } from '../../src/js/store/store.constants.js';

// ============================================================================
// Store handles (created by the repository's createInstance() calls)
// ============================================================================

/**
 * A store handle by absolute database name, CREATING it if nothing has asked for it yet.
 *
 * These three used to be plain lookups into `stores`, and they worked by accident: the
 * migration service called `localforage.createInstance({name: 'ebgeo_atlas'})` at MODULE LOAD,
 * so importing it populated the registry before any test ran. That module-load call was the
 * very defect the migration-per-slot work removed (a handle bound to a fixed database name,
 * decided before any atlas is known), and removing it left these lookups returning undefined.
 *
 * The test was depending on a side effect of the bug. Asking for the handle explicitly is what
 * it should have done from the start: it states which databases this file is about instead of
 * inheriting them from whatever the code under test happened to open.
 * @param {string} name - Absolute database name.
 * @returns {object} The fake store.
 */
function storeNamed(name) {
    return localforage.createInstance({ name });
}

const mapStore = () => storeNamed('ebgeo_maps');
const appStore = () => storeNamed('ebgeo_app_settings');
const atlasStore = () => storeNamed('ebgeo_atlas');

// ============================================================================
// Fixtures
// ============================================================================

const ATLAS_MAP_UUID = '550e8400-e29b-41d4-a716-446655440000';
const ATLAS_MAP_NAME = 'Mapa Tático';

// A second pulled map, used for the "discoverable after a pull" scenario.
const PULLED_MAP_UUID = '550e8400-e29b-41d4-a716-446655440042';
const PULLED_MAP_NAME = 'Operação Beta';

function makeMap({ id, name }) {
    return {
        id,
        name,
        sync: createSyncMetadata(null),
        baseLayer: 'carta-topografica',
        features: { points: [], lines: [], polygons: [] }
    };
}

/**
 * Seeds storage so initializeRepository() treats it as an up-to-date v2.x install
 * with NO migration to run (schemaVersion >= ATLAS_SCHEMA_VERSION and a matching
 * atlas present), then drops in the given maps keyed exactly as production would.
 * @param {Array<{key:string,id:string|null,name:string}>} maps
 * @param {string|null} lastActiveMap - value for the `lastActiveMap` app setting
 */
async function seedRepository(maps, lastActiveMap = null) {
    await appStore().setItem('schemaVersion', ATLAS_SCHEMA_VERSION);
    await atlasStore().setItem('current_atlas', {
        id: 'atlas-uuid',
        name: 'Atlas',
        schemaVersion: ATLAS_SCHEMA_VERSION,
        mapOrder: maps.filter(m => m.id).map(m => m.id),
        lastActiveMapId: null
    });
    for (const m of maps) {
        await mapStore().setItem(m.key, makeMap({ id: m.id, name: m.name }));
    }
    if (lastActiveMap !== null) {
        await appStore().setItem('lastActiveMap', lastActiveMap);
    }
}

// ============================================================================
// SETUP
// ============================================================================

beforeEach(() => {
    for (const storeName of Object.keys(stores)) {
        stores[storeName]._map.clear();
    }
    vi.clearAllMocks();
    mapResolver.clear();
    memoryStore.currentMap = null;
});

// ============================================================================
// TESTS
// ============================================================================

describe('active-map resolution after a fresh atlas pull', () => {

    it('initializeRepository returns a sensible active map and the resolver maps the atlas NAME -> UUID', async () => {
        // Atlas map keyed by its server UUID; local default 'Principal' keyed by name (no UUID).
        await seedRepository(
            [
                { key: ATLAS_MAP_UUID, id: ATLAS_MAP_UUID, name: ATLAS_MAP_NAME },
                { key: DEFAULT_MAP_NAME, id: null, name: DEFAULT_MAP_NAME }
            ],
            // The freshly opened atlas map is the last-active one the server selected.
            ATLAS_MAP_UUID
        );

        const active = await initializeRepository();

        // A sensible active map: one of the seeded keys, and (the heart of the bug)
        // NOT silently left on the local 'Principal' when the atlas map was active.
        expect([ATLAS_MAP_UUID, DEFAULT_MAP_NAME]).toContain(active);
        expect(active).toBe(ATLAS_MAP_UUID);
        expect(memoryStore.currentMap).toBe(active);

        // Resolver learns name <-> UUID from a scan of the just-pulled repo.
        await mapResolver.initialize(getRepository());

        // The crux: the atlas map NAME resolves to its UUID (so name-keyed UI code
        // reaches the atlas map, not the local 'Principal').
        expect(mapResolver.resolveToId(ATLAS_MAP_NAME)).toBe(ATLAS_MAP_UUID);
        expect(mapResolver.resolveToName(ATLAS_MAP_UUID)).toBe(ATLAS_MAP_NAME);
        expect(mapResolver.isKnown(ATLAS_MAP_NAME)).toBe(true);
    });

    it('falls back to a real seeded map (never an empty active map) when lastActiveMap is stale', async () => {
        // lastActiveMap points at a map that is no longer present -> must fall back to
        // an existing key, not return the dangling name.
        await seedRepository(
            [
                { key: ATLAS_MAP_UUID, id: ATLAS_MAP_UUID, name: ATLAS_MAP_NAME },
                { key: DEFAULT_MAP_NAME, id: null, name: DEFAULT_MAP_NAME }
            ],
            'um-mapa-que-nao-existe'
        );

        const active = await initializeRepository();

        const allKeys = await mapStore().keys();
        expect(allKeys).toContain(active);
        expect(active).not.toBe('um-mapa-que-nao-existe');
    });

    it('seeds the local default Principal on a fresh (empty) install', async () => {
        // No maps, but a current schemaVersion so nothing is cleared/migrated.
        await appStore().setItem('schemaVersion', ATLAS_SCHEMA_VERSION);
        await atlasStore().setItem('current_atlas', {
            id: 'atlas-uuid', name: 'Atlas', schemaVersion: ATLAS_SCHEMA_VERSION,
            mapOrder: [], lastActiveMapId: null
        });

        const active = await initializeRepository();

        expect(active).toBe(DEFAULT_MAP_NAME);
        expect(memoryStore.currentMap).toBe(DEFAULT_MAP_NAME);
        // The default map was actually persisted under its name.
        const keys = await mapStore().keys();
        expect(keys).toContain(DEFAULT_MAP_NAME);
    });
});

describe('map-resolver discovery and graceful degradation', () => {

    it('a map present only after a pull is discoverable: register then resolve', async () => {
        const resolver = createMapResolver();

        // Before the pull the resolver knows nothing about it.
        expect(resolver.isKnown(PULLED_MAP_NAME)).toBe(false);
        expect(resolver.resolveToId(PULLED_MAP_NAME)).toBe(PULLED_MAP_NAME);

        // Pull lands -> register the name/UUID pair.
        resolver.registerMap(PULLED_MAP_NAME, PULLED_MAP_UUID);

        expect(resolver.isKnown(PULLED_MAP_NAME)).toBe(true);
        expect(resolver.resolveToId(PULLED_MAP_NAME)).toBe(PULLED_MAP_UUID);
        expect(resolver.resolveToName(PULLED_MAP_UUID)).toBe(PULLED_MAP_NAME);
    });

    it('a freshly pulled map is discoverable by the singleton resolver via repository scan', async () => {
        await seedRepository([
            { key: PULLED_MAP_UUID, id: PULLED_MAP_UUID, name: PULLED_MAP_NAME }
        ]);

        await initializeRepository();
        await mapResolver.initialize(getRepository());

        expect(mapResolver.resolveToId(PULLED_MAP_NAME)).toBe(PULLED_MAP_UUID);
        expect(mapResolver.getIdForName(PULLED_MAP_NAME)).toBe(PULLED_MAP_UUID);
    });

    it('resolving an unknown name degrades gracefully (returns the input unchanged)', async () => {
        const resolver = createMapResolver();
        resolver.registerMap(ATLAS_MAP_NAME, ATLAS_MAP_UUID);

        // Real code returns the original input when not found (it does NOT return null).
        expect(resolver.resolveToId('Mapa Inexistente')).toBe('Mapa Inexistente');
        expect(resolver.getIdForName('Mapa Inexistente')).toBeUndefined();
        expect(resolver.isKnown('Mapa Inexistente')).toBe(false);

        // An unknown UUID is assumed to be a new map and returned as-is.
        const unknownUuid = '550e8400-e29b-41d4-a716-446655449999';
        expect(resolver.resolveToId(unknownUuid)).toBe(unknownUuid);
        expect(resolver.resolveToName(unknownUuid)).toBe(unknownUuid);
    });
});

describe('getRepository().getAllMaps after a fresh atlas pull', () => {

    it('returns both the atlas map and the local Principal, each carrying its id', async () => {
        await seedRepository([
            { key: ATLAS_MAP_UUID, id: ATLAS_MAP_UUID, name: ATLAS_MAP_NAME },
            { key: DEFAULT_MAP_NAME, id: null, name: DEFAULT_MAP_NAME }
        ]);

        await initializeRepository();

        const repo = getRepository();
        expect(repo).toBeInstanceOf(LocalRepository);

        const allMaps = await repo.getAllMaps();
        expect(allMaps).toBeInstanceOf(Map);
        expect(allMaps.size).toBe(2);

        // Atlas map: keyed by UUID, name preserved.
        expect(allMaps.has(ATLAS_MAP_UUID)).toBe(true);
        expect(allMaps.get(ATLAS_MAP_UUID).id).toBe(ATLAS_MAP_UUID);
        expect(allMaps.get(ATLAS_MAP_UUID).name).toBe(ATLAS_MAP_NAME);

        // Local default: keyed by name; id stayed null (it has no server UUID).
        expect(allMaps.has(DEFAULT_MAP_NAME)).toBe(true);
        expect(allMaps.get(DEFAULT_MAP_NAME).name).toBe(DEFAULT_MAP_NAME);
        expect(allMaps.get(DEFAULT_MAP_NAME).id).toBeNull();
    });
});

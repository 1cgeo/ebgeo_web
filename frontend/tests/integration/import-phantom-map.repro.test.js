import { describe, it, expect, beforeEach, vi } from 'vitest';

// Regression test for the additive-import "phantom map" bug.
//
// Root cause: on import the map data had a UUID `id` injected (by
// normalizeMapDataForCurrentVersion / migrateImportDataToV2). addMap() persists the
// map BEFORE registering the resolver, so it is stored under its NAME, yet then
// registers a name->UUID resolver mapping. With the resolver initialized (additive
// import does NOT clearAllDataStore), the next name-resolving save writes a second
// map entry keyed by that UUID -> a phantom map shown in the sidebar as a raw UUID.
//
// Fix: import no longer assigns a UUID id to maps, so addMap never registers the
// divergent mapping and everything stays consistently name-keyed.

// In-memory localforage mock (mirrors repository-contract.test.js pattern)
const { stores } = vi.hoisted(() => ({ stores: {} }));
vi.mock('localforage', () => ({
    default: {
        createInstance: vi.fn(({ name }) => {
            if (!stores[name]) {
                const map = new Map();
                stores[name] = {
                    setItem: vi.fn(async (k, v) => { map.set(k, v); }),
                    getItem: vi.fn(async (k) => (map.has(k) ? map.get(k) : null)),
                    removeItem: vi.fn(async (k) => { map.delete(k); }),
                    keys: vi.fn(async () => [...map.keys()]),
                    clear: vi.fn(async () => { map.clear(); }),
                    iterate: vi.fn(async (cb) => { for (const [k, v] of map.entries()) cb(v, k); }),
                    _map: map
                };
            }
            return stores[name];
        })
    }
}));

import { LocalRepository } from '../../src/js/store/repositories/local.repository.js';
import { mapResolver } from '../../src/js/store/services/map-resolver.service.js';
import { generateUUID } from '../../src/js/utilities/uuid.js';

let repo;
beforeEach(() => {
    for (const s of Object.keys(stores)) stores[s]._map.clear();
    mapResolver.clear();
    repo = new LocalRepository();
});

// Faithfully replays addMap()'s key operations (map.operations.js:160-164):
//   const newMapData = await createMapData(mapName, mapData); // -> repo.saveMap(mapName, {..., name})
//   const mapId = newMapData.id || mapName;
//   if (mapId !== mapName) mapResolver.registerMap(mapName, mapId);
async function replayAddMap(mapName, fileMapData, { injectId }) {
    // Simulate normalizeMapDataForCurrentVersion: the buggy version injected a UUID id.
    const normalized = { ...fileMapData };
    if (injectId && !normalized.id) {
        normalized.id = generateUUID();
    }

    // createMapCompat: ensures name, then saveMap(mapName, newMapData)
    const newMapData = { ...normalized };
    if (!newMapData.name) newMapData.name = mapName;
    await repo.saveMap(mapName, newMapData);

    const mapId = newMapData.id || mapName;
    if (mapId !== mapName) {
        mapResolver.registerMap(mapName, mapId);
    }
    return newMapData;
}

// Models a subsequent name-resolving write (e.g. updateMapPosition -> saveMap(name)).
async function nameResolvingSave(mapName) {
    const existing = await repo.getMap(mapName);
    await repo.saveMap(mapName, { ...existing, zoom: 12 });
}

describe('additive import phantom-map regression', () => {
    const MAP_NAME = 'Exc Campos Gerais_Sml Construtiva';
    // The .ebgeo export omits the map `id` (and `name` lives as the data.maps key).
    const fileMapData = () => ({ features: { points: [] } });

    it('BUG (pre-fix): injecting a map id duplicates the map under its UUID', async () => {
        await mapResolver.initialize(repo); // additive: resolver stays initialized
        expect(mapResolver.isInitialized).toBe(true);

        const created = await replayAddMap(MAP_NAME, fileMapData(), { injectId: true });
        const gen = created.id;

        expect(await repo.getAllMapIds()).toEqual([MAP_NAME]);
        expect(mapResolver.resolveToId(MAP_NAME)).toBe(gen); // resolver diverges from storage key

        await nameResolvingSave(MAP_NAME);

        const keys = await repo.getAllMapIds();
        expect(keys).toContain(gen); // phantom map keyed by the generated UUID
        expect(keys.length).toBe(2);
    });

    it('FIX: no id is injected, so no phantom map is created (resolver initialized)', async () => {
        await mapResolver.initialize(repo); // additive: resolver stays initialized
        expect(mapResolver.isInitialized).toBe(true);

        await replayAddMap(MAP_NAME, fileMapData(), { injectId: false });

        // No name->UUID mapping registered: name resolves to itself.
        expect(mapResolver.resolveToId(MAP_NAME)).toBe(MAP_NAME);

        await nameResolvingSave(MAP_NAME);

        expect(await repo.getAllMapIds()).toEqual([MAP_NAME]); // single, consistent key
    });

    it('REPLACE import (resolver cleared) is unaffected either way', async () => {
        mapResolver.clear();
        expect(mapResolver.isInitialized).toBe(false);

        await replayAddMap(MAP_NAME, fileMapData(), { injectId: false });
        await nameResolvingSave(MAP_NAME);

        expect(await repo.getAllMapIds()).toEqual([MAP_NAME]);
    });
});

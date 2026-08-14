import { describe, it, expect, beforeEach, vi } from 'vitest';

// Regression test for the additive-import "phantom map" bug.
//
// Root cause: on import the map data had a UUID `id` injected (by
// normalizeMapDataForCurrentVersion / migrateImportDataToV2). addMap() persists the
// map under its NAME (sync off), yet registers a name->UUID resolver mapping taken
// from that id. With the resolver initialized (additive import does NOT
// clearAllDataStore), the next name-resolving save resolves the name to the UUID and
// writes a SECOND map entry under it -> a phantom map, with reads by name still
// hitting the now-stale name-keyed entry.
//
// Fix: import no longer assigns a UUID id to maps, so addMap never registers the
// divergent mapping and everything stays consistently name-keyed.
//
// This test drives the PRODUCTION functions (import-normalize.js + store addMap +
// the repository compat layer). An earlier version re-implemented addMap and the
// normalization inside the test file, so the real fix could be reverted without any
// test turning red: a repro that did not repro.

// In-memory localforage mock. Values are structuredClone'd on the way in and out,
// like a real IndexedDB round-trip — without that, reader and writer share one
// object and a split-brain between two keys is invisible.
const { stores } = vi.hoisted(() => ({ stores: {} }));
vi.mock('localforage', () => ({
    default: {
        createInstance: vi.fn(({ name, storeName }) => {
            const id = `${name}:${storeName}`;
            if (!stores[id]) {
                const map = new Map();
                stores[id] = {
                    setItem: vi.fn(async (k, v) => { map.set(k, structuredClone(v)); }),
                    getItem: vi.fn(async (k) => (map.has(k) ? structuredClone(map.get(k)) : null)),
                    removeItem: vi.fn(async (k) => { map.delete(k); }),
                    keys: vi.fn(async () => [...map.keys()]),
                    clear: vi.fn(async () => { map.clear(); }),
                    iterate: vi.fn(async (cb) => { for (const [k, v] of map.entries()) cb(structuredClone(v), k); }),
                    _map: map
                };
            }
            return stores[id];
        })
    }
}));

// PRODUCTION code under test
import {
    migrateImportDataToV2,
    normalizeMapDataForCurrentVersion
} from '../../src/js/import_export/import-normalize.js';
import { addMap } from '../../src/js/store/map.operations.js';
import { getMapDataCompat, updateMapDataCompat } from '../../src/js/store/repositories/index.js';
import { LocalRepository } from '../../src/js/store/repositories/local.repository.js';
import { mapResolver } from '../../src/js/store/services/map-resolver.service.js';
import {
    isOperationLoggingEnabled,
    enableOperationLogging,
    disableOperationLogging,
} from '../../src/js/store/sync/index.js';
import { generateUUID } from '../../src/js/utilities/uuid.js';

/** Catalog resolver injected into normalize(); these fixtures carry no catalog layers. */
const noCatalogLayers = vi.fn(() => { throw new Error('processCatalogLayers should not be called'); });

let repo;
beforeEach(() => {
    for (const s of Object.keys(stores)) stores[s]._map.clear();
    mapResolver.clear();
    noCatalogLayers.mockClear();
    repo = new LocalRepository();
});

/** Models a later name-resolving write: drawing a feature calls updateMapDataCompat(mapName, ...). */
async function nameResolvingSave(mapName, mutate) {
    const data = await getMapDataCompat(mapName);
    mutate(data);
    await updateMapDataCompat(mapName, data);
}

describe('additive import phantom-map regression', () => {
    const MAP_NAME = 'Exc Campos Gerais_Sml Construtiva';
    // The .ebgeo export omits the map `id` (and `name` lives as the data.maps key).
    const fileMapData = () => ({ features: { points: [] } });

    it('sanity: these tests run with sync OFF (local/name-keyed maps)', () => {
        // The whole invariant below is about the sync-off path: with sync ON the map is
        // UUID-keyed on purpose and there is no divergence to speak of.
        expect(isOperationLoggingEnabled()).toBe(false);
    });

    // ========================================================================
    // The fix itself: the import normalizers must not mint a map id
    // ========================================================================

    it('normalizeMapDataForCurrentVersion does NOT assign a map id', () => {
        const { mapData } = normalizeMapDataForCurrentVersion(fileMapData(), noCatalogLayers);

        expect(mapData.id).toBeUndefined();
        expect(Object.keys(mapData)).not.toContain('id');
        // ...while still doing its actual job:
        expect(mapData.features.coordination_measures).toEqual([]);
        expect(mapData.sync).toBeTruthy();
    });

    it('migrateImportDataToV2 does NOT assign a map id', () => {
        const migrated = migrateImportDataToV2({
            version: '1.5',
            maps: { [MAP_NAME]: fileMapData() }
        });

        const mapData = migrated.maps[MAP_NAME];
        expect(mapData.id).toBeUndefined();
        expect(Object.keys(mapData)).not.toContain('id');
        expect(mapData.sync).toBeTruthy(); // v1 -> v2 migration still happened
    });

    it('normalize delegates catalog-layer availability to the injected resolver', () => {
        const processed = [{ id: 'cat-1', unavailable: true }];
        const processCatalogLayers = vi.fn(() => ({ processed, unavailableCount: 1 }));

        const input = { features: {}, catalogLayers: [{ id: 'cat-1' }] };
        const result = normalizeMapDataForCurrentVersion(input, processCatalogLayers);

        expect(processCatalogLayers).toHaveBeenCalledWith([{ id: 'cat-1' }]);
        expect(result.mapData.catalogLayers).toEqual(processed);
        expect(result.unavailableCatalogLayersCount).toBe(1);
    });

    // ========================================================================
    // The invariant, end-to-end through the real store
    // ========================================================================

    it('a map id injected by the caller does NOT split a local map in two', async () => {
        // This case used to assert the OPPOSITE, documenting the shape of the bug:
        // an injected id made addMap register a name->UUID mapping, and the next
        // name-resolving save wrote a second entry under the UUID.
        //
        // The divergence was closed at the source (map.operations.js only registers
        // the mapping when the map is actually UUID-keyed, i.e. sync on), so the
        // shape no longer produces the phantom. The case is kept, inverted: it is
        // the only one that feeds an id through the REAL addMap, and it is what
        // would catch the bug being reopened by a third route — which is exactly
        // how it came back in 2026-06-21 after being fixed on 2026-06-03.
        await mapResolver.initialize(repo); // additive: resolver stays initialized
        expect(mapResolver.isInitialized).toBe(true);

        const preFixMapData = { ...fileMapData(), id: generateUUID() };
        const injectedId = preFixMapData.id;

        await addMap(MAP_NAME, preFixMapData);

        // Name-keyed, and the resolver was NOT pointed at an id that keys nothing.
        expect(await repo.getAllMapIds()).toEqual([MAP_NAME]);
        expect(mapResolver.resolveToId(MAP_NAME)).not.toBe(injectedId);

        await nameResolvingSave(MAP_NAME, (d) => { d.features.points = [{ properties: { id: 'p1' } }]; });

        const keys = await repo.getAllMapIds();
        expect(keys).toEqual([MAP_NAME]);
        expect(keys).not.toContain(injectedId);

        // And the write is readable back through the same name — the split-brain
        // symptom was writes landing on one key and reads returning the other.
        const readBack = await getMapDataCompat(MAP_NAME);
        expect(readBack.features.points).toHaveLength(1);
    });

    it('com sync LIGADO o mapa e UUID-keyed e o nome resolve para o UUID', async () => {
        // O CONTROLE do outro lado da correcao: condicionar o registro do
        // resolver nao pode ter quebrado o caminho com sync ativo, onde a chave
        // por UUID existe de proposito (ver a memoria do "mapa duplicado").
        //
        // O QUE ESTE CASO NAO PROVA, e a honestidade importa mais que a
        // aparencia de rigor: ele NAO discrimina a linha de registro em
        // map.operations.js. Medido por mutacao: apagando aquela linha, este
        // caso continua verde, porque LocalRepository.saveMap tambem registra o
        // mapeamento ao gravar (local.repository.js:270). Ou seja, no caminho
        // feliz o registro acontece em DOIS lugares, e o de map.operations e
        // redundante — era justamente ele que, com sync desligado, apontava o
        // resolver para um UUID que nao e chave de nada.
        //
        // O que este caso prende e a GARANTIA DE PONTA, que e o que o usuario
        // sente: com sync ligado, uma chave so, ela e o UUID, e o nome chega
        // nela. Isso vale independentemente de qual dos dois pontos registrou.
        enableOperationLogging();
        try {
            expect(isOperationLoggingEnabled()).toBe(true);   // ancora anti-vacuidade
            await mapResolver.initialize(repo);
            const { mapData } = normalizeMapDataForCurrentVersion(fileMapData(), noCatalogLayers);
            await addMap(MAP_NAME, mapData);

            const ids = await repo.getAllMapIds();
            expect(ids).toHaveLength(1);
            const uuid = ids[0];
            expect(uuid).not.toBe(MAP_NAME);          // UUID-keyed, como manda o sync
            expect(mapResolver.resolveToId(MAP_NAME)).toBe(uuid);

            // E a escrita seguinte, que resolve por nome, cai na MESMA chave.
            await nameResolvingSave(MAP_NAME, (d) => { d.features.points = [{ properties: { id: 'p1' } }]; });
            expect(await repo.getAllMapIds()).toEqual([uuid]);
        } finally {
            disableOperationLogging();
        }
        expect(isOperationLoggingEnabled()).toBe(false);   // nao vaza para os vizinhos
    });

    it('FIX: an imported map stays a SINGLE storage entry after a later save (resolver initialized)', async () => {
        await mapResolver.initialize(repo); // additive: resolver stays initialized
        expect(mapResolver.isInitialized).toBe(true);

        // Real import pipeline: normalize the file data, then hand it to the real addMap.
        const { mapData } = normalizeMapDataForCurrentVersion(fileMapData(), noCatalogLayers);
        await addMap(MAP_NAME, mapData);

        expect(await repo.getAllMapIds()).toEqual([MAP_NAME]);

        await nameResolvingSave(MAP_NAME, (d) => { d.features.points = [{ properties: { id: 'p1' } }]; });

        // One logical map = one storage key...
        expect(await repo.getAllMapIds()).toEqual([MAP_NAME]);
        // ...and reading it back by name returns what was just written (no stale half).
        const reread = await getMapDataCompat(MAP_NAME);
        expect(reread.features.points).toHaveLength(1);
        // Mechanism: no name->UUID mapping was registered, so the name resolves to itself.
        expect(mapResolver.resolveToId(MAP_NAME)).toBe(MAP_NAME);
    });

    it('REPLACE import (resolver cleared) keeps a single storage entry', async () => {
        mapResolver.clear();
        expect(mapResolver.isInitialized).toBe(false);

        const { mapData } = normalizeMapDataForCurrentVersion(fileMapData(), noCatalogLayers);
        await addMap(MAP_NAME, mapData);
        await nameResolvingSave(MAP_NAME, (d) => { d.features.points = [{ properties: { id: 'p1' } }]; });

        expect(await repo.getAllMapIds()).toEqual([MAP_NAME]);
        const reread = await getMapDataCompat(MAP_NAME);
        expect(reread.features.points).toHaveLength(1);
    });
});

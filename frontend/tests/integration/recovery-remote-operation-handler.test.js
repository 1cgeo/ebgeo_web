// Path: tests/integration/recovery-remote-operation-handler.test.js
import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Remote Operation Handler Tests
 *
 * Validates that remote operations (received from other clients)
 * are correctly applied to the local store and emit events.
 * Verifies that remote ops do NOT generate queue entries or undo actions.
 */

// ============================================================================
// Mocks
// ============================================================================

const localStorageMock = (() => {
    const store = {};
    return {
        getItem: (key) => store[key] || null,
        setItem: (key, value) => { store[key] = String(value); },
        removeItem: (key) => { delete store[key]; }
    };
})();
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

// In-memory map data store for testing
const mapDataStore = new Map();
// In-memory app-settings store (notes/grid/temporal/lock side-stores)
const settingStore = new Map();
// In-memory 3D / 360 per-map stores (keyed by map name)
const cesium3dStore = new Map();
const sv360Store = new Map();
// In-memory layer / group side-stores (keyed by map id)
const layerStore = new Map();
const groupStore = new Map();
// In-memory per-map spatial-comment side-store (keyed by map id)
const commentStore = new Map();

vi.mock('localforage', () => {
    const mockStore = new Map();
    return {
        default: {
            createInstance: () => ({
                setItem: vi.fn(async (key, value) => { mockStore.set(key, value); }),
                getItem: vi.fn(async (key) => mockStore.get(key) || null),
                removeItem: vi.fn(async (key) => { mockStore.delete(key); }),
                keys: vi.fn(async () => [...mockStore.keys()]),
            })
        }
    };
});

vi.mock('../../src/js/utilities/uuid.js', () => ({
    generateUUID: vi.fn(() => `uuid-${Date.now()}`),
    isValidUUID: vi.fn(() => true),
}));

vi.mock('../../src/js/store/store-errors.js', () => ({
    StoreErrorEvents: { STORE_SYNC_ERROR: 'store:syncError' },
    emitStoreError: vi.fn()
}));

// Mock repositories to use in-memory map data. The side-store setters mirror
// the real LocalRepository key derivation so the test can assert exact keys:
//   saveMapNotes(id, notes)  -> map_notes_<id>   (keyed by map id)
//   saveGridStyle(id, grid)  -> gridStyle_<id>   (keyed by map id)
//   saveSetting(key, value)  -> raw key (temporal_<name> / mapLocked_<name>)
vi.mock('../../src/js/store/repositories/index.js', () => ({
    getRepository: vi.fn(() => ({
        getAllMaps: vi.fn(async () => new Map(mapDataStore)),
        deleteMap: vi.fn(async id => mapDataStore.delete(id)),
        getMap: vi.fn(async (mapId) => mapDataStore.get(mapId) || null),
        saveMap: vi.fn(async (mapId, data) => { mapDataStore.set(mapId, data); }),
        saveMapNotes: vi.fn(async (mapId, notes) => { settingStore.set(`map_notes_${mapId}`, notes); }),
        saveGridStyle: vi.fn(async (mapId, grid) => { settingStore.set(`gridStyle_${mapId}`, grid); }),
        saveSetting: vi.fn(async (key, value) => { settingStore.set(key, value); }),
        getCesium3d: vi.fn(async (mapName) => cesium3dStore.get(mapName) || { cameraPositions: {}, markers: [], measurements: [], viewsheds: [] }),
        saveCesium3d: vi.fn(async (mapName, data) => { cesium3dStore.set(mapName, data); }),
        getStreetview360: vi.fn(async (mapName) => sv360Store.get(mapName) || { orientations: {}, markers: [] }),
        saveStreetview360: vi.fn(async (mapName, data) => { sv360Store.set(mapName, data); }),
        getLayers: vi.fn(async (mapId) => layerStore.get(mapId) || []),
        saveLayers: vi.fn(async (mapId, layers) => { layerStore.set(mapId, layers); }),
        getGroups: vi.fn(async (mapId) => groupStore.get(mapId) || {}),
        saveGroups: vi.fn(async (mapId, groups) => { groupStore.set(mapId, groups); }),
        saveMapComments: vi.fn(async (mapId, comments) => { commentStore.set(mapId, comments); }),
    })),
}));

// Mock localRepository for briefing operations
const briefingStore = new Map();
vi.mock('../../src/js/store/repositories/local.repository.js', () => ({
    localRepository: {
        getAllBriefings: vi.fn(async () => [...briefingStore.values()]),
        saveBriefing: vi.fn(async (id, data) => { briefingStore.set(id, data); }),
        getBriefing: vi.fn(async (id) => briefingStore.get(id) || null),
        deleteBriefing: vi.fn(async (id) => { briefingStore.delete(id); }),
    }
}));

// ============================================================================
// Imports
// ============================================================================

import {
    applyRemoteOperation,
    applyRemoteSnapshot,
    applyMapCreationAck,
    setRemoteHandlerEventBus,
    markLocalEditPending,
    resolveLocalEdit,
    confirmEntityVersion,
} from '../../src/js/store/sync/remote-operation-handler.js';
import { EntityType, OperationType } from '../../src/js/store/sync/operation-types.js';

// ============================================================================
// Helpers
// ============================================================================

function createMockEventBus() {
    return {
        emit: vi.fn(),
        on: vi.fn(),
        off: vi.fn()
    };
}

function createTestMapData() {
    return {
        id: 'map-1',
        features: {
            points: [],
            lines: [],
            polygons: [],
            texts: [],
            images: [],
            circles: [],
            ellipses: [],
            rectangles: [],
            brushes: [],
            arrows: [],
            boundarys: [],
            occupied_fronts: [],
            military_symbols: [],
            coordination_measures: [],
            los: [],
            visibility: [],
            processed_los: [],
            processed_visibility: []
        }
    };
}

// ============================================================================
// Tests
// ============================================================================

let eventBus;

beforeEach(() => {
    mapDataStore.clear();
    briefingStore.clear();
    settingStore.clear();
    cesium3dStore.clear();
    sv360Store.clear();
    layerStore.clear();
    groupStore.clear();
    commentStore.clear();
    eventBus = createMockEventBus();
    setRemoteHandlerEventBus(eventBus);
});


describe('AUDIT snapshot and convergence', () => {
 it('map creation ACK adds its server layer without overwriting features edited while waiting', async () => {
  const map = createTestMapData();
  map.features.points.push({ properties: { id: 'pending-point', source: 'point' } });
  mapDataStore.set('birth-map', map);
  const layer = { id: 'birth-layer', name: 'Padrão', version: 1 };
  await applyMapCreationAck({ entityId: 'birth-map', data: { layers: [layer] }, serverVersion: 701 });
  expect(layerStore.get('birth-map')).toEqual([layer]);
  expect(mapDataStore.get('birth-map').features.points[0].properties.id).toBe('pending-point');
 });
 it('an earlier map ACK cannot resurrect its subsequently deleted layer', async () => {
  mapDataStore.set('deleted-birth-map', createTestMapData());
  await applyRemoteOperation({ entityType: EntityType.LAYER, operationType: OperationType.DELETE,
   entityId: 'deleted-birth-layer', mapId: 'deleted-birth-map', serverVersion: 712 });
  await applyMapCreationAck({ entityId: 'deleted-birth-map', serverVersion: 711,
   data: { layers: [{ id: 'deleted-birth-layer', name: 'Padrão' }] } });
  expect(layerStore.get('deleted-birth-map')).toEqual([]);
 });
 it('a full layer edit arriving before the birth ACK retains the newer configuration', async () => {
  mapDataStore.set('edited-birth-map', createTestMapData());
  const edited = { id: 'edited-birth-layer', name: 'Nome novo', locked: true, version: 2 };
  await applyRemoteOperation({ entityType: EntityType.LAYER, operationType: OperationType.UPDATE,
   entityId: edited.id, mapId: 'edited-birth-map', serverVersion: 722, data: edited });
  await applyMapCreationAck({ entityId: 'edited-birth-map', serverVersion: 721,
   data: { layers: [{ id: edited.id, name: 'Padrão', locked: false, version: 1 }] } });
  expect(layerStore.get('edited-birth-map')).toEqual([edited]);
 });
 it('a delayed last-layer deletion does not resurrect its replacement after a later deletion', async () => {
  mapDataStore.set('replacement-map', createTestMapData());
  await applyRemoteOperation({ entityType: EntityType.LAYER, operationType: OperationType.DELETE,
   entityId: 'replacement-gone', mapId: 'replacement-map', serverVersion: 732 });
  await applyRemoteOperation({ entityType: EntityType.LAYER, operationType: OperationType.DELETE,
   entityId: 'original-gone', mapId: 'replacement-map', serverVersion: 731,
   data: { replacementLayers: [{ id: 'replacement-gone', name: 'Padrão' }] } });
  expect(layerStore.get('replacement-map')).toEqual([]);
 });
 it('moves a canonical feature across maps and ignores an older move replay', async () => {
  for (const id of ['origin', 'destination', 'third']) mapDataStore.set(id, { ...createTestMapData(), id });
  const entityId = 'moved-feature';
  const data = { type: 'Feature', geometry: { type: 'Point', coordinates: [1, 2] },
   properties: { id: entityId, source: 'point' } };
  const create = { id: 'move-create', entityType: EntityType.FEATURE, operationType: OperationType.CREATE,
   entityId, mapId: 'origin', serverVersion: 401, data };
  await applyRemoteOperation(create);
  const move = { ...create, id: 'move-first', mapId: 'destination', serverVersion: 402,
   data: { ...data, previousMapId: 'origin' } };
  await applyRemoteOperation(move);
  expect(mapDataStore.get('origin').features.points).toHaveLength(0);
  expect(mapDataStore.get('destination').features.points).toHaveLength(1);
  await applyRemoteOperation({ ...move, id: 'move-second', mapId: 'third', serverVersion: 403,
   data: { ...data, previousMapId: 'destination' } });
  await applyRemoteOperation(move);
  expect(mapDataStore.get('origin').features.points).toHaveLength(0);
  expect(mapDataStore.get('destination').features.points).toHaveLength(0);
  expect(mapDataStore.get('third').features.points).toHaveLength(1);
 });
 it('waits for a deferred remote edit to be applied without blocking its local ACK', async () => {
  mapDataStore.set('map-1', createTestMapData());
  const id = 'deferred-cursor';
  const make = (opId, version, x) => ({ id: opId, entityType: EntityType.FEATURE,
   operationType: OperationType.CREATE, entityId: id, mapId: 'map-1', serverVersion: version,
   data: { type: 'Feature', geometry: { type: 'Point', coordinates: [x, 0] }, properties: { id, source: 'point' } } });
  markLocalEditPending(id);
  const controller = new AbortController();
  let finished = false;
  const inbound = applyRemoteOperation(make('peer-deferred', 202, 2), { waitForDeferred: true, signal: controller.signal })
   .then(result => { finished = true; return result; });
  const duplicate = applyRemoteOperation(make('peer-deferred', 202, 2), { waitForDeferred: true, signal: controller.signal });
  // A later serialized apply is a barrier proving that the first ran its deferral guard.
  await applyRemoteOperation({ entityType: EntityType.SLIDE, entityId: 'barrier' });
  expect(finished).toBe(false);
  await resolveLocalEdit(id, 201, make('own-deferred', 201, 1));
  expect(await inbound).toBe(true);
  expect(await duplicate).toBe(true);
  expect(mapDataStore.get('map-1').features.points[0].geometry.coordinates).toEqual([2, 0]);
 });
 it('AUDIT snapshot followed by own ack must restore pending local create', async () => {
  const m=createTestMapData(); const f={id:'audit-pending',type:'Feature',geometry:{type:'Point',coordinates:[1,2]},properties:{source:'point',id:'audit-pending'}};
  m.features.points.push(f); mapDataStore.set('map-1',m); markLocalEditPending(f.id);
  const op={id:'audit-op',entityType:EntityType.FEATURE,operationType:OperationType.CREATE,entityId:f.id,mapId:'map-1',data:f};
  await applyRemoteSnapshot({maps:[createTestMapData()]});
  await resolveLocalEdit(f.id,100,op);
  expect(mapDataStore.get('map-1').features.points.some(x=>x.id===f.id)).toBe(true);
 });
 it('AUDIT full snapshot must remove maps and briefings absent on server', async () => {
  mapDataStore.set('deleted-map',createTestMapData()); briefingStore.set('deleted-brief',{id:'deleted-brief'});
  await applyRemoteSnapshot({maps:[],briefings:[]});
  expect({maps:mapDataStore.size,briefings:briefingStore.size}).toEqual({maps:0,briefings:0});
 });
 it('AUDIT old create must not resurrect a newer deletion', async () => {
  mapDataStore.set('map-1',createTestMapData());
  const op={id:'audit-create',entityType:EntityType.FEATURE,operationType:OperationType.CREATE,entityId:'audit-deleted',mapId:'map-1',data:{id:'audit-deleted',type:'Feature',geometry:{type:'Point',coordinates:[1,2]},properties:{source:'point',id:'audit-deleted'}},serverVersion:10};
  await applyRemoteOperation(op);
  expect(mapDataStore.get('map-1').features.points).toHaveLength(1);
  await applyRemoteOperation({...op,id:'audit-delete',operationType:OperationType.DELETE,serverVersion:11});
  expect(mapDataStore.get('map-1').features.points).toHaveLength(0);
  await applyRemoteOperation(op);
  expect(mapDataStore.get('map-1').features.points).toHaveLength(0);
 });
});

// F13. `map_meta` e `atlas_meta` estavam em `TARGET_TABLE_MAP`/`APPLIABLE_TARGETS` do servidor
// sem ramo de aplicacao em lado nenhum, e eram rebroadcastados com o `client_entity_type`
// preservado. Aqui o `default` devolvia `false`, que `_queueApply` (`ws-client.js`) trata como
// falha de escrita local e paga com o socket: fechar com 4000, reconectar, receber a mesma op,
// fechar de novo. Um tipo que este BUILD nao conhece nao e falha, porque replay nenhum vai
// ensinar o tipo ao cliente: registra e segue.
// CONTROLE NEGATIVO: devolvendo `false` no `default`, o primeiro caso cai.
describe('F13 — tipo de entidade desconhecido', () => {
    it('um tipo que este build nao conhece e IGNORADO, nao reprovado', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const applied = await applyRemoteOperation({
            id: 'meta-op', entityType: 'map_meta', operationType: OperationType.UPDATE,
            entityId: 'map-1', mapId: 'map-1', data: { name: 'qualquer' }, serverVersion: 900,
        });
        // Distinto de `false`, que e o unico valor que fecha o fio.
        expect(applied).not.toBe(false);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('unknown entity type'));
        warn.mockRestore();
    });

    it('avisa UMA vez por tipo, por mais ops daquele tipo que cheguem', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const op = { entityType: 'atlas_meta', operationType: OperationType.UPDATE, entityId: 'a1', data: {} };
        await applyRemoteOperation({ ...op, id: 'meta-1', serverVersion: 901 });
        await applyRemoteOperation({ ...op, id: 'meta-2', serverVersion: 902 });
        await applyRemoteOperation({ ...op, id: 'meta-3', serverVersion: 903 });
        // Um servidor um deploy a frente manda o mesmo tipo em toda transmissao e em todo
        // replay; um aviso por op soterra o console, que e justamente onde o diagnostico
        // acontece.
        const daqui = warn.mock.calls.filter(([m]) => String(m).includes('atlas_meta'));
        expect(daqui).toHaveLength(1);
        warn.mockRestore();
    });
});

// ============================================================================
// B5 passo 2, metade CLIENTE: a revisão que o servidor confirmou
// ============================================================================
//
// A FEIÇÃO JÁ TINHA ISSO, E O SERVIDOR É QUEM CARIMBAVA: `getAtlasSnapshot` escreve
// `confirmedVersion` dentro de `properties` (`backend/src/modules/sync/sync.service.js`) e
// `feature-conflicts.js` faz o mesmo na operação canônica. Nenhuma outra entidade recebe esse
// campo do servidor, e nenhuma pode passar a receber sem mexer no backend, que é outro lote. O
// que o servidor manda para TODAS é a coluna `version` em cada linha do snapshot e o
// `entityVersion` em cada recibo: é desses dois que o cliente passa a derivar a base observada.
//
// O QUE ESTES CASOS PRENDEM, e por que cada um existe:
//  - o snapshot carimba as nove famílias, e o número é o `version` da LINHA, nunca o contador
//    local de escritas que todo documento já carrega;
//  - o recibo carimba pelo `entityVersion`, que é o único caminho para a SEGUNDA edição seguida
//    da mesma entidade declarar uma base que o servidor ainda reconheça;
//  - uma op ao vivo que MESCLA um payload parcial ESQUECE a revisão, porque uma base velha perde
//    para uma mudança que este par já viu, e perder em silêncio é pior que não declarar nada.

describe('B5 — a revisão confirmada de cada entidade', () => {
    const atlasSnapshot = () => ({
        maps: [{
            id: 'map-9', name: 'Mapa 9', version: 4,
            catalogLayers: [{ id: 'hillshade', version: 11 }],
            layers: [{ id: 'layer-9', name: 'Camada', version: 5 }],
            groups: [{ id: 'group-9', name: 'Grupo', version: 6, features: [] }],
            comments: [{ id: 'comment-9', data: { text: 'oi' }, version: 7 }],
            cesium3d: { markers: [{ id: 'm3d-9', version: 8 }], cameraPositions: {} },
            streetview360: { markers: [{ id: 'm360-9', version: 9 }], orientations: {} },
        }],
        briefings: [{ id: 'brief-9', name: 'B', version: 2, slides: [{ id: 'slide-9', title: 'S', version: 3 }] }],
    });

    it('o snapshot carimba a revisão da linha em todas as famílias de entidade', async () => {
        await applyRemoteSnapshot(atlasSnapshot());

        expect(mapDataStore.get('map-9').confirmedVersion).toBe(4);
        expect(mapDataStore.get('map-9').catalogLayers[0].confirmedVersion).toBe(11);
        expect(layerStore.get('map-9')[0].confirmedVersion).toBe(5);
        expect(groupStore.get('map-9')['group-9'].confirmedVersion).toBe(6);
        expect(commentStore.get('map-9')['comment-9'].confirmedVersion).toBe(7);
        expect(cesium3dStore.get('map-9').markers[0].confirmedVersion).toBe(8);
        expect(sv360Store.get('map-9').markers[0].confirmedVersion).toBe(9);
        expect(briefingStore.get('brief-9').confirmedVersion).toBe(2);
        expect(briefingStore.get('brief-9').slides[0].confirmedVersion).toBe(3);
    });

    it('uma linha sem revisão do servidor não ganha base nenhuma, em vez de ganhar zero', async () => {
        await applyRemoteSnapshot({ maps: [{ id: 'map-8', name: 'Sem versão',
            layers: [{ id: 'layer-8', name: 'Camada' }] }] });
        expect('confirmedVersion' in mapDataStore.get('map-8')).toBe(false);
        expect('confirmedVersion' in layerStore.get('map-8')[0]).toBe(false);
    });

    it('o recibo carimba a revisão de cada família pelo entityVersion', async () => {
        await applyRemoteSnapshot(atlasSnapshot());

        expect(await confirmEntityVersion({ entityType: EntityType.MAP, entityId: 'map-9' }, 40)).toBe(true);
        expect(await confirmEntityVersion({ entityType: EntityType.LAYER, entityId: 'layer-9', mapId: 'map-9' }, 50)).toBe(true);
        expect(await confirmEntityVersion({ entityType: EntityType.GROUP, entityId: 'group-9', mapId: 'map-9' }, 60)).toBe(true);
        expect(await confirmEntityVersion({ entityType: EntityType.BRIEFING, entityId: 'brief-9' }, 20)).toBe(true);
        expect(await confirmEntityVersion({ entityType: EntityType.SLIDE, entityId: 'slide-9', mapId: 'brief-9' }, 30)).toBe(true);
        expect(await confirmEntityVersion({ entityType: EntityType.CATALOG_LAYER, entityId: 'hillshade', mapId: 'map-9' }, 110)).toBe(true);
        expect(await confirmEntityVersion({ entityType: EntityType.MARKER_3D, entityId: 'm3d-9', mapId: 'map-9' }, 80)).toBe(true);
        expect(await confirmEntityVersion({ entityType: EntityType.MARKER_360, entityId: 'm360-9', mapId: 'map-9' }, 90)).toBe(true);

        expect(mapDataStore.get('map-9').confirmedVersion).toBe(40);
        expect(layerStore.get('map-9')[0].confirmedVersion).toBe(50);
        expect(groupStore.get('map-9')['group-9'].confirmedVersion).toBe(60);
        expect(briefingStore.get('brief-9').confirmedVersion).toBe(20);
        expect(briefingStore.get('brief-9').slides[0].confirmedVersion).toBe(30);
        expect(mapDataStore.get('map-9').catalogLayers[0].confirmedVersion).toBe(110);
        expect(cesium3dStore.get('map-9').markers[0].confirmedVersion).toBe(80);
        expect(sv360Store.get('map-9').markers[0].confirmedVersion).toBe(90);
        // O `version` local, que conta as escritas DESTE cliente, não é tocado por nada disso.
        expect(layerStore.get('map-9')[0].version).toBe(5);
    });

    it('a op de sub-tipo do mapa carimba o REGISTRO do mapa, endereçado pelo mapId', async () => {
        await applyRemoteSnapshot(atlasSnapshot());
        expect(await confirmEntityVersion(
            { entityType: EntityType.MAP_POSITION, entityId: 'map-9', mapId: 'map-9' }, 41,
        )).toBe(true);
        expect(mapDataStore.get('map-9').confirmedVersion).toBe(41);
    });

    it('não inventa documento para uma entidade que este cliente não tem, e não lança', async () => {
        expect(await confirmEntityVersion({ entityType: EntityType.LAYER, entityId: 'x', mapId: 'y' }, 3)).toBe(false);
        expect(await confirmEntityVersion({ entityType: EntityType.FEATURE, entityId: 'f', mapId: 'map-9' }, 3)).toBe(false);
        expect(await confirmEntityVersion({ entityType: EntityType.MAP, entityId: 'map-9' }, undefined)).toBe(false);
        expect(mapDataStore.size).toBe(0);
    });

    it('uma camada que chega com a linha canônica do servidor carimba a base', async () => {
        await applyRemoteSnapshot(atlasSnapshot());
        await applyRemoteOperation({
            id: 'op-layer', entityType: EntityType.LAYER, operationType: OperationType.UPDATE,
            entityId: 'layer-9', mapId: 'map-9', data: { id: 'layer-9', name: 'Renomeada', version: 12 },
            serverVersion: 950,
        });
        expect(layerStore.get('map-9')[0].confirmedVersion).toBe(12);
    });

    it('uma mescla parcial ESQUECE a revisão, no mapa e na camada', async () => {
        await applyRemoteSnapshot(atlasSnapshot());

        await applyRemoteOperation({
            id: 'op-map', entityType: EntityType.MAP, operationType: OperationType.UPDATE,
            entityId: 'map-9', data: { locked: true }, serverVersion: 951,
        });
        await applyRemoteOperation({
            id: 'op-layer-2', entityType: EntityType.LAYER, operationType: OperationType.UPDATE,
            entityId: 'layer-9', mapId: 'map-9', data: { visible: false }, serverVersion: 952,
        });

        expect('confirmedVersion' in mapDataStore.get('map-9')).toBe(false);
        expect('confirmedVersion' in layerStore.get('map-9')[0]).toBe(false);
        // E o resto do registro continua lá: a mescla é de campo, não de documento.
        expect(mapDataStore.get('map-9').name).toBe('Mapa 9');
        expect(layerStore.get('map-9')[0].name).toBe('Camada');
    });
});

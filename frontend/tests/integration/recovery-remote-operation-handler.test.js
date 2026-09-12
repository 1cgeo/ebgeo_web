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
        saveGroups: vi.fn(async (mapId, groups) => { groupStore.set(mapId, groups); }),
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
    setRemoteHandlerEventBus,
    markLocalEditPending,
    resolveLocalEdit,
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
    eventBus = createMockEventBus();
    setRemoteHandlerEventBus(eventBus);
});


describe('AUDIT snapshot and convergence', () => {
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

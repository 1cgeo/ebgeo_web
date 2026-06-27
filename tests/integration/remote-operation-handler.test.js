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
    reconcilePendingLocalEdits,
} from '../../src/js/store/sync/remote-operation-handler.js';
import { EntityType, OperationType } from '../../src/js/store/sync/operation-types.js';
import { EventTypes } from '../../src/js/events/event_types.js';
import { memoryStore } from '../../src/js/store/memory-store.js';
import { readFileSync } from 'node:fs';

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

describe('Remote Feature Operations', () => {
    const testFeature = {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [-43.1, -22.9] },
        properties: { id: 'remote-f1', source: 'point', nome: 'Remote Point' }
    };

    beforeEach(() => {
        mapDataStore.set('map-1', createTestMapData());
    });

    it('applies CREATE operation', async () => {
        await applyRemoteOperation({
            entityType: EntityType.FEATURE,
            operationType: OperationType.CREATE,
            entityId: 'remote-f1',
            mapId: 'map-1',
            data: testFeature
        });

        const mapData = mapDataStore.get('map-1');
        expect(mapData.features.points).toHaveLength(1);
        expect(mapData.features.points[0].properties.id).toBe('remote-f1');
    });

    // Regression — bug F: a re-applied/echoed CREATE (e.g. the author's own op
    // returning on a catch-up pull) must be idempotent by id, not append a duplicate.
    it('CREATE is idempotent by id — a re-applied create does not duplicate the feature', async () => {
        const op = {
            entityType: EntityType.FEATURE,
            operationType: OperationType.CREATE,
            entityId: 'remote-f1',
            mapId: 'map-1',
            data: testFeature,
        };

        await applyRemoteOperation(op);
        await applyRemoteOperation(op); // echo / catch-up pull of the same create

        const mapData = mapDataStore.get('map-1');
        expect(mapData.features.points).toHaveLength(1);
        expect(mapData.features.points[0].properties.id).toBe('remote-f1');
    });

    it('a second CREATE with the same id replaces in place (last-write) without duplicating', async () => {
        await applyRemoteOperation({
            entityType: EntityType.FEATURE, operationType: OperationType.CREATE,
            entityId: 'remote-f1', mapId: 'map-1', data: testFeature,
        });
        await applyRemoteOperation({
            entityType: EntityType.FEATURE, operationType: OperationType.CREATE,
            entityId: 'remote-f1', mapId: 'map-1',
            data: { ...testFeature, properties: { ...testFeature.properties, nome: 'Renamed' } },
        });

        const mapData = mapDataStore.get('map-1');
        expect(mapData.features.points).toHaveLength(1);
        expect(mapData.features.points[0].properties.nome).toBe('Renamed');
    });

    it('emits FEATURE_CREATED event', async () => {
        await applyRemoteOperation({
            entityType: EntityType.FEATURE,
            operationType: OperationType.CREATE,
            entityId: 'remote-f1',
            mapId: 'map-1',
            data: testFeature
        });

        expect(eventBus.emit).toHaveBeenCalledWith(
            EventTypes.FEATURE_CREATED,
            expect.objectContaining({
                featureId: 'remote-f1',
                featureType: 'point',
                mapId: 'map-1'
            })
        );
    });

    it('applies UPDATE operation', async () => {
        // First create, then update
        const mapData = mapDataStore.get('map-1');
        mapData.features.points.push(testFeature);

        const updatedFeature = {
            ...testFeature,
            properties: { ...testFeature.properties, nome: 'Updated Point' }
        };

        await applyRemoteOperation({
            entityType: EntityType.FEATURE,
            operationType: OperationType.UPDATE,
            entityId: 'remote-f1',
            mapId: 'map-1',
            data: updatedFeature
        });

        const result = mapDataStore.get('map-1');
        expect(result.features.points[0].properties.nome).toBe('Updated Point');
    });

    it('emits FEATURE_MODIFIED event on update', async () => {
        const mapData = mapDataStore.get('map-1');
        mapData.features.points.push(testFeature);

        await applyRemoteOperation({
            entityType: EntityType.FEATURE,
            operationType: OperationType.UPDATE,
            entityId: 'remote-f1',
            mapId: 'map-1',
            data: { ...testFeature, properties: { ...testFeature.properties, nome: 'Updated' } }
        });

        expect(eventBus.emit).toHaveBeenCalledWith(
            EventTypes.FEATURE_MODIFIED,
            expect.objectContaining({ featureId: 'remote-f1' })
        );
    });

    it('applies DELETE operation', async () => {
        const mapData = mapDataStore.get('map-1');
        mapData.features.points.push(testFeature);

        await applyRemoteOperation({
            entityType: EntityType.FEATURE,
            operationType: OperationType.DELETE,
            entityId: 'remote-f1',
            mapId: 'map-1',
            data: testFeature
        });

        const result = mapDataStore.get('map-1');
        expect(result.features.points).toHaveLength(0);
    });

    it('emits FEATURE_DELETED event on delete', async () => {
        const mapData = mapDataStore.get('map-1');
        mapData.features.points.push(testFeature);

        await applyRemoteOperation({
            entityType: EntityType.FEATURE,
            operationType: OperationType.DELETE,
            entityId: 'remote-f1',
            mapId: 'map-1',
            data: testFeature
        });

        expect(eventBus.emit).toHaveBeenCalledWith(
            EventTypes.FEATURE_DELETED,
            expect.objectContaining({
                featureId: 'remote-f1',
                featureType: 'point',
                mapId: 'map-1'
            })
        );
    });

    // Regression: a real DELETE op carries NO `data` (only previousData), so the
    // source/storage bucket can't be derived from it. The handler must search ALL
    // buckets by id — otherwise it defaulted to 'points' and silently dropped the
    // delete of every NON-point type (line/polygon/military symbol/…) cross-client.
    it('DELETE with null data removes a NON-point feature (line) by searching all buckets', async () => {
        const mapData = mapDataStore.get('map-1');
        const lineFeature = {
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: [[-43, -22], [-43.1, -22.1]] },
            properties: { id: 'remote-line-1', source: 'line' },
        };
        mapData.features.lines = mapData.features.lines || [];
        mapData.features.lines.push(lineFeature);

        await applyRemoteOperation({
            entityType: EntityType.FEATURE,
            operationType: OperationType.DELETE,
            entityId: 'remote-line-1',
            mapId: 'map-1',
            data: null, // the real DELETE op shape — no data
        });

        expect(mapDataStore.get('map-1').features.lines).toHaveLength(0);
        expect(eventBus.emit).toHaveBeenCalledWith(
            EventTypes.FEATURE_DELETED,
            expect.objectContaining({ featureId: 'remote-line-1', featureType: 'line', mapId: 'map-1' }),
        );
    });

    it('DELETE with null data still removes a point (default bucket)', async () => {
        const mapData = mapDataStore.get('map-1');
        mapData.features.points.push(testFeature);

        await applyRemoteOperation({
            entityType: EntityType.FEATURE,
            operationType: OperationType.DELETE,
            entityId: 'remote-f1',
            mapId: 'map-1',
            data: null,
        });

        expect(mapDataStore.get('map-1').features.points).toHaveLength(0);
    });

    // Regression — new-map silent drop: a feature/create can arrive before its map/create op
    // (A creates a map and immediately draws on it). It must be BUFFERED, not dropped, and
    // replayed once the map lands. Previously `if (!mapData) return` lost the feature forever.
    it('buffers a feature op whose map is missing and replays it when the map arrives', async () => {
        await applyRemoteOperation({
            entityType: EntityType.FEATURE,
            operationType: OperationType.CREATE,
            entityId: 'pending-feat',
            mapId: 'later-map',
            data: { ...testFeature, properties: { ...testFeature.properties, id: 'pending-feat' } },
        });
        // Not applied yet — the map does not exist locally.
        expect(mapDataStore.get('later-map')).toBeUndefined();

        // The map's create op arrives → the buffered feature is replayed onto it.
        await applyRemoteOperation({
            entityType: EntityType.MAP,
            operationType: OperationType.CREATE,
            entityId: 'later-map',
            mapId: null,
            data: { id: 'later-map', name: 'Later Map', features: { points: [], lines: [] } },
        });

        const map = mapDataStore.get('later-map');
        expect(map).toBeDefined();
        expect(map.features.points.some((f) => f.properties.id === 'pending-feat')).toBe(true);
    });

    // Regression — concurrent-edit divergence: an UPDATE OLDER (lower serverVersion) than the
    // last applied — a concurrent peer edit that lost the arrival-order race — must be IGNORED,
    // so both clients converge to the highest-serverVersion value (LWW by arrival order).
    it('ignores a feature UPDATE older than the last applied (LWW by serverVersion → convergence)', async () => {
        const line = {
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
            properties: { id: 'conv-1', source: 'line', lineColor: '#000000' },
        };
        mapDataStore.get('map-1').features.lines.push(line);
        const colorOf = () => mapDataStore.get('map-1').features.lines.find((f) => f.properties.id === 'conv-1').properties.lineColor;

        // Newer arrival (serverVersion 20) wins.
        await applyRemoteOperation({
            entityType: EntityType.FEATURE, operationType: OperationType.UPDATE, entityId: 'conv-1', mapId: 'map-1', serverVersion: 20,
            data: { ...line, properties: { ...line.properties, lineColor: '#ff0000' } },
        });
        expect(colorOf()).toBe('#ff0000');

        // A LATER-DELIVERED but OLDER op (serverVersion 10) must be dropped — else the clients diverge.
        await applyRemoteOperation({
            entityType: EntityType.FEATURE, operationType: OperationType.UPDATE, entityId: 'conv-1', mapId: 'map-1', serverVersion: 10,
            data: { ...line, properties: { ...line.properties, lineColor: '#0000ff' } },
        });
        expect(colorOf()).toBe('#ff0000'); // unchanged — the stale op was ignored
    });

    it('handles delete of nonexistent feature gracefully', async () => {
        await applyRemoteOperation({
            entityType: EntityType.FEATURE,
            operationType: OperationType.DELETE,
            entityId: 'nonexistent-feature',
            mapId: 'map-1',
            data: testFeature
        });

        // Should not throw, just no-op
        const result = mapDataStore.get('map-1');
        expect(result.features.points).toHaveLength(0);
    });
});

describe('Remote Briefing Operations', () => {
    it('applies CREATE briefing operation', async () => {
        const briefingData = {
            id: 'briefing-1',
            name: 'Remote Briefing',
            slides: [],
            settings: {}
        };

        await applyRemoteOperation({
            entityType: EntityType.BRIEFING,
            operationType: OperationType.CREATE,
            entityId: 'briefing-1',
            data: briefingData
        });

        expect(briefingStore.has('briefing-1')).toBe(true);
        expect(eventBus.emit).toHaveBeenCalledWith(
            EventTypes.BRIEFING_CREATED,
            expect.objectContaining({ briefingId: 'briefing-1' })
        );
    });

    it('applies DELETE briefing operation', async () => {
        briefingStore.set('briefing-1', { id: 'briefing-1', name: 'Test' });

        await applyRemoteOperation({
            entityType: EntityType.BRIEFING,
            operationType: OperationType.DELETE,
            entityId: 'briefing-1',
            data: null
        });

        expect(briefingStore.has('briefing-1')).toBe(false);
        expect(eventBus.emit).toHaveBeenCalledWith(
            EventTypes.BRIEFING_DELETED,
            expect.objectContaining({ briefingId: 'briefing-1' })
        );
    });
});

describe('Remote operation generic event', () => {
    beforeEach(() => {
        mapDataStore.set('map-1', createTestMapData());
    });

    it('emits REMOTE_OPERATION_APPLIED for all operations', async () => {
        const operation = {
            entityType: EntityType.FEATURE,
            operationType: OperationType.CREATE,
            entityId: 'remote-f1',
            mapId: 'map-1',
            data: {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [0, 0] },
                properties: { id: 'remote-f1', source: 'point' }
            }
        };

        await applyRemoteOperation(operation);

        expect(eventBus.emit).toHaveBeenCalledWith(
            EventTypes.REMOTE_OPERATION_APPLIED,
            expect.objectContaining({ operation })
        );
    });
});

describe('Remote 3D / 360 collection operations', () => {
    it('emits MARKERS_3D_CHANGED for marker3d', async () => {
        await applyRemoteOperation({
            entityType: EntityType.MARKER_3D,
            operationType: OperationType.CREATE,
            entityId: 'm3d-1',
            mapId: 'map-1',
            data: { id: 'm3d-1', tilesetId: 't1' }
        });

        expect(eventBus.emit).toHaveBeenCalledWith(
            EventTypes.MARKERS_3D_CHANGED,
            expect.objectContaining({ mapName: 'map-1' })
        );
    });

    it('emits MEASUREMENTS_3D_CHANGED for measurement3d', async () => {
        await applyRemoteOperation({
            entityType: EntityType.MEASUREMENT_3D,
            operationType: OperationType.UPDATE,
            entityId: 'meas-1',
            mapId: 'map-1',
            data: { id: 'meas-1' }
        });

        expect(eventBus.emit).toHaveBeenCalledWith(
            EventTypes.MEASUREMENTS_3D_CHANGED,
            expect.objectContaining({ mapName: 'map-1' })
        );
    });

    it('emits VIEWSHEDS_3D_CHANGED for viewshed3d', async () => {
        await applyRemoteOperation({
            entityType: EntityType.VIEWSHED_3D,
            operationType: OperationType.DELETE,
            entityId: 'vs-1',
            mapId: 'map-1',
            data: null
        });

        expect(eventBus.emit).toHaveBeenCalledWith(
            EventTypes.VIEWSHEDS_3D_CHANGED,
            expect.objectContaining({ mapName: 'map-1' })
        );
    });

    it('emits CAMERA_3D_SAVED for cameraPosition3d create/update', async () => {
        await applyRemoteOperation({
            entityType: EntityType.CAMERA_POSITION_3D,
            operationType: OperationType.CREATE,
            entityId: 'cam-1',
            mapId: 'map-1',
            data: { id: 'cam-1', tilesetId: 'tile-9' }
        });

        expect(eventBus.emit).toHaveBeenCalledWith(
            EventTypes.CAMERA_3D_SAVED,
            expect.objectContaining({ tilesetId: 'tile-9', mapName: 'map-1' })
        );
    });

    it('does NOT emit CAMERA_3D_SAVED for cameraPosition3d delete', async () => {
        await applyRemoteOperation({
            entityType: EntityType.CAMERA_POSITION_3D,
            operationType: OperationType.DELETE,
            entityId: 'cam-1',
            mapId: 'map-1',
            data: null
        });

        const cameraSavedCalls = eventBus.emit.mock.calls.filter(
            ([type]) => type === EventTypes.CAMERA_3D_SAVED
        );
        expect(cameraSavedCalls).toHaveLength(0);
    });

    it('emits ORIENTATION_360_SAVED for orientation360 create/update', async () => {
        await applyRemoteOperation({
            entityType: EntityType.ORIENTATION_360,
            operationType: OperationType.UPDATE,
            entityId: 'or-1',
            mapId: 'map-1',
            data: { id: 'or-1', photoName: 'photo-a' }
        });

        expect(eventBus.emit).toHaveBeenCalledWith(
            EventTypes.ORIENTATION_360_SAVED,
            expect.objectContaining({ photoName: 'photo-a', mapName: 'map-1' })
        );
    });

    it('emits ORIENTATION_360_CLEARED for orientation360 delete', async () => {
        await applyRemoteOperation({
            entityType: EntityType.ORIENTATION_360,
            operationType: OperationType.DELETE,
            entityId: 'or-1',
            mapId: 'map-1',
            data: { id: 'or-1', photoName: 'photo-a' }
        });

        expect(eventBus.emit).toHaveBeenCalledWith(
            EventTypes.ORIENTATION_360_CLEARED,
            expect.objectContaining({ photoName: 'photo-a', mapName: 'map-1' })
        );
    });

    it('emits MARKERS_360_CHANGED for marker360', async () => {
        await applyRemoteOperation({
            entityType: EntityType.MARKER_360,
            operationType: OperationType.CREATE,
            entityId: 'm360-1',
            mapId: 'map-1',
            data: { id: 'm360-1', photoName: 'photo-a' }
        });

        expect(eventBus.emit).toHaveBeenCalledWith(
            EventTypes.MARKERS_360_CHANGED,
            expect.objectContaining({ mapName: 'map-1' })
        );
    });
});

// P9 GAP-6/7: a LIVE 3D/360 op must PERSIST into the per-map cesium3d/streetview360 store on
// the peer (previously emit-only → diverged until a snapshot). mapId resolves to the map name
// (resolver empty in the test → identity), so the stores are keyed by 'map-1'.
describe('Remote 3D / 360 operations — persistence (P9)', () => {
    it('persists a remote 3D marker into the cesium3d store (CREATE then DELETE)', async () => {
        await applyRemoteOperation({
            entityType: EntityType.MARKER_3D, operationType: OperationType.CREATE,
            entityId: 'm3d-1', mapId: 'map-1', data: { id: 'm3d-1', tilesetId: 't1', nome: 'M1' },
        });
        expect(cesium3dStore.get('map-1').markers.map((m) => m.id)).toEqual(['m3d-1']);

        await applyRemoteOperation({
            entityType: EntityType.MARKER_3D, operationType: OperationType.DELETE,
            entityId: 'm3d-1', mapId: 'map-1', data: null,
        });
        expect(cesium3dStore.get('map-1').markers).toHaveLength(0);
    });

    it('persists remote measurement + viewshed into their buckets', async () => {
        await applyRemoteOperation({
            entityType: EntityType.MEASUREMENT_3D, operationType: OperationType.CREATE,
            entityId: 'meas-1', mapId: 'map-1', data: { id: 'meas-1' },
        });
        await applyRemoteOperation({
            entityType: EntityType.VIEWSHED_3D, operationType: OperationType.CREATE,
            entityId: 'vs-1', mapId: 'map-1', data: { id: 'vs-1' },
        });
        expect(cesium3dStore.get('map-1').measurements.map((m) => m.id)).toEqual(['meas-1']);
        expect(cesium3dStore.get('map-1').viewsheds.map((v) => v.id)).toEqual(['vs-1']);
    });

    it('persists a remote camera position keyed by tilesetId (CREATE then DELETE by id)', async () => {
        await applyRemoteOperation({
            entityType: EntityType.CAMERA_POSITION_3D, operationType: OperationType.CREATE,
            entityId: 'cam-1', mapId: 'map-1', data: { id: 'cam-1', tilesetId: 'tile-9' },
        });
        expect(cesium3dStore.get('map-1').cameraPositions['tile-9'].id).toBe('cam-1');

        await applyRemoteOperation({
            entityType: EntityType.CAMERA_POSITION_3D, operationType: OperationType.DELETE,
            entityId: 'cam-1', mapId: 'map-1', data: null,
        });
        expect(cesium3dStore.get('map-1').cameraPositions['tile-9']).toBeUndefined();
    });

    it('persists a remote 360 orientation keyed by photoName (UPDATE then DELETE by id)', async () => {
        await applyRemoteOperation({
            entityType: EntityType.ORIENTATION_360, operationType: OperationType.UPDATE,
            entityId: 'or-1', mapId: 'map-1', data: { id: 'or-1', photoName: 'photo-a' },
        });
        expect(sv360Store.get('map-1').orientations['photo-a'].id).toBe('or-1');

        await applyRemoteOperation({
            entityType: EntityType.ORIENTATION_360, operationType: OperationType.DELETE,
            entityId: 'or-1', mapId: 'map-1', data: null,
        });
        expect(sv360Store.get('map-1').orientations['photo-a']).toBeUndefined();
    });

    it('persists a remote 360 marker into the streetview360 markers array', async () => {
        await applyRemoteOperation({
            entityType: EntityType.MARKER_360, operationType: OperationType.CREATE,
            entityId: 'm360-1', mapId: 'map-1', data: { id: 'm360-1', photoName: 'photo-a' },
        });
        expect(sv360Store.get('map-1').markers.map((m) => m.id)).toEqual(['m360-1']);

        await applyRemoteOperation({
            entityType: EntityType.MARKER_360, operationType: OperationType.DELETE,
            entityId: 'm360-1', mapId: 'map-1', data: null,
        });
        expect(sv360Store.get('map-1').markers).toHaveLength(0);
    });

    // Convergence: 3D/360 entities are CONVERGENCE_GUARDED, so an UPDATE that arrives LATER but
    // carries a LOWER serverVersion (a concurrent peer edit that lost the arrival-order race) must
    // be IGNORED — otherwise two clients diverge on the same 3D entity.
    it('ignores a stale 3D marker UPDATE (lower serverVersion → LWW convergence)', async () => {
        await applyRemoteOperation({
            entityType: EntityType.MARKER_3D, operationType: OperationType.CREATE,
            entityId: 'lww-3d', mapId: 'map-1', serverVersion: 20,
            data: { id: 'lww-3d', tilesetId: 't1', nome: 'v20' },
        });
        const nameOf = () => cesium3dStore.get('map-1').markers.find((m) => m.id === 'lww-3d')?.nome;
        expect(nameOf()).toBe('v20');

        // A LATER-DELIVERED but OLDER op (serverVersion 10) must be dropped.
        await applyRemoteOperation({
            entityType: EntityType.MARKER_3D, operationType: OperationType.UPDATE,
            entityId: 'lww-3d', mapId: 'map-1', serverVersion: 10,
            data: { id: 'lww-3d', tilesetId: 't1', nome: 'v10-stale' },
        });
        expect(nameOf()).toBe('v20'); // unchanged — the stale op was ignored
    });
});

describe('Remote map-setting operations', () => {
    it('emits MAP_MODIFIED for mapPosition', async () => {
        await applyRemoteOperation({
            entityType: EntityType.MAP_POSITION,
            operationType: OperationType.UPDATE,
            entityId: 'map-1',
            mapId: 'map-1',
            data: { center: [0, 0], zoom: 5 }
        });

        expect(eventBus.emit).toHaveBeenCalledWith(
            EventTypes.MAP_MODIFIED,
            expect.objectContaining({ mapId: 'map-1' })
        );
    });

    it('emits BASE_LAYER_CHANGED with the id STRING (not the wrapper object) for baseLayer', async () => {
        // The op data is { baseLayer: '<id>' } (map.operations.js#logBaseLayerOperation). The event
        // payload must be { layer: '<id string>' } — mirroring base-layer.control's emit — or the
        // base-layer-selector renders "[object Object]". Regression for the {layer: data} bug.
        await applyRemoteOperation({
            entityType: EntityType.BASE_LAYER,
            operationType: OperationType.UPDATE,
            entityId: 'map-1',
            mapId: 'map-1',
            data: { baseLayer: 'osm' }
        });

        expect(eventBus.emit).toHaveBeenCalledWith(
            EventTypes.BASE_LAYER_CHANGED,
            expect.objectContaining({ layer: 'osm' })
        );
        expect(eventBus.emit).toHaveBeenCalledWith(
            EventTypes.MAP_MODIFIED,
            expect.objectContaining({ mapId: 'map-1' })
        );
    });

    it('emits MAP_NOTES_REQUESTED and MAP_MODIFIED for mapNotes', async () => {
        await applyRemoteOperation({
            entityType: EntityType.MAP_NOTES,
            operationType: OperationType.UPDATE,
            entityId: 'map-1',
            mapId: 'map-1',
            data: { notes: 'hello' }
        });

        expect(eventBus.emit).toHaveBeenCalledWith(
            EventTypes.MAP_NOTES_REQUESTED,
            expect.objectContaining({ mapName: 'map-1' })
        );
        expect(eventBus.emit).toHaveBeenCalledWith(
            EventTypes.MAP_MODIFIED,
            expect.objectContaining({ mapId: 'map-1' })
        );
    });

    it('emits MAP_MODIFIED for gridStyle', async () => {
        await applyRemoteOperation({
            entityType: EntityType.GRID_STYLE,
            operationType: OperationType.UPDATE,
            entityId: 'map-1',
            mapId: 'map-1',
            data: { color: '#fff' }
        });

        expect(eventBus.emit).toHaveBeenCalledWith(
            EventTypes.MAP_MODIFIED,
            expect.objectContaining({ mapId: 'map-1' })
        );
    });

    it('emits LAYERS_CHANGED for catalogLayer', async () => {
        await applyRemoteOperation({
            entityType: EntityType.CATALOG_LAYER,
            operationType: OperationType.CREATE,
            entityId: 'cl-1',
            mapId: 'map-1',
            data: { id: 'cl-1' }
        });

        expect(eventBus.emit).toHaveBeenCalledWith(
            EventTypes.LAYERS_CHANGED,
            expect.objectContaining({ mapName: 'map-1' })
        );
    });
});

// The maps-list ORDERING syncs as an atlas-level `setting` op carrying { mapOrder: [names] }
// (map.operations.setMapOrder → logAtlasSetting). Inbound it must persist under the EXACT local
// setting key getMapOrder() reads ('mapOrder') and trigger a re-render (LAYERS_CHANGED, mapName:
// null). This is the inbound half the e2e (browser-collab-map-order) exercises across two peers;
// it shares the code path of the tested mapBadgeColors / terrainExaggeration setting sync.
describe('Remote atlas-setting operations — mapOrder (maps-list ordering)', () => {
    it('persists mapOrder from a live setting op and emits LAYERS_CHANGED', async () => {
        await applyRemoteOperation({
            entityType: EntityType.SETTING,
            operationType: OperationType.UPDATE,
            entityId: 'atlas',
            data: { mapOrder: ['Mapa B', 'Mapa A', 'Mapa C'] }
        });

        // Keyed exactly as getMapOrder()/setMapOrder() read/write it.
        expect(settingStore.get('mapOrder')).toEqual(['Mapa B', 'Mapa A', 'Mapa C']);
        expect(eventBus.emit).toHaveBeenCalledWith(
            EventTypes.LAYERS_CHANGED,
            expect.objectContaining({ mapName: null })
        );
    });

    it('rehydrates mapOrder from a snapshot atlas.settings (F5 / new peer)', async () => {
        await applyRemoteSnapshot({
            atlas: { settings: { mapOrder: ['Mapa C', 'Mapa A'] } },
            maps: []
        });

        expect(settingStore.get('mapOrder')).toEqual(['Mapa C', 'Mapa A']);
    });

    it('ignores a non-array mapOrder (defensive — never clobbers the local order)', async () => {
        await applyRemoteOperation({
            entityType: EntityType.SETTING,
            operationType: OperationType.UPDATE,
            entityId: 'atlas',
            data: { mapOrder: 'not-an-array' }
        });

        expect(settingStore.has('mapOrder')).toBe(false);
    });
});

// P9: a LIVE map-setting/catalog op must PERSIST inbound (not just emit), so two clients
// editing live converge — matching the snapshot path. Regression for GAP-1/2/3/4/5.
describe('Remote map-setting operations — persistence (P9)', () => {
    beforeEach(() => {
        mapDataStore.set('map-1', createTestMapData());
    });

    it('persists baseLayer onto the map record', async () => {
        await applyRemoteOperation({
            entityType: EntityType.BASE_LAYER, operationType: OperationType.UPDATE,
            entityId: 'map-1', mapId: 'map-1', data: { baseLayer: 'osm' },
        });
        expect(mapDataStore.get('map-1').baseLayer).toBe('osm');
    });

    it('persists map notes to the side-store', async () => {
        await applyRemoteOperation({
            entityType: EntityType.MAP_NOTES, operationType: OperationType.UPDATE,
            entityId: 'map-1', mapId: 'map-1', data: { title: 'T', description: 'D' },
        });
        expect(settingStore.get('map_notes_map-1')).toEqual({ title: 'T', description: 'D' });
    });

    it('persists grid style to the side-store', async () => {
        await applyRemoteOperation({
            entityType: EntityType.GRID_STYLE, operationType: OperationType.UPDATE,
            entityId: 'map-1', mapId: 'map-1', data: { format: 'UTM', visible: true },
        });
        expect(settingStore.get('gridStyle_map-1')).toEqual({ format: 'UTM', visible: true });
    });

    it('persists saved map position onto the map record', async () => {
        const pos = { id: 'pos-1', center_lat: -22.9, center_long: -43.1, zoom: 10, bearing: 0, pitch: 0 };
        await applyRemoteOperation({
            entityType: EntityType.MAP_POSITION, operationType: OperationType.UPDATE,
            entityId: 'map-1', mapId: 'map-1', data: pos,
        });
        const saved = mapDataStore.get('map-1');
        expect(saved.savedPosition).toEqual(pos);
        expect(saved.center_lat).toBe(-22.9);
        expect(saved.zoom).toBe(10);
    });

    it('clears saved position on a DELETE (null data)', async () => {
        const m = mapDataStore.get('map-1');
        m.savedPosition = { id: 'pos-1', center_lat: -22.9 };
        m.center_lat = -22.9;
        await applyRemoteOperation({
            entityType: EntityType.MAP_POSITION, operationType: OperationType.DELETE,
            entityId: 'map-1', mapId: 'map-1', data: null,
        });
        const saved = mapDataStore.get('map-1');
        expect(saved.savedPosition).toBeUndefined();
        expect(saved.center_lat).toBeNull();
    });

    it('persists a remote catalog layer (CREATE replace-by-id / DELETE)', async () => {
        await applyRemoteOperation({
            entityType: EntityType.CATALOG_LAYER, operationType: OperationType.CREATE,
            entityId: 'cl-1', mapId: 'map-1', data: { id: 'cl-1', name: 'WMS', visible: true },
        });
        expect(mapDataStore.get('map-1').catalogLayers).toHaveLength(1);
        expect(mapDataStore.get('map-1').catalogLayers[0].name).toBe('WMS');

        // UPDATE replaces by id (no duplicate).
        await applyRemoteOperation({
            entityType: EntityType.CATALOG_LAYER, operationType: OperationType.UPDATE,
            entityId: 'cl-1', mapId: 'map-1', data: { id: 'cl-1', name: 'WMS', visible: false },
        });
        expect(mapDataStore.get('map-1').catalogLayers).toHaveLength(1);
        expect(mapDataStore.get('map-1').catalogLayers[0].visible).toBe(false);

        // DELETE removes by id.
        await applyRemoteOperation({
            entityType: EntityType.CATALOG_LAYER, operationType: OperationType.DELETE,
            entityId: 'cl-1', mapId: 'map-1', data: null,
        });
        expect(mapDataStore.get('map-1').catalogLayers).toHaveLength(0);
    });
});

describe('applyRemoteSnapshot', () => {
    it('saves all maps and briefings from the snapshot', async () => {
        const snapshot = {
            maps: [
                { id: 'map-a', features: { points: [] }, layers: [] },
                { id: 'map-b', features: { points: [] }, layers: [] }
            ],
            briefings: [
                { id: 'brf-a', name: 'Briefing A', slides: [] }
            ]
        };

        await applyRemoteSnapshot(snapshot);

        expect(mapDataStore.has('map-a')).toBe(true);
        expect(mapDataStore.has('map-b')).toBe(true);
        expect(briefingStore.has('brf-a')).toBe(true);
        expect(eventBus.emit).toHaveBeenCalledWith(
            EventTypes.LAYERS_CHANGED,
            expect.anything()
        );
    });

    it('is defensive about missing fields', async () => {
        await applyRemoteSnapshot(undefined);
        await applyRemoteSnapshot({});
        await applyRemoteSnapshot({ maps: [null, { features: {} }], briefings: [null] });

        // No map without an id should have been stored.
        expect(mapDataStore.size).toBe(0);
        expect(briefingStore.size).toBe(0);
    });

    it('reshapes a backend-shaped (snake_case) map and populates side-stores', async () => {
        const snapshot = {
            maps: [
                {
                    id: 'map-id-1',
                    name: 'Mapa Alfa',
                    base_layer: 'osm',
                    notes_title: 'Título',
                    notes_description: 'Descrição da nota',
                    grid_style: { format: 'UTM', visible: true },
                    temporal_config: { ativo: true, unidade: 'dia', inicio: 1, fim: 9 },
                    locked: true,
                    features: { points: [] },
                    layers: []
                }
            ]
        };

        await applyRemoteSnapshot(snapshot);

        // (a) The saved IndexedDB map is camelCase: baseLayer set, no snake_case columns.
        const saved = mapDataStore.get('map-id-1');
        expect(saved).toBeDefined();
        expect(saved.baseLayer).toBe('osm');
        expect(saved.base_layer).toBeUndefined();
        expect(saved.notes_title).toBeUndefined();
        expect(saved.notes_description).toBeUndefined();
        expect(saved.grid_style).toBeUndefined();
        expect(saved.temporal_config).toBeUndefined();
        expect(saved.locked).toBeUndefined();
        // Verbatim collaborative fields survive the reshape.
        expect(saved.features).toEqual({ points: [] });
        expect(saved.layers).toEqual([]);

        // (b) Each side-store is populated under the correct key with the correct value.
        // Notes + grid are keyed by map id; temporal + lock by map name.
        expect(settingStore.get('map_notes_map-id-1')).toEqual({
            title: 'Título',
            description: 'Descrição da nota'
        });
        expect(settingStore.get('gridStyle_map-id-1')).toEqual({ format: 'UTM', visible: true });
        expect(settingStore.get('temporal_Mapa Alfa')).toEqual({
            ativo: true, unidade: 'dia', inicio: 1, fim: 9
        });
        expect(settingStore.get('mapLocked_Mapa Alfa')).toBe(true);
    });

    it('does not touch side-stores when backend map omits those columns', async () => {
        await applyRemoteSnapshot({
            maps: [{ id: 'map-bare', name: 'Bare', features: { points: [] }, layers: [] }]
        });

        const saved = mapDataStore.get('map-bare');
        expect(saved).toBeDefined();
        // Empty/absent settings should not create stray side-store entries.
        expect(settingStore.size).toBe(0);
    });
});

// P10: conflicts resolve last-one-wins BY ARRIVAL (no version/timestamp gate), and locks are
// advisory-only — a locked map still accepts remote edits. These pin the model against any
// future drift into version-rejection or lock-blocking on the apply path.
describe('P10 — LWW & no-locks on apply', () => {
    beforeEach(() => {
        mapDataStore.set('map-1', createTestMapData());
    });

    it('a remote UPDATE overwrites local regardless of local version (LWW by arrival)', async () => {
        mapDataStore.get('map-1').features.points.push({
            type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] },
            properties: { id: 'f1', source: 'point', nome: 'old', version: 99 },
        });

        // An older-version op still wins because it arrived later (no version gate).
        await applyRemoteOperation({
            entityType: EntityType.FEATURE, operationType: OperationType.UPDATE,
            entityId: 'f1', mapId: 'map-1',
            data: {
                type: 'Feature', geometry: { type: 'Point', coordinates: [1, 1] },
                properties: { id: 'f1', source: 'point', nome: 'new', version: 1 },
            },
        });

        const f = mapDataStore.get('map-1').features.points[0];
        expect(f.properties.nome).toBe('new');
        expect(f.properties.version).toBe(1);
    });

    it('a locked map still accepts remote feature ops (lock is advisory only)', async () => {
        memoryStore.lockedMaps.add('map-1');
        try {
            await applyRemoteOperation({
                entityType: EntityType.FEATURE, operationType: OperationType.CREATE,
                entityId: 'f2', mapId: 'map-1',
                data: {
                    type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] },
                    properties: { id: 'f2', source: 'point' },
                },
            });
            expect(mapDataStore.get('map-1').features.points.some((f) => f.properties.id === 'f2')).toBe(true);
        } finally {
            memoryStore.lockedMaps.delete('map-1');
        }
    });
});

// P11: a pulled snapshot must reconstruct layers / cesium3d / streetview360 into their DEDICATED
// side-stores (where the export loaders + layer manager read them), not only inline in the map doc
// — else a server atlas re-exports as .ebgeo WITHOUT its layers/3D/360 (round-trip data loss).
describe('applyRemoteSnapshot — side-store fidelity (P11)', () => {
    it('persists snapshot layers / cesium3d / streetview360 into their side-stores', async () => {
        await applyRemoteSnapshot({
            maps: [{
                id: 'map-1', name: 'Mapa A',
                features: { points: [] },
                layers: [{ id: 'L1', name: 'Camada', order: 0, visible: true }],
                cesium3d: { cameraPositions: {}, markers: [{ id: 'cm1', tilesetId: 't1' }], measurements: [], viewsheds: [] },
                streetview360: { orientations: {}, markers: [{ id: 'sm1', photoName: 'p' }] },
            }],
        });
        expect(layerStore.get('map-1')).toEqual([{ id: 'L1', name: 'Camada', order: 0, visible: true }]);
        expect(cesium3dStore.get('map-1').markers.map((m) => m.id)).toEqual(['cm1']);
        expect(sv360Store.get('map-1').markers.map((m) => m.id)).toEqual(['sm1']);
    });

    it('persists EVERY cesium3d / 360 sub-type from the snapshot (not just markers)', async () => {
        await applyRemoteSnapshot({
            maps: [{
                id: 'map-1', name: 'Mapa A',
                features: { points: [] },
                cesium3d: {
                    cameraPositions: { t9: { id: 'cam9', tilesetId: 't9' } },
                    markers: [{ id: 'cm1', tilesetId: 't1' }],
                    measurements: [{ id: 'meas1' }],
                    viewsheds: [{ id: 'vs1' }],
                },
                streetview360: {
                    orientations: { 'photo-a': { id: 'or1', photoName: 'photo-a' } },
                    markers: [{ id: 'sm1', photoName: 'p' }],
                },
            }],
        });
        const c = cesium3dStore.get('map-1');
        expect(c.markers.map((m) => m.id)).toEqual(['cm1']);
        expect(c.measurements.map((m) => m.id)).toEqual(['meas1']);
        expect(c.viewsheds.map((v) => v.id)).toEqual(['vs1']);
        expect(c.cameraPositions.t9.id).toBe('cam9');
        const s = sv360Store.get('map-1');
        expect(s.markers.map((m) => m.id)).toEqual(['sm1']);
        expect(s.orientations['photo-a'].id).toBe('or1');
    });
});

// P8: undo/redo is LOCAL per user — a remote op must NEVER enter the undo stack. Remote ops
// apply by mutating the repo directly; they never route through the local undo path
// (store-state-manager.recordAction). This is a structural guarantee — if anyone wires the
// undo machinery into the remote handler, this fails.
describe('P8 — remote ops are never undoable (structural)', () => {
    it('the remote-operation-handler does not touch the undo machinery', () => {
        const src = readFileSync(
            new URL('../../src/js/store/sync/remote-operation-handler.js', import.meta.url),
            'utf8'
        );
        // No IMPORT of the undo machinery and no recordAction CALL (descriptive comments that
        // mention store-state-manager are fine — we match the import/call, not any mention).
        expect(src).not.toMatch(/from\s+['"][^'"]*store-state-manager/);
        expect(src).not.toMatch(/\.recordAction\s*\(/);
    });
});

describe('Unknown entity type', () => {
    it('warns for unknown entity types', async () => {
        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        await applyRemoteOperation({
            entityType: 'UNKNOWN_TYPE',
            operationType: OperationType.CREATE,
            entityId: 'x',
            data: {}
        });

        expect(consoleSpy).toHaveBeenCalledWith(
            expect.stringContaining('unknown entity type')
        );
        consoleSpy.mockRestore();
    });
});

// §11 convergence guard — the DEFER / ACK-REPLAY / SELF-HEAL machinery (beyond the simple
// version-drop already covered above). This is what makes two concurrent edits to the SAME feature
// converge to max(serverVersion) WITHOUT per-property merge (feature-level LWW):
//   markLocalEditPending → a concurrent remote op is DEFERRED while the author's edit is un-acked
//   → resolveLocalEdit (push ack) seeds the order and replays the deferred op through the version guard
//   → reconcilePendingLocalEdits (post-flush) self-heals a leaked count (op compacted away / never acked).
describe('Convergence guard — defer / ack-replay / self-heal (§11)', () => {
    const updateOp = (id, color, serverVersion) => ({
        entityType: EntityType.FEATURE,
        operationType: OperationType.UPDATE,
        entityId: id,
        mapId: 'map-1',
        serverVersion,
        data: {
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
            properties: { id, source: 'line', lineColor: color },
        },
    });

    function seedLine(id, color) {
        const map = createTestMapData();
        map.features.lines.push({
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
            properties: { id, source: 'line', lineColor: color },
        });
        mapDataStore.set('map-1', map);
    }
    const colorOf = (id) =>
        mapDataStore.get('map-1').features.lines.find((f) => f.properties.id === id)?.properties.lineColor;

    it('defers a concurrent remote op while the local edit is un-acked (not applied yet)', async () => {
        seedLine('cg-defer', '#000000');   // author's optimistic local value
        markLocalEditPending('cg-defer');  // author has an un-acked edit on this feature

        // Peer's op for the SAME feature arrives before the author's ack → must be deferred, not applied.
        await applyRemoteOperation(updateOp('cg-defer', '#ff0000', 30));
        expect(colorOf('cg-defer')).toBe('#000000');

        // Author's push ack (serverVersion 25) reveals the order and replays the deferred op.
        // 30 > 25 → the peer's edit wins; both clients converge to the higher serverVersion.
        await resolveLocalEdit('cg-defer', 25);
        expect(colorOf('cg-defer')).toBe('#ff0000');
    });

    it("keeps the author's edit when its serverVersion is higher: the deferred older peer op is dropped", async () => {
        seedLine('cg-author', '#000000');  // author's optimistic value — should win
        markLocalEditPending('cg-author');

        await applyRemoteOperation(updateOp('cg-author', '#ff0000', 10)); // older peer op → deferred
        expect(colorOf('cg-author')).toBe('#000000');

        // Author's ack is serverVersion 25 (> the peer's 10) → on replay the stale peer op is dropped.
        await resolveLocalEdit('cg-author', 25);
        expect(colorOf('cg-author')).toBe('#000000'); // converges to v25 (the author's edit)
    });

    it('self-heals a leaked pending count: reconcile clears it and replays the deferred op', async () => {
        seedLine('cg-rec', '#000000');
        markLocalEditPending('cg-rec'); // local edit whose op is later compacted away (never acked)

        await applyRemoteOperation(updateOp('cg-rec', '#00ff00', 40)); // deferred (pending > 0)
        expect(colorOf('cg-rec')).toBe('#000000');

        // The author's op never reaches the server (e.g. CREATE+DELETE compaction) → no ack ever comes.
        // After a flush, reconcile sees 'cg-rec' is no longer queued → clears the leak and replays.
        await reconcilePendingLocalEdits(new Set());
        expect(colorOf('cg-rec')).toBe('#00ff00');
    });
});

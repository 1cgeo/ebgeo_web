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

import { applyRemoteOperation, applyRemoteSnapshot, setRemoteHandlerEventBus } from '../../src/js/store/sync/remote-operation-handler.js';
import { EntityType, OperationType } from '../../src/js/store/sync/operation-types.js';
import { EventTypes } from '../../src/js/events/event_types.js';

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

    it('handles missing map gracefully', async () => {
        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        await applyRemoteOperation({
            entityType: EntityType.FEATURE,
            operationType: OperationType.CREATE,
            entityId: 'remote-f2',
            mapId: 'nonexistent-map',
            data: testFeature
        });

        expect(consoleSpy).toHaveBeenCalled();
        consoleSpy.mockRestore();
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

    it('emits BASE_LAYER_CHANGED and MAP_MODIFIED for baseLayer', async () => {
        await applyRemoteOperation({
            entityType: EntityType.BASE_LAYER,
            operationType: OperationType.UPDATE,
            entityId: 'map-1',
            mapId: 'map-1',
            data: { id: 'osm' }
        });

        expect(eventBus.emit).toHaveBeenCalledWith(
            EventTypes.BASE_LAYER_CHANGED,
            expect.objectContaining({ layer: { id: 'osm' } })
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

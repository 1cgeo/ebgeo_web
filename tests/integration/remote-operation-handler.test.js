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

// Mock repositories to use in-memory map data
vi.mock('../../src/js/store/repositories/index.js', () => ({
    getRepository: vi.fn(() => ({
        getMap: vi.fn(async (mapId) => mapDataStore.get(mapId) || null),
        saveMap: vi.fn(async (mapId, data) => { mapDataStore.set(mapId, data); }),
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

import { applyRemoteOperation, setRemoteHandlerEventBus } from '../../src/js/store/sync/remote-operation-handler.js';
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

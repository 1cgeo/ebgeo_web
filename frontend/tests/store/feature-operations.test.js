import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getEmptyMapData } from '../../src/js/store/repository.utils.js';

// ============================================================================
// Hoisted shared state (available to vi.mock factories)
// ============================================================================

const { mockMapData, mockMapManager, mockLockedMaps } = vi.hoisted(() => {
    return {
        mockMapData: { value: null },
        mockMapManager: {
            getCurrentMapName: vi.fn(() => 'TestMap'),
            getCurrentMapId: vi.fn(() => 'map-uuid-123'),
            getMapId: vi.fn(() => 'map-uuid-123'),
            getFeatureColor: vi.fn(() => null),
            getFeatureColors: vi.fn(() => []),
            updateColorUsage: vi.fn(),
            recordAction: vi.fn()
        },
        mockLockedMaps: { value: new Set() }
    };
});

// ============================================================================
// Mock dependencies
// ============================================================================

vi.mock('../../src/js/store/store-errors.js', () => ({
    StoreErrorEvents: {
        STORE_PERSIST_ERROR: 'store:persistError',
        STORE_OPERATION_BLOCKED: 'store:operationBlocked'
    },
    emitStoreError: vi.fn()
}));

// The role-based write gate (checkPermission) is real here; it only engages on a connected
// REMOTE atlas. Default LOCAL (false) so every existing test stays on the permissive path.
vi.mock('../../src/js/store/store-origin.js', () => ({
    StoreOriginKind: { LOCAL: 'local', REMOTE: 'remote' },
    isRemoteStoreSync: vi.fn(() => false),
    getStoreOriginSync: vi.fn(() => ({ kind: 'local', atlasId: null })),
    loadStoreOrigin: vi.fn(async () => ({ kind: 'local', atlasId: null })),
    setStoreOrigin: vi.fn(async () => {}),
    markStoreRemote: vi.fn(async () => {}),
    markStoreLocal: vi.fn(async () => {})
}));

vi.mock('../../src/js/store/map.operations.js', () => ({
    isCurrentMapLockedSync: vi.fn(() => false)
}));

vi.mock('../../src/js/store/sync/index.js', () => ({
    logFeatureOperation: vi.fn().mockResolvedValue(undefined),
    OperationType: { CREATE: 'CREATE', UPDATE: 'UPDATE', DELETE: 'DELETE' }
}));

vi.mock('../../src/js/store/repositories/index.js', () => ({
    getMapDataCompat: vi.fn(async () => mockMapData.value),
    updateMapDataCompat: vi.fn(async (mapName, data) => {
        mockMapData.value = data;
    }),
    getLayersCompat: vi.fn(async () => [])
}));

vi.mock('../../src/js/store/store-state-manager.js', () => ({
    default: mockMapManager
}));

vi.mock('../../src/js/store/memory-store.js', () => ({
    memoryStore: {
        get lockedMaps() { return mockLockedMaps.value; },
        set lockedMaps(v) { mockLockedMaps.value = v; },
        currentMap: 'TestMap'
    }
}));

// ============================================================================
// Imports (after mocks)
// ============================================================================

import {
    addFeature,
    updateFeature,
    removeFeature,
    addFeatures,
    getFeatureById,
    getCurrentMapFeatures,
    updateFeatureProperty,
    addFeatureSilent,
    removeFeatureSilent,
    deleteLayerFeatures,
    getLayerFeatures,
    shiftMapTemporalTimes,
    setFeatureDependencies
} from '../../src/js/store/feature.operations.js';

import { isCurrentMapLockedSync } from '../../src/js/store/map.operations.js';
import { updateMapDataCompat } from '../../src/js/store/repositories/index.js';
import { logFeatureOperation } from '../../src/js/store/sync/index.js';
import { emitStoreError } from '../../src/js/store/store-errors.js';
import { sessionContext, UserRole } from '../../src/js/store/sync/session-context.js';
import { isRemoteStoreSync } from '../../src/js/store/store-origin.js';

// ============================================================================
// Helpers
// ============================================================================

function makeFeature(id, source = 'point', extra = {}) {
    return {
        type: 'Feature',
        id,
        geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
        properties: {
            id,
            source,
            nome: `Feature ${id}`,
            cor: '#ff0000',
            layerId: 'default',
            ...extra
        }
    };
}

// ============================================================================
// Setup
// ============================================================================

beforeEach(() => {
    vi.clearAllMocks();
    mockMapData.value = getEmptyMapData();
    mockMapManager.getCurrentMapName.mockReturnValue('TestMap');
    mockMapManager.getCurrentMapId.mockReturnValue('map-uuid-123');
    mockMapManager.getMapId.mockReturnValue('map-uuid-123');
    mockMapManager.getFeatureColor.mockReturnValue(null);
    mockMapManager.getFeatureColors.mockReturnValue([]);
    isCurrentMapLockedSync.mockReturnValue(false);
    mockLockedMaps.value = new Set();

    setFeatureDependencies({
        groupManager: {
            removeFeatureFromAllGroups: vi.fn()
        }
    });

    // Default: offline + local store, so the permission gate is permissive (existing tests).
    sessionContext._reset();
    isRemoteStoreSync.mockReturnValue(false);
});

// ============================================================================
// addFeature — permission gate on a connected REMOTE atlas
// ============================================================================

describe('addFeature permission gate (connected remote atlas)', () => {
    beforeEach(() => {
        // Simulate the local store holding a connected REMOTE atlas, so the role-based
        // gate in checkPermission is active (it is a no-op offline / on the local store).
        isRemoteStoreSync.mockReturnValue(true);
    });

    it('blocks a viewer: emits STORE_OPERATION_BLOCKED and persists nothing', async () => {
        sessionContext.setSession({ userId: 'viewer-1', role: UserRole.VIEWER });

        const result = await addFeature('points', makeFeature('f-viewer'), 'TestMap');

        expect(result).toBeUndefined();
        expect(emitStoreError).toHaveBeenCalledWith(
            'store:operationBlocked',
            expect.objectContaining({ operation: 'addFeature' })
        );
        expect(updateMapDataCompat).not.toHaveBeenCalled();
        expect(logFeatureOperation).not.toHaveBeenCalled();
    });

    it('blocks a commenter the same way (comments-only role)', async () => {
        sessionContext.setSession({ userId: 'commenter-1', role: UserRole.COMMENTER });

        await addFeature('points', makeFeature('f-commenter'), 'TestMap');

        expect(emitStoreError).toHaveBeenCalledWith(
            'store:operationBlocked',
            expect.objectContaining({ operation: 'addFeature' })
        );
        expect(updateMapDataCompat).not.toHaveBeenCalled();
    });

    it('allows an editor on the same remote atlas to persist', async () => {
        sessionContext.setSession({ userId: 'editor-1', role: UserRole.EDITOR });

        await addFeature('points', makeFeature('f-editor'), 'TestMap');

        expect(updateMapDataCompat).toHaveBeenCalledOnce();
        expect(emitStoreError).not.toHaveBeenCalledWith('store:operationBlocked', expect.anything());
    });
});

// ============================================================================
// addFeature
// ============================================================================

describe('addFeature', () => {
    it('adds a feature to the correct storage type', async () => {
        const feature = makeFeature('f1');

        await addFeature('points', feature);

        expect(updateMapDataCompat).toHaveBeenCalledOnce();
        const savedData = updateMapDataCompat.mock.calls[0][1];
        expect(savedData.features.points).toHaveLength(1);
        expect(savedData.features.points[0].properties.id).toBe('f1');
    });

    it('adds createdAt, updatedAt, and version to new features', async () => {
        const feature = makeFeature('f1');
        const before = Date.now();

        await addFeature('points', feature);

        const savedData = updateMapDataCompat.mock.calls[0][1];
        const saved = savedData.features.points[0];
        expect(saved.properties.createdAt).toBeGreaterThanOrEqual(before);
        expect(saved.properties.updatedAt).toBe(saved.properties.createdAt);
        expect(saved.properties.version).toBe(1);
    });

    it('records undo action after persistence', async () => {
        const feature = makeFeature('f1');

        await addFeature('points', feature);

        expect(mockMapManager.recordAction).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'add',
                featureType: 'points'
            })
        );
    });

    it('logs sync operation after persistence', async () => {
        const feature = makeFeature('f1');

        await addFeature('points', feature);

        expect(logFeatureOperation).toHaveBeenCalledWith(
            'CREATE',
            'f1',
            'map-uuid-123',
            expect.objectContaining({ properties: expect.objectContaining({ id: 'f1' }) })
        );
    });

    it('tracks color usage after persistence', async () => {
        mockMapManager.getFeatureColors.mockReturnValue(['#ff0000']);
        const feature = makeFeature('f1');

        await addFeature('points', feature);

        expect(mockMapManager.updateColorUsage).toHaveBeenCalledWith(
            null, '#ff0000', 'TestMap'
        );
    });

    it('blocks add on locked map', async () => {
        mockLockedMaps.value = new Set(['TestMap']);
        isCurrentMapLockedSync.mockReturnValue(true);
        const feature = makeFeature('f1');

        await addFeature('points', feature);

        expect(updateMapDataCompat).not.toHaveBeenCalled();
    });

    it('cleans internal MapLibre properties from feature', async () => {
        const feature = makeFeature('f1');
        feature.properties._vectorTileFeature = {};
        feature.properties._pbf = {};
        feature.properties.layer = 'internal';

        await addFeature('points', feature);

        const savedData = updateMapDataCompat.mock.calls[0][1];
        const saved = savedData.features.points[0];
        expect(saved.properties._vectorTileFeature).toBeUndefined();
        expect(saved.properties._pbf).toBeUndefined();
        expect(saved.properties.layer).toBeUndefined();
    });

    it('rejects null/invalid features', async () => {
        await addFeature('points', null);
        await addFeature('points', {});

        expect(updateMapDataCompat).not.toHaveBeenCalled();
    });
});

// ============================================================================
// updateFeature
// ============================================================================

describe('updateFeature', () => {
    it('updates an existing feature in place', async () => {
        const original = makeFeature('f1');
        original.properties.createdAt = 1000;
        original.properties.updatedAt = 1000;
        original.properties.version = 1;
        mockMapData.value.features.points.push(original);

        const updated = makeFeature('f1');
        updated.properties.nome = 'Updated Name';

        await updateFeature('points', updated);

        expect(updateMapDataCompat).toHaveBeenCalledOnce();
        const savedData = updateMapDataCompat.mock.calls[0][1];
        expect(savedData.features.points[0].properties.nome).toBe('Updated Name');
    });

    it('preserves createdAt from original feature', async () => {
        const original = makeFeature('f1');
        original.properties.createdAt = 1000;
        original.properties.updatedAt = 1000;
        original.properties.version = 1;
        mockMapData.value.features.points.push(original);

        const updated = makeFeature('f1');
        updated.properties.nome = 'Changed';

        await updateFeature('points', updated);

        const savedData = updateMapDataCompat.mock.calls[0][1];
        expect(savedData.features.points[0].properties.createdAt).toBe(1000);
    });

    it('increments version on update', async () => {
        const original = makeFeature('f1');
        original.properties.createdAt = 1000;
        original.properties.updatedAt = 1000;
        original.properties.version = 3;
        mockMapData.value.features.points.push(original);

        const updated = makeFeature('f1');
        updated.properties.nome = 'Changed';

        await updateFeature('points', updated);

        const savedData = updateMapDataCompat.mock.calls[0][1];
        expect(savedData.features.points[0].properties.version).toBe(4);
    });

    it('records undo with both old and new feature', async () => {
        const original = makeFeature('f1');
        original.properties.createdAt = 1000;
        original.properties.updatedAt = 1000;
        original.properties.version = 1;
        mockMapData.value.features.points.push(original);

        const updated = makeFeature('f1');
        updated.properties.nome = 'Changed';

        await updateFeature('points', updated);

        expect(mockMapManager.recordAction).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'update',
                featureType: 'points',
                oldFeature: expect.objectContaining({ properties: expect.objectContaining({ nome: 'Feature f1' }) }),
                newFeature: expect.objectContaining({ properties: expect.objectContaining({ nome: 'Changed' }) })
            })
        );
    });

    it('logs UPDATE sync operation', async () => {
        const original = makeFeature('f1');
        original.properties.createdAt = 1000;
        original.properties.updatedAt = 1000;
        original.properties.version = 1;
        mockMapData.value.features.points.push(original);

        const updated = makeFeature('f1');
        updated.properties.nome = 'Changed';

        await updateFeature('points', updated);

        expect(logFeatureOperation).toHaveBeenCalledWith(
            'UPDATE',
            'f1',
            'map-uuid-123',
            expect.any(Object),
            expect.any(Object)
        );
    });

    it('blocks update on locked map', async () => {
        isCurrentMapLockedSync.mockReturnValue(true);
        const original = makeFeature('f1');
        mockMapData.value.features.points.push(original);

        const updated = makeFeature('f1');
        updated.properties.nome = 'Changed';

        await updateFeature('points', updated);

        expect(updateMapDataCompat).not.toHaveBeenCalled();
    });

    it('no-ops when feature is not found', async () => {
        const updated = makeFeature('nonexistent');

        await updateFeature('points', updated);

        expect(updateMapDataCompat).not.toHaveBeenCalled();
    });

    it('preserves images from stored feature when update has none', async () => {
        const original = makeFeature('f1');
        original.properties.images = [{ src: 'img1.png' }];
        original.properties.createdAt = 1000;
        original.properties.updatedAt = 1000;
        original.properties.version = 1;
        mockMapData.value.features.points.push(original);

        const updated = makeFeature('f1');
        updated.properties.nome = 'Changed';

        await updateFeature('points', updated);

        const savedData = updateMapDataCompat.mock.calls[0][1];
        expect(savedData.features.points[0].properties.images).toEqual([{ src: 'img1.png' }]);
    });

    it('preserves descricao from stored feature when update has none', async () => {
        const original = makeFeature('f1');
        original.properties.descricao = '<p>Important note</p>';
        original.properties.createdAt = 1000;
        original.properties.updatedAt = 1000;
        original.properties.version = 1;
        mockMapData.value.features.points.push(original);

        const updated = makeFeature('f1');
        updated.properties.nome = 'Changed';

        await updateFeature('points', updated);

        const savedData = updateMapDataCompat.mock.calls[0][1];
        expect(savedData.features.points[0].properties.descricao).toBe('<p>Important note</p>');
    });

    it('tracks color change on update', async () => {
        const original = makeFeature('f1');
        original.properties.createdAt = 1000;
        original.properties.updatedAt = 1000;
        original.properties.version = 1;
        mockMapData.value.features.points.push(original);

        mockMapManager.getFeatureColor
            .mockReturnValueOnce('#ff0000')
            .mockReturnValueOnce('#00ff00');

        const updated = makeFeature('f1');
        updated.properties.cor = '#00ff00';

        await updateFeature('points', updated);

        expect(mockMapManager.updateColorUsage).toHaveBeenCalledWith(
            '#ff0000', '#00ff00', 'TestMap'
        );
    });

    it('skips persistence when no user data changed (no-op guard)', async () => {
        const original = makeFeature('f1');
        original.properties.createdAt = 1000;
        original.properties.updatedAt = 1000;
        original.properties.version = 1;
        mockMapData.value.features.points.push(original);

        const updated = { ...original, properties: { ...original.properties } };

        await updateFeature('points', updated);

        // No-op guard detects identical data and returns early
        expect(updateMapDataCompat).not.toHaveBeenCalled();
    });
});

// ============================================================================
// removeFeature
// ============================================================================

describe('removeFeature', () => {
    it('removes feature from map data', async () => {
        const feature = makeFeature('f1');
        mockMapData.value.features.points.push(feature);

        await removeFeature('points', 'f1');

        expect(updateMapDataCompat).toHaveBeenCalledOnce();
        const savedData = updateMapDataCompat.mock.calls[0][1];
        expect(savedData.features.points).toHaveLength(0);
    });

    it('records undo action with removeWithProcessed type', async () => {
        const feature = makeFeature('f1');
        mockMapData.value.features.points.push(feature);

        await removeFeature('points', 'f1');

        expect(mockMapManager.recordAction).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'removeWithProcessed',
                mainFeatureType: 'points',
                mainFeature: expect.objectContaining({ properties: expect.objectContaining({ id: 'f1' }) }),
                processedFeatures: null
            })
        );
    });

    it('logs DELETE sync operation', async () => {
        const feature = makeFeature('f1');
        mockMapData.value.features.points.push(feature);

        await removeFeature('points', 'f1');

        expect(logFeatureOperation).toHaveBeenCalledWith(
            'DELETE',
            'f1',
            'map-uuid-123',
            null,
            expect.objectContaining({ properties: expect.objectContaining({ id: 'f1' }) })
        );
    });

    it('cleans up color tracking on remove', async () => {
        mockMapManager.getFeatureColors.mockReturnValue(['#ff0000']);
        const feature = makeFeature('f1');
        mockMapData.value.features.points.push(feature);

        await removeFeature('points', 'f1');

        expect(mockMapManager.updateColorUsage).toHaveBeenCalledWith(
            '#ff0000', null, 'TestMap'
        );
    });

    it('blocks remove on locked map', async () => {
        isCurrentMapLockedSync.mockReturnValue(true);
        const feature = makeFeature('f1');
        mockMapData.value.features.points.push(feature);

        await removeFeature('points', 'f1');

        expect(updateMapDataCompat).not.toHaveBeenCalled();
    });

    it('no-ops when feature not found', async () => {
        await removeFeature('points', 'nonexistent');

        expect(updateMapDataCompat).not.toHaveBeenCalled();
    });

    it('removes related processed features for LOS', async () => {
        const losFeature = makeFeature('los1', 'los');
        mockMapData.value.features.los.push(losFeature);

        mockMapData.value.features.processed_los.push(
            { properties: { id: 'los1-visible' } },
            { properties: { id: 'los1-obstructed' } },
            { properties: { id: 'other-visible' } }
        );

        await removeFeature('los', 'los1');

        const savedData = updateMapDataCompat.mock.calls[0][1];
        expect(savedData.features.los).toHaveLength(0);
        expect(savedData.features.processed_los).toHaveLength(1);
        expect(savedData.features.processed_los[0].properties.id).toBe('other-visible');
    });
});

// ============================================================================
// addFeatures (batch)
// ============================================================================

describe('addFeatures', () => {
    it('adds multiple features of different types', async () => {
        const featuresMap = {
            points: [makeFeature('p1'), makeFeature('p2')],
            lines: [makeFeature('l1', 'line')]
        };

        await addFeatures(featuresMap);

        expect(updateMapDataCompat).toHaveBeenCalledOnce();
        const savedData = updateMapDataCompat.mock.calls[0][1];
        expect(savedData.features.points).toHaveLength(2);
        expect(savedData.features.lines).toHaveLength(1);
    });

    it('records addMultiple undo action', async () => {
        const featuresMap = {
            points: [makeFeature('p1')],
            lines: [makeFeature('l1', 'line')]
        };

        await addFeatures(featuresMap);

        expect(mockMapManager.recordAction).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'addMultiple',
                features: expect.objectContaining({
                    points: expect.any(Array),
                    lines: expect.any(Array)
                })
            })
        );
    });

    it('blocks batch add on locked map', async () => {
        mockLockedMaps.value = new Set(['TestMap']);
        isCurrentMapLockedSync.mockReturnValue(true);

        await addFeatures({ points: [makeFeature('p1')] });

        expect(updateMapDataCompat).not.toHaveBeenCalled();
    });

    it('adds timestamps to all features in batch', async () => {
        const before = Date.now();
        await addFeatures({
            points: [makeFeature('p1'), makeFeature('p2')]
        });

        const savedData = updateMapDataCompat.mock.calls[0][1];
        for (const feat of savedData.features.points) {
            expect(feat.properties.createdAt).toBeGreaterThanOrEqual(before);
            expect(feat.properties.version).toBe(1);
        }
    });
});

// ============================================================================
// Read operations
// ============================================================================

describe('getFeatureById', () => {
    it('finds feature by ID', async () => {
        const feature = makeFeature('f1');
        mockMapData.value.features.points.push(feature);

        const found = await getFeatureById('points', 'f1');

        expect(found).toBeDefined();
        expect(found.properties.id).toBe('f1');
    });

    it('returns undefined for non-existent feature', async () => {
        const found = await getFeatureById('points', 'nonexistent');
        expect(found).toBeUndefined();
    });
});

describe('getCurrentMapFeatures', () => {
    it('returns deep clone of all features', async () => {
        const feature = makeFeature('f1');
        mockMapData.value.features.points.push(feature);

        const features = await getCurrentMapFeatures();

        expect(features.points).toHaveLength(1);
        expect(features.points[0].properties.id).toBe('f1');

        // Mutating the clone should not affect the store
        features.points[0].properties.nome = 'Mutated';
        const again = await getCurrentMapFeatures();
        expect(again.points[0].properties.nome).toBe('Feature f1');
    });
});

// ============================================================================
// updateFeatureProperty
// ============================================================================

describe('updateFeatureProperty', () => {
    it('updates a single property', async () => {
        const feature = makeFeature('f1');
        feature.properties.createdAt = 1000;
        feature.properties.updatedAt = 1000;
        feature.properties.version = 1;
        mockMapData.value.features.points.push(feature);

        const result = await updateFeatureProperty('points', 'f1', 'nome', 'New Name');

        expect(result).toBe(true);
        expect(updateMapDataCompat).toHaveBeenCalledOnce();
    });

    it('returns false when feature not found', async () => {
        const result = await updateFeatureProperty('points', 'nonexistent', 'nome', 'New');
        expect(result).toBe(false);
        expect(updateMapDataCompat).not.toHaveBeenCalled();
    });

    it('blocks on locked map', async () => {
        isCurrentMapLockedSync.mockReturnValue(true);
        const feature = makeFeature('f1');
        mockMapData.value.features.points.push(feature);

        const result = await updateFeatureProperty('points', 'f1', 'nome', 'New');
        expect(result).toBe(false);
    });

    it('tracks color change for color properties', async () => {
        const feature = makeFeature('f1');
        feature.properties.createdAt = 1000;
        feature.properties.updatedAt = 1000;
        feature.properties.version = 1;
        mockMapData.value.features.points.push(feature);

        mockMapManager.getFeatureColor
            .mockReturnValueOnce('#ff0000')
            .mockReturnValueOnce('#00ff00');

        await updateFeatureProperty('points', 'f1', 'color', '#00ff00');

        expect(mockMapManager.updateColorUsage).toHaveBeenCalledWith(
            '#ff0000', '#00ff00', 'TestMap'
        );
    });

    it('does NOT track color for non-color properties', async () => {
        const feature = makeFeature('f1');
        feature.properties.createdAt = 1000;
        feature.properties.updatedAt = 1000;
        feature.properties.version = 1;
        mockMapData.value.features.points.push(feature);

        await updateFeatureProperty('points', 'f1', 'nome', 'New Name');

        expect(mockMapManager.updateColorUsage).not.toHaveBeenCalled();
    });

    it('logs sync operation for property update', async () => {
        const feature = makeFeature('f1');
        feature.properties.createdAt = 1000;
        feature.properties.updatedAt = 1000;
        feature.properties.version = 1;
        mockMapData.value.features.points.push(feature);

        await updateFeatureProperty('points', 'f1', 'nome', 'New Name');

        expect(logFeatureOperation).toHaveBeenCalledWith(
            'UPDATE',
            'f1',
            'map-uuid-123',
            expect.any(Object),
            expect.any(Object)
        );
    });
});

// ============================================================================
// Silent operations (no undo recording)
// ============================================================================

describe('addFeatureSilent', () => {
    it('adds feature without recording undo', async () => {
        const feature = makeFeature('f1');

        await addFeatureSilent('points', feature);

        expect(updateMapDataCompat).toHaveBeenCalledOnce();
        expect(mockMapManager.recordAction).not.toHaveBeenCalled();
    });

    it('still adds timestamps', async () => {
        const feature = makeFeature('f1');
        const before = Date.now();

        await addFeatureSilent('points', feature);

        const savedData = updateMapDataCompat.mock.calls[0][1];
        expect(savedData.features.points[0].properties.createdAt).toBeGreaterThanOrEqual(before);
    });
});

describe('removeFeatureSilent', () => {
    it('removes feature without recording undo', async () => {
        const feature = makeFeature('f1');
        mockMapData.value.features.points.push(feature);

        await removeFeatureSilent('points', 'f1');

        expect(updateMapDataCompat).toHaveBeenCalledOnce();
        expect(mockMapManager.recordAction).not.toHaveBeenCalled();
    });

    it('no-ops when feature not found', async () => {
        await removeFeatureSilent('points', 'nonexistent');
        expect(updateMapDataCompat).not.toHaveBeenCalled();
    });
});

// ============================================================================
// Layer-feature operations
// ============================================================================

describe('deleteLayerFeatures', () => {
    it('removes all features from a layer', async () => {
        mockMapData.value.features.points.push(
            makeFeature('f1', 'point', { layerId: 'layer-1' }),
            makeFeature('f2', 'point', { layerId: 'layer-1' }),
            makeFeature('f3', 'point', { layerId: 'layer-2' })
        );

        const result = await deleteLayerFeatures('layer-1');

        expect(result).toBe(true);
        const savedData = updateMapDataCompat.mock.calls[0][1];
        expect(savedData.features.points).toHaveLength(1);
        expect(savedData.features.points[0].properties.id).toBe('f3');
    });

    it('returns false when no features match layer', async () => {
        mockMapData.value.features.points.push(
            makeFeature('f1', 'point', { layerId: 'layer-2' })
        );

        const result = await deleteLayerFeatures('layer-1');

        expect(result).toBe(false);
        expect(updateMapDataCompat).not.toHaveBeenCalled();
    });
});

describe('getLayerFeatures', () => {
    it('returns features from a specific layer', async () => {
        mockMapData.value.features.points.push(
            makeFeature('f1', 'point', { layerId: 'layer-1' }),
            makeFeature('f2', 'point', { layerId: 'layer-2' })
        );
        mockMapData.value.features.lines.push(
            makeFeature('l1', 'line', { layerId: 'layer-1' })
        );

        const features = await getLayerFeatures('layer-1');

        expect(features).toHaveLength(2);
        const ids = features.map(f => f.properties.id);
        expect(ids).toContain('f1');
        expect(ids).toContain('l1');
    });

    it('treats missing layerId as default', async () => {
        const feature = makeFeature('f1');
        delete feature.properties.layerId;
        mockMapData.value.features.points.push(feature);

        const features = await getLayerFeatures('default');

        expect(features).toHaveLength(1);
    });
});

// ============================================================================
// shiftMapTemporalTimes (Reagendar)
// ============================================================================

describe('shiftMapTemporalTimes', () => {
    it('shifts temporalInicio/temporalFim and trajectory t values by deltaMs', async () => {
        const symbol = makeFeature('s1', 'military_symbol', {
            temporalInicio: 1000,
            temporalFim: 5000,
            trajetoria: [{ t: 1000 }, { t: 3000 }, { t: 5000 }]
        });
        mockMapData.value.features.military_symbols.push(symbol);

        const changed = await shiftMapTemporalTimes('TestMap', 2000);

        expect(changed).toBe(1);
        const savedData = updateMapDataCompat.mock.calls[0][1];
        const saved = savedData.features.military_symbols[0].properties;
        expect(saved.temporalInicio).toBe(3000);
        expect(saved.temporalFim).toBe(7000);
        expect(saved.trajetoria.map(kp => kp.t)).toEqual([3000, 5000, 7000]);
    });

    it('enqueues a feature UPDATE op per shifted feature carrying the shifted timestamps', async () => {
        const symbol = makeFeature('s1', 'military_symbol', {
            temporalInicio: 1000,
            temporalFim: 5000,
            trajetoria: [{ t: 1000 }, { t: 5000 }]
        });
        const measure = makeFeature('m1', 'coordination_measure', {
            temporalInicio: 2000,
            temporalFim: 8000
        });
        mockMapData.value.features.military_symbols.push(symbol);
        mockMapData.value.features.coordination_measures.push(measure);

        const changed = await shiftMapTemporalTimes('TestMap', 2000);

        expect(changed).toBe(2);
        expect(logFeatureOperation).toHaveBeenCalledTimes(2);

        // op for the military symbol carries the shifted window + trajectory t values
        expect(logFeatureOperation).toHaveBeenCalledWith(
            'UPDATE',
            's1',
            'map-uuid-123',
            expect.objectContaining({
                properties: expect.objectContaining({
                    temporalInicio: 3000,
                    temporalFim: 7000,
                    trajetoria: [{ t: 3000 }, { t: 7000 }]
                })
            }),
            expect.objectContaining({
                properties: expect.objectContaining({ temporalInicio: 1000, temporalFim: 5000 })
            })
        );

        // op for the coordination measure carries its own shifted window
        expect(logFeatureOperation).toHaveBeenCalledWith(
            'UPDATE',
            'm1',
            'map-uuid-123',
            expect.objectContaining({
                properties: expect.objectContaining({ temporalInicio: 4000, temporalFim: 10000 })
            }),
            expect.objectContaining({
                properties: expect.objectContaining({ temporalInicio: 2000, temporalFim: 8000 })
            })
        );
    });

    it('only logs ops for features that actually have temporal fields', async () => {
        const symbol = makeFeature('s1', 'military_symbol', { temporalInicio: 1000 });
        const plain = makeFeature('p1'); // no temporal data
        mockMapData.value.features.military_symbols.push(symbol);
        mockMapData.value.features.points.push(plain);

        const changed = await shiftMapTemporalTimes('TestMap', 500);

        expect(changed).toBe(1);
        expect(logFeatureOperation).toHaveBeenCalledTimes(1);
        expect(logFeatureOperation).toHaveBeenCalledWith(
            'UPDATE',
            's1',
            'map-uuid-123',
            expect.objectContaining({ properties: expect.objectContaining({ temporalInicio: 1500 }) }),
            expect.any(Object)
        );
    });

    it('bumps updatedAt/version on shifted features (sync metadata)', async () => {
        const symbol = makeFeature('s1', 'military_symbol', {
            temporalInicio: 1000,
            createdAt: 1,
            updatedAt: 1,
            version: 2
        });
        mockMapData.value.features.military_symbols.push(symbol);

        await shiftMapTemporalTimes('TestMap', 1000);

        const savedData = updateMapDataCompat.mock.calls[0][1];
        const saved = savedData.features.military_symbols[0].properties;
        expect(saved.version).toBe(3);
        expect(saved.updatedAt).toBeGreaterThan(1);
    });

    it('is a no-op (no persist, no ops) when delta is 0 or non-finite', async () => {
        const symbol = makeFeature('s1', 'military_symbol', { temporalInicio: 1000 });
        mockMapData.value.features.military_symbols.push(symbol);

        expect(await shiftMapTemporalTimes('TestMap', 0)).toBe(0);
        expect(await shiftMapTemporalTimes('TestMap', NaN)).toBe(0);

        expect(updateMapDataCompat).not.toHaveBeenCalled();
        expect(logFeatureOperation).not.toHaveBeenCalled();
    });

    it('is a no-op when no feature carries temporal data', async () => {
        mockMapData.value.features.points.push(makeFeature('p1'));

        const changed = await shiftMapTemporalTimes('TestMap', 1000);

        expect(changed).toBe(0);
        expect(updateMapDataCompat).not.toHaveBeenCalled();
        expect(logFeatureOperation).not.toHaveBeenCalled();
    });

    it('blocks (and emits no ops) on a locked map', async () => {
        isCurrentMapLockedSync.mockReturnValue(true);
        mockMapData.value.features.military_symbols.push(
            makeFeature('s1', 'military_symbol', { temporalInicio: 1000 })
        );

        const changed = await shiftMapTemporalTimes('TestMap', 1000);

        expect(changed).toBe(0);
        expect(updateMapDataCompat).not.toHaveBeenCalled();
        expect(logFeatureOperation).not.toHaveBeenCalled();
    });

    it('persists once for the whole batch (atomic)', async () => {
        mockMapData.value.features.military_symbols.push(
            makeFeature('s1', 'military_symbol', { temporalInicio: 1000 }),
            makeFeature('s2', 'military_symbol', { temporalInicio: 2000 })
        );

        await shiftMapTemporalTimes('TestMap', 1000);

        expect(updateMapDataCompat).toHaveBeenCalledOnce();
    });

    it('persistence failure prevents sync logging (offline-safe atomicity)', async () => {
        updateMapDataCompat.mockRejectedValueOnce(new Error('IndexedDB write failed'));
        mockMapData.value.features.military_symbols.push(
            makeFeature('s1', 'military_symbol', { temporalInicio: 1000 })
        );

        await expect(shiftMapTemporalTimes('TestMap', 1000)).rejects.toThrow('IndexedDB write failed');

        expect(logFeatureOperation).not.toHaveBeenCalled();
    });
});

// ============================================================================
// Transaction guarantees
// ============================================================================

describe('transaction guarantees', () => {
    it('persistence failure prevents undo recording', async () => {
        updateMapDataCompat.mockRejectedValueOnce(new Error('IndexedDB write failed'));

        const feature = makeFeature('f1');

        await expect(addFeature('points', feature)).rejects.toThrow('IndexedDB write failed');

        expect(mockMapManager.recordAction).not.toHaveBeenCalled();
    });

    it('persistence failure prevents sync logging', async () => {
        updateMapDataCompat.mockRejectedValueOnce(new Error('IndexedDB write failed'));

        const feature = makeFeature('f1');

        await expect(addFeature('points', feature)).rejects.toThrow();

        expect(logFeatureOperation).not.toHaveBeenCalled();
    });

    it('persistence failure prevents color tracking', async () => {
        updateMapDataCompat.mockRejectedValueOnce(new Error('IndexedDB write failed'));
        mockMapManager.getFeatureColors.mockReturnValue(['#ff0000']);

        const feature = makeFeature('f1');

        await expect(addFeature('points', feature)).rejects.toThrow();

        expect(mockMapManager.updateColorUsage).not.toHaveBeenCalled();
    });

    it('side effects execute in correct order: color → undo → sync', async () => {
        const order = [];

        mockMapManager.getFeatureColors.mockReturnValue(['#ff0000']);
        mockMapManager.updateColorUsage.mockImplementation(() => order.push('color'));
        mockMapManager.recordAction.mockImplementation(() => order.push('undo'));
        logFeatureOperation.mockImplementation(async () => order.push('sync'));

        const feature = makeFeature('f1');
        await addFeature('points', feature);

        // Sync effects (color, undo) run first, then async effects (sync)
        expect(order).toEqual(['color', 'undo', 'sync']);
    });
});

// ============================================================================
// Consistency between operations
// ============================================================================

describe('add → read → update → read cycle', () => {
    it('maintains data consistency through lifecycle', async () => {
        // 1. Add
        const feature = makeFeature('f1');
        await addFeature('points', feature);

        // 2. Read
        const found = await getFeatureById('points', 'f1');
        expect(found).toBeDefined();
        expect(found.properties.nome).toBe('Feature f1');
        expect(found.properties.version).toBe(1);

        // 3. Update
        const updated = { ...found, properties: { ...found.properties, nome: 'Updated' } };
        await updateFeature('points', updated);

        // 4. Read again
        const found2 = await getFeatureById('points', 'f1');
        expect(found2.properties.nome).toBe('Updated');
        expect(found2.properties.version).toBe(2);
        expect(found2.properties.createdAt).toBe(found.properties.createdAt);
    });
});

describe('add → remove → read cycle', () => {
    it('feature is gone after removal', async () => {
        const feature = makeFeature('f1');
        await addFeature('points', feature);

        await removeFeature('points', 'f1');

        const found = await getFeatureById('points', 'f1');
        expect(found).toBeUndefined();
    });
});

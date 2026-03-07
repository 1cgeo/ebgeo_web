import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getEmptyMapData } from '../../src/js/store/repository.utils.js';

// ============================================================================
// Hoisted shared state
// ============================================================================

const { mockMapData, mockMapManager, mockLockedMaps } = vi.hoisted(() => {
    return {
        mockMapData: { value: null },
        mockMapManager: {
            getCurrentMapName: vi.fn(() => 'TestMap'),
            getCurrentMapId: vi.fn(() => 'map-uuid-123'),
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

vi.mock('../../src/js/store/map.operations.js', () => ({
    isCurrentMapLockedSync: vi.fn(() => false)
}));

vi.mock('../../src/js/store/sync/index.js', () => ({
    logFeatureOperation: vi.fn().mockResolvedValue(undefined),
    OperationType: { CREATE: 'CREATE', UPDATE: 'UPDATE', DELETE: 'DELETE' }
}));

vi.mock('../../src/js/store/sync/permission-guard.js', () => ({
    checkPermission: vi.fn(() => ({ allowed: true })),
    GuardAction: {
        CREATE_FEATURE: 'EDIT',
        UPDATE_FEATURE: 'EDIT',
        DELETE_FEATURE: 'DELETE'
    }
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
    moveFeaturesToLayer,
    setFeatureDependencies
} from '../../src/js/store/feature.operations.js';

import { isCurrentMapLockedSync } from '../../src/js/store/map.operations.js';
import { checkPermission } from '../../src/js/store/sync/permission-guard.js';
import { updateMapDataCompat } from '../../src/js/store/repositories/index.js';
import { emitStoreError } from '../../src/js/store/store-errors.js';

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
    isCurrentMapLockedSync.mockReturnValue(false);
    checkPermission.mockReturnValue({ allowed: true });
    mockLockedMaps.value = new Set();

    setFeatureDependencies({
        groupManager: {
            removeFeatureFromAllGroups: vi.fn()
        },
        layerManager: null
    });
});

// ============================================================================
// moveFeaturesToLayer - by layer ID array
// ============================================================================

describe('moveFeaturesToLayer (by layer IDs)', () => {
    it('moves matching features and preserves non-matching features', async () => {
        mockMapData.value.features.points.push(
            makeFeature('p1', 'point', { layerId: 'layer-A' }),
            makeFeature('p2', 'point', { layerId: 'layer-A' }),
            makeFeature('p3', 'point', { layerId: 'layer-B' })
        );

        const result = await moveFeaturesToLayer(['layer-A'], 'layer-target');

        expect(result).toBe(true);
        expect(updateMapDataCompat).toHaveBeenCalledOnce();

        const saved = updateMapDataCompat.mock.calls[0][1];
        // Moved features have new layerId
        expect(saved.features.points[0].properties.layerId).toBe('layer-target');
        expect(saved.features.points[1].properties.layerId).toBe('layer-target');
        // Non-matching feature PRESERVED with original layerId
        expect(saved.features.points[2].properties.layerId).toBe('layer-B');
        // Verify other properties were NOT touched
        expect(saved.features.points[0].properties.id).toBe('p1');
        expect(saved.features.points[0].properties.nome).toBe('Feature p1');
    });

    it('moves features from multiple source layers', async () => {
        mockMapData.value.features.points.push(
            makeFeature('p1', 'point', { layerId: 'layer-A' }),
            makeFeature('p2', 'point', { layerId: 'layer-B' }),
            makeFeature('p3', 'point', { layerId: 'layer-C' })
        );

        const result = await moveFeaturesToLayer(['layer-A', 'layer-B'], 'layer-target');

        expect(result).toBe(true);
        const saved = updateMapDataCompat.mock.calls[0][1];
        expect(saved.features.points[0].properties.layerId).toBe('layer-target');
        expect(saved.features.points[1].properties.layerId).toBe('layer-target');
        expect(saved.features.points[2].properties.layerId).toBe('layer-C');
    });

    it('moves features across different storage types', async () => {
        mockMapData.value.features.points.push(
            makeFeature('p1', 'point', { layerId: 'layer-A' })
        );
        mockMapData.value.features.lines.push({
            type: 'Feature',
            id: 'l1',
            geometry: { type: 'LineString', coordinates: [[-43.17, -22.90], [-43.18, -22.91]] },
            properties: { id: 'l1', source: 'line', layerId: 'layer-A' }
        });
        mockMapData.value.features.polygons.push({
            type: 'Feature',
            id: 'pg1',
            geometry: { type: 'Polygon', coordinates: [[[-43.17, -22.90], [-43.18, -22.91], [-43.16, -22.91], [-43.17, -22.90]]] },
            properties: { id: 'pg1', source: 'polygon', layerId: 'layer-B' }
        });

        const result = await moveFeaturesToLayer(['layer-A'], 'layer-target');

        expect(result).toBe(true);
        const saved = updateMapDataCompat.mock.calls[0][1];
        expect(saved.features.points[0].properties.layerId).toBe('layer-target');
        expect(saved.features.lines[0].properties.layerId).toBe('layer-target');
        expect(saved.features.polygons[0].properties.layerId).toBe('layer-B');
    });

    it('treats missing layerId as default', async () => {
        const feature = makeFeature('p1', 'point');
        delete feature.properties.layerId;
        mockMapData.value.features.points.push(feature);

        const result = await moveFeaturesToLayer(['default'], 'layer-target');

        expect(result).toBe(true);
        const saved = updateMapDataCompat.mock.calls[0][1];
        expect(saved.features.points[0].properties.layerId).toBe('layer-target');
    });

    it('returns false when no features match', async () => {
        mockMapData.value.features.points.push(
            makeFeature('p1', 'point', { layerId: 'layer-X' })
        );

        const result = await moveFeaturesToLayer(['layer-nonexistent'], 'layer-target');

        expect(result).toBe(false);
        expect(updateMapDataCompat).not.toHaveBeenCalled();
    });
});

// ============================================================================
// moveFeaturesToLayer - by feature reference array
// ============================================================================

describe('moveFeaturesToLayer (by feature refs)', () => {
    it('moves specific features by type and id', async () => {
        mockMapData.value.features.points.push(
            makeFeature('p1', 'point', { layerId: 'layer-A' }),
            makeFeature('p2', 'point', { layerId: 'layer-A' })
        );

        const featureRefs = [{ type: 'point', id: 'p1' }];
        const result = await moveFeaturesToLayer(featureRefs, 'layer-target');

        expect(result).toBe(true);
        const saved = updateMapDataCompat.mock.calls[0][1];
        expect(saved.features.points[0].properties.layerId).toBe('layer-target');
        expect(saved.features.points[1].properties.layerId).toBe('layer-A');
    });

    it('moves features of different types', async () => {
        mockMapData.value.features.points.push(
            makeFeature('p1', 'point', { layerId: 'layer-A' })
        );
        mockMapData.value.features.lines.push({
            type: 'Feature',
            id: 'l1',
            geometry: { type: 'LineString', coordinates: [[-43.17, -22.90], [-43.18, -22.91]] },
            properties: { id: 'l1', source: 'line', layerId: 'layer-A' }
        });

        const featureRefs = [
            { type: 'point', id: 'p1' },
            { type: 'line', id: 'l1' }
        ];
        const result = await moveFeaturesToLayer(featureRefs, 'layer-B');

        expect(result).toBe(true);
        const saved = updateMapDataCompat.mock.calls[0][1];
        expect(saved.features.points[0].properties.layerId).toBe('layer-B');
        expect(saved.features.lines[0].properties.layerId).toBe('layer-B');
    });
});

// ============================================================================
// Guards
// ============================================================================

describe('moveFeaturesToLayer guards', () => {
    it('returns false on empty refs', async () => {
        const result = await moveFeaturesToLayer([], 'layer-target');
        expect(result).toBe(false);
    });

    it('blocks on locked map', async () => {
        isCurrentMapLockedSync.mockReturnValue(true);
        mockMapData.value.features.points.push(
            makeFeature('p1', 'point', { layerId: 'layer-A' })
        );

        const result = await moveFeaturesToLayer(['layer-A'], 'layer-target');

        expect(result).toBe(false);
        expect(updateMapDataCompat).not.toHaveBeenCalled();
    });

    it('blocks when permission denied', async () => {
        checkPermission.mockReturnValue({ allowed: false, reason: 'NO_EDIT' });
        mockMapData.value.features.points.push(
            makeFeature('p1', 'point', { layerId: 'layer-A' })
        );

        const result = await moveFeaturesToLayer(['layer-A'], 'layer-target');

        expect(result).toBe(false);
        expect(emitStoreError).toHaveBeenCalled();
        // Feature should be unchanged
        expect(mockMapData.value.features.points[0].properties.layerId).toBe('layer-A');
    });
});

// ============================================================================
// moveFeaturesToLayer - persistence and mapName
// ============================================================================

describe('moveFeaturesToLayer - persistence', () => {
    it('persists to correct map when explicit mapName given', async () => {
        mockMapData.value.features.points.push(
            makeFeature('p1', 'point', { layerId: 'layer-A' })
        );

        await moveFeaturesToLayer(['layer-A'], 'layer-target', 'SpecificMap');

        expect(updateMapDataCompat).toHaveBeenCalledWith(
            'SpecificMap',
            expect.objectContaining({
                features: expect.objectContaining({
                    points: expect.arrayContaining([
                        expect.objectContaining({
                            properties: expect.objectContaining({ layerId: 'layer-target' })
                        })
                    ])
                })
            })
        );
    });

    it('does NOT persist when nothing was modified', async () => {
        mockMapData.value.features.points.push(
            makeFeature('p1', 'point', { layerId: 'layer-X' })
        );

        await moveFeaturesToLayer(['layer-nonexistent'], 'layer-target');

        expect(updateMapDataCompat).not.toHaveBeenCalled();
    });

    it('persists exactly once even with many features across types', async () => {
        mockMapData.value.features.points.push(
            makeFeature('p1', 'point', { layerId: 'layer-A' }),
            makeFeature('p2', 'point', { layerId: 'layer-A' })
        );
        mockMapData.value.features.lines.push({
            type: 'Feature', id: 'l1',
            geometry: { type: 'LineString', coordinates: [[-43.17, -22.90], [-43.18, -22.91]] },
            properties: { id: 'l1', source: 'line', layerId: 'layer-A' }
        });

        await moveFeaturesToLayer(['layer-A'], 'layer-target');

        // Single atomic persist, not one per feature
        expect(updateMapDataCompat).toHaveBeenCalledOnce();
    });
});

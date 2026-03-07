import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getEmptyMapData } from '../../src/js/store/repository.utils.js';

// ============================================================================
// Hoisted shared state
// ============================================================================

const { mockMaps, mockMapManager, mockLockedMaps, mockLayers } = vi.hoisted(() => {
    return {
        mockMaps: { value: {} },
        mockMapManager: {
            getCurrentMapName: vi.fn(() => 'SourceMap'),
            getCurrentMapId: vi.fn(() => 'source-uuid'),
            getFeatureColor: vi.fn(() => null),
            getFeatureColors: vi.fn(() => []),
            updateColorUsage: vi.fn(),
            recordAction: vi.fn()
        },
        mockLockedMaps: { value: new Set() },
        mockLayers: { value: {} }
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
    getMapDataCompat: vi.fn(async (mapName) => {
        return mockMaps.value[mapName] || null;
    }),
    updateMapDataCompat: vi.fn(async (mapName, data) => {
        mockMaps.value[mapName] = data;
    }),
    getLayersCompat: vi.fn(async (mapName) => {
        return mockLayers.value[mapName] || [];
    })
}));

vi.mock('../../src/js/store/store-state-manager.js', () => ({
    default: mockMapManager
}));

vi.mock('../../src/js/store/memory-store.js', () => ({
    memoryStore: {
        get lockedMaps() { return mockLockedMaps.value; },
        set lockedMaps(v) { mockLockedMaps.value = v; },
        currentMap: 'SourceMap'
    }
}));

// ============================================================================
// Imports (after mocks)
// ============================================================================

import {
    moveFeaturesToMap,
    getFeatureById,
    setFeatureDependencies
} from '../../src/js/store/feature.operations.js';

import { isCurrentMapLockedSync } from '../../src/js/store/map.operations.js';
import { checkPermission } from '../../src/js/store/sync/permission-guard.js';
import { updateMapDataCompat, getMapDataCompat } from '../../src/js/store/repositories/index.js';
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
            createdAt: 1000,
            updatedAt: 1000,
            version: 1,
            ...extra
        }
    };
}

function makeLineFeature(id, extra = {}) {
    return {
        type: 'Feature',
        id,
        geometry: { type: 'LineString', coordinates: [[-43.17, -22.90], [-43.18, -22.91]] },
        properties: {
            id,
            source: 'line',
            nome: `Line ${id}`,
            layerId: 'default',
            createdAt: 1000,
            updatedAt: 1000,
            version: 1,
            ...extra
        }
    };
}

let layerIdCounter = 0;

// ============================================================================
// Setup
// ============================================================================

beforeEach(() => {
    vi.clearAllMocks();
    layerIdCounter = 0;
    mockLockedMaps.value = new Set();
    isCurrentMapLockedSync.mockReturnValue(false);
    checkPermission.mockReturnValue({ allowed: true });
    mockMapManager.getCurrentMapName.mockReturnValue('SourceMap');
    mockMapManager.getCurrentMapId.mockReturnValue('source-uuid');

    // Default maps
    mockMaps.value = {
        'SourceMap': getEmptyMapData(),
        'TargetMap': getEmptyMapData()
    };

    // Default layers
    mockLayers.value = {
        'SourceMap': [{ id: 'default', name: 'Padrão' }],
        'TargetMap': [{ id: 'default', name: 'Padrão' }]
    };

    setFeatureDependencies({
        groupManager: {
            removeFeatureFromAllGroups: vi.fn()
        },
        layerManager: {
            getLayers: vi.fn((mapName) => mockLayers.value[mapName] || []),
            createLayerForImport: vi.fn((name, mapName) => {
                const newId = `import-layer-${++layerIdCounter}`;
                const newLayer = { id: newId, name };
                if (!mockLayers.value[mapName]) mockLayers.value[mapName] = [];
                mockLayers.value[mapName].push(newLayer);
                return newLayer;
            })
        }
    });
});

// ============================================================================
// moveFeaturesToMap - basic moves
// ============================================================================

describe('moveFeaturesToMap - basic', () => {
    it('moves a point feature: removed from source, added to target', async () => {
        const feature = makeFeature('p1');
        mockMaps.value.SourceMap.features.points.push(feature);

        await moveFeaturesToMap([feature], 'TargetMap');

        // Feature removed from source
        expect(mockMaps.value.SourceMap.features.points).toHaveLength(0);
        // Feature added to target
        expect(mockMaps.value.TargetMap.features.points).toHaveLength(1);
        expect(mockMaps.value.TargetMap.features.points[0].properties.id).toBe('p1');
    });

    it('moved feature goes through cleanFeature (internal props stripped)', async () => {
        const feature = makeFeature('p1');
        feature.properties._vectorTileFeature = {};
        feature.properties._pbf = {};
        feature.properties.layer = 'internal-layer';
        mockMaps.value.SourceMap.features.points.push(feature);

        await moveFeaturesToMap([feature], 'TargetMap');

        const moved = mockMaps.value.TargetMap.features.points[0];
        // cleanFeature strips MapLibre internals
        expect(moved.properties._vectorTileFeature).toBeUndefined();
        expect(moved.properties._pbf).toBeUndefined();
        expect(moved.properties.layer).toBeUndefined();
        // But user properties preserved
        expect(moved.properties.id).toBe('p1');
        expect(moved.properties.nome).toBe('Feature p1');
    });

    it('moved feature gets fresh createdAt timestamp', async () => {
        const feature = makeFeature('p1');
        feature.properties.createdAt = undefined;
        feature.properties.updatedAt = undefined;
        feature.properties.version = undefined;
        mockMaps.value.SourceMap.features.points.push(feature);
        const before = Date.now();

        await moveFeaturesToMap([feature], 'TargetMap');

        const moved = mockMaps.value.TargetMap.features.points[0];
        // addFeature calls addCreatedTimestamp
        expect(moved.properties.createdAt).toBeGreaterThanOrEqual(before);
        expect(moved.properties.version).toBe(1);
    });

    it('moves multiple features of same type', async () => {
        const f1 = makeFeature('p1');
        const f2 = makeFeature('p2');
        mockMaps.value.SourceMap.features.points.push(f1, f2);

        await moveFeaturesToMap([f1, f2], 'TargetMap');

        expect(mockMaps.value.SourceMap.features.points).toHaveLength(0);
        expect(mockMaps.value.TargetMap.features.points).toHaveLength(2);
        const ids = mockMaps.value.TargetMap.features.points.map(f => f.properties.id);
        expect(ids).toContain('p1');
        expect(ids).toContain('p2');
    });

    it('moves features of different types', async () => {
        const point = makeFeature('p1');
        const line = makeLineFeature('l1');
        mockMaps.value.SourceMap.features.points.push(point);
        mockMaps.value.SourceMap.features.lines.push(line);

        await moveFeaturesToMap([point, line], 'TargetMap');

        expect(mockMaps.value.SourceMap.features.points).toHaveLength(0);
        expect(mockMaps.value.SourceMap.features.lines).toHaveLength(0);
        expect(mockMaps.value.TargetMap.features.points).toHaveLength(1);
        expect(mockMaps.value.TargetMap.features.lines).toHaveLength(1);
    });

    it('source map other features are untouched after move', async () => {
        const toMove = makeFeature('p1');
        const toKeep = makeFeature('p2');
        mockMaps.value.SourceMap.features.points.push(toMove, toKeep);

        await moveFeaturesToMap([toMove], 'TargetMap');

        expect(mockMaps.value.SourceMap.features.points).toHaveLength(1);
        expect(mockMaps.value.SourceMap.features.points[0].properties.id).toBe('p2');
    });

    it('records undo action with batch operation details', async () => {
        const feature = makeFeature('p1');
        mockMaps.value.SourceMap.features.points.push(feature);

        await moveFeaturesToMap([feature], 'TargetMap');

        expect(mockMapManager.recordAction).toHaveBeenCalledOnce();
        const action = mockMapManager.recordAction.mock.calls[0][0];
        expect(action.type).toBe('moveBetweenMaps');
        expect(action.sourceMapName).toBe('SourceMap');
        expect(action.targetMapName).toBe('TargetMap');
        expect(action.movedFeatures).toHaveProperty('points');
    });

    it('calls updateMapDataCompat for both source and target maps', async () => {
        const feature = makeFeature('p1');
        mockMaps.value.SourceMap.features.points.push(feature);

        await moveFeaturesToMap([feature], 'TargetMap');

        // removeFeatureFromMap persists source, addFeature persists target
        const calledMaps = updateMapDataCompat.mock.calls.map(c => c[0]);
        expect(calledMaps).toContain('SourceMap');
        expect(calledMaps).toContain('TargetMap');
    });
});

// ============================================================================
// moveFeaturesToMap - layer mapping
// ============================================================================

describe('moveFeaturesToMap - layer mapping', () => {
    it('maps default layer to default in target', async () => {
        const feature = makeFeature('p1', 'point', { layerId: 'default' });
        mockMaps.value.SourceMap.features.points.push(feature);

        await moveFeaturesToMap([feature], 'TargetMap');

        const moved = mockMaps.value.TargetMap.features.points[0];
        expect(moved.properties.layerId).toBe('default');
    });

    it('creates matching layer in target and assigns its ID to moved feature', async () => {
        mockLayers.value.SourceMap = [
            { id: 'default', name: 'Padrão' },
            { id: 'layer-custom', name: 'Reconhecimento' }
        ];
        mockLayers.value.TargetMap = [
            { id: 'default', name: 'Padrão' }
        ];

        const feature = makeFeature('p1', 'point', { layerId: 'layer-custom' });
        mockMaps.value.SourceMap.features.points.push(feature);

        await moveFeaturesToMap([feature], 'TargetMap');

        // New layer created in target with same name
        const targetLayers = mockLayers.value.TargetMap;
        const createdLayer = targetLayers.find(l => l.name === 'Reconhecimento');
        expect(createdLayer).toBeDefined();

        // Moved feature uses the NEW layer's ID (not the source ID)
        const moved = mockMaps.value.TargetMap.features.points[0];
        expect(moved.properties.layerId).toBe(createdLayer.id);
        expect(moved.properties.layerId).not.toBe('layer-custom');
    });

    it('reuses existing layer in target when name matches', async () => {
        mockLayers.value.SourceMap = [
            { id: 'default', name: 'Padrão' },
            { id: 'src-layer', name: 'Shared Layer' }
        ];
        mockLayers.value.TargetMap = [
            { id: 'default', name: 'Padrão' },
            { id: 'tgt-layer', name: 'Shared Layer' }
        ];

        const feature = makeFeature('p1', 'point', { layerId: 'src-layer' });
        mockMaps.value.SourceMap.features.points.push(feature);

        await moveFeaturesToMap([feature], 'TargetMap');

        const moved = mockMaps.value.TargetMap.features.points[0];
        // Feature mapped to target's existing layer ID, not source's
        expect(moved.properties.layerId).toBe('tgt-layer');
        expect(moved.properties.layerId).not.toBe('src-layer');
        // No new layers created (still only 2)
        expect(mockLayers.value.TargetMap).toHaveLength(2);
    });

    it('maps to default when source layer not found in source layers list', async () => {
        // Source has only 'default'; feature references an orphan layer ID
        mockLayers.value.SourceMap = [{ id: 'default', name: 'Padrão' }];

        const feature = makeFeature('p1', 'point', { layerId: 'orphan-layer' });
        mockMaps.value.SourceMap.features.points.push(feature);

        await moveFeaturesToMap([feature], 'TargetMap');

        const moved = mockMaps.value.TargetMap.features.points[0];
        expect(moved.properties.layerId).toBe('default');
        // No new layers created in target
        expect(mockLayers.value.TargetMap).toHaveLength(1);
    });

    it('creates layer only once when multiple features share the same source layer', async () => {
        mockLayers.value.SourceMap = [
            { id: 'default', name: 'Padrão' },
            { id: 'shared-src', name: 'Operações' }
        ];
        mockLayers.value.TargetMap = [
            { id: 'default', name: 'Padrão' }
        ];

        const f1 = makeFeature('p1', 'point', { layerId: 'shared-src' });
        const f2 = makeFeature('p2', 'point', { layerId: 'shared-src' });
        mockMaps.value.SourceMap.features.points.push(f1, f2);

        await moveFeaturesToMap([f1, f2], 'TargetMap');

        // Only one new layer created (not two)
        const opLayers = mockLayers.value.TargetMap.filter(l => l.name === 'Operações');
        expect(opLayers).toHaveLength(1);

        // Both features mapped to the same new layer ID
        const moved = mockMaps.value.TargetMap.features.points;
        expect(moved[0].properties.layerId).toBe(opLayers[0].id);
        expect(moved[1].properties.layerId).toBe(opLayers[0].id);
    });
});

// ============================================================================
// moveFeaturesToMap - guards
// ============================================================================

describe('moveFeaturesToMap - guards', () => {
    it('no-ops with empty features array', async () => {
        await moveFeaturesToMap([], 'TargetMap');

        expect(updateMapDataCompat).not.toHaveBeenCalled();
        expect(getMapDataCompat).not.toHaveBeenCalled();
    });

    it('no-ops with null features', async () => {
        await moveFeaturesToMap(null, 'TargetMap');

        expect(updateMapDataCompat).not.toHaveBeenCalled();
        expect(getMapDataCompat).not.toHaveBeenCalled();
    });

    it('checks permission BEFORE checking lock', async () => {
        checkPermission.mockReturnValue({ allowed: false, reason: 'VIEWER' });
        isCurrentMapLockedSync.mockReturnValue(true);
        const feature = makeFeature('p1');
        mockMaps.value.SourceMap.features.points.push(feature);

        await moveFeaturesToMap([feature], 'TargetMap');

        // Permission checked first; lock never reached
        expect(checkPermission).toHaveBeenCalled();
        expect(isCurrentMapLockedSync).not.toHaveBeenCalled();
    });

    it('blocks when source map is locked: both maps unchanged', async () => {
        isCurrentMapLockedSync.mockReturnValue(true);
        const feature = makeFeature('p1');
        mockMaps.value.SourceMap.features.points.push(feature);

        await moveFeaturesToMap([feature], 'TargetMap');

        // Source untouched
        expect(mockMaps.value.SourceMap.features.points).toHaveLength(1);
        expect(mockMaps.value.SourceMap.features.points[0].properties.id).toBe('p1');
        // Target empty
        expect(mockMaps.value.TargetMap.features.points).toHaveLength(0);
        expect(updateMapDataCompat).not.toHaveBeenCalled();
    });

    it('blocks when target map is locked: both maps unchanged', async () => {
        mockLockedMaps.value = new Set(['TargetMap']);
        const feature = makeFeature('p1');
        mockMaps.value.SourceMap.features.points.push(feature);

        await moveFeaturesToMap([feature], 'TargetMap');

        // Source untouched
        expect(mockMaps.value.SourceMap.features.points).toHaveLength(1);
        // Target empty
        expect(mockMaps.value.TargetMap.features.points).toHaveLength(0);
        expect(updateMapDataCompat).not.toHaveBeenCalled();
    });

    it('blocks when moving to same map: feature stays, no persistence', async () => {
        const feature = makeFeature('p1');
        mockMaps.value.SourceMap.features.points.push(feature);

        await moveFeaturesToMap([feature], 'SourceMap');

        expect(mockMaps.value.SourceMap.features.points).toHaveLength(1);
        expect(updateMapDataCompat).not.toHaveBeenCalled();
    });

    it('throws when target map does not exist', async () => {
        const feature = makeFeature('p1');
        mockMaps.value.SourceMap.features.points.push(feature);

        await expect(moveFeaturesToMap([feature], 'NonexistentMap'))
            .rejects.toThrow('Target map "NonexistentMap" not found');

        // Source untouched after error
        expect(mockMaps.value.SourceMap.features.points).toHaveLength(1);
    });

    it('blocks when permission denied: emits correct error details', async () => {
        checkPermission.mockReturnValue({ allowed: false, reason: 'NO_EDIT' });
        const feature = makeFeature('p1');
        mockMaps.value.SourceMap.features.points.push(feature);

        await moveFeaturesToMap([feature], 'TargetMap');

        // Source untouched
        expect(mockMaps.value.SourceMap.features.points).toHaveLength(1);
        // Target empty
        expect(mockMaps.value.TargetMap.features.points).toHaveLength(0);
        // Exact error emission
        expect(emitStoreError).toHaveBeenCalledWith(
            'store:operationBlocked',
            expect.objectContaining({ operation: 'moveFeaturesToMap', reason: 'NO_EDIT' })
        );
    });
});

// ============================================================================
// moveFeaturesToMap - processed features (LOS)
// ============================================================================

describe('moveFeaturesToMap - processed features', () => {
    it('removes LOS feature and its processed features from source', async () => {
        const losFeature = makeFeature('los1', 'los');
        mockMaps.value.SourceMap.features.los.push(losFeature);
        mockMaps.value.SourceMap.features.processed_los.push(
            {
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: [[-43.17, -22.90], [-43.18, -22.91]] },
                properties: { id: 'los1-visible', source: 'processed_los' }
            },
            {
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: [[-43.17, -22.90], [-43.19, -22.92]] },
                properties: { id: 'los1-obstructed', source: 'processed_los' }
            }
        );

        await moveFeaturesToMap([losFeature], 'TargetMap');

        // LOS removed from source
        expect(mockMaps.value.SourceMap.features.los).toHaveLength(0);
        // Processed also removed from source
        expect(mockMaps.value.SourceMap.features.processed_los).toHaveLength(0);
        // LOS added to target
        expect(mockMaps.value.TargetMap.features.los).toHaveLength(1);
        expect(mockMaps.value.TargetMap.features.los[0].properties.id).toBe('los1');
    });

    it('processed features re-added to target map', async () => {
        const losFeature = makeFeature('los1', 'los');
        mockMaps.value.SourceMap.features.los.push(losFeature);
        mockMaps.value.SourceMap.features.processed_los.push(
            {
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: [[-43.17, -22.90], [-43.18, -22.91]] },
                properties: { id: 'los1-visible', source: 'processed_los' }
            },
            {
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: [[-43.17, -22.90], [-43.19, -22.92]] },
                properties: { id: 'los1-obstructed', source: 'processed_los' }
            }
        );

        await moveFeaturesToMap([losFeature], 'TargetMap');

        // Processed features removed from source
        expect(mockMaps.value.SourceMap.features.processed_los).toHaveLength(0);
        // And re-added to target
        expect(mockMaps.value.TargetMap.features.processed_los).toHaveLength(2);
        const ids = mockMaps.value.TargetMap.features.processed_los.map(f => f.properties.id);
        expect(ids).toContain('los1-visible');
        expect(ids).toContain('los1-obstructed');
    });

    it('non-LOS features in source processed_los are preserved', async () => {
        const losFeature = makeFeature('los1', 'los');
        mockMaps.value.SourceMap.features.los.push(losFeature);
        mockMaps.value.SourceMap.features.processed_los.push(
            {
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: [[-43.17, -22.90], [-43.18, -22.91]] },
                properties: { id: 'los1-visible', source: 'processed_los' }
            },
            {
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: [[-43.17, -22.90], [-43.20, -22.93]] },
                properties: { id: 'los2-visible', source: 'processed_los' }
            }
        );

        await moveFeaturesToMap([losFeature], 'TargetMap');

        // Only los1's processed features removed; los2's stay
        expect(mockMaps.value.SourceMap.features.processed_los).toHaveLength(1);
        expect(mockMaps.value.SourceMap.features.processed_los[0].properties.id).toBe('los2-visible');
    });
});

// ============================================================================
// moveFeaturesToMap - fetch features from map (getFeatureById cross-map)
// ============================================================================

describe('getFeatureById for moved features', () => {
    it('finds feature in target map after move with correct properties', async () => {
        const feature = makeFeature('p1', 'point', { nome: 'Posto Obs' });
        mockMaps.value.SourceMap.features.points.push(feature);

        await moveFeaturesToMap([feature], 'TargetMap');

        const found = await getFeatureById('points', 'p1', 'TargetMap');
        expect(found).toBeDefined();
        expect(found.properties.id).toBe('p1');
        expect(found.properties.nome).toBe('Posto Obs');
        expect(found.properties.source).toBe('point');
    });

    it('does not find feature in source map after move', async () => {
        const feature = makeFeature('p1');
        mockMaps.value.SourceMap.features.points.push(feature);

        await moveFeaturesToMap([feature], 'TargetMap');

        const found = await getFeatureById('points', 'p1', 'SourceMap');
        expect(found).toBeUndefined();
    });

    it('finds line feature in target after cross-type move', async () => {
        const line = makeLineFeature('l1');
        mockMaps.value.SourceMap.features.lines.push(line);

        await moveFeaturesToMap([line], 'TargetMap');

        const found = await getFeatureById('lines', 'l1', 'TargetMap');
        expect(found).toBeDefined();
        expect(found.properties.id).toBe('l1');

        const notInSource = await getFeatureById('lines', 'l1', 'SourceMap');
        expect(notInSource).toBeUndefined();
    });
});

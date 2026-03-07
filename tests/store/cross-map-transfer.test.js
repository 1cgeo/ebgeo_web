import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getEmptyMapData } from '../../src/js/store/repository.utils.js';

// ============================================================================
// Hoisted shared state
// ============================================================================

const { mockMaps, mockMapManager, mockLockedMaps, mockLayers } = vi.hoisted(() => {
    return {
        mockMaps: { value: {} },
        mockMapManager: {
            getCurrentMapName: vi.fn(() => 'MapA'),
            getCurrentMapId: vi.fn(() => 'map-a-uuid'),
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
        currentMap: 'MapA'
    }
}));

// ============================================================================
// Imports (after mocks)
// ============================================================================

import {
    addFeature,
    addFeatures,
    moveFeaturesToMap,
    buildLayerMappingForMove,
    setFeatureDependencies,
    getCurrentMapFeatures
} from '../../src/js/store/feature.operations.js';

import { isCurrentMapLockedSync } from '../../src/js/store/map.operations.js';
import { checkPermission } from '../../src/js/store/sync/permission-guard.js';
import { getLayersCompat } from '../../src/js/store/repositories/index.js';

// ============================================================================
// Helpers
// ============================================================================

let layerIdCounter = 0;

function makeFeature(id, type = 'point', extra = {}) {
    const geomType = type === 'line' ? 'LineString' : 'Point';
    const coords = type === 'line'
        ? [[-43.17, -22.90], [-43.18, -22.91]]
        : [-43.2, -22.9];
    const storageType = type === 'line' ? 'lines' : 'points';
    return {
        type: 'Feature',
        id: Date.now() + Math.floor(Math.random() * 10000),
        geometry: { type: geomType, coordinates: coords },
        properties: {
            id,
            source: type,
            nome: `Feature ${id}`,
            cor: '#ff0000',
            layerId: 'default',
            createdAt: 1000,
            updatedAt: 1000,
            version: 1,
            ...extra
        },
        _storageType: storageType
    };
}

function getStorageType(feature) {
    return feature._storageType || 'points';
}

function setupMaps(...mapNames) {
    for (const name of mapNames) {
        if (!mockMaps.value[name]) {
            mockMaps.value[name] = getEmptyMapData();
        }
        if (!mockLayers.value[name]) {
            mockLayers.value[name] = [{ id: 'default', name: 'Padrão', visible: true }];
        }
    }
}

function addLayer(mapName, id, name) {
    mockLayers.value[mapName].push({ id, name, visible: true });
}

function addFeatureToMap(mapName, feature) {
    const st = getStorageType(feature);
    mockMaps.value[mapName].features[st].push(feature);
}

function getFeaturesFromMap(mapName, storageType = 'points') {
    return mockMaps.value[mapName]?.features[storageType] || [];
}

// ============================================================================
// Setup
// ============================================================================

beforeEach(() => {
    vi.clearAllMocks();
    layerIdCounter = 0;
    mockLockedMaps.value = new Set();
    isCurrentMapLockedSync.mockReturnValue(false);
    checkPermission.mockReturnValue({ allowed: true });
    mockMapManager.getCurrentMapName.mockReturnValue('MapA');
    mockMapManager.getCurrentMapId.mockReturnValue('map-a-uuid');
    mockMaps.value = {};
    mockLayers.value = {};

    setFeatureDependencies({
        eventBus: { emit: vi.fn() },
        groupManager: {
            removeFeatureFromAllGroups: vi.fn()
        },
        layerManager: {
            getLayers: vi.fn((mapName) => mockLayers.value[mapName] || []),
            createLayerForImport: vi.fn((name, mapName) => {
                const newId = `import-layer-${++layerIdCounter}`;
                const newLayer = { id: newId, name, visible: true };
                if (!mockLayers.value[mapName]) mockLayers.value[mapName] = [];
                mockLayers.value[mapName].push(newLayer);
                return newLayer;
            }),
            isFeatureEffectivelyVisible: vi.fn(() => true),
            isFeatureEffectivelyLocked: vi.fn(() => false)
        }
    });
});

// ============================================================================
// buildLayerMappingForMove
// ============================================================================

describe('buildLayerMappingForMove', () => {
    it('maps default to default', async () => {
        setupMaps('MapA', 'MapB');
        const features = [makeFeature('f1', 'point', { layerId: 'default' })];

        const mapping = await buildLayerMappingForMove(features, 'MapA', 'MapB');

        expect(mapping.get('default')).toBe('default');
    });

    it('reuses target layer when name matches', async () => {
        setupMaps('MapA', 'MapB');
        addLayer('MapA', 'src-layer', 'Reconhecimento');
        addLayer('MapB', 'tgt-layer', 'Reconhecimento');

        const features = [makeFeature('f1', 'point', { layerId: 'src-layer' })];
        const mapping = await buildLayerMappingForMove(features, 'MapA', 'MapB');

        expect(mapping.get('src-layer')).toBe('tgt-layer');
    });

    it('creates new layer when target has no matching name', async () => {
        setupMaps('MapA', 'MapB');
        addLayer('MapA', 'src-layer', 'Operações');

        const features = [makeFeature('f1', 'point', { layerId: 'src-layer' })];
        const mapping = await buildLayerMappingForMove(features, 'MapA', 'MapB');

        const newLayerId = mapping.get('src-layer');
        expect(newLayerId).toBeDefined();
        expect(newLayerId).not.toBe('src-layer');
        expect(newLayerId).not.toBe('default');
    });

    it('creates layer only once for multiple features sharing same source layer', async () => {
        setupMaps('MapA', 'MapB');
        addLayer('MapA', 'shared', 'Operações');

        const features = [
            makeFeature('f1', 'point', { layerId: 'shared' }),
            makeFeature('f2', 'point', { layerId: 'shared' })
        ];
        const mapping = await buildLayerMappingForMove(features, 'MapA', 'MapB');

        // Both get the same new layer ID
        expect(mapping.get('shared')).toBeDefined();
        // Only one layer created (default + new = 2)
        const opLayers = mockLayers.value.MapB.filter(l => l.name === 'Operações');
        expect(opLayers).toHaveLength(1);
    });

    it('maps orphan layerId (not in source layers) to default', async () => {
        setupMaps('MapA', 'MapB');
        const features = [makeFeature('f1', 'point', { layerId: 'nonexistent' })];

        const mapping = await buildLayerMappingForMove(features, 'MapA', 'MapB');

        expect(mapping.get('nonexistent')).toBe('default');
    });

    it('handles features from multiple different layers', async () => {
        setupMaps('MapA', 'MapB');
        addLayer('MapA', 'layer-1', 'Camada 1');
        addLayer('MapA', 'layer-2', 'Camada 2');
        addLayer('MapB', 'existing', 'Camada 1');

        const features = [
            makeFeature('f1', 'point', { layerId: 'layer-1' }),
            makeFeature('f2', 'point', { layerId: 'layer-2' }),
            makeFeature('f3', 'point', { layerId: 'default' })
        ];
        const mapping = await buildLayerMappingForMove(features, 'MapA', 'MapB');

        // layer-1 maps to existing target layer
        expect(mapping.get('layer-1')).toBe('existing');
        // layer-2 creates new layer
        expect(mapping.get('layer-2')).toBeDefined();
        expect(mapping.get('layer-2')).not.toBe('layer-2');
        // default maps to default
        expect(mapping.get('default')).toBe('default');
    });

    it('reads target layers from IndexedDB, not memory cache', async () => {
        setupMaps('MapA', 'MapB');
        addLayer('MapA', 'src-layer', 'TestLayer');

        const features = [makeFeature('f1', 'point', { layerId: 'src-layer' })];
        await buildLayerMappingForMove(features, 'MapA', 'MapB');

        // Verify getLayersCompat (IndexedDB) was called for BOTH maps
        expect(getLayersCompat).toHaveBeenCalledWith('MapA');
        expect(getLayersCompat).toHaveBeenCalledWith('MapB');
    });
});

// ============================================================================
// Cross-map addFeature - layerId preserved
// ============================================================================

describe('addFeature - cross-map layer consistency', () => {
    it('preserves layerId when adding feature to another map', async () => {
        setupMaps('MapA', 'MapB');
        mockMapManager.getCurrentMapName.mockReturnValue('MapB');

        const feature = makeFeature('f1', 'point', { layerId: 'target-layer' });
        await addFeature('points', feature, 'MapB');

        const stored = getFeaturesFromMap('MapB', 'points');
        expect(stored).toHaveLength(1);
        expect(stored[0].properties.layerId).toBe('target-layer');
    });

    it('existing features not lost when adding new feature', async () => {
        setupMaps('MapB');
        mockMapManager.getCurrentMapName.mockReturnValue('MapB');

        // Existing feature (from paste)
        const existing = makeFeature('existing', 'point', { layerId: 'layer-1' });
        addFeatureToMap('MapB', existing);

        // New feature added (from combine)
        const incoming = makeFeature('incoming', 'point', { layerId: 'layer-1' });
        await addFeature('points', incoming, 'MapB');

        const stored = getFeaturesFromMap('MapB', 'points');
        expect(stored).toHaveLength(2);
        expect(stored.map(f => f.properties.id)).toContain('existing');
        expect(stored.map(f => f.properties.id)).toContain('incoming');
    });

    it('multiple sequential addFeature calls preserve all features', async () => {
        setupMaps('MapB');
        mockMapManager.getCurrentMapName.mockReturnValue('MapB');

        // Simulate paste: one feature already in store
        const pasted = makeFeature('pasted', 'point', { layerId: 'layer-x' });
        addFeatureToMap('MapB', pasted);

        // Simulate combine: add 3 more features sequentially
        for (let i = 0; i < 3; i++) {
            const f = makeFeature(`combined-${i}`, 'point', { layerId: 'layer-x' });
            await addFeature('points', f, 'MapB');
        }

        const stored = getFeaturesFromMap('MapB', 'points');
        expect(stored).toHaveLength(4);
        expect(stored[0].properties.id).toBe('pasted');
    });
});

// ============================================================================
// Cross-map paste + combine scenario
// ============================================================================

describe('paste then combine - feature survival', () => {
    it('pasted feature survives when same features are pulled via combine', async () => {
        setupMaps('MapA', 'MapB');
        addLayer('MapA', 'camada-a', 'Operações');
        mockMapManager.getCurrentMapName.mockReturnValue('MapB');

        // Step 1: Simulate paste from MapA to MapB
        // buildLayerMappingForMove creates "Operações" layer in MapB
        const pasteFeatures = [makeFeature('orig', 'point', { layerId: 'camada-a' })];
        const pasteMapping = await buildLayerMappingForMove(pasteFeatures, 'MapA', 'MapB');
        const pastedLayerId = pasteMapping.get('camada-a');

        // Apply mapping and add pasted feature
        const pastedFeature = makeFeature('pasted-copy', 'point', { layerId: pastedLayerId });
        await addFeature('points', pastedFeature, 'MapB');

        // Verify pasted feature in store with correct layerId
        let mapBFeatures = getFeaturesFromMap('MapB', 'points');
        expect(mapBFeatures).toHaveLength(1);
        expect(mapBFeatures[0].properties.layerId).toBe(pastedLayerId);

        // Step 2: Simulate combine from MapA to MapB
        // Add original feature to MapA store
        const origFeature = makeFeature('orig', 'point', { layerId: 'camada-a' });
        addFeatureToMap('MapA', origFeature);

        // buildLayerMappingForMove should find existing "Operações" layer in MapB
        const combineMapping = await buildLayerMappingForMove(
            [origFeature], 'MapA', 'MapB'
        );
        const combinedLayerId = combineMapping.get('camada-a');

        // Critical: paste and combine should resolve to the SAME layer ID
        expect(combinedLayerId).toBe(pastedLayerId);

        // Add combined feature
        const combinedFeature = makeFeature('combined-copy', 'point', { layerId: combinedLayerId });
        await addFeature('points', combinedFeature, 'MapB');

        // Both features must exist in MapB
        mapBFeatures = getFeaturesFromMap('MapB', 'points');
        expect(mapBFeatures).toHaveLength(2);

        const ids = mapBFeatures.map(f => f.properties.id);
        expect(ids).toContain('pasted-copy');
        expect(ids).toContain('combined-copy');

        // Both reference the same layer
        const layerIds = mapBFeatures.map(f => f.properties.layerId);
        expect(layerIds[0]).toBe(layerIds[1]);
    });

    it('consistent layer mapping: paste and combine resolve same layer name to same ID', async () => {
        setupMaps('MapA', 'MapB');
        addLayer('MapA', 'src-l1', 'Alpha');
        addLayer('MapA', 'src-l2', 'Beta');

        // First call (paste path)
        const features1 = [
            makeFeature('f1', 'point', { layerId: 'src-l1' }),
            makeFeature('f2', 'point', { layerId: 'src-l2' })
        ];
        const mapping1 = await buildLayerMappingForMove(features1, 'MapA', 'MapB');

        // Second call (combine path) should find layers already created
        const features2 = [
            makeFeature('f3', 'point', { layerId: 'src-l1' }),
            makeFeature('f4', 'point', { layerId: 'src-l2' })
        ];
        const mapping2 = await buildLayerMappingForMove(features2, 'MapA', 'MapB');

        // Same source layer IDs must resolve to same target IDs
        expect(mapping1.get('src-l1')).toBe(mapping2.get('src-l1'));
        expect(mapping1.get('src-l2')).toBe(mapping2.get('src-l2'));
    });
});

// ============================================================================
// addFeatures (bulk) - consistency
// ============================================================================

describe('addFeatures - bulk cross-map', () => {
    it('adds features of different types in a single call', async () => {
        setupMaps('MapB');
        mockMapManager.getCurrentMapName.mockReturnValue('MapB');

        await addFeatures({
            points: [makeFeature('p1')],
            lines: [makeFeature('l1', 'line')]
        }, 'MapB');

        expect(getFeaturesFromMap('MapB', 'points')).toHaveLength(1);
        expect(getFeaturesFromMap('MapB', 'lines')).toHaveLength(1);
    });

    it('bulk add does not overwrite existing features', async () => {
        setupMaps('MapB');
        mockMapManager.getCurrentMapName.mockReturnValue('MapB');

        // Pre-existing feature
        addFeatureToMap('MapB', makeFeature('existing'));

        await addFeatures({
            points: [makeFeature('new1'), makeFeature('new2')]
        }, 'MapB');

        const stored = getFeaturesFromMap('MapB', 'points');
        expect(stored).toHaveLength(3);
        expect(stored.map(f => f.properties.id)).toContain('existing');
    });
});

// ============================================================================
// moveFeaturesToMap - cross-layer scenarios
// ============================================================================

describe('moveFeaturesToMap - cross-layer edge cases', () => {
    beforeEach(() => {
        setupMaps('MapA', 'MapB');
        mockMapManager.getCurrentMapName.mockReturnValue('MapA');
    });

    it('feature with no layerId keeps undefined (MapLibre coalesces to default)', async () => {
        const feature = makeFeature('f1', 'point');
        delete feature.properties.layerId;
        addFeatureToMap('MapA', feature);

        await moveFeaturesToMap([feature], 'MapB');

        const moved = getFeaturesFromMap('MapB', 'points')[0];
        // layerId stays undefined; MapLibre filter uses coalesce to treat as 'default'
        expect(moved.properties.layerId).toBeUndefined();
    });

    it('multiple features from different layers all get correct mapping', async () => {
        addLayer('MapA', 'la-1', 'Camada 1');
        addLayer('MapA', 'la-2', 'Camada 2');
        addLayer('MapB', 'lb-1', 'Camada 1');

        const f1 = makeFeature('f1', 'point', { layerId: 'la-1' });
        const f2 = makeFeature('f2', 'point', { layerId: 'la-2' });
        const f3 = makeFeature('f3', 'point', { layerId: 'default' });
        addFeatureToMap('MapA', f1);
        addFeatureToMap('MapA', f2);
        addFeatureToMap('MapA', f3);

        await moveFeaturesToMap([f1, f2, f3], 'MapB');

        const moved = getFeaturesFromMap('MapB', 'points');
        expect(moved).toHaveLength(3);

        const movedF1 = moved.find(f => f.properties.id === 'f1');
        const movedF2 = moved.find(f => f.properties.id === 'f2');
        const movedF3 = moved.find(f => f.properties.id === 'f3');

        // f1: source "Camada 1" -> target "Camada 1" (existing)
        expect(movedF1.properties.layerId).toBe('lb-1');
        // f2: source "Camada 2" -> new layer created
        expect(movedF2.properties.layerId).not.toBe('la-2');
        expect(movedF2.properties.layerId).not.toBe('default');
        // f3: default -> default
        expect(movedF3.properties.layerId).toBe('default');
    });

    it('move preserves feature properties except layerId and internal props', async () => {
        addLayer('MapA', 'src-layer', 'TestLayer');

        const feature = makeFeature('f1', 'point', {
            layerId: 'src-layer',
            nome: 'Ponto Observação',
            cor: '#00ff00',
            descricao: 'Posto avançado',
            visivel: true
        });
        addFeatureToMap('MapA', feature);

        await moveFeaturesToMap([feature], 'MapB');

        const moved = getFeaturesFromMap('MapB', 'points')[0];
        expect(moved.properties.nome).toBe('Ponto Observação');
        expect(moved.properties.cor).toBe('#00ff00');
        expect(moved.properties.descricao).toBe('Posto avançado');
        // layerId remapped, not original
        expect(moved.properties.layerId).not.toBe('src-layer');
    });
});

// ============================================================================
// Edge cases: empty layers, no features
// ============================================================================

describe('cross-map edge cases', () => {
    it('buildLayerMappingForMove with empty features array returns empty mapping', async () => {
        setupMaps('MapA', 'MapB');

        const mapping = await buildLayerMappingForMove([], 'MapA', 'MapB');

        // No features = no layer IDs to map
        expect(mapping.size).toBe(0);
    });

    it('buildLayerMappingForMove when source has no layers', async () => {
        setupMaps('MapA', 'MapB');
        mockLayers.value.MapA = [];

        const features = [makeFeature('f1', 'point', { layerId: 'some-layer' })];
        const mapping = await buildLayerMappingForMove(features, 'MapA', 'MapB');

        // Orphan layer maps to default
        expect(mapping.get('some-layer')).toBe('default');
    });

    it('buildLayerMappingForMove when target has no layers', async () => {
        setupMaps('MapA', 'MapB');
        addLayer('MapA', 'src-layer', 'Camada');
        mockLayers.value.MapB = [];

        const features = [makeFeature('f1', 'point', { layerId: 'src-layer' })];
        const mapping = await buildLayerMappingForMove(features, 'MapA', 'MapB');

        // New layer created
        expect(mapping.get('src-layer')).toBeDefined();
        expect(mapping.get('src-layer')).not.toBe('src-layer');
    });

    it('feature with layerId that matches no source layer but matches target name', async () => {
        setupMaps('MapA', 'MapB');
        // Source has no layers matching
        mockLayers.value.MapA = [{ id: 'default', name: 'Padrão' }];
        addLayer('MapB', 'tgt-layer', 'Special');

        const features = [makeFeature('f1', 'point', { layerId: 'orphan' })];
        const mapping = await buildLayerMappingForMove(features, 'MapA', 'MapB');

        // Orphan maps to default (source layer not found)
        expect(mapping.get('orphan')).toBe('default');
    });

    it('handles concurrent layer creation correctly (same name from different sources)', async () => {
        setupMaps('MapA', 'MapB', 'MapC');
        addLayer('MapA', 'layer-a', 'Shared');
        addLayer('MapC', 'layer-c', 'Shared');

        // First mapping: MapA -> MapB creates "Shared" layer
        const features1 = [makeFeature('f1', 'point', { layerId: 'layer-a' })];
        const mapping1 = await buildLayerMappingForMove(features1, 'MapA', 'MapB');

        // Second mapping: MapC -> MapB should reuse the same "Shared" layer
        const features2 = [makeFeature('f2', 'point', { layerId: 'layer-c' })];
        const mapping2 = await buildLayerMappingForMove(features2, 'MapC', 'MapB');

        // Both mappings should resolve to the same target layer (same name)
        expect(mapping1.get('layer-a')).toBe(mapping2.get('layer-c'));

        // Only one "Shared" layer in MapB
        const sharedLayers = mockLayers.value.MapB.filter(l => l.name === 'Shared');
        expect(sharedLayers).toHaveLength(1);
    });
});

// ============================================================================
// getCurrentMapFeatures - data integrity
// ============================================================================

describe('getCurrentMapFeatures - data after cross-map ops', () => {
    it('returns all features including those added via addFeature', async () => {
        setupMaps('MapB');
        mockMapManager.getCurrentMapName.mockReturnValue('MapB');

        addFeatureToMap('MapB', makeFeature('pre-existing'));
        await addFeature('points', makeFeature('added'), 'MapB');

        const features = await getCurrentMapFeatures('MapB');
        expect(features.points).toHaveLength(2);
    });

    it('returns deep clone - modifications do not affect store', async () => {
        setupMaps('MapB');
        mockMapManager.getCurrentMapName.mockReturnValue('MapB');
        addFeatureToMap('MapB', makeFeature('f1'));

        const features = await getCurrentMapFeatures('MapB');
        features.points[0].properties.nome = 'MODIFIED';

        const freshFeatures = await getCurrentMapFeatures('MapB');
        expect(freshFeatures.points[0].properties.nome).toBe('Feature f1');
    });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getEmptyMapData } from '../../src/js/store/repository.utils.js';

// ============================================================================
// Hoisted shared state
//
// Two separate worlds on purpose: `mockLayers` is the REPOSITORY (what a map
// has on disk) and `mockMemoryLayers` is `memoryStore.layers` (what has been
// hydrated this session). The whole point of transferLayerToMap is that it
// reads and writes the first for a destination map that may be absent from the
// second, so a test that conflates them would prove nothing.
// ============================================================================

const {
    mockMaps,
    mockLayers,
    mockMemoryLayers,
    mockActiveLayerId,
    mockLockedMaps,
    mockMapManager,
    mockImages,
    failingMaps
} = vi.hoisted(() => ({
    mockMaps: { value: {} },
    mockLayers: { value: {} },
    mockMemoryLayers: { value: {} },
    mockActiveLayerId: { value: 'default' },
    mockLockedMaps: { value: new Set() },
    mockMapManager: {
        getCurrentMapName: vi.fn(() => 'MapA'),
        getCurrentMapId: vi.fn(() => 'map-a-uuid'),
        getFeatureColor: vi.fn(() => null),
        getFeatureColors: vi.fn(() => []),
        updateColorUsage: vi.fn(),
        recordAction: vi.fn()
    },
    mockImages: { value: new Map() },
    failingMaps: { value: new Set() }
}));

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
    logLayerOperation: vi.fn().mockResolvedValue(undefined),
    OperationType: { CREATE: 'CREATE', UPDATE: 'UPDATE', DELETE: 'DELETE' }
}));

vi.mock('../../src/js/store/sync/permission-guard.js', () => ({
    checkPermission: vi.fn(() => ({ allowed: true })),
    GuardAction: {
        CREATE_FEATURE: 'EDIT',
        UPDATE_FEATURE: 'EDIT',
        DELETE_FEATURE: 'DELETE',
        CREATE_LAYER: 'EDIT',
        UPDATE_LAYER: 'EDIT',
        DELETE_LAYER: 'DELETE'
    }
}));

vi.mock('../../src/js/store/settings.operations.js', () => ({
    getImage: vi.fn(async (id) => mockImages.value.get(id) || null),
    storeImage: vi.fn(async (id, blob) => { mockImages.value.set(id, blob); }),
    removeImage: vi.fn(async (id) => { mockImages.value.delete(id); })
}));

vi.mock('../../src/js/store/repositories/index.js', () => ({
    getMapDataCompat: vi.fn(async (mapName) => mockMaps.value[mapName] || null),
    updateMapDataCompat: vi.fn(async (mapName, data) => {
        if (failingMaps.value.has(mapName)) {
            throw new Error(`IndexedDB write refused for ${mapName}`);
        }
        mockMaps.value[mapName] = data;
    }),
    getLayersCompat: vi.fn(async (mapName) => mockLayers.value[mapName] || []),
    setLayersCompat: vi.fn(async (mapName, layers) => {
        mockLayers.value[mapName] = layers;
    }),
    setActiveLayerIdCompat: vi.fn(async () => {})
}));

vi.mock('../../src/js/store/store-state-manager.js', () => ({
    default: mockMapManager
}));

vi.mock('../../src/js/store/memory-store.js', () => ({
    memoryStore: {
        get lockedMaps() { return mockLockedMaps.value; },
        get layers() { return mockMemoryLayers.value; },
        set layers(v) { mockMemoryLayers.value = v; },
        get activeLayerId() { return mockActiveLayerId.value; },
        set activeLayerId(v) { mockActiveLayerId.value = v; },
        currentMap: 'MapA'
    }
}));

// ============================================================================
// Imports (after mocks)
// ============================================================================

import {
    transferLayerToMap,
    setLayerTransferDependencies
} from '../../src/js/store/layer-transfer.operations.js';
import { TransferMode } from '../../src/js/store/layer-transfer.model.js';
import { setFeatureDependencies } from '../../src/js/store/feature.operations.js';
import { setLayerDependencies } from '../../src/js/store/layer.operations.js';

import { isCurrentMapLockedSync } from '../../src/js/store/map.operations.js';
import { checkPermission } from '../../src/js/store/sync/permission-guard.js';
import { emitStoreError } from '../../src/js/store/store-errors.js';
import { getImage, storeImage, removeImage } from '../../src/js/store/settings.operations.js';
import { setLayersCompat } from '../../src/js/store/repositories/index.js';

// ============================================================================
// Helpers
// ============================================================================

function makeFeature(id, source = 'point', extra = {}) {
    const isLine = source === 'line';
    return {
        type: 'Feature',
        id: 1000 + Math.floor(Math.random() * 9000),
        geometry: isLine
            ? { type: 'LineString', coordinates: [[-43.17, -22.90], [-43.18, -22.91]] }
            : { type: 'Point', coordinates: [-43.2, -22.9] },
        properties: {
            id,
            source,
            nome: `Feição ${id}`,
            layerId: 'l1',
            createdAt: 1000,
            updatedAt: 1000,
            version: 1,
            ...extra
        }
    };
}

const STORAGE_BY_SOURCE = { point: 'points', line: 'lines', image: 'images', los: 'los' };

function setupMap(mapName, layers) {
    mockMaps.value[mapName] = getEmptyMapData();
    mockLayers.value[mapName] = layers;
}

function hydrate(mapName) {
    mockMemoryLayers.value[mapName] = new Map(
        (mockLayers.value[mapName] || []).map(layer => [layer.id, layer])
    );
}

function addFeatureTo(mapName, feature) {
    const storageType = STORAGE_BY_SOURCE[feature.properties.source] || 'points';
    mockMaps.value[mapName].features[storageType].push(feature);
}

function featuresOf(mapName, storageType = 'points') {
    return mockMaps.value[mapName]?.features[storageType] || [];
}

function allFeaturesOf(mapName) {
    return Object.values(mockMaps.value[mapName]?.features || {}).flat();
}

function layerNames(mapName) {
    return (mockLayers.value[mapName] || []).map(l => l.name);
}

function makeLayerManager() {
    return {
        getLayers: vi.fn((mapName) =>
            Array.from((mockMemoryLayers.value[mapName || 'MapA'] || new Map()).values())
        ),
        getLayerById: vi.fn((layerId, mapName) =>
            (mockMemoryLayers.value[mapName || 'MapA'] || new Map()).get(layerId) || null
        ),
        deleteLayer: vi.fn((layerId, mapName) => {
            const target = mapName || 'MapA';
            const layersMap = mockMemoryLayers.value[target];
            if (!layersMap || !layersMap.has(layerId)) {
                throw new Error(`Layer ${layerId} not found.`);
            }
            layersMap.delete(layerId);
            mockLayers.value[target] = Array.from(layersMap.values());
            return { success: true, deletedLayerId: layerId, createdDefaultLayer: null };
        }),
        // NEGATIVE CONTROL: the memory-write path is what silently overwrites the
        // real layers of a map that was never hydrated. If transferLayerToMap ever
        // reaches for it, every test in this file fails loudly instead of passing
        // while corrupting a map nobody looked at.
        createLayerForImport: vi.fn(() => {
            throw new Error('createLayerForImport must never be called by transferLayerToMap');
        }),
        loadLayersToMemory: vi.fn(() => {
            throw new Error('loadLayersToMemory must never be called by transferLayerToMap');
        }),
        setActiveLayer: vi.fn(() => {
            throw new Error('setActiveLayer must never be called by transferLayerToMap');
        }),
        isFeatureEffectivelyVisible: vi.fn(() => true),
        isFeatureEffectivelyLocked: vi.fn(() => false)
    };
}

let layerManager;
let groupManager;
let eventBus;

// ============================================================================
// Setup
// ============================================================================

beforeEach(() => {
    vi.clearAllMocks();

    mockMaps.value = {};
    mockLayers.value = {};
    mockMemoryLayers.value = {};
    mockActiveLayerId.value = 'outra-camada';
    mockLockedMaps.value = new Set();
    mockImages.value = new Map();
    failingMaps.value = new Set();

    isCurrentMapLockedSync.mockReturnValue(false);
    checkPermission.mockReturnValue({ allowed: true });
    mockMapManager.getCurrentMapName.mockReturnValue('MapA');
    mockMapManager.getFeatureColors.mockReturnValue([]);

    layerManager = makeLayerManager();
    groupManager = { removeFeatureFromAllGroups: vi.fn() };
    eventBus = { emit: vi.fn() };

    const dependencies = { eventBus, groupManager, layerManager };
    setLayerTransferDependencies(dependencies);
    setFeatureDependencies(dependencies);
    setLayerDependencies(dependencies);

    // Source map: layer "l1" ("Inimigo") plus an unrelated active layer.
    setupMap('MapA', [
        { id: 'outra-camada', name: 'Padrão', visible: true, locked: false, opacity: 1, order: 0 },
        { id: 'l1', name: 'Inimigo', visible: false, locked: false, opacity: 0.4, order: 1 }
    ]);
    hydrate('MapA');
});

// ============================================================================
// Argument validation (developer bugs -> throw)
// ============================================================================

describe('transferLayerToMap - argument validation', () => {
    beforeEach(() => {
        setupMap('MapB', []);
    });

    it('throws on an empty layerId', async () => {
        await expect(transferLayerToMap('', 'MapB', { mode: TransferMode.MOVE }))
            .rejects.toThrow(/layerId is required/);
    });

    it('throws on an empty target map name', async () => {
        await expect(transferLayerToMap('l1', '', { mode: TransferMode.MOVE }))
            .rejects.toThrow(/targetMapName is required/);
    });

    it('throws on an unknown mode', async () => {
        await expect(transferLayerToMap('l1', 'MapB', { mode: 'teleport' }))
            .rejects.toThrow(/mode must be/);
    });

    it('throws when no mode is given at all', async () => {
        await expect(transferLayerToMap('l1', 'MapB')).rejects.toThrow(/mode must be/);
    });
});

// ============================================================================
// Expected failures (refuse, name the state, touch nothing)
// ============================================================================

describe('transferLayerToMap - expected failures', () => {
    beforeEach(() => {
        setupMap('MapB', [{ id: 'default', name: 'Padrão', order: 0 }]);
        addFeatureTo('MapA', makeFeature('f1'));
    });

    it('refuses when the destination map is locked and leaves both maps intact', async () => {
        mockLockedMaps.value = new Set(['MapB']);

        const result = await transferLayerToMap('l1', 'MapB', { mode: TransferMode.MOVE });

        expect(result).toEqual({ success: false, reason: 'target_map_locked', mode: 'move' });
        expect(emitStoreError).toHaveBeenCalledWith(
            'store:operationBlocked',
            expect.objectContaining({ reason: 'target_map_locked' })
        );
        // Source untouched, destination untouched.
        expect(featuresOf('MapA')).toHaveLength(1);
        expect(featuresOf('MapB')).toHaveLength(0);
        expect(mockLayers.value.MapB).toHaveLength(1);
        expect(setLayersCompat).not.toHaveBeenCalled();
        expect(layerManager.deleteLayer).not.toHaveBeenCalled();
    });

    it('refuses to MOVE out of a locked current map', async () => {
        isCurrentMapLockedSync.mockReturnValue(true);

        const result = await transferLayerToMap('l1', 'MapB', { mode: TransferMode.MOVE });

        expect(result.success).toBe(false);
        expect(result.reason).toBe('map_locked');
        expect(setLayersCompat).not.toHaveBeenCalled();
        expect(featuresOf('MapA')).toHaveLength(1);
    });

    it('allows a COPY out of a locked current map, leaving the source intact', async () => {
        // A copy writes nothing to the source, so the lock has nothing to defend.
        isCurrentMapLockedSync.mockReturnValue(true);

        const result = await transferLayerToMap('l1', 'MapB', { mode: TransferMode.COPY });

        expect(result.success).toBe(true);
        expect(result.movedCount).toBe(1);
        expect(featuresOf('MapA')).toHaveLength(1);
        expect(featuresOf('MapA')[0].properties.id).toBe('f1');
        expect(mockLayers.value.MapA.map(l => l.id)).toContain('l1');
        expect(layerManager.deleteLayer).not.toHaveBeenCalled();
        expect(featuresOf('MapB')).toHaveLength(1);
    });

    it('refuses when the destination is the current map', async () => {
        const result = await transferLayerToMap('l1', 'MapA', { mode: TransferMode.MOVE });

        expect(result.reason).toBe('same_map');
        expect(setLayersCompat).not.toHaveBeenCalled();
    });

    it('refuses when the layer does not exist', async () => {
        const result = await transferLayerToMap('inexistente', 'MapB', { mode: TransferMode.MOVE });

        expect(result.reason).toBe('layer_not_found');
        expect(setLayersCompat).not.toHaveBeenCalled();
    });

    it('refuses to MOVE a locked layer', async () => {
        mockMemoryLayers.value.MapA.get('l1').locked = true;

        const result = await transferLayerToMap('l1', 'MapB', { mode: TransferMode.MOVE });

        expect(result.success).toBe(false);
        expect(result.reason).toBe('layer_locked');
        expect(setLayersCompat).not.toHaveBeenCalled();
        expect(featuresOf('MapA')).toHaveLength(1);
    });

    it('allows a COPY of a locked layer, leaving the source intact', async () => {
        mockMemoryLayers.value.MapA.get('l1').locked = true;

        const result = await transferLayerToMap('l1', 'MapB', { mode: TransferMode.COPY });

        expect(result.success).toBe(true);
        expect(result.movedCount).toBe(1);
        expect(featuresOf('MapA')).toHaveLength(1);
        expect(mockLayers.value.MapA.map(l => l.id)).toContain('l1');
        expect(layerManager.deleteLayer).not.toHaveBeenCalled();
        // The lock travels with the record, like every other style attribute.
        const created = mockLayers.value.MapB.find(l => l.id === result.targetLayerId);
        expect(created.locked).toBe(true);
    });

    it('refuses without permission', async () => {
        checkPermission.mockReturnValue({ allowed: false, reason: 'sem posto' });

        const result = await transferLayerToMap('l1', 'MapB', { mode: TransferMode.MOVE });

        expect(result.reason).toBe('permission_denied');
        expect(setLayersCompat).not.toHaveBeenCalled();
    });
});

// ============================================================================
// Move
// ============================================================================

describe('transferLayerToMap - move', () => {
    beforeEach(() => {
        setupMap('MapB', [{ id: 'default', name: 'Padrão', visible: true, order: 0 }]);
        hydrate('MapB');

        addFeatureTo('MapA', makeFeature('p1'));
        addFeatureTo('MapA', makeFeature('p2'));
        addFeatureTo('MapA', makeFeature('ln1', 'line'));
        // A feature of another layer that must not move.
        addFeatureTo('MapA', makeFeature('outro', 'point', { layerId: 'outra-camada' }));
    });

    it('carries every feature type to the destination and empties the source layer', async () => {
        const result = await transferLayerToMap('l1', 'MapB', { mode: TransferMode.MOVE });

        expect(result.success).toBe(true);
        expect(result.movedCount).toBe(3);
        expect(result.skippedCount).toBe(0);

        expect(featuresOf('MapB', 'points')).toHaveLength(2);
        expect(featuresOf('MapB', 'lines')).toHaveLength(1);

        // Nothing of that layer is left in the source; the other layer survives.
        const remaining = allFeaturesOf('MapA');
        expect(remaining).toHaveLength(1);
        expect(remaining[0].properties.id).toBe('outro');
    });

    it('creates a destination layer with a NEW id and the source style', async () => {
        const result = await transferLayerToMap('l1', 'MapB', { mode: TransferMode.MOVE });

        expect(result.targetLayerId).not.toBe('l1');
        expect(result.targetLayerName).toBe('Inimigo');

        const created = mockLayers.value.MapB.find(l => l.id === result.targetLayerId);
        expect(created).toBeDefined();
        expect(created.visible).toBe(false);
        expect(created.opacity).toBe(0.4);
        expect(created.order).toBe(1);

        // Every moved feature points at the new layer.
        for (const feature of allFeaturesOf('MapB')) {
            expect(feature.properties.layerId).toBe(result.targetLayerId);
        }
    });

    it('keeps the feature ids, so a move is the same object in a new home', async () => {
        await transferLayerToMap('l1', 'MapB', { mode: TransferMode.MOVE });

        const ids = featuresOf('MapB', 'points').map(f => f.properties.id).sort();
        expect(ids).toEqual(['p1', 'p2']);
    });

    it('removes the layer record from the source map', async () => {
        await transferLayerToMap('l1', 'MapB', { mode: TransferMode.MOVE });

        expect(layerManager.deleteLayer).toHaveBeenCalledWith('l1', 'MapA');
        expect(mockLayers.value.MapA.map(l => l.id)).toEqual(['outra-camada']);
    });

    it('does not release image blobs, because the moved features keep their ids', async () => {
        mockImages.value.set('img1', 'blob-original');
        addFeatureTo('MapA', makeFeature('img1', 'image'));

        await transferLayerToMap('l1', 'MapB', { mode: TransferMode.MOVE });

        expect(removeImage).not.toHaveBeenCalled();
        expect(storeImage).not.toHaveBeenCalled();
        expect(mockImages.value.get('img1')).toBe('blob-original');
        expect(featuresOf('MapB', 'images')[0].properties.id).toBe('img1');
    });

    it('detaches the moved features from their groups by SINGULAR source type', async () => {
        await transferLayerToMap('l1', 'MapB', { mode: TransferMode.MOVE });

        const types = groupManager.removeFeatureFromAllGroups.mock.calls.map(call => call[0]);
        expect(types).toContain('point');
        expect(types).toContain('line');
        expect(types).not.toContain('points');
    });

    it('REFUSES to move a layer that holds analysis features, before writing anything', async () => {
        // The removal step sweeps every bucket by layer id, analysis buckets
        // included, so a move that "skipped" the LOS would still destroy it in
        // the source and orphan its processed children. The only safe answer is
        // to refuse before the first write.
        addFeatureTo('MapA', makeFeature('los1', 'los'));

        const result = await transferLayerToMap('l1', 'MapB', { mode: TransferMode.MOVE });

        expect(result.success).toBe(false);
        expect(result.reason).toBe('analysis_features_present');
        expect(result.skippedCount).toBe(1);

        // Source intact: the LOS, the three ordinary features and the layer.
        expect(featuresOf('MapA', 'los')).toHaveLength(1);
        expect(featuresOf('MapA', 'points')).toHaveLength(3);
        expect(featuresOf('MapA', 'lines')).toHaveLength(1);
        expect(mockLayers.value.MapA.map(l => l.id)).toContain('l1');
        expect(layerManager.deleteLayer).not.toHaveBeenCalled();

        // Destination untouched: no layer, no features.
        expect(setLayersCompat).not.toHaveBeenCalled();
        expect(mockLayers.value.MapB).toHaveLength(1);
        expect(allFeaturesOf('MapB')).toHaveLength(0);

        expect(emitStoreError).toHaveBeenCalledWith(
            'store:operationBlocked',
            expect.objectContaining({ reason: 'analysis_features_present' })
        );
    });

    it('lets a COPY of the same lot through, leaving the analysis feature in place', async () => {
        addFeatureTo('MapA', makeFeature('los1', 'los'));

        const result = await transferLayerToMap('l1', 'MapB', { mode: TransferMode.COPY });

        expect(result.success).toBe(true);
        expect(result.skippedCount).toBe(1);
        expect(result.movedCount).toBe(3);

        // The copy skips it; the original stays exactly where it was. This is
        // the assertion the first version of this test was missing, which made
        // it pass while the move was destroying the very same feature.
        expect(featuresOf('MapA', 'los')).toHaveLength(1);
        expect(featuresOf('MapA', 'los')[0].properties.id).toBe('los1');
        expect(featuresOf('MapB', 'los')).toHaveLength(0);
    });

    it('announces the destination so its layer list refreshes', async () => {
        await transferLayerToMap('l1', 'MapB', { mode: TransferMode.MOVE });

        expect(eventBus.emit).toHaveBeenCalledWith(
            'layers:changed',
            { mapName: 'MapB' }
        );
    });

    it('does not touch the active layer of the current map', async () => {
        await transferLayerToMap('l1', 'MapB', { mode: TransferMode.MOVE });

        expect(mockActiveLayerId.value).toBe('outra-camada');
    });
});

// ============================================================================
// Copy
// ============================================================================

describe('transferLayerToMap - copy', () => {
    beforeEach(() => {
        setupMap('MapB', [{ id: 'default', name: 'Padrão', visible: true, order: 0 }]);
        hydrate('MapB');
    });

    it('leaves the source intact and mints new feature ids', async () => {
        addFeatureTo('MapA', makeFeature('p1'));

        const result = await transferLayerToMap('l1', 'MapB', { mode: TransferMode.COPY });

        expect(result.success).toBe(true);
        expect(result.movedCount).toBe(1);

        expect(featuresOf('MapA')).toHaveLength(1);
        expect(featuresOf('MapA')[0].properties.id).toBe('p1');
        expect(layerManager.deleteLayer).not.toHaveBeenCalled();

        const copied = featuresOf('MapB')[0];
        expect(copied.properties.id).not.toBe('p1');
        expect(copied.id).not.toBe(featuresOf('MapA')[0].id);
        expect(copied.properties.version).toBe(1);
    });

    it('duplicates the image blob under the new feature id', async () => {
        mockImages.value.set('img1', 'blob-original');
        addFeatureTo('MapA', makeFeature('img1', 'image'));

        const result = await transferLayerToMap('l1', 'MapB', { mode: TransferMode.COPY });

        expect(getImage).toHaveBeenCalledWith('img1');

        const newId = featuresOf('MapB', 'images')[0].properties.id;
        expect(newId).not.toBe('img1');
        expect(storeImage).toHaveBeenCalledWith(newId, 'blob-original');
        expect(mockImages.value.get('img1')).toBe('blob-original');
        expect(mockImages.value.get(newId)).toBe('blob-original');
        expect(result.success).toBe(true);
    });

    it('survives a missing blob instead of aborting the copy', async () => {
        addFeatureTo('MapA', makeFeature('img-sem-blob', 'image'));

        const result = await transferLayerToMap('l1', 'MapB', { mode: TransferMode.COPY });

        expect(result.success).toBe(true);
        expect(storeImage).not.toHaveBeenCalled();
        expect(featuresOf('MapB', 'images')).toHaveLength(1);
    });

    it('does not duplicate blobs for feature types that have none', async () => {
        addFeatureTo('MapA', makeFeature('p1'));

        await transferLayerToMap('l1', 'MapB', { mode: TransferMode.COPY });

        expect(getImage).not.toHaveBeenCalled();
    });
});

// ============================================================================
// The `default` collision (layer ids are NOT unique across maps)
// ============================================================================

describe('transferLayerToMap - source layer "default"', () => {
    it('lands as a new id next to the destination default, not on top of it', async () => {
        mockLayers.value.MapA = [
            { id: 'default', name: 'Padrão', visible: true, locked: false, opacity: 1, order: 0 }
        ];
        hydrate('MapA');
        addFeatureTo('MapA', makeFeature('p1', 'point', { layerId: 'default' }));

        setupMap('MapB', [
            { id: 'default', name: 'Padrão', visible: true, locked: false, opacity: 1, order: 0 }
        ]);
        hydrate('MapB');

        const result = await transferLayerToMap('default', 'MapB', { mode: TransferMode.COPY });

        expect(result.success).toBe(true);
        expect(result.targetLayerId).not.toBe('default');
        expect(result.targetLayerName).toBe('Padrão #2');

        expect(mockLayers.value.MapB).toHaveLength(2);
        expect(mockLayers.value.MapB.map(l => l.id)).toContain('default');
        expect(layerNames('MapB')).toEqual(['Padrão', 'Padrão #2']);

        // The destination default keeps its own features (it had none, and the
        // copy did not get filed under it).
        expect(featuresOf('MapB')[0].properties.layerId).toBe(result.targetLayerId);
    });
});

// ============================================================================
// THE HYDRATION TRAP
// ============================================================================

describe('transferLayerToMap - destination that was never hydrated', () => {
    it('keeps the layers the destination already had on disk', async () => {
        // MapB has three layers on disk and is ABSENT from memoryStore.layers,
        // which is the state of every map the session has not visited.
        setupMap('MapB', [
            { id: 'default', name: 'Padrão', visible: true, order: 0 },
            { id: 'b2', name: 'Obstáculos', visible: true, order: 1 },
            { id: 'b3', name: 'Rotas', visible: true, order: 2 }
        ]);
        expect(mockMemoryLayers.value.MapB).toBeUndefined();

        addFeatureTo('MapA', makeFeature('p1'));

        const result = await transferLayerToMap('l1', 'MapB', { mode: TransferMode.MOVE });

        expect(result.success).toBe(true);
        expect(mockLayers.value.MapB).toHaveLength(4);
        expect(mockLayers.value.MapB.map(l => l.id)).toEqual(
            expect.arrayContaining(['default', 'b2', 'b3', result.targetLayerId])
        );
        expect(layerNames('MapB')).toEqual(['Padrão', 'Obstáculos', 'Rotas', 'Inimigo']);
    });

    it('does not fabricate an in-memory cache for the destination', async () => {
        setupMap('MapB', [{ id: 'default', name: 'Padrão', order: 0 }]);
        addFeatureTo('MapA', makeFeature('p1'));

        await transferLayerToMap('l1', 'MapB', { mode: TransferMode.MOVE });

        // A half-built cache is indistinguishable from a hydrated one, and the
        // next _persistLayersAsync for that map would write it over the disk.
        expect(mockMemoryLayers.value.MapB).toBeUndefined();
    });

    it('mirrors the new layer into memory when the destination IS hydrated', async () => {
        setupMap('MapB', [{ id: 'default', name: 'Padrão', order: 0 }]);
        hydrate('MapB');
        addFeatureTo('MapA', makeFeature('p1'));

        const result = await transferLayerToMap('l1', 'MapB', { mode: TransferMode.MOVE });

        expect(mockMemoryLayers.value.MapB.has(result.targetLayerId)).toBe(true);
        // Memory and disk must agree, or the next persist loses one of them.
        expect(Array.from(mockMemoryLayers.value.MapB.keys()).sort())
            .toEqual(mockLayers.value.MapB.map(l => l.id).sort());
    });
});

// ============================================================================
// Destination write failure must never cost the source
// ============================================================================

describe('transferLayerToMap - destination write failure', () => {
    it('leaves the source untouched when the destination write throws', async () => {
        setupMap('MapB', [{ id: 'default', name: 'Padrão', order: 0 }]);
        hydrate('MapB');
        addFeatureTo('MapA', makeFeature('p1'));
        addFeatureTo('MapA', makeFeature('p2'));

        failingMaps.value = new Set(['MapB']);

        await expect(transferLayerToMap('l1', 'MapB', { mode: TransferMode.MOVE }))
            .rejects.toThrow(/IndexedDB write refused/);

        expect(featuresOf('MapA')).toHaveLength(2);
        expect(mockLayers.value.MapA.map(l => l.id)).toContain('l1');
        expect(layerManager.deleteLayer).not.toHaveBeenCalled();

        // The layer record is written before the features, so a failure there
        // has to be taken back out: an empty layer in a map nobody opened is
        // indistinguishable from one somebody made on purpose.
        expect(mockLayers.value.MapB).toHaveLength(1);
        expect(mockMemoryLayers.value.MapB.size).toBe(1);
    });

    it('releases the blobs a failed COPY had already duplicated', async () => {
        setupMap('MapB', [{ id: 'default', name: 'Padrão', order: 0 }]);
        hydrate('MapB');
        mockImages.value.set('img1', 'blob-original');
        addFeatureTo('MapA', makeFeature('img1', 'image'));

        failingMaps.value = new Set(['MapB']);

        await expect(transferLayerToMap('l1', 'MapB', { mode: TransferMode.COPY }))
            .rejects.toThrow(/IndexedDB write refused/);

        // Blobs are duplicated BEFORE the features land, so a failure leaves
        // them referenced by nothing and invisible to every screen.
        const duplicatedId = storeImage.mock.calls[0][0];
        expect(removeImage).toHaveBeenCalledWith(duplicatedId);
        expect(mockImages.value.has(duplicatedId)).toBe(false);
        expect(mockImages.value.get('img1')).toBe('blob-original');
        expect(mockLayers.value.MapB).toHaveLength(1);
    });

    it('refuses without removing anything when the destination accepts fewer features', async () => {
        setupMap('MapB', [{ id: 'default', name: 'Padrão', order: 0 }]);
        hydrate('MapB');
        addFeatureTo('MapA', makeFeature('p1'));

        // Simulates addFeatures returning early in silence (its own guard),
        // which is the only failure mode a thrown error would not catch.
        mockMaps.value.MapB.features.points.push = () => 0;

        const result = await transferLayerToMap('l1', 'MapB', { mode: TransferMode.MOVE });

        expect(result).toEqual({
            success: false,
            reason: 'target_write_incomplete',
            mode: 'move'
        });
        expect(featuresOf('MapA')).toHaveLength(1);
        expect(layerManager.deleteLayer).not.toHaveBeenCalled();
        expect(emitStoreError).toHaveBeenCalledWith(
            'store:persistError',
            expect.objectContaining({ operation: 'transferLayerToMap' })
        );

        // Same rollback as the throwing branch: no empty layer left behind.
        expect(mockLayers.value.MapB).toHaveLength(1);
        expect(mockMemoryLayers.value.MapB.size).toBe(1);
    });
});

// ============================================================================
// The source layer record survives a refused deletion
// ============================================================================

describe('transferLayerToMap - source layer record not removed', () => {
    it('still succeeds, and says the empty layer stayed behind', async () => {
        setupMap('MapB', [{ id: 'default', name: 'Padrão', order: 0 }]);
        hydrate('MapB');
        addFeatureTo('MapA', makeFeature('p1'));

        // deleteLayerOnly carries guards of its own and can decline after the
        // features are already gone.
        layerManager.deleteLayer.mockReturnValue({ success: false, reason: 'MAP_LOCKED' });

        const result = await transferLayerToMap('l1', 'MapB', { mode: TransferMode.MOVE });

        expect(result.success).toBe(true);
        expect(result.sourceLayerRemoved).toBe(false);
        expect(featuresOf('MapB')).toHaveLength(1);
        expect(featuresOf('MapA')).toHaveLength(0);
    });

    it('reports the record as removed on the happy path', async () => {
        setupMap('MapB', [{ id: 'default', name: 'Padrão', order: 0 }]);
        hydrate('MapB');
        addFeatureTo('MapA', makeFeature('p1'));

        const result = await transferLayerToMap('l1', 'MapB', { mode: TransferMode.MOVE });

        expect(result.sourceLayerRemoved).toBe(true);
    });
});

// ============================================================================
// Empty layer
// ============================================================================

describe('transferLayerToMap - empty layer', () => {
    it('transfers the record alone when the layer has no features', async () => {
        setupMap('MapB', [{ id: 'default', name: 'Padrão', order: 0 }]);
        hydrate('MapB');

        const result = await transferLayerToMap('l1', 'MapB', { mode: TransferMode.MOVE });

        expect(result.success).toBe(true);
        expect(result.movedCount).toBe(0);
        expect(mockLayers.value.MapB).toHaveLength(2);
        expect(mockLayers.value.MapA.map(l => l.id)).toEqual(['outra-camada']);
    });
});

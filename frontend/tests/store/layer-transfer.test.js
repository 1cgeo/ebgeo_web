// Path: tests/store/layer-transfer.test.js
//
// MOVER OU COPIAR UMA CAMADA INTEIRA PARA OUTRO MAPA: a orquestracao.
//
// A aritmetica de forma (nome, particao, remapeamento, registro) mora em
// `tests/unit/layer-transfer-model.test.js`. Aqui se mede o que so' existe quando a
// operacao encosta na store: a ORDEM das escritas, a fonte de cada leitura, o que sobra na
// origem quando o destino recusa, e as tres armadilhas que o desenho da store impoe.
//
// DOIS MUNDOS SEPARADOS DE PROPOSITO. `mockLayers` e' o REPOSITORIO (o que um mapa tem no
// disco) e `mockMemoryLayers` e' `memoryStore.layers` (o que foi hidratado nesta sessao). A
// operacao inteira existe porque ela le' e escreve o PRIMEIRO para um mapa que pode estar
// ausente do SEGUNDO; um teste que confundisse os dois nao provaria nada.
//
// A TRAVA DO DESTINO E' `isMapLocked`, NAO `memoryStore.lockedMaps`, e essa e' a divergencia
// que este arquivo mede com um caso proprio. Aquele Set so' e' COMPLETO em atlas remoto,
// onde o snapshot traz a trava de todo mapa; em atlas LOCAL so' o mapa corrente entra nele.
// Perguntar ao Set sobre OUTRO mapa responde "destravado" para um mapa travado, e o caso
// "atlas local" abaixo e' o controle negativo disso: ele deixa o Set VAZIO e mesmo assim
// exige a recusa.
//
// O DUBLE DE `layerManager` E' UMA ARMADILHA ARMADA. `createLayerForImport`,
// `loadLayersToMemory` e `setActiveLayer` LANCAM: sao os tres caminhos de MEMORIA que
// escreveriam por cima das camadas reais de um mapa nunca visitado, ou moveriam a camada
// ativa do mapa que a pessoa esta' olhando. Se a operacao alcancar qualquer um deles, todo
// caso deste arquivo fica vermelho em vez de passar corrompendo em silencio.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getEmptyMapData } from '../../src/js/store/repository.utils.js';

// ============================================================================
// Hoisted shared state
// ============================================================================

const {
    mockMaps,
    mockLayers,
    mockMemoryLayers,
    mockActiveLayerId,
    mockLockedMaps,
    mockMapManager,
    mockImages,
    failingMaps,
    mockDiskLocks,
    mockRemote,
    mockApiClient,
    mockSyncEngine,
    mockUploads
} = vi.hoisted(() => ({
    mockMaps: { value: {} },
    mockLayers: { value: {} },
    mockMemoryLayers: { value: {} },
    mockActiveLayerId: { value: 'default' },
    mockLockedMaps: { value: new Set() },
    mockMapManager: {
        getCurrentMapName: vi.fn(() => 'MapA'),
        getCurrentMapId: vi.fn(() => 'map-a-uuid'),
        getMapId: vi.fn((name) => `${name}-uuid`),
        getFeatureColor: vi.fn(() => null),
        getFeatureColors: vi.fn(() => []),
        updateColorUsage: vi.fn(),
        recordAction: vi.fn()
    },
    mockImages: { value: new Map() },
    failingMaps: { value: new Set() },
    /** The lock state ON DISK, which is what `isMapLocked` reads. */
    mockDiskLocks: { value: new Set() },
    mockRemote: { value: false },
    mockApiClient: { bulkUploadImages: vi.fn(async () => ({ mapping: {}, failed: [] })) },
    mockSyncEngine: { atlasId: null },
    mockUploads: { calls: [] }
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

// `isMapLocked` reads the app setting from DISK; `isCurrentMapLockedSync` reads the memory
// cache. The two are different questions and the operation asks each of them once.
vi.mock('../../src/js/store/map.operations.js', () => ({
    isCurrentMapLockedSync: vi.fn(() => false),
    isMapLocked: vi.fn(async (mapName) => mockDiskLocks.value.has(mapName))
}));

vi.mock('../../src/js/store/store-origin.js', () => ({
    isRemoteStoreSync: vi.fn(() => mockRemote.value)
}));

vi.mock('../../src/js/store/services/map-resolver.service.js', () => ({
    mapResolver: {
        // The id a map name resolves to, which is what the layer op must carry.
        resolveToId: vi.fn((nameOrId) => `${nameOrId}-uuid`),
        // Used by document-lock to key the two names of the same map onto one lock.
        getIdForName: vi.fn((nameOrId) => nameOrId)
    }
}));

vi.mock('../../src/js/store/sync/index.js', () => ({
    logFeatureOperation: vi.fn().mockResolvedValue(undefined),
    logLayerOperation: vi.fn().mockResolvedValue(undefined),
    OperationType: { CREATE: 'CREATE', UPDATE: 'UPDATE', DELETE: 'DELETE' },
    apiClient: mockApiClient,
    syncEngine: mockSyncEngine
}));

vi.mock('../../src/js/store/sync/permission-guard.js', () => ({
    checkPermission: vi.fn(() => ({ allowed: true })),
    GuardAction: {
        CREATE_FEATURE: 'canEdit',
        UPDATE_FEATURE: 'canEdit',
        DELETE_FEATURE: 'canDelete',
        CREATE_LAYER: 'canEdit',
        UPDATE_LAYER: 'canEdit',
        DELETE_LAYER: 'canDelete'
    }
}));

vi.mock('../../src/js/store/settings.operations.js', () => ({
    getImage: vi.fn(async (id) => mockImages.value.get(id) || null),
    storeImage: vi.fn(async (id, blob) => { mockImages.value.set(id, blob); }),
    removeImage: vi.fn(async (id) => { mockImages.value.delete(id); })
}));

// The blob upload is reached by a DYNAMIC import, so the store's static graph does not grow
// an edge into the import/export chunk group. `vi.mock` intercepts it just the same.
vi.mock('@js/import_export/atlas-image-upload.js', () => ({
    buildImageUploads: vi.fn(async (blobs) => ({
        uploads: Array.from(blobs).map(([id]) => ({ localId: id, filename: `${id}.png` })),
        skipped: []
    })),
    uploadImagesInChunks: vi.fn(async (client, atlasId, uploads) => {
        mockUploads.calls.push({ atlasId, localIds: uploads.map(u => u.localId) });
        return { mapping: {}, failed: [] };
    })
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

import { isCurrentMapLockedSync, isMapLocked } from '../../src/js/store/map.operations.js';
import { checkPermission } from '../../src/js/store/sync/permission-guard.js';
import { emitStoreError } from '../../src/js/store/store-errors.js';
import { logLayerOperation } from '../../src/js/store/sync/index.js';
import { getImage, storeImage, removeImage } from '../../src/js/store/settings.operations.js';
import { setLayersCompat } from '../../src/js/store/repositories/index.js';
import { uploadImagesInChunks } from '@js/import_export/atlas-image-upload.js';

// ============================================================================
// Helpers
// ============================================================================

/**
 * A feature the way the repository stores it.
 * @param {string} id - Sync id
 * @param {string} [source] - Singular source type
 * @param {Object} [extra] - Extra properties
 * @returns {Object} A GeoJSON feature
 */
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

/**
 * @param {string} mapName - Map to create
 * @param {Array<Object>} layers - Its layers ON DISK
 * @returns {void}
 */
function setupMap(mapName, layers) {
    mockMaps.value[mapName] = getEmptyMapData();
    mockLayers.value[mapName] = layers;
}

/**
 * Hydrates the in-memory layer cache for a map, as `setCurrentMap` would.
 * @param {string} mapName - Map to hydrate
 * @returns {void}
 */
function hydrate(mapName) {
    mockMemoryLayers.value[mapName] = new Map(
        (mockLayers.value[mapName] || []).map(layer => [layer.id, layer])
    );
}

/**
 * @param {string} mapName - Target map
 * @param {Object} feature - Feature to file
 * @returns {void}
 */
function addFeatureTo(mapName, feature) {
    const storageType = STORAGE_BY_SOURCE[feature.properties.source] || 'points';
    mockMaps.value[mapName].features[storageType].push(feature);
}

/**
 * Files a feature into an EXPLICIT bucket, which is the only way to build the shape that
 * matters here: a RENDERED CHILD of an analysis feature lives in its own bucket while carrying
 * its PARENT'S `source`, because `generateProcessedFeatures` mints it by spreading the parent's
 * properties. That inherited token is what the predicate catches; the bucket name is not, and
 * `getAllStorageTypes()` does list these buckets.
 * @param {string} mapName - Map to write to
 * @param {string} storageType - Bucket
 * @param {Object} feature - Feature to file
 * @returns {void}
 */
function addFeatureToBucket(mapName, storageType, feature) {
    if (!mockMaps.value[mapName].features[storageType]) {
        mockMaps.value[mapName].features[storageType] = [];
    }
    mockMaps.value[mapName].features[storageType].push(feature);
}

/**
 * @param {string} mapName - Map to read
 * @param {string} [storageType] - Bucket
 * @returns {Array<Object>} The bucket
 */
function featuresOf(mapName, storageType = 'points') {
    return mockMaps.value[mapName]?.features[storageType] || [];
}

/**
 * @param {string} mapName - Map to read
 * @returns {Array<Object>} Every feature of every bucket
 */
function allFeaturesOf(mapName) {
    return Object.values(mockMaps.value[mapName]?.features || {}).flat();
}

/**
 * @param {string} mapName - Map to read
 * @returns {string[]} Layer names on disk
 */
function layerNames(mapName) {
    return (mockLayers.value[mapName] || []).map(l => l.name);
}

/**
 * The layer-manager double, with the three memory-write paths armed to throw.
 * @returns {Object} The double
 */
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
        // NEGATIVE CONTROLS: the memory-write paths that would silently overwrite the real
        // layers of a map nobody visited, or move the active layer of the map on screen.
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
    mockDiskLocks.value = new Set();
    mockImages.value = new Map();
    failingMaps.value = new Set();
    mockRemote.value = false;
    mockSyncEngine.atlasId = null;
    mockUploads.calls = [];

    isCurrentMapLockedSync.mockReturnValue(false);
    isMapLocked.mockImplementation(async (mapName) => mockDiskLocks.value.has(mapName));
    checkPermission.mockReturnValue({ allowed: true });
    mockMapManager.getCurrentMapName.mockReturnValue('MapA');
    mockMapManager.getMapId.mockImplementation((name) => `${name}-uuid`);
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

describe('transferLayerToMap - validação de argumento', () => {
    beforeEach(() => {
        setupMap('MapB', []);
    });

    it('lança com layerId vazio', async () => {
        await expect(transferLayerToMap('', 'MapB', { mode: TransferMode.MOVE }))
            .rejects.toThrow(/layerId is required/);
    });

    it('lança com nome de mapa de destino vazio', async () => {
        await expect(transferLayerToMap('l1', '', { mode: TransferMode.MOVE }))
            .rejects.toThrow(/targetMapName is required/);
    });

    it('lança com modo desconhecido', async () => {
        await expect(transferLayerToMap('l1', 'MapB', { mode: 'teleport' }))
            .rejects.toThrow(/mode must be/);
    });

    it('lança quando nenhum modo é dado', async () => {
        await expect(transferLayerToMap('l1', 'MapB')).rejects.toThrow(/mode must be/);
    });
});

// ============================================================================
// Expected failures (refuse, name the state, touch nothing)
// ============================================================================

describe('transferLayerToMap - recusas esperadas', () => {
    beforeEach(() => {
        setupMap('MapB', [{ id: 'default', name: 'Padrão', order: 0 }]);
        addFeatureTo('MapA', makeFeature('f1'));
    });

    it('recusa os DOIS modos quando o mapa de destino está travado NO DISCO', async () => {
        // ATLAS LOCAL: `memoryStore.lockedMaps` fica VAZIO de propósito, porque num atlas
        // local só o mapa corrente entra nele. Só `isMapLocked` sabe a resposta, e este é o
        // caso que reprova se alguém trocar a pergunta pelo Set.
        mockDiskLocks.value = new Set(['MapB']);
        expect(mockLockedMaps.value.has('MapB')).toBe(false);

        const mover = await transferLayerToMap('l1', 'MapB', { mode: TransferMode.MOVE });
        const copiar = await transferLayerToMap('l1', 'MapB', { mode: TransferMode.COPY });

        expect(mover).toEqual({ success: false, reason: 'target_map_locked', mode: 'move' });
        expect(copiar).toEqual({ success: false, reason: 'target_map_locked', mode: 'copy' });
        expect(isMapLocked).toHaveBeenCalledWith('MapB');
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

    it('recusa MOVER de um mapa corrente travado', async () => {
        isCurrentMapLockedSync.mockReturnValue(true);

        const result = await transferLayerToMap('l1', 'MapB', { mode: TransferMode.MOVE });

        expect(result.success).toBe(false);
        expect(result.reason).toBe('map_locked');
        expect(setLayersCompat).not.toHaveBeenCalled();
        expect(featuresOf('MapA')).toHaveLength(1);
    });

    it('deixa COPIAR de um mapa corrente travado, com a origem intacta', async () => {
        // Uma cópia não escreve nada na origem, então a trava não tem o que defender.
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

    it('recusa quando o destino é o próprio mapa corrente', async () => {
        const result = await transferLayerToMap('l1', 'MapA', { mode: TransferMode.MOVE });

        expect(result.reason).toBe('same_map');
        expect(setLayersCompat).not.toHaveBeenCalled();
    });

    it('recusa quando a camada não existe', async () => {
        const result = await transferLayerToMap('inexistente', 'MapB', { mode: TransferMode.MOVE });

        expect(result.reason).toBe('layer_not_found');
        expect(setLayersCompat).not.toHaveBeenCalled();
    });

    it('recusa MOVER uma camada travada', async () => {
        mockMemoryLayers.value.MapA.get('l1').locked = true;

        const result = await transferLayerToMap('l1', 'MapB', { mode: TransferMode.MOVE });

        expect(result.success).toBe(false);
        expect(result.reason).toBe('layer_locked');
        expect(setLayersCompat).not.toHaveBeenCalled();
        expect(featuresOf('MapA')).toHaveLength(1);
    });

    it('deixa COPIAR uma camada travada, com a origem intacta', async () => {
        mockMemoryLayers.value.MapA.get('l1').locked = true;

        const result = await transferLayerToMap('l1', 'MapB', { mode: TransferMode.COPY });

        expect(result.success).toBe(true);
        expect(result.movedCount).toBe(1);
        expect(featuresOf('MapA')).toHaveLength(1);
        expect(mockLayers.value.MapA.map(l => l.id)).toContain('l1');
        expect(layerManager.deleteLayer).not.toHaveBeenCalled();
        // A trava viaja com o registro, como todo outro atributo de estilo.
        const created = mockLayers.value.MapB.find(l => l.id === result.targetLayerId);
        expect(created.locked).toBe(true);
    });

    it('recusa sem permissão, e a recusa CARREGA a capacidade negada', async () => {
        // A frase que a pessoa lê é chaveada por CAPACIDADE (`denialNotice`), nunca por
        // papel: uma recusa que perde este campo vira a frase genérica em silêncio.
        checkPermission.mockReturnValue({ allowed: false, reason: 'sem posto', required: 'canEdit' });

        const result = await transferLayerToMap('l1', 'MapB', { mode: TransferMode.MOVE });

        expect(result.reason).toBe('permission_denied');
        expect(result.required).toBe('canEdit');
        expect(emitStoreError).toHaveBeenCalledWith(
            'store:operationBlocked',
            expect.objectContaining({ reason: 'permission_denied', required: 'canEdit' })
        );
        expect(setLayersCompat).not.toHaveBeenCalled();
    });

    it('MOVER exige TAMBÉM a capacidade de apagar', async () => {
        // Quem cria e não apaga não pode mover: a metade que esvazia a origem é recusada, e
        // a camada já estaria duplicada no destino.
        // `checkPermission` recebe o VALOR de `GuardAction`, não a chave: os chamadores
        // escrevem `checkPermission(GuardAction.DELETE_FEATURE)`, que já é `'canDelete'`.
        checkPermission.mockImplementation((action) => (action === 'canDelete'
            ? { allowed: false, reason: 'sem posto', required: 'canDelete' }
            : { allowed: true }));

        const mover = await transferLayerToMap('l1', 'MapB', { mode: TransferMode.MOVE });
        expect(mover.reason).toBe('permission_denied');
        expect(mover.required).toBe('canDelete');
        expect(setLayersCompat).not.toHaveBeenCalled();

        // E o mesmo posto COPIA sem problema.
        const copiar = await transferLayerToMap('l1', 'MapB', { mode: TransferMode.COPY });
        expect(copiar.success).toBe(true);
    });
});

// ============================================================================
// Move
// ============================================================================

describe('transferLayerToMap - mover', () => {
    beforeEach(() => {
        setupMap('MapB', [{ id: 'default', name: 'Padrão', visible: true, order: 0 }]);
        hydrate('MapB');

        addFeatureTo('MapA', makeFeature('p1'));
        addFeatureTo('MapA', makeFeature('p2'));
        addFeatureTo('MapA', makeFeature('ln1', 'line'));
        // Uma feição de outra camada, que não pode se mexer.
        addFeatureTo('MapA', makeFeature('outro', 'point', { layerId: 'outra-camada' }));
    });

    it('leva os DOIS tipos ao destino e esvazia a camada de origem', async () => {
        const result = await transferLayerToMap('l1', 'MapB', { mode: TransferMode.MOVE });

        expect(result.success).toBe(true);
        expect(result.movedCount).toBe(3);
        expect(result.skippedCount).toBe(0);

        expect(featuresOf('MapB', 'points')).toHaveLength(2);
        expect(featuresOf('MapB', 'lines')).toHaveLength(1);

        // Nada daquela camada sobra na origem; a outra camada sobrevive.
        const remaining = allFeaturesOf('MapA');
        expect(remaining).toHaveLength(1);
        expect(remaining[0].properties.id).toBe('outro');
    });

    it('cria a camada do destino com id NOVO e o estilo da origem', async () => {
        const result = await transferLayerToMap('l1', 'MapB', { mode: TransferMode.MOVE });

        expect(result.targetLayerId).not.toBe('l1');
        expect(result.targetLayerName).toBe('Inimigo');

        const created = mockLayers.value.MapB.find(l => l.id === result.targetLayerId);
        expect(created).toBeDefined();
        expect(created.visible).toBe(false);
        expect(created.opacity).toBe(0.4);
        expect(created.order).toBe(1);

        // Toda feição movida aponta para a camada nova.
        for (const feature of allFeaturesOf('MapB')) {
            expect(feature.properties.layerId).toBe(result.targetLayerId);
        }
    });

    it('loga a op de camada com o mapId do DESTINO, nunca com o nome', async () => {
        // `logLayerOperation` arquiva a op sob o que lhe entregarem: um NOME viajaria como
        // id de mapa que o servidor não conhece e derrubaria o lote de flush inteiro.
        const result = await transferLayerToMap('l1', 'MapB', { mode: TransferMode.MOVE });

        expect(logLayerOperation).toHaveBeenCalledWith(
            'CREATE',
            result.targetLayerId,
            'MapB-uuid',
            expect.objectContaining({ id: result.targetLayerId, name: 'Inimigo' })
        );
        const mapIds = logLayerOperation.mock.calls.map(call => call[2]);
        expect(mapIds).not.toContain('MapB');
        expect(mapIds).not.toContain('MapA-uuid');
    });

    it('mantém os ids das feições: mover é o mesmo objeto numa casa nova', async () => {
        await transferLayerToMap('l1', 'MapB', { mode: TransferMode.MOVE });

        const ids = featuresOf('MapB', 'points').map(f => f.properties.id).sort();
        expect(ids).toEqual(['p1', 'p2']);
    });

    it('remove o registro da camada do mapa de origem', async () => {
        await transferLayerToMap('l1', 'MapB', { mode: TransferMode.MOVE });

        expect(layerManager.deleteLayer).toHaveBeenCalledWith('l1', 'MapA');
        expect(mockLayers.value.MapA.map(l => l.id)).toEqual(['outra-camada']);
    });

    it('NÃO libera os blobs de imagem, porque as feições movidas ficam com os ids', async () => {
        mockImages.value.set('img1', 'blob-original');
        addFeatureTo('MapA', makeFeature('img1', 'image'));

        await transferLayerToMap('l1', 'MapB', { mode: TransferMode.MOVE });

        expect(removeImage).not.toHaveBeenCalled();
        expect(storeImage).not.toHaveBeenCalled();
        expect(mockImages.value.get('img1')).toBe('blob-original');
        expect(featuresOf('MapB', 'images')[0].properties.id).toBe('img1');
    });

    it('desliga as feições movidas dos grupos pelo tipo SINGULAR', async () => {
        await transferLayerToMap('l1', 'MapB', { mode: TransferMode.MOVE });

        const types = groupManager.removeFeatureFromAllGroups.mock.calls.map(call => call[0]);
        expect(types).toContain('point');
        expect(types).toContain('line');
        // O plural é o defeito: `removeFeatureFromAllGroups` indexa pelo singular, e o
        // plural não casava com nada, deixando referência órfã.
        expect(types).not.toContain('points');
        expect(types).not.toContain('lines');
    });

    it('RECUSA mover uma camada com feição de análise, antes de escrever qualquer coisa', async () => {
        // A remoção varre TODO balde por id de camada, inclusive os de análise, então um
        // move que "pulasse" a LOS a destruiria na origem e orfanaria os filhos processados.
        // UM alvo de visada, do jeito que o produto o guarda: o pai no balde dele mais DUAS
        // metades desenhadas no balde `processed_los`, cada uma carregando o `source` do pai,
        // que e' o token pelo qual o predicado as pega (o balde delas E varrido).
        addFeatureTo('MapA', makeFeature('los1', 'los'));
        addFeatureToBucket('MapA', 'processed_los', makeFeature('los1-visible', 'los'));
        addFeatureToBucket('MapA', 'processed_los', makeFeature('los1-blocked', 'los'));

        const result = await transferLayerToMap('l1', 'MapB', { mode: TransferMode.MOVE });

        expect(result.success).toBe(false);
        expect(result.reason).toBe('analysis_features_present');
        // UM, e nao tres: a pessoa desenhou uma coisa so'. A frase que ela le' cita este
        // numero, e "3 feicoes de analise" a mandaria procurar dois objetos que nunca foram
        // dela. A recusa continua gateando na particao INTEIRA.
        expect(result.skippedCount).toBe(1);
        expect(featuresOf('MapA', 'processed_los')).toHaveLength(2);

        // Origem intacta: a LOS, as três feições comuns e a camada.
        expect(featuresOf('MapA', 'los')).toHaveLength(1);
        expect(featuresOf('MapA', 'points')).toHaveLength(3);
        expect(featuresOf('MapA', 'lines')).toHaveLength(1);
        expect(mockLayers.value.MapA.map(l => l.id)).toContain('l1');
        expect(layerManager.deleteLayer).not.toHaveBeenCalled();

        // Destino intocado: sem camada, sem feição.
        expect(setLayersCompat).not.toHaveBeenCalled();
        expect(mockLayers.value.MapB).toHaveLength(1);
        expect(allFeaturesOf('MapB')).toHaveLength(0);

        expect(emitStoreError).toHaveBeenCalledWith(
            'store:operationBlocked',
            expect.objectContaining({ reason: 'analysis_features_present' })
        );
    });

    it('deixa o mesmo lote passar por COPIAR, com a feição de análise no lugar', async () => {
        addFeatureTo('MapA', makeFeature('los1', 'los'));
        addFeatureToBucket('MapA', 'processed_los', makeFeature('los1-visible', 'los'));
        addFeatureToBucket('MapA', 'processed_los', makeFeature('los1-blocked', 'los'));

        const result = await transferLayerToMap('l1', 'MapB', { mode: TransferMode.COPY });

        expect(result.success).toBe(true);
        expect(result.skippedCount).toBe(1);
        expect(result.movedCount).toBe(3);

        // As metades desenhadas ficam onde estavam e NAO viajam: elas herdam o `source` do
        // pai, entao o predicado as pega, ainda que o balde delas seja varrido como os outros.
        expect(featuresOf('MapA', 'processed_los')).toHaveLength(2);
        expect(featuresOf('MapB', 'processed_los')).toHaveLength(0);

        // A cópia a pula; a original fica exatamente onde estava.
        expect(featuresOf('MapA', 'los')).toHaveLength(1);
        expect(featuresOf('MapA', 'los')[0].properties.id).toBe('los1');
        expect(featuresOf('MapB', 'los')).toHaveLength(0);
    });

    it('anuncia o destino para que a lista de camadas dele se atualize', async () => {
        await transferLayerToMap('l1', 'MapB', { mode: TransferMode.MOVE });

        expect(eventBus.emit).toHaveBeenCalledWith('layers:changed', { mapName: 'MapB' });
    });

    it('não encosta na camada ativa do mapa corrente', async () => {
        // `memoryStore.activeLayerId` é GLOBAL, não por mapa: escrevê-lo aqui moveria a
        // camada ativa do mapa que a pessoa está olhando.
        await transferLayerToMap('l1', 'MapB', { mode: TransferMode.MOVE });

        expect(mockActiveLayerId.value).toBe('outra-camada');
        expect(layerManager.setActiveLayer).not.toHaveBeenCalled();
        expect(layerManager.loadLayersToMemory).not.toHaveBeenCalled();
        expect(layerManager.createLayerForImport).not.toHaveBeenCalled();
    });
});

// ============================================================================
// Copy
// ============================================================================

describe('transferLayerToMap - copiar', () => {
    beforeEach(() => {
        setupMap('MapB', [{ id: 'default', name: 'Padrão', visible: true, order: 0 }]);
        hydrate('MapB');
    });

    it('deixa a origem intacta e cunha ids novos', async () => {
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

    it('duplica o blob de imagem sob o id novo', async () => {
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

    it('sobrevive a um blob ausente em vez de abortar a cópia', async () => {
        addFeatureTo('MapA', makeFeature('img-sem-blob', 'image'));

        const result = await transferLayerToMap('l1', 'MapB', { mode: TransferMode.COPY });

        expect(result.success).toBe(true);
        expect(storeImage).not.toHaveBeenCalled();
        expect(featuresOf('MapB', 'images')).toHaveLength(1);
    });

    it('não duplica blob para tipo de feição que não tem imagem', async () => {
        addFeatureTo('MapA', makeFeature('p1'));

        await transferLayerToMap('l1', 'MapB', { mode: TransferMode.COPY });

        expect(getImage).not.toHaveBeenCalled();
    });
});

// ============================================================================
// The copied blob has to reach the SERVER, or the peer sees a hole
// ============================================================================

describe('transferLayerToMap - blob copiado num atlas de servidor', () => {
    beforeEach(() => {
        setupMap('MapB', [{ id: 'default', name: 'Padrão', visible: true, order: 0 }]);
        hydrate('MapB');
        mockImages.value.set('img1', 'blob-original');
        addFeatureTo('MapA', makeFeature('img1', 'image'));
    });

    it('sobe o blob novo ANTES de gravar as feições, e sob o id novo', async () => {
        // `storeImage` escreve só no disco local e não sobe nada. Sem esta subida, o par
        // recebia a op da feição e a imagem apontava para um id que o servidor nunca viu.
        mockRemote.value = true;
        mockSyncEngine.atlasId = 'atlas-uuid';

        const result = await transferLayerToMap('l1', 'MapB', { mode: TransferMode.COPY });

        expect(result.success).toBe(true);
        const newId = featuresOf('MapB', 'images')[0].properties.id;
        expect(uploadImagesInChunks).toHaveBeenCalledTimes(1);
        expect(mockUploads.calls).toEqual([{ atlasId: 'atlas-uuid', localIds: [newId] }]);

        // ORDEM: o `localIds` capturado no momento da subida já é o id que a feição carrega,
        // e a feição só apareceu no destino depois. A subida sai antes do flush de 1,5 s.
        expect(featuresOf('MapB', 'images')).toHaveLength(1);
    });

    it('num atlas LOCAL não sobe nada', async () => {
        mockRemote.value = false;

        const result = await transferLayerToMap('l1', 'MapB', { mode: TransferMode.COPY });

        expect(result.success).toBe(true);
        expect(uploadImagesInChunks).not.toHaveBeenCalled();
    });

    it('MOVER nunca sobe blob, porque os ids não mudam', async () => {
        mockRemote.value = true;
        mockSyncEngine.atlasId = 'atlas-uuid';

        const result = await transferLayerToMap('l1', 'MapB', { mode: TransferMode.MOVE });

        expect(result.success).toBe(true);
        expect(uploadImagesInChunks).not.toHaveBeenCalled();
    });
});

// ============================================================================
// The `default` collision (layer ids are NOT unique across maps)
// ============================================================================

describe('transferLayerToMap - camada de origem "default"', () => {
    it('chega como id novo ao lado da padrão do destino, nunca por cima dela', async () => {
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

        // A padrão do destino fica com as feições dela (não tinha nenhuma, e a cópia não
        // foi arquivada sob ela).
        expect(featuresOf('MapB')[0].properties.layerId).toBe(result.targetLayerId);
    });
});

// ============================================================================
// THE HYDRATION TRAP
// ============================================================================

describe('transferLayerToMap - destino nunca hidratado', () => {
    it('conserva as camadas que o destino já tinha no disco', async () => {
        // MapB tem três camadas no disco e está AUSENTE de `memoryStore.layers`, que é o
        // estado de todo mapa que a sessão não visitou.
        setupMap('MapB', [
            { id: 'default', name: 'Padrão', visible: true, order: 0 },
            { id: 'b2', name: 'Obstáculos', visible: true, order: 1 },
            { id: 'b3', name: 'Rotas', visible: true, order: 2 }
        ]);
        expect(mockMemoryLayers.value.MapB).toBeUndefined();

        addFeatureTo('MapA', makeFeature('p1'));

        const result = await transferLayerToMap('l1', 'MapB', { mode: TransferMode.MOVE });

        expect(result.success).toBe(true);
        // ABSOLUTO: com a fonte errada este número seria 2 (a `default` fabricada mais a
        // nova), e um `> 0` passaria verde no próprio defeito.
        expect(mockLayers.value.MapB).toHaveLength(4);
        expect(mockLayers.value.MapB.map(l => l.id)).toEqual(
            expect.arrayContaining(['default', 'b2', 'b3', result.targetLayerId])
        );
        expect(layerNames('MapB')).toEqual(['Padrão', 'Obstáculos', 'Rotas', 'Inimigo']);
    });

    it('não fabrica cache em memória para o destino', async () => {
        setupMap('MapB', [{ id: 'default', name: 'Padrão', order: 0 }]);
        addFeatureTo('MapA', makeFeature('p1'));

        await transferLayerToMap('l1', 'MapB', { mode: TransferMode.MOVE });

        // Um cache meio construído é indistinguível de um hidratado, e o próximo
        // `_persistLayersAsync` daquele mapa o escreveria por cima do disco.
        expect(mockMemoryLayers.value.MapB).toBeUndefined();
    });

    it('espelha a camada nova na memória quando o destino ESTÁ hidratado', async () => {
        setupMap('MapB', [{ id: 'default', name: 'Padrão', order: 0 }]);
        hydrate('MapB');
        addFeatureTo('MapA', makeFeature('p1'));

        const result = await transferLayerToMap('l1', 'MapB', { mode: TransferMode.MOVE });

        expect(mockMemoryLayers.value.MapB.has(result.targetLayerId)).toBe(true);
        // Memória e disco têm de concordar, ou o próximo persist perde uma das duas.
        expect(Array.from(mockMemoryLayers.value.MapB.keys()).sort())
            .toEqual(mockLayers.value.MapB.map(l => l.id).sort());
    });
});

// ============================================================================
// Destination write failure must never cost the source
// ============================================================================

describe('transferLayerToMap - falha de gravação no destino', () => {
    it('deixa a origem intocada quando a escrita no destino lança', async () => {
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

        // O registro da camada é escrito ANTES das feições, então uma falha ali precisa ser
        // desfeita: uma camada vazia num mapa que ninguém abriu é indistinguível de uma que
        // alguém criou de propósito.
        expect(mockLayers.value.MapB).toHaveLength(1);
        expect(mockMemoryLayers.value.MapB.size).toBe(1);
    });

    it('libera os blobs que uma CÓPIA falha já havia duplicado', async () => {
        setupMap('MapB', [{ id: 'default', name: 'Padrão', order: 0 }]);
        hydrate('MapB');
        mockImages.value.set('img1', 'blob-original');
        addFeatureTo('MapA', makeFeature('img1', 'image'));

        failingMaps.value = new Set(['MapB']);

        await expect(transferLayerToMap('l1', 'MapB', { mode: TransferMode.COPY }))
            .rejects.toThrow(/IndexedDB write refused/);

        // Os blobs são duplicados ANTES de as feições chegarem, então a falha os deixa
        // referenciados por nada e invisíveis a toda tela.
        const duplicatedId = storeImage.mock.calls[0][0];
        expect(removeImage).toHaveBeenCalledWith(duplicatedId);
        expect(mockImages.value.has(duplicatedId)).toBe(false);
        expect(mockImages.value.get('img1')).toBe('blob-original');
        expect(mockLayers.value.MapB).toHaveLength(1);
    });

    it('recusa sem remover nada quando o destino aceita menos feições', async () => {
        setupMap('MapB', [{ id: 'default', name: 'Padrão', order: 0 }]);
        hydrate('MapB');
        addFeatureTo('MapA', makeFeature('p1'));

        // Simula `addFeatures` saindo cedo em silêncio (guarda própria dele), que é o único
        // modo de falha que um throw não pegaria.
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

        // Mesmo rollback do ramo que lança: sem camada vazia deixada para trás.
        expect(mockLayers.value.MapB).toHaveLength(1);
        expect(mockMemoryLayers.value.MapB.size).toBe(1);
    });
});

// ============================================================================
// The source layer record survives a refused deletion
// ============================================================================

describe('transferLayerToMap - registro da camada de origem não removido', () => {
    it('ainda tem sucesso, e diz que a camada vazia ficou para trás', async () => {
        setupMap('MapB', [{ id: 'default', name: 'Padrão', order: 0 }]);
        hydrate('MapB');
        addFeatureTo('MapA', makeFeature('p1'));

        // `deleteLayerOnly` tem guardas próprias e pode declinar depois de as feições já
        // terem saído.
        layerManager.deleteLayer.mockReturnValue({ success: false, reason: 'MAP_LOCKED' });

        const result = await transferLayerToMap('l1', 'MapB', { mode: TransferMode.MOVE });

        expect(result.success).toBe(true);
        expect(result.sourceLayerRemoved).toBe(false);
        expect(featuresOf('MapB')).toHaveLength(1);
        expect(featuresOf('MapA')).toHaveLength(0);
    });

    it('deleteLayerOnly LANCANDO tem o mesmo desfecho de recusar', async () => {
        // O caso real: o par apaga a mesma camada enquanto voce a move, e `applyRemoteLayerOp`
        // reescreve o cache de camadas entre o `getLayerById` do inicio e esta chamada, de modo
        // que `layerManager.deleteLayer` LANCA. O throw cai depois de a origem ja' estar vazia e
        // de o destino ja' ter tudo: deixa-lo escapar faria a aba mostrar erro, pular o
        // `loadFeatures` e deixar o MapLibre desenhando feicao que a store nao tem mais.
        setupMap('MapB', [{ id: 'default', name: 'Padrão', order: 0 }]);
        hydrate('MapB');
        addFeatureTo('MapA', makeFeature('p1'));

        layerManager.deleteLayer.mockImplementation(() => {
            throw new Error('Layer l1 not found.');
        });

        const result = await transferLayerToMap('l1', 'MapB', { mode: TransferMode.MOVE });

        expect(result.success).toBe(true);
        expect(result.sourceLayerRemoved).toBe(false);
        // A transferencia aconteceu inteira: o que sobrou na origem foi a camada vazia.
        expect(featuresOf('MapB')).toHaveLength(1);
        expect(featuresOf('MapA')).toHaveLength(0);
        expect(eventBus.emit).toHaveBeenCalledWith('layers:changed', { mapName: 'MapB' });
    });

    it('relata o registro como removido no caminho feliz', async () => {
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

describe('transferLayerToMap - camada vazia', () => {
    it('transfere só o registro quando a camada não tem feição', async () => {
        setupMap('MapB', [{ id: 'default', name: 'Padrão', order: 0 }]);
        hydrate('MapB');

        const result = await transferLayerToMap('l1', 'MapB', { mode: TransferMode.MOVE });

        expect(result.success).toBe(true);
        expect(result.movedCount).toBe(0);
        expect(mockLayers.value.MapB).toHaveLength(2);
        expect(mockLayers.value.MapA.map(l => l.id)).toEqual(['outra-camada']);
    });
});

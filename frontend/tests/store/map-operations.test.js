import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getEmptyMapData } from '../../src/js/store/repository.utils.js';
import { mapBadgeColorForName } from '../../src/js/store/map-badge-colors.js';

// ============================================================================
// Hoisted shared state
// ============================================================================

const { mockMapManager, mockLockedMaps, mockMemoryStore, mockSettings, mockMaps, mockRepoMaps, intents } = vi.hoisted(() => {
    return {
        /** As intenções duráveis registradas na transação, na ordem. */
        intents: [],
        mockMapManager: {
            getCurrentMapName: vi.fn(() => 'TestMap'),
            getCurrentMapId: vi.fn(() => 'map-uuid-123'),
            getCurrentMapInfo: vi.fn(() => ({ name: 'TestMap', id: 'map-uuid-123' })),
            addMapToMemory: vi.fn(),
            processMapColors: vi.fn(async () => {}),
            removeMapFromMemory: vi.fn(async () => {}),
            renameMapInMemory: vi.fn(),
            setCurrentMap: vi.fn(async () => {}),
            // No undoLastAction/redoLastAction here on purpose: map.operations.js no
            // longer forwards to the state manager (see undo-redo-lock-guard.test.js).
            getFrequentColors: vi.fn(() => [])
        },
        mockLockedMaps: { value: new Set() },
        mockMemoryStore: {
            get lockedMaps() { return mockLockedMaps.value; },
            set lockedMaps(v) { mockLockedMaps.value = v; },
            currentMap: 'TestMap'
        },
        mockSettings: { value: {} },
        mockMaps: { value: {} },
        mockRepoMaps: { value: [] }
    };
});

// ============================================================================
// Mock dependencies
// ============================================================================

// `map.operations.js` passou a importar os dois carregadores de memoria por mapa, porque
// `adoptMountedLocalAtlas` (a entrada em atlas LOCAL ao vivo) refaz o espelho em memoria do
// slot recem-montado. Nenhum caso deste arquivo exercita 3D nem 360, entao os dois entram como
// dubles vazios: mocka-los aqui e mais estreito do que estender o mock de `repositories/`, que
// teria de ganhar os quatro `Compat` de 3D/360 sem que nada os use.
vi.mock('../../src/js/store/cesium3d.operations.js', () => ({
    loadCesium3dDataToMemory: vi.fn(async () => {})
}));
vi.mock('../../src/js/store/streetview360.operations.js', () => ({
    loadStreetview360DataToMemory: vi.fn(async () => {})
}));

vi.mock('../../src/js/store/store-errors.js', () => ({
    StoreErrorEvents: {
        STORE_OPERATION_BLOCKED: 'store:operationBlocked',
        STORE_PERSIST_ERROR: 'store:persistError'
    },
    emitStoreError: vi.fn()
}));

vi.mock('../../src/js/store/sync/index.js', async () => ({
    // O duplo fica de pe' porque o barril e' substituido inteiro; NENHUMA entrada deste arquivo o
    // chama mais desde que `addMap` e `removeMap` viraram write-ahead (bloco B4). Se alguem voltar
    // a logar por fora da transacao, o `intents` para de contar a op e os casos de ordem acusam.
    logMapOperation: vi.fn(),
    logAtlasSetting: vi.fn(),
    // Sync OFF in unit tests → addMap keeps the name-keyed storage these tests assert.
    isOperationLoggingEnabled: vi.fn(() => false),
    // O vocabulário REAL, e não um duplo com valores inventados: o barril reexporta o módulo
    // folha, então uppercase aqui faria a asserção medir a fantasia do mock em vez do contrato.
    OperationType: (await import('../../src/js/store/sync/operation-types.js')).OperationType
}));

// A PORTA DO DIÁRIO, que é por onde as configurações de mapa passam desde que viraram
// write-ahead: `runTransaction` (real, não mockado) chama `persistOperationIntents` ANTES da
// função de persistência. Capturar as descrições aqui é o que substitui os antigos duplos de
// `logBaseLayerOperation`/`logMapPositionOperation`, que diziam "fui chamado" e não diziam
// QUANDO. A ordem em si é medida com disco de verdade em
// `tests/integration/map-settings-write-ahead.test.js`.
vi.mock('../../src/js/store/sync/operation-dispatcher.js', () => ({
    persistOperationIntents: vi.fn(async (descriptions) => {
        intents.push(...descriptions.map((op) => ({ ...op })));
        return async () => {};
    })
}));

vi.mock('../../src/js/store/sync/permission-guard.js', () => ({
    checkPermission: vi.fn(() => ({ allowed: true })),
    GuardAction: {
        CREATE_MAP: 'EDIT',
        UPDATE_MAP: 'EDIT',
        DELETE_MAP: 'DELETE',
        LOCK_MAP: 'LOCK_MAPS'
    }
}));

vi.mock('../../src/js/store/sync/sync-metadata.js', () => ({
    createSyncMetadata: vi.fn(() => ({ createdAt: Date.now(), updatedAt: Date.now(), version: 1 })),
    touchSyncMetadata: vi.fn((sync) => ({ ...sync, updatedAt: Date.now(), version: (sync.version || 0) + 1 }))
}));

vi.mock('../../src/js/store/repositories/index.js', () => ({
    getMapDataCompat: vi.fn(async (mapName) => {
        return mockMaps.value[mapName] || getEmptyMapData();
    }),
    updateMapDataCompat: vi.fn(async (mapName, data) => {
        mockMaps.value[mapName] = data;
    }),
    // A cunhagem e' PURA desde 2026-09-13, e e' por isso que o duplo nao escreve nada: `addMap`
    // virou write-ahead, e quem grava e' a funcao de persistencia da transacao
    // (`updateMapDataCompat`). Um duplo que ainda escrevesse aqui esconderia justamente a
    // inversao que a migracao fechou, porque o mapa estaria em disco antes da intencao.
    mintMapDocument: vi.fn((mapName, data) => {
        const mapData = data || getEmptyMapData();
        // Mirror the real mintMapDocument: a fresh map (no caller data) takes the
        // requested name, not the getEmptyMapData() placeholder.
        if (!data || !mapData.name) mapData.name = mapName;
        mapData.id = `uuid-${mapName}`;
        return { document: mapData, storageKey: mapName };
    }),
    deleteMapCompat: vi.fn(async (mapName) => {
        delete mockMaps.value[mapName];
    }),
    renameMapCompat: vi.fn(async (oldName, newName) => {
        mockMaps.value[newName] = mockMaps.value[oldName];
        delete mockMaps.value[oldName];
    }),
    getAllMapKeysCompat: vi.fn(async () => Object.keys(mockMaps.value)),
    getSettingCompat: vi.fn(async (key) => mockSettings.value[key] ?? null),
    setSettingCompat: vi.fn(async (key, value) => { mockSettings.value[key] = value; }),
    setMapNotesCompat: vi.fn(async () => {}),
    getRepository: vi.fn(() => ({ getAllMaps: vi.fn(async () => mockRepoMaps.value) }))
}));

vi.mock('../../src/js/store/store-state-manager.js', () => ({
    default: mockMapManager
}));

vi.mock('../../src/js/store/memory-store.js', () => ({
    memoryStore: mockMemoryStore
}));

vi.mock('../../src/js/store/services/map-resolver.service.js', () => ({
    mapResolver: {
        registerMap: vi.fn(),
        unregisterMapById: vi.fn(),
        renameMap: vi.fn(),
        resolveToId: vi.fn((name) => `uuid-${name}`),
        resolveToName: vi.fn((idOrName) => idOrName),
        // Read by mapDocumentKey (document-lock.js). Undefined = unregistered name, so the
        // lock keys on the name itself, which is what these single-writer tests exercise.
        getIdForName: vi.fn()
    }
}));

vi.mock('../../src/js/config.js', () => ({
    default: {
        basemaps: {
            'carta-topografica': { enabled: true },
            'osm': { enabled: true }
        },
        getValidBasemapFallback: vi.fn(() => 'carta-topografica')
    }
}));

vi.mock('../../src/js/utilities/uuid.js', () => ({
    generateUUID: vi.fn(() => 'generated-uuid-' + Math.random().toString(36).slice(2, 8)),
    isValidUUID: vi.fn((v) => v?.startsWith('uuid-') || v?.startsWith('generated-uuid-'))
}));

vi.mock('../../src/js/events', () => ({
    EventTypes: {
        MAP_LOCK_CHANGED: 'map:lockChanged',
        LAYERS_CHANGED: 'layers:changed',
        MAP_CREATED: 'map:created'
    }
}));

// ============================================================================
// Imports (after mocks)
// ============================================================================

import {
    getAllMapNamesStore,
    getMapOrder,
    setMapOrder,
    addMap,
    removeMap,
    renameMap,
    setCurrentMap,
    activateAtlasInitialMap,
    hasAnyMapFeatures,
    getCurrentMapName,
    getCurrentMapNameSync,
    getCurrentMapIdSync,
    getCurrentMapInfoSync,
    getCurrentBaseLayer,
    setBaseLayer,
    updateMapPosition,
    getMapPosition,
    hasMapSavedPosition,
    clearMapPosition,
    isMapLocked,
    isCurrentMapLockedSync,
    toggleMapLock,
    setBriefingLockOverride,
    getMapBadgeColor,
    removeMapBadgeColor,
    getAllMapBadgeColors,
    getOrderedMapBadgeColors,
    setMapDependencies
} from '../../src/js/store/map.operations.js';

import { checkPermission } from '../../src/js/store/sync/permission-guard.js';
import { emitStoreError } from '../../src/js/store/store-errors.js';
import { setSettingCompat, renameMapCompat } from '../../src/js/store/repositories/index.js';
import { withMapDocument, getDocumentLockStats } from '../../src/js/store/document-lock.js';

// ============================================================================
// Setup
// ============================================================================

const mockEventBus = {
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn()
};

const mockGroupManager = {
    loadGroupsToMemory: vi.fn(async () => {}),
    clearMapGroups: vi.fn(async () => {})
};

const mockLayerManager = {
    loadLayersToMemory: vi.fn(async () => {})
};

beforeEach(() => {
    vi.clearAllMocks();
    intents.length = 0;
    mockLockedMaps.value = new Set();
    mockMemoryStore.currentMap = 'TestMap';
    mockSettings.value = {};
    mockMaps.value = {
        'TestMap': { ...getEmptyMapData(), id: 'uuid-TestMap' }
    };
    mockRepoMaps.value = [];
    mockMapManager.getCurrentMapName.mockReturnValue('TestMap');
    checkPermission.mockReturnValue({ allowed: true });

    setMapDependencies({
        eventBus: mockEventBus,
        groupManager: mockGroupManager,
        layerManager: mockLayerManager
    });
});

// ============================================================================
// activateAtlasInitialMap — bug B regression
// ============================================================================

describe('activateAtlasInitialMap (bug B)', () => {
    // Opening a server atlas pulls its maps but leaves the app on the local default
    // "Principal" map; the user could not see or sync onto the shared content. Atlas
    // maps carry a UUID id, the local default does not — so we activate the UUID one.
    it('activates the atlas map (UUID id), not the local default "Principal"', async () => {
        mockRepoMaps.value = [
            { name: 'Principal' },                       // local default — no UUID id
            { id: 'uuid-tatico', name: 'Mapa Tático' },  // atlas map — UUID id
        ];

        const activated = await activateAtlasInitialMap();

        expect(activated).toBe('Mapa Tático');
        expect(mockMapManager.setCurrentMap).toHaveBeenCalledWith('Mapa Tático');
    });

    it('creates and activates a first atlas map when the atlas has no UUID-keyed map', async () => {
        // A brand-new EMPTY atlas has only the local default 'Principal' (no UUID). Rather
        // than stranding the user on the un-syncable local map, activateAtlasInitialMap now
        // creates a first atlas map (UUID-keyed) and switches to it (§item3).
        mockRepoMaps.value = [{ name: 'Principal' }];

        const activated = await activateAtlasInitialMap();

        expect(activated).toBeTruthy();
        expect(mockMapManager.setCurrentMap).toHaveBeenCalled();
    });

    it('returns null when no UUID map exists and creation is blocked (e.g. viewer)', async () => {
        mockRepoMaps.value = [{ name: 'Principal' }];
        checkPermission.mockReturnValue({ allowed: false, reason: 'NO_EDIT' });

        const activated = await activateAtlasInitialMap();

        expect(activated).toBeNull();
        expect(mockMapManager.setCurrentMap).not.toHaveBeenCalled();
    });

    it('accepts a Map-shaped getAllMaps() return', async () => {
        mockRepoMaps.value = new Map([
            ['uuid-tatico', { id: 'uuid-tatico', name: 'Mapa Tático' }],
        ]);

        const activated = await activateAtlasInitialMap();

        expect(activated).toBe('Mapa Tático');
        expect(mockMapManager.setCurrentMap).toHaveBeenCalledWith('Mapa Tático');
    });
});

// ============================================================================
// MAP CRUD
// ============================================================================

describe('getAllMapNamesStore', () => {
    it('returns maps in saved order', async () => {
        mockMaps.value = {
            'MapA': getEmptyMapData(),
            'MapB': getEmptyMapData(),
            'MapC': getEmptyMapData()
        };
        mockSettings.value.mapOrder = ['MapC', 'MapA', 'MapB'];

        const names = await getAllMapNamesStore();

        expect(names).toEqual(['MapC', 'MapA', 'MapB']);
    });

    it('appends maps not in saved order', async () => {
        mockMaps.value = {
            'MapA': getEmptyMapData(),
            'MapB': getEmptyMapData(),
            'MapNew': getEmptyMapData()
        };
        mockSettings.value.mapOrder = ['MapB', 'MapA'];

        const names = await getAllMapNamesStore();

        expect(names).toEqual(['MapB', 'MapA', 'MapNew']);
    });

    it('returns all maps when no saved order exists', async () => {
        mockMaps.value = {
            'MapA': getEmptyMapData(),
            'MapB': getEmptyMapData()
        };

        const names = await getAllMapNamesStore();

        expect(names).toEqual(['MapA', 'MapB']);
    });
});

describe('hasAnyMapFeatures', () => {
    it('returns false when no map has features', async () => {
        mockMaps.value = { 'MapA': getEmptyMapData(), 'MapB': getEmptyMapData() };
        expect(await hasAnyMapFeatures()).toBe(false);
    });

    it('returns true when any map has at least one feature', async () => {
        const withFeature = getEmptyMapData();
        withFeature.features.points.push({ properties: { id: 'p1' } });
        mockMaps.value = { 'MapA': getEmptyMapData(), 'MapB': withFeature };
        expect(await hasAnyMapFeatures()).toBe(true);
    });
});

describe('addMap', () => {
    it('creates a new map and stores it in repository', async () => {
        const result = await addMap('NewMap');

        expect(result).toBeDefined();
        expect(result.id).toBe('uuid-NewMap');
        // Verify the map was actually stored
        expect(mockMaps.value['NewMap']).toBeDefined();
        expect(mockMaps.value['NewMap'].id).toBe('uuid-NewMap');
        expect(mockMapManager.addMapToMemory).toHaveBeenCalledWith('NewMap');
    });

    it('registra a intenção do `map` CREATE, de nível ATLAS, antes de gravar o documento', async () => {
        const { updateMapDataCompat } = await import('../../src/js/store/repositories/index.js');
        const { persistOperationIntents } = await import('../../src/js/store/sync/operation-dispatcher.js');

        await addMap('NewMap');

        expect(intents).toHaveLength(1);
        expect(intents[0].entityType).toBe('map');
        expect(intents[0].operationType).toBe('create');
        expect(intents[0].entityId).toBe('uuid-NewMap');
        // Nível ATLAS: o `mapId` de contexto é nulo, como em toda op de mapa.
        expect(intents[0].mapId).toBeNull();
        expect(intents[0].data).toMatchObject({ id: 'uuid-NewMap', name: 'NewMap' });
        // A ORDEM, que é a migração inteira: o diário ANTES da gravação. Antes disto a cunhagem
        // acontecia dentro da gravação (`createMapCompat` gravava ao atribuir o id), então não
        // havia como a intenção anteceder a entidade.
        expect(persistOperationIntents.mock.invocationCallOrder[0])
            .toBeLessThan(updateMapDataCompat.mock.invocationCallOrder[0]);
    });

    it('as NOTAS são uma SEGUNDA intenção na mesma transação, e não um campo do mapa', async () => {
        const { setMapNotesCompat } = await import('../../src/js/store/repositories/index.js');
        const { persistOperationIntents } = await import('../../src/js/store/sync/operation-dispatcher.js');

        await addMap('NewMap', null, null, { title: 'Ordem', description: 'Corpo' });

        expect(intents.map((op) => op.entityType)).toEqual(['map', 'mapNotes']);
        // Mesma forma de `setMapNotes`: o UUID do mapa é o id da entidade E o contexto.
        expect(intents[1].entityId).toBe('uuid-NewMap');
        expect(intents[1].mapId).toBe('uuid-NewMap');
        expect(intents[1].data).toEqual({ title: 'Ordem', description: 'Corpo' });
        expect(intents[1].previousData).toBeNull();
        // As DUAS intenções antes da gravação das notas, que é a metade que o caminho antigo
        // invertia: ele gravava o documento de notas e logava a op do mapa depois.
        expect(persistOperationIntents.mock.invocationCallOrder[0])
            .toBeLessThan(setMapNotesCompat.mock.invocationCallOrder[0]);
    });

    it('blocks when permission denied - no map created', async () => {
        checkPermission.mockReturnValue({ allowed: false, reason: 'NO_EDIT' });
        const mapCountBefore = Object.keys(mockMaps.value).length;

        const result = await addMap('NewMap');

        expect(result).toBeNull();
        // Verify nothing was stored
        expect(Object.keys(mockMaps.value).length).toBe(mapCountBefore);
        expect(emitStoreError).toHaveBeenCalledWith(
            'store:operationBlocked',
            expect.objectContaining({ operation: 'addMap', reason: 'NO_EDIT' })
        );
    });

    it('stores notes when provided', async () => {
        const { setMapNotesCompat } = await import('../../src/js/store/repositories/index.js');

        await addMap('NewMap', null, null, { title: 'Test', description: 'Notes' });

        expect(setMapNotesCompat).toHaveBeenCalledWith('NewMap', { title: 'Test', description: 'Notes' });
    });

    it('does NOT store notes when notes are empty', async () => {
        const { setMapNotesCompat } = await import('../../src/js/store/repositories/index.js');

        await addMap('NewMap', null, null, {});

        expect(setMapNotesCompat).not.toHaveBeenCalled();
    });
});

describe('removeMap', () => {
    it('removes a map from storage and memory', async () => {
        mockMaps.value = {
            'TestMap': { ...getEmptyMapData(), id: 'uuid-TestMap' },
            'OtherMap': { ...getEmptyMapData(), id: 'uuid-OtherMap' }
        };

        const result = await removeMap('OtherMap');

        expect(result.success).toBe(true);
        expect(result.wasCurrentMap).toBe(false);
        expect(result.remainingMapsCount).toBe(1);
        // Verify storage was actually cleaned
        expect(mockMaps.value['OtherMap']).toBeUndefined();
        expect(mockMaps.value['TestMap']).toBeDefined();
        expect(mockMapManager.removeMapFromMemory).toHaveBeenCalledWith('OtherMap');
    });

    it('prevents deleting the last map - storage untouched', async () => {
        mockMaps.value = {
            'TestMap': { ...getEmptyMapData(), id: 'uuid-TestMap' }
        };

        const result = await removeMap('TestMap');

        expect(result.success).toBe(false);
        expect(result.reason).toBe('LAST_MAP');
        // Verify map was NOT removed from storage
        expect(mockMaps.value['TestMap']).toBeDefined();

        // `reason` é código de máquina, `message` é o que o usuário lê. Esta recusa já
        // carregou a frase em português DENTRO de `reason`, e o listener, que separa os
        // avisos justamente por esse campo, caía no balde genérico e dizia "Acesso somente
        // leitura" para um caso que não tem nada a ver com permissão.
        expect(emitStoreError).toHaveBeenCalledWith(
            'store:operationBlocked',
            expect.objectContaining({
                operation: 'removeMap',
                reason: 'LAST_MAP',
                message: expect.stringContaining('único mapa')
            })
        );
    });

    it('switches to first remaining map when removing current', async () => {
        mockMaps.value = {
            'TestMap': { ...getEmptyMapData(), id: 'uuid-TestMap' },
            'OtherMap': { ...getEmptyMapData(), id: 'uuid-OtherMap' }
        };

        const result = await removeMap('TestMap');

        expect(result.success).toBe(true);
        expect(result.wasCurrentMap).toBe(true);
        expect(result.newCurrentMap).toBe('OtherMap');
    });

    it('clears groups for removed map', async () => {
        mockMaps.value = {
            'TestMap': { ...getEmptyMapData(), id: 'uuid-TestMap' },
            'OtherMap': { ...getEmptyMapData(), id: 'uuid-OtherMap' }
        };

        await removeMap('OtherMap');

        expect(mockGroupManager.clearMapGroups).toHaveBeenCalledWith('OtherMap');
    });

    it('returns MAP_NOT_FOUND for nonexistent map', async () => {
        mockMaps.value = {
            'TestMap': { ...getEmptyMapData(), id: 'uuid-TestMap' },
            'OtherMap': { ...getEmptyMapData(), id: 'uuid-OtherMap' }
        };

        // Override getMapDataCompat to return empty for specific map
        const { getMapDataCompat } = await import('../../src/js/store/repositories/index.js');
        getMapDataCompat.mockResolvedValueOnce({});

        const result = await removeMap('Ghost');

        expect(result.success).toBe(false);
        expect(result.reason).toBe('MAP_NOT_FOUND');
    });

    it('blocks when permission denied', async () => {
        checkPermission.mockReturnValue({ allowed: false, reason: 'NO_DELETE' });

        const result = await removeMap('TestMap');

        expect(result).toEqual({ success: false, reason: 'PERMISSION_DENIED' });
    });

    it('removes badge color for deleted map', async () => {
        mockMaps.value = {
            'TestMap': { ...getEmptyMapData(), id: 'uuid-TestMap' },
            'OtherMap': { ...getEmptyMapData(), id: 'uuid-OtherMap' }
        };
        mockSettings.value.mapBadgeColors = { TestMap: '#3b82f6', OtherMap: '#f59e0b' };

        await removeMap('OtherMap');

        expect(setSettingCompat).toHaveBeenCalledWith(
            'mapBadgeColors',
            expect.not.objectContaining({ OtherMap: expect.anything() })
        );
    });
});

describe('renameMap', () => {
    it('renames map in storage: old key gone, new key present', async () => {
        await renameMap('TestMap', 'RenamedMap');

        // Storage should have new name, not old
        expect(mockMaps.value['TestMap']).toBeUndefined();
        expect(mockMaps.value['RenamedMap']).toBeDefined();
        expect(mockMapManager.renameMapInMemory).toHaveBeenCalledWith('TestMap', 'RenamedMap');
    });

    it('updates map order: old name replaced with new name', async () => {
        mockSettings.value.mapOrder = ['TestMap', 'OtherMap'];

        await renameMap('TestMap', 'RenamedMap');

        // Verify the actual stored order, not just the mock call
        expect(mockSettings.value.mapOrder).toEqual(['RenamedMap', 'OtherMap']);
    });

    it('transfers badge color: old key removed, new key has same color', async () => {
        mockSettings.value.mapBadgeColors = { TestMap: '#3b82f6', Other: '#f59e0b' };

        await renameMap('TestMap', 'RenamedMap');

        const colors = mockSettings.value.mapBadgeColors;
        expect(colors.TestMap).toBeUndefined();
        expect(colors.RenamedMap).toBe('#3b82f6');
        expect(colors.Other).toBe('#f59e0b');
    });

    it('blocks rename on locked map - storage unchanged', async () => {
        mockLockedMaps.value = new Set(['TestMap']);

        await renameMap('TestMap', 'NewName');

        // Map should still exist under old name
        expect(mockMaps.value['TestMap']).toBeDefined();
        expect(mockMaps.value['NewName']).toBeUndefined();
    });

    it('blocks when permission denied', async () => {
        checkPermission.mockReturnValue({ allowed: false, reason: 'NO_EDIT' });

        await renameMap('TestMap', 'NewName');

        expect(mockMaps.value['TestMap']).toBeDefined();
        expect(mockMaps.value['NewName']).toBeUndefined();
        expect(emitStoreError).toHaveBeenCalledWith(
            'store:operationBlocked',
            expect.objectContaining({ operation: 'renameMap', reason: 'NO_EDIT' })
        );
    });

    // POR QUE O RENAME PRECISA DA TRAVA DO DOCUMENTO.
    //
    // `LocalRepository.renameMap`, no caminho UUID, NAO substitui o registro inteiro: ele
    // le o documento do mapa, muta o campo `name` e grava o documento de volta. E o mesmo
    // read-modify-write de `addFeature`, no mesmo documento. Sem a trava, renomear enquanto
    // o usuario desenha (ou enquanto uma op remota chega) descarta uma das duas escritas em
    // silencio: medido em 20 de 20 execucoes, nas duas ordens.
    //
    // O defeito escapou da auditoria original porque ela grepou `updateMapDataCompat` e
    // `repo.saveMap`, e o rename grava por `mapStore.setItem`, que nao casa com nenhum dos
    // dois. Conferir um subconjunto e tratar como o conjunto.
    describe('serializacao do documento', () => {
        it('roda o rename DENTRO da trava do documento do mapa', async () => {
            let ocupadoDuranteORename = null;
            renameMapCompat.mockImplementationOnce(async (oldName, newName) => {
                ocupadoDuranteORename = getDocumentLockStats().busy;
                await Promise.resolve();
                mockMaps.value[newName] = mockMaps.value[oldName];
                delete mockMaps.value[oldName];
            });

            await renameMap('TestMap', 'RenamedMap');

            expect(ocupadoDuranteORename).toEqual(['map:TestMap:renameMap']);
            expect(getDocumentLockStats().busy).toEqual([]);
        });

        it('exclui de fato outro escritor do mesmo documento', async () => {
            // Prova o efeito, nao a presenca de uma flag: o outro escritor so pode entrar
            // depois que o rename sair. A ordem de `eventos` e o que quebra sem a trava.
            const eventos = [];
            renameMapCompat.mockImplementationOnce(async (oldName, newName) => {
                eventos.push('rename:entrou');
                await Promise.resolve();
                await Promise.resolve();
                mockMaps.value[newName] = mockMaps.value[oldName];
                delete mockMaps.value[oldName];
                eventos.push('rename:saiu');
            });

            const renomeando = renameMap('TestMap', 'RenamedMap');
            const concorrente = withMapDocument('TestMap', 'escritorConcorrente', async () => {
                eventos.push('outro:entrou');
                await Promise.resolve();
                eventos.push('outro:saiu');
            });

            await Promise.all([renomeando, concorrente]);

            // A propriedade e "nenhuma secao comeca antes de a anterior terminar", e ela
            // vale para qualquer ordem de chegada. Assertar uma ordem especifica prenderia
            // o escalonador (o rename tem awaits antes da trava, entao quem chega primeiro
            // varia) em vez da exclusao, que e o que o conserto garante.
            expect(eventos).toHaveLength(4);
            for (let i = 0; i < eventos.length; i += 2) {
                const [abriu, fechou] = [eventos[i], eventos[i + 1]];
                expect(abriu).toMatch(/:entrou$/);
                expect(fechou).toBe(abriu.replace(':entrou', ':saiu'));
            }
            expect(mockMaps.value['RenamedMap']).toBeDefined();
            expect(mockMaps.value['TestMap']).toBeUndefined();
        });
    });
});

describe('setCurrentMap', () => {
    it('sets current map and loads groups and layers', async () => {
        await setCurrentMap('OtherMap');

        expect(mockMapManager.setCurrentMap).toHaveBeenCalledWith('OtherMap');
        expect(mockGroupManager.loadGroupsToMemory).toHaveBeenCalledWith('OtherMap');
        expect(mockLayerManager.loadLayersToMemory).toHaveBeenCalledWith('OtherMap');
    });

    it('emits MAP_LOCK_CHANGED event', async () => {
        await setCurrentMap('OtherMap');

        expect(mockEventBus.emit).toHaveBeenCalledWith(
            'map:lockChanged',
            expect.objectContaining({ mapName: 'OtherMap' })
        );
    });

    it('emits locked=true for locked map', async () => {
        mockLockedMaps.value = new Set(['LockedMap']);

        await setCurrentMap('LockedMap');

        expect(mockEventBus.emit).toHaveBeenCalledWith(
            'map:lockChanged',
            { mapName: 'LockedMap', locked: true }
        );
    });
});

// ============================================================================
// MAP GETTERS
// ============================================================================

describe('getCurrentMapName', () => {
    it('returns from setting', async () => {
        mockSettings.value.lastActiveMap = 'SavedMap';
        const name = await getCurrentMapName();
        expect(name).toBe('SavedMap');
    });
});

describe('getCurrentMapNameSync', () => {
    it('returns from mapManager', () => {
        expect(getCurrentMapNameSync()).toBe('TestMap');
    });
});

describe('getCurrentMapIdSync', () => {
    it('returns from mapManager', () => {
        expect(getCurrentMapIdSync()).toBe('map-uuid-123');
    });
});

describe('getCurrentMapInfoSync', () => {
    it('returns name and id', () => {
        const info = getCurrentMapInfoSync();
        expect(info).toEqual({ name: 'TestMap', id: 'map-uuid-123' });
    });
});

// ============================================================================
// MAP LOCK
// ============================================================================

describe('isCurrentMapLockedSync', () => {
    it('returns false when unlocked', () => {
        expect(isCurrentMapLockedSync()).toBe(false);
    });

    it('returns true when map is in locked set', () => {
        mockLockedMaps.value = new Set(['TestMap']);
        expect(isCurrentMapLockedSync()).toBe(true);
    });
});

describe('setBriefingLockOverride', () => {
    it('makes isCurrentMapLockedSync return true', () => {
        setBriefingLockOverride(true);
        expect(isCurrentMapLockedSync()).toBe(true);
    });

    it('emits MAP_LOCK_CHANGED', () => {
        setBriefingLockOverride(true);
        expect(mockEventBus.emit).toHaveBeenCalledWith(
            'map:lockChanged',
            expect.objectContaining({ locked: true })
        );
    });

    it('restores normal behavior when deactivated', () => {
        setBriefingLockOverride(true);
        expect(isCurrentMapLockedSync()).toBe(true);
        setBriefingLockOverride(false);
        expect(isCurrentMapLockedSync()).toBe(false);
    });
});

describe('toggleMapLock', () => {
    it('toggles lock state from unlocked to locked', async () => {
        const newState = await toggleMapLock();

        expect(newState).toBe(true);
        expect(mockLockedMaps.value.has('TestMap')).toBe(true);
        expect(mockEventBus.emit).toHaveBeenCalledWith(
            'map:lockChanged',
            { mapName: 'TestMap', locked: true }
        );
    });

    it('toggles lock state from locked to unlocked', async () => {
        // First, set the map as locked
        mockSettings.value['mapLocked_TestMap'] = true;
        mockLockedMaps.value = new Set(['TestMap']);

        const newState = await toggleMapLock();

        expect(newState).toBe(false);
        expect(mockLockedMaps.value.has('TestMap')).toBe(false);
    });

    it('blocks when permission denied', async () => {
        checkPermission.mockReturnValue({ allowed: false, reason: 'NO_LOCK' });

        const result = await toggleMapLock();

        expect(result).toBeNull();
        expect(emitStoreError).toHaveBeenCalled();
        expect(intents).toEqual([]);
        expect(setSettingCompat).not.toHaveBeenCalled();
    });

    it('registra o `map` UPDATE com `{locked}` e o estado anterior, e a op vive AQUI', async () => {
        // A UNIFICACAO DOS DOIS PONTOS DE ENTRADA, de 2026-09-13. Esta op gravava o app setting,
        // mexia na memoria e emitia o evento SEM logar nada: quem a chamasse direto (um teste, ou
        // qualquer outro chamador) travava so' o proprio cliente, e a op que viajava nascia em
        // `locking/map-lock.controller.js`, fora de transacao e DEPOIS da escrita local.
        const newState = await toggleMapLock();

        expect(newState).toBe(true);
        expect(intents).toEqual([{
            entityType: 'map',
            operationType: 'update',
            entityId: 'uuid-TestMap',
            // Nivel ATLAS: `mapId` de contexto nulo, como toda op de mapa.
            mapId: null,
            data: { locked: true },
            previousData: { locked: false }
        }]);
    });

    it('a intencao antecede a gravacao do app setting, e a memoria so muda depois', async () => {
        const { persistOperationIntents } = await import('../../src/js/store/sync/operation-dispatcher.js');

        await toggleMapLock();

        expect(persistOperationIntents.mock.invocationCallOrder[0])
            .toBeLessThan(setSettingCompat.mock.invocationCallOrder[0]);
        expect(setSettingCompat).toHaveBeenCalledWith('mapLocked_TestMap', true);
        // O efeito de memoria e o evento vivem em `tx.deferSync`, logo depois da gravacao.
        expect(mockLockedMaps.value.has('TestMap')).toBe(true);
    });

    it('destravar carrega a inversao no payload e no estado anterior', async () => {
        mockSettings.value['mapLocked_TestMap'] = true;
        mockLockedMaps.value = new Set(['TestMap']);

        expect(await toggleMapLock()).toBe(false);

        expect(intents).toHaveLength(1);
        expect(intents[0].data).toEqual({ locked: false });
        expect(intents[0].previousData).toEqual({ locked: true });
    });
});

describe('isMapLocked', () => {
    it('returns lock state from settings', async () => {
        mockSettings.value['mapLocked_TestMap'] = true;

        const locked = await isMapLocked('TestMap');

        expect(locked).toBe(true);
    });

    it('returns false when no setting exists', async () => {
        const locked = await isMapLocked('TestMap');
        expect(locked).toBe(false);
    });
});

// ============================================================================
// BASE LAYER
// ============================================================================

describe('getCurrentBaseLayer', () => {
    it('returns base layer for map', async () => {
        mockMaps.value.TestMap.baseLayer = 'osm';

        const bl = await getCurrentBaseLayer();

        expect(bl).toBe('osm');
    });
});

describe('setBaseLayer', () => {
    it('sets base layer', async () => {
        const { updateMapDataCompat } = await import('../../src/js/store/repositories/index.js');

        await setBaseLayer('osm');

        expect(updateMapDataCompat).toHaveBeenCalledWith(
            'TestMap',
            expect.objectContaining({ baseLayer: 'osm' })
        );
    });

    // A TRAVA PASSOU A SER LIDA DO DISCO (`isMapLocked`) e não mais do conjunto em memória,
    // porque as três funções desta seção aceitam nome de mapa e o conjunto só é completo em
    // atlas de SERVIDOR. Para o mapa CORRENTE o comportamento é o mesmo, e é o que este caso
    // mede: quem escreve a trava (`toggleMapLock`, snapshot remoto) grava o app setting antes
    // de tocar a memória.
    it('blocks on locked map', async () => {
        mockSettings.value['mapLocked_TestMap'] = true;
        const { updateMapDataCompat } = await import('../../src/js/store/repositories/index.js');

        await setBaseLayer('osm');

        expect(updateMapDataCompat).not.toHaveBeenCalled();
    });

    it('recusa quando o mapa ALVO está travado e o corrente não está', async () => {
        // O conjunto em memória fica VAZIO de propósito: num atlas local ele é isso mesmo para
        // todo mapa que não é o corrente, então a recusa tem de vir do disco. Molde:
        // tests/store/layer-transfer.test.js, caso de destino travado.
        mockLockedMaps.value = new Set();
        mockSettings.value['mapLocked_OutroMapa'] = true;
        mockMaps.value.OutroMapa = { ...getEmptyMapData(), id: 'uuid-OutroMapa' };
        const { updateMapDataCompat } = await import('../../src/js/store/repositories/index.js');

        await setBaseLayer('osm', 'OutroMapa');

        expect(updateMapDataCompat).not.toHaveBeenCalled();
        expect(intents).toEqual([]);
    });

    it('registra a intenção durável do mapa-base, com o valor anterior', async () => {
        mockMaps.value.TestMap.baseLayer = 'carta-topografica';

        await setBaseLayer('osm');

        expect(intents).toEqual([{
            entityType: 'baseLayer',
            operationType: 'update',
            entityId: 'uuid-TestMap',
            mapId: 'uuid-TestMap',
            data: { baseLayer: 'osm' },
            previousData: { baseLayer: 'carta-topografica' }
        }]);
    });
});

// ============================================================================
// MAP POSITION
// ============================================================================

describe('updateMapPosition', () => {
    it('saves position with sync metadata', async () => {
        const { updateMapDataCompat } = await import('../../src/js/store/repositories/index.js');

        await updateMapPosition(-22.9, -43.17, 12, 0, 0);

        expect(updateMapDataCompat).toHaveBeenCalledWith(
            'TestMap',
            expect.objectContaining({
                center_lat: -22.9,
                center_long: -43.17,
                zoom: 12,
                bearing: 0,
                pitch: 0,
                savedPosition: expect.objectContaining({
                    center_lat: -22.9,
                    center_long: -43.17,
                    zoom: 12
                })
            })
        );
    });

    it('blocks on locked map', async () => {
        mockSettings.value['mapLocked_TestMap'] = true;
        const { updateMapDataCompat } = await import('../../src/js/store/repositories/index.js');

        await updateMapPosition(-22.9, -43.17, 12, 0, 0);

        expect(updateMapDataCompat).not.toHaveBeenCalled();
    });

    it('recusa quando o mapa ALVO está travado e o corrente não está', async () => {
        mockLockedMaps.value = new Set();
        mockSettings.value['mapLocked_OutroMapa'] = true;
        mockMaps.value.OutroMapa = { ...getEmptyMapData(), id: 'uuid-OutroMapa' };
        const { updateMapDataCompat } = await import('../../src/js/store/repositories/index.js');

        await updateMapPosition(-22.9, -43.17, 12, 0, 0, 'OutroMapa');

        expect(updateMapDataCompat).not.toHaveBeenCalled();
        expect(intents).toEqual([]);
    });

    it('registra CREATE na primeira posição e UPDATE quando já existe uma', async () => {
        // O que separa os dois é o `id` da posição guardada, não a existência dos campos planos:
        // um mapa LEGADO tem os cinco campos e nenhuma posição com id, e nasce como CREATE.
        await updateMapPosition(-22.9, -43.17, 12, 0, 0);
        expect(intents).toHaveLength(1);
        expect(intents[0].entityType).toBe('mapPosition');
        expect(intents[0].operationType).toBe('create');
        expect(intents[0].previousData).toBeNull();

        await updateMapPosition(-23, -43, 14, 0, 0);
        expect(intents).toHaveLength(2);
        expect(intents[1].operationType).toBe('update');
        expect(intents[1].data).toMatchObject({ zoom: 14 });
        expect(intents[1].previousData).toMatchObject({ zoom: 12 });
    });
});

describe('getMapPosition', () => {
    it('returns position data', async () => {
        mockMaps.value.TestMap.center_lat = -22.9;
        mockMaps.value.TestMap.center_long = -43.17;
        mockMaps.value.TestMap.zoom = 12;
        mockMaps.value.TestMap.bearing = 45;
        mockMaps.value.TestMap.pitch = 30;

        const pos = await getMapPosition('TestMap');

        expect(pos).toEqual({
            center_lat: -22.9,
            center_long: -43.17,
            zoom: 12,
            bearing: 45,
            pitch: 30
        });
    });
});

describe('hasMapSavedPosition', () => {
    it('returns true when all position fields are set', async () => {
        mockMaps.value.TestMap.center_lat = -22.9;
        mockMaps.value.TestMap.center_long = -43.17;
        mockMaps.value.TestMap.zoom = 12;
        mockMaps.value.TestMap.bearing = 0;
        mockMaps.value.TestMap.pitch = 0;

        const result = await hasMapSavedPosition('TestMap');
        expect(result).toBe(true);
    });

    it('returns false when position fields are null', async () => {
        const result = await hasMapSavedPosition('TestMap');
        expect(result).toBe(false);
    });
});

describe('clearMapPosition', () => {
    it('clears position data', async () => {
        mockMaps.value.TestMap.center_lat = -22.9;
        mockMaps.value.TestMap.center_long = -43.17;
        mockMaps.value.TestMap.zoom = 12;
        mockMaps.value.TestMap.bearing = 0;
        mockMaps.value.TestMap.pitch = 0;
        mockMaps.value.TestMap.savedPosition = { id: 'pos-1', center_lat: -22.9 };

        const { updateMapDataCompat } = await import('../../src/js/store/repositories/index.js');

        await clearMapPosition('TestMap');

        expect(updateMapDataCompat).toHaveBeenCalledWith(
            'TestMap',
            expect.objectContaining({
                center_lat: null,
                center_long: null,
                zoom: null,
                bearing: null,
                pitch: null
            })
        );
    });

    // ========================================================================
    // F1 — a op de limpeza é UPDATE com os cinco campos nulos, nunca DELETE.
    //
    // O DELETE que ela emitia era, no servidor, um ato sobre o MAPA: a op de
    // configuração de mapa carimba o id do MAPA como `entityId`, o tipo
    // normaliza para o alvo `map` e o caminho de exclusão não lia o subtipo,
    // então limpar a posição gravava `deleted_at` no mapa inteiro.
    // ========================================================================
    it('registra UPDATE com os cinco campos nulos, nunca DELETE', async () => {
        mockMaps.value.TestMap.savedPosition = { id: 'pos-1', center_lat: -22.9 };

        await clearMapPosition('TestMap');

        expect(intents).toEqual([{
            entityType: 'mapPosition',
            operationType: 'update',
            entityId: 'uuid-TestMap',
            mapId: 'uuid-TestMap',
            data: { center_lat: null, center_long: null, zoom: null, bearing: null, pitch: null },
            previousData: expect.objectContaining({ id: 'pos-1' })
        }]);
    });

    it('o caso LEGADO (posição sem id, só campos planos) também emite a op', async () => {
        // A condição `if (positionId)` deixava este mapa sem op nenhuma: o documento local
        // limpava e o par ficava com a posição velha para sempre, sem erro em lugar nenhum.
        mockMaps.value.TestMap.center_lat = -22.9;
        mockMaps.value.TestMap.center_long = -43.17;
        mockMaps.value.TestMap.zoom = 12;
        delete mockMaps.value.TestMap.savedPosition;

        await clearMapPosition('TestMap');

        expect(intents).toEqual([{
            entityType: 'mapPosition',
            operationType: 'update',
            entityId: 'uuid-TestMap',
            mapId: 'uuid-TestMap',
            data: { center_lat: null, center_long: null, zoom: null, bearing: null, pitch: null },
            previousData: null
        }]);
    });

    it('sem permissão de edição não grava nem registra intenção', async () => {
        checkPermission.mockReturnValue({ allowed: false, reason: 'read_only', required: 'EDIT' });
        const { updateMapDataCompat } = await import('../../src/js/store/repositories/index.js');

        await clearMapPosition('TestMap');

        expect(updateMapDataCompat).not.toHaveBeenCalled();
        expect(intents).toEqual([]);
        expect(emitStoreError).toHaveBeenCalledWith(
            'store:operationBlocked',
            expect.objectContaining({ operation: 'clearMapPosition', required: 'EDIT' })
        );
    });

    it('blocks on locked map', async () => {
        mockSettings.value['mapLocked_TestMap'] = true;
        const { updateMapDataCompat } = await import('../../src/js/store/repositories/index.js');

        await clearMapPosition();

        expect(updateMapDataCompat).not.toHaveBeenCalled();
    });

    it('recusa quando o mapa ALVO está travado e o corrente não está', async () => {
        mockLockedMaps.value = new Set();
        mockSettings.value['mapLocked_OutroMapa'] = true;
        mockMaps.value.OutroMapa = { ...getEmptyMapData(), id: 'uuid-OutroMapa' };
        const { updateMapDataCompat } = await import('../../src/js/store/repositories/index.js');

        await clearMapPosition('OutroMapa');

        expect(updateMapDataCompat).not.toHaveBeenCalled();
        expect(intents).toEqual([]);
    });
});

// ============================================================================
// MAP BADGE COLORS
// ============================================================================

describe('getMapBadgeColor', () => {
    it('returns existing color', async () => {
        mockSettings.value.mapBadgeColors = { TestMap: '#ff0000' };

        const color = await getMapBadgeColor('TestMap');

        expect(color).toBe('#ff0000');
    });

    it('auto-assigns a new color for uncolored map', async () => {
        mockSettings.value.mapBadgeColors = {};

        const color = await getMapBadgeColor('NewMap');

        expect(color).toBeDefined();
        expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    });
});

describe('getAllMapBadgeColors', () => {
    it('assigns colors to all maps and removes stale entries', async () => {
        mockMaps.value = {
            'MapA': getEmptyMapData(),
            'MapB': getEmptyMapData()
        };
        mockSettings.value.mapBadgeColors = { 'DeletedMap': '#ff0000' };

        const colors = await getAllMapBadgeColors();

        expect(colors.DeletedMap).toBeUndefined();
        expect(colors.MapA).toBeDefined();
        expect(colors.MapB).toBeDefined();
    });
});

describe('getOrderedMapBadgeColors', () => {
    it('assigns each map a palette color keyed by display name (stable, name-based)', async () => {
        mockMaps.value = {
            'MapA': getEmptyMapData(),
            'MapB': getEmptyMapData(),
            'MapC': getEmptyMapData()
        };
        mockSettings.value.mapOrder = ['MapC', 'MapA', 'MapB'];

        const colors = await getOrderedMapBadgeColors();

        // Keyed by display name; each color is a valid palette hue equal to the pure name-based color.
        for (const name of ['MapA', 'MapB', 'MapC']) {
            expect(colors[name]).toMatch(/^#[0-9a-f]{6}$/i);
            expect(colors[name]).toBe(mapBadgeColorForName(name));
        }
    });

    it('a map KEEPS its color when the list is reordered (does not recolor on reorder)', async () => {
        mockMaps.value = {
            'MapA': getEmptyMapData(),
            'MapB': getEmptyMapData(),
            'MapC': getEmptyMapData()
        };

        mockSettings.value.mapOrder = ['MapC', 'MapA', 'MapB'];
        const before = await getOrderedMapBadgeColors();

        // Reorder the maps — each map's color must be UNCHANGED (the previous behavior recolored
        // every map by its new position, which the user found confusing).
        mockSettings.value.mapOrder = ['MapB', 'MapC', 'MapA'];
        const after = await getOrderedMapBadgeColors();

        for (const name of ['MapA', 'MapB', 'MapC']) {
            expect(after[name]).toBe(before[name]);
        }
    });

    it('returns an empty map when there are no maps', async () => {
        mockMaps.value = {};
        delete mockSettings.value.mapOrder;

        const colors = await getOrderedMapBadgeColors();

        expect(colors).toEqual({});
    });
});

describe('removeMapBadgeColor', () => {
    it('removes color for a map', async () => {
        mockSettings.value.mapBadgeColors = { TestMap: '#ff0000', Other: '#00ff00' };

        await removeMapBadgeColor('TestMap');

        expect(setSettingCompat).toHaveBeenCalledWith(
            'mapBadgeColors',
            { Other: '#00ff00' }
        );
    });
});

// ============================================================================
// MAP ORDER
// ============================================================================

describe('getMapOrder / setMapOrder', () => {
    it('gets map order from settings', async () => {
        mockSettings.value.mapOrder = ['MapA', 'MapB'];
        const order = await getMapOrder();
        expect(order).toEqual(['MapA', 'MapB']);
    });

    it('sets map order', async () => {
        await setMapOrder(['MapB', 'MapA']);
        expect(setSettingCompat).toHaveBeenCalledWith('mapOrder', ['MapB', 'MapA']);
    });

    it('registra a ordem como intenção de chave de atlas, para ela viajar entre pares', async () => {
        // A ordem da lista de mapas tem de chegar aos colaboradores: `setMapOrder` registra um
        // `setting` UPDATE carregando { mapOrder }, que é a perna de saída completada pela
        // aplicação de entrada (remote-operation-handler › mapOrder) e pelo e2e de duas browsers
        // (browser-collab-map-order). Sem atlas registrado, o id é a sentinela 'atlas', que o
        // servidor aceita porque ele escopa a chave pelo atlas da ROTA.
        mockSettings.value.mapOrder = ['MapA', 'MapB'];

        await setMapOrder(['MapB', 'MapA']);

        expect(intents).toEqual([{
            entityType: 'setting',
            operationType: 'update',
            entityId: 'atlas',
            mapId: null,
            data: { mapOrder: ['MapB', 'MapA'] },
            previousData: { mapOrder: ['MapA', 'MapB'] }
        }]);
    });

    it('a ordem é gravada ANTES de qualquer efeito e a intenção vem antes dela', async () => {
        // A ordem entre diário e disco é medida com disco de verdade em
        // tests/integration/atlas-keys-write-ahead.test.js; aqui fica a fiação: a gravação local
        // acontece e a intenção existe, com a chave certa.
        await setMapOrder(['MapB', 'MapA']);
        expect(setSettingCompat).toHaveBeenCalledWith('mapOrder', ['MapB', 'MapA']);
        expect(intents.map((op) => op.entityType)).toEqual(['setting']);
    });
});

describe('setMapBadgeColors (chave de atlas, chamada de dentro de renameMap e removeMap)', () => {
    it('renomear o mapa não trava, e a cor viaja como intenção de chave de atlas', async () => {
        // O PONTO DESTE CASO É O DEADLOCK QUE NÃO ACONTECE. `setMapBadgeColors` abre a própria
        // transação, e `renameMap` a chama DEPOIS de a seção de `withMapDocument` ter voltado. Se
        // alguém a chamar de dentro da seção, a fila FIFO de `document-lock.js` (sem reentrância)
        // esperaria por si mesma e este caso ficaria PENDURADO, não vermelho.
        mockSettings.value.mapBadgeColors = { TestMap: '#3b82f6' };

        const renamed = await renameMap('TestMap', 'RenamedMap');

        expect(renamed).toBe(true);
        expect(setSettingCompat).toHaveBeenCalledWith('mapBadgeColors', { RenamedMap: '#3b82f6' });
        const colorIntents = intents.filter((op) => op.data?.mapBadgeColors);
        expect(colorIntents).toHaveLength(1);
        expect(colorIntents[0].entityType).toBe('setting');
        expect(colorIntents[0].mapId).toBeNull();
        // O valor ANTERIOR não se afirma aqui, e a razão é o duplo: este mock devolve a MESMA
        // referência do objeto guardado, que `renameMap` já mutou em memória, enquanto o
        // IndexedDB de verdade entrega um clone estruturado a cada leitura. Quem mede o anterior
        // é tests/integration/atlas-keys-write-ahead.test.js, com disco de verdade.
        expect(colorIntents[0].previousData).toHaveProperty('mapBadgeColors');
    });

    it('excluir o mapa também não trava, e a cor sai da chave', async () => {
        mockMaps.value = {
            'TestMap': { ...getEmptyMapData(), id: 'uuid-TestMap' },
            'OtherMap': { ...getEmptyMapData(), id: 'uuid-OtherMap' }
        };
        mockSettings.value.mapBadgeColors = { TestMap: '#3b82f6', OtherMap: '#f59e0b' };

        const result = await removeMap('OtherMap');

        expect(result.success).toBe(true);
        expect(setSettingCompat).toHaveBeenCalledWith('mapBadgeColors', { TestMap: '#3b82f6' });
        expect(intents.filter((op) => op.data?.mapBadgeColors)).toHaveLength(1);
    });

    it('a intenção da cor viaja no `tx` da EXCLUSÃO, e não numa transação aninhada', async () => {
        // `setMapBadgeColors` abre a própria transação, e uma transação aninhada no `workFn` da
        // outra COMMITA PRIMEIRO: a cor seria registrada e gravada antes de a exclusão registrar
        // qualquer coisa. Por isso `removeMap` passou a registrar a cor no PRÓPRIO `tx` e a gravar
        // a chave na própria função de persistência. As duas intenções são de UMA transação, que é
        // o que este caso mede: elas chegam juntas na mesma chamada do despachante.
        mockMaps.value = {
            'TestMap': { ...getEmptyMapData(), id: 'uuid-TestMap' },
            'OtherMap': { ...getEmptyMapData(), id: 'uuid-OtherMap' }
        };
        mockSettings.value.mapBadgeColors = { TestMap: '#3b82f6', OtherMap: '#f59e0b' };
        const { persistOperationIntents } = await import('../../src/js/store/sync/operation-dispatcher.js');

        await removeMap('OtherMap');

        expect(persistOperationIntents).toHaveBeenCalledOnce();
        expect(persistOperationIntents.mock.calls[0][0].map((op) => op.entityType))
            .toEqual(['map', 'setting']);
        expect(intents[0].operationType).toBe('delete');
        expect(intents[0].entityId).toBe('uuid-OtherMap');
        expect(intents[0].mapId).toBeNull();
        expect(intents[0].previousData).toMatchObject({ id: 'uuid-OtherMap' });
    });

    it('a intenção da exclusão vem ANTES de o documento do mapa ser apagado', async () => {
        mockMaps.value = {
            'TestMap': { ...getEmptyMapData(), id: 'uuid-TestMap' },
            'OtherMap': { ...getEmptyMapData(), id: 'uuid-OtherMap' }
        };
        const { deleteMapCompat } = await import('../../src/js/store/repositories/index.js');
        const { persistOperationIntents } = await import('../../src/js/store/sync/operation-dispatcher.js');

        await removeMap('OtherMap');

        // A inversão que a migração fechou: o caminho antigo apagava o documento primeiro e logava
        // a op por último, com quatro escritas auxiliares no meio, de modo que uma falha ali
        // deixava o mapa sumido localmente e vivo no servidor, sem nada para reenviar.
        expect(persistOperationIntents.mock.invocationCallOrder[0])
            .toBeLessThan(deleteMapCompat.mock.invocationCallOrder[0]);
        expect(mockMaps.value.OtherMap).toBeUndefined();
    });
});

// ============================================================================
// A REVISÃO OBSERVADA (B5, item 2)
// ============================================================================

describe('o mapa declara a base que observou', () => {
    // O MAPA ERA A ÚNICA ENTIDADE APLICADA POR ORDEM DE CHEGADA, e não por política: era a
    // ausência de uma. A verificação por base do servidor é gateada em a op DECLARAR uma base
    // (`hasDeclaredBase`), a declaração é lida de `previousData.confirmedVersion`, e os sítios de
    // escrita do mapa registram o CAMPO que mudaram, nunca o documento. Estes casos medem que a
    // revisão CHEGA no envelope, do documento que o sítio já tinha ou de uma leitura própria; o
    // sítio que alguém escrever depois é assunto de `tests/unit/mapa-declara-base-censo.test.js`.
    const REVISAO = 7;

    beforeEach(() => {
        mockMaps.value.TestMap.confirmedVersion = REVISAO;
    });

    it('renomear declara a revisão, lida do disco junto com os documentos auxiliares', async () => {
        await renameMap('TestMap', 'RenomeadoTest');

        expect(intents).toHaveLength(1);
        expect(intents[0].previousData).toEqual({ name: 'TestMap', confirmedVersion: REVISAO });
        // E o payload NOVO não a carrega: ela descreve o que foi observado, não o que se escreve.
        expect(intents[0].data).toEqual({ name: 'RenomeadoTest' });
    });

    it('travar declara a revisão, e ela não vira parte do estado gravado', async () => {
        await toggleMapLock();

        expect(intents).toHaveLength(1);
        expect(intents[0].previousData).toEqual({ locked: false, confirmedVersion: REVISAO });
        expect(intents[0].data).toEqual({ locked: true });
    });

    it('o mapa-base declara a revisão do documento que a função JÁ leu', async () => {
        mockMaps.value.TestMap.baseLayer = 'carta-topografica';

        await setBaseLayer('osm');

        expect(intents[0].previousData)
            .toEqual({ baseLayer: 'carta-topografica', confirmedVersion: REVISAO });
    });

    it('a posição declara a revisão do MAPA, e só quando havia posição anterior', async () => {
        // A primeira gravação é uma CRIAÇÃO: não há posição anterior, logo não há revisão
        // observada, e prometer uma ali convidaria a lê-la como se houvesse.
        await updateMapPosition(-22.9, -43.2, 10, 0, 0);
        expect(intents[0].operationType).toBe('create');
        expect(intents[0].previousData).toBeNull();

        await updateMapPosition(-23.0, -43.3, 12, 0, 0);
        expect(intents[1].operationType).toBe('update');
        expect(intents[1].previousData).toMatchObject({ confirmedVersion: REVISAO });
    });

    it('limpar a posição declara a revisão do MAPA', async () => {
        await updateMapPosition(-22.9, -43.2, 10, 0, 0);
        intents.length = 0;

        await clearMapPosition();

        expect(intents).toHaveLength(1);
        expect(intents[0].previousData).toMatchObject({ confirmedVersion: REVISAO });
    });

    it('sem revisão no documento, nada é declarado e a op volta a ser LWW por chegada', async () => {
        // A DEGRADAÇÃO É O CAMINHO NORMAL, não um erro: um atlas local, ou um documento cuja
        // revisão de servidor este cliente não pode provar, manda a op sem base e o servidor a
        // aplica por chegada, exatamente como antes de tudo isto existir.
        delete mockMaps.value.TestMap.confirmedVersion;

        await toggleMapLock();

        expect(intents[0].previousData).toEqual({ locked: false });
    });
});

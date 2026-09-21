// Path: tests/store/ajuste-de-mapa-em-mapa-travado.repro.test.js
//
// REPRO do ponto N3: AJUSTE DO PRÓPRIO MAPA NÃO PERGUNTAVA PELA TRAVA DO MAPA CERTO.
//
// ================= O DEFEITO E A CAUSA =======================================
//
// O servidor só impõe `maps.locked` a operações cujo alvo é FILHO do mapa
// (`LOCKABLE_CHILD_TARGETS`, `backend/src/modules/sync/sync.service.js`: feature, group,
// layer, cesium3d, streetview360, catalog_layer, group_feature). As cinco operações de
// AJUSTE DO PRÓPRIO MAPA (posição, camada base, notas, grade, config temporal) têm o MAPA
// como alvo, então passam no gate do servidor e são APLICADAS. A decisão do dono
// (2026-09-21) é não fechar isso no servidor e tratá-las como convenção de CLIENTE, como já
// são as travas de camada, de grupo e de feição. Convenção só vale se todo escritor
// perguntar, e perguntar a MESMA coisa.
//
// Duas das cinco perguntavam pela coisa errada. `setMapNotes` e `setGridStyle`
// (`settings.operations.js`) recebem um `mapName` explícito e chamavam
// `isCurrentMapLockedSync()`, que lê `memoryStore.lockedMaps` e responde sobre o mapa
// CORRENTE: o argumento delas era descartado. São DOIS modos de falha, e o segundo é o que
// não se adivinha:
//
//   1. escrever as notas (ou a grade) de OUTRO mapa consultava a trava de um terceiro;
//   2. em atlas LOCAL aquele conjunto só chega a conter o mapa CORRENTE, porque quem o
//      escreve é `toggleMapLock` e o retrato do servidor (ver `.claude/rules/
//      architecture.md`, "A TRAVA DE OUTRO MAPA"). Numa aba que acabou de abrir um atlas
//      local, o conjunto está VAZIO e a pergunta responde "destravado" para todo mundo.
//
// Daí a forma destes casos: o conjunto em memória fica VAZIO DE PROPÓSITO, como no caso de
// destino travado de `tests/store/layer-transfer.test.js`, e a trava mora só no disco
// (`mapLocked_<nome>`, o app setting que `toggleMapLock` grava ANTES de tocar a memória).
// Um gate que leia o conjunto passa por cima dela sem um erro em lugar nenhum.
//
// ================= O QUE MUDOU ===============================================
//
// `isTargetMapLocked` (`map.operations.js`) virou a pergunta ÚNICA das cinco: lê o app
// setting do DISCO e repergunta pela sobreposição de briefing, que só existe em memória.
// As três de `map.operations.js` já a usavam; as duas de `settings.operations.js` passaram a
// usá-la, e as cinco recusam emitindo `STORE_OPERATION_BLOCKED` com `reason: 'map_locked'`,
// no lugar do `console.warn` que ninguém lê.
//
// ================= POR QUE O MÓDULO REAL, E NÃO UM DUPLO =====================
//
// `map.operations.js` entra INTEIRO e sem mock: o defeito era de FIAÇÃO (qual pergunta cada
// função faz), então um duplo de `isTargetMapLocked` mediria a cópia dele e não a ligação.
// O que se falseia é só o disco e o despachante de intenções.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getEmptyMapData } from '../../src/js/store/repository.utils.js';

// ============================================================================
// Estado compartilhado
// ============================================================================

const { mockMapManager, mockMemoryStore, disco, mapas, intencoes } = vi.hoisted(() => ({
    /** As intenções duráveis registradas na transação, na ordem. */
    intencoes: [],
    mockMapManager: {
        getCurrentMapName: vi.fn(() => 'Mapa corrente'),
        getCurrentMapId: vi.fn(() => 'uuid-Mapa corrente'),
        getCurrentMapInfo: vi.fn(() => ({ name: 'Mapa corrente', id: 'uuid-Mapa corrente' })),
        getMapId: vi.fn((name) => `uuid-${name}`),
        addMapToMemory: vi.fn(),
        processMapColors: vi.fn(async () => {}),
        removeMapFromMemory: vi.fn(async () => {}),
        renameMapInMemory: vi.fn(),
        setCurrentMap: vi.fn(async () => {}),
        getFrequentColors: vi.fn(() => [])
    },
    // O CONJUNTO EM MEMÓRIA FICA VAZIO: é a metade do defeito que não se adivinha.
    mockMemoryStore: {
        lockedMaps: new Set(),
        currentMap: 'Mapa corrente',
        temporalView: new Map(),
        temporalConfigs: new Map()
    },
    /** O disco: app settings, notas e grade, por mapa. */
    disco: { settings: {}, notas: {}, grade: {} },
    mapas: { value: {} }
}));

// ============================================================================
// Mocks: só o disco, o despachante e as folhas que não carregam em node
// ============================================================================

vi.mock('../../src/js/store/cesium3d.operations.js', () => ({
    loadCesium3dDataToMemory: vi.fn(async () => {})
}));
vi.mock('../../src/js/store/streetview360.operations.js', () => ({
    loadStreetview360DataToMemory: vi.fn(async () => {})
}));
vi.mock('../../src/js/store/catalog.operations.js', () => ({
    getCatalogLayers: vi.fn(async () => [])
}));
vi.mock('../../src/js/catalog/catalog.constants.js', () => ({ CATALOG_ITEM_TYPES: {} }));
vi.mock('../../src/js/catalog/catalog-layer.ref.js', () => ({
    catalogLayerReferenceId: () => null
}));
vi.mock('../../src/js/store/sync/image-sync.js', () => ({ fetchImageBlob: vi.fn() }));

vi.mock('../../src/js/store/sync/index.js', async () => ({
    logMapOperation: vi.fn(),
    logAtlasSetting: vi.fn(),
    logMapNotesOperation: vi.fn(),
    logGridStyleOperation: vi.fn(),
    isOperationLoggingEnabled: vi.fn(() => false),
    // O vocabulário REAL: um duplo com valores inventados faria as asserções medirem a
    // fantasia do mock em vez do contrato.
    OperationType: (await import('../../src/js/store/sync/operation-types.js')).OperationType
}));

// A PORTA DO DIÁRIO. `runTransaction` é real e chama isto ANTES da função de persistência,
// então capturar aqui é o sinal de "a intenção nasceu", que é o que o servidor receberia.
vi.mock('../../src/js/store/sync/operation-dispatcher.js', () => ({
    persistOperationIntents: vi.fn(async (descriptions) => {
        intencoes.push(...descriptions.map((op) => ({ ...op })));
        return async () => {};
    })
}));

// O EIXO DO PAPEL FICA ABERTO DE PROPÓSITO: este arquivo mede o eixo da TRAVA, e um gate de
// papel fechado esconderia o segundo atrás do primeiro.
const permissao = vi.hoisted(() => ({ permitida: true }));
vi.mock('../../src/js/store/sync/permission-guard.js', () => ({
    checkPermission: vi.fn(() => (permissao.permitida
        ? { allowed: true }
        : { allowed: false, reason: 'canEdit', required: 'canEdit' })),
    GuardAction: {
        CREATE_MAP: 'EDIT',
        UPDATE_MAP: 'EDIT',
        DELETE_MAP: 'DELETE',
        LOCK_MAP: 'LOCK_MAPS'
    }
}));

vi.mock('../../src/js/store/sync/sync-metadata.js', () => ({
    createSyncMetadata: vi.fn(() => ({ createdAt: 1, updatedAt: 1, version: 1 })),
    touchSyncMetadata: vi.fn((sync) => ({ ...sync, version: (sync.version || 0) + 1 }))
}));

vi.mock('../../src/js/store/repositories/index.js', () => ({
    getMapDataCompat: vi.fn(async (mapName) => mapas.value[mapName] || getEmptyMapData()),
    updateMapDataCompat: vi.fn(async (mapName, data) => { mapas.value[mapName] = data; }),
    mintMapDocument: vi.fn((mapName, data) => {
        const doc = data || getEmptyMapData();
        if (!doc.name) doc.name = mapName;
        doc.id = `uuid-${mapName}`;
        return { document: doc, storageKey: mapName };
    }),
    deleteMapCompat: vi.fn(async (mapName) => { delete mapas.value[mapName]; }),
    renameMapCompat: vi.fn(async () => {}),
    getAllMapKeysCompat: vi.fn(async () => Object.keys(mapas.value)),
    getSettingCompat: vi.fn(async (key) => disco.settings[key] ?? null),
    setSettingCompat: vi.fn(async (key, value) => { disco.settings[key] = value; }),
    getMapNotesCompat: vi.fn(async (map) => disco.notas[map] ?? null),
    setMapNotesCompat: vi.fn(async (map, notes) => { disco.notas[map] = notes; }),
    getGridStyleCompat: vi.fn(async (map) => disco.grade[map] ?? null),
    setGridStyleCompat: vi.fn(async (map, style) => { disco.grade[map] = style; }),
    getImageCompat: vi.fn(),
    saveImageCompat: vi.fn(),
    deleteImageCompat: vi.fn(),
    hasImageCompat: vi.fn(),
    getRepository: vi.fn(() => ({ getAllMaps: vi.fn(async () => []) }))
}));

vi.mock('../../src/js/store/store-state-manager.js', () => ({ default: mockMapManager }));
vi.mock('../../src/js/store/memory-store.js', () => ({
    memoryStore: mockMemoryStore,
    resetMemoryStore: vi.fn()
}));

vi.mock('../../src/js/store/services/map-resolver.service.js', () => ({
    mapResolver: {
        registerMap: vi.fn(),
        unregisterMapById: vi.fn(),
        renameMap: vi.fn(),
        clear: vi.fn(),
        resolveToId: vi.fn((name) => `uuid-${name}`),
        resolveToName: vi.fn((x) => x),
        getIdForName: vi.fn()
    }
}));

vi.mock('../../src/js/config.js', () => ({
    default: {
        basemaps: { 'carta-topografica': { enabled: true }, osm: { enabled: true } },
        getValidBasemapFallback: vi.fn(() => 'carta-topografica')
    }
}));

vi.mock('../../src/js/utilities/uuid.js', () => ({
    generateUUID: vi.fn(() => 'generated-uuid-1'),
    isValidUUID: vi.fn((v) => typeof v === 'string' && v.startsWith('uuid-'))
}));

vi.mock('../../src/js/events', () => ({
    EventTypes: {
        MAP_LOCK_CHANGED: 'map:lockChanged',
        LAYERS_CHANGED: 'layers:changed',
        MAP_CREATED: 'map:created',
        MAP_TEMPORAL_CHANGED: 'temporal:mapChanged'
    }
}));

// ============================================================================
// Imports reais (store-errors inclusive: o evento é observado num barramento de verdade,
// e não por um espião posto no lugar do emissor)
// ============================================================================

import {
    setBaseLayer,
    updateMapPosition,
    clearMapPosition,
    setBriefingLockOverride,
    setMapDependencies,
    renameMap
} from '../../src/js/store/map.operations.js';
import { setMapNotes, setGridStyle } from '../../src/js/store/settings.operations.js';
import { StoreErrorEvents, setStoreErrorEventBus } from '../../src/js/store/store-errors.js';

const CORRENTE = 'Mapa corrente';
const OUTRO = 'Mapa do vizinho';
const NOTAS = { title: 'Ordem de operações', description: '<p>texto</p>' };
const GRADE = { format: 'utm', visible: true };

/** Eventos capturados do barramento, em ordem. */
let eventos;

/** Trava um mapa NO DISCO, sem tocar no conjunto em memória (que é o ponto). */
function travarNoDisco(mapName) {
    disco.settings[`mapLocked_${mapName}`] = true;
}

/** As recusas emitidas, como pares `operação/motivo`. */
function recusas() {
    return eventos
        .filter((e) => e.type === StoreErrorEvents.STORE_OPERATION_BLOCKED)
        .map((e) => `${e.payload.operation}:${e.payload.reason}`);
}

beforeEach(() => {
    disco.settings = {};
    disco.notas = {};
    disco.grade = {};
    mapas.value = {
        [CORRENTE]: { ...getEmptyMapData(), id: `uuid-${CORRENTE}`, name: CORRENTE },
        [OUTRO]: { ...getEmptyMapData(), id: `uuid-${OUTRO}`, name: OUTRO }
    };
    mockMemoryStore.lockedMaps = new Set();
    intencoes.length = 0;
    permissao.permitida = true;
    eventos = [];
    const barramento = { emit: (type, payload) => eventos.push({ type, payload }), on: vi.fn(), off: vi.fn() };
    setStoreErrorEventBus(barramento);
    setMapDependencies({ eventBus: barramento, groupManager: {}, layerManager: {} });
    setBriefingLockOverride(false);
    eventos = [];
});

// ============================================================================
// 1. Controle positivo: sem trava, as cinco escrevem
// ============================================================================

describe('piso: com o mapa destravado as cinco escrevem e enfileiram', () => {
    it('notas e grade de OUTRO mapa gravam e registram a intenção', async () => {
        await expect(setMapNotes(OUTRO, NOTAS)).resolves.toBe(true);
        await expect(setGridStyle(OUTRO, GRADE)).resolves.toBe(true);

        expect(disco.notas[OUTRO]).toEqual(NOTAS);
        expect(disco.grade[OUTRO]).toEqual(GRADE);
        expect(intencoes.map((i) => i.entityType)).toEqual(['mapNotes', 'gridStyle']);
        expect(recusas()).toEqual([]);
    });

    it('camada base e posição do mapa corrente gravam', async () => {
        await setBaseLayer('osm', CORRENTE);
        await updateMapPosition(1, 2, 3, 0, 0, CORRENTE);

        expect(mapas.value[CORRENTE].baseLayer).toBe('osm');
        expect(mapas.value[CORRENTE].savedPosition).toBeTruthy();
        expect(intencoes.map((i) => i.entityType)).toEqual(['baseLayer', 'mapPosition']);
        expect(recusas()).toEqual([]);
    });
});

// ============================================================================
// 2. O defeito: OUTRO mapa travado, com o conjunto em memória VAZIO
// ============================================================================

describe('o mapa ALVO está travado no disco e o conjunto em memória está vazio', () => {
    beforeEach(() => travarNoDisco(OUTRO));

    it('o conjunto em memória de fato não sabe da trava (o fixture chega ao gate)', () => {
        // Sem esta afirmação os três casos abaixo passariam verde num mundo em que a trava
        // estivesse na memória, medindo o gate ANTIGO e chamando isso de correção.
        expect(mockMemoryStore.lockedMaps.has(OUTRO)).toBe(false);
        expect(disco.settings[`mapLocked_${OUTRO}`]).toBe(true);
    });

    it('setMapNotes recusa, não grava, não enfileira e NOMEIA o estado', async () => {
        await expect(setMapNotes(OUTRO, NOTAS)).resolves.toBe(false);

        expect(disco.notas[OUTRO]).toBeUndefined();
        expect(intencoes).toEqual([]);
        expect(recusas()).toEqual(['setMapNotes:map_locked']);
    });

    it('setGridStyle recusa, não grava, não enfileira e NOMEIA o estado', async () => {
        await expect(setGridStyle(OUTRO, GRADE)).resolves.toBe(false);

        expect(disco.grade[OUTRO]).toBeUndefined();
        expect(intencoes).toEqual([]);
        expect(recusas()).toEqual(['setGridStyle:map_locked']);
    });

    // A ÚLTIMA LINHA DO INVENTÁRIO DO N3. `renameMap` perguntava só ao conjunto em memória, que em
    // atlas LOCAL conhece apenas o mapa corrente: renomear OUTRO mapa travado passava em silêncio,
    // e a op `map {name}` tem o próprio mapa como alvo, que o servidor não tranca.
    it('renameMap recusa o rename de OUTRO mapa travado só no disco, e não enfileira nada', async () => {
        await expect(renameMap(OUTRO, 'Nome Novo')).resolves.toBe(false);

        expect(intencoes).toEqual([]);
        expect(recusas()).toEqual(['renameMap:map_locked']);
    });

    it('o mapa CORRENTE, destravado, continua aceitando as duas: a recusa é do alvo certo', async () => {
        // A outra metade do defeito. Um gate que passasse a recusar tudo teria os casos
        // acima verdes e seria igualmente errado.
        await expect(setMapNotes(CORRENTE, NOTAS)).resolves.toBe(true);
        await expect(setGridStyle(CORRENTE, GRADE)).resolves.toBe(true);
        expect(recusas()).toEqual([]);
    });
});

// ============================================================================
// 3. Borda: o mapa CORRENTE travado no disco antes de a memória saber
// ============================================================================

describe('o mapa CORRENTE está travado no disco e a memória ainda não sabe', () => {
    // A janela real: `toggleMapLock` grava o app setting na função de PERSISTÊNCIA e só
    // atualiza `memoryStore.lockedMaps` no `tx.deferSync`, que roda depois; e uma aba que
    // acabou de abrir um atlas local tem o conjunto vazio enquanto o disco já tem a trava.
    beforeEach(() => travarNoDisco(CORRENTE));

    it('as cinco recusam, inclusive com `mapName` nulo (o mapa corrente implícito)', async () => {
        await expect(setMapNotes(null, NOTAS)).resolves.toBe(false);
        await expect(setGridStyle(null, GRADE)).resolves.toBe(false);
        await setBaseLayer('osm');
        await updateMapPosition(1, 2, 3, 0, 0);
        await clearMapPosition();

        expect(intencoes).toEqual([]);
        expect(disco.notas[CORRENTE]).toBeUndefined();
        expect(disco.grade[CORRENTE]).toBeUndefined();
        expect(mapas.value[CORRENTE].baseLayer).not.toBe('osm');
        expect(recusas()).toEqual([
            'setMapNotes:map_locked',
            'setGridStyle:map_locked',
            'setBaseLayer:map_locked',
            'updateMapPosition:map_locked',
            'clearMapPosition:map_locked'
        ]);
    });
});

// ============================================================================
// 4. Borda: a sobreposição de briefing, que só existe em memória
// ============================================================================

describe('durante o briefing nenhum mapa aceita ajuste, mesmo com o disco limpo', () => {
    // A METADE QUE UMA CORREÇÃO DESATENTA PERDE. Trocar o gate por uma leitura de disco
    // "pura" (`isMapLocked`) reabriria a escrita durante a apresentação, porque a
    // sobreposição de briefing não persiste nada, por desenho.
    it('notas e grade recusam com o briefing ligado e o app setting ausente', async () => {
        setBriefingLockOverride(true);
        eventos = [];
        try {
            expect(disco.settings[`mapLocked_${CORRENTE}`]).toBeUndefined();

            await expect(setMapNotes(CORRENTE, NOTAS)).resolves.toBe(false);
            await expect(setGridStyle(OUTRO, GRADE)).resolves.toBe(false);

            expect(intencoes).toEqual([]);
            expect(recusas()).toEqual(['setMapNotes:map_locked', 'setGridStyle:map_locked']);
        } finally {
            setBriefingLockOverride(false);
        }
    });

    it('desligado o briefing, as duas voltam a gravar', async () => {
        await expect(setMapNotes(CORRENTE, NOTAS)).resolves.toBe(true);
        await expect(setGridStyle(OUTRO, GRADE)).resolves.toBe(true);
    });
});

// ============================================================================
// 5. Os DOIS eixos continuam separados
// ============================================================================

describe('papel e trava são recusas distintas, e o papel é perguntado primeiro', () => {
    it('sem papel, a recusa nomeia a capacidade e não a trava', async () => {
        permissao.permitida = false;

        await expect(setMapNotes(OUTRO, NOTAS)).resolves.toBe(false);
        await expect(setGridStyle(OUTRO, GRADE)).resolves.toBe(false);

        expect(recusas()).toEqual(['setMapNotes:canEdit', 'setGridStyle:canEdit']);
    });

    it('sem papel E com o mapa travado, quem responde é o papel (a ordem do molde)', async () => {
        permissao.permitida = false;
        travarNoDisco(OUTRO);

        await setMapNotes(OUTRO, NOTAS);

        expect(recusas()).toEqual(['setMapNotes:canEdit']);
    });
});

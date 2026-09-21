// Path: tests/store/rename-remoto-rechaveia-memoria.test.js

/**
 * @fileoverview Regressao N1: o rename que chega pelo SYNC nao re-chaveava a memoria do par.
 *
 * A CAUSA. O nome do mapa e' CHAVE em seis estruturas de `memoryStore` (`currentMap`, `maps`,
 * `groups`, `layers`, `lockedMaps` e as duas metades temporais) e no indice nome<->id
 * (`mapResolver`). Quem renomeia move as sete por `mapManager.renameMapInMemory` mais
 * `mapResolver.renameMap`, chamados num sitio so': o caminho do AUTOR. O caminho de ENTRADA
 * gravava o registro com o nome novo e nao chamava nenhuma das duas, entao o disco passava a
 * dizer "Bravo" e a memoria continuava dizendo "Alfa".
 *
 * O QUE ISSO CUSTAVA, medido em 2026-09-21 com duas browsers reais
 * (`frontend/tests/e2e-ui/browser-collab-rename-remoto.spec.js`): a aba Mapas do par ficava SEM
 * nenhum cartao marcado como atual e com o nome velho no cabecalho; e uma feicao desenhada pelo
 * par depois do rename ia parar num mapa FANTASMA gravado sob a CHAVE do nome velho (o
 * documento vazio de compatibilidade, chamado "Novo Mapa"), de onde a operacao nunca saiu da
 * fila. Nao e' defeito de tela: e' perda de dado.
 *
 * O CONSERTO. O tratador de entrada ANUNCIA (`EventTypes.MAP_RENAMED_REMOTELY`, depois de
 * gravar o disco) e o assinante deste arquivo chama as MESMAS duas re-chaveagens do autor. Ele
 * nao pode morar no tratador porque aquele arquivo nao pode importar o gerente de estado
 * (guarda estrutural P8). Este arquivo prende o lado do ASSINANTE; o lado do anuncio esta em
 * `frontend/tests/integration/remote-operation-handler.test.js`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Mocks: o mesmo arnes estreito de `rename-map-refusal-signal.repro.test.js`, MENOS os quatro
// modulos que este arquivo precisa exercitar de verdade (o gerente de estado, o espelho de
// memoria, o indice nome<->id e o vocabulario de eventos).
// ============================================================================

const { mockSettings } = vi.hoisted(() => ({ mockSettings: { value: {} } }));

vi.mock('../../src/js/store/cesium3d.operations.js', () => ({
    loadCesium3dDataToMemory: vi.fn(async () => {}),
}));
vi.mock('../../src/js/store/streetview360.operations.js', () => ({
    loadStreetview360DataToMemory: vi.fn(async () => {}),
}));

vi.mock('../../src/js/store/sync/index.js', () => ({
    logMapOperation: vi.fn(),
    logMapPositionOperation: vi.fn(),
    logBaseLayerOperation: vi.fn(),
    logAtlasSetting: vi.fn(),
    isOperationLoggingEnabled: vi.fn(() => false),
    OperationType: { CREATE: 'CREATE', UPDATE: 'UPDATE', DELETE: 'DELETE' },
    // `store-state-manager.js` le isto do MESMO barril; sem ele o import do gerente de estado
    // quebra antes de qualquer caso rodar.
    sessionContext: { isAuthenticated: () => false, getUserId: () => null },
}));

vi.mock('../../src/js/store/services.js', () => ({
    getGroupManager: vi.fn(() => ({
        loadGroupsToMemory: vi.fn(async () => {}),
        clearMapGroups: vi.fn(async () => {}),
    })),
}));

vi.mock('../../src/js/store/sync/permission-guard.js', () => ({
    checkPermission: vi.fn(() => ({ allowed: true })),
    GuardAction: { UPDATE_MAP: 'EDIT' },
}));

vi.mock('../../src/js/store/repositories/index.js', () => ({
    getMapDataCompat: vi.fn(async () => null),
    updateMapDataCompat: vi.fn(async () => {}),
    createMapCompat: vi.fn(async () => ({})),
    mintMapDocument: vi.fn(() => ({ document: {}, storageKey: 'x' })),
    deleteMapCompat: vi.fn(async () => {}),
    renameMapCompat: vi.fn(async () => {}),
    getAllMapKeysCompat: vi.fn(async () => []),
    getSettingCompat: vi.fn(async (key) => mockSettings.value[key] ?? null),
    setSettingCompat: vi.fn(async (key, value) => { mockSettings.value[key] = value; }),
    setMapNotesCompat: vi.fn(async () => {}),
    getColorUsageCompat: vi.fn(async () => ({})),
    setColorUsageCompat: vi.fn(async () => {}),
    removeColorUsageCompat: vi.fn(async () => {}),
    deleteImageCompat: vi.fn(async () => {}),
    getRepository: vi.fn(() => ({ getAllMaps: vi.fn(async () => new Map()) })),
}));

vi.mock('../../src/js/config.js', () => ({
    default: { basemaps: {}, getValidBasemapFallback: vi.fn(() => 'osm') },
}));

import { setMapDependencies } from '../../src/js/store/map.operations.js';
import { EventTypes } from '../../src/js/events/event_types.js';
import { memoryStore } from '../../src/js/store/memory-store.js';
import { mapResolver } from '../../src/js/store/services/map-resolver.service.js';
import { createEventBus } from '../../src/js/events/event_bus.js';
import { setSettingCompat } from '../../src/js/store/repositories/index.js';

const MAP_ID = '11111111-2222-4333-8444-555555555555';
const OUTRO_ID = '66666666-7777-4888-8999-aaaaaaaaaaaa';
const VELHO = 'Mapa Alfa';
const NOVO = 'Mapa Bravo';

const CONFIG_TEMPORAL = Object.freeze({ ativo: true, unidade: 'HORA', inicio: 1, fim: 2 });

let eventBus;
let emitidos;

/** Deixa o microtask do assinante rodar: a parte de disco dele e' assincrona por natureza. */
const assentar = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Poe o par DENTRO do mapa que vai ser renomeado, com tudo o que pendura no nome dele. */
function semearParNoMapa({ corrente = true } = {}) {
    mapResolver.registerMap(VELHO, MAP_ID);
    memoryStore.maps[VELHO] = { undoStacks: { a: [1] }, redoStacks: {} };
    memoryStore.groups[VELHO] = { g1: { id: 'g1' } };
    memoryStore.layers[VELHO] = [{ id: 'default' }];
    memoryStore.lockedMaps.add(VELHO);
    memoryStore.temporalConfigs.set(VELHO, CONFIG_TEMPORAL);
    memoryStore.temporalView.set(VELHO, true);
    memoryStore.currentMap = corrente ? VELHO : 'Outro Mapa';
    mockSettings.value.lastActiveMap = memoryStore.currentMap;
}

beforeEach(() => {
    vi.clearAllMocks();
    mockSettings.value = {};
    mapResolver.clear();
    memoryStore.maps = {};
    memoryStore.groups = {};
    memoryStore.layers = {};
    memoryStore.lockedMaps.clear();
    memoryStore.temporalConfigs.clear();
    memoryStore.temporalView.clear();
    memoryStore.currentMap = null;

    eventBus = createEventBus();
    emitidos = [];
    eventBus.onAny((tipo, payload) => emitidos.push({ tipo, payload }));
    setMapDependencies({
        eventBus,
        groupManager: { loadGroupsToMemory: vi.fn(async () => {}), clearMapGroups: vi.fn(async () => {}) },
        layerManager: { loadLayersToMemory: vi.fn(async () => {}) },
    });
});

describe('N1 — o rename remoto re-chaveia a memoria inteira do par', () => {
    it('com o mapa ABERTO: as sete chaves andam, e o ponteiro de disco tambem', async () => {
        semearParNoMapa({ corrente: true });

        eventBus.emit(EventTypes.MAP_RENAMED_REMOTELY, { mapId: MAP_ID, oldName: VELHO, newName: NOVO });
        await assentar();

        expect(memoryStore.currentMap).toBe(NOVO);
        expect(memoryStore.maps[NOVO]).toEqual({ undoStacks: { a: [1] }, redoStacks: {} });
        expect(memoryStore.maps[VELHO]).toBeUndefined();
        expect(memoryStore.groups[NOVO]).toEqual({ g1: { id: 'g1' } });
        expect(memoryStore.groups[VELHO]).toBeUndefined();
        expect(memoryStore.layers[NOVO]).toEqual([{ id: 'default' }]);
        expect(memoryStore.layers[VELHO]).toBeUndefined();
        expect(memoryStore.lockedMaps.has(NOVO)).toBe(true);
        expect(memoryStore.lockedMaps.has(VELHO)).toBe(false);
        expect(memoryStore.temporalConfigs.get(NOVO)).toEqual(CONFIG_TEMPORAL);
        expect(memoryStore.temporalConfigs.has(VELHO)).toBe(false);
        expect(memoryStore.temporalView.get(NOVO)).toBe(true);
        expect(memoryStore.temporalView.has(VELHO)).toBe(false);

        // O INDICE: o nome novo resolve para o mapa e o VELHO deixa de resolver. O alias velho
        // vivo e' a bomba de homonimo: o proximo mapa que nascer com aquele nome o sequestra.
        expect(mapResolver.resolveToId(NOVO)).toBe(MAP_ID);
        expect(mapResolver.resolveToId(VELHO)).toBe(VELHO);
        expect(mapResolver.resolveToName(MAP_ID)).toBe(NOVO);

        // O PONTEIRO NO DISCO e' um NOME, e e' dele que a aba Mapas tira o cartao ativo.
        expect(setSettingCompat).toHaveBeenCalledWith('lastActiveMap', NOVO);
        expect(mockSettings.value.lastActiveMap).toBe(NOVO);
        // E o repinte vem DEPOIS da escrita, senao a aba le o nome velho de novo.
        expect(emitidos.at(-1)).toEqual({ tipo: EventTypes.LAYERS_CHANGED, payload: { mapName: null } });
    });

    it('com o par em OUTRO mapa: a memoria do renomeado anda e o mapa dele fica onde esta', async () => {
        semearParNoMapa({ corrente: false });

        eventBus.emit(EventTypes.MAP_RENAMED_REMOTELY, { mapId: MAP_ID, oldName: VELHO, newName: NOVO });
        await assentar();

        expect(memoryStore.currentMap).toBe('Outro Mapa');
        expect(memoryStore.layers[NOVO]).toEqual([{ id: 'default' }]);
        expect(memoryStore.layers[VELHO]).toBeUndefined();
        expect(memoryStore.temporalView.get(NOVO)).toBe(true);
        expect(mapResolver.resolveToId(VELHO)).toBe(VELHO);
        // O ponteiro de mapa corrente NAO e' tocado: ele aponta para outro mapa, que nao mudou.
        expect(setSettingCompat).not.toHaveBeenCalled();
        expect(mockSettings.value.lastActiveMap).toBe('Outro Mapa');
    });

    it('e IDEMPOTENTE: a segunda entrega do mesmo anuncio nao mexe em nada', async () => {
        semearParNoMapa({ corrente: true });
        eventBus.emit(EventTypes.MAP_RENAMED_REMOTELY, { mapId: MAP_ID, oldName: VELHO, newName: NOVO });
        await assentar();
        // Estado que a segunda entrega poderia destruir se re-chaveasse por cima.
        memoryStore.maps[VELHO] = { undoStacks: { intruso: [9] }, redoStacks: {} };
        vi.clearAllMocks();

        eventBus.emit(EventTypes.MAP_RENAMED_REMOTELY, { mapId: MAP_ID, oldName: VELHO, newName: NOVO });
        await assentar();

        expect(memoryStore.currentMap).toBe(NOVO);
        expect(memoryStore.maps[NOVO]).toEqual({ undoStacks: { a: [1] }, redoStacks: {} });
        expect(memoryStore.maps[VELHO]).toEqual({ undoStacks: { intruso: [9] }, redoStacks: {} });
        expect(setSettingCompat).not.toHaveBeenCalled();
    });

    it('HOMONIMO: se o nome velho ja pertence a OUTRO mapa, nada e re-chaveado', async () => {
        // A borda que a guarda de identidade existe para cobrir. Um anuncio atrasado (ou um mapa
        // novo batizado com o nome que acabou de vagar) faria a re-chaveagem roubar a memoria do
        // xara: `renameMapInMemory` moveria as camadas, os grupos e a pilha de desfazer DELE.
        semearParNoMapa({ corrente: true });
        mapResolver.registerMap(VELHO, OUTRO_ID);

        eventBus.emit(EventTypes.MAP_RENAMED_REMOTELY, { mapId: MAP_ID, oldName: VELHO, newName: NOVO });
        await assentar();

        expect(memoryStore.currentMap).toBe(VELHO);
        expect(memoryStore.layers[VELHO]).toEqual([{ id: 'default' }]);
        expect(memoryStore.layers[NOVO]).toBeUndefined();
        expect(mapResolver.resolveToId(VELHO)).toBe(OUTRO_ID);
        expect(setSettingCompat).not.toHaveBeenCalled();
    });

    it('anuncio sem nome, sem id, ou com o mesmo nome dos dois lados nao faz nada', async () => {
        semearParNoMapa({ corrente: true });

        for (const payload of [
            {},
            { mapId: MAP_ID, oldName: VELHO },
            { mapId: MAP_ID, newName: NOVO },
            { oldName: VELHO, newName: NOVO },
            { mapId: MAP_ID, oldName: VELHO, newName: VELHO },
        ]) {
            eventBus.emit(EventTypes.MAP_RENAMED_REMOTELY, payload);
        }
        await assentar();

        expect(memoryStore.currentMap).toBe(VELHO);
        expect(memoryStore.layers[VELHO]).toEqual([{ id: 'default' }]);
        expect(setSettingCompat).not.toHaveBeenCalled();
    });

    it('uma segunda inicializacao NAO acumula ouvinte: a re-chaveagem roda UMA vez', async () => {
        // Sem soltar a inscricao anterior, cada `setMapDependencies` somaria um assinante e o
        // ponteiro de disco seria reescrito N vezes por rename. Nao quebra nada visivel, o que e'
        // exatamente o motivo de prender aqui.
        setMapDependencies({ eventBus, groupManager: {}, layerManager: {} });
        setMapDependencies({ eventBus, groupManager: {}, layerManager: {} });
        semearParNoMapa({ corrente: true });

        eventBus.emit(EventTypes.MAP_RENAMED_REMOTELY, { mapId: MAP_ID, oldName: VELHO, newName: NOVO });
        await assentar();

        expect(setSettingCompat).toHaveBeenCalledTimes(1);
        expect(emitidos.filter((e) => e.tipo === EventTypes.LAYERS_CHANGED)).toHaveLength(1);
    });
});

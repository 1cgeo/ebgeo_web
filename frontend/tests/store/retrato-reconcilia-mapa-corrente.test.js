// Path: tests/store/retrato-reconcilia-mapa-corrente.test.js

/**
 * @fileoverview Regressao O3: depois de um RETRATO do servidor, ninguem reconciliava o mapa
 * corrente, e a aba ficava apontando para um mapa que o retrato nao tem mais.
 *
 * A CAUSA. A ativaçao de uma geraçao de retrato (`applyRemoteSnapshot`,
 * `store/sync/remote-operation-handler.js`) reescreve o disco inteiro: o registro do mapa passa a
 * ter o nome que o servidor diz, ou deixa de existir. `memoryStore.currentMap` e' um NOME e nao
 * se mexe. Quando o retrato traz o mapa aberto com OUTRO nome (ele foi renomeado enquanto esta
 * aba estava desconectada), ou nao o traz (foi excluido), a proxima escrita procura um documento
 * por um nome que nao e' de documento nenhum, recebe o documento VAZIO de compatibilidade, e a
 * gravaçao crava um registro novo com a CHAVE igual ao nome: o mapa FANTASMA. A feiçao some do
 * mapa do atlas e a op morre na fila, sem erro em lugar nenhum.
 *
 * O CONSERTO tem a forma do rename ao vivo (achado N1), e pela mesma razao estrutural: o tratador
 * de entrada nao pode importar o gerente de estado (guarda P8), entao ele ANUNCIA e quem age e' o
 * assinante deste arquivo. O anuncio e' `EventTypes.CURRENT_MAP_STALE_REMOTELY`, e nao o
 * `MAP_RENAMED_REMOTELY` do caminho ao vivo, por duas razoes: a guarda daquele e' uma pergunta de
 * IDENTIDADE sobre o nome VELHO no indice, que e' verdadeira so' no caminho ao vivo (la' `saveMap`
 * registra o nome novo SEM apagar o velho, aqui a troca do indice apaga); e o retrato tem um
 * segundo desfecho, o mapa que SUMIU, que nao cabe num anuncio chamado "renomeado".
 *
 * O LADO DO ANUNCIO esta em `frontend/tests/integration/remote-operation-handler.test.js` e em
 * `frontend/tests/integration/retrato-repoe-a-marca-do-resolvedor.test.js`; a medida com duas
 * browsers reais esta em `frontend/tests/e2e-ui/browser-collab-mapa-fantasma.spec.js`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Mocks: o mesmo arnes estreito de `rename-remoto-rechaveia-memoria.test.js`, MENOS os modulos
// que este arquivo precisa exercitar de verdade (o gerente de estado, o espelho de memoria, o
// indice nome<->id e o vocabulario de eventos), MAIS o repositorio, porque a saida do mapa
// excluido passa por `activateAtlasInitialMap`, que le' os mapas do escopo.
// ============================================================================

const { mockSettings, mockMaps } = vi.hoisted(() => ({
    mockSettings: { value: {} },
    mockMaps: { value: new Map() },
}));

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
    GuardAction: { UPDATE_MAP: 'EDIT', CREATE_MAP: 'CREATE_MAP' },
}));

vi.mock('../../src/js/utilities/toast_service.js', () => ({
    showWarning: vi.fn(),
    showToast: vi.fn(),
    showError: vi.fn(),
    showSuccess: vi.fn(),
}));

vi.mock('../../src/js/store/repositories/index.js', () => ({
    getMapDataCompat: vi.fn(async (key) => mockMaps.value.get(key) ?? null),
    updateMapDataCompat: vi.fn(async () => {}),
    createMapCompat: vi.fn(async () => ({})),
    mintMapDocument: vi.fn(() => ({ document: {}, storageKey: 'x' })),
    deleteMapCompat: vi.fn(async () => {}),
    renameMapCompat: vi.fn(async () => {}),
    getAllMapKeysCompat: vi.fn(async () => [...mockMaps.value.keys()]),
    getSettingCompat: vi.fn(async (key) => mockSettings.value[key] ?? null),
    setSettingCompat: vi.fn(async (key, value) => { mockSettings.value[key] = value; }),
    setMapNotesCompat: vi.fn(async () => {}),
    getColorUsageCompat: vi.fn(async () => ({})),
    setColorUsageCompat: vi.fn(async () => {}),
    removeColorUsageCompat: vi.fn(async () => {}),
    deleteImageCompat: vi.fn(async () => {}),
    getRepository: vi.fn(() => ({
        getAllMaps: vi.fn(async () => new Map(mockMaps.value)),
        getAtlas: vi.fn(async () => ({ mapOrder: [...mockMaps.value.keys()] })),
        deleteMap: vi.fn(async (key) => { mockMaps.value.delete(key); }),
    })),
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
import { showWarning } from '../../src/js/utilities/toast_service.js';

const MAP_ID = '11111111-2222-4333-8444-555555555555';
const OUTRO_ID = '66666666-7777-4888-8999-aaaaaaaaaaaa';
const VELHO = 'Mapa Alfa';
const NOVO = 'Mapa Bravo';
const VIZINHO = 'Mapa Vizinho';

const CONFIG_TEMPORAL = Object.freeze({ ativo: true, unidade: 'HORA', inicio: 1, fim: 2 });

let eventBus;
let emitidos;

/** Deixa o assinante (assincrono por natureza: ele escreve em disco) terminar. */
const assentar = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Poe a aba DENTRO do mapa, com tudo o que pendura no nome dele. */
function semearAbaNoMapa({ corrente = true } = {}) {
    mapResolver.registerMap(VELHO, MAP_ID);
    memoryStore.maps[VELHO] = { undoStacks: { a: [1] }, redoStacks: {} };
    memoryStore.groups[VELHO] = { g1: { id: 'g1' } };
    memoryStore.layers[VELHO] = [{ id: 'default' }];
    memoryStore.lockedMaps.add(VELHO);
    memoryStore.temporalConfigs.set(VELHO, CONFIG_TEMPORAL);
    memoryStore.temporalView.set(VELHO, true);
    memoryStore.currentMap = corrente ? VELHO : VIZINHO;
    mockSettings.value.lastActiveMap = memoryStore.currentMap;
}

/** O anuncio que o tratador emite depois de ativar a geraçao do retrato. */
const anunciar = (payload) => eventBus.emit(EventTypes.CURRENT_MAP_STALE_REMOTELY, payload);

beforeEach(() => {
    vi.clearAllMocks();
    mockSettings.value = {};
    mockMaps.value = new Map();
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

describe('O3 — o retrato reconcilia o mapa corrente: (a) ele foi renomeado', () => {
    it('re-chaveia a memoria inteira e move o ponteiro de disco', async () => {
        semearAbaNoMapa({ corrente: true });
        // O retrato JA' trocou o indice: o nome velho nao resolve mais para nada. E' isso que
        // impede reusar o anuncio do rename AO VIVO, cuja guarda pergunta pelo nome velho.
        mapResolver.replaceAll([[NOVO, MAP_ID]]);

        anunciar({ mapId: MAP_ID, oldName: VELHO, newName: NOVO });
        await assentar();

        expect(memoryStore.currentMap).toBe(NOVO);
        expect(memoryStore.maps[NOVO]).toEqual({ undoStacks: { a: [1] }, redoStacks: {} });
        expect(memoryStore.maps[VELHO]).toBeUndefined();
        expect(memoryStore.groups[NOVO]).toEqual({ g1: { id: 'g1' } });
        expect(memoryStore.layers[NOVO]).toEqual([{ id: 'default' }]);
        expect(memoryStore.layers[VELHO]).toBeUndefined();
        expect(memoryStore.lockedMaps.has(NOVO)).toBe(true);
        expect(memoryStore.temporalConfigs.get(NOVO)).toEqual(CONFIG_TEMPORAL);
        expect(memoryStore.temporalView.get(NOVO)).toBe(true);
        expect(memoryStore.temporalView.has(VELHO)).toBe(false);

        // O PONTEIRO NO DISCO e' um NOME, e e' dele que a aba Mapas tira o cartao ativo.
        expect(setSettingCompat).toHaveBeenCalledWith('lastActiveMap', NOVO);
        expect(emitidos.at(-1)).toEqual({ tipo: EventTypes.LAYERS_CHANGED, payload: { mapName: null } });
        // Renomear nao e' perder: nada a avisar.
        expect(showWarning).not.toHaveBeenCalled();
    });

    it('NAO mexe na vista temporal dos OUTROS mapas', async () => {
        semearAbaNoMapa({ corrente: true });
        memoryStore.temporalView.set(VIZINHO, false);
        mapResolver.replaceAll([[NOVO, MAP_ID], [VIZINHO, OUTRO_ID]]);

        anunciar({ mapId: MAP_ID, oldName: VELHO, newName: NOVO });
        await assentar();

        expect(memoryStore.temporalView.get(VIZINHO)).toBe(false);
        expect([...memoryStore.temporalView.keys()].sort()).toEqual([NOVO, VIZINHO].sort());
    });

    it('e IDEMPOTENTE: a segunda entrega do mesmo anuncio nao mexe em nada', async () => {
        semearAbaNoMapa({ corrente: true });
        mapResolver.replaceAll([[NOVO, MAP_ID]]);
        anunciar({ mapId: MAP_ID, oldName: VELHO, newName: NOVO });
        await assentar();
        // Estado que uma segunda re-chaveagem destruiria se passasse por cima.
        memoryStore.maps[VELHO] = { undoStacks: { intruso: [9] }, redoStacks: {} };
        vi.clearAllMocks();

        anunciar({ mapId: MAP_ID, oldName: VELHO, newName: NOVO });
        await assentar();

        expect(memoryStore.currentMap).toBe(NOVO);
        expect(memoryStore.maps[NOVO]).toEqual({ undoStacks: { a: [1] }, redoStacks: {} });
        expect(memoryStore.maps[VELHO]).toEqual({ undoStacks: { intruso: [9] }, redoStacks: {} });
        expect(setSettingCompat).not.toHaveBeenCalled();
    });
});

describe('O3 — o retrato reconcilia o mapa corrente: (b) ele nao existe mais', () => {
    it('sai para o mapa inicial do atlas e AVISA nomeando o mapa que sumiu', async () => {
        semearAbaNoMapa({ corrente: true });
        mockMaps.value.set(OUTRO_ID, { id: OUTRO_ID, name: VIZINHO });
        mapResolver.replaceAll([[VIZINHO, OUTRO_ID]]);

        anunciar({ mapId: MAP_ID, oldName: VELHO, newName: null });
        await assentar();

        expect(memoryStore.currentMap).toBe(VIZINHO);
        expect(setSettingCompat).toHaveBeenCalledWith('lastActiveMap', VIZINHO);
        // NINGUEM CLICOU, entao o clique nao pode ser o portador do motivo: a saida de um mapa
        // que a pessoa estava vendo e' um fato que chega sozinho, e ela precisa ler o nome dele.
        expect(showWarning).toHaveBeenCalledTimes(1);
        expect(showWarning.mock.calls[0][0]).toContain(VELHO);
        expect(showWarning.mock.calls[0][0]).toContain(VIZINHO);
    });

    it('com o atlas VAZIO, avisa mesmo assim e nao estoura', async () => {
        // A borda em que `activateAtlasInitialMap` nao tem para onde ir. Um `throw` aqui subiria
        // por um `catch` de barramento e a pessoa ficaria sem aviso nenhum, que e' o pior dos dois.
        semearAbaNoMapa({ corrente: true });
        mapResolver.replaceAll([]);

        anunciar({ mapId: MAP_ID, oldName: VELHO, newName: null });
        await assentar();

        expect(showWarning).toHaveBeenCalledTimes(1);
        expect(showWarning.mock.calls[0][0]).toContain(VELHO);
    });

    it('DOIS anuncios no MESMO tick tiram a pessoa do mapa UMA vez', async () => {
        // A GUARDA AQUI E' ESTRUTURAL, e a distinçao importa: ela nao veio de uma duplicata
        // medida, veio da forma do codigo. O desfecho deste ramo e' ASSINCRONO
        // (`activateAtlasInitialMap` so' troca `memoryStore.currentMap` depois de varios awaits),
        // entao dois anuncios do MESMO fato que cheguem dentro dessa janela passam os dois pela
        // guarda de "esta pessoa esta' naquele mapa", e o preço sao dois avisos e duas trocas de
        // mapa para um fato so'. O ramo de RENAME nao precisa disso: ele muda `currentMap` de
        // forma SINCRONA, antes do primeiro await.
        semearAbaNoMapa({ corrente: true });
        mockMaps.value.set(OUTRO_ID, { id: OUTRO_ID, name: VIZINHO });
        mapResolver.replaceAll([[VIZINHO, OUTRO_ID]]);

        anunciar({ mapId: MAP_ID, oldName: VELHO, newName: null });
        anunciar({ mapId: MAP_ID, oldName: VELHO, newName: null });
        await assentar();

        expect(showWarning).toHaveBeenCalledTimes(1);
        expect(memoryStore.currentMap).toBe(VIZINHO);
    });

    it('e a marca de voo NAO trava a proxima reconciliacao', async () => {
        // A borda que uma marca mal solta produziria: o segundo mapa excluido na mesma sessao
        // ficaria sem reconciliacao nenhuma, e esse e' o tipo de defeito que so' aparece na
        // segunda vez.
        semearAbaNoMapa({ corrente: true });
        mockMaps.value.set(OUTRO_ID, { id: OUTRO_ID, name: VIZINHO });
        mapResolver.replaceAll([[VIZINHO, OUTRO_ID]]);
        anunciar({ mapId: MAP_ID, oldName: VELHO, newName: null });
        await assentar();

        mockMaps.value.delete(OUTRO_ID);
        mockMaps.value.set(MAP_ID, { id: MAP_ID, name: 'Mapa Terceiro' });
        mapResolver.replaceAll([['Mapa Terceiro', MAP_ID]]);
        anunciar({ mapId: OUTRO_ID, oldName: VIZINHO, newName: null });
        await assentar();

        expect(showWarning).toHaveBeenCalledTimes(2);
        expect(memoryStore.currentMap).toBe('Mapa Terceiro');
    });

    it('nao faz nada quando a pessoa ja NAO estava naquele mapa', async () => {
        // O retrato pode retirar um mapa que esta aba nao tem aberto. Trocar o mapa dela nesse
        // caso seria arrancar a pessoa de onde ela esta por causa de um mapa que ela nao via.
        semearAbaNoMapa({ corrente: false });
        mockMaps.value.set(OUTRO_ID, { id: OUTRO_ID, name: VIZINHO });

        anunciar({ mapId: MAP_ID, oldName: VELHO, newName: null });
        await assentar();

        expect(memoryStore.currentMap).toBe(VIZINHO);
        expect(showWarning).not.toHaveBeenCalled();
        expect(setSettingCompat).not.toHaveBeenCalled();
    });
});

describe('O3 — a recontagem de cores adiada nao escreve no console', () => {
    it('depois dos 100 ms do temporizador, nenhum aviso de analise de cor', async () => {
        // O ERRO DE FECHAMENTO que isto prende (2026-09-23): trocar de mapa arma
        // `performInitialColorAnalysis` para 100 ms depois (`loadColorUsageFromDB`,
        // `store/store-state-manager.js`), e este arquivo termina antes disso. Com o documento
        // `null` do mock a recontagem avisava no console, o aviso chegava com o worker do vitest
        // fechando, e o `npm test` da raiz reprovava com "Closing rpc while onUserConsoleLog was
        // pending" e todos os testes verdes, em cerca de um terço das rodadas. O caso espera o
        // temporizador de proposito, nos dois desfechos que o disparam (mapa que sumiu e atlas
        // vazio, este com o nome `undefined`).
        const avisos = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            semearAbaNoMapa({ corrente: true });
            mockMaps.value.set(OUTRO_ID, { id: OUTRO_ID, name: VIZINHO });
            mapResolver.replaceAll([[VIZINHO, OUTRO_ID]]);
            anunciar({ mapId: MAP_ID, oldName: VELHO, newName: null });
            await assentar();

            semearAbaNoMapa({ corrente: true });
            mapResolver.replaceAll([]);
            mockMaps.value.clear();
            anunciar({ mapId: MAP_ID, oldName: VELHO, newName: null });
            await assentar();

            await new Promise((resolve) => setTimeout(resolve, 250));
            const deCor = avisos.mock.calls.filter((c) => String(c[0]).includes('color analysis'));
            expect(deCor, 'a recontagem adiada avisou no console').toEqual([]);
        } finally {
            avisos.mockRestore();
        }
    });
});

describe('O3 — as bordas do anuncio', () => {
    it('anuncio sem id, sem nome velho, ou com o mesmo nome dos dois lados nao faz nada', async () => {
        semearAbaNoMapa({ corrente: true });

        for (const payload of [
            {},
            undefined,
            { mapId: MAP_ID },
            { oldName: VELHO, newName: NOVO },
            { mapId: MAP_ID, oldName: VELHO, newName: VELHO },
        ]) {
            anunciar(payload);
        }
        await assentar();

        expect(memoryStore.currentMap).toBe(VELHO);
        expect(memoryStore.layers[VELHO]).toEqual([{ id: 'default' }]);
        expect(setSettingCompat).not.toHaveBeenCalled();
        expect(showWarning).not.toHaveBeenCalled();
    });

    it('uma segunda inicializacao NAO acumula ouvinte: a reconciliacao roda UMA vez', async () => {
        // Sem soltar a inscriçao anterior, cada `setMapDependencies` somaria um assinante, e no
        // caso (b) isso sao DOIS avisos e duas trocas de mapa por retrato.
        setMapDependencies({ eventBus, groupManager: {}, layerManager: {} });
        setMapDependencies({ eventBus, groupManager: {}, layerManager: {} });
        semearAbaNoMapa({ corrente: true });
        mapResolver.replaceAll([[NOVO, MAP_ID]]);

        anunciar({ mapId: MAP_ID, oldName: VELHO, newName: NOVO });
        await assentar();

        expect(setSettingCompat).toHaveBeenCalledTimes(1);
        expect(emitidos.filter((e) => e.tipo === EventTypes.LAYERS_CHANGED)).toHaveLength(1);
    });
});

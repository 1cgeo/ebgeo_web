// Path: tests/integration/desfazer-processamento-leva-a-camada.repro.test.js

/**
 * @fileoverview DESFAZER UM PROCESSAMENTO DESFAZ O GESTO INTEIRO: as feições E a camada de saída
 * (decisão do dono de 2026-09-26). Refazer recria as duas com os MESMOS ids.
 *
 * O DEFEITO. O processamento (`processing/processing-runner.js`) e a importação
 * (`import_export/import.control.js`) criam a camada de saída por `createLayerForImport` e só então
 * gravam as feições por `addFeatures`. Só a segunda metade entrava na pilha de desfazer (um
 * `addMultiple`): o Ctrl+Z tirava as feições e deixava a camada vazia na árvore, com o nome do
 * resultado, e a pessoa tinha de excluí-la à mão. A importação se comportava igual, pelo mesmo
 * caminho, e recebe a mesma resposta.
 *
 * O QUE ESTE VERDE PROVA, com a store REAL (serviços de pé, repositório sobre `fake-indexeddb`):
 * que desfazer tira a camada junto; que refazer a devolve com o mesmo id, o mesmo nome e as feições
 * com os mesmos ids; e que a camada que ganhou uma feição de outra origem depois do gesto NÃO sai,
 * porque desfazer é um comando novo e não leva o trabalho de mais ninguém.
 *
 * O QUE ELE NÃO PROVA: o que o servidor faz com o lote (a revivência da camada por `deleted_at =
 * NULL` está no upsert de `backend/src/modules/sync/sync.service.js`).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resetIndexedDB } from '../helpers/idb-helpers.js';

vi.mock('@utils/toast_service.js', () => ({
    showToast: vi.fn(), showSuccess: vi.fn(), showError: vi.fn(), showWarning: vi.fn(),
    showInChannel: vi.fn(),
}));
// Only what the IMPORT reads files and terrain with; the store under it is the real one.
vi.mock('jszip', () => ({ default: class {} }));
vi.mock('@tmcw/togeojson', () => ({ kml: vi.fn(), gpx: vi.fn() }));
vi.mock('shpjs', () => ({ default: vi.fn() }));
vi.mock('@js/terrain', () => ({ getTerrainElevation: vi.fn(async () => 0) }));

const memoriaLocal = (() => {
    let dados = new Map();
    return {
        getItem: (k) => (dados.has(k) ? dados.get(k) : null),
        setItem: (k, v) => { dados.set(k, String(v)); },
        removeItem: (k) => { dados.delete(k); },
        clear: () => { dados = new Map(); },
    };
})();
if (typeof globalThis.localStorage === 'undefined') {
    Object.defineProperty(globalThis, 'localStorage', { value: memoriaLocal, writable: true });
}

const MAPA = 'Principal';
const TETO_DE_PREPARO_MS = 60000;

let store;
let runProcessing;
let getLayersCompat;
let getMapDataCompat;
let setLayersCompat;
let createMapCompat;
let updateMapDataCompat;
let layerManager;
let memoryStore;
let mapManager;

beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    await resetIndexedDB();
    globalThis.localStorage.clear();
    // O algoritmo de teste não usa turf; o global presente poupa a carga sob demanda.
    globalThis.turf = globalThis.turf ?? {};

    const servicos = await import('@store/services.js');
    const { awaitMapResolverReady } = await import('@store/services/map-resolver.service.js');
    const { disableOperationLogging } = await import('@store/sync/operation-dispatcher.js');
    servicos.initServices();
    await awaitMapResolverReady();
    disableOperationLogging();
    layerManager = servicos.getLayerManager();

    const repositorios = await import('@store/repositories/index.js');
    ({ getLayersCompat, getMapDataCompat, setLayersCompat, createMapCompat, updateMapDataCompat } = repositorios);
    ({ memoryStore } = await import('@store/memory-store.js'));
    ({ default: mapManager } = await import('@store/store-state-manager.js'));
    store = await import('@store/store.js');
    ({ runProcessing } = await import('@js/processing/processing-runner.js'));

    await createMapCompat(MAPA);
    await setLayersCompat(MAPA, [{
        id: 'entrada', name: 'Entrada', visible: true, locked: false, opacity: 1, order: 0,
        createdAt: 1000, updatedAt: 1000, version: 1,
    }]);
    const dados = await getMapDataCompat(MAPA);
    dados.features.points.push(ponto('p-entrada', 'entrada'));
    await updateMapDataCompat(MAPA, dados);

    memoryStore.currentMap = MAPA;
    mapManager.addMapToMemory(MAPA);
    await layerManager.loadLayersToMemory(MAPA);
}, TETO_DE_PREPARO_MS);

afterEach(() => {
    vi.restoreAllMocks();
});

function ponto(id, layerId) {
    return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
        properties: { id, source: 'point', nome: `Ponto ${id}`, layerId, createdAt: 1000, updatedAt: 1000, version: 1 },
    };
}

/** Um algoritmo mínimo: um ponto de saída por ponto de entrada. */
const ALGORITMO = {
    id: 'teste', name: 'Teste', supportedGeometryTypes: ['point'],
    execute: (entrada) => entrada.map((f) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: f.geometry.coordinates },
        properties: { source: 'point', nome: 'Saída' },
    })),
};

async function processar() {
    return runProcessing({
        algorithm: ALGORITMO,
        params: { sourceLayerId: 'entrada', useSelectedOnly: false, outputLayerName: 'Resultado' },
        stateManager: {},
        eventBus: { emit: vi.fn() },
    });
}

async function idsDasCamadas() {
    return (await getLayersCompat(MAPA)).map((l) => l.id);
}

async function pontosNaCamada(layerId) {
    const dados = await getMapDataCompat(MAPA);
    return (dados.features.points ?? []).filter((f) => f.properties.layerId === layerId).map((f) => f.properties.id);
}

describe('desfazer um processamento', () => {
    it('REPRO: desfazer tira as feições E a camada de saída', async () => {
        const { layerId } = await processar();
        expect(await idsDasCamadas()).toContain(layerId);
        expect(await pontosNaCamada(layerId)).toHaveLength(1);

        const desfeito = await store.undoLastAction();
        expect(desfeito, 'havia o que desfazer').toBeTruthy();
        expect(await pontosNaCamada(layerId)).toHaveLength(0);
        expect(await idsDasCamadas(), 'a camada de saída ficou vazia na árvore').not.toContain(layerId);
        expect(await idsDasCamadas(), 'a camada de entrada fica').toContain('entrada');
    });

    it('refazer devolve a camada e as feições com os MESMOS ids', async () => {
        const { layerId } = await processar();
        const idsAntes = await pontosNaCamada(layerId);
        const nomeAntes = (await getLayersCompat(MAPA)).find((l) => l.id === layerId).name;

        await store.undoLastAction();
        expect(await store.redoLastAction()).toBeTruthy();

        const camada = (await getLayersCompat(MAPA)).find((l) => l.id === layerId);
        expect(camada, 'a camada voltou com o mesmo id').toBeTruthy();
        expect(camada.name).toBe(nomeAntes);
        expect(await pontosNaCamada(layerId)).toEqual(idsAntes);
    });

    it('desfazer de novo depois de refazer tira as duas outra vez', async () => {
        const { layerId } = await processar();
        await store.undoLastAction();
        await store.redoLastAction();
        await store.undoLastAction();
        expect(await idsDasCamadas()).not.toContain(layerId);
        expect(await pontosNaCamada(layerId)).toHaveLength(0);
    });

    it('a camada que ganhou feição de outra origem depois do gesto NÃO sai', async () => {
        const { layerId } = await processar();
        // Uma feição que chega sem entrada na pilha desta pessoa (a de um colega, por exemplo).
        const dados = await getMapDataCompat(MAPA);
        dados.features.points.push(ponto('p-do-colega', layerId));
        await updateMapDataCompat(MAPA, dados);

        await store.undoLastAction();
        expect(await idsDasCamadas(), 'a camada com trabalho alheio fica').toContain(layerId);
        expect(await pontosNaCamada(layerId), 'só sai o que o gesto criou').toEqual(['p-do-colega']);
    });
});

describe('desfazer uma importação dá a mesma resposta', () => {
    it('desfazer tira a camada da importação, e refazer a devolve com o mesmo id', async () => {
        const { default: AddImportControl } = await import('../../src/js/import_export/import.control.js');
        const controle = new AddImportControl({ setActiveTool: vi.fn(), deactivateCurrentTool: vi.fn() });
        // The progress overlay is DOM, and node has none; the import's writes are what is measured.
        controle._showProgressIndicator = () => () => {};
        controle._hideProgressIndicator = () => {};
        // The draw controls only lend their default properties to the imported features.
        class ControleDeDesenho { static DEFAULT_PROPERTIES = { color: '#ff0000' }; }
        controle.setControls(new ControleDeDesenho(), new ControleDeDesenho(), new ControleDeDesenho());

        const antes = await idsDasCamadas();
        await controle.importGeoJSON({
            type: 'FeatureCollection',
            features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [-43.1, -22.8] }, properties: {} }],
        }, 'arquivo.geojson');
        const camada = (await idsDasCamadas()).find((id) => !antes.includes(id));
        expect(camada, 'a importação criou a camada dela').toBeTruthy();
        const idsImportados = await pontosNaCamada(camada);
        expect(idsImportados).toHaveLength(1);

        await store.undoLastAction();
        expect(await idsDasCamadas(), 'a camada da importação ficou vazia na árvore').not.toContain(camada);

        await store.redoLastAction();
        expect(await idsDasCamadas()).toContain(camada);
        expect(await pontosNaCamada(camada)).toEqual(idsImportados);
    });
});

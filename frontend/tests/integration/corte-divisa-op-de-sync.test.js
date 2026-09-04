// Path: tests/integration/corte-divisa-op-de-sync.test.js

/**
 * @fileoverview O CORTE DA LINHA DE LIMITE TEM DE SAIR COMO OPERAÇÃO DE SYNC.
 *
 * A regra da casa é "escrita INCREMENTAL de entidade colaborativa é só via
 * sync", e no cliente isso significa uma coisa concreta: quem escreve feição é
 * `addFeature`/`removeFeature`, e são elas que enfileiram a op no `deferAsync`
 * da própria transação (`logFeatureOperation`, de
 * `store/sync/operation-dispatcher.js`). Um corte que pintasse as três fontes do
 * MapLibre sem passar por ali desenharia na tela do autor e em lugar nenhum
 * mais: o par nunca receberia as duas metades nem a remoção da original, e nada
 * acusaria.
 *
 * O QUE ESTE ARQUIVO PRENDE, e o que ele deliberadamente não prende. Ele usa a
 * `feature.operations.js` DE VERDADE, com repositório, mapManager e memória
 * dublados, e espiona `logFeatureOperation`, que é a porta de saída. A mecânica
 * da fila (persistência, compactação, ordem das chaves) é de
 * `tests/integration/operation-logging-active.test.js` e não se remede aqui.
 *
 * TRÊS PROPRIEDADES, e as três são divergências deliberadas do corte de linha:
 *   1. saem TRÊS ops, CREATE, CREATE e DELETE, com os ids das metades e o da
 *      original;
 *   2. as duas escritas vêm ANTES da remoção, então escrita bloqueada deixa
 *      duplicata recuperável em vez de buraco;
 *   3. as três ficam DENTRO de `startBatchUndo`/`commitBatchUndo`, então um
 *      Ctrl+Z desfaz o corte inteiro.
 */

import { describe, it, expect, beforeEach, vi, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getEmptyMapData } from '../../src/js/store/repository.utils.js';

// ============================================================================
// Estado compartilhado com as fábricas de mock (içado)
// ============================================================================

const { timeline, mockMapData, mockMapManager, mockLockedMaps, toasts } = vi.hoisted(() => ({
    // UMA lista ordenada para tudo o que o corte faz: é ela que responde se as
    // ops de sync caíram dentro do lote de undo e em que ordem.
    timeline: [],
    mockMapData: { value: null },
    mockMapManager: {
        getCurrentMapName: vi.fn(() => 'TestMap'),
        getCurrentMapId: vi.fn(() => 'map-uuid-123'),
        getMapId: vi.fn(() => 'map-uuid-123'),
        getFeatureColor: vi.fn(() => null),
        getFeatureColors: vi.fn(() => []),
        updateColorUsage: vi.fn(),
        recordAction: vi.fn(),
    },
    mockLockedMaps: { value: new Set() },
    toasts: [],
}));

// ============================================================================
// Mocks das folhas da store (o mesmo recorte de tests/store/feature-operations.test.js)
// ============================================================================

vi.mock('../../src/js/store/store-errors.js', () => ({
    StoreErrorEvents: {
        STORE_PERSIST_ERROR: 'store:persistError',
        STORE_OPERATION_BLOCKED: 'store:operationBlocked',
    },
    emitStoreError: vi.fn(),
}));

// O gate por papel é REAL; ele só engata em atlas remoto conectado. Local por padrão.
vi.mock('../../src/js/store/store-origin.js', () => ({
    StoreOriginKind: { LOCAL: 'local', REMOTE: 'remote' },
    isRemoteStoreSync: vi.fn(() => false),
    getStoreOriginSync: vi.fn(() => ({ kind: 'local', atlasId: null })),
    loadStoreOrigin: vi.fn(async () => ({ kind: 'local', atlasId: null })),
    setStoreOrigin: vi.fn(async () => {}),
    markStoreRemote: vi.fn(async () => {}),
    markStoreLocal: vi.fn(async () => {}),
}));

vi.mock('../../src/js/store/map.operations.js', () => ({
    isCurrentMapLockedSync: vi.fn(() => false),
}));

// A PORTA DE SAÍDA. Espiã, e ela escreve na mesma linha do tempo do lote de undo.
vi.mock('../../src/js/store/sync/index.js', () => ({
    logFeatureOperation: vi.fn(async (type, entityId) => {
        timeline.push(`sync:${type}:${entityId}`);
    }),
    OperationType: { CREATE: 'CREATE', UPDATE: 'UPDATE', DELETE: 'DELETE' },
}));

vi.mock('../../src/js/store/repositories/index.js', () => ({
    getMapDataCompat: vi.fn(async () => mockMapData.value),
    updateMapDataCompat: vi.fn(async (mapName, data) => { mockMapData.value = data; }),
    getLayersCompat: vi.fn(async () => []),
}));

vi.mock('../../src/js/store/store-state-manager.js', () => ({ default: mockMapManager }));

vi.mock('../../src/js/store/memory-store.js', () => ({
    memoryStore: {
        get lockedMaps() { return mockLockedMaps.value; },
        set lockedMaps(v) { mockLockedMaps.value = v; },
        currentMap: 'TestMap',
    },
}));

// ============================================================================
// A fachada que o corte importa
// ============================================================================

// `@store` entrega as operações de feição DE VERDADE: é isso que faz a asserção
// sobre `logFeatureOperation` medir o caminho do produto e não um dublê que
// concorda com o teste. O resto do barril é stub, porque o corte só o consulta.
vi.mock('@store', async () => {
    const ops = await import('../../src/js/store/feature.operations.js');
    const mapOps = await import('../../src/js/store/map.operations.js');
    return {
        addFeature: ops.addFeature,
        removeFeature: ops.removeFeature,
        // Delega ao mesmo dublê que o `guardWrite` da store consulta: a guarda de
        // entrada do corte e a guarda de cada escrita têm de ler a MESMA trava,
        // senão o caso de mapa travado mediria dois estados diferentes.
        isCurrentMapLockedSync: () => mapOps.isCurrentMapLockedSync(),
        getCurrentMapNameSync: () => 'TestMap',
        getEventBus: () => ({ emit: (type) => { timeline.push(`event:${type}`); } }),
        startBatchUndo: () => { timeline.push('batch:start'); },
        commitBatchUndo: () => { timeline.push('batch:commit'); },
    };
});

vi.mock('@utils', () => ({
    IDUtils: {
        generateFeatureIds: (() => {
            let n = 0;
            return () => { n += 1; return { id: `metade-${n}`, geoJsonId: `geo-${n}` }; };
        })(),
    },
    showSuccess: (msg) => { toasts.push(['success', msg]); },
    showWarning: (msg) => { toasts.push(['warning', msg]); },
    showToast: (msg) => { toasts.push(['info', msg]); },
}));

vi.mock('@events', () => ({ EventTypes: { LAYERS_CHANGED: 'layersChanged' } }));

// O corte baixa o turf sob demanda; aqui ele já está no global.
vi.mock('@utils/turf-loader.js', () => ({ ensureTurf: async () => {} }));

// A geometria importa `BaseGeometry` do barril `@tools`, acoplado ao DOM.
vi.mock('@tools', () => ({
    BaseGeometry: class {
        constructor(properties = {}) { this.properties = properties; }
        calculateDistance() { return 0; }
    },
}));

// ============================================================================
// Imports (depois dos mocks)
// ============================================================================

import { setFeatureDependencies } from '../../src/js/store/feature.operations.js';
import { logFeatureOperation } from '../../src/js/store/sync/index.js';

let splitBoundaryAtPoint;
let AddBoundaryGeometry;
let geometry;

const SPINE = [
    [-47.90, -15.80],
    [-47.70, -15.72],
    [-47.55, -15.60],
    [-47.30, -15.55],
];

/**
 * O bundle real do turf, carregado como a irmã `boundary-split-real-turf.test.js`
 * o carrega e pelo mesmo motivo: um stub que só devolvesse números plausíveis
 * deixaria o corte medir uma linha que ninguém desenhou.
 * @returns {Object} O namespace do turf
 */
function loadRealTurf() {
    const source = readFileSync(
        fileURLToPath(new URL('../../public/vendors/turf.min.js', import.meta.url)),
        'utf8',
    );
    const holder = {};
    // eslint-disable-next-line no-new-func
    const factory = new Function('module', 'exports', 'window', 'globalThis', source);
    factory(undefined, undefined, holder, holder);
    return holder.turf;
}

beforeAll(async () => {
    const turf = loadRealTurf();
    expect(typeof turf?.nearestPointOnLine, 'o bundle real do turf nao carregou').toBe('function');
    // A geometria lê o global nu e o corte lê `window.turf`, como no navegador,
    // onde `window` É o global. As duas formas convivem na árvore.
    globalThis.turf = turf;
    globalThis.window = globalThis;

    ({ default: AddBoundaryGeometry } =
        await import('../../src/js/military_tools/boundary_tool/add_boundary_geometry.js'));
    ({ splitBoundaryAtPoint } =
        await import('../../src/js/military_tools/boundary_tool/boundary-split.js'));
    geometry = new AddBoundaryGeometry();
});

afterAll(() => { delete globalThis.turf; delete globalThis.window; });

/**
 * A divisa que vai ser cortada, já dentro do documento do mapa.
 * @returns {Object} A feição original
 */
function seedBoundary() {
    const feature = {
        type: 'Feature',
        id: 'geo-original',
        properties: {
            id: 'divisa-original',
            source: 'boundary',
            nome: 'Limite 12 BI',
            layerId: 'default',
            baseCoordinates: SPINE,
            echelon: 'XX',
            symbol_instances: [{ ratio: 0.5, showLabels: true }],
            symbol_size: 1,
            text_distance_ratio: 0.9,
            createdAtZoom: 12,
            zoomCorrectionEnabled: true,
            lineWidth: 4,
        },
        geometry: geometry.generate({
            baseCoordinates: SPINE,
            echelon: 'XX',
            symbol_instances: [{ ratio: 0.5, showLabels: true }],
            symbol_size: 1,
        }, 12),
    };

    mockMapData.value.features.boundarys = [feature];
    return feature;
}

/**
 * Dublê do controle: a geometria é a REAL, e só a escrita das três fontes do
 * MapLibre é registrada, porque ela não é o sujeito deste arquivo.
 * @returns {Object} O selectionManager que o corte consulta
 */
function makeSelectionManager(replaceCalls) {
    const control = {
        geometry,
        replaceSplitBoundary: async (originalId, halves) => {
            timeline.push('sources:replace');
            replaceCalls.push({ originalId, halves });
        },
    };
    return {
        controls: new Map([['boundary', control]]),
        deselectAllFeatures: () => {},
        updateUI: () => {},
    };
}

const map = {
    getSource: () => ({}),
    getZoom: () => 12,
};

beforeEach(() => {
    vi.clearAllMocks();
    timeline.length = 0;
    toasts.length = 0;
    mockMapData.value = getEmptyMapData();
    mockLockedMaps.value = new Set();
    setFeatureDependencies({ groupManager: { removeFeatureFromAllGroups: vi.fn() } });
});

describe('o corte da linha de limite grava pelo caminho de sync', () => {
    it('emite CREATE das duas metades e DELETE da original, nessa ordem', async () => {
        const original = seedBoundary();
        const replaceCalls = [];
        const selectionManager = makeSelectionManager(replaceCalls);

        const result = await splitBoundaryAtPoint(
            original, { lng: -47.70, lat: -15.72 }, map, selectionManager,
        );

        expect(result.success).toBe(true);

        const ops = logFeatureOperation.mock.calls.map(([type, entityId]) => [type, entityId]);
        expect(ops).toHaveLength(3);

        const [firstHalf, secondHalf] = result.features;
        expect(ops[0]).toEqual(['CREATE', firstHalf.properties.id]);
        expect(ops[1]).toEqual(['CREATE', secondHalf.properties.id]);
        expect(ops[2]).toEqual(['DELETE', 'divisa-original']);

        // A op de CREATE leva a feição inteira, senão o par recebe uma metade sem
        // espinha e sem escalão: é o payload que o desenho do outro lado reconstrói.
        const createdPayload = logFeatureOperation.mock.calls[0][3];
        expect(createdPayload.properties.baseCoordinates.length).toBeGreaterThanOrEqual(2);
        expect(createdPayload.properties.symbol_instances.length).toBeGreaterThanOrEqual(1);
    });

    it('põe as três ops dentro de um lote de undo só, e escreve antes de remover', async () => {
        const original = seedBoundary();
        const replaceCalls = [];

        await splitBoundaryAtPoint(
            original, { lng: -47.70, lat: -15.72 }, map, makeSelectionManager(replaceCalls),
        );

        const start = timeline.indexOf('batch:start');
        const commit = timeline.indexOf('batch:commit');
        const syncOps = timeline
            .map((entry, index) => ({ entry, index }))
            .filter(({ entry }) => entry.startsWith('sync:'));

        expect(start).toBeGreaterThanOrEqual(0);
        expect(commit).toBeGreaterThan(start);
        expect(syncOps).toHaveLength(3);
        for (const { index } of syncOps) {
            expect(index).toBeGreaterThan(start);
            expect(index).toBeLessThan(commit);
        }

        // A ordem que separa este corte do corte de linha: as duas escritas ANTES
        // da remoção, porque escrita bloqueada tem de deixar duplicata, não buraco.
        expect(syncOps.map(({ entry }) => entry.split(':')[1])).toEqual(['CREATE', 'CREATE', 'DELETE']);

        // E as fontes do MapLibre só são tocadas DEPOIS que a store aceitou as três.
        expect(timeline.indexOf('sources:replace')).toBeGreaterThan(commit);
    });

    it('com o mapa travado não sai op nenhuma e a original continua no documento', async () => {
        const original = seedBoundary();
        mockLockedMaps.value = new Set(['TestMap']);
        const { isCurrentMapLockedSync } = await import('../../src/js/store/map.operations.js');
        isCurrentMapLockedSync.mockReturnValue(true);

        const replaceCalls = [];
        const result = await splitBoundaryAtPoint(
            original, { lng: -47.70, lat: -15.72 }, map, makeSelectionManager(replaceCalls),
        );

        expect(result.success).toBe(false);
        expect(logFeatureOperation).not.toHaveBeenCalled();
        expect(replaceCalls).toHaveLength(0);
        expect(mockMapData.value.features.boundarys).toHaveLength(1);

        isCurrentMapLockedSync.mockReturnValue(false);
    });

    // O PIOR CASO, e é ele que decide a ORDEM. O par trava o mapa no meio do
    // gesto, entre as duas escritas: a segunda metade é recusada (`undefined`, sem
    // lançar), e a limpeza da primeira é recusada pela mesma trava. O que o corte
    // deixa então é DUPLICATA, nunca buraco: a original tem de continuar no
    // documento e o DELETE dela não pode ter saído. Escrevendo na ordem do corte
    // de linha (remover primeiro), este mesmo caso apagaria a divisa e não
    // gravaria metade nenhuma.
    it('travado o mapa entre as duas escritas, a original sobrevive e nenhum DELETE sai', async () => {
        const original = seedBoundary();
        const { isCurrentMapLockedSync } = await import('../../src/js/store/map.operations.js');

        // O par trava o mapa no EVENTO em que a primeira metade é aceita pela store (a op
        // de CREATE dela sai pela porta de sync), e não numa contagem de leituras da trava:
        // uma leitura a mais ou a menos em qualquer ponto do caminho deslocaria a contagem
        // sem o caso ficar vermelho, e ele passaria a medir outra coisa, calado.
        let travado = false;
        isCurrentMapLockedSync.mockImplementation(() => travado);
        logFeatureOperation.mockImplementationOnce(async (type, entityId) => {
            timeline.push(`sync:${type}:${entityId}`);
            travado = true;
        });

        const replaceCalls = [];
        const result = await splitBoundaryAtPoint(
            original, { lng: -47.70, lat: -15.72 }, map, makeSelectionManager(replaceCalls),
        );

        expect(result.success).toBe(false);
        expect(replaceCalls).toHaveLength(0);

        // Uma op só, e ela é de criação: a original nunca foi anunciada como removida.
        const emitidas = logFeatureOperation.mock.calls.map(([type]) => type);
        expect(emitidas).toEqual(['CREATE']);

        const restantes = mockMapData.value.features.boundarys.map(f => f.properties.id);
        expect(restantes).toContain('divisa-original');

        isCurrentMapLockedSync.mockReturnValue(false);
    });
});

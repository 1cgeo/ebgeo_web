// Path: tests/unit/desfazer-escrita-de-propriedade.repro.test.js
//
// REPRO (achado E2, metade da STORE): NENHUMA EDIÇÃO DE TRAJETÓRIA ERA DESFAZÍVEL.
//
// O DEFEITO. Arrastar, inserir e remover ponto-chave gravavam por `updateFeatureProperty`
// (`store/feature.operations.js`), que enfileirava a op de sync e NÃO registrava ação de
// desfazer nenhuma. Ctrl+Z pulava a edição inteira e desfazia o gesto ANTERIOR, o que é pior
// que não fazer nada: a pessoa perde uma coisa que não estava tentando desfazer. Só o arrasto
// do PRIMEIRO ponto-chave era desfazível, porque ele cai no ramo da âncora e grava pelo
// controle dono (`updateFeatures` → `updateFeature`), e `updateFeature` registra: o MESMO gesto
// tinha duas regras conforme o vértice escolhido.
//
// A CAUSA. `updateFeature`, dez linhas acima no mesmo arquivo, chama `mapManager.recordAction`
// dentro de `tx.deferSync`; `updateFeatureProperty` simplesmente não tinha a chamada.
//
// O CONSERTO É OPT-IN, e isso é parte da regra prendida aqui: a escrita de propriedade é
// também o olho de visibilidade, o cadeado e a célula da tabela de atributos, e vários desses
// chamadores rodam em LAÇO sobre seleção múltipla. Uma entrada por feição soterraria a pilha.
// Quem é GESTO pede a entrada; o padrão continua mudo.
//
// O QUE ESTE ARQUIVO PRENDE: a entrada existe, tem a forma que o executor de desfazer consome,
// e o padrão continua sem entrada (controle negativo embutido, nos dois sentidos).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { getEmptyMapData } from '../../src/js/store/repository.utils.js';

const { mockMapData, mockMapManager, mockLockedMaps } = vi.hoisted(() => ({
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
}));

vi.mock('../../src/js/store/store-errors.js', () => ({
    StoreErrorEvents: {
        STORE_PERSIST_ERROR: 'store:persistError',
        STORE_OPERATION_BLOCKED: 'store:operationBlocked',
    },
    emitStoreError: vi.fn(),
}));

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

vi.mock('../../src/js/store/sync/index.js', () => ({
    logFeatureOperation: vi.fn().mockResolvedValue(undefined),
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

import { updateFeatureProperty } from '../../src/js/store/feature.operations.js';

const ROTA_ANTES = [{ t: 1000, lng: -47.9, lat: -15.8 }, { t: 2000, lng: -47.8, lat: -15.7 }];
const ROTA_DEPOIS = [
    { t: 1000, lng: -47.9, lat: -15.8 },
    { t: 1500, lng: -47.85, lat: -15.75 },
    { t: 2000, lng: -47.8, lat: -15.7 },
];

function pontoComRota() {
    return {
        type: 'Feature',
        id: 'p1',
        geometry: { type: 'Point', coordinates: [-47.9, -15.8] },
        properties: { id: 'p1', layerId: 'default', source: 'point', trajetoria: ROTA_ANTES },
    };
}

/** As ações de desfazer registradas nesta rodada. */
function acoes() {
    return mockMapManager.recordAction.mock.calls.map((c) => c[0]);
}

describe('updateFeatureProperty e o desfazer', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockMapData.value = getEmptyMapData();
        mockLockedMaps.value = new Set();
        mockMapData.value.features.points.push(pontoComRota());
    });

    it('REPRO: sem a opção, a escrita acontece e NÃO há o que desfazer', async () => {
        const ok = await updateFeatureProperty('points', 'p1', 'trajetoria', ROTA_DEPOIS);

        // O controle positivo e o negativo na mesma asserção: a escrita É gravada…
        expect(ok).toBe(true);
        expect(mockMapData.value.features.points[0].properties.trajetoria).toEqual(ROTA_DEPOIS);
        // …e mesmo assim nada entra na pilha. Era este o estado do produto inteiro.
        expect(acoes()).toEqual([]);
    });

    it('com `recordUndo`, entra UMA ação de edição, com os dois lados da mudança', async () => {
        await updateFeatureProperty('points', 'p1', 'trajetoria', ROTA_DEPOIS, null, { recordUndo: true });

        expect(acoes()).toHaveLength(1);
        const acao = acoes()[0];
        expect(acao.type).toBe('update');
        expect(acao.featureType).toBe('points');
        expect(acao.oldFeature.properties.trajetoria).toEqual(ROTA_ANTES);
        expect(acao.newFeature.properties.trajetoria).toEqual(ROTA_DEPOIS);
    });

    it('os dois instantâneos são CÓPIAS: uma escrita posterior não reescreve a ação guardada', async () => {
        await updateFeatureProperty('points', 'p1', 'trajetoria', ROTA_DEPOIS, null, { recordUndo: true });
        const acao = acoes()[0];

        // Segunda edição do mesmo ponto (outro gesto), agora esvaziando a rota.
        await updateFeatureProperty('points', 'p1', 'trajetoria', [], null, { recordUndo: true });

        // Sem a cópia, `newFeature` apontaria para o objeto VIVO dentro do documento do mapa e
        // o refazer da primeira ação restauraria a rota da segunda.
        expect(acao.newFeature.properties.trajetoria).toEqual(ROTA_DEPOIS);
        expect(acao.oldFeature.properties.trajetoria).toEqual(ROTA_ANTES);
    });

    it('a ação de OUTRO mapa não entra na pilha do mapa corrente', async () => {
        // `shouldRecordUndo` continua valendo: a pilha é por mapa, e uma edição dirigida a um
        // mapa que não é o corrente não pode aparecer no Ctrl+Z de quem está olhando outro.
        mockMapManager.getCurrentMapName.mockReturnValue('OutroMapa');

        await updateFeatureProperty('points', 'p1', 'trajetoria', ROTA_DEPOIS, 'TestMap', { recordUndo: true });

        expect(acoes()).toEqual([]);
    });

    it('a feição ausente não registra ação nenhuma', async () => {
        const ok = await updateFeatureProperty('points', 'inexistente', 'trajetoria', ROTA_DEPOIS, null, { recordUndo: true });

        expect(ok).toBe(false);
        expect(acoes()).toEqual([]);
    });

    it('a escrita comum do produto continua muda: visibilidade e cadeado não pedem a opção', async () => {
        await updateFeatureProperty('points', 'p1', 'visivel', false);
        await updateFeatureProperty('points', 'p1', 'bloqueado', true);

        expect(acoes()).toEqual([]);
        expect(mockMapData.value.features.points[0].properties.visivel).toBe(false);
    });
});

describe('a forma da ação é a que o executor de desfazer consome', () => {
    const fonte = readFileSync(new URL('../../src/js/store/store-state-manager.js', import.meta.url), 'utf8')
        .replace(/\r\n/g, '\n');

    it("o ramo 'update' inverte por `updateFeature(featureType, oldFeature)`", () => {
        // A ação acima seria inerte se o executor lesse outros nomes de campo. Este caso é o
        // único elo entre os dois arquivos que não passa por uma rodada de store inteira.
        expect(fonte).toContain("case 'update':\n                await executeFunction.updateFeature(action.featureType, action.oldFeature);");
        expect(fonte).toContain("case 'update':\n                await executeFunction.updateFeature(action.featureType, action.newFeature);");
    });

    it('a pilha agrupa por `batchCollector`, que é o que dá uma entrada a um gesto composto', () => {
        // `startBatchUndo()` / `commitBatchUndo()` continuam funcionando sobre esta ação, e é
        // por isso que o editor não precisa de um mecanismo próprio de agrupamento.
        expect(fonte).toContain('if (this.memoryStore.batchCollector !== null) {');
    });
});

// Path: tests/integration/cascata-de-camada-no-par.repro.test.js

/**
 * @fileoverview REPRO: apagar uma camada apagava as feicoes dela NO SERVIDOR e nao no PAR.
 *
 * A CAUSA RAIZ, e ela e de FRONTEIRA, nao de arquivo. O servidor faz a cascata na mesma
 * transacao do delete da camada (`backend/src/modules/sync/sync.service.js`, o bloco marcado
 * "2.2 cascade": `UPDATE features SET deleted_at ... WHERE layer_id = $1 AND map_id = $2`).
 * O cliente nao emite op de feicao nesse caminho: `deleteLayerFeatures` esvazia o documento
 * local sem logar nada, entao o unico envelope que viaja e o `layer delete`. E
 * `applyRemoteLayerOp` (`frontend/src/js/store/sync/remote-operation-handler.js`), do lado de
 * quem RECEBE, so filtrava a lista de camadas. Resultado: o banco sem as feicoes, o autor sem
 * as feicoes, e o par com todas elas dentro do documento do mapa ate o proximo snapshot. Nada
 * dava erro, e a tela do par ate as escondia, porque o filtro de visibilidade lista camadas e a
 * camada tinha sumido: o dado ficava divergente e INVISIVEL, que e a pior combinacao para
 * acreditar.
 *
 * POR QUE NAO SE CONSERTA DO LADO DO AUTOR, que e a saida obvia (emitir `feature delete` por
 * feicao junto do delete da camada): mover uma camada de mapa (`transferLayerToMap`) MANTEM o id
 * da feicao e a move por um `feature create` carimbado com o mapa de DESTINO. Com LWW por ordem
 * de chegada, um `feature delete` daquele mesmo id chegando atras apagaria exatamente a feicao
 * que acabou de se mudar. A cascata pertence a quem APLICA o delete da camada, e e por isso que
 * ela agora existe dos DOIS lados do envelope.
 *
 * OS CONTROLES, e sao tres, porque sem eles uma cascata que apagasse o documento inteiro
 * passaria em quase tudo: a feicao de OUTRA camada sobrevive; a feicao de OUTRO mapa sobrevive
 * (o servidor casa `layer_id AND map_id`, e a segunda metade e a que evita levar junto as
 * homonimas de todos os outros mapas); e o segundo delete identico nao remove nem emite nada,
 * que e o que separa "a cascata rodou" de "a cascata reemite delecao de feicao que ninguem tem".
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ============================================================================
// Mocks (molde de tests/integration/remote-operation-handler.test.js)
// ============================================================================

const localStorageMock = (() => {
    const store = {};
    return {
        getItem: (key) => store[key] || null,
        setItem: (key, value) => { store[key] = String(value); },
        removeItem: (key) => { delete store[key]; }
    };
})();
if (typeof globalThis.localStorage === 'undefined') {
    Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });
}

const mapDataStore = new Map();
const layerStore = new Map();

vi.mock('localforage', () => {
    const mockStore = new Map();
    return {
        default: {
            createInstance: () => ({
                setItem: vi.fn(async (key, value) => { mockStore.set(key, value); }),
                getItem: vi.fn(async (key) => mockStore.get(key) || null),
                removeItem: vi.fn(async (key) => { mockStore.delete(key); }),
                keys: vi.fn(async () => [...mockStore.keys()]),
            })
        }
    };
});

vi.mock('../../src/js/utilities/uuid.js', () => ({
    generateUUID: vi.fn(() => `uuid-${Date.now()}`),
    isValidUUID: vi.fn(() => true),
}));

vi.mock('../../src/js/store/store-errors.js', () => ({
    StoreErrorEvents: { STORE_SYNC_ERROR: 'store:syncError' },
    emitStoreError: vi.fn()
}));

vi.mock('../../src/js/store/repositories/index.js', () => ({
    getRepository: vi.fn(() => ({
        getMap: vi.fn(async (mapId) => mapDataStore.get(mapId) || null),
        saveMap: vi.fn(async (mapId, data) => { mapDataStore.set(mapId, data); }),
        getLayers: vi.fn(async (mapId) => layerStore.get(mapId) || []),
        saveLayers: vi.fn(async (mapId, layers) => { layerStore.set(mapId, layers); }),
    })),
}));

vi.mock('../../src/js/store/repositories/local.repository.js', () => ({
    localRepository: {}
}));

// ============================================================================
// Imports (after mocks)
// ============================================================================

import {
    applyRemoteOperation,
    setRemoteHandlerEventBus,
} from '../../src/js/store/sync/remote-operation-handler.js';
import { EntityType, OperationType } from '../../src/js/store/sync/operation-types.js';
import { EventTypes } from '../../src/js/events/event_types.js';

// ============================================================================
// Cenario: 3 feicoes, 2 camadas, 2 buckets
// ============================================================================

const MAPA = 'map-1';
const OUTRO_MAPA = 'map-2';
const CAMADA_A = 'layer-a';
const CAMADA_B = 'layer-b';

/**
 * @param {string} id - Id de sync.
 * @param {string} source - Tipo SINGULAR.
 * @param {string} layerId - Camada dona.
 * @returns {object} A feicao.
 */
function feicao(id, source, layerId) {
    return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [-43.1, -22.9] },
        properties: { id, source, nome: `Feicao ${id}`, layerId }
    };
}

/**
 * Semeia o mapa com tres feicoes: duas na camada A (em DOIS baldes) e uma na camada B.
 * @returns {void}
 */
function semear() {
    const doc = { id: MAPA, features: { points: [], lines: [], polygons: [] } };
    doc.features.points.push(feicao('a-ponto', 'point', CAMADA_A));
    doc.features.lines.push(feicao('a-linha', 'line', CAMADA_A));
    doc.features.points.push(feicao('b-ponto', 'point', CAMADA_B));
    mapDataStore.set(MAPA, doc);

    layerStore.set(MAPA, [
        { id: CAMADA_A, name: 'Camada A' },
        { id: CAMADA_B, name: 'Camada B' }
    ]);
}

/**
 * Aplica o delete remoto da camada A.
 * @returns {Promise<*>} Resolve com o delete aplicado.
 */
function apagarCamadaA() {
    return applyRemoteOperation({
        entityType: EntityType.LAYER,
        operationType: OperationType.DELETE,
        entityId: CAMADA_A,
        mapId: MAPA,
        data: null
    });
}

/**
 * @param {string} [mapId] - Mapa a ler.
 * @returns {string[]} Todos os ids de feicao que restam, em qualquer balde, ordenados.
 */
function idsRestantes(mapId = MAPA) {
    const doc = mapDataStore.get(mapId);
    return Object.values(doc?.features || {})
        .flat()
        .map((f) => f.properties.id)
        .sort();
}

/**
 * @param {object} bus - O barramento espiao.
 * @returns {Array<object>} Os payloads de FEATURE_DELETED emitidos.
 */
function delecoesEmitidas(bus) {
    return bus.emit.mock.calls
        .filter((c) => c[0] === EventTypes.FEATURE_DELETED)
        .map((c) => c[1]);
}

let eventBus;

beforeEach(() => {
    mapDataStore.clear();
    layerStore.clear();
    eventBus = { emit: vi.fn(), on: vi.fn(), off: vi.fn() };
    setRemoteHandlerEventBus(eventBus);
    semear();
});

// ============================================================================
// TESTES
// ============================================================================

describe('o par espelha a cascata do servidor: apagar camada apaga as feicoes dela', () => {

    it('remove as DUAS feicoes da camada apagada, de baldes diferentes', async () => {
        await apagarCamadaA();

        // ABSOLUTO: sem a cascata este array tem os tres ids, e um `<= 3` passaria verde
        // exatamente no defeito.
        expect(idsRestantes()).toEqual(['b-ponto']);
        const doc = mapDataStore.get(MAPA);
        expect(doc.features.points).toHaveLength(1);
        expect(doc.features.lines).toHaveLength(0);
    });

    it('mantem a feicao da OUTRA camada, que e o controle de que a cascata mira', async () => {
        await apagarCamadaA();

        const doc = mapDataStore.get(MAPA);
        expect(doc.features.points[0].properties.id).toBe('b-ponto');
        expect(doc.features.points[0].properties.layerId).toBe(CAMADA_B);
    });

    it('emite UM FEATURE_DELETED por feicao, com o tipo SINGULAR e o mapa', async () => {
        await apagarCamadaA();

        const delecoes = delecoesEmitidas(eventBus);
        expect(delecoes).toHaveLength(2);
        expect(delecoes.map((d) => d.featureId).sort()).toEqual(['a-linha', 'a-ponto']);
        expect(delecoes.map((d) => d.featureType).sort()).toEqual(['line', 'point']);
        expect(delecoes.every((d) => d.mapId === MAPA)).toBe(true);
    });

    it('a camada sai da lista, e os eventos de camada continuam saindo', async () => {
        await apagarCamadaA();

        expect(layerStore.get(MAPA).map((l) => l.id)).toEqual([CAMADA_B]);
        const tipos = eventBus.emit.mock.calls.map((c) => c[0]);
        expect(tipos).toContain(EventTypes.LAYER_DELETED);
        expect(tipos).toContain(EventTypes.LAYERS_CHANGED);
    });

    it('IDEMPOTENTE: um segundo delete igual nao remove nada e nao emite delecao', async () => {
        await apagarCamadaA();
        eventBus.emit.mockClear();

        await apagarCamadaA();

        expect(idsRestantes()).toEqual(['b-ponto']);
        expect(delecoesEmitidas(eventBus)).toHaveLength(0);
        // E o caminho de camada continua respondendo: o silencio e da cascata, nao do ramo.
        expect(eventBus.emit.mock.calls.map((c) => c[0])).toContain(EventTypes.LAYER_DELETED);
    });

    it('NAO toca em outro mapa, ainda que a camada tenha o mesmo id la', async () => {
        // O servidor casa `layer_id AND map_id`. Sem a segunda metade, apagar uma camada
        // num mapa levaria junto as feicoes homonimas de todos os outros.
        mapDataStore.set(OUTRO_MAPA, {
            id: OUTRO_MAPA,
            features: { points: [feicao('outro-ponto', 'point', CAMADA_A)], lines: [] }
        });

        await apagarCamadaA();

        expect(idsRestantes(OUTRO_MAPA)).toEqual(['outro-ponto']);
    });

    it('camada vazia: nada a remover, nenhuma delecao emitida', async () => {
        await applyRemoteOperation({
            entityType: EntityType.LAYER,
            operationType: OperationType.DELETE,
            entityId: 'camada-que-nunca-teve-nada',
            mapId: MAPA,
            data: null
        });

        expect(idsRestantes()).toEqual(['a-linha', 'a-ponto', 'b-ponto']);
        expect(delecoesEmitidas(eventBus)).toHaveLength(0);
    });

    it('CREATE e UPDATE de camada nao disparam cascata nenhuma', async () => {
        // A cascata e do DELETE. Um update de estilo que apagasse feicao seria a pior
        // regressao possivel desta mudanca, e ela nao ficaria vermelha em mais lugar nenhum.
        await applyRemoteOperation({
            entityType: EntityType.LAYER, operationType: OperationType.UPDATE,
            entityId: CAMADA_A, mapId: MAPA, data: { id: CAMADA_A, name: 'Renomeada' }
        });
        await applyRemoteOperation({
            entityType: EntityType.LAYER, operationType: OperationType.CREATE,
            entityId: 'camada-c', mapId: MAPA, data: { id: 'camada-c', name: 'Camada C' }
        });

        expect(idsRestantes()).toEqual(['a-linha', 'a-ponto', 'b-ponto']);
        expect(delecoesEmitidas(eventBus)).toHaveLength(0);
    });
});

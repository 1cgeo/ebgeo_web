// Path: tests/integration/grupo-membro-redundante-derruba-o-par.repro.test.js

/**
 * @fileoverview REPRO: agrupar feicoes derrubava o socket do PAR, e com ele todo o sync dele.
 *
 * A CADEIA, medida em 2026-09-13. `GroupManager.createGroup` registra DOIS alvos para o mesmo
 * gesto: um `group` CREATE cujo `data` ja carrega `features: [{type,id}...]`, e atras dele um
 * `group_feature` CREATE por membro. Os dois sao obrigatorios e nenhum e redundante no SERVIDOR:
 * `UPDATE_FIELDS.group` nao tem coluna de membros e o INSERT ignora `data.features`, entao quem
 * carrega membresia e a tabela de juncao, alimentada pelo alvo `group_feature`
 * (`.claude/rules/architecture.md`, "A MEMBRESIA DE GRUPO e alvo proprio").
 *
 * No PAR, porem, o `group` CREATE chega primeiro e `applyRemoteGroupOp` grava o documento
 * INTEIRO, membros inclusive. Cada `group_feature` que vem atras encontra o membro ja no lugar,
 * nao muda nada, e `applyRemoteGroupFeatureOp` devolvia `false` — que `applyRemoteOperation`
 * repassava ao transporte como FALHA DE APLICACAO. `_queueApply` (`store/sync/ws-client.js`) le
 * `false` como escrita local quebrada e fecha o socket com 4000; o `_onConnected` seguinte pede a
 * cauda a partir de `_lastVersion`, a mesma op volta, falha de novo. Laco permanente: depois de
 * um unico "Agrupar", o par nao recebe mais nada, de tipo nenhum.
 *
 * E O SINTOMA APARECIA LONGE DA CAUSA. Os dois casos de
 * `frontend/tests/e2e-ui/browser-collab-grupo-perde-membro.spec.js` reprovavam na feicao apagada
 * que sobrevive no par e no grupo de duas que nao se dissolve, ou seja, no DELETE — que e a op
 * seguinte, a que nunca chegou. Tudo o que eles afirmam ANTES do delete passava, porque vinha do
 * `group` CREATE (entregue antes do primeiro `group_feature`) ou do `pullSync` por HTTP, que nao
 * usa o socket.
 *
 * O CONSERTO E A TRADUCAO, NAO A ESCRITA. `applyRemoteGroupFeatureOp` continua devolvendo `false`
 * quando nada foi escrito, porque e isso que decide o span `apply.persist`; o que mudou e que
 * `applyRemoteOperation` nao repassa mais esse `false` como falha para um alvo de membresia, pela
 * mesma razao (e com a mesma forma) do tipo de entidade desconhecido, que ja tinha custado um
 * laco de close/reconnect identico.
 *
 * OS CONTROLES NEGATIVOS, e sao eles que separam o conserto de "passou a dizer sim para tudo": o
 * `group_feature` que de fato ACRESCENTA membro escreve e emite; o que de fato REMOVE escreve e
 * emite; e o redundante nao pode escrever nada, senao a correcao teria trocado um laco de socket
 * por uma escrita cega a cada eco.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ============================================================================
// Mocks (molde de tests/integration/cascata-de-camada-no-par.repro.test.js)
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

const groupStore = new Map();
const saveGroupsSpy = vi.fn(async (mapId, groups) => { groupStore.set(mapId, groups); });

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
        getGroups: vi.fn(async (mapId) => groupStore.get(mapId) || {}),
        saveGroups: saveGroupsSpy,
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
// Cenario: um grupo de tres pontos, exatamente como `createGroup` o publica
// ============================================================================

const MAPA = 'map-1';
const GRUPO = 'group-1';
const MEMBROS = [
    { type: 'point', id: 'p1' },
    { type: 'point', id: 'p2' },
    { type: 'point', id: 'p3' },
];

/**
 * O envelope de `group` CREATE como o autor o registra: com a lista de membros DENTRO.
 * @returns {Promise<boolean>} O que o handler devolveu ao transporte.
 */
function criarGrupoNoPar() {
    return applyRemoteOperation({
        entityType: EntityType.GROUP,
        operationType: OperationType.CREATE,
        entityId: GRUPO,
        mapId: MAPA,
        data: { id: GRUPO, name: 'Grupo de tres', features: [...MEMBROS] },
    });
}

/**
 * Um envelope de membresia. O `entityId` e descartavel de proposito: o par que a op descreve
 * viaja em `data` (`logGroupFeatureOperation`).
 * @param {string} opType - CREATE ou DELETE.
 * @param {{type: string, id: string}} membro - O par (tipo, id).
 * @returns {Promise<boolean>} O que o handler devolveu ao transporte.
 */
function membresiaNoPar(opType, membro) {
    return applyRemoteOperation({
        entityType: EntityType.GROUP_FEATURE,
        operationType: opType,
        entityId: 'descartavel-0000',
        mapId: MAPA,
        data: { group_id: GRUPO, feature_id: membro.id, feature_type: membro.type },
    });
}

/**
 * @returns {Array<{type: string, id: string}>} Os membros que o par tem guardados.
 */
function membrosNoPar() {
    return groupStore.get(MAPA)?.[GRUPO]?.features ?? [];
}

let eventBus;

beforeEach(() => {
    groupStore.clear();
    saveGroupsSpy.mockClear();
    eventBus = { emit: vi.fn(), on: vi.fn(), off: vi.fn() };
    setRemoteHandlerEventBus(eventBus);
});

// ============================================================================
// TESTES
// ============================================================================

describe('o par sobrevive ao gesto de agrupar: membresia redundante nao e falha', () => {

    it('REPRO: o `group_feature` que chega atras do documento inteiro NAO reporta falha', async () => {
        expect(await criarGrupoNoPar()).not.toBe(false);

        // ESTA E A LINHA DO DEFEITO. Antes do conserto, os tres devolviam `false` e o primeiro
        // deles ja fechava o socket com 4000. Assercao ABSOLUTA por membro, e nao um `every`
        // sobre a lista, para que a falha nomeie QUAL deles voltou como quebra.
        for (const membro of MEMBROS) {
            expect(
                await membresiaNoPar(OperationType.CREATE, membro),
                `o membro ${membro.id} ja estava no documento: convergido nao e falha`,
            ).not.toBe(false);
        }
    });

    it('e nao escreve nada por isso: o eco redundante e mudo, nao cego', async () => {
        await criarGrupoNoPar();
        const escritasDoCreate = saveGroupsSpy.mock.calls.length;

        for (const membro of MEMBROS) await membresiaNoPar(OperationType.CREATE, membro);

        expect(
            saveGroupsSpy.mock.calls.length,
            'nenhuma escrita nova: o conserto e na traducao para o transporte, nao na persistencia',
        ).toBe(escritasDoCreate);
        expect(membrosNoPar().map((f) => f.id)).toEqual(['p1', 'p2', 'p3']);
    });

    it('CONTROLE: o `group_feature` que ACRESCENTA membro de verdade escreve e emite', async () => {
        await criarGrupoNoPar();
        eventBus.emit.mockClear();

        const novo = { type: 'point', id: 'p4' };
        expect(await membresiaNoPar(OperationType.CREATE, novo)).not.toBe(false);

        expect(membrosNoPar().map((f) => f.id)).toEqual(['p1', 'p2', 'p3', 'p4']);
        const tipos = eventBus.emit.mock.calls.map((c) => c[0]);
        expect(tipos).toContain(EventTypes.GROUP_MODIFIED);
        expect(tipos).toContain(EventTypes.GROUPS_CHANGED);
    });

    it('CONTROLE: o `group_feature` DELETE que REMOVE de verdade encolhe a lista', async () => {
        await criarGrupoNoPar();

        expect(await membresiaNoPar(OperationType.DELETE, MEMBROS[1])).not.toBe(false);

        expect(membrosNoPar().map((f) => f.id)).toEqual(['p1', 'p3']);
    });

    it('o DELETE repetido do mesmo membro tambem nao reporta falha', async () => {
        await criarGrupoNoPar();
        await membresiaNoPar(OperationType.DELETE, MEMBROS[1]);

        // A METADE SIMETRICA DA PRIMEIRA. A fila de saida e um diario append-only e o servidor
        // reenvia a cauda em toda reconexao, entao um DELETE ja aplicado volta com frequencia; se
        // ele derrubasse o socket, a reconexao seria o proprio gatilho da proxima queda.
        expect(await membresiaNoPar(OperationType.DELETE, MEMBROS[1])).not.toBe(false);
        expect(membrosNoPar().map((f) => f.id)).toEqual(['p1', 'p3']);
    });

    it('a membresia de um grupo que este par NUNCA recebeu e residuo, nao falha', async () => {
        // Sem `group` nenhum no disco. O comentario de `applyRemoteGroupFeatureOp` ja chamava
        // isso de residuo e mesmo assim devolvia `false`, e `false` aqui significa exatamente o
        // laco de close/reconnect: a cauda que traz o residuo e a mesma que a reconexao pede.
        expect(await membresiaNoPar(OperationType.CREATE, MEMBROS[0])).not.toBe(false);
        expect(saveGroupsSpy).not.toHaveBeenCalled();
    });
});

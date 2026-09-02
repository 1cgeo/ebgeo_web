// Path: tests/integration/grupo-membresia-ordem-na-fila.test.js
//
// A op do GRUPO tem de SAIR DA FILA antes das ops de MEMBRESIA dele.
//
// POR QUE ISSO E' CONTRATO, E NAO ESTILO. O INSERT da tabela de juncao e' gateado por
// EXISTS sobre a linha do grupo (`backend/src/modules/sync/sync.service.js`, ramo
// `group_feature`): uma membresia que chegue ANTES do grupo escreve ZERO linhas e volta
// acked como sucesso. Nada lanca, nada reprova, e o defeito so' aparece no snapshot
// seguinte, com o grupo sem membro nenhum.
//
// POR QUE UM ARQUIVO NOVO, E NAO UMA ASSERCAO NO IRMAO.
// `frontend/tests/store/grupo-perde-membro-loga-op.test.js` duplica os loggers, entao la'
// so' se pode medir ordem de CHAMADA. Ordem de chamada NAO e' ordem de SAIDA: quem decide
// a saida e' a chave da fila (`_buildKey`, `frontend/src/js/store/sync/operation-queue.js`)
// combinada com o `.sort()` lexicografico de `_getOrderedKeys`. Este arquivo roda o
// GroupManager REAL, o despachante REAL e a fila REAL (so' o `localforage` e' um Map), e
// pergunta a' propria fila, por `peek()`, em que ordem ela entrega.
//
// O ADVERSARIO E' DETERMINISTICO, DE PROPOSITO. Com `op_<ts>_<uuid>` o desempate entre ops
// do mesmo milissegundo cai no UUID, que e' aleatorio: um grupo de 3 membros sairia na
// ordem certa em 1 de 4 execucoes. Medir isso com UUID de verdade seria a "medicao unica de
// algo probabilistico" que a constituicao proibe, e daria um teste verde 25% das vezes.
// Aqui o `generateUUID` e' DECRESCENTE e o relogio e' fixo: a op do grupo, por ser a
// primeira cunhada, recebe o MAIOR UUID e o MESMO timestamp, e sob a chave antiga vai para
// o FIM da fila em 100% das execucoes. A interleaving perdedora virou caso fixo.
//
// DUAS PRE-CONDICOES SAO ASSERIDAS ANTES DA ORDEM, senao o verde nao prova nada: que as
// ops compartilham UM timestamp (sem isso o desempate nem e' exercitado, e a ordem estaria
// certa por tempo) e que a fila devolveu todas (senao a comparacao roda sobre lista curta).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const RELOGIO_FIXO = 1767225600000;

const mockStore = new Map();
vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            setItem: vi.fn(async (k, v) => { mockStore.set(k, v); }),
            getItem: vi.fn(async (k) => mockStore.get(k) || null),
            removeItem: vi.fn(async (k) => { mockStore.delete(k); }),
            keys: vi.fn(async () => [...mockStore.keys()]),
        }),
    },
}));

// UUIDs DECRESCENTES e zero-padded, para que a ordem lexicografica seja a numerica. A
// primeira chamada recebe o maior valor, logo a op cunhada primeiro (a do grupo) e' a que
// ordena por ULTIMO sob a chave antiga.
vi.mock('../../src/js/utilities/uuid.js', () => {
    let n = 0;
    return {
        generateUUID: vi.fn(() => `u-${String(90000 - (++n)).padStart(6, '0')}`),
        isValidUUID: vi.fn(() => true),
    };
});

vi.mock('../../src/js/store/store-errors.js', () => ({
    StoreErrorEvents: {
        STORE_SYNC_ERROR: 'store:syncError',
        STORE_PERSIST_ERROR: 'store:persistError',
    },
    emitStoreError: vi.fn(),
}));

const h = vi.hoisted(() => ({
    memoryStore: { currentMap: 'Mapa Fila', groups: {} },
}));

vi.mock('../../src/js/store/index.js', () => ({
    memoryStore: h.memoryStore,
    setMapGroups: vi.fn(),
    getMapGroupsFromDB: vi.fn(async () => ({})),
}));

const MAP_UUID = '4a22f7df-df6d-47df-80bb-f26df86d31ec';
vi.mock('../../src/js/store/services/map-resolver.service.js', () => ({
    mapResolver: { resolveToId: vi.fn(() => MAP_UUID) },
}));

import { createGroupManager } from '../../src/js/tool_manager/group_manager.js';
import {
    enableOperationLogging, disableOperationLogging, operationQueue,
} from '../../src/js/store/sync/operation-dispatcher.js';
import { EntityType, OperationType } from '../../src/js/store/sync/operation-types.js';

/** @param {string} id @returns {Object} A minimal point feature. */
const pt = (id) => ({ properties: { id, source: 'point' } });

/**
 * Waits until the queue holds `n` operations and returns them in QUEUE order.
 * The loggers are fire-and-forget, so the enqueues land a microtask later.
 * @param {number} n
 * @returns {Promise<Array<Object>>}
 */
async function esperarFila(n) {
    await vi.waitFor(async () => {
        expect((await operationQueue.peek(50)).length).toBe(n);
    }, { timeout: 2000, interval: 5 });
    return operationQueue.peek(50);
}

/** @param {Array<Object>} fila @returns {Array<number>} Indices of membership ops. */
const indicesDeMembresia = (fila) => fila
    .map((op, i) => (op.entityType === EntityType.GROUP_FEATURE ? i : -1))
    .filter((i) => i !== -1);

let gm;
let relogio;

beforeEach(() => {
    mockStore.clear();
    h.memoryStore.currentMap = 'Mapa Fila';
    h.memoryStore.groups = {};
    // Um milissegundo so' para todas as ops: e' a pre-condicao do desempate.
    relogio = vi.spyOn(Date, 'now').mockReturnValue(RELOGIO_FIXO);
    enableOperationLogging();
    gm = createGroupManager({ emit: vi.fn() });
});

afterEach(() => {
    disableOperationLogging();
    relogio.mockRestore();
});

describe('ordem de SAIDA da fila: o grupo antes da membresia dele', () => {
    it('CONTROLE: o adversario esta mesmo montado (UUID decrescente, relogio fixo)', async () => {
        // O teste do teste, e ele roda PRIMEIRO. Se o duble de UUID voltar a ser crescente,
        // os casos abaixo passam por acidente e param de medir o desempate.
        gm.createGroup([pt('x'), pt('y')], 'Mapa Fila');
        const fila = await esperarFila(3);

        const grupo = fila.find((op) => op.entityType === EntityType.GROUP);
        const membros = fila.filter((op) => op.entityType === EntityType.GROUP_FEATURE);
        expect(grupo, 'a op do grupo nao chegou a fila').toBeTruthy();
        expect(membros).toHaveLength(2);
        for (const m of membros) {
            expect(
                grupo.id > m.id,
                'o duble de UUID deixou de ser decrescente: a op do grupo precisa carregar o'
                + ' MAIOR id para que a chave antiga a mande ao fim da fila deterministicamente',
            ).toBe(true);
        }
    });

    it('createGroup com 3 feicoes: a op do grupo sai antes das tres de membresia', async () => {
        gm.createGroup([pt('f1'), pt('f2'), pt('f3')], 'Mapa Fila');

        const fila = await esperarFila(4);
        expect(fila).toHaveLength(4);
        expect(
            new Set(fila.map((op) => op.timestamp)).size,
            'as ops cairam em milissegundos diferentes: o desempate da chave nao foi exercitado',
        ).toBe(1);

        const iGrupo = fila.findIndex(
            (op) => op.entityType === EntityType.GROUP && op.operationType === OperationType.CREATE,
        );
        const iMembros = indicesDeMembresia(fila);

        expect(iGrupo, 'a op de create do grupo nao esta na fila').toBeGreaterThanOrEqual(0);
        expect(iMembros, 'faltam ops de membresia na fila').toHaveLength(3);

        expect(
            iGrupo,
            'a op do GRUPO sai depois de pelo menos uma op de MEMBRESIA. O INSERT da tabela de'
            + ' juncao e gateado por EXISTS sobre a linha do grupo, entao a membresia que chega'
            + ' primeiro escreve ZERO linhas e volta acked como SUCESSO: o grupo aparece sem'
            + ' membro nenhum no snapshot, sem erro em lugar nenhum. A causa e a chave da fila'
            + ' (`_buildKey`), que com timestamps iguais desempata pelo UUID, que e aleatorio.'
            + ` Ordem observada: ${fila.map((op) => op.entityType).join(' -> ')}`,
        ).toBeLessThan(Math.min(...iMembros));
    });

    it('combineGroups: a op do grupo NOVO sai antes da membresia dele', async () => {
        const g1 = gm.createGroup([pt('a'), pt('b')], 'Mapa Fila');
        const g2 = gm.createGroup([pt('c'), pt('d')], 'Mapa Fila');
        await esperarFila(6);
        mockStore.clear();

        const combinado = gm.combineGroups([g1.id, g2.id], [], 'Mapa Fila');

        // 2 deletes dos grupos antigos + 1 create do novo + 4 membresias.
        const fila = await esperarFila(7);
        expect(new Set(fila.map((op) => op.timestamp)).size).toBe(1);

        const iNovo = fila.findIndex(
            (op) => op.entityType === EntityType.GROUP
                && op.operationType === OperationType.CREATE
                && op.entityId === combinado.id,
        );
        const iMembros = indicesDeMembresia(fila);

        expect(iNovo, 'a op de create do grupo combinado nao esta na fila').toBeGreaterThanOrEqual(0);
        expect(iMembros).toHaveLength(4);
        expect(
            iNovo,
            'a op do grupo combinado sai depois da membresia dele; mesma causa e mesmo efeito'
            + ` do caso anterior. Ordem observada: ${fila.map((op) => op.entityType).join(' -> ')}`,
        ).toBeLessThan(Math.min(...iMembros));
    });
});

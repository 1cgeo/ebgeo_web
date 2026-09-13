// Path: tests/integration/desfazer-falha-parcial.test.js

/**
 * @fileoverview DESFAZER É UM COMANDO NOVO, E ELE FALHA INTEIRO OU NÃO FALHA.
 *
 * AS PROVAS QUE O ACEITE PEDE (item 4 de "O que segue aberto" em
 * `docs/reviews/fechamento/04-comandos-compostos.md`). Os fluxos normais de desfazer e refazer já
 * estavam aprovados; o que faltava era o que acontece quando o servidor recusa NO MEIO de um
 * conjunto. Um desfazer de colagem inverte N feições, cada inversão é uma transação (as folhas
 * tomam a trava do documento na sua chave, e aquela fila é FIFO sem reentrância), e antes do lote
 * lógico o servidor via N comandos independentes: aplicava alguns e recusava outros, deixando
 * meia colagem desfeita sem que nenhum dos dois lados pudesse nomear o estado.
 *
 * TRÊS FALHAS, e as três são medidas contra a FILA e o MOTOR reais, com só o transporte dublado:
 *
 *   1. a recusa no PRIMEIRO, no INTERMEDIÁRIO e no ÚLTIMO elemento tem o mesmo desfecho, e é essa
 *      indiferença à posição que o savepoint do servidor compra. Nada é desenfileirado e as N ops
 *      viram problema durável, com a culpada nomeada;
 *   2. a resposta PERDIDA depois do commit (prazo estourado, requisição abortada) não é recusa:
 *      os envelopes ficam, com os MESMOS ids, e o reenvio é idempotente pelo recibo do `op_id`;
 *   3. o F5 no meio do caminho não perde nem duplica: as intenções são duráveis, e uma sessão
 *      nova lê os mesmos ids e o mesmo `batchId`.
 *
 * O QUE ESTE ARQUIVO NÃO MEDE, dito para não ser lido como cobertura: que o `undoLastAction`
 * chame `withGestureBatch` (isso é `tests/store/undo-redo.test.js`), e o comportamento do
 * servidor diante do lote (é `backend/tests/integration/lote-logico-atomico.repro.test.js`).
 */

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
    apiClient: {
        getSyncProtocol: vi.fn(async () => ({ writeVersions: [2], receiptLookup: true })),
        lookupOperationReceipts: vi.fn(async () => ({})),
        pushOperations: vi.fn(),
        pullSync: vi.fn(async () => ({ currentVersion: 0 })),
    },
    wsClient: { on: vi.fn(), disconnect: vi.fn(), setLastVersion: vi.fn(), connect: vi.fn() },
    showWarning: vi.fn(),
}));

vi.mock('../../src/js/store/sync/api-client.js', () => ({
    apiClient: h.apiClient, configureApiClient: vi.fn(),
}));
vi.mock('../../src/js/store/sync/ws-client.js', () => ({ wsClient: h.wsClient }));
vi.mock('../../src/js/utilities/toast_service.js', () => ({
    showWarning: h.showWarning, showToast: vi.fn(), showError: vi.fn(),
    showSuccess: vi.fn(), showInChannel: vi.fn(),
}));
vi.mock('../../src/js/store/services.js', () => ({
    getEventBus: () => ({ emit: vi.fn(), on: vi.fn(), off: vi.fn() }),
}));
vi.mock('../../src/js/store/sync/resource-access.service.js', () => ({
    refreshVisibleResources: vi.fn(async () => true), clearVisibleResources: vi.fn(),
}));
// A APLICAÇÃO LOCAL DO QUE VOLTA é de outro arquivo; aqui o que se mede é o envelope e a fila.
// `CONVERGENCE_GUARDED` vem do módulo REAL de propósito: uma cópia à mão deixaria de acompanhar
// a de produção sem ficar vermelha.
vi.mock('../../src/js/store/sync/remote-operation-handler.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        applyRemoteOperation: vi.fn(async () => {}),
        applyRemoteSnapshot: vi.fn(async () => {}),
        setRemoteHandlerEventBus: vi.fn(),
        recordLocalAppliedVersion: vi.fn(async () => {}),
        reconcilePendingLocalEdits: vi.fn(async () => {}),
        confirmEntityVersion: vi.fn(async () => {}),
        applyMapCreationAck: vi.fn(async () => {}),
        markLocalEditPending: vi.fn(),
        hasPendingLocalEdits: vi.fn(() => false),
    };
});

import { activateScope, getStoreFor, remoteScope, StoreName } from '../../src/js/store/atlas-namespace.js';
import {
    persistOperationIntents, enableOperationLogging, disableOperationLogging,
} from '../../src/js/store/sync/operation-dispatcher.js';
import { OperationQueue } from '../../src/js/store/sync/operation-queue.js';
import { withGestureBatch } from '../../src/js/store/sync/gesture-batch.js';
import { syncEngine } from '../../src/js/store/sync/sync-engine.js';
import { IssueClass, classifyIssue } from '../../src/js/store/sync/issue-classes.js';

const MAP_ID = '77777777-7777-4777-8777-777777777777';
const ATLAS_ID = '33333333-3333-4333-8333-333333333333';

let scope;
let queue;

/**
 * O desfazer de uma colagem de três feições, na forma que o cliente emite: um gesto, três
 * transações, cada uma removendo uma feição.
 * @param {string[]} ids - As feições a remover.
 * @returns {Promise<void>}
 */
async function desfazerColagem(ids) {
    await withGestureBatch(async () => {
        for (const id of ids) {
            const materializar = await persistOperationIntents([{
                entityType: 'feature', operationType: 'delete', entityId: id, mapId: MAP_ID,
                data: null, previousData: { type: 'Feature', properties: { id, source: 'point' } },
            }], { scope, traceId: 'desfazer' });
            await materializar();
        }
    });
}

/**
 * A resposta de um servidor que recusou o lote inteiro por causa de UM membro.
 * @param {Object[]} ops - As operações enviadas.
 * @param {number} culpadaIndex - A posição da culpada.
 * @returns {Object} A resposta de push.
 */
function loteRecusado(ops, culpadaIndex) {
    const culpada = ops[culpadaIndex];
    return {
        results: ops.map(op => ({
            operationId: op.id, rejected: true, status: 'conflict',
            reason: 'A feição foi alterada por outro usuário desde a base declarada.',
            batchId: op.batchId, batchFailedOperationId: culpada.id,
            ...(op.id === culpada.id ? { conflict: { fields: ['geometry'] } } : {}),
        })),
        serverVersion: 9,
    };
}

/** Uma sessão mínima apontando para a fila REAL do escopo montado. */
function sessaoReal() {
    return {
        atlasId: ATLAS_ID, scope, queue, legacyReviewed: true, protocolReady: true,
        flushPromise: null, recovering: false,
        signal: new AbortController().signal,
        assertActive: () => {}, close: () => {},
    };
}

beforeEach(async () => {
    vi.clearAllMocks();
    h.apiClient.getSyncProtocol.mockResolvedValue({ writeVersions: [2], receiptLookup: true });
    h.apiClient.pullSync.mockResolvedValue({ currentVersion: 0 });
    scope = remoteScope(ATLAS_ID);
    activateScope(scope);
    await getStoreFor(StoreName.OPERATION_QUEUE, scope).clear();
    enableOperationLogging();
    queue = new OperationQueue(scope);
    syncEngine._atlasId = ATLAS_ID;
    syncEngine._session = sessaoReal();
});

afterEach(() => {
    disableOperationLogging();
    syncEngine._session = null;
    syncEngine._atlasId = null;
});

describe('O desfazer falha inteiro, seja qual for o elemento que o servidor recusa', () => {
    it.each([
        ['primeiro', 0],
        ['intermediário', 1],
        ['último', 2],
    ])('recusa no %s elemento: nada aplicado, três problemas, a culpada nomeada', async (_rotulo, posicao) => {
        await desfazerColagem(['f-1', 'f-2', 'f-3']);
        const enfileiradas = await queue.peek(25);
        expect(enfileiradas).toHaveLength(3);
        expect(new Set(enfileiradas.map(op => op.batchId)).size).toBe(1);

        h.apiClient.pushOperations.mockImplementationOnce(async (_atlas, ops) => loteRecusado(ops, posicao));
        await syncEngine.flush();

        // NADA APLICADO: os três envelopes continuam no disco, byte a byte.
        const noDisco = await queue.getAll();
        expect(noDisco.map(op => op.id)).toEqual(enfileiradas.map(op => op.id));
        // TRÊS PROBLEMAS, e não um: o gesto inteiro voltou.
        const problemas = await queue.getProblems();
        expect(problemas).toHaveLength(3);
        expect(problemas.every(p => p.classe === IssueClass.CONFLITO)).toBe(true);
        expect(new Set(problemas.map(p => p.result.batchFailedOperationId)))
            .toEqual(new Set([enfileiradas[posicao].id]));
        // E nada disso é enviável: a próxima rodada não reenvia meio gesto.
        expect(await queue.peek(25)).toEqual([]);
        expect(await queue.countByState()).toEqual({ pendentes: 0, preparadas: 0, problemas: 3 });
    });

    it('CONTROLE POSITIVO: aceito, o mesmo gesto sai inteiro e não deixa problema', async () => {
        await desfazerColagem(['f-1', 'f-2', 'f-3']);
        h.apiClient.pushOperations.mockImplementationOnce(async (_atlas, ops) => ({
            results: ops.map(op => ({ operationId: op.id, success: true, currentVersion: 9 })),
            serverVersion: 9,
        }));

        const resultado = await syncEngine.flush();

        expect(resultado).toEqual({ pushed: 3 });
        expect(await queue.getAll()).toEqual([]);
        expect(await queue.getProblems()).toEqual([]);
        // UM push só: o recorte não partiu o gesto.
        expect(h.apiClient.pushOperations.mock.calls).toHaveLength(1);
    });
});

describe('Resposta perdida depois do commit não é recusa', () => {
    it.each([
        ['prazo estourado', Object.assign(new Error('Tempo de espera esgotado.'), { code: 'REQUEST_TIMEOUT' })],
        ['requisição abortada', Object.assign(new Error('Request cancelled'), { name: 'AbortError' })],
    ])('%s: os MESMOS envelopes ficam, e o reenvio é idempotente pelo recibo', async (_rotulo, erro) => {
        await desfazerColagem(['f-1', 'f-2', 'f-3']);
        const antes = await queue.getAll();
        h.apiClient.pushOperations.mockRejectedValueOnce(erro);

        await expect(syncEngine.flush()).rejects.toBe(erro);

        // Não houve recusa, houve silêncio: nada é descartado e nada vira problema.
        expect(await queue.getAll()).toEqual(antes);
        expect(await queue.getProblems()).toEqual([]);

        // O REENVIO É O MESMO GESTO. O servidor já tinha aplicado, então responde idempotente;
        // é o `op_id` que torna isso possível, e cunhar id novo pediria dupla aplicação.
        syncEngine._session = sessaoReal();
        h.apiClient.pushOperations.mockImplementationOnce(async (_atlas, ops) => ({
            results: ops.map(op => ({ operationId: op.id, success: true, idempotent: true, currentVersion: 9 })),
            serverVersion: 9,
        }));
        await syncEngine.flush();

        const reenviadas = h.apiClient.pushOperations.mock.calls[1][1];
        expect(reenviadas.map(op => op.id)).toEqual(antes.map(op => op.id));
        expect(new Set(reenviadas.map(op => op.batchId)).size).toBe(1);
        expect(await queue.getAll()).toEqual([]);
    });
});

describe('O F5 no meio do caminho', () => {
    it('repetir o comando depois do recarregamento lê as MESMAS intenções, com os mesmos ids', async () => {
        await desfazerColagem(['f-1', 'f-2', 'f-3']);
        const antesDoF5 = await queue.getAll();

        // O F5: a memória do processo some (o gesto ambiente inclusive) e uma sessão nova monta o
        // MESMO escopo. Só a fila é durável, e é por isso que ela é o assunto.
        syncEngine._session = null;
        const depoisDoF5 = new OperationQueue(remoteScope(ATLAS_ID));

        expect((await depoisDoF5.getAll()).map(op => ({ id: op.id, batchId: op.batchId, entityId: op.entityId })))
            .toEqual(antesDoF5.map(op => ({ id: op.id, batchId: op.batchId, entityId: op.entityId })));
        // E elas continuam ENVIÁVEIS: o gesto fechou antes do recarregamento, então nada as segura.
        expect((await depoisDoF5.peek(25)).map(op => op.id)).toEqual(antesDoF5.map(op => op.id));

        queue = depoisDoF5;
        syncEngine._session = sessaoReal();
        h.apiClient.pushOperations.mockImplementationOnce(async (_atlas, ops) => ({
            results: ops.map(op => ({ operationId: op.id, success: true, currentVersion: 9 })),
            serverVersion: 9,
        }));
        await syncEngine.flush();

        expect(h.apiClient.pushOperations.mock.calls[0][1].map(op => op.id))
            .toEqual(antesDoF5.map(op => op.id));
        expect(await depoisDoF5.getAll()).toEqual([]);
    });

    it('a intenção NÃO materializada não sai, e o recarregamento não a perde', async () => {
        // A janela é a do F5 entre escrever a intenção e confirmar a projeção local. A intenção é
        // durável (é o ponto do diário), mas não é enviável enquanto a projeção não existir: o
        // servidor receberia uma remoção que esta máquina não fez.
        await persistOperationIntents([{
            entityType: 'feature', operationType: 'delete', entityId: 'f-1', mapId: MAP_ID,
            data: null, previousData: { type: 'Feature', properties: { id: 'f-1', source: 'point' } },
        }], { scope, traceId: 'desfazer' });

        const depoisDoF5 = new OperationQueue(remoteScope(ATLAS_ID));
        expect(await depoisDoF5.getAll()).toHaveLength(1);
        expect(await depoisDoF5.peek(25)).toEqual([]);
        expect(await depoisDoF5.countByState()).toEqual({ pendentes: 0, preparadas: 1, problemas: 0 });
    });
});

describe('A classe do problema sobrevive ao recarregamento', () => {
    it('o recibo guardado ainda diz DISPUTA, e não recusa de política', async () => {
        await desfazerColagem(['f-1', 'f-2']);
        h.apiClient.pushOperations.mockImplementationOnce(async (_atlas, ops) => loteRecusado(ops, 1));
        await syncEngine.flush();

        const depoisDoF5 = new OperationQueue(remoteScope(ATLAS_ID));
        const guardados = await depoisDoF5.getIssues();
        expect(guardados).toHaveLength(2);
        for (const guardado of guardados) {
            expect(classifyIssue(guardado.result)).toBe(IssueClass.CONFLITO);
            expect(guardado.result.batchFailedOperationId).toBeTruthy();
        }
    });
});

// Path: tests/integration/lote-partido.repro.test.js
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { activateScope, getStoreFor, remoteScope, StoreName } from '../../src/js/store/atlas-namespace.js';
import {
    persistOperationIntents,
    enableOperationLogging,
    disableOperationLogging,
} from '../../src/js/store/sync/operation-dispatcher.js';
import { OperationQueue } from '../../src/js/store/sync/operation-queue.js';
import { withGestureBatch, GESTURE_PART_SIZE } from '../../src/js/store/sync/gesture-batch.js';
import { MAX_OPS_PER_LOGICAL_BATCH, describeRefusedPart } from '../../src/js/store/sync/operation-factory.js';

/**
 * @fileoverview B6.1 (decisao do dono, 2026-09-24): nenhum gesto deixa de chegar ao servidor por ter
 * operacoes demais.
 *
 * O DEFEITO. Uma transacao, ou um gesto ambiente, era UM lote logico, e o servidor recusa inteiro o
 * lote acima de `LOTE_MAX_OPS` (200): importar, colar, mover para camada, agrupar, transferir uma
 * camada e desfazer qualquer um deles, acima de 200, nunca chegavam ao servidor.
 *
 * O QUE ESTE ARQUIVO PRENDE. Acima do teto o lote parte em blocos de ate 200, na ordem do
 * `batchIndex` (continuo), e a primeira op de cada bloco depende (`dependsOn`) da ultima do bloco
 * anterior. E esse elo que faz a fila SEGURAR os blocos seguintes quando um bloco fica com problema:
 * um membro de grupo nunca sai antes do grupo, e o aviso diz quantas alteracoes ja chegaram.
 */

const MAP_ID = '77777777-7777-4777-8777-777777777777';

let scope;
let queue;

function criacao(entityId, extra = {}) {
    return {
        entityType: 'feature', operationType: 'create', entityId, mapId: MAP_ID,
        data: { type: 'Feature', properties: { id: entityId, source: 'point' } }, previousData: null,
        ...extra,
    };
}

async function transacao(descricoes) {
    const materializar = await persistOperationIntents(descricoes, { scope, traceId: 'gesto-grande' });
    await materializar();
}

const lotes = (ops) => [...new Set(ops.map((op) => op.batchId))];
const tamanhos = (ops) => lotes(ops).map((id) => ops.filter((op) => op.batchId === id).length);

/**
 * Asserts the chain: EVERY op of every part after the first depends on the last op of the previous
 * one (not only the first: the pending list and "Aceitar o servidor" read the link, not the batch).
 */
function afirmarEncadeado(ops) {
    const ids = lotes(ops);
    for (let k = 1; k < ids.length; k++) {
        const ultima = ops.filter((op) => op.batchId === ids[k - 1]).at(-1).id;
        const membros = ops.filter((op) => op.batchId === ids[k]);
        expect(membros.filter((op) => !(op.dependsOn ?? []).includes(ultima)).map((op) => op.id),
            `toda op da parte ${k + 1} depende da ultima da ${k}`).toEqual([]);
    }
}

beforeEach(async () => {
    scope = remoteScope(crypto.randomUUID());
    activateScope(scope);
    await getStoreFor(StoreName.OPERATION_QUEUE, scope).clear();
    enableOperationLogging();
    queue = new OperationQueue(scope);
});

afterEach(() => disableOperationLogging());

describe('o espelho do teto do servidor', () => {
    it('o tamanho da parte de gesto e o mesmo', () => {
        expect(GESTURE_PART_SIZE).toBe(MAX_OPS_PER_LOGICAL_BATCH);
    });

    it('MAX_OPS_PER_LOGICAL_BATCH e o LOTE_MAX_OPS do backend', () => {
        const fonte = readFileSync(new URL('../../../backend/src/modules/sync/sync.service.js', import.meta.url), 'utf8');
        const [, valor] = fonte.match(/export const LOTE_MAX_OPS = (\d+);/) ?? [];
        expect(Number(valor)).toBe(MAX_OPS_PER_LOGICAL_BATCH);
    });
});

describe('uma transacao acima do teto', () => {
    it('450 criacoes viram 200 + 200 + 50, encadeadas, e o envio leva a primeira parte sozinha', async () => {
        await transacao(Array.from({ length: 450 }, (_, i) => criacao(`f${i}`)));
        const ops = await queue.getAll();
        expect(tamanhos(ops)).toEqual([200, 200, 50]);
        expect(ops.map((op) => op.batchIndex)).toEqual(Array.from({ length: 450 }, (_, i) => i));
        afirmarEncadeado(ops);
        const primeiro = await queue.peek(25);
        expect(primeiro).toHaveLength(200);
        expect(lotes(primeiro)).toEqual([lotes(ops)[0]]);
    });

    it('200 cabem num lote so, sem elo; 201 partem', async () => {
        await transacao(Array.from({ length: 200 }, (_, i) => criacao(`a${i}`)));
        const ate200 = await queue.getAll();
        expect(tamanhos(ate200)).toEqual([200]);
        expect(ate200.some((op) => op.dependsOn)).toBe(false);
        await queue.clear();
        await transacao(Array.from({ length: 201 }, (_, i) => criacao(`b${i}`)));
        const ops = await queue.getAll();
        expect(tamanhos(ops)).toEqual([200, 1]);
        afirmarEncadeado(ops);
    });

    it('um grupo de 500 membros: o grupo no primeiro bloco, os membros na ordem, encadeados', async () => {
        const grupo = { entityType: 'group', operationType: 'create', entityId: 'grupo-1', mapId: MAP_ID,
            data: { name: 'G', features: [] } };
        const membros = Array.from({ length: 500 }, (_, i) => ({ entityType: 'group_feature', operationType: 'create',
            entityId: `m${i}`, mapId: MAP_ID, data: { group_id: 'grupo-1', feature_id: `f${i}`, feature_type: 'point' } }));
        await transacao([grupo, ...membros]);
        const ops = await queue.getAll();
        expect(tamanhos(ops)).toEqual([200, 200, 101]);
        expect(ops[0].entityType).toBe('group');
        afirmarEncadeado(ops);
    });
});

describe('um gesto acima do teto (transferir, desfazer, refazer)', () => {
    it('250 transacoes de 1 dentro de um gesto viram 200 + 50, encadeadas, indice continuo', async () => {
        await withGestureBatch(async () => {
            for (let i = 0; i < 250; i++) await transacao([{ ...criacao(`g${i}`), operationType: 'delete' }]);
        });
        const ops = await queue.getAll();
        expect(tamanhos(ops)).toEqual([200, 50]);
        expect(ops.map((op) => op.batchIndex)).toEqual(Array.from({ length: 250 }, (_, i) => i));
        afirmarEncadeado(ops);
    });

    it('uma transacao que atravessa a fronteira fica nos dois blocos, com o elo no meio dela', async () => {
        await withGestureBatch(async () => {
            for (let i = 0; i < 199; i++) await transacao([{ ...criacao(`b${i}`), operationType: 'delete' }]);
            await transacao(['c1', 'c2', 'c3'].map((id) => ({ ...criacao(id), operationType: 'delete' })));
        });
        const ops = await queue.getAll();
        expect(tamanhos(ops)).toEqual([200, 2]);
        afirmarEncadeado(ops);
    });

    it('um gesto que cabe continua UM lote, sem elo nenhum', async () => {
        await withGestureBatch(async () => {
            for (let i = 0; i < 150; i++) await transacao([criacao(`h${i}`)]);
        });
        const ops = await queue.getAll();
        expect(tamanhos(ops)).toEqual([150]);
        expect(ops.some((op) => op.dependsOn)).toBe(false);
    });

    it('um gesto de 1000 com uma transacao de 999 dentro (transferir camada) vira 5 blocos encadeados', async () => {
        await withGestureBatch(async () => {
            await transacao([{ entityType: 'layer', operationType: 'create', entityId: 'camada-1', mapId: MAP_ID,
                data: { name: 'Destino' } }]);
            await transacao(Array.from({ length: 999 }, (_, i) => criacao(`t${i}`)));
        });
        const ops = await queue.getAll();
        expect(tamanhos(ops)).toEqual([200, 200, 200, 200, 200]);
        expect(ops[0].entityType).toBe('layer');
        afirmarEncadeado(ops);
    });
});

describe('um bloco com problema SEGURA os seguintes', () => {
    it('recusa do primeiro bloco: nada mais sai, e tudo conta como problema', async () => {
        await transacao(Array.from({ length: 450 }, (_, i) => criacao(`r${i}`)));
        const ops = await queue.getAll();
        await queue.recordIssue(ops[5], { rejected: true, reason: 'O mapa está bloqueado' });
        expect(await queue.peek(25)).toEqual([]);
        expect(await queue.countByState()).toEqual({ pendentes: 0, preparadas: 0, problemas: 450 });
    });

    it('recusa do segundo bloco: o primeiro sai, o segundo e o terceiro ficam', async () => {
        await transacao(Array.from({ length: 450 }, (_, i) => criacao(`s${i}`)));
        const ops = await queue.getAll();
        await queue.recordIssue(ops[250], { rejected: true, reason: 'O mapa está bloqueado' });
        const primeiro = await queue.peek(25);
        expect(primeiro.map((op) => op.id)).toEqual(ops.slice(0, 200).map((op) => op.id));
        await queue.dequeue(primeiro.map((op) => op.id));
        expect(await queue.peek(25)).toEqual([]);
        expect(await queue.countByState()).toEqual({ pendentes: 0, preparadas: 0, problemas: 250 });
    });

    it('CONTROLE: sem o elo, o bloco seguinte a um recusado sairia', async () => {
        await transacao(Array.from({ length: 450 }, (_, i) => criacao(`u${i}`)));
        const store = getStoreFor(StoreName.OPERATION_QUEUE, scope);
        const ops = await queue.getAll();
        // Apaga os elos direto no disco e mostra que e o elo, e nada mais, que segura.
        for (const key of (await store.keys()).filter((k) => k.startsWith('op_'))) {
            const op = await store.getItem(key);
            if (op?.dependsOn) {
                const { dependsOn: _elo, ...semElo } = op;
                await store.setItem(key, semElo);
            }
        }
        await queue.recordIssue(ops[5], { rejected: true, reason: 'O mapa está bloqueado' });
        expect((await queue.peek(25)).length).toBeGreaterThan(0);
    });

    it('o encadeamento de edicao do mesmo autor soma ao elo entre blocos, sem apagar', async () => {
        await transacao([{ ...criacao('x200'), operationType: 'update', baseVersion: 1 }]);
        const anterior = (await queue.getAll())[0];
        await transacao(Array.from({ length: 250 }, (_, i) => ({ ...criacao(`x${i}`), operationType: 'update', baseVersion: 1 })));
        const ops = (await queue.getAll()).filter((op) => op.id !== anterior.id);
        const primeiraDaParte2 = ops[200];
        expect(primeiraDaParte2.entityId).toBe('x200');
        expect(primeiraDaParte2.dependsOn).toContain(anterior.id);
        expect(primeiraDaParte2.dependsOn).toContain(ops[199].id);
    });
});

describe('a frase da parte recusada', () => {
    /** Builds the ops of one part, the first chained to `anterior` (the last op of the previous part). */
    const parte = (inicio, fim, batchId, anterior = null) => Array.from({ length: fim - inicio }, (_, k) => ({
        id: `op${inicio + k}`, batchId, batchIndex: inicio + k,
        ...(k === 0 && anterior ? { dependsOn: [anterior] } : {}),
    }));

    it('lote que nao e parte de nada: sem frase', () => {
        expect(describeRefusedPart(parte(0, 30, 'A'), parte(0, 30, 'A'))).toBeNull();
    });

    it('parte 2 de 3 recusada: a 1 chegou, a 2 e a 3 ficam', () => {
        const recusada = parte(200, 400, 'B', 'op199');
        const fila = [...recusada, ...parte(400, 450, 'C', 'op399')];
        expect(describeRefusedPart(recusada, fila)).toBe(
            'O servidor recusou a parte 2 de 3 desta ação. 200 de 450 alterações já chegaram; '
            + 'as outras 250 estão nas pendências para revisão.');
    });

    it('parte 1 recusada: nada chegou ainda, e as seguintes contam', () => {
        const recusada = parte(0, 200, 'A');
        const fila = [...recusada, ...parte(200, 400, 'B', 'op199'), ...parte(400, 450, 'C', 'op399')];
        expect(describeRefusedPart(recusada, fila))
            .toBe('O servidor recusou a parte 1 de 3 desta ação. 0 de 450 alterações já chegaram; '
                + 'as outras 450 estão nas pendências para revisão.');
    });

    it('a ultima parte recusada com as anteriores entregues', () => {
        expect(describeRefusedPart(parte(400, 450, 'C', 'op399'), parte(400, 450, 'C', 'op399')))
            .toContain('parte 3 de 3 desta ação. 400 de 450 alterações já chegaram; as outras 50');
    });

    it('um lote alheio na fila, sem elo, nao entra na conta', () => {
        const recusada = parte(200, 400, 'B', 'op199');
        const alheio = Array.from({ length: 30 }, (_, k) => ({ id: `z${k}`, batchId: 'Z', batchIndex: k }));
        expect(describeRefusedPart(recusada, [...recusada, ...alheio])).toContain('200 de 400 alterações');
    });
});

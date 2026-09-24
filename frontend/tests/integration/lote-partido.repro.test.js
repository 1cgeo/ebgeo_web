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
import { isSameVerbOverDistinctFeatures } from '../../src/js/store/store-state-manager.js';
import {
    MAX_OPS_PER_LOGICAL_BATCH,
    isIndependentFeatureSet,
    describeRefusedPart,
} from '../../src/js/store/sync/operation-factory.js';

/**
 * @fileoverview B6.1 (owner decision, 2026-09-24): importar, colar ou processar mais de 200 feicoes
 * num atlas de servidor.
 *
 * O DEFEITO. Uma transacao e UM lote logico, e o servidor recusa inteiro o lote acima de
 * `LOTE_MAX_OPS` (200). `addFeatures` grava o import inteiro numa transacao, entao 201 feicoes ou
 * mais nunca chegavam ao servidor: o flush as recusava localmente, todas viravam problema duravel
 * e o colega nunca via o import. O recorte proposto: so CRIACOES de feicao independentes, fora de
 * gesto aberto, partidas em lotes de ate 200, com o `batchIndex` continuo entre as partes.
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

describe('uma transacao de criacoes independentes acima do teto', () => {
    it('450 criacoes viram tres lotes (200, 200, 50) com o indice continuo, e o flush envia cada um', async () => {
        await transacao(Array.from({ length: 450 }, (_, i) => criacao(`f${i}`)));
        const ops = await queue.getAll();
        const ids = lotes(ops);
        expect(ids).toHaveLength(3);
        expect(ids.map((id) => ops.filter((op) => op.batchId === id).length)).toEqual([200, 200, 50]);
        expect(ops.map((op) => op.batchIndex)).toEqual(Array.from({ length: 450 }, (_, i) => i));

        // O recorte do envio respeita cada parte: o primeiro lote vai inteiro e sozinho.
        const primeiro = await queue.peek(25);
        expect(primeiro).toHaveLength(200);
        expect(lotes(primeiro)).toEqual([ids[0]]);
    });

    it('200 cabem num lote so, e 201 ja partem', async () => {
        await transacao(Array.from({ length: 200 }, (_, i) => criacao(`a${i}`)));
        expect(lotes(await queue.getAll())).toHaveLength(1);
        await queue.clear();
        await transacao(Array.from({ length: 201 }, (_, i) => criacao(`b${i}`)));
        const ops = await queue.getAll();
        expect(lotes(ops).map((id) => ops.filter((op) => op.batchId === id).length)).toEqual([200, 1]);
    });

    it('o gesto composto continua UM lote, mesmo acima do teto', async () => {
        await withGestureBatch(async () => {
            await transacao(Array.from({ length: 250 }, (_, i) => criacao(`g${i}`)));
        });
        expect(lotes(await queue.getAll())).toHaveLength(1);
    });

    it('uma transacao com qualquer coisa alem de criacao de feicao nao parte', async () => {
        const descricoes = Array.from({ length: 250 }, (_, i) => criacao(`m${i}`));
        descricoes.push({ ...criacao('m-upd'), operationType: 'update' });
        await transacao(descricoes);
        expect(lotes(await queue.getAll())).toHaveLength(1);
    });

    it('a criacao com intencao de mover nao parte', () => {
        const ops = Array.from({ length: 250 }, (_, i) => criacao(`t${i}`, { featureIntent: { kind: 'move' } }));
        expect(isIndependentFeatureSet(ops)).toBe(false);
        expect(isIndependentFeatureSet(Array.from({ length: 250 }, (_, i) => criacao(`u${i}`)))).toBe(true);
    });
});

describe('o mesmo verbo sobre feicoes distintas (atualizacoes, exclusoes, gestos)', () => {
    const atualizacao = (id) => ({ ...criacao(id), operationType: 'update' });

    it('250 atualizacoes numa transacao (mover para camada) viram 200 + 50', async () => {
        await transacao(Array.from({ length: 250 }, (_, i) => atualizacao(`v${i}`)));
        const ops = await queue.getAll();
        expect(lotes(ops).map((id) => ops.filter((op) => op.batchId === id).length)).toEqual([200, 50]);
    });

    it('verbos misturados ou a mesma feicao duas vezes nao partem', () => {
        const misto = Array.from({ length: 250 }, (_, i) => (i === 249 ? atualizacao(`x${i}`) : criacao(`x${i}`)));
        expect(isIndependentFeatureSet(misto)).toBe(false);
        const repetida = Array.from({ length: 250 }, (_, i) => atualizacao(i === 249 ? 'x0' : `x${i}`));
        expect(isIndependentFeatureSet(repetida)).toBe(false);
        const exclusoes = Array.from({ length: 250 }, (_, i) => ({ ...criacao(`d${i}`), operationType: 'delete' }));
        expect(isIndependentFeatureSet(exclusoes)).toBe(true);
    });

    it('um gesto DIVISIVEL (desfazer em massa) parte em 200, uma transacao por membro', async () => {
        await withGestureBatch(async () => {
            for (let i = 0; i < 250; i++) await transacao([{ ...criacao(`g${i}`), operationType: 'delete' }]);
        }, { splittable: true });
        const ops = await queue.getAll();
        expect(lotes(ops).map((id) => ops.filter((op) => op.batchId === id).length)).toEqual([200, 50]);
        expect(ops.map((op) => op.batchIndex)).toEqual(Array.from({ length: 250 }, (_, i) => i));
    });

    it('uma transacao do gesto divisivel nunca fica partida entre duas partes', async () => {
        // 199 transacoes de 1 e depois uma de 3 (uma exclusao que tambem apaga membresias): a de 3
        // comecaria em 199 e atravessaria a fronteira, entao ela abre a parte seguinte inteira.
        await withGestureBatch(async () => {
            for (let i = 0; i < 199; i++) await transacao([{ ...criacao(`b${i}`), operationType: 'delete' }]);
            await transacao(['c1', 'c2', 'c3'].map((id) => ({ ...criacao(id), operationType: 'delete' })));
        }, { splittable: true });
        const ops = await queue.getAll();
        const tresId = ops.find((op) => op.entityId === 'c1').batchId;
        expect(ops.filter((op) => op.batchId === tresId).map((op) => op.entityId)).toEqual(['c1', 'c2', 'c3']);
        expect(lotes(ops).map((id) => ops.filter((op) => op.batchId === id).length)).toEqual([199, 3]);
        expect(ops.filter((op) => op.batchId === tresId).map((op) => op.batchIndex)).toEqual([200, 201, 202]);
    });

    it('o gesto composto (sem a declaracao) continua um lote so', async () => {
        await withGestureBatch(async () => {
            for (let i = 0; i < 250; i++) await transacao([{ ...criacao(`h${i}`), operationType: 'delete' }]);
        });
        expect(lotes(await queue.getAll())).toHaveLength(1);
    });

    it('um gesto de dentro nao declarado desliga a divisao do de fora', async () => {
        await withGestureBatch(async () => {
            await withGestureBatch(async () => {
                for (let i = 0; i < 250; i++) await transacao([{ ...criacao(`k${i}`), operationType: 'delete' }]);
            });
        }, { splittable: true });
        expect(lotes(await queue.getAll())).toHaveLength(1);
    });

    it('quais entradas do desfazer sao o mesmo verbo sobre feicoes distintas', () => {
        const f = (id) => ({ properties: { id } });
        expect(isSameVerbOverDistinctFeatures({ type: 'addMultiple', features: {} })).toBe(true);
        expect(isSameVerbOverDistinctFeatures({ type: 'batch', operations: [
            { type: 'remove', feature: f('a') }, { type: 'remove', feature: f('b') }] })).toBe(true);
        expect(isSameVerbOverDistinctFeatures({ type: 'batch', operations: [
            { type: 'update', oldFeature: f('a') }, { type: 'update', oldFeature: f('b') }] })).toBe(true);
        expect(isSameVerbOverDistinctFeatures({ type: 'batch', operations: [
            { type: 'remove', feature: f('a') }, { type: 'add', feature: f('b') }] })).toBe(false);
        expect(isSameVerbOverDistinctFeatures({ type: 'batch', operations: [
            { type: 'update', oldFeature: f('a') }, { type: 'update', oldFeature: f('a') }] })).toBe(false);
        expect(isSameVerbOverDistinctFeatures({ type: 'batch', operations: [
            { type: 'removeWithProcessed', mainFeature: f('a'), processedFeatures: null },
            { type: 'removeWithProcessed', mainFeature: f('b'), processedFeatures: { type: 'x', features: [f('b1')] } }] }))
            .toBe(true);
        expect(isSameVerbOverDistinctFeatures({ type: 'batch', operations: [
            { type: 'updateWithProcessed', oldFeature: f('a') }, { type: 'updateWithProcessed', oldFeature: f('b') }] }))
            .toBe(false);
        expect(isSameVerbOverDistinctFeatures({ type: 'moveBetweenMaps' })).toBe(false);
        expect(isSameVerbOverDistinctFeatures({ type: 'update', oldFeature: f('a') })).toBe(false);
    });
});

describe('a frase da parte recusada', () => {
    const parte = (inicio, fim, batchId) => Array.from({ length: fim - inicio }, (_, k) => ({
        id: `op${inicio + k}`, traceId: 'T', batchId, batchIndex: inicio + k,
    }));

    it('lote que nao e parte de nada: sem frase', () => {
        expect(describeRefusedPart(parte(0, 30, 'A'), parte(0, 30, 'A'))).toBeNull();
    });

    it('parte 2 de 3 recusada, a 1 ja chegou', () => {
        const recusada = parte(200, 400, 'B');
        const fila = [...recusada, ...parte(400, 450, 'C')];
        expect(describeRefusedPart(recusada, fila)).toBe(
            'O servidor recusou a parte 2 de 3 desta ação (200 feições). '
            + '200 de 450 já chegaram; a parte recusada está nas pendências para revisão.');
    });

    it('parte 1 recusada: nada chegou ainda', () => {
        const recusada = parte(0, 200, 'A');
        expect(describeRefusedPart(recusada, [...recusada, ...parte(200, 450, 'B')]))
            .toContain('parte 1 de 3 desta ação (200 feições). 0 de 450 já chegaram');
    });

    it('a ultima parte recusada com as anteriores entregues', () => {
        expect(describeRefusedPart(parte(400, 450, 'C'), parte(400, 450, 'C')))
            .toContain('parte 3 de 3 desta ação (50 feições). 400 de 450 já chegaram');
    });

    it('parte de um gesto dividido (um rastro por membro): frase sem total', () => {
        const recusada = Array.from({ length: 50 }, (_, k) => ({ id: `g${k}`, traceId: `t${k}`, batchId: 'G2', batchIndex: 200 + k }));
        expect(describeRefusedPart(recusada, recusada)).toBe(
            'O servidor recusou uma parte desta ação (50 feições); as partes anteriores já foram enviadas. '
            + 'A parte recusada está nas pendências para revisão.');
        const primeira = recusada.map((op, k) => ({ ...op, batchIndex: k }));
        expect(describeRefusedPart(primeira, primeira)).toBeNull();
    });

    it('uma parte anterior tambem recusada nao conta como chegada', () => {
        const antes = parte(0, 200, 'A');
        const recusada = parte(400, 450, 'C');
        expect(describeRefusedPart(recusada, [...antes, ...recusada]))
            .toContain('200 de 450 já chegaram');
    });
});

// Path: tests/integration/gesto-composto-um-lote.test.js

/**
 * @fileoverview UM GESTO COMPOSTO EMITE UM LOTE LÓGICO SÓ, atravessando transações.
 *
 * O DEFEITO QUE ESTE ARQUIVO PRENDE (item 2 de "O que segue aberto" em
 * `docs/reviews/fechamento/04-comandos-compostos.md`). Uma transação já era um lote, porque
 * `persistOperationIntents` cria as intenções dela por `createBatchOperations`. Três gestos não
 * cabem em uma transação, e não por descuido: converter uma feição, transferir uma camada e
 * desfazer awaitam folhas que tomam `withMapDocument` cada uma na sua chave, e a fila de
 * `store/document-lock.js` é FIFO sem reentrância, então envolvê-los numa transação só trava a
 * interface para sempre. Sem uma identidade compartilhada, o servidor via dois gestos e podia
 * aplicar o primeiro e recusar o segundo: uma feição convertida com a original ainda no mapa.
 *
 * DUAS PROPRIEDADES, e a segunda é a que transforma "provável" em "verdadeiro":
 *
 *   1. as transações de um gesto compartilham `batchId`, com o `batchIndex` CONTINUANDO (o
 *      servidor lê pai antes de filho por esse índice);
 *   2. enquanto o gesto está ABERTO, a fila não entrega nenhum membro dele ao flush. O disparo
 *      de 1,5 s caindo entre duas transações do gesto é o caminho pelo qual metade dele viajaria
 *      sozinha, e essa metade chegaria ao servidor com cara de gesto inteiro.
 *
 * A FILA E O DESPACHANTE SÃO OS REAIS, contra IndexedDB real: o que se mede aqui é o envelope
 * que de fato vai para o disco, e um dublê de fila mediria o dublê.
 */

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { activateScope, getStoreFor, remoteScope, StoreName } from '../../src/js/store/atlas-namespace.js';
import {
    persistOperationIntents,
    enableOperationLogging,
    disableOperationLogging,
} from '../../src/js/store/sync/operation-dispatcher.js';
import { OperationQueue } from '../../src/js/store/sync/operation-queue.js';
import { withGestureBatch, openGestureBatchId } from '../../src/js/store/sync/gesture-batch.js';

const MAP_ID = '77777777-7777-4777-8777-777777777777';

let scope;
let queue;

/**
 * Uma descrição de edição, como `tx.recordOperation` a coleta.
 * @param {string} entityId - Id da entidade.
 * @param {string} [operationType] - Tipo de operação.
 * @returns {Object} A descrição.
 */
function descricao(entityId, operationType = 'create') {
    return {
        entityType: 'feature', operationType, entityId, mapId: MAP_ID,
        data: { type: 'Feature', properties: { id: entityId, source: 'point' } }, previousData: null,
    };
}

/**
 * Uma transação completa: escreve as intenções e materializa a projeção.
 * @param {...Object} descricoes - As edições da transação.
 * @returns {Promise<void>}
 */
async function transacao(...descricoes) {
    const materializar = await persistOperationIntents(descricoes, { scope, traceId: 'gesto' });
    await materializar();
}

beforeEach(async () => {
    scope = remoteScope(crypto.randomUUID());
    activateScope(scope);
    await getStoreFor(StoreName.OPERATION_QUEUE, scope).clear();
    enableOperationLogging();
    queue = new OperationQueue(scope);
});

afterEach(() => disableOperationLogging());

describe('Duas transações, um lote lógico', () => {
    it('as transações do gesto compartilham `batchId` e continuam o `batchIndex`', async () => {
        await withGestureBatch(async () => {
            // A conversão, na forma que o cliente de fato emite: criar a nova, remover a origem.
            await transacao(descricao('nova'));
            await transacao(descricao('origem', 'delete'));
        });

        const enfileiradas = await queue.getAll();
        expect(enfileiradas.map(op => op.entityId)).toEqual(['nova', 'origem']);
        expect(new Set(enfileiradas.map(op => op.batchId)).size).toBe(1);
        // O ÍNDICE CONTINUA: reiniciá-lo em zero poria dois membros na mesma posição e deixaria
        // a ordem de aplicação por conta do acaso.
        expect(enfileiradas.map(op => op.batchIndex)).toEqual([0, 1]);
    });

    it('CONTROLE NEGATIVO: sem o gesto, as mesmas duas transações são dois lotes', async () => {
        await transacao(descricao('nova'));
        await transacao(descricao('origem', 'delete'));

        const enfileiradas = await queue.getAll();
        expect(new Set(enfileiradas.map(op => op.batchId)).size).toBe(2);
        // E cada uma recomeça o índice, que é o que faz delas dois gestos para o servidor.
        expect(enfileiradas.map(op => op.batchIndex)).toEqual([0, 0]);
    });

    it('uma transação de N edições continua sendo UM lote (colar, duplicar, importar)', async () => {
        // `addFeatures` grava as N feições num `runTransaction` só, então colar e duplicar já
        // eram um lote lógico antes deste trabalho. Este caso é o que impede que deixem de ser.
        await transacao(descricao('c1'), descricao('c2'), descricao('c3'));

        const enfileiradas = await queue.getAll();
        expect(new Set(enfileiradas.map(op => op.batchId)).size).toBe(1);
        expect(enfileiradas.map(op => op.batchIndex)).toEqual([0, 1, 2]);
    });

    it('um gesto dentro de outro ADERE ao de fora: o gesto é o que a pessoa pediu', async () => {
        await withGestureBatch(async () => {
            await transacao(descricao('camada'));
            await withGestureBatch(async () => {
                await transacao(descricao('feicao'));
            });
            // O de dentro fechou e o de fora continua aberto: a terceira ainda é do mesmo lote.
            expect(openGestureBatchId()).not.toBeNull();
            await transacao(descricao('remocao', 'delete'));
        });

        const enfileiradas = await queue.getAll();
        expect(new Set(enfileiradas.map(op => op.batchId)).size).toBe(1);
        expect(enfileiradas.map(op => op.batchIndex)).toEqual([0, 1, 2]);
        expect(openGestureBatchId()).toBeNull();
    });

    it('um gesto que LANÇA fecha mesmo assim, e a próxima transação é um lote novo', async () => {
        await expect(withGestureBatch(async () => {
            await transacao(descricao('meia'));
            throw new Error('a segunda metade falhou');
        })).rejects.toThrow('a segunda metade falhou');

        // Um gesto que ficasse aberto seguraria o envio de tudo pelo resto da sessão.
        expect(openGestureBatchId()).toBeNull();
        await transacao(descricao('depois'));
        const enfileiradas = await queue.getAll();
        expect(new Set(enfileiradas.map(op => op.batchId)).size).toBe(2);
    });
});

describe('O gesto aberto segura o envio', () => {
    it('nada do gesto é enviável ANTES de ele fechar, e tudo é depois', async () => {
        let meioDoGesto = null;

        await withGestureBatch(async () => {
            await transacao(descricao('nova'));
            // O instante do disparo de 1,5 s caindo no meio do gesto. Sem a espera, é aqui que
            // a primeira metade viajaria sozinha e o servidor a aplicaria como gesto completo.
            meioDoGesto = await queue.peek(25);
            await transacao(descricao('origem', 'delete'));
        });

        expect(meioDoGesto).toEqual([]);
        expect((await queue.peek(25)).map(op => op.entityId)).toEqual(['nova', 'origem']);
    });

    it('CONTROLE NEGATIVO: sem o gesto, o mesmo instante entrega a primeira metade', async () => {
        await transacao(descricao('nova'));
        const meioDoGesto = await queue.peek(25);
        await transacao(descricao('origem', 'delete'));

        expect(meioDoGesto.map(op => op.entityId)).toEqual(['nova']);
    });

    it('o censo NÃO promete o que o flush recusa: gesto aberto conta como preparada', async () => {
        let censo = null;

        await withGestureBatch(async () => {
            await transacao(descricao('nova'));
            censo = await queue.countByState();
        });

        // `pendentes` é o que o laço de flush lê como "há o que enviar"; contar o gesto aberto
        // ali faria o laço acordar a cada 1,5 s, empurrar zero e registrar um SUCESSO.
        expect(censo).toEqual({ pendentes: 0, preparadas: 1, problemas: 0 });
        expect(await queue.countByState()).toEqual({ pendentes: 1, preparadas: 0, problemas: 0 });
    });

    it('a espera é do gesto ABERTO, e não de todo lote: um gesto fechado sai na hora', async () => {
        await withGestureBatch(async () => {
            await transacao(descricao('a'), descricao('b'));
        });
        // Controle positivo do controle acima: se a regra fosse "todo lote espera", esta lista
        // viria vazia e a espera nunca terminaria para gesto nenhum.
        expect((await queue.peek(25)).map(op => op.entityId)).toEqual(['a', 'b']);
    });
});

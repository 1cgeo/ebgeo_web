// Path: tests/integration/fila-recorte-por-lote.test.js

/**
 * @fileoverview O RECORTE DO ENVIO RESPEITA A FRONTEIRA DO LOTE LÓGICO.
 *
 * O DEFEITO QUE ESTE ARQUIVO PRENDE (item 1 de "O que segue aberto" em
 * `docs/reviews/fechamento/04-comandos-compostos.md`). Desde 2026-09-13 o servidor aplica ou
 * recusa INTEIRO o conjunto de operações que compartilham um `batchId` e chegam no MESMO push,
 * num savepoint só. Ele não recebe um total, então não tem como saber que faltou membro: um
 * recorte de FIFO cego (`peek(25)` fatiando por contagem) partia um gesto de 30 operações em 25
 * mais 5, o servidor tratava cada metade como um lote lógico próprio, e o gesto voltava a poder
 * ser aplicado pela metade, que é exatamente o desfecho que o savepoint foi comprado para
 * impedir.
 *
 * O CONTRATO NOVO DO `peek`, e ele NÃO é uma fatia: o argumento é um ORÇAMENTO de lotes
 * inteiros. Um lote é tomado inteiro enquanto couber; o PRIMEIRO lote é tomado inteiro mesmo
 * quando sozinho passa do orçamento, porque um gesto maior que o recorte precisa viajar num push
 * próprio em vez de ser partido. O teto do servidor (`LOTE_MAX_OPS`, 200) é cobrado por quem
 * conhece o protocolo, o motor de sync, e não aqui.
 *
 * O CONTROLE NEGATIVO É A FATIA CEGA, reimplementada em {@link fatiaCega}: cada caso afirma o
 * que ela devolveria ao lado do que o recorte novo devolve. Sem essa metade, um empacotamento
 * que por engano devolvesse a fila inteira passaria verde em todo caso de "não partiu".
 */

import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { getStoreFor, remoteScope, StoreName } from '../../src/js/store/atlas-namespace.js';
import { OperationQueue } from '../../src/js/store/sync/operation-queue.js';

/** Um envelope mínimo do protocolo corrente. */
function op(id, extra = {}) {
    return {
        protocolVersion: 2, id, entityId: id, entityType: 'map', operationType: 'create',
        timestamp: 1000, ...extra,
    };
}

/**
 * N operações de um mesmo lote lógico, já com o índice que o servidor lê para ordenar.
 * @param {string} batchId - Identidade do gesto.
 * @param {number} total - Quantos membros.
 * @param {string} prefixo - Prefixo dos ids, para leitura das falhas.
 * @returns {Object[]} Os envelopes, em ordem.
 */
function lote(batchId, total, prefixo) {
    return Array.from({ length: total }, (_, index) =>
        op(`${prefixo}-${index}`, { batchId, batchIndex: index }));
}

/**
 * O RECORTE ANTIGO, byte a byte: as N primeiras operações enviáveis, sem olhar lote nenhum.
 * @param {OperationQueue} queue - A fila.
 * @param {number} count - Quantas operações.
 * @returns {Promise<string[]>} Os ids que a fatia cega entregaria.
 */
async function fatiaCega(queue, count) {
    const todas = await queue.getAll();
    return todas.slice(0, count).map(operation => operation.id);
}

/**
 * Uma fila limpa num atlas de servidor próprio de cada caso.
 * @param {string} atlasId - UUID do atlas.
 * @returns {Promise<{queue: OperationQueue, store: object}>}
 */
async function filaLimpa(atlasId) {
    const scope = remoteScope(atlasId);
    const store = getStoreFor(StoreName.OPERATION_QUEUE, scope);
    await store.clear();
    return { queue: new OperationQueue(scope), store };
}

describe('O recorte do envio não corta dentro de um lote', () => {
    it('um lote de 30 sai INTEIRO, mesmo com orçamento de 25', async () => {
        const { queue } = await filaLimpa('22222222-0000-4000-8000-000000000001');
        await queue.enqueueAll(lote('gesto-a', 30, 'a'));

        const primeiro = await queue.peek(25);
        expect(primeiro).toHaveLength(30);
        expect(new Set(primeiro.map(o => o.batchId))).toEqual(new Set(['gesto-a']));
        // A ORDEM É O CONTRATO: o servidor lê pai antes de filho pelo `batchIndex`.
        expect(primeiro.map(o => o.batchIndex)).toEqual([...Array(30).keys()]);

        // CONTROLE NEGATIVO: a fatia cega entregava 25, e as 5 restantes viravam um segundo
        // lote lógico no servidor, aplicável sem as outras 25.
        expect(await fatiaCega(queue, 25)).toHaveLength(25);
    });

    it('dois lotes de 20 saem em DOIS pushes, sem cortar nenhum dos dois', async () => {
        const { queue } = await filaLimpa('22222222-0000-4000-8000-000000000002');
        await queue.enqueueAll(lote('gesto-a', 20, 'a'));
        await queue.enqueueAll(lote('gesto-b', 20, 'b'));

        // CONTROLE NEGATIVO, medido ANTES de qualquer confirmação: a fatia cega levaria os 20 do
        // primeiro mais 5 do segundo, e o servidor aplicaria esses 5 como um gesto completo que
        // ninguém pediu.
        const cega = await fatiaCega(queue, 25);
        expect(cega.filter(id => id.startsWith('b-'))).toHaveLength(5);

        const primeiro = await queue.peek(25);
        expect(primeiro.map(o => o.id)).toEqual(lote('gesto-a', 20, 'a').map(o => o.id));

        // Confirmado o primeiro, o segundo sai inteiro na volta seguinte.
        await queue.dequeue(primeiro.map(o => o.id));
        const segundo = await queue.peek(25);
        expect(segundo.map(o => o.id)).toEqual(lote('gesto-b', 20, 'b').map(o => o.id));
    });

    it('operação sem lote continua sendo cortada por contagem, e um lote seguinte não é partido', async () => {
        const { queue } = await filaLimpa('22222222-0000-4000-8000-000000000003');
        await queue.enqueueAll(Array.from({ length: 24 }, (_, i) => op(`solta-${i}`)));
        await queue.enqueueAll(lote('gesto-a', 10, 'a'));

        // CONTROLE NEGATIVO: a fatia cega levava as 24 soltas MAIS o primeiro membro do lote.
        expect((await fatiaCega(queue, 25))[24]).toBe('a-0');

        // Sobrava espaço para uma, e o lote pede dez: ele fica inteiro para o push seguinte.
        const primeiro = await queue.peek(25);
        expect(primeiro).toHaveLength(24);
        expect(primeiro.every(o => o.batchId === undefined)).toBe(true);

        await queue.dequeue(primeiro.map(o => o.id));
        expect((await queue.peek(25)).map(o => o.id)).toEqual(lote('gesto-a', 10, 'a').map(o => o.id));
    });

    it('o pedaço INDIVISÍVEL de um lote é o lote, e é o que o modo de isolamento recebe', async () => {
        const { queue } = await filaLimpa('22222222-0000-4000-8000-000000000004');
        await queue.enqueueAll(lote('gesto-a', 4, 'a'));
        await queue.enqueueAll([op('solta')]);

        // `peek(1)` é o pedido do modo de isolamento do motor: ele quer o MENOR pedaço que ainda
        // pode ser enviado sozinho, e dentro de um gesto esse pedaço é o gesto.
        expect((await queue.peek(1)).map(o => o.id)).toEqual(['a-0', 'a-1', 'a-2', 'a-3']);

        // CONTROLE NEGATIVO: a fatia cega devolvia uma op só, e enviá-la sozinha faria o
        // servidor aplicar um quarto de gesto como se fosse um gesto inteiro.
        expect(await fatiaCega(queue, 1)).toEqual(['a-0']);
    });

    it('um membro ainda PREPARADO segura o lote inteiro, e não só a si mesmo', async () => {
        const { queue } = await filaLimpa('22222222-0000-4000-8000-000000000005');
        const membros = lote('gesto-a', 3, 'a');
        await queue.enqueueAll(membros, { prepared: true });
        // O caso real: a projeção de duas das três já foi materializada (a terceira espera o
        // blob da imagem dela). Sem a regra, as duas sairiam e o gesto viajaria pela metade.
        await queue.markMaterialized([membros[0], membros[1]]);

        expect(await queue.peek(25)).toEqual([]);
        expect(await queue.count()).toBe(0);

        // CONTROLE POSITIVO: materializada a terceira, as três saem juntas.
        await queue.markMaterialized([membros[2]]);
        expect((await queue.peek(25)).map(o => o.id)).toEqual(['a-0', 'a-1', 'a-2']);
    });

    it('um membro com problema guardado leva o lote inteiro para os problemas', async () => {
        const { queue } = await filaLimpa('22222222-0000-4000-8000-000000000007');
        const membros = lote('gesto-a', 3, 'a');
        await queue.enqueueAll(membros);
        await queue.enqueueAll([op('solta')]);
        // O membro do MEIO, de propósito: os anteriores já estavam no buffer do carregador
        // quando o problema apareceu, e é justamente esse pedaço que a versão ingênua enviava.
        await queue.recordIssue(membros[1], { rejected: true, reason: 'Mapa bloqueado' });

        expect((await queue.peek(25)).map(o => o.id)).toEqual(['solta']);
        expect(await queue.countByState()).toEqual({ pendentes: 1, preparadas: 0, problemas: 3 });
        // A MESMA REGRA DOS DOIS LADOS: o censo conta exatamente o que o carregador entregaria.
        expect(await queue.count()).toBe(1);
    });

    it('o lote não muda o que a projeção e o `getAll` respondem: eles não têm orçamento', async () => {
        const { queue } = await filaLimpa('22222222-0000-4000-8000-000000000006');
        await queue.enqueueAll(lote('gesto-a', 30, 'a'));
        await queue.enqueueAll([op('solta')]);

        expect(await queue.getAll()).toHaveLength(31);
        expect(await queue.getPendingProjection()).toHaveLength(31);
        expect(await queue.countByState()).toEqual({ pendentes: 31, preparadas: 0, problemas: 0 });
    });
});

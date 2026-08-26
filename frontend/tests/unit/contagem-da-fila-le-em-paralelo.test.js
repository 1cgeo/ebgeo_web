// Path: tests/unit/contagem-da-fila-le-em-paralelo.test.js

/**
 * @fileoverview A contagem da fila de saida, que decide um RESGATE e vive no caminho critico do
 * clique em "Sair".
 *
 * O DEFEITO QUE ESTE ARQUIVO PRENDE. `count()` chamava `_loadOperations`, que faz
 * `await getItem(chave)` DENTRO de um laco: uma ida ao IndexedDB por operacao, em fila, so para
 * somar um numero. `_loadOperations` existe para devolver uma lista CRONOLOGICA, e era so pela
 * ordem que a contagem a chamava; uma contagem nao precisa de ordem.
 *
 * AS DUAS METADES QUE NAO PODEM CEDER AO GANHO DE TEMPO, e este arquivo assere as duas ao lado da
 * medida de concorrencia, porque uma leitura rapida que responde errado e pior que a lenta:
 *
 *   1. LE OS VALORES, NUNCA CONTA AS CHAVES. O carimbo de escopo mora no envelope. Este numero
 *      decide o resgate: contar a mais preserva trabalho que nao estava em risco (um atlas local
 *      a mais, recuperavel), contar a menos AUTORIZA a destruicao, e isso e irreversivel.
 *   2. A FALHA SOBE, NUNCA VIRA ZERO. `Promise.all` rejeita se qualquer `getItem` rejeitar, e a
 *      rejeicao tem de continuar subindo ate o `catch` de `countPendingOperations`, que a
 *      converte em NaN ("desconhecido"), e desconhecido PRESERVA. Zero e a resposta que autoriza
 *      a destruicao.
 *
 * COMO A CONCORRENCIA E MEDIDA. O dublê conta quantos `getItem` estao EM VOO ao mesmo tempo, o que
 * e uma contagem inteira e nao um relogio: um pico maior que 1 so acontece se as leituras se
 * sobrepuseram. O tempo de parede entra como confirmacao, com margem folgada, porque ele e o que
 * o usuario sente e o que motivou a mudanca.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

/** Atraso de cada leitura no dublê. Alto o bastante para o serial e o paralelo nao se confundirem. */
const ATRASO_MS = 5;

const disco = vi.hoisted(() => ({
    /** O banco de fila: chave -> envelope. */
    banco: new Map(),
    /** Escopo montado, ou null (a fila cai no endereco legado). */
    escopo: { kind: 'remote', atlasId: 'alfa', dbSuffix: 'remote-alfa' },
    /** Quantos `getItem` estao em voo agora, e o pico observado. */
    emVoo: 0,
    picoEmVoo: 0,
    /** Quantas vezes a fabrica de lojas foi consultada, para provar que a loja e resolvida uma vez. */
    fabricaChamada: 0,
    /** Chave cuja leitura deve lancar, para o caso da falha. */
    chaveQueQuebra: null,
    /** Toda leitura pedida, na ordem em que foi pedida. */
    lidas: [],
}));

vi.mock('@store/atlas-namespace.js', () => ({
    StoreName: Object.freeze({ OPERATION_QUEUE: 'operation_queue' }),
    UNMOUNTED_QUEUE_SCOPE: Object.freeze({ kind: 'legacy', atlasId: null, dbSuffix: '' }),
    getActiveScope: () => disco.escopo,
    getStoreFor: () => {
        disco.fabricaChamada += 1;
        return {
            keys: async () => [...disco.banco.keys()],
            getItem: async (chave) => {
                disco.emVoo += 1;
                disco.picoEmVoo = Math.max(disco.picoEmVoo, disco.emVoo);
                disco.lidas.push(chave);
                try {
                    await new Promise(r => setTimeout(r, ATRASO_MS));
                    if (chave === disco.chaveQueQuebra) throw new Error('IndexedDB indisponivel');
                    return disco.banco.get(chave) ?? null;
                } finally {
                    disco.emVoo -= 1;
                }
            },
            setItem: async (chave, valor) => { disco.banco.set(chave, valor); return valor; },
            removeItem: async (chave) => { disco.banco.delete(chave); },
        };
    },
}));

/**
 * Semeia N operacoes no banco.
 * @param {number} quantas
 * @param {string} [sufixo] - Carimbo de escopo do envelope.
 */
function semear(quantas, sufixo = 'remote-alfa') {
    for (let i = 0; i < quantas; i += 1) {
        disco.banco.set(`op_${1000 + i}_${sufixo}-${i}`, {
            id: `${sufixo}-${i}`, timestamp: 1000 + i, scopeSuffix: sufixo,
        });
    }
}

/** @returns {Promise<import('@store/sync/operation-queue.js')>} */
async function carregarFila() {
    return import('@store/sync/operation-queue.js');
}

beforeEach(() => {
    disco.banco = new Map();
    disco.escopo = { kind: 'remote', atlasId: 'alfa', dbSuffix: 'remote-alfa' };
    disco.emVoo = 0;
    disco.picoEmVoo = 0;
    disco.fabricaChamada = 0;
    disco.chaveQueQuebra = null;
    disco.lidas = [];
});

describe('operationQueue.count()', () => {
    it('as leituras se SOBREPOEM, em vez de uma por vez', async () => {
        const { operationQueue } = await carregarFila();
        const N = 40;
        semear(N);

        const inicio = performance.now();
        const total = await operationQueue.count();
        const decorrido = performance.now() - inicio;

        expect(total).toBe(N);
        expect(disco.lidas).toHaveLength(N);

        // A MEDIDA QUE NAO DEPENDE DE RELOGIO: o pico de leituras em voo. Serial teria pico 1.
        expect(disco.picoEmVoo).toBe(N);

        // E a confirmacao no tempo de parede, com margem folgada para nao virar teste instavel:
        // serial custaria pelo menos N * ATRASO_MS; sobreposto custa cerca de um ATRASO_MS.
        expect(decorrido).toBeLessThan(N * ATRASO_MS / 2);

        // A LOJA E RESOLVIDA UMA VEZ, e nao uma por operacao: a fabrica responde pelo escopo
        // montado no instante da chamada, e uma troca no meio do lote contaria metade de um banco
        // e metade de outro. Duas chamadas (a das chaves e a da contagem) para qualquer N.
        expect(disco.fabricaChamada).toBe(2);
    });

    it('a fila vazia responde ZERO sem ler nada', async () => {
        const { operationQueue } = await carregarFila();

        expect(await operationQueue.count()).toBe(0);
        expect(disco.lidas).toHaveLength(0);

        // CONTROLE NEGATIVO: com uma operacao o mesmo caminho LE. Sem esta metade, um atalho que
        // devolvesse 0 sempre passaria, e 0 e a resposta que autoriza a destruicao do trabalho.
        semear(1);
        expect(await operationQueue.count()).toBe(1);
        expect(disco.lidas).toHaveLength(1);
    });

    it('LE OS VALORES: op carimbada para outro escopo nao conta', async () => {
        const { operationQueue } = await carregarFila();
        semear(3);
        semear(5, 'remote-outro');

        const total = await operationQueue.count();

        expect(total).toBe(3);
        // CONTROLE NEGATIVO: contar as CHAVES daria 8, e nao ler nada daria 0. Os dois defeitos
        // produzem numeros diferentes deste, e os dois sao alcancaveis por descuido.
        expect(total).not.toBe(8);
        expect(total).not.toBe(0);
        expect(disco.lidas).toHaveLength(8);
    });

    it('a leitura que quebra REJEITA, e nao devolve zero', async () => {
        const { operationQueue } = await carregarFila();
        semear(4);
        disco.chaveQueQuebra = [...disco.banco.keys()][2];

        // A rejeicao tem de subir: e o `catch` de `countPendingOperations` que a converte em NaN,
        // e NaN preserva. Um `catch` aqui responderia 0, que autoriza destruir o trabalho.
        await expect(operationQueue.count()).rejects.toThrow('IndexedDB indisponivel');

        // CONTROLE NEGATIVO: sem a chave quebrada o mesmo cenario responde o numero.
        disco.chaveQueQuebra = null;
        expect(await operationQueue.count()).toBe(4);
    });

    it('conta em LOTES, entao uma fila enorme nao residencia tudo de uma vez', async () => {
        const fonte = await (async () => {
            const { readFileSync } = await import('node:fs');
            return readFileSync(new URL('../../src/js/store/sync/operation-queue.js', import.meta.url), 'utf-8');
        })();

        const lote = fonte.match(/const COUNT_BATCH_SIZE = (\d+);/);
        const teto = fonte.match(/const MAX_QUEUE_SIZE = (\d+);/);
        expect(lote?.[1]).toBeTruthy();
        expect(teto?.[1]).toBeTruthy();
        // O lote existe por causa do teto: `MAX_QUEUE_SIZE` envelopes residentes de uma vez sao
        // payloads de entidade em memoria, nao ponteiros. O lote tem de ser bem menor que o teto.
        expect(Number(lote[1])).toBeLessThan(Number(teto[1]) / 10);

        // E a asseracao de comportamento: com o dobro do lote em disco, o pico em voo para no lote.
        const { operationQueue } = await carregarFila();
        const tamanho = Number(lote[1]);
        semear(tamanho * 2);

        expect(await operationQueue.count()).toBe(tamanho * 2);
        expect(disco.picoEmVoo).toBe(tamanho);
    });
});

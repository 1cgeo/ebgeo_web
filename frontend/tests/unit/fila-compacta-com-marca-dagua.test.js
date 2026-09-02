// Path: tests/unit/fila-compacta-com-marca-dagua.test.js

/**
 * @fileoverview `MAX_QUEUE_SIZE` é um NÍVEL, não um gatilho, e a fila podia ficar acima dele
 * para sempre.
 *
 * O DEFEITO. `_growAndMaybeCompact` (`frontend/src/js/store/sync/operation-queue.js`) chamava
 * `_compact()` a cada `enqueue` enquanto a contagem passasse do teto. A compactação só remove
 * uma operação que outra da MESMA entidade supera: N creates de N entidades distintas compactam
 * para N, e é exatamente isso que a importação de N feições enfileira. Logo a primeira
 * compactação acima do teto não liberava nada, a fila continuava acima, e cada operação
 * seguinte pagava uma leitura completa da fila: um `keys()` para recontar, outro dentro da
 * compactação, e um `getItem` serial sobre a fila inteira. Custo quadrático no tamanho do
 * atraso, e atraso grande é justamente o que uma rajada offline produz.
 *
 * A MEDIÇÃO, com 12000 creates de entidades distintas (`enqueue` um a um):
 *
 *   | grandeza            | antes      | depois |
 *   |---------------------|-----------:|-------:|
 *   | `_compact` chamado  |       2000 |      2 |
 *   | `keys()`            |       4000 |      3 |
 *   | `getItem()`         | 22.001.000 | 21.002 |
 *   | tempo               |    12,9 s  |  51 ms |
 *
 * A SAÍDA É UMA MARCA D'ÁGUA, não um teto maior nem uma compactação mais esperta: depois de uma
 * compactação que deixou a fila ACIMA do teto, a próxima só roda quando a fila crescer
 * `COMPACTION_STEP` (um décimo do teto) além do tamanho medido. O teto e a semântica da
 * compactação não mudaram.
 *
 * O QUE ESTE ARQUIVO PRENDE, e por que cada metade precisa da outra:
 *   - o degrau: `_compact` roda uma vez por degrau e não uma vez por operação;
 *   - a marca CADUCA: fila que baixa do teto volta a poder compactar imediatamente. Sem isso a
 *     marca de uma rajada antiga adiaria a próxima, e o teste do degrau sozinho passaria com uma
 *     compactação que nunca mais roda;
 *   - a compactação ainda COMPACTA: cruzado o degrau, um par CREATE+UPDATE pendente funde. Sem
 *     isso o verde seria compatível com desligar a compactação inteira, que é a forma mais fácil
 *     de fazer os números da tabela acima ficarem bonitos.
 *
 * CONTROLE NEGATIVO, medido em 2026-09-02: com a comparação da marca removida de
 * `_growAndMaybeCompact`, o espião do primeiro caso conta 2000 compactações em vez de 2.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { queueMap, leituras } = vi.hoisted(() => ({
    queueMap: new Map(),
    leituras: { keys: 0, getItem: 0 },
}));

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            setItem: async (k, v) => { queueMap.set(k, v); },
            getItem: async (k) => { leituras.getItem++; return queueMap.get(k) ?? null; },
            removeItem: async (k) => { queueMap.delete(k); },
            keys: async () => { leituras.keys++; return [...queueMap.keys()]; },
            clear: async () => { queueMap.clear(); },
        }),
    },
}));

import { OperationQueue } from '../../src/js/store/sync/operation-queue.js';
import { OperationType, EntityType } from '../../src/js/store/sync/operation-types.js';

/** O teto e o degrau, repetidos aqui porque nenhum dos dois é exportado. */
const MAX_QUEUE_SIZE = 10000;
const COMPACTION_STEP = 1000;

/**
 * @param {number} i - Sequence number, also the fixed-width timestamp offset.
 * @param {string} tipo - Operation type.
 * @param {number} [entidade=i] - Entity the operation describes.
 * @returns {Object} A queue envelope.
 */
function op(i, tipo, entidade = i) {
    return {
        id: `op-${String(i).padStart(6, '0')}`,
        entityType: EntityType.FEATURE,
        operationType: tipo,
        entityId: `feat-${entidade}`,
        mapId: 'map-1',
        data: { nome: `v${i}` },
        previousData: null,
        // 13-digit fixed width: the key sort is lexicographic and has to match chronology.
        timestamp: 1700000000000 + i,
        lamportTimestamp: 0,
        clientId: 'test-client',
    };
}

/** Wraps `_compact` so the test can count invocations without changing behaviour. */
function espionar(queue) {
    const contagem = { chamadas: 0, tamanhosAoEntrar: [] };
    const real = queue._compact.bind(queue);
    queue._compact = async (...args) => {
        contagem.chamadas++;
        contagem.tamanhosAoEntrar.push(queueMap.size);
        return real(...args);
    };
    return contagem;
}

let queue;

beforeEach(() => {
    queueMap.clear();
    leituras.keys = 0;
    leituras.getItem = 0;
    queue = new OperationQueue();
});

describe('marca d\'água da compactação', () => {
    it('12000 CREATEs distintos: `_compact` roda uma vez por degrau, não por operação', async () => {
        const espiao = espionar(queue);

        for (let i = 0; i < 12000; i++) {
            await queue.enqueue(op(i, OperationType.CREATE));
        }

        // Degraus cruzados entre 10001 e 12000: o teto (10001) e o teto + um degrau (11001).
        expect(espiao.chamadas).toBe(2);
        expect(espiao.tamanhosAoEntrar).toEqual([MAX_QUEUE_SIZE + 1, MAX_QUEUE_SIZE + COMPACTION_STEP + 1]);

        // A primeira compactação acontece NO teto, não depois dele: a marca só nasce da
        // compactação que já rodou, então ela não pode atrasar a primeira.
        expect(espiao.tamanhosAoEntrar[0]).toBe(MAX_QUEUE_SIZE + 1);

        // Nada foi compactado, porque nada era compactável: entidades distintas.
        expect(queueMap.size).toBe(12000);
        expect(await queue.count()).toBe(12000);

        // O outro lado do quadrático: sem a marca eram 4000 listagens de chave e 22 milhões de
        // leituras. O piso é frouxo de propósito (o número exato depende de quantas
        // compactações rodaram), o teto é o que afirma a propriedade.
        expect(leituras.keys).toBeLessThan(20);
        expect(leituras.getItem).toBeLessThan(200000);
    }, 120000);

    it('a marca caduca: fila que baixa do teto volta a compactar imediatamente', async () => {
        for (let i = 0; i < 12000; i++) {
            await queue.enqueue(op(i, OperationType.CREATE));
        }
        expect(queue._compactionWatermark).toBe(12001);

        // Drena abaixo do teto, como um flush faria.
        const ids = [];
        for (let i = 0; i < 3000; i++) ids.push(op(i, OperationType.CREATE).id);
        expect(await queue.dequeue(ids)).toBe(3000);
        expect(queueMap.size).toBe(9000);

        // A primeira operação depois da drenagem reconta do disco, vê 9001 e larga a marca.
        await queue.enqueue(op(20000, OperationType.CREATE));
        expect(queue._compactionWatermark).toBeNull();

        // E o teto volta a valer sozinho: a compactação seguinte roda em 10001, não em 12001.
        const espiao = espionar(queue);
        for (let i = 20001; i <= 21000; i++) {
            await queue.enqueue(op(i, OperationType.CREATE));
        }
        expect(queueMap.size).toBe(10001);
        expect(espiao.chamadas).toBe(1);
        expect(espiao.tamanhosAoEntrar).toEqual([MAX_QUEUE_SIZE + 1]);
    }, 120000);

    it('a compactação ainda COMPACTA quando há CREATE+UPDATE, cruzado o degrau', async () => {
        // 10002 operações: 5001 entidades, cada uma com CREATE e depois UPDATE.
        const lote = [];
        for (let i = 0; i < 5001; i++) lote.push(op(i * 2, OperationType.CREATE, i));
        for (let i = 0; i < 5001; i++) lote.push(op(i * 2 + 1, OperationType.UPDATE, i));
        lote.sort((a, b) => a.timestamp - b.timestamp);

        await queue.enqueueAll(lote);

        // Fundiu para uma CREATE por entidade, com o dado mais novo.
        expect(queueMap.size).toBe(5001);
        const todas = await queue.getAll();
        expect(todas).toHaveLength(5001);
        expect(todas.every(o => o.operationType === OperationType.CREATE)).toBe(true);
        expect(todas[0].data.nome).toBe('v1');

        // Abaixo do teto de novo, então a marca não sobrevive à compactação que deu certo.
        expect(queue._compactionWatermark).toBeNull();
        expect(queue._totalKeys).toBe(5001);
    }, 120000);

    it('a marca ADIA, não cancela: o par pendente funde na compactação do degrau seguinte', async () => {
        // Acima do teto com entidades distintas: a compactação não libera nada e a marca nasce.
        for (let i = 0; i < 10500; i++) {
            await queue.enqueue(op(i, OperationType.CREATE));
        }
        // A marca é o tamanho medido na compactação do teto (10001) mais o degrau.
        expect(queue._compactionWatermark).toBe(MAX_QUEUE_SIZE + 1 + COMPACTION_STEP);
        expect(queueMap.size).toBe(10500);

        // Um UPDATE de entidade já criada: compactável, e ainda assim nada roda enquanto a fila
        // não cruzar a marca.
        await queue.enqueue(op(30000, OperationType.UPDATE, 7));
        expect(queueMap.size).toBe(10501);

        const espiao = espionar(queue);
        // Exatamente o que falta para alcançar 11001, a marca. Contado, não observado pelo
        // tamanho da fila: a compactação do último passo ENCOLHE a fila, e um laço que olhasse
        // `queueMap.size` não terminaria.
        for (let i = 0; i < 500; i++) {
            await queue.enqueue(op(31000 + i, OperationType.CREATE, 40000 + i));
        }

        expect(espiao.chamadas).toBe(1);
        expect(espiao.tamanhosAoEntrar).toEqual([MAX_QUEUE_SIZE + 1 + COMPACTION_STEP]);
        // O par CREATE+UPDATE da entidade 7 fundiu: uma operação a menos que o total escrito.
        const daEntidade7 = (await queue.getAll()).filter(o => o.entityId === 'feat-7');
        expect(daEntidade7).toHaveLength(1);
        expect(daEntidade7[0].operationType).toBe(OperationType.CREATE);
        expect(daEntidade7[0].data.nome).toBe('v30000');
    }, 120000);
});

// Path: tests/unit/fila-ordem-de-criacao.test.js

/**
 * @fileoverview A CHAVE DA FILA É A ORDEM EM QUE O SERVIDOR APLICA, e dentro de um tick ela era
 * sorteada.
 *
 * O DEFEITO, medido. `createGroup` (`frontend/src/js/tool_manager/group_manager.js`) chama
 * `logGroupOperation` e um `logGroupFeatureOperation` por membro, todos sem `await`, no MESMO
 * tick. `createOperation` (`frontend/src/js/store/sync/operation-factory.js`) carimba
 * `Date.now()`, então as quatro operações nascem com o MESMO `timestamp`. A chave era
 * `op_{timestamp}_{uuid}` e `_getOrderedKeys` ordena lexicograficamente: empatado o timestamp,
 * quem desempatava era um UUID ALEATÓRIO. `peek` entrega essa ordem a `pushOperations` e o
 * servidor aplica o array na ordem em que ele chega; o insert de `group_features` é gateado por
 * um EXISTS sobre `groups`, de modo que um `group_feature` que chegue antes do seu `group`
 * escreve ZERO linhas e volta acked como sucesso. Agrupando três feições, a chance de pelo menos
 * um filho passar na frente do pai é de três em quatro.
 *
 * A CORREÇÃO é uma sequência monotônica entre o timestamp e o id (`op_{ts}_{seq}_{uuid}`), com
 * `lamportTimestamp` como sequência, porque ele já é `++lamportClock` na fábrica e já viaja no
 * envelope. O porquê da largura e os dois casos que ela deliberadamente não cobre estão em
 * `SEQ_WIDTH`.
 *
 * COMO ESTE ARQUIVO EVITA SER VÁCUO, que é o risco de um teste de ordenação:
 *  - o controle negativo é DETERMINÍSTICO, não estatístico: os UUIDs são forçados em ordem
 *    lexicográfica DECRESCENTE, então a chave antiga inverte SEMPRE e a nova acerta sempre. Um
 *    verde aqui não pode vir de sorte;
 *  - as 20 repetições usam o `generateUUID` de VERDADE, que é o caminho de produção, e afirmam
 *    a propriedade nas duas direções: a chave nova nunca inverte, e a antiga inverte em pelo
 *    menos uma delas. Este segundo lado é probabilístico e o número está escrito abaixo, junto
 *    com a razão de ele não ser um flake;
 *  - e um caso de COMPATIBILIDADE, porque a fila é persistida: chave no formato antigo continua
 *    sendo lida (é assim que uma op enfileirada antes da atualização do build ainda é
 *    dequeuada).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { queueMap } = vi.hoisted(() => ({ queueMap: new Map() }));

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            setItem: async (k, v) => { queueMap.set(k, v); },
            getItem: async (k) => queueMap.get(k) ?? null,
            removeItem: async (k) => { queueMap.delete(k); },
            keys: async () => [...queueMap.keys()],
            clear: async () => { queueMap.clear(); },
        }),
    },
}));

import { OperationQueue } from '../../src/js/store/sync/operation-queue.js';
import { createOperation } from '../../src/js/store/sync/operation-factory.js';
import { EntityType, OperationType } from '../../src/js/store/sync/operation-types.js';

/** O instante congelado: é ele que faz as quatro operações empatarem, como no tick real. */
const INSTANTE = 1_764_000_000_000;

/**
 * As quatro operações de `createGroup` com três membros, na ordem em que ele as emite, pela
 * fábrica REAL. Nada aqui monta envelope à mão: é a fábrica que decide `timestamp` e
 * `lamportTimestamp`, que são as duas coisas sob teste.
 * @returns {{grupo: Object, membros: Object[]}}
 */
function opsDeCriarGrupo() {
    const groupId = 'g-0000-1111-2222-3333';
    const grupo = createOperation(
        EntityType.GROUP, OperationType.CREATE, groupId, 'map-1', { nome: 'Grupo 1' }
    );
    const membros = ['feat-a', 'feat-b', 'feat-c'].map(featureId => createOperation(
        EntityType.GROUP_FEATURE, OperationType.CREATE, `link-${featureId}`, 'map-1',
        { group_id: groupId, feature_id: featureId, feature_type: 'points' }
    ));
    return { grupo, membros };
}

/**
 * A chave que a fila escrevia ANTES da sequência, reproduzida aqui para o controle negativo.
 * Ela é a única coisa deste arquivo que duplica a fonte, e de propósito: um controle negativo
 * que chamasse o código atual mediria o código atual.
 * @param {Object} op
 * @returns {string}
 */
function chaveAntiga(op) {
    return `op_${op.timestamp}_${op.id}`;
}

/**
 * Posição da op de grupo na ordem que um conjunto de chaves produz.
 * @param {string[]} chaves - Chaves a ordenar, como `_getOrderedKeys` faz.
 * @param {string} idDoGrupo - `op.id` da operação de grupo.
 * @returns {number}
 */
function posicaoDoGrupo(chaves, idDoGrupo) {
    return [...chaves].sort().findIndex(k => k.endsWith(idDoGrupo));
}

let queue;

beforeEach(() => {
    queueMap.clear();
    queue = new OperationQueue();
    vi.spyOn(Date, 'now').mockReturnValue(INSTANTE);
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('a chave da fila preserva a ordem de criação dentro de um milissegundo', () => {
    it('as quatro ops de criar grupo nascem com o MESMO timestamp e sequências crescentes', () => {
        const { grupo, membros } = opsDeCriarGrupo();
        const todas = [grupo, ...membros];

        // A premissa do defeito, asserida em vez de suposta: sem o empate não haveria nada a
        // desempatar, e o teste inteiro passaria medindo outra coisa.
        expect(new Set(todas.map(o => o.timestamp)).size).toBe(1);
        expect(todas[0].timestamp).toBe(INSTANTE);

        // E a propriedade de que a sequência depende.
        const seqs = todas.map(o => o.lamportTimestamp);
        expect(seqs.every(s => Number.isFinite(s) && s > 0)).toBe(true);
        for (let i = 1; i < seqs.length; i++) expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
    });

    it('`peek` devolve a op de GRUPO antes das três de membro', async () => {
        const { grupo, membros } = opsDeCriarGrupo();
        for (const op of [grupo, ...membros]) await queue.enqueue(op);

        const lidas = await queue.peek(10);
        expect(lidas).toHaveLength(4);
        expect(lidas[0].entityType).toBe(EntityType.GROUP);
        expect(lidas[0].id).toBe(grupo.id);
        expect(lidas.slice(1).every(o => o.entityType === EntityType.GROUP_FEATURE)).toBe(true);
        // A ordem entre os membros também é a de criação, não outra qualquer.
        expect(lidas.slice(1).map(o => o.data.feature_id)).toEqual(['feat-a', 'feat-b', 'feat-c']);
    });

    it('CONTROLE NEGATIVO DETERMINÍSTICO: com UUIDs decrescentes a chave antiga inverte e a nova não', async () => {
        // UUIDs em ordem lexicográfica DECRESCENTE na ordem de criação: é o pior caso exato do
        // desempate por uuid, e ele deixa de ser sorte para virar certeza.
        const uuids = ['dddd-4', 'cccc-3', 'bbbb-2', 'aaaa-1'];
        const { grupo, membros } = opsDeCriarGrupo();
        const todas = [grupo, ...membros];
        todas.forEach((op, i) => { op.id = uuids[i]; });

        // A chave ANTIGA põe o grupo em ÚLTIMO: os três filhos chegariam antes do pai e o
        // EXISTS do servidor descartaria os três, calado.
        expect(posicaoDoGrupo(todas.map(chaveAntiga), grupo.id)).toBe(3);

        // A chave de hoje põe o grupo em PRIMEIRO, com os mesmos uuids.
        for (const op of todas) await queue.enqueue(op);
        const lidas = await queue.peek(10);
        expect(lidas[0].id).toBe(grupo.id);
        expect(lidas.map(o => o.id)).toEqual(uuids);
    });

    it('20 repetições com o `generateUUID` real: a chave nova nunca inverte, a antiga inverte', async () => {
        const REPETICOES = 20;
        let inversoesAntigas = 0;

        for (let r = 0; r < REPETICOES; r++) {
            queueMap.clear();
            queue = new OperationQueue();

            const { grupo, membros } = opsDeCriarGrupo();
            const todas = [grupo, ...membros];
            for (const op of todas) await queue.enqueue(op);

            const lidas = await queue.peek(10);
            expect(lidas[0].entityType, `repetição ${r}: um membro passou na frente do grupo`)
                .toBe(EntityType.GROUP);
            expect(lidas[0].id).toBe(grupo.id);

            if (posicaoDoGrupo(todas.map(chaveAntiga), grupo.id) !== 0) inversoesAntigas++;
        }

        // O outro lado: a chave antiga TEM de errar, senão as 20 repetições acima estariam
        // passando por um caminho que nunca esteve quebrado. É a única asserção probabilística
        // do arquivo, e o número é o que a torna aceitável: a chance de o uuid do grupo ser o
        // menor dos quatro é 1/4, então a chance de nenhuma das 20 inverter é (1/4)^20, cerca
        // de 9e-13. O controle DETERMINÍSTICO acima é quem de fato sustenta a propriedade.
        expect(inversoesAntigas).toBeGreaterThan(0);
    });
});

describe('compatibilidade com a chave anterior à sequência', () => {
    it('uma op gravada no formato antigo continua sendo lida e dequeuada', async () => {
        const { grupo } = opsDeCriarGrupo();
        // Escrita DIRETA no armazenamento, no formato de antes: é assim que uma op enfileirada
        // por um build anterior está no disco quando a aba recarrega com o build novo.
        queueMap.set(chaveAntiga(grupo), grupo);

        const lidas = await queue.peek(10);
        expect(lidas).toHaveLength(1);
        expect(lidas[0].id).toBe(grupo.id);

        // O dequeue resolve a chave a partir do id, e é ele que a mudança de parse podia
        // quebrar: sem ler o formato antigo, a op ficaria no disco para sempre e seria
        // reenviada a cada flush.
        expect(await queue.dequeue([grupo.id])).toBe(1);
        expect(queueMap.size).toBe(0);
    });

    it('as duas formas convivem, e a antiga (de uma sessão anterior) vem antes', async () => {
        const { grupo, membros } = opsDeCriarGrupo();
        // Um milissegundo ANTES, que é o que uma sessão anterior necessariamente produz: o
        // recarregamento que troca o build custa muito mais que um milissegundo.
        const antiga = { ...grupo, id: 'ffff-antiga', timestamp: INSTANTE - 1 };
        queueMap.set(chaveAntiga(antiga), antiga);

        for (const op of [grupo, ...membros]) await queue.enqueue(op);

        const lidas = await queue.peek(10);
        expect(lidas).toHaveLength(5);
        expect(lidas[0].id).toBe('ffff-antiga');
        expect(lidas[1].id).toBe(grupo.id);
    });

    it('envelope sem `lamportTimestamp` usável não quebra a chave nem o dequeue', async () => {
        const { grupo } = opsDeCriarGrupo();
        for (const semSequencia of [undefined, null, NaN, -1, 'x']) {
            queueMap.clear();
            queue = new OperationQueue();
            const op = { ...grupo, id: `op-${String(semSequencia)}`, lamportTimestamp: semSequencia };

            await queue.enqueue(op);
            const lidas = await queue.peek(10);
            expect(lidas).toHaveLength(1);
            expect(lidas[0].id).toBe(op.id);
            expect(await queue.dequeue([op.id])).toBe(1);
        }
    });
});

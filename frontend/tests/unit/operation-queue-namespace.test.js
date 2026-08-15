// Path: tests/unit/operation-queue-namespace.test.js

/**
 * O PORTÃO DA FILA POR ATLAS (E2B, inteira).
 *
 * Este arquivo já disse duas coisas diferentes, e as duas eram a descrição fiel do código
 * do dia. Primeiro disse que a fila era UMA, global, e que trocar de atlas a esvaziava para
 * todo mundo, o que eram dois defeitos alcançáveis pelo gesto mais comum do produto.
 * Depois disse que o banco continuava sendo um só, com o isolamento vindo do carimbo na
 * operação mais um filtro em toda leitura. Agora o banco é um POR ATLAS
 * (`ebgeo__<sufixo>`), e a diferença não é estética: um filtro é uma regra que um chamador
 * futuro esquece, um banco separado é um fato do navegador.
 *
 * POR ISSO AS ASSERÇÕES SÃO POR NOME ABSOLUTO DE BANCO, e não pelo acessor. Um teste que
 * lesse tudo por `queue.peek()` ficaria verde com a fila global de volta e o filtro
 * funcionando, que é exatamente o estado anterior: o endereço é a propriedade nova, então é
 * o endereço que se assere.
 */

import { describe, it, expect, vi } from 'vitest';

const { dbs, createdWith, makeStore, resetFake } = vi.hoisted(() => {
    const dbs = new Map();
    const createdWith = [];

    function keyOf(name, storeName) {
        return `${name}::${storeName || 'keyvaluepairs'}`;
    }

    function makeStore({ name, storeName = null }) {
        createdWith.push({ name, storeName });
        const key = keyOf(name, storeName);
        const backing = dbs.get(key) ?? new Map();
        dbs.set(key, backing);
        return {
            setItem: async (k, v) => { backing.set(k, v); return v; },
            getItem: async (k) => (backing.has(k) ? backing.get(k) : null),
            removeItem: async (k) => { backing.delete(k); },
            keys: async () => [...backing.keys()],
            clear: async () => { backing.clear(); }
        };
    }

    function resetFake() {
        dbs.clear();
        createdWith.length = 0;
    }

    return { dbs, createdWith, makeStore, resetFake };
});

vi.mock('localforage', () => ({
    default: {
        createInstance: vi.fn(makeStore),
        dropInstance: vi.fn(async () => {})
    }
}));

/** O banco da fila do slot LEGADO: o mesmo nome de sempre, e é isso que evita cópia. */
const FILA_LEGADA = 'ebgeo::operation_queue';

/**
 * @param {string} sufixo - Sufixo de banco de um escopo.
 * @returns {string} Chave do banco de fila daquele escopo no disco falso.
 */
function filaDe(sufixo) {
    return sufixo === '' ? FILA_LEGADA : `ebgeo__${sufixo}::operation_queue`;
}

/** Both modules keep module-level state (the instance cache, the active scope). */
async function loadFresh() {
    vi.resetModules();
    resetFake();
    const namespace = await import('../../src/js/store/atlas-namespace.js');
    const factory = await import('../../src/js/store/sync/operation-factory.js');
    const queueModule = await import('../../src/js/store/sync/operation-queue.js');
    return { namespace, factory, queueModule, queue: new queueModule.OperationQueue() };
}

/**
 * Uma operação carimbada PELA FÁBRICA, com o escopo que estiver ativo. Usar a fábrica de
 * verdade (e não um envelope escrito à mão) é o que liga o portão ao carimbo: um teste que
 * fabricasse o `scopeSuffix` na mão continuaria verde se a fábrica parasse de carimbar.
 * @param {Object} factory - The operation-factory module.
 * @param {string} entityId
 * @param {number} [timestamp] - Overrides the wall clock, so key order is deterministic
 *   (ops created in the same millisecond are ordered by their random UUID).
 * @returns {Object} Operation envelope.
 */
function stampedOp(factory, entityId, timestamp = null) {
    const op = factory.createOperation(
        'feature', 'create', entityId, '4a22f7df-df6d-47df-80bb-f26df86d31ec', { nome: entityId }
    );
    if (timestamp !== null) op.timestamp = timestamp;
    return op;
}

describe('fila de operações sob o namespace por atlas', () => {
    it('cada atlas escreve no SEU banco, e o slot legado continua sendo `ebgeo`', async () => {
        const { namespace, factory, queue } = await loadFresh();
        expect(namespace.getActiveScope()).toBeNull();

        // Sem nada montado a fila cai no endereço legado, que é o banco de hoje: uma leitura
        // cedo demais (o boot liga o log de operações antes de montar) não pode nem estourar
        // nem inventar um banco novo.
        await queue.enqueue(stampedOp(factory, 'sem-escopo'));
        expect([...dbs.keys()]).toEqual([FILA_LEGADA]);

        namespace.activateScope(namespace.localScope('atlas-a', 'aaa'));
        await queue.enqueue(stampedOp(factory, 'com-escopo'));
        namespace.activateScope(namespace.remoteScope('server1'));
        await queue.enqueue(stampedOp(factory, 'remoto'));

        expect([...dbs.keys()].sort()).toEqual([
            FILA_LEGADA, filaDe('aaa'), filaDe('remote-server1')
        ].sort());
        expect(dbs.get(FILA_LEGADA).size).toBe(1);
        expect(dbs.get(filaDe('aaa')).size).toBe(1);
        expect(dbs.get(filaDe('remote-server1')).size).toBe(1);
        // O object store é o mesmo em todos: só o NOME DO BANCO carrega o namespace.
        for (const criado of createdWith) {
            expect(criado.storeName).toBe('operation_queue');
        }
    });

    it('PORTÃO: enfileirar em A e ativar B → B não vê a op de A; voltar para A a vê', async () => {
        const { namespace, factory, queue } = await loadFresh();
        namespace.activateScope(namespace.localScope('atlas-a', 'aaa'));
        await queue.enqueue(stampedOp(factory, 'op-de-A'));

        // Asserção POSITIVA antes de qualquer negativa: sem ela, um zero adiante seria
        // indistinguível de uma fila que nunca recebeu nada.
        expect(await queue.count()).toBe(1);
        expect((await queue.peek(10)).map(o => o.entityId)).toEqual(['op-de-A']);

        namespace.activateScope(namespace.localScope('atlas-b', 'bbb'));
        expect(await queue.peek(10)).toEqual([]);
        expect(await queue.getAll()).toEqual([]);
        expect(await queue.count()).toBe(0);
        // E o dado NÃO foi destruído, nem está no banco de B: está no de A. (O banco de B
        // EXISTE, porque ler as chaves abre o banco; o que ele não tem é conteúdo.)
        expect(dbs.get(filaDe('aaa')).size).toBe(1);
        expect(dbs.get(filaDe('bbb')).size).toBe(0);

        namespace.activateScope(namespace.localScope('atlas-a', 'aaa'));
        expect((await queue.peek(10)).map(o => o.entityId)).toEqual(['op-de-A']);
    });

    it('PORTÃO: dois atlas de SERVIDOR não se enxergam (o caso das duas abas)', async () => {
        const { namespace, factory, queue } = await loadFresh();
        namespace.activateScope(namespace.remoteScope('atlasX'));
        await queue.enqueue(stampedOp(factory, 'op-em-X'));
        namespace.activateScope(namespace.remoteScope('atlasY'));
        await queue.enqueue(stampedOp(factory, 'op-em-Y'));

        expect((await queue.peek(10)).map(o => o.entityId)).toEqual(['op-em-Y']);
        namespace.activateScope(namespace.remoteScope('atlasX'));
        expect((await queue.peek(10)).map(o => o.entityId)).toEqual(['op-em-X']);

        // E o endereço, que é a propriedade nova: são dois bancos, não um com filtro.
        expect([...dbs.get(filaDe('remote-atlasX')).values()].map(o => o.entityId))
            .toEqual(['op-em-X']);
        expect([...dbs.get(filaDe('remote-atlasY')).values()].map(o => o.entityId))
            .toEqual(['op-em-Y']);
    });

    it('PORTÃO: clear() em B NÃO apaga a op de A (a perda de dado que motivou a etapa)', async () => {
        const { namespace, factory, queue } = await loadFresh();
        namespace.activateScope(namespace.remoteScope('atlasX'));
        await queue.enqueueAll([
            stampedOp(factory, 'x1', 1700000000001), stampedOp(factory, 'x2', 1700000000002)
        ]);
        namespace.activateScope(namespace.localScope('atlas-b', 'bbb'));
        await queue.enqueue(stampedOp(factory, 'b1', 1700000000003));

        // A aba B troca de projeto: `unmountCurrentAtlas` chama `clear()` com B montado.
        await queue.clear();

        expect(await queue.count()).toBe(0);
        expect(dbs.get(filaDe('bbb')).size).toBe(0);
        namespace.activateScope(namespace.remoteScope('atlasX'));
        expect((await queue.peek(10)).map(o => o.entityId)).toEqual(['x1', 'x2']);
        expect(dbs.get(filaDe('remote-atlasX')).size).toBe(2);

        // E o clear do PRÓPRIO atlas continua esvaziando: sem esta metade, "não apagou a de
        // A" seria indistinguível de um clear que virou no-op.
        await queue.clear();
        expect(await queue.count()).toBe(0);
        expect(dbs.get(filaDe('remote-atlasX')).size).toBe(0);
    });

    it('op SEM carimbo (build anterior) é legível do escopo em cujo banco ela está', async () => {
        const { namespace, queue } = await loadFresh();
        // Escrita direta no banco legado: é a forma que está no disco de quem atualizou o app
        // com fila pendente. Recusá-la seria abandonar trabalho real que ninguém reendereça.
        const legada = {
            id: 'op-legada', entityType: 'feature', operationType: 'create',
            entityId: 'antiga', mapId: 'map-1', data: {}, previousData: null,
            timestamp: 1700000000000, lamportTimestamp: 1, clientId: 'c1'
        };
        await queue.enqueue(legada);
        expect(dbs.get(FILA_LEGADA).size).toBe(1);

        // O slot legado é quem tem aquele banco montado, e é quem a lê.
        namespace.activateScope(namespace.localScope('atlas-legado', ''));
        expect((await queue.peek(10)).map(o => o.id)).toEqual(['op-legada']);

        // Um atlas com namespace próprio nem abre aquele banco: não é filtro, é outro endereço.
        namespace.activateScope(namespace.remoteScope('atlasX'));
        expect(await queue.peek(10)).toEqual([]);
        expect(dbs.get(FILA_LEGADA).size).toBe(1);
    });

    it('sem escopo ativo a fila cai no endereço legado, e não em lugar nenhum', async () => {
        const { namespace, factory, queue } = await loadFresh();
        namespace.activateScope(namespace.remoteScope('atlasX'));
        await queue.enqueue(stampedOp(factory, 'x1'));
        namespace.activateScope(namespace.localScope('atlas-legado', ''));
        await queue.enqueue(stampedOp(factory, 'legada'));

        namespace.clearActiveScope();

        // Nem estoura (o `getStore` cru estouraria) nem enxerga o atlas remoto: enxerga
        // exatamente o banco que o build pré-namespace usava.
        expect((await queue.getAll()).map(o => o.entityId)).toEqual(['legada']);
        expect(await queue.count()).toBe(1);
    });

    // `initServices()` liga o expurgo periódico ANTES de `initLocalAtlases()`. Com a fila
    // por atlas e sem recuo, a primeira batida morreria com "no active atlas scope" dentro
    // de um `catch` que só faz `console.warn`: um coletor que nunca coleta, em silêncio.
    it('o expurgo periódico funciona antes de qualquer atlas ser montado', async () => {
        const { namespace, queue } = await loadFresh();
        expect(namespace.getActiveScope()).toBeNull();
        const antiga = {
            id: 'op-velha', entityType: 'feature', operationType: 'create',
            entityId: 'antiga', mapId: 'map-1', data: {}, previousData: null,
            timestamp: 1, lamportTimestamp: 1, clientId: 'c1'
        };
        await queue.enqueue(antiga);
        expect(dbs.get(FILA_LEGADA).size).toBe(1);

        const expurgadas = await queue.purgeOldOperations(1000);

        expect(expurgadas).toBe(1);
        expect(dbs.get(FILA_LEGADA).size).toBe(0);
    });

    it('dequeue resolve a chave do DISCO, não de um índice em memória', async () => {
        // O defeito das duas abas: a instância 1 construiu seu índice antes de a instância 2
        // escrever, então `peek` (disco) devolvia a op da outra e `dequeue` (índice) não a
        // removia — a fila era empurrada de novo a cada 1,5 s, para sempre, sem drenar.
        const { namespace, factory, queueModule, queue: aba1 } = await loadFresh();
        namespace.activateScope(namespace.remoteScope('atlasX'));

        await aba1.enqueue(stampedOp(factory, 'da-aba-1', 1700000000001));
        await aba1.peek(10); // aquece qualquer estado interno da instância 1

        const aba2 = new queueModule.OperationQueue();
        await aba2.enqueue(stampedOp(factory, 'da-aba-2', 1700000000002));

        const vistas = await aba1.peek(10);
        expect(vistas.map(o => o.entityId)).toEqual(['da-aba-1', 'da-aba-2']);

        const removidas = await aba1.dequeue(vistas.map(o => o.id));
        expect(removidas).toBe(2);
        expect(dbs.get(filaDe('remote-atlasX')).size).toBe(0);
        expect(await aba1.count()).toBe(0);
    });

    it('peek(n) devolve n ops DO ESCOPO, não as n primeiras do disco', async () => {
        const { namespace, factory, queue } = await loadFresh();
        namespace.activateScope(namespace.localScope('atlas-b', 'bbb'));
        await queue.enqueueAll([
            stampedOp(factory, 'b1', 1700000000001), stampedOp(factory, 'b2', 1700000000002)
        ]);
        namespace.activateScope(namespace.remoteScope('atlasX'));
        await queue.enqueueAll([
            stampedOp(factory, 'x1', 1700000000003), stampedOp(factory, 'x2', 1700000000004)
        ]);

        expect((await queue.peek(2)).map(o => o.entityId)).toEqual(['x1', 'x2']);
        expect((await queue.peek(1)).map(o => o.entityId)).toEqual(['x1']);
    });

    // ------------------------------------------------------------------------------------
    // O carimbo sobrevive à separação física, e vira ASSERÇÃO sobre ela: uma op de outro
    // endereço encontrada neste banco é uma migração que não terminou. Ela é deixada em paz,
    // nunca apagada, que é a diferença entre um portão e uma perda de dado.
    // ------------------------------------------------------------------------------------
    it('op de OUTRO endereço encontrada neste banco não é lida nem apagada', async () => {
        const { namespace, queue } = await loadFresh();
        namespace.activateScope(namespace.localScope('atlas-b', 'bbb'));
        await queue.enqueue({
            id: 'op-forasteira', entityType: 'feature', operationType: 'create',
            entityId: 'de-outro-atlas', mapId: 'map-1', data: {}, previousData: null,
            timestamp: 1700000000000, lamportTimestamp: 1, clientId: 'c1',
            scopeSuffix: 'remote-atlasX'
        });
        expect(dbs.get(filaDe('bbb')).size).toBe(1);

        expect(await queue.peek(10)).toEqual([]);
        expect(await queue.count()).toBe(0);

        await queue.clear();
        expect(dbs.get(filaDe('bbb')).size).toBe(1);
    });
});

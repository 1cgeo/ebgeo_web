// Path: tests/integration/fila-contagem-por-estado.test.js

/**
 * @fileoverview A contagem da fila de saida separada por ESTADO, e o gate do laco de flush.
 *
 * O DEFEITO QUE ESTE ARQUIVO PRENDE (F3, F4, F16 do plano de lancamento). `count()` respondia
 * "todo envelope no disco" e `hasWorkToFlush` lia isso como "ha o que enviar". Com uma operacao
 * recusada e mais nada na fila, o laco acordava a cada 1,5 s, chamava `engine.flush()`, empurrava
 * ZERO operacoes e registrava um SYNC_SUCESSO por rodada vazia: telemetria de sucesso para uma
 * fila travada, e uma luz que nunca desliga.
 *
 * AS TRES PROPRIEDADES QUE ESTE ARQUIVO COBRA, e nenhuma delas se deduz da outra:
 *
 *   1. `count()` responde o ENVIAVEL, e enviavel e' exatamente o que `peek()` entregaria: sem
 *      problema proprio, sem dependencia bloqueada e antes de qualquer intencao preparada.
 *   2. `countByState()` responde os TRES numeros numa varredura so, e eles SOMAM o que a
 *      contagem antiga respondia. Quem precisa do total (o aviso de saida, o censo de
 *      pendencias, a luz) soma os tres; quem precisa do enviavel le `count()`.
 *   3. Com zero enviavel, o laco NAO chama `flush()` e NAO registra sucesso.
 *
 * O CONTROLE NEGATIVO E' A CONTAGEM ANTIGA, reimplementada aqui em {@link contagemAntiga}: cada
 * caso afirma o numero que ela daria ao lado do numero novo. Sem essa metade, uma contagem que
 * respondesse zero por engano (ler as chaves erradas, por exemplo) passaria verde nos casos de
 * problema, e zero e' a resposta que autoriza o descarte do trabalho.
 */

import 'fake-indexeddb/auto';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
    activateScope,
    clearActiveScope,
    getStoreFor,
    remoteScope,
    StoreName
} from '../../src/js/store/atlas-namespace.js';
import {
    OperationQueue,
    operationBelongsToScope,
    operationQueue
} from '../../src/js/store/sync/operation-queue.js';

/** Telemetria: o SYNC_SUCESSO por rodada vazia e' metade do defeito, entao ela e' observada. */
const uso = vi.hoisted(() => ({ registros: [] }));
vi.mock('@js/session/uso-lote.js', () => ({
    registrarUso: (evento, prop) => { uso.registros.push([evento, prop]); },
    descarregarUso: () => {},
}));

// O engine real arrasta a pilha inteira de sync so por ser importado; cada teste injeta o seu.
vi.mock('../../src/js/store/sync/sync-engine.js', () => ({
    syncEngine: { flush: vi.fn(async () => ({ pushed: 0 })) },
}));

import { startAutoFlush, stopAutoFlush } from '../../src/js/store/sync/sync-flush.js';
import { connectionState, ConnectionStates } from '../../src/js/store/sync/connection-state.js';
import { EventoDeUso, PropDeUso } from '../../src/js/session/eventos-de-uso.js';

/** Um envelope minimo do protocolo corrente. */
function op(id, extra = {}) {
    return { protocolVersion: 2, id, entityId: id, entityType: 'map', operationType: 'create',
        timestamp: 1000, ...extra };
}

/**
 * A CONTAGEM ANTIGA, byte a byte: todo envelope do escopo, sem olhar estado nem problema.
 * @param {object} store - Loja da fila.
 * @param {string} scopeSuffix - Carimbo do escopo.
 * @returns {Promise<number>}
 */
async function contagemAntiga(store, scopeSuffix) {
    const keys = (await store.keys()).filter(key => key.startsWith('op_')).sort();
    const envelopes = await Promise.all(keys.map(key => store.getItem(key)));
    return envelopes.filter(envelope => envelope && operationBelongsToScope(envelope, scopeSuffix)).length;
}

/**
 * Uma fila limpa num atlas de servidor proprio de cada caso.
 * @param {string} atlasId - UUID do atlas.
 * @returns {Promise<{queue: OperationQueue, store: object, scope: object}>}
 */
async function filaLimpa(atlasId) {
    const scope = remoteScope(atlasId);
    const store = getStoreFor(StoreName.OPERATION_QUEUE, scope);
    await store.clear();
    return { queue: new OperationQueue(scope), store, scope };
}

describe('Censo da fila por estado', () => {
    it('uma op recusada sozinha nao e enviavel, e o censo a nomeia como problema', async () => {
        const { queue, store, scope } = await filaLimpa('11111111-0000-4000-8000-000000000001');
        const recusada = op('recusada');
        await queue.enqueue(recusada);
        await queue.recordIssue(recusada, { success: false, reason: 'Permissão revogada' });

        expect(await queue.countByState()).toEqual({ pendentes: 0, preparadas: 0, problemas: 1 });
        expect(await queue.count()).toBe(0);
        expect(await queue.peek()).toEqual([]);

        // CONTROLE NEGATIVO: a contagem antiga responde 1, e era esse 1 que acordava o laco.
        expect(await contagemAntiga(store, scope.dbSuffix)).toBe(1);
        // E o envelope continua no disco: nada aqui poda pendencia sem decisao.
        expect(await queue.getAll()).toEqual([recusada]);
    });

    it('a intencao preparada nao e enviavel, e segura tambem quem entrou depois dela', async () => {
        const { queue, store, scope } = await filaLimpa('11111111-0000-4000-8000-000000000002');
        const preparada = op('preparada');
        await queue.enqueueAll([preparada], { prepared: true });
        await queue.enqueueAll([op('depois')]);

        // O carregador PARA na marca de preparo, entao a op posterior tambem nao sai.
        expect(await queue.countByState()).toEqual({ pendentes: 0, preparadas: 2, problemas: 0 });
        expect(await queue.count()).toBe(0);
        expect(await queue.peek()).toEqual([]);
        expect(await contagemAntiga(store, scope.dbSuffix)).toBe(2);

        // CONTROLE POSITIVO: materializada a projecao, as duas viram enviaveis.
        await queue.markMaterialized([preparada]);
        expect(await queue.countByState()).toEqual({ pendentes: 2, preparadas: 0, problemas: 0 });
        expect(await queue.count()).toBe(2);
        expect((await queue.peek()).map(o => o.id)).toEqual(['preparada', 'depois']);
    });

    it('quem depende de uma op com problema nao e enviavel, e o censo casa com o peek', async () => {
        const { queue, store, scope } = await filaLimpa('11111111-0000-4000-8000-000000000003');
        const parent = op('parent', { entityId: 'briefing', entityType: 'briefing' });
        await queue.enqueueAll([
            parent,
            op('slide', { entityId: 'slide', entityType: 'slide', data: { briefingId: 'briefing' } }),
            op('child', { entityId: 'child', dependsOn: ['slide'] }),
            op('independent', { entityId: 'other' }),
        ]);
        await queue.recordIssue(parent, { success: false, reason: 'Permissão revogada' });

        expect(await queue.countByState()).toEqual({ pendentes: 1, preparadas: 0, problemas: 3 });
        expect(await queue.count()).toBe(1);
        // A MESMA REGRA DOS DOIS LADOS: o censo conta exatamente o que o carregador entregaria.
        expect((await queue.peek(100)).map(o => o.id)).toEqual(['independent']);

        // CONTROLE NEGATIVO: a contagem antiga responde 4, e os tres estados somam esse 4.
        expect(await contagemAntiga(store, scope.dbSuffix)).toBe(4);
        const censo = await queue.countByState();
        expect(censo.pendentes + censo.preparadas + censo.problemas).toBe(4);
    });

    it('op de outro escopo continua fora dos tres numeros', async () => {
        const { queue, store, scope } = await filaLimpa('11111111-0000-4000-8000-000000000004');
        await queue.enqueue(op('minha'));
        await store.setItem('op_z00000000000000000099_alheia',
            { ...op('alheia'), scopeSuffix: 'remote-outro-atlas' });

        expect(await queue.countByState()).toEqual({ pendentes: 1, preparadas: 0, problemas: 0 });
        // CONTROLE NEGATIVO: contar as chaves daria 2, e a de outro endereco nao e trabalho deste
        // atlas. A contagem antiga ja aplicava o mesmo predicado, e o censo nao pode afrouxa-lo.
        expect(await contagemAntiga(store, scope.dbSuffix)).toBe(1);
        expect((await store.keys()).filter(k => k.startsWith('op_'))).toHaveLength(2);
    });
});

describe('O laco de flush so olha o enviavel', () => {
    const atlasId = '11111111-0000-4000-8000-000000000005';

    beforeEach(async () => {
        uso.registros = [];
        const store = getStoreFor(StoreName.OPERATION_QUEUE, remoteScope(atlasId));
        await store.clear();
        activateScope(remoteScope(atlasId));
        connectionState.transition(ConnectionStates.CONNECTING);
        connectionState.transition(ConnectionStates.ONLINE);
    });

    afterEach(() => {
        stopAutoFlush();
        clearActiveScope();
        connectionState.transition(ConnectionStates.OFFLINE);
    });

    it('com zero enviavel e um problema, nao chama flush nem registra sucesso', async () => {
        const recusada = op('recusada');
        await operationQueue.enqueue(recusada);
        await operationQueue.recordIssue(recusada, { success: false, reason: 'Permissão revogada' });

        const engine = { flush: vi.fn(async () => ({ pushed: 0 })) };
        startAutoFlush(engine, { intervalMs: 20 });
        await new Promise(resolve => setTimeout(resolve, 120));

        expect(engine.flush).not.toHaveBeenCalled();
        expect(uso.registros).toEqual([]);

        // CONTROLE POSITIVO, no mesmo laco: uma op enviavel acorda o flush e a telemetria. Sem
        // esta metade, um gate que nunca disparasse passaria verde na metade de cima.
        await operationQueue.enqueue(op('enviavel'));
        await new Promise(resolve => setTimeout(resolve, 120));
        expect(engine.flush).toHaveBeenCalled();
        expect(uso.registros).toContainEqual([EventoDeUso.SYNC_RESULTADO, PropDeUso.SYNC_SUCESSO]);
    });
});

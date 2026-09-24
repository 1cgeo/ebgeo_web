// Path: tests/integration/fila-nao-varre-metadado.repro.test.js
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { getStoreFor, remoteScope, StoreName } from '../../src/js/store/atlas-namespace.js';
import { OperationQueue, listKeysWithPrefix } from '../../src/js/store/sync/operation-queue.js';
import { JournalKey } from '../../src/js/store/sync/queue-journal.js';

/**
 * @fileoverview A fila de saida nao varre o banco inteiro a cada ciclo de envio.
 *
 * O DEFEITO. O banco da fila guarda mais que envelopes: cada op traz identidade e cabeca, e o
 * ponteiro `FEATURE_LATEST` FICA depois do recibo, um por feicao que este cliente ja escreveu no
 * atlas. `countByState` (o tique de 1,5 s do auto-flush), `peek` e `dequeue` (uma vez por push de
 * 25) listavam as chaves com `store.keys()`, que no localforage e um cursor sobre o banco INTEIRO.
 * Medido no Chromium em 2026-09-23: depois de importar 8 000 feicoes, o tique ocioso custava 40 ms
 * com a fila VAZIA, para sempre; drenar as 8 000 custava 75 s de cliente alem da rede, e 2 000
 * drenavam em 9 s (quadratico). Com a leitura por faixa de chave: 0,3 ms e 9,4 s.
 *
 * O QUE ESTE ARQUIVO PRENDE. Um ciclo de envio (censo, recorte, retirada e a projecao do fim do
 * flush) sobre um IndexedDB REAL (fake-indexeddb) nao abre cursor nenhum e nao chama
 * `store.keys()`. A contagem de chamadas e o que separa "le a faixa" de "le tudo", e ela nao
 * depende de relogio, que numa maquina carregada nao distingue linear de quadratico. As respostas
 * sao conferidas ao lado, porque uma leitura rapida que responde errado e pior que a lenta.
 */

const ATLAS_ID = '77777777-0000-4000-8000-000000000001';
const MAP_ID = '77777777-0000-4000-8000-0000000000aa';

/**
 * @param {number} index
 * @param {string} [atlasId] - Atlas whose scope stamps the envelope.
 * @returns {Object} A feature CREATE envelope with its own entity.
 */
function envelope(index, atlasId = ATLAS_ID) {
    return {
        protocolVersion: 2,
        id: `op-${String(index).padStart(5, '0')}`,
        entityType: 'feature',
        operationType: 'create',
        entityId: `feicao-${index}`,
        mapId: MAP_ID,
        timestamp: 1000,
        lamportTimestamp: index + 1,
        scopeSuffix: remoteScope(atlasId).dbSuffix,
        data: { properties: { id: `feicao-${index}`, source: 'point' } },
    };
}

describe('fila de saida: o ciclo de envio le por faixa de chave', () => {
    const spies = [];
    afterEach(() => { while (spies.length) spies.pop().mockRestore(); });

    it('censo, recorte e retirada nao varrem o metadado que o recibo deixa para tras', async () => {
        const scope = remoteScope(ATLAS_ID);
        const store = getStoreFor(StoreName.OPERATION_QUEUE, scope);
        await store.clear();
        const queue = new OperationQueue(scope);

        // 300 ops confirmadas deixam 300 ponteiros FEATURE_LATEST, que e o estado de todo atlas
        // em que alguem ja importou: o metadado cresce com a historia, nao com a fila.
        const confirmadas = Array.from({ length: 300 }, (_, i) => envelope(i));
        await queue.enqueueAll(confirmadas);
        expect(await queue.dequeue(confirmadas.map(op => op.id))).toBe(300);
        const latest = await listKeysWithPrefix(store, JournalKey.FEATURE_LATEST);
        expect(latest).toHaveLength(300);

        const pendentes = Array.from({ length: 60 }, (_, i) => envelope(1000 + i));
        await queue.enqueueAll(pendentes);

        const keys = vi.spyOn(store, 'keys');
        const cursor = vi.spyOn(IDBObjectStore.prototype, 'openKeyCursor');
        const valueCursor = vi.spyOn(IDBObjectStore.prototype, 'openCursor');
        spies.push(keys, cursor, valueCursor);

        expect(await queue.countByState()).toEqual({ pendentes: 60, preparadas: 0, problemas: 0 });
        const lote = await queue.peek(25);
        expect(lote.map(op => op.id)).toEqual(pendentes.slice(0, 25).map(op => op.id));
        expect(await queue.dequeue(lote.map(op => op.id))).toBe(25);
        expect((await queue.getPendingProjection()).map(op => op.id))
            .toEqual(pendentes.slice(25).map(op => op.id));

        expect(keys).not.toHaveBeenCalled();
        expect(cursor).not.toHaveBeenCalled();
        expect(valueCursor).not.toHaveBeenCalled();

        // A retirada levou os metadados da op junto, e deixou o ponteiro que o recibo preserva.
        for (const op of lote) {
            expect(await store.getItem(JournalKey.ID + op.id)).toBeNull();
            expect(await store.getItem(JournalKey.FEATURE_LATEST + op.entityId)).toBeTruthy();
        }
    });

    it('o tique ocioso com a fila vazia nao le chave de metadado nenhuma', async () => {
        const atlasId = '77777777-0000-4000-8000-000000000002';
        const scope = remoteScope(atlasId);
        const store = getStoreFor(StoreName.OPERATION_QUEUE, scope);
        await store.clear();
        const queue = new OperationQueue(scope);
        const confirmadas = Array.from({ length: 200 }, (_, i) => envelope(i, atlasId));
        await queue.enqueueAll(confirmadas);
        await queue.dequeue(confirmadas.map(op => op.id));

        const keys = vi.spyOn(store, 'keys');
        const getAllKeys = vi.spyOn(IDBObjectStore.prototype, 'getAllKeys');
        spies.push(keys, getAllKeys);

        expect(await queue.countByState()).toEqual({ pendentes: 0, preparadas: 0, problemas: 0 });
        expect(keys).not.toHaveBeenCalled();
        // UMA faixa, a dos envelopes, e ela volta vazia: as de problema e de estado nem sao lidas.
        expect(getAllKeys).toHaveBeenCalledTimes(1);
        const [range] = getAllKeys.mock.calls[0];
        expect(range.includes('op_z1')).toBe(true);
        expect(range.includes(JournalKey.FEATURE_LATEST + 'feicao-1')).toBe(false);
    });

    it('um problema e uma intencao preparada continuam contados pela faixa', async () => {
        const atlasId = '77777777-0000-4000-8000-000000000003';
        const scope = remoteScope(atlasId);
        const store = getStoreFor(StoreName.OPERATION_QUEUE, scope);
        await store.clear();
        const queue = new OperationQueue(scope);
        const [a, b, c] = [envelope(1, atlasId), envelope(2, atlasId), envelope(3, atlasId)];
        await queue.enqueueAll([a, b]);
        await queue.enqueueAll([c], { prepared: true });
        await queue.recordIssue(a, { success: false, reason: 'recusada' });

        expect(await queue.countByState()).toEqual({ pendentes: 1, preparadas: 1, problemas: 1 });
        expect((await queue.peek(25)).map(op => op.id)).toEqual([b.id]);
    });
});

describe('listKeysWithPrefix', () => {
    it('devolve exatamente o prefixo, em ordem, sem o vizinho lexicografico', async () => {
        const scope = remoteScope('77777777-0000-4000-8000-000000000004');
        const store = getStoreFor(StoreName.OPERATION_QUEUE, scope);
        await store.clear();
        for (const key of ['op_b', 'op_a', 'op`x', 'op', 'opa', '__journal_issue__x', 'op_é']) {
            await store.setItem(key, 1);
        }
        expect(await listKeysWithPrefix(store, 'op_')).toEqual(['op_a', 'op_b', 'op_é']);
        expect(await listKeysWithPrefix(store, JournalKey.ISSUE)).toEqual(['__journal_issue__x']);
    });

    it('cai na listagem inteira filtrada quando o armazenamento nao e IndexedDB', async () => {
        const memoria = new Map([['op_2', 1], ['op_1', 1], ['__journal_id__x', 1]]);
        const adaptador = { keys: async () => [...memoria.keys()] };
        expect(await listKeysWithPrefix(adaptador, 'op_')).toEqual(['op_1', 'op_2']);
    });
});

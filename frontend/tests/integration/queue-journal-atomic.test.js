// Path: tests/integration/queue-journal-atomic.test.js
import 'fake-indexeddb/auto';
import localforage from 'localforage';
import { describe, it, expect, vi } from 'vitest';
import { appendJournal, JournalKey } from '../../src/js/store/sync/queue-journal.js';
import { getStoreFor, remoteScope, StoreName } from '../../src/js/store/atlas-namespace.js';
import { OperationQueue } from '../../src/js/store/sync/operation-queue.js';
import { fenceStore } from '../../src/js/store/fenced-store.js';

describe('Queue journal IndexedDB transaction', () => {
    it('reuses the connection across fresh per-call fences without bypassing their guards', async () => {
        const store = localforage.createInstance({ name: 'journal-fresh-fences', driver: localforage.INDEXEDDB });
        await store.clear();
        const open = vi.spyOn(indexedDB, 'open');
        try {
            for (let index = 0; index < 20; index++) {
                await appendJournal(fenceStore(store, () => {}), [{ id: `op-${index}` }]);
            }
            expect(open).toHaveBeenCalledTimes(1);
            const denied = () => { throw new DOMException('discarded', 'AbortError'); };
            await expect(appendJournal(fenceStore(store, denied), [{ id: 'denied' }], { assertWritable: denied }))
                .rejects.toMatchObject({ name: 'AbortError' });
            expect((await store.keys()).filter(key => key.startsWith('op_'))).toHaveLength(20);
        } finally {
            open.mockRestore();
            await store.dropInstance();
        }
    });

    it('takes ownership of the envelope before awaiting storage readiness', async () => {
        const store = localforage.createInstance({ name: 'journal-owned-envelope', driver: localforage.INDEXEDDB });
        await store.clear();
        let release;
        const barrier = new Promise(resolve => { release = resolve; });
        const ready = store.ready.bind(store);
        const spy = vi.spyOn(store, 'ready').mockImplementationOnce(async () => { await barrier; return ready(); });
        const operation = { id: 'owned', data: { value: 'before' } };
        const pending = appendJournal(store, [operation]);
        operation.data.value = 'after';
        release();
        try {
            await pending;
            const key = (await store.keys()).find(key => key.startsWith('op_'));
            expect(await store.getItem(key)).toEqual({ id: 'owned', data: { value: 'before' } });
        } finally { spy.mockRestore(); }
    });

    it('allocates a stable sequence across handles and ignores wall-clock rollback', async () => {
        const store = localforage.createInstance({ name: 'journal-sequence', driver: localforage.INDEXEDDB });
        await store.clear();
        await appendJournal(store, [{ id: 'a', timestamp: 2000 }]);
        const reopened = localforage.createInstance({ name: 'journal-sequence', driver: localforage.INDEXEDDB });
        await appendJournal(reopened, [{ id: 'b', timestamp: 1000 }]);
        const keys = (await store.keys()).filter(key => key.startsWith('op_')).sort();
        expect((await Promise.all(keys.map(key => store.getItem(key)))).map(op => op.id)).toEqual(['a', 'b']);
    });

    it('rolls back the whole batch and sequence on an uncloneable envelope', async () => {
        const store = localforage.createInstance({ name: 'journal-rollback', driver: localforage.INDEXEDDB });
        await store.clear();
        await expect(appendJournal(store, [{ id: 'a' }, { id: 'b', data: () => {} }])).rejects.toThrow();
        expect(await store.keys()).toEqual([]);
        await appendJournal(store, [{ id: 'c' }]);
        expect(await store.getItem('__journal_sequence__')).toBe(1);
    });

    it('does not allocate a new entry when the same intention is recovered', async () => {
        const store = localforage.createInstance({ name: 'journal-recovery', driver: localforage.INDEXEDDB });
        await store.clear();
        await appendJournal(store, [{ id: 'a', data: { value: 1 } }]);
        await appendJournal(store, [{ id: 'a', data: { value: 1 } }]);
        expect((await store.keys()).filter(key => key.startsWith('op_'))).toHaveLength(1);
        expect(await store.getItem('__journal_sequence__')).toBe(1);
    });

    /**
     * A PODA DO DIÁRIO (B3 item 5).
     *
     * Até 2026-09-13 `dequeue` apagava só a chave `op_`: identidade, marca de preparo e registro
     * de problema ficavam no disco para sempre, e nenhum expurgo os alcançava. O que NÃO pode ir
     * junto é o ponteiro por feição usado depois do ack (`FEATURE_LATEST`), porque é dele que a
     * próxima edição da mesma feição tira a base confirmada.
     */
    describe('Poda do diário na confirmação', () => {
        const feature = { protocolVersion: 2, id: 'confirmada', entityType: 'feature',
            operationType: 'update', entityId: 'feicao-1', mapId: 'mapa-1', timestamp: 10 };

        /**
         * @param {string} atlasId - UUID do atlas.
         * @returns {Promise<{queue: OperationQueue, store: object}>}
         */
        async function filaComUmaFeicao(atlasId) {
            const store = getStoreFor(StoreName.OPERATION_QUEUE, remoteScope(atlasId));
            await store.clear();
            const queue = new OperationQueue(remoteScope(atlasId));
            await queue.enqueueAll([feature], { prepared: true });
            await queue.recordIssue(feature, { success: false, reason: 'Permissão revogada' });
            return { queue, store };
        }

        it('leva identidade, estado e problema, e mantém o ponteiro por feição', async () => {
            const { queue, store } = await filaComUmaFeicao('55555555-0000-4000-8000-000000000001');
            // Premissa asserida: os cinco metadados existem ANTES da poda. Sem isto, um teste que
            // afirma ausência passaria verde contra um diário que nunca escreveu nada.
            for (const key of [JournalKey.ID, JournalKey.STATE, JournalKey.ISSUE]) {
                expect(await store.getItem(key + feature.id)).toBeTruthy();
            }
            expect(await store.getItem(JournalKey.FEATURE_HEAD + feature.entityId)).toBeTruthy();
            expect(await store.getItem(JournalKey.FEATURE_LATEST + feature.entityId)).toBeTruthy();

            expect(await queue.dequeue([feature.id])).toBe(1);

            expect(await store.getItem(JournalKey.ID + feature.id)).toBeNull();
            expect(await store.getItem(JournalKey.STATE + feature.id)).toBeNull();
            expect(await store.getItem(JournalKey.ISSUE + feature.id)).toBeNull();
            expect(await store.getItem(JournalKey.FEATURE_HEAD + feature.entityId)).toBeNull();
            // O QUE FICA, e é o ponto: o ponteiro que o restore lê depois do ack.
            expect(await store.getItem(JournalKey.FEATURE_LATEST + feature.entityId))
                .toEqual({ id: feature.id, operationType: 'update', mapId: 'mapa-1' });
            // A sequência não é metadado de operação: ela mantém as chaves monotônicas.
            expect(await store.getItem('__journal_sequence__')).toBe(1);
            expect((await store.keys()).filter(key => key.startsWith('op_'))).toEqual([]);
        });

        it('o ponteiro de outra operação da mesma feição sobrevive à poda', async () => {
            const { queue, store } = await filaComUmaFeicao('55555555-0000-4000-8000-000000000002');
            const seguinte = { ...feature, id: 'seguinte', timestamp: 11 };
            await queue.enqueueAll([seguinte]);
            const cabecaDaSeguinte = await store.getItem(JournalKey.FEATURE_HEAD + feature.entityId);

            await queue.dequeue([feature.id]);

            // A cabeça aponta para a op MAIS NOVA, entao podar a antiga nao pode apaga-la.
            expect(await store.getItem(JournalKey.FEATURE_HEAD + feature.entityId)).toBe(cabecaDaSeguinte);
            expect(await store.getItem(cabecaDaSeguinte)).toEqual(seguinte);
        });

        it('clear() também leva os metadados do escopo', async () => {
            const { queue, store } = await filaComUmaFeicao('55555555-0000-4000-8000-000000000003');

            await queue.clear();

            expect((await store.keys()).filter(key => key.startsWith('op_'))).toEqual([]);
            expect(await store.getItem(JournalKey.ID + feature.id)).toBeNull();
            expect(await store.getItem(JournalKey.STATE + feature.id)).toBeNull();
            expect(await store.getItem(JournalKey.ISSUE + feature.id)).toBeNull();
            expect(await store.getItem(JournalKey.FEATURE_HEAD + feature.entityId)).toBeNull();
            expect(await store.getItem(JournalKey.FEATURE_LATEST + feature.entityId)).toBeTruthy();
        });

        it('reenfileirar um id já confirmado NÃO é silencioso', async () => {
            // O estado é o que uma poda interrompida, ou um atlas gravado antes desta mudança,
            // deixa no disco: identidade sem envelope. Antes, `appendJournal` respondia sucesso
            // e não gravava nada, então quem reofereceu a intenção foi informado de que ela
            // estava durável.
            const store = localforage.createInstance({ name: 'journal-confirmada', driver: localforage.INDEXEDDB });
            await store.clear();
            await store.setItem(JournalKey.ID + 'ja-confirmada', 'op_z00000000000000000007_ja-confirmada');

            await expect(appendJournal(store, [{ id: 'ja-confirmada', data: { value: 1 } }]))
                .rejects.toThrow(/já foi confirmada/);
            expect((await store.keys()).filter(key => key.startsWith('op_'))).toEqual([]);

            // CONTROLE POSITIVO: sem a identidade órfã, o mesmo envelope entra normalmente.
            await store.removeItem(JournalKey.ID + 'ja-confirmada');
            await appendJournal(store, [{ id: 'ja-confirmada', data: { value: 1 } }]);
            expect((await store.keys()).filter(key => key.startsWith('op_'))).toHaveLength(1);
        });
    });

    it('rejects changed content under the same id and retains the original', async () => {
        const store = localforage.createInstance({ name: 'journal-immutable', driver: localforage.INDEXEDDB });
        await store.clear();
        await appendJournal(store, [{ id: 'a', data: { value: 1 } }]);
        await expect(appendJournal(store, [{ id: 'a', data: { value: 2 } }])).rejects.toThrow();
        const key = (await store.keys()).find(key => key.startsWith('op_'));
        expect((await store.getItem(key)).data.value).toBe(1);
        expect(await store.getItem('__journal_sequence__')).toBe(1);
    });
});

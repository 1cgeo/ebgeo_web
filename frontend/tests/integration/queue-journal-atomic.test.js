// Path: tests/integration/queue-journal-atomic.test.js
import 'fake-indexeddb/auto';
import localforage from 'localforage';
import { describe, it, expect, vi } from 'vitest';
import { appendJournal } from '../../src/js/store/sync/queue-journal.js';

describe('Queue journal IndexedDB transaction', () => {
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

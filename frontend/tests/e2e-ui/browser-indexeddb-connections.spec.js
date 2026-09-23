import { test, expect } from '@playwright/test';
import { readState } from './state.js';

const state = readState();

test('repeated fenced writes coexist with readers and release the database on deletion', async ({ page }) => {
    test.skip(state.skip, state.reason);
    await page.goto('/atlas.html');
    const result = await page.evaluate(async () => {
        const { default: localforage } = await import('/node_modules/.vite/deps/localforage.js');
        const { fenceStore } = await import('/src/js/store/fenced-store.js');
        const name = `ebgeo-test-native-${crypto.randomUUID()}`;
        const store = localforage.createInstance({ name, driver: localforage.INDEXEDDB });
        await store.clear();
        const guarded = fenceStore(store, () => {});
        try {
            for (let index = 0; index < 300; index++) {
                await Promise.all([
                    store.keys(),
                    guarded.setItem('map', { index, features: Array.from({ length: 25 }, (_, id) => ({ id, geometry: [-43, -22] })) }),
                    store.getItem('map'),
                    store.keys(),
                ]);
            }
            const value = await store.getItem('map');
            // Deletion also proves that retained native handles honor versionchange.
            await store.dropInstance();
            return { index: value.index, features: value.features.length, deleted: true };
        } finally {
            await store.dropInstance();
        }
    });
    expect(result).toEqual({ index: 299, features: 25, deleted: true });
});

test('journal preparation, publication and removal reuse a connection across fresh fences', async ({ page }) => {
    test.skip(state.skip, state.reason);
    await page.goto('/atlas.html');
    const result = await page.evaluate(async () => {
        const { default: localforage } = await import('/node_modules/.vite/deps/localforage.js');
        const { fenceStore } = await import('/src/js/store/fenced-store.js');
        const { appendJournal, materializeJournal, purgeJournalEntries, JournalKey } = await import('/src/js/store/sync/queue-journal.js');
        const store = localforage.createInstance({ name: `ebgeo-test-journal-${crypto.randomUUID()}`, driver: localforage.INDEXEDDB });
        await store.clear();
        const guarded = () => fenceStore(store, () => {});
        try {
            for (let index = 0; index < 300; index++) {
                const operation = { id: `op-${index}`, entityType: 'feature', entityId: 'feature', operationType: 'update', data: { index } };
                await appendJournal(guarded(), [operation], { prepared: true });
                const key = await store.getItem(JournalKey.ID + operation.id);
                const persisted = await store.getItem(key);
                if (persisted?.data.index !== index) throw new Error(`Missing journal operation ${index}`);
                await materializeJournal(guarded(), [operation]);
                if (await store.getItem(JournalKey.STATE + operation.id)) throw new Error('Publication remained prepared');
                await purgeJournalEntries(guarded(), [{ key, id: operation.id, entityType: 'feature', entityId: 'feature' }]);
            }
            return {
                sequence: await store.getItem('__journal_sequence__'),
                pending: (await store.keys()).filter(key => key.startsWith('op_')).length,
            };
        } finally {
            await store.dropInstance();
        }
    });
    expect(result).toEqual({ sequence: 300, pending: 0 });
});

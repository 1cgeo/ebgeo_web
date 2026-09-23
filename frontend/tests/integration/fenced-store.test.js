import 'fake-indexeddb/auto';
import localforage from 'localforage';
import { forceCloseDatabase } from 'fake-indexeddb';
import { test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { fenceStore, openStoreDatabase } from '../../src/js/store/fenced-store.js';

test('a write paused before native transaction cannot recreate discarded content', async () => {
    const store = localforage.createInstance({ name: 'candidate-remote-fence', driver: localforage.INDEXEDDB });
    await store.clear();
    let allowed = true;
    const guarded = fenceStore(store, () => {
        if (!allowed) throw new DOMException('discarded', 'AbortError');
    });
    let release;
    const barrier = new Promise(resolve => { release = resolve; });
    const ready = store.ready.bind(store);
    store.ready = async () => { await barrier; return ready(); };
    const writing = guarded.setItem('old-operation', { old: true });
    allowed = false;
    store.ready = ready;
    await store.clear();
    release();
    await assert.rejects(writing, { name: 'AbortError' });
    assert.deepEqual(await store.keys(), []);
    const fresh = fenceStore(store, () => {});
    await fresh.setItem('new-operation', { fresh: true });
    await assert.rejects(guarded.clear(), { name: 'AbortError' });
    assert.deepEqual(await store.getItem('new-operation'), { fresh: true });
});

test('native values round-trip through the existing localforage reader', async () => {
    const store = localforage.createInstance({ name: 'candidate-remote-roundtrip', driver: localforage.INDEXEDDB });
    await store.clear();
    const guarded = fenceStore(store, () => {});
    const blob = new Blob(['image-content'], { type: 'image/png' });
    await guarded.setItem('blob', blob);
    assert.equal(await (await store.getItem('blob')).text(), 'image-content');
    await guarded.setItem('data', { geometry: [1, 2], absent: null });
    assert.deepEqual(await store.getItem('data'), { geometry: [1, 2], absent: null });
    await guarded.removeItem('data');
    assert.equal(await store.getItem('data'), null);
    await guarded.clear();
    assert.deepEqual(await store.keys(), []);
});

test('a native open callback arriving after discard cannot remove new-session content', async () => {
    const store = localforage.createInstance({ name: 'candidate-late-native-open', driver: localforage.INDEXEDDB });
    await store.clear();
    let allowed = true;
    const guarded = fenceStore(store, () => {
        if (!allowed) throw new DOMException('discarded', 'AbortError');
    });
    const originalOpen = indexedDB.open;
    let release;
    let reached;
    const barrier = new Promise(resolve => { release = resolve; });
    const opened = new Promise(resolve => { reached = resolve; });
    indexedDB.open = function (...args) {
        const request = originalOpen.apply(this, args);
        return new Proxy(request, {
            get(target, key) { return Reflect.get(target, key, target); },
            set(target, key, value) {
                if (key === 'onsuccess') {
                    target.onsuccess = event => { reached(); barrier.then(() => value.call(target, event)); };
                    return true;
                }
                return Reflect.set(target, key, value, target);
            },
        });
    };
    const late = guarded.removeItem('entity');
    try {
        await opened;
        indexedDB.open = originalOpen;
        allowed = false;
        await store.clear();
        await store.setItem('entity', { fromNewSession: true });
        release();
        await assert.rejects(late, { name: 'AbortError' });
        assert.deepEqual(await store.getItem('entity'), { fromNewSession: true });
    } finally {
        indexedDB.open = originalOpen;
        release();
    }
});

test('concurrent writers share a connection and deletion releases it for a fresh database', async () => {
    const name = 'candidate-native-connection-lifecycle';
    const store = localforage.createInstance({ name, driver: localforage.INDEXEDDB });
    await store.clear();
    const open = vi.spyOn(indexedDB, 'open');
    try {
        const guarded = fenceStore(store, () => {});
        await Promise.all(Array.from({ length: 20 }, (_, i) => guarded.setItem(`key-${i}`, i)));
        assert.equal((await store.keys()).length, 20);
        // Repeated native opens cause stalls/UnknownError in the real Firefox test.
        assert.equal(open.mock.calls.length, 1);
        await store.dropInstance();
        await store.clear();
        await guarded.setItem('fresh', { generation: 2 });
        assert.deepEqual(await store.keys(), ['fresh']);
        assert.deepEqual(await store.getItem('fresh'), { generation: 2 });
    } finally {
        open.mockRestore();
        await store.dropInstance();
    }
});

test('an opening failure does not poison the next attempt', async () => {
    const store = localforage.createInstance({ name: 'candidate-native-open-retry', driver: localforage.INDEXEDDB });
    await store.clear();
    const open = vi.spyOn(indexedDB, 'open').mockImplementationOnce(() => {
        throw new DOMException('temporary opening failure', 'UnknownError');
    });
    const guarded = fenceStore(store, () => {});
    try {
        await assert.rejects(guarded.setItem('failed', true), { name: 'UnknownError' });
        await guarded.setItem('retry', true);
        assert.deepEqual(await store.keys(), ['retry']);
    } finally {
        open.mockRestore();
        await store.dropInstance();
    }
});

test('abnormal connection closure is evicted without losing committed values', async () => {
    const store = localforage.createInstance({ name: 'candidate-native-force-close', driver: localforage.INDEXEDDB });
    await store.clear();
    const guarded = fenceStore(store, () => {});
    await guarded.setItem('before', 1);
    const db = await openStoreDatabase(store);
    const closed = new Promise(resolve => db.addEventListener('close', resolve, { once: true }));
    forceCloseDatabase(db);
    await closed;
    await guarded.setItem('after', 2);
    assert.equal(await store.getItem('before'), 1);
    assert.equal(await store.getItem('after'), 2);
    await store.dropInstance();
});

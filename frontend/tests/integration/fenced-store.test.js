import 'fake-indexeddb/auto';
import localforage from 'localforage';
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { fenceStore } from '../../src/js/store/fenced-store.js';

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

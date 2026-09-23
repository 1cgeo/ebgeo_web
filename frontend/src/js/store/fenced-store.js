// Path: js/store/fenced-store.js

const connections = new WeakMap();
const connectionOwners = new WeakMap();

/**
 * Share a native connection without bypassing the caller's transaction fence.
 * Reopening it for every edit stalls reads and can fail with UnknownError in
 * Firefox. Version changes/deletion and abnormal closure invalidate the handle.
 * A failed open is never retained, and this helper never creates a missing store.
 */
export function openStoreDatabase(store) {
    // Queue methods create a new fence per call, but the underlying store is stable.
    const owner = connectionOwners.get(store) ?? store;
    const existing = connections.get(owner);
    if (existing) return existing;
    const forget = () => {
        if (connections.get(owner) === pending) connections.delete(owner);
    };
    const pending = new Promise((resolve, reject) => {
        const request = indexedDB.open(store.config('name'));
        let failed = false;
        const fail = error => { failed = true; reject(error); };
        request.onerror = () => fail(request.error);
        request.onblocked = () => fail(new Error('A gravação está bloqueada por outra aba.'));
        request.onupgradeneeded = () => {
            request.transaction.abort();
            fail(new DOMException('O banco desta gravação foi desmontado.', 'AbortError'));
        };
        request.onsuccess = () => {
            const db = request.result;
            if (failed) { db.close(); return; }
            db.onversionchange = () => { forget(); db.close(); };
            db.onclose = forget;
            resolve(db);
        };
    }).catch(error => { forget(); throw error; });
    connections.set(owner, pending);
    return pending;
}

/** Check the captured discard epoch at the actual IndexedDB mutation boundary. */
async function mutate(store, assertWritable, method, args) {
    assertWritable();
    if (!store.config) {
        // In-memory repository adapters used by unit tests have no native transaction.
        const result = await store[method](...args);
        assertWritable();
        return result;
    }
    await store.ready();
    assertWritable();
    if (!globalThis.indexedDB || store.driver() !== 'asyncStorage') {
        throw new Error('O atlas remoto precisa do IndexedDB para gravar com segurança.');
    }
    const db = await openStoreDatabase(store);
    return new Promise((resolve, reject) => {
        let tx;
        try {
            assertWritable();
            tx = db.transaction(store.config('storeName'), 'readwrite');
            const rows = tx.objectStore(store.config('storeName'));
            if (method === 'setItem') rows.put(args[1] ?? null, String(args[0]));
            else if (method === 'removeItem') rows.delete(String(args[0]));
            else rows.clear();
        } catch (error) {
            tx?.abort();
            reject(error);
            return;
        }
        tx.oncomplete = () => {
            try {
                assertWritable();
                resolve(method === 'setItem' ? (args[1] ?? null) : undefined);
            } catch (error) { reject(error); }
        };
        tx.onabort = () => reject(tx.error ?? new Error('A gravação foi interrompida.'));
        tx.onerror = () => {};
    });
}

export function fenceStore(store, assertWritable) {
    const methods = new Map();
    const guarded = new Proxy(store, {
        get(target, key) {
            const value = Reflect.get(target, key, target);
            if (typeof value !== 'function') return value;
            if (!methods.has(key)) {
                methods.set(key, ['setItem', 'removeItem', 'clear'].includes(key)
                    ? (...args) => mutate(target, assertWritable, key, args)
                    : value.bind(target));
            }
            return methods.get(key);
        },
    });
    connectionOwners.set(guarded, connectionOwners.get(store) ?? store);
    return guarded;
}

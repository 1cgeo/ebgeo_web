// Path: js/store/fenced-store.js

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
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(store.config('name'));
        let failed = false;
        const fail = error => { failed = true; reject(error); };
        request.onerror = () => fail(request.error);
        request.onblocked = () => fail(new Error('A gravação está bloqueada por outra aba.'));
        request.onupgradeneeded = () => {
            // A cleared/dropped database must be initialized by the repository's driver,
            // never implicitly recreated by this late mutation.
            request.transaction.abort();
            fail(new DOMException('O banco desta gravação foi desmontado.', 'AbortError'));
        };
        request.onsuccess = () => {
            const db = request.result;
            if (failed) { db.close(); return; }
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
                db.close();
                fail(error);
                return;
            }
            tx.oncomplete = () => {
                db.close();
                try {
                    assertWritable();
                    resolve(method === 'setItem' ? (args[1] ?? null) : undefined);
                } catch (error) { fail(error); }
            };
            tx.onabort = () => { db.close(); fail(tx.error ?? new Error('A gravação foi interrompida.')); };
            tx.onerror = () => {};
        };
    });
}

export function fenceStore(store, assertWritable) {
    const methods = new Map();
    return new Proxy(store, {
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
}

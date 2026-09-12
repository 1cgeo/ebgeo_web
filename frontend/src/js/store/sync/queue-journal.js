// Path: js/store/sync/queue-journal.js

const SEQUENCE_KEY = '__journal_sequence__';
const ID_PREFIX = '__journal_id__';
const tails = new WeakMap();

/** Publish an entire materialized edit together; a crash must not expose half its operations. */
export async function materializeJournal(store, operations, assertWritable = () => {}) {
    assertWritable();
    if (!operations.length) return;
    if (!store.config) {
        // Lightweight repository adapters used by shape tests have no IDB transaction API.
        for (const operation of operations) {
            assertWritable();
            await store.removeItem('__journal_state__' + operation.id);
        }
        return;
    }
    await store.ready();
    if (!globalThis.indexedDB || store.driver() !== 'asyncStorage') {
        throw new Error('O atlas remoto precisa do IndexedDB para confirmar a gravação.');
    }
    await store.getItem(SEQUENCE_KEY);
    assertWritable();
    await new Promise((resolve, reject) => {
        const request = indexedDB.open(store.config('name'));
        let cancelled = false;
        request.onerror = () => reject(request.error);
        request.onupgradeneeded = () => {
            request.transaction.abort();
            reject(new DOMException('O banco da fila foi desmontado.', 'AbortError'));
        };
        request.onblocked = () => {
            cancelled = true;
            reject(new Error('Banco da fila ocupado por outra aba.'));
        };
        request.onsuccess = () => {
            const db = request.result;
            if (cancelled) { db.close(); return; }
            let transaction;
            let failure;
            try {
                assertWritable();
                transaction = db.transaction(store.config('storeName'), 'readwrite');
                transaction.oncomplete = () => {
                    db.close();
                    try { assertWritable(); resolve(); } catch (error) { reject(error); }
                };
                transaction.onabort = () => {
                    db.close();
                    reject(failure ?? transaction.error ?? new Error('Falha ao confirmar a gravação.'));
                };
                transaction.onerror = () => {};
                const rows = transaction.objectStore(store.config('storeName'));
                for (const operation of operations) {
                    assertWritable();
                    rows.delete('__journal_state__' + operation.id).onsuccess = () => {
                        try { assertWritable(); } catch (error) { failure = error; transaction.abort(); }
                    };
                }
            } catch (error) {
                failure = error;
                if (transaction) {
                    transaction.abort();
                } else { db.close(); reject(error); }
            }
        };
    });
}

function sameEnvelope(left, right) {
    const canonical = value => {
        if (Array.isArray(value)) return value.map(canonical);
        if (value && typeof value === 'object') {
            return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
        }
        return value;
    };
    return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function nextKey(sequence, id) {
    if (!Number.isSafeInteger(sequence) || sequence < 1) throw new Error('Sequência da fila inválida.');
    return `op_z${String(sequence).padStart(20, '0')}_${id}`;
}

/** Atomic sequence allocation and immutable envelope insertion in the queue's own database. */
export async function appendJournal(store, operations, { prepared = false, assertWritable = () => {} } = {}) {
    assertWritable();
    operations = structuredClone(operations);
    // Repository test adapters expose only the asynchronous key/value contract.
    if (!store.config) {
        const task = (tails.get(store) ?? Promise.resolve()).catch(() => {}).then(async () => {
            assertWritable();
            let sequence = await store.getItem(SEQUENCE_KEY) ?? 0;
            for (const operation of operations) {
                const identityKey = ID_PREFIX + operation.id;
                const existing = await store.getItem(identityKey);
                if (existing) {
                    const previous = await store.getItem(existing);
                    if (previous && !sameEnvelope(previous, operation)) throw new Error('O conteúdo de uma operação já registrada não pode mudar.');
                    continue;
                }
                assertWritable();
                const key = nextKey(++sequence, operation.id);
                await store.setItem(key, operation);
                await store.setItem(identityKey, key);
                if (operation.entityType === 'feature') {
                    await store.setItem('__journal_feature_head__' + operation.entityId, key);
                    await store.setItem('__journal_feature_latest__' + operation.entityId, { id: operation.id, operationType: operation.operationType, mapId: operation.mapId });
                }
                if (prepared) await store.setItem('__journal_state__' + operation.id, 'prepared');
            }
            assertWritable();
            await store.setItem(SEQUENCE_KEY, sequence);
        });
        tails.set(store, task);
        return task;
    }
    await store.ready();
    assertWritable();
    if (!globalThis.indexedDB || store.driver() !== 'asyncStorage') {
        throw new Error('O atlas remoto precisa do IndexedDB para guardar alterações com segurança.');
    }
    // `ready()` alone may retain a connection closed by another tab's versionchange.
    // A driver read performs localforage's reconnection before we open the atomic transaction.
    await store.getItem(SEQUENCE_KEY);
    assertWritable();
    const request = globalThis.indexedDB.open(store.config('name'));
    await new Promise((resolve, reject) => {
        let cancelled = false;
        request.onerror = () => reject(request.error);
        request.onupgradeneeded = () => {
            request.transaction.abort();
            reject(new DOMException('O banco da fila foi desmontado.', 'AbortError'));
        };
        request.onblocked = () => {
            cancelled = true;
            reject(new Error('Banco da fila ocupado por outra aba.'));
        };
        request.onsuccess = () => {
            const db = request.result;
            if (cancelled) { db.close(); return; }
            let transaction;
            let failure;
            try {
                assertWritable();
                transaction = db.transaction(store.config('storeName'), 'readwrite');
            } catch (error) {
                db.close();
                reject(error);
                return;
            }
            const rows = transaction.objectStore(store.config('storeName'));
            transaction.oncomplete = () => {
                db.close();
                try { assertWritable(); resolve(); } catch (error) { reject(error); }
            };
            transaction.onabort = () => { db.close(); reject(failure ?? transaction.error ?? new Error('Falha ao guardar a alteração.')); };
            transaction.onerror = () => {};
            const guarded = fn => () => {
                try { assertWritable(); fn(); } catch (error) { failure = error; transaction.abort(); }
            };
            const sequenceRequest = rows.get(SEQUENCE_KEY);
            sequenceRequest.onsuccess = guarded(() => {
                let sequence = sequenceRequest.result ?? 0;
                let index = 0;
                const appendNext = () => {
                    if (index === operations.length) {
                        rows.put(sequence, SEQUENCE_KEY);
                        return;
                    }
                    const operation = operations[index++];
                    const identityKey = ID_PREFIX + operation.id;
                    const previous = rows.get(identityKey);
                    previous.onsuccess = guarded(() => {
                        if (previous.result) {
                            const envelope = rows.get(previous.result);
                            envelope.onsuccess = guarded(() => {
                                if (envelope.result && !sameEnvelope(envelope.result, operation)) {
                                    transaction.abort();
                                    return;
                                }
                                appendNext();
                            });
                            return;
                        }
                        if (!previous.result) {
                            try {
                                const key = nextKey(++sequence, operation.id);
                                rows.put(operation, key);
                                rows.put(key, identityKey);
                                if (operation.entityType === 'feature') {
                                    rows.put(key, '__journal_feature_head__' + operation.entityId);
                                    rows.put({ id: operation.id, operationType: operation.operationType, mapId: operation.mapId }, '__journal_feature_latest__' + operation.entityId);
                                }
                                if (prepared) rows.put('prepared', '__journal_state__' + operation.id);
                            } catch {
                                transaction.abort();
                                return;
                            }
                        }
                        appendNext();
                    });
                };
                appendNext();
            });
        };
    });
}

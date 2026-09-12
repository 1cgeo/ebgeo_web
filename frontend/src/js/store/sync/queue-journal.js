// Path: js/store/sync/queue-journal.js

const SEQUENCE_KEY = '__journal_sequence__';
const ID_PREFIX = '__journal_id__';
const tails = new WeakMap();

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
export async function appendJournal(store, operations, { prepared = false } = {}) {
    // Repository test adapters expose only the asynchronous key/value contract.
    if (!store.config) {
        const task = (tails.get(store) ?? Promise.resolve()).catch(() => {}).then(async () => {
            let sequence = await store.getItem(SEQUENCE_KEY) ?? 0;
            for (const operation of operations) {
                const identityKey = ID_PREFIX + operation.id;
                const existing = await store.getItem(identityKey);
                if (existing) {
                    const previous = await store.getItem(existing);
                    if (previous && !sameEnvelope(previous, operation)) throw new Error('O conteúdo de uma operação já registrada não pode mudar.');
                    continue;
                }
                const key = nextKey(++sequence, operation.id);
                await store.setItem(key, operation);
                await store.setItem(identityKey, key);
                if (operation.entityType === 'feature') await store.setItem('__journal_feature_head__' + operation.entityId, key);
                if (prepared) await store.setItem('__journal_state__' + operation.id, 'prepared');
            }
            await store.setItem(SEQUENCE_KEY, sequence);
        });
        tails.set(store, task);
        return task;
    }
    await store.ready();
    if (!globalThis.indexedDB || store.driver() !== 'asyncStorage') {
        throw new Error('O atlas remoto precisa do IndexedDB para guardar alterações com segurança.');
    }
    // `ready()` alone may retain a connection closed by another tab's versionchange.
    // A driver read performs localforage's reconnection before we open the atomic transaction.
    await store.getItem(SEQUENCE_KEY);
    const request = globalThis.indexedDB.open(store.config('name'));
    await new Promise((resolve, reject) => {
        let cancelled = false;
        request.onerror = () => reject(request.error);
        request.onblocked = () => {
            cancelled = true;
            reject(new Error('Banco da fila ocupado por outra aba.'));
        };
        request.onsuccess = () => {
            const db = request.result;
            if (cancelled) { db.close(); return; }
            let transaction;
            try {
                transaction = db.transaction(store.config('storeName'), 'readwrite');
            } catch (error) {
                db.close();
                reject(error);
                return;
            }
            const rows = transaction.objectStore(store.config('storeName'));
            transaction.oncomplete = () => { db.close(); resolve(); };
            transaction.onabort = () => { db.close(); reject(transaction.error ?? new Error('Falha ao guardar a alteração.')); };
            transaction.onerror = () => {};
            const sequenceRequest = rows.get(SEQUENCE_KEY);
            sequenceRequest.onsuccess = () => {
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
                    previous.onsuccess = () => {
                        if (previous.result) {
                            const envelope = rows.get(previous.result);
                            envelope.onsuccess = () => {
                                if (envelope.result && !sameEnvelope(envelope.result, operation)) {
                                    transaction.abort();
                                    return;
                                }
                                appendNext();
                            };
                            return;
                        }
                        if (!previous.result) {
                            try {
                                const key = nextKey(++sequence, operation.id);
                                rows.put(operation, key);
                                rows.put(key, identityKey);
                                if (operation.entityType === 'feature') rows.put(key, '__journal_feature_head__' + operation.entityId);
                                if (prepared) rows.put('prepared', '__journal_state__' + operation.id);
                            } catch {
                                transaction.abort();
                                return;
                            }
                        }
                        appendNext();
                    };
                };
                appendNext();
            };
        };
    });
}

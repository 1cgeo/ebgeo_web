// Path: js/store/sync/queue-journal.js

import { openStoreDatabase } from '../fenced-store.js';

const SEQUENCE_KEY = '__journal_sequence__';

/**
 * Every metadata prefix of the queue's own database, in the module that WRITES them.
 *
 * They were literals typed in two files, and the reader (`operation-queue.js`) had its own copies:
 * a rename there would have left the writer addressing the old key, with no error anywhere, which
 * is how a queue starts answering "no issue recorded" about an operation that has one.
 * @readonly
 * @enum {string}
 */
export const JournalKey = Object.freeze({
    /** `id -> envelope key`. The identity of an intention already on disk. */
    ID: '__journal_id__',
    /** Present only while an intention waits for its local projection to be materialized. */
    STATE: '__journal_state__',
    /** Present only while a terminal issue awaits an explicit decision. */
    ISSUE: '__journal_issue__',
    /** `entityId -> envelope key` of the newest PENDING operation of that feature. */
    FEATURE_HEAD: '__journal_feature_head__',
    /** `entityId -> {id, operationType, mapId}` of the newest operation, pending or confirmed. */
    FEATURE_LATEST: '__journal_feature_latest__',
    /**
     * `entityType:entityId -> envelope key` of the newest PENDING operation of a NON-feature
     * entity. It exists for the same reason {@link JournalKey.FEATURE_HEAD} does, and it arrived
     * late: `mutation-contract.js` passou a declarar base para TODA entidade com unidade de
     * disputa, mas o encadeamento que torna legal a segunda edição feita antes do primeiro recibo
     * continuou só de feição, então a segunda edição de uma camada perdia para a PRIMEIRA DO
     * MESMO AUTOR.
     *
     * PREFIXO SEPARADO, e não a mesma chave com o tipo embutido, porque um diário já no disco
     * carrega chaves de feição no formato antigo: reaproveitar o prefixo faria uma sessão
     * interrompida perder o encadeamento das feições dela, que é a metade que já funcionava.
     */
    ENTITY_HEAD: '__journal_entity_head__',
});

/**
 * A chave de cabeça de uma operação: por onde se pergunta "qual é a intenção pendente mais nova
 * desta entidade".
 *
 * @param {string} entityType - Tipo de entidade do envelope.
 * @param {string} entityId - Identidade da entidade.
 * @returns {string} Chave de metadado do diário.
 */
export function journalHeadKey(entityType, entityId) {
    return entityType === 'feature'
        ? JournalKey.FEATURE_HEAD + entityId
        : `${JournalKey.ENTITY_HEAD}${entityType}:${entityId}`;
}

const ID_PREFIX = JournalKey.ID;
const tails = new WeakMap();

/**
 * An intention whose identity is on disk while its envelope is not: the server already confirmed
 * it and the queue dropped it.
 *
 * IT EXISTS BECAUSE THE SILENT PATH LIED. `appendJournal` treated this state as "already
 * recorded" and returned success, so a caller that re-offered a confirmed operation (the retry of
 * `operation-dispatcher.js`, a recovery path) was told its intention was durable when nothing had
 * been written and nothing would be sent. Whoever catches this must NOT recreate the operation:
 * it was applied.
 */
export class ConfirmedOperationError extends Error {
    /** @param {string} id - Operation id. */
    constructor(id) {
        super(`A operação ${id} já foi confirmada pelo servidor e não pode voltar à fila.`);
        this.name = 'ConfirmedOperationError';
        this.operationId = id;
    }
}

/** Publish an entire materialized edit together; a crash must not expose half its operations. */
export async function materializeJournal(store, operations, assertWritable = () => {}) {
    assertWritable();
    if (!operations.length) return;
    if (!store.config) {
        // Lightweight repository adapters used by shape tests have no IDB transaction API.
        for (const operation of operations) {
            assertWritable();
            await store.removeItem(JournalKey.STATE + operation.id);
        }
        return;
    }
    await store.ready();
    if (!globalThis.indexedDB || store.driver() !== 'asyncStorage') {
        throw new Error('O atlas remoto precisa do IndexedDB para confirmar a gravação.');
    }
    await store.getItem(SEQUENCE_KEY);
    assertWritable();
    const db = await openStoreDatabase(store);
    await new Promise((resolve, reject) => {
        let transaction;
        let failure;
        try {
            assertWritable();
            transaction = db.transaction(store.config('storeName'), 'readwrite');
            transaction.oncomplete = () => {
                try { assertWritable(); resolve(); } catch (error) { reject(error); }
            };
            transaction.onabort = () => {
                reject(failure ?? transaction.error ?? new Error('Falha ao confirmar a gravação.'));
            };
            transaction.onerror = () => {};
            const rows = transaction.objectStore(store.config('storeName'));
            for (const operation of operations) {
                assertWritable();
                rows.delete(JournalKey.STATE + operation.id).onsuccess = () => {
                    try { assertWritable(); } catch (error) { failure = error; transaction.abort(); }
                };
            }
        } catch (error) {
            failure = error;
            if (transaction) {
                transaction.abort();
            } else { reject(error); }
        }
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
                    if (!previous) throw new ConfirmedOperationError(operation.id);
                    if (!sameEnvelope(previous, operation)) throw new Error('O conteúdo de uma operação já registrada não pode mudar.');
                    continue;
                }
                assertWritable();
                const key = nextKey(++sequence, operation.id);
                await store.setItem(key, operation);
                await store.setItem(identityKey, key);
                await store.setItem(journalHeadKey(operation.entityType, operation.entityId), key);
                if (operation.entityType === 'feature') {
                    await store.setItem(JournalKey.FEATURE_LATEST + operation.entityId, { id: operation.id, operationType: operation.operationType, mapId: operation.mapId });
                }
                if (prepared) await store.setItem(JournalKey.STATE + operation.id, 'prepared');
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
    const db = await openStoreDatabase(store);
    await new Promise((resolve, reject) => {
        let transaction;
        let failure;
        try {
            assertWritable();
            transaction = db.transaction(store.config('storeName'), 'readwrite');
        } catch (error) {
            reject(error);
            return;
        }
        const rows = transaction.objectStore(store.config('storeName'));
        transaction.oncomplete = () => {
            try { assertWritable(); resolve(); } catch (error) { reject(error); }
        };
        transaction.onabort = () => { reject(failure ?? transaction.error ?? new Error('Falha ao guardar a alteração.')); };
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
                            if (!envelope.result) {
                                // Identity without envelope: already confirmed and dropped.
                                // Silence here reported a durable intention that does not exist.
                                failure = new ConfirmedOperationError(operation.id);
                                transaction.abort();
                                return;
                            }
                            if (!sameEnvelope(envelope.result, operation)) {
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
                            rows.put(key, journalHeadKey(operation.entityType, operation.entityId));
                            if (operation.entityType === 'feature') {
                                rows.put({ id: operation.id, operationType: operation.operationType, mapId: operation.mapId }, JournalKey.FEATURE_LATEST + operation.entityId);
                            }
                            if (prepared) rows.put('prepared', JournalKey.STATE + operation.id);
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
    });
}

/**
 * Drops confirmed (or explicitly discarded) envelopes TOGETHER WITH their metadata.
 *
 * WHAT IT REMOVES, AND THE ONE THING IT KEEPS. The envelope, its identity
 * ({@link JournalKey.ID}), its prepared mark ({@link JournalKey.STATE}) and its issue record
 * ({@link JournalKey.ISSUE}) all go; the head ({@link journalHeadKey}, which is
 * {@link JournalKey.FEATURE_HEAD} for a feature and {@link JournalKey.ENTITY_HEAD} for every other
 * entity) goes ONLY while it still points at this envelope, because the head is the newest PENDING
 * operation of that entity and a later one may already own it. {@link JournalKey.FEATURE_LATEST}
 * STAYS: it is what
 * `persistOperationIntents` reads to chain the next edit of a feature onto a base the server has
 * already confirmed, so dropping it with the operation would make the first edit after an ack
 * lose its base. The sequence is never touched: it is what keeps keys monotonic across a reload.
 *
 * WHY PODA AND NOT A TOMBSTONE. Keeping the identity as a marker of "confirmed" would let
 * `appendJournal` refuse a re-offer by name forever, and it was the choice not taken: one key per
 * confirmed operation, for the life of the atlas, is exactly the unbounded growth this function
 * exists to stop (before it, every confirmed operation left four keys on disk for good). The
 * surviving detection is narrower and enough: the loud path of `appendJournal` covers the
 * identity left behind by an interrupted purge and by every atlas written before this change.
 *
 * ONE TRANSACTION WHERE THERE IS ONE TO TAKE, and a plain sequence of removals otherwise
 * (in-memory adapters of the shape tests, and any driver that is not IndexedDB). Unlike
 * `appendJournal`, this one must not THROW on a missing transaction API: it runs after the server
 * acked, and refusing to forget an applied operation would re-send it every 1.5 s forever.
 *
 * @param {object} store - The queue store of one scope.
 * @param {Array<{key: string, id: string, entityId?: string, entityType?: string}>} removals -
 *   Envelopes to drop.
 * @param {Function} [assertWritable] - Discard fence of the scope.
 * @returns {Promise<void>}
 */
export async function purgeJournalEntries(store, removals, assertWritable = () => {}) {
    assertWritable();
    if (!removals.length) return;

    let useTransaction = false;
    if (store.config && globalThis.indexedDB) {
        await store.ready();
        useTransaction = store.driver() === 'asyncStorage';
    }
    if (!useTransaction) {
        for (const { key, id, entityId, entityType } of removals) {
            assertWritable();
            await store.removeItem(key);
            if (typeof id === 'string') {
                await store.removeItem(JournalKey.ID + id);
                await store.removeItem(JournalKey.STATE + id);
                await store.removeItem(JournalKey.ISSUE + id);
            }
            if (entityId === undefined || entityType === undefined) continue;
            const head = journalHeadKey(entityType, entityId);
            if (await store.getItem(head) === key) await store.removeItem(head);
        }
        return;
    }

    assertWritable();
    const db = await openStoreDatabase(store);
    await new Promise((resolve, reject) => {
        let transaction;
        let failure;
        try {
            assertWritable();
            transaction = db.transaction(store.config('storeName'), 'readwrite');
            transaction.oncomplete = () => {
                try { assertWritable(); resolve(); } catch (error) { reject(error); }
            };
            transaction.onabort = () => {
                reject(failure ?? transaction.error ?? new Error('Falha ao podar o diário da fila.'));
            };
            transaction.onerror = () => {};
            const rows = transaction.objectStore(store.config('storeName'));
            for (const { key, id, entityId, entityType } of removals) {
                rows.delete(key);
                if (typeof id === 'string') {
                    rows.delete(JournalKey.ID + id);
                    rows.delete(JournalKey.STATE + id);
                    rows.delete(JournalKey.ISSUE + id);
                }
                if (entityId === undefined || entityType === undefined) continue;
                const headKey = journalHeadKey(entityType, entityId);
                const head = rows.get(headKey);
                head.onsuccess = () => {
                    try {
                        assertWritable();
                        if (head.result === key) rows.delete(headKey);
                    } catch (error) { failure = error; transaction.abort(); }
                };
            }
        } catch (error) {
            failure = error;
            if (transaction) {
                transaction.abort();
            } else { reject(error); }
        }
    });
}

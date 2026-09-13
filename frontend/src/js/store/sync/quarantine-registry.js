// Path: js/store/sync/quarantine-registry.js

/**
 * @fileoverview The quarantine that survives the end of a session: refused operations and old-
 * protocol work copied OUT of the atlas namespace before that namespace is destroyed.
 *
 * WHY IT EXISTS (F3, and decision D2 of 2026-09-13: preserve). The outbound queue is per atlas,
 * so an operation the server refused lived in a database the confirmed logout deletes: the user
 * accepted losing "pending work" and silently lost the work that was NOT pending, the work that
 * had already been set aside for a decision. Worse, the exit dialog never counted it separately,
 * so nobody was told what they were agreeing to.
 *
 * WHY A GLOBAL KEY AND NOT A THIRTEENTH DATABASE. `GlobalKey.QUARANTINE_PREFIX` says it: the
 * global database is the only one no atlas wipe reaches, and a new object store inside an existing
 * database is an IndexedDB version upgrade, which blocks while any tab holds a connection.
 *
 * WHAT THIS MODULE DOES NOT DO, declared because the absence is indistinguishable from an
 * oversight: it is called from the CONFIRMED discard (`requestRemoteAtlasDiscard`), the path where
 * a person decided. The logged-out boot sweep (`purgeAllRemoteAtlases`) also destroys namespaces,
 * and an orphan queue destroyed there is not copied by anything yet; that sweep is B7's subject.
 */

import {
    GlobalKey,
    StoreName,
    getGlobalStore,
    getStoreFor,
    remoteScope
} from '@store/atlas-namespace.js';
import { OperationQueue } from './operation-queue.js';
import { JournalKey } from './queue-journal.js';

/**
 * Shape version of a stored record. A record written by another version reads as ABSENT for the
 * same reason the hand-over slot does: guessing at an unknown shape is how a wrong envelope gets
 * offered back to the server.
 */
const RECORD_VERSION = 1;

/**
 * @param {string} atlasId - Server atlas id.
 * @returns {string} Key of that atlas's quarantine record in the global database.
 */
export function quarantineRegistryKey(atlasId) {
    return `${GlobalKey.QUARANTINE_PREFIX}${atlasId}`;
}

/**
 * Reads the quarantine of a NAMED server atlas.
 *
 * IT READS, IT DOES NOT MOUNT, like `countPendingOperationsFor`: `getStoreFor` addresses one
 * database without moving the active pointer. The cheap half comes first: an issue record is one
 * KEY per quarantined operation, so a listing answers "is there any?" without reading a single
 * envelope, and only then does the full walk happen. Logout pays the listing always and the walk
 * only when there is something to copy.
 *
 * IT MUST RUN BEFORE `discardRemoteWrites`, because the queue captures the discard fence when it
 * is constructed and refuses to serve a scope already marked for destruction.
 * @param {string} atlasId - Server atlas id.
 * @returns {Promise<Array<{operation: Object, result: Object, recordedAt: number}>>}
 */
export async function collectQuarantine(atlasId) {
    const scope = remoteScope(atlasId);
    const keys = await getStoreFor(StoreName.OPERATION_QUEUE, scope).keys();
    if (!keys.some(key => typeof key === 'string' && key.startsWith(JournalKey.ISSUE))) return [];
    return new OperationQueue(scope).getIssues();
}

/**
 * How many operations of one atlas are in quarantine right now.
 * @param {string} atlasId - Server atlas id.
 * @returns {Promise<number>}
 */
export async function countQuarantine(atlasId) {
    return (await collectQuarantine(atlasId)).length;
}

/**
 * Copies the quarantine of one atlas into the global database and CONFIRMS the copy by reading it
 * back, so a caller may destroy the namespace afterwards.
 *
 * IT THROWS WHEN THE COPY CANNOT BE CONFIRMED, and the caller must not proceed: a discard that
 * went ahead on an unverified write would destroy the only copy of work whose fate nobody decided.
 * Reading back is not ceremony: the failure being guarded against is a write that is accepted and
 * not stored (quota, a database being torn down), which returns without error.
 *
 * IT MERGES BY OPERATION ID instead of replacing. The namespace is destroyed after this, so a
 * later record for the same atlas is NEW work from a later session, and replacing would throw away
 * a batch nobody has reviewed yet.
 * @param {string} atlasId - Server atlas id.
 * @returns {Promise<number>} How many operations this atlas has in quarantine after the copy.
 */
export async function preserveQuarantine(atlasId) {
    const quarantined = await collectQuarantine(atlasId);
    if (quarantined.length === 0) return 0;

    const globalStore = getGlobalStore();
    const key = quarantineRegistryKey(atlasId);
    const stored = await globalStore.getItem(key);
    const byId = new Map();
    if (stored?.version === RECORD_VERSION) {
        for (const entry of stored.operations ?? []) {
            if (entry?.operation?.id) byId.set(entry.operation.id, entry);
        }
    }
    for (const { operation, result, recordedAt } of quarantined) {
        if (byId.has(operation.id)) continue;
        byId.set(operation.id, { operation, issue: result, recordedAt });
    }

    await globalStore.setItem(key, {
        version: RECORD_VERSION,
        atlasId,
        savedAt: Date.now(),
        operations: [...byId.values()],
    });

    const readBack = await globalStore.getItem(key);
    const saved = new Set((readBack?.operations ?? []).map(entry => entry?.operation?.id));
    for (const { operation } of quarantined) {
        if (saved.has(operation.id)) continue;
        throw new Error(
            'Não foi possível guardar as alterações em revisão deste atlas antes de descartar '
            + 'as pendências.'
        );
    }
    return saved.size;
}

/**
 * The preserved quarantine, FLAT, one entry per operation, newest record first.
 *
 * Flat and not grouped by atlas because the reader is a list of things to decide about, and the
 * atlas travels on each entry. A record of an unknown shape version is skipped, never guessed at.
 * @param {string|null} [atlasId] - One atlas, or every atlas when omitted.
 * @returns {Promise<Array<{atlasId: string, savedAt: number, operation: Object, issue: Object,
 *   recordedAt: number}>>}
 */
export async function listQuarantinedOperations(atlasId = null) {
    const globalStore = getGlobalStore();
    const keys = typeof atlasId === 'string'
        ? [quarantineRegistryKey(atlasId)]
        : (await globalStore.keys()).filter(key =>
            typeof key === 'string' && key.startsWith(GlobalKey.QUARANTINE_PREFIX));

    const records = [];
    for (const key of keys) {
        const stored = await globalStore.getItem(key);
        if (stored?.version !== RECORD_VERSION) continue;
        records.push(stored);
    }
    records.sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));

    const entries = [];
    for (const record of records) {
        for (const entry of record.operations ?? []) {
            if (!entry?.operation) continue;
            entries.push({
                atlasId: record.atlasId,
                savedAt: record.savedAt,
                operation: entry.operation,
                issue: entry.issue,
                recordedAt: entry.recordedAt,
            });
        }
    }
    return entries;
}

/**
 * Forgets the preserved quarantine of one atlas. It is the EXPLICIT decision, and the only way
 * this record leaves disk: no teardown collects it.
 * @param {string} atlasId - Server atlas id.
 * @returns {Promise<void>}
 */
export async function discardPreservedQuarantine(atlasId) {
    await getGlobalStore().removeItem(quarantineRegistryKey(atlasId));
}

/**
 * Forgets ONE preserved operation, by the same explicit decision as {@link
 * discardPreservedQuarantine} and for the same single reason: somebody looked at it and decided.
 *
 * IT EXISTS BECAUSE THE PANEL DECIDES ONE LINE AT A TIME (B5, resolution panel). The per-atlas
 * discard is the logout-shaped gesture; a person reading the list refuses one attempt, and
 * offering only "forget everything from this atlas" there would make a per-row button destroy
 * rows the person never looked at.
 *
 * THE RECORD LEAVES WHEN IT EMPTIES, rather than staying as an empty envelope: `listQuarantined-
 * Operations` skips a record with no operations, so an empty one is invisible work that no sweep
 * collects. A record of an unknown shape version is left alone, like everywhere else here.
 * @param {string} atlasId - Server atlas id.
 * @param {string} operationId - The operation to forget.
 * @returns {Promise<boolean>} Whether something was removed.
 */
export async function discardQuarantinedOperation(atlasId, operationId) {
    const globalStore = getGlobalStore();
    const key = quarantineRegistryKey(atlasId);
    const stored = await globalStore.getItem(key);
    if (stored?.version !== RECORD_VERSION) return false;

    const restantes = (stored.operations ?? [])
        .filter(entry => entry?.operation?.id !== operationId);
    if (restantes.length === (stored.operations ?? []).length) return false;

    if (restantes.length === 0) {
        await globalStore.removeItem(key);
        return true;
    }
    await globalStore.setItem(key, { ...stored, operations: restantes });
    return true;
}

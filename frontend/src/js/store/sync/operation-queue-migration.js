// Path: js/store/sync/operation-queue-migration.js

/**
 * @fileoverview Routes the operations already on disk into the per-atlas queue databases.
 *
 * Until the physical split there was ONE outbound queue (`ebgeo`/`operation_queue`) holding
 * the pending work of every atlas this machine had touched. An installation that updates with
 * a non-empty queue therefore has operations sitting at an address that, from now on, belongs
 * to local slot #1 alone. This module is what moves the ones that belong elsewhere.
 *
 * IT IS NOT A SCHEMA MIGRATION, and it deliberately does not join the chain in
 * `migration.service.js`. That chain is versioned per slot and runs against the slot's data
 * databases; this is one table, keyed by an address that the entries carry themselves, and it
 * has to run wherever an atlas gets mounted rather than once per installation.
 *
 * THE RULE, in the order it is applied:
 *
 *   1. AN OPERATION WITH A STAMP GOES TO ITS STAMP. `createOperation` has been writing
 *      `scopeSuffix` since the first half of this step, so most entries name their own
 *      destination and no inference is involved.
 *   2. AN UNSTAMPED OPERATION BELONGS TO THE ATLAS MOUNTED NOW. That is the documented rule
 *      for the one generation of envelopes written before the stamp existed. It is applied at
 *      the first boot that mounts an atlas, and it is stable: whoever mounts first claims
 *      them, exactly as the pre-split queue behaved, where any scope could read them.
 *
 * NOTHING IS EVER DISCARDED, and the order of writes is what guarantees it: the entry is
 * written to its destination and READ BACK before it is removed from the source. A failure at
 * any point leaves the operation exactly where it was, and the next boot tries again. The
 * alternative (remove then write) turns a quota error into lost work with no trace.
 *
 * IT IS IDEMPOTENT AND CHEAP TO RE-RUN, which is why there is no "already migrated" marker.
 * An operation whose destination is the database it is already in is skipped, so the ordinary
 * installation (local slot #1, legacy suffix) does no work at all: source and destination are
 * the same name, `ebgeo`.
 */

import {
    StoreName,
    getStoreFor,
    getActiveScope,
    isRemoteDbSuffix,
    resolveDbName,
    LEGACY_DB_SUFFIX,
    StoreScopeKind,
    UNMOUNTED_QUEUE_SCOPE
} from '@store/atlas-namespace.js';

/** Key prefix of a queue entry, shared with `operation-queue.js`. */
const KEY_PREFIX = 'op_';

/**
 * @param {string} dbSuffix - Address of a queue database.
 * @returns {{ kind: string, atlasId: string|null, dbSuffix: string }} A scope good enough to
 *   resolve a database name. The kind is derived from the suffix rather than remembered,
 *   because the name depends on the suffix alone and a wrong kind would only split the
 *   instance cache.
 */
function scopeOfSuffix(dbSuffix) {
    return {
        kind: isRemoteDbSuffix(dbSuffix) ? StoreScopeKind.REMOTE : StoreScopeKind.LOCAL,
        atlasId: null,
        dbSuffix
    };
}

/**
 * @typedef {Object} QueueMigrationReport
 * @property {number} moved - Entries written to another database and removed from the source.
 * @property {number} kept - Entries already in the right database (or with nowhere better to go).
 * @property {number} failed - Entries that could NOT be moved and were left untouched at the
 *   source. Never zero-by-construction: a non-zero value is the signal that work is still
 *   parked at the legacy address, not that it was lost.
 */

/**
 * Moves the operations parked in the pre-namespace queue to the queue of the atlas they
 * belong to.
 *
 * @param {Object} [options]
 * @param {{ kind: string, atlasId: string|null, dbSuffix: string }} [options.scope] - The
 *   mounted atlas, i.e. the owner of the unstamped entries. Defaults to the active scope;
 *   with none mounted there is no owner to infer and the pass is a no-op.
 * @returns {Promise<QueueMigrationReport>}
 */
export async function migratePendingOperationsToScopedQueues({ scope = null } = {}) {
    const report = { moved: 0, kept: 0, failed: 0 };
    const mounted = scope ?? getActiveScope();
    if (!mounted || typeof mounted.dbSuffix !== 'string') return report;

    const source = getStoreFor(StoreName.OPERATION_QUEUE, UNMOUNTED_QUEUE_SCOPE);
    const sourceName = resolveDbName(StoreName.OPERATION_QUEUE, UNMOUNTED_QUEUE_SCOPE);

    for (const key of await source.keys()) {
        if (typeof key !== 'string' || !key.startsWith(KEY_PREFIX)) continue;

        let operation;
        try {
            operation = await source.getItem(key);
        } catch (error) {
            console.warn(`Queue migration: could not read ${key}`, error);
            report.failed++;
            continue;
        }
        if (!operation) continue;

        const stamped = typeof operation.scopeSuffix === 'string' ? operation.scopeSuffix : null;
        const target = stamped ?? mounted.dbSuffix;
        if (target === LEGACY_DB_SUFFIX) {
            // Already home: the legacy address IS local slot #1's queue.
            report.kept++;
            continue;
        }

        const targetScope = scopeOfSuffix(target);
        if (resolveDbName(StoreName.OPERATION_QUEUE, targetScope) === sourceName) {
            report.kept++;
            continue;
        }

        try {
            const destination = getStoreFor(StoreName.OPERATION_QUEUE, targetScope);
            await destination.setItem(key, operation);
            // READ BACK before removing. `setItem` resolving is the driver's word that it
            // wrote; this is the database's. It costs one read per pending operation, once
            // per installation, to make "moved" mean moved.
            const landed = await destination.getItem(key);
            if (!landed) throw new Error('destination did not keep the operation');
            await source.removeItem(key);
            report.moved++;
        } catch (error) {
            console.warn(`Queue migration: ${key} stays at ${sourceName}`, error);
            report.failed++;
        }
    }

    return report;
}

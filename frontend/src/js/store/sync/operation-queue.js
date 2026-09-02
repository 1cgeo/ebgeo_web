// Path: js/store/sync/operation-queue.js

/**
 * @fileoverview Outbound operation queue: what this machine has written and the server
 * has not acknowledged yet. It is the only place in the store where the user's work
 * exists as an INTENTION rather than as data, which is why every rule below leans towards
 * keeping an operation nobody can place over discarding it.
 *
 * ONE DATABASE PER ATLAS, AND THE ADDRESS ALSO TRAVELS IN THE OPERATION.
 * The queue is `perAtlas: true` (`atlas-namespace.js`, Decision 2b): atlas X writes into
 * `ebgeo__<suffix of X>` and cannot see, drain or empty the queue of atlas Y, because it
 * never opens that database. The envelope keeps its stamp (`createOperation` writes
 * `scopeSuffix`, the address of the scope it was born in, and `atlasId`, the server atlas
 * when there is one) and every READ here is still filtered by it, but the roles have
 * swapped: the SEPARATION is now structural and the filter is an assertion over it. A
 * filter is a rule a future caller can forget; a separate database is a fact of the browser.
 *
 * The two defects this closed were both reachable by an ordinary gesture: a flush pushing
 * work born in another atlas, and `clear()` on a switch of project destroying the pending
 * work of another tab, i.e. the feature the user drew and had not uploaded.
 *
 * THE LEGACY SUFFIX KEEPS THE NAME `ebgeo`, so local slot #1 and the pre-namespace queue are
 * the same database and the ordinary installation moves zero bytes. Everything else is routed
 * once, by address, in `operation-queue-migration.js`.
 *
 * THE QUEUE IS PER ATLAS BUT IT IS NOT ATLAS DATA, and that is why `clearAllAtlasStores`
 * does not reach it. `openRemoteAtlas` activates the namespace of the atlas it is opening and
 * wipes three lines later; a queue inside that wipe would be the pending work OF THE ATLAS
 * BEING OPENED, destroyed immediately before the `connect` that would have drained it.
 * Emptying the queue on a wipe is a decision of the caller (`clearAllDataStore`), and
 * destroying it is part of destroying the namespace (`dropAtlasDatabases`).
 *
 * AN UNSTAMPED OPERATION BELONGS TO WHOEVER IS LOOKING (`operationBelongsToScope`).
 * Operations written before the stamp existed carry no address at all. Refusing them would
 * strand real, un-pushed work forever; there is exactly one such generation of them, and the
 * migration places them by the documented rule ("they belong to the atlas mounted at the time
 * of the upgrade"). The same permissiveness covers the window before any atlas is mounted,
 * where the queue resolves to `UNMOUNTED_QUEUE_SCOPE` and there is nothing to compare against.
 *
 * NO REVERSE INDEX. There used to be a module-level `opId -> key` Map, and it was two bugs
 * in one: it was built from the scope that happened to be active when the module first
 * touched storage, and `dequeue` counted removals through it while `peek` read the disk. So
 * an operation enqueued by ANOTHER TAB was peeked, pushed, and then not removed (the id was
 * absent from this tab's index), which re-peeked and re-pushed it forever without the queue
 * ever draining. Keys are now resolved from disk on every path that removes; the only cached
 * number left is the total key count, and it is used for nothing but the compaction
 * threshold, where being stale costs nothing.
 *
 * Resolved on every call on purpose (the factory caches, so it is a Map lookup): a handle
 * captured at module load is the exact bug the factory exists to remove.
 */

import {
    StoreName,
    getStoreFor,
    getActiveScope,
    UNMOUNTED_QUEUE_SCOPE
} from '@store/atlas-namespace.js';
import { OperationType } from './operation-types.js';

/**
 * The scope this queue reads and writes right now: the mounted atlas, or the legacy
 * (pre-namespace) address while nothing is mounted.
 *
 * IT NEVER RETURNS NULL, and that is deliberate. `getStore()` throws without an active
 * scope, and the queue is reachable before `initLocalAtlases()` (the boot enables operation
 * logging first) and after a destroyed scope is cleared. Throwing there would turn a
 * harmless read into a boot failure; falling back to the legacy address keeps exactly the
 * database the pre-namespace build used.
 * @returns {{ kind: string, atlasId: string|null, dbSuffix: string }}
 */
function queueScope() {
    return getActiveScope() ?? UNMOUNTED_QUEUE_SCOPE;
}

/**
 * @returns {import('localforage').default} The queue's localforage instance for the scope
 *   mounted right now. Resolved on every call: a handle captured at module load is the exact
 *   bug the namespace factory exists to remove.
 */
function queueStore() {
    return getStoreFor(StoreName.OPERATION_QUEUE, queueScope());
}

/**
 * Key prefix for queue entries.
 * Format: op_{timestamp}_{sequence}_{id}. See {@link SEQ_WIDTH} for why the sequence is there.
 */
const KEY_PREFIX = 'op_';

/**
 * Digits the Lamport sequence is zero-padded to inside a queue key.
 *
 * THE KEY IS THE OUTBOUND ORDER, AND THE WALL CLOCK IS NOT FINE ENOUGH TO DECIDE IT.
 * `_getOrderedKeys` sorts lexicographically, `peek` hands that order to `pushOperations`, and
 * the server applies the array in order. `createOperation` stamps `Date.now()`, so every
 * operation of one gesture logged in the same tick carries the SAME timestamp; the old key was
 * `op_{timestamp}_{uuid}`, so inside that tick the tie was broken by a RANDOM uuid.
 *
 * That is not a cosmetic ordering. `createGroup` logs one `group` create plus one
 * `group_feature` create per member, all in the same tick, and the insert of `group_features`
 * on the server is gated by an EXISTS over `groups`: a `group_feature` that arrives before its
 * `group` writes zero rows and is acked as success. With three members the random order put at
 * least one child ahead of the parent about three times out of four.
 *
 * The sequence is `operation.lamportTimestamp`, which is `++lamportClock` in BOTH factories of
 * `operation-factory.js`, so it is strictly increasing per client in creation order and it
 * already travels in the envelope (nothing new to persist). Zero-padded because the sort is
 * over text, not numbers.
 *
 * TWELVE DIGITS, and the bound is what the width has to survive: the clock only ever grows by
 * one per local operation and by `advanceLamportClock` on an inbound one, so reaching 10^12
 * would take a thousand billion operations in a single tab. Above that the padding stops
 * padding and the ordering degrades to the pre-2026-09-02 behaviour (uuid tie-break) rather
 * than to something worse, which is why no runtime guard is spent on it.
 *
 * TWO CASES THE SEQUENCE DELIBERATELY DOES NOT FIX, both pre-existing and both unreachable
 * inside one millisecond: the clock restarts at zero on reload (a reload takes far more than
 * the one millisecond that would be needed for the new numbering to collide with the old), and
 * two tabs writing one queue would keep their own clocks (they cannot: the tab lock refuses two
 * tabs on the same address).
 */
const SEQ_WIDTH = 12;

/** Shape of the sequence segment, used to tell a new key from a pre-sequence one. */
const SEQ_PATTERN = /^[0-9]+$/;

/** Maximum operations before compaction triggers */
const MAX_QUEUE_SIZE = 10000;

/**
 * How far the queue must grow PAST the size the last compaction left behind before another
 * compaction is attempted.
 *
 * THE CEILING ALONE IS NOT A TRIGGER, IT IS A LEVEL, and a level that the queue can sit above
 * indefinitely. Compaction only removes an operation that another operation of the SAME entity
 * supersedes; N creates of N distinct entities compact to N, which is what an import of N
 * features enqueues. So the first compaction above the ceiling frees nothing, the queue stays
 * above it, and without this step EVERY later `enqueue` ran a full compaction: one `keys()` for
 * the recount, another inside the compaction, and then a serial `getItem` over the whole queue.
 * Measured on 12000 creates of distinct entities: 2000 compactions, 4000 key listings and
 * 22,001,000 reads, 12.9 s. The queue paid a full read of itself for every operation the user
 * produced, which is quadratic in the size of the backlog, and the backlog is exactly the state
 * an offline burst produces.
 *
 * A TENTH OF THE CEILING, so an oversized queue is still swept about ten times per ceiling's
 * worth of new work: enough for a CREATE+UPDATE pair to be merged well before the pair ages out,
 * and far from the per-operation sweep. The watermark is never a licence to skip: it only delays,
 * and it is dropped the moment the queue is known to be at or below the ceiling.
 */
const COMPACTION_STEP = MAX_QUEUE_SIZE / 10;

/**
 * How many envelopes {@link OperationQueue#count} reads from IndexedDB at the same time.
 *
 * The count reads VALUES, never keys (the scope stamp lives in the envelope), and it used to
 * read them one `await` at a time. That serialised up to {@link MAX_QUEUE_SIZE} round trips on
 * the first blocking step of the logout, which is a wait nobody was paying for a number.
 *
 * IT IS A BATCH AND NOT A SINGLE `Promise.all` BECAUSE OF THE BOUND ABOVE: a full queue would
 * hold ten thousand envelopes resident at once, and an envelope carries the entity payload it
 * describes. 200 caps the resident set at 200 envelopes while still overlapping 200 reads, and
 * it is above the size of an ordinary queue, so the common case is ONE batch with no
 * serialisation at all.
 */
const COUNT_BATCH_SIZE = 200;

/**
 * The address (database suffix) the queue is reading right now. The empty string is a real
 * address (the legacy slot, database `ebgeo`), never "no address".
 * @returns {string}
 */
function activeScopeSuffix() {
    return queueScope().dbSuffix;
}

/**
 * Whether an operation may be read back by a tab that has `scopeSuffix` mounted.
 *
 * Pure, and exported because it is the assertion over the physical split: a test that pins
 * it directly cannot be fooled by a caller that forgot to apply it, and a test that pins
 * only the callers cannot tell a correct rule from an absent one. Since the split it can
 * only ever refuse an operation that is in the WRONG database (a migration that could not
 * finish), which is why refusing means "leave it alone", never "delete it".
 *
 * @param {{scopeSuffix?: string|null}|null} operation
 * @param {string|null} scopeSuffix - Address of the reading scope. `null` means "no address
 *   to compare against" and accepts everything; the queue itself no longer passes null (it
 *   falls back to the legacy address), but the predicate keeps the case because a caller
 *   reading a raw database has no scope of its own.
 * @returns {boolean}
 */
export function operationBelongsToScope(operation, scopeSuffix) {
    if (scopeSuffix === null) return true;
    const born = operation?.scopeSuffix;
    if (born === null || born === undefined) return true;
    return born === scopeSuffix;
}

/**
 * The operation id carried by a queue key, or null when the key is not a queue entry.
 *
 * IT READS BOTH FORMATS, and it has to: a queue persisted before the sequence existed still
 * holds `op_{timestamp}_{id}` keys, and they have to stay dequeueable. The two are told apart
 * structurally, from the LEFT: after the timestamp, a segment of exactly {@link SEQ_WIDTH}
 * digits followed by another separator is the sequence, and everything after it is the id.
 *
 * IT IS NOT `lastIndexOf`, on purpose, and that is the trap this function already fell into
 * once: the timestamp and the sequence can never contain an underscore but an ID CAN, and
 * splitting on the last separator truncated such an id to its final segment, so the operation
 * could not be dequeued after a reload. Parsing the fixed-shape head keeps the id opaque, which
 * is the property that fixed that bug.
 *
 * @param {string} key
 * @returns {string|null}
 */
function operationIdFromKey(key) {
    if (typeof key !== 'string' || !key.startsWith(KEY_PREFIX)) return null;
    const rest = key.slice(KEY_PREFIX.length);
    const cut = rest.indexOf('_');
    if (cut === -1) return null;

    let id = rest.slice(cut + 1);
    const next = id.indexOf('_');
    if (next === SEQ_WIDTH && SEQ_PATTERN.test(id.slice(0, SEQ_WIDTH))) {
        id = id.slice(next + 1);
    }
    return id.length > 0 ? id : null;
}

/**
 * Operation queue for sync operations.
 * Operations are persisted to IndexedDB and can be:
 * - Enqueued: Added for later sync
 * - Peeked: Viewed without removing (ACTIVE SCOPE ONLY)
 * - Dequeued: Removed after successful sync (by explicit id, from disk)
 */
class OperationQueue {
    constructor() {
        /**
         * Cached number of entries in the queue database of {@link _countedSuffix}, or null
         * when unknown. Feeds the compaction threshold and nothing else: a stale value delays
         * or anticipates a compaction, which is a heuristic either way.
         * @type {number|null}
         * @private
         */
        this._totalKeys = null;

        /**
         * Which address {@link _totalKeys} was counted at. Without it a switch of atlas
         * carries the previous atlas's count into a different database, and a count inflated
         * by ten thousand would call compaction on every single enqueue of the new one.
         * @type {string|null}
         * @private
         */
        this._countedSuffix = null;

        /**
         * The size {@link _totalKeys} has to reach before compaction is attempted again, or
         * null when the next crossing of {@link MAX_QUEUE_SIZE} may compact straight away.
         *
         * It is only ever set by a compaction that RAN and left the queue still above the
         * ceiling, which is the state where compacting again immediately does the same full
         * read of the queue and frees the same nothing. It is dropped as soon as the queue is
         * known to be at or below the ceiling, and it is scoped to {@link _countedSuffix} for
         * the same reason the count is: a level measured in another atlas's database means
         * nothing in this one.
         * @type {number|null}
         * @private
         */
        this._compactionWatermark = null;

        /**
         * Whether compaction is currently running (prevent re-entrancy).
         * @type {boolean}
         * @private
         */
        this._compacting = false;
    }

    // ===== CORE OPERATIONS =====

    /**
     * Builds the storage key for an operation.
     *
     * The sequence between the timestamp and the id is what makes the key MONOTONIC in creation
     * order inside one millisecond; see {@link SEQ_WIDTH} for the defect that bought it. An
     * envelope without a usable `lamportTimestamp` (a hand-built double, an operation restored
     * from a shape that predates it) falls back to zero, which is the old behaviour for those
     * and not a new failure: they tie, and the uuid decides.
     * @private
     * @param {import('./operation-factory.js').Operation} operation
     * @returns {string}
     */
    _buildKey(operation) {
        const seq = Number.isFinite(operation.lamportTimestamp) && operation.lamportTimestamp > 0
            ? Math.trunc(operation.lamportTimestamp)
            : 0;
        const padded = String(seq).padStart(SEQ_WIDTH, '0');
        return `${KEY_PREFIX}${operation.timestamp}_${padded}_${operation.id}`;
    }

    /**
     * Enqueues an operation for later sync.
     * Triggers compaction if the queue exceeds MAX_QUEUE_SIZE.
     * @param {import('./operation-factory.js').Operation} operation - Operation to queue
     * @returns {Promise<void>}
     */
    async enqueue(operation) {
        await queueStore().setItem(this._buildKey(operation), operation);
        await this._growAndMaybeCompact(1);
    }

    /**
     * Enqueues multiple operations.
     * @param {import('./operation-factory.js').Operation[]} operations - Operations to queue
     * @returns {Promise<void>}
     */
    async enqueueAll(operations) {
        for (const operation of operations) {
            await queueStore().setItem(this._buildKey(operation), operation);
        }
        await this._growAndMaybeCompact(operations.length);
    }

    /**
     * Peeks at operations of the ACTIVE SCOPE without removing them.
     * @param {number} [count=10] - Maximum number to return
     * @returns {Promise<import('./operation-factory.js').Operation[]>} Operations
     */
    async peek(count = 10) {
        const keys = await this._getOrderedKeys();
        return this._loadOperations(keys, { limit: count, scopeSuffix: activeScopeSuffix() });
    }

    /**
     * Dequeues operations by their IDs.
     *
     * NOT scope-filtered, and deliberately so: the caller names exact ids, and those ids
     * came from a scoped {@link peek}. Filtering again here would let an operation the
     * server has already accepted survive on disk and be pushed a second time.
     *
     * @param {string[]} operationIds - IDs of operations to remove
     * @returns {Promise<number>} Number of operations removed
     */
    async dequeue(operationIds) {
        if (!Array.isArray(operationIds) || operationIds.length === 0) return 0;
        const wanted = new Set(operationIds);

        let removed = 0;
        for (const key of await queueStore().keys()) {
            const opId = operationIdFromKey(key);
            if (opId === null || !wanted.has(opId)) continue;
            await queueStore().removeItem(key);
            removed++;
        }
        if (removed > 0) this._totalKeys = null;
        return removed;
    }

    /**
     * Counts the pending operations OF THE ACTIVE SCOPE.
     *
     * IT READS THE VALUES, IT NEVER COUNTS THE KEYS. The stamp lives in the envelope, so an
     * operation addressed to another scope must not be counted as flushable. This number also
     * decides the RESCUE on the way out of the account (`unsynced-work-exit.js`), and the two
     * errors are not symmetric: counting too much preserves work that was not at risk (one
     * extra local atlas, recoverable), counting too little authorises the teardown that
     * destroys it. Zero is the answer that permits destruction; never produce it by accident.
     *
     * IT DOES NOT REUSE `_loadOperations`, which exists to return a CHRONOLOGICAL list. The
     * order was the only reason the count ever called it, and a count has no use for order.
     * The reads go out together, in batches of {@link COUNT_BATCH_SIZE}, instead of one round
     * trip per operation; the empty queue answers without reading anything, which is the
     * ordinary case and the one on the logout's critical path.
     *
     * A READ THAT REJECTS PROPAGATES, on purpose: `countPendingOperations` turns the throw into
     * NaN ("unknown"), and unknown preserves. Swallowing it here would answer 0.
     * @returns {Promise<number>} Number of pending operations
     */
    async count() {
        const keys = await this._getOrderedKeys();
        if (keys.length === 0) return 0;

        // Resolved ONCE, before the reads: the factory answers by the scope mounted at the
        // instant of the call, and a scope swap in the middle of the batch would count part of
        // one database and part of another.
        const store = queueStore();
        const scopeSuffix = activeScopeSuffix();

        let total = 0;
        for (let i = 0; i < keys.length; i += COUNT_BATCH_SIZE) {
            const lote = keys.slice(i, i + COUNT_BATCH_SIZE);
            const envelopes = await Promise.all(lote.map(key => store.getItem(key)));
            for (const op of envelopes) {
                if (!op) continue;
                if (!operationBelongsToScope(op, scopeSuffix)) continue;
                total += 1;
            }
        }
        return total;
    }

    /**
     * Alias for count().
     * @returns {Promise<number>} Number of pending operations
     */
    async size() {
        return this.count();
    }

    /**
     * Clears the operations OF THE ACTIVE SCOPE, and only its own database.
     *
     * IT IS NOT PART OF THE ATLAS WIPE, and the caller decides (`clearAllDataStore`,
     * `clearQueue`). A wipe that ends in a blank local store abandons the data those
     * operations describe, so keeping them would push ghosts of deleted entities on the next
     * connect; a wipe that is the PREAMBLE to mounting a remote atlas is aimed at the
     * namespace of the atlas being opened, and emptying its queue there destroys pending work
     * seconds before the `connect` that would have drained it.
     *
     * The stamp filter survives the physical split as an assertion: an operation of another
     * address found in this database is a migration that did not finish, and it is left alone
     * rather than deleted.
     * @returns {Promise<void>}
     */
    async clear() {
        const scopeSuffix = activeScopeSuffix();
        const store = queueStore();

        for (const key of await this._getOrderedKeys()) {
            const operation = await store.getItem(key);
            if (operation && !operationBelongsToScope(operation, scopeSuffix)) continue;
            await store.removeItem(key);
        }
        this._totalKeys = null;
        this._compactionWatermark = null;
    }

    /**
     * Gets the pending operations OF THE ACTIVE SCOPE, in chronological order.
     * @returns {Promise<import('./operation-factory.js').Operation[]>} All operations
     */
    async getAll() {
        const keys = await this._getOrderedKeys();
        return this._loadOperations(keys, { scopeSuffix: activeScopeSuffix() });
    }

    /**
     * Gets operations filtered by entity type (within the active scope).
     * @param {string} entityType - Entity type to filter by
     * @returns {Promise<import('./operation-factory.js').Operation[]>} Filtered operations
     */
    async getByEntityType(entityType) {
        const all = await this.getAll();
        return all.filter(op => op.entityType === entityType);
    }

    /**
     * Gets operations filtered by map ID (within the active scope).
     * @param {string} mapId - Map ID to filter by
     * @returns {Promise<import('./operation-factory.js').Operation[]>} Filtered operations
     */
    async getByMapId(mapId) {
        const all = await this.getAll();
        return all.filter(op => op.mapId === mapId);
    }

    // ===== PRIVATE HELPERS =====

    /**
     * Gets queue keys in creation order.
     *
     * THIS ORDER IS THE ORDER THE SERVER APPLIES: `peek` reads it, `pushOperations` sends the
     * array as it is, and the server walks it. Lexicographic sorting is enough because the key
     * is `timestamp` then zero-padded `sequence`, both fixed-shape and both numeric, so the
     * text order IS the numeric order.
     *
     * MIXING THE TWO KEY SHAPES IS SAFE IN PRACTICE, and the reason is not the sort, it is the
     * clock. A pre-sequence key (`op_{timestamp}_{uuid}`) survives only from a session that
     * ended before the build changed, so its timestamp is at least one whole page load older
     * than any key written afterwards; the two shapes never share a millisecond. If they ever
     * did, the padded sequence starts with a zero and would sort before a uuid starting with
     * any other hex digit, i.e. the new entry would go first. That inversion is bounded to a
     * single millisecond during one upgrade, which is why it is documented instead of
     * engineered away.
     * @private
     * @returns {Promise<string[]>} Ordered keys
     */
    async _getOrderedKeys() {
        const keys = await queueStore().keys();
        return keys
            .filter(k => k.startsWith(KEY_PREFIX))
            .sort();
    }

    /**
     * Loads operations from IndexedDB by their keys, skipping nulls.
     * @private
     * @param {string[]} keys - IndexedDB keys to load, already ordered.
     * @param {Object} [options]
     * @param {number} [options.limit] - Stop after this many MATCHING operations.
     * @param {string|null} [options.scopeSuffix=null] - Keep only operations of this scope.
     * @returns {Promise<import('./operation-factory.js').Operation[]>}
     */
    async _loadOperations(keys, { limit = Infinity, scopeSuffix = null } = {}) {
        const operations = [];
        if (limit <= 0) return operations;

        for (const key of keys) {
            const op = await queueStore().getItem(key);
            if (!op) continue;
            if (!operationBelongsToScope(op, scopeSuffix)) continue;
            operations.push(op);
            if (operations.length >= limit) break;
        }
        return operations;
    }

    /**
     * Accounts for newly written entries and compacts when the queue outgrows its bound.
     * @private
     * @param {number} added - How many entries were just written.
     * @returns {Promise<void>}
     */
    async _growAndMaybeCompact(added) {
        const suffix = activeScopeSuffix();
        if (this._totalKeys === null || this._countedSuffix !== suffix) {
            if (this._countedSuffix !== suffix) this._compactionWatermark = null;
            this._totalKeys = (await this._getOrderedKeys()).length;
            this._countedSuffix = suffix;
        } else {
            this._totalKeys += added;
        }

        if (this._totalKeys <= MAX_QUEUE_SIZE) {
            // Below the ceiling there is nothing to defer, and a level left over from an
            // earlier burst would otherwise keep deferring the next one. This is the "the
            // queue drained" half of the watermark, and it covers the drain by flush, by
            // purge and by another tab, none of which know the level exists.
            this._compactionWatermark = null;
            return;
        }

        if (this._compacting) return;
        if (this._compactionWatermark !== null && this._totalKeys < this._compactionWatermark) return;

        await this._compact();
    }

    // ===== COMPACTION =====

    /**
     * Compacts the queue by merging redundant operations for the same entity.
     *
     * Rules:
     * - Multiple UPDATEs for the same entity -> keep only the last one
     * - CREATE followed by UPDATEs -> merge into single CREATE with latest data
     * - CREATE followed by DELETE -> remove both (entity never needs to sync)
     * - UPDATE followed by DELETE -> keep only DELETE
     *
     * Runs over the queue of the MOUNTED atlas, which since the physical split is the only
     * one this process can open. The group key still carries the address, and it stays:
     * within one database an unstamped operation and a stamped one can describe the same
     * entity id, and collapsing those two into one would merge work from two owners.
     *
     * @private
     * @returns {Promise<void>}
     */
    async _compact() {
        if (this._compacting) return;
        this._compacting = true;

        try {
            const keys = await this._getOrderedKeys();
            // Re-anchors the cached count on the disk before deciding anything. Without
            // this, a count inflated by another tab's dequeue would call compaction on
            // EVERY enqueue, and each call reads the whole queue to decide it has nothing
            // to do.
            this._totalKeys = keys.length;
            this._countedSuffix = activeScopeSuffix();

            const allOps = await this._loadOperations(keys);
            if (allOps.length <= MAX_QUEUE_SIZE) {
                this._compactionWatermark = null;
                return;
            }

            const keyById = new Map();
            for (const key of keys) {
                const opId = operationIdFromKey(key);
                if (opId !== null) keyById.set(opId, key);
            }

            // Group operations by scope+entityType+entityId (preserving chronological order)
            /** @type {Map<string, import('./operation-factory.js').Operation[]>} */
            const groups = new Map();
            for (const op of allOps) {
                const groupKey = `${op.scopeSuffix ?? ''}:${op.entityType}:${op.entityId}`;
                if (!groups.has(groupKey)) {
                    groups.set(groupKey, []);
                }
                groups.get(groupKey).push(op);
            }

            /** @type {string[]} */
            const keysToRemove = [];
            /** @type {Array<{key: string, op: import('./operation-factory.js').Operation}>} */
            const opsToUpdate = [];

            for (const [, ops] of groups) {
                if (ops.length <= 1) continue;

                const compacted = this._compactEntityOps(ops);
                const keptIds = new Set(compacted.map(op => op.id));

                for (const op of ops) {
                    if (!keptIds.has(op.id)) {
                        const key = keyById.get(op.id);
                        if (key) keysToRemove.push(key);
                    }
                }

                for (const op of compacted) {
                    const key = keyById.get(op.id);
                    if (key) opsToUpdate.push({ key, op });
                }
            }

            for (const key of keysToRemove) {
                await queueStore().removeItem(key);
            }
            for (const { key, op } of opsToUpdate) {
                await queueStore().setItem(key, op);
            }

            // The exact size on disk, not `null`. `null` means "recount from the database on
            // the next enqueue", and that recount is a second full `keys()` listing per
            // operation, which is half of the quadratic COMPACTION_STEP exists to remove.
            // Nothing here is a guess: the listing was just read and the removals are known.
            // `Set` because two operations may share an id (see
            // `tests/unit/compactacao-id-nao-unico.test.js`), and a key removed twice must
            // still only count once.
            this._noteCompaction(keys.length - new Set(keysToRemove).size);
        } finally {
            this._compacting = false;
        }
    }

    /**
     * Records what a compaction left behind: the size on disk, and the level the queue has to
     * reach before another compaction is worth its cost.
     * @private
     * @param {number} sizeAfter - Entries left in the queue database.
     * @returns {void}
     */
    _noteCompaction(sizeAfter) {
        // The listing this counts was read at the START of the compaction, so an `enqueue` that
        // landed while it ran is not in it and the number can sit one or two below the disk. It
        // is a heuristic feeding a 10000 ceiling, where being off by two changes nothing, and
        // the recount on the next scope change or drain re-anchors it anyway.
        this._totalKeys = Math.max(0, sizeAfter);
        this._countedSuffix = activeScopeSuffix();
        this._compactionWatermark = this._totalKeys > MAX_QUEUE_SIZE
            ? this._totalKeys + COMPACTION_STEP
            : null;
    }

    /**
     * Compacts operations for a single entity.
     * @private
     * @param {import('./operation-factory.js').Operation[]} ops - Chronologically ordered ops for one entity
     * @returns {import('./operation-factory.js').Operation[]} Compacted ops
     */
    _compactEntityOps(ops) {
        if (ops.length === 0) return ops;

        const firstOp = ops[0];
        const lastOp = ops[ops.length - 1];

        // CREATE + ... + DELETE -> remove all (entity was created and deleted locally)
        if (firstOp.operationType === OperationType.CREATE && lastOp.operationType === OperationType.DELETE) {
            return [];
        }

        // CREATE + UPDATEs -> merge into single CREATE with latest data
        if (firstOp.operationType === OperationType.CREATE) {
            const mergedCreate = { ...firstOp };
            for (let i = ops.length - 1; i > 0; i--) {
                if (ops[i].data) {
                    mergedCreate.data = ops[i].data;
                    break;
                }
            }
            return [mergedCreate];
        }

        // UPDATEs + DELETE -> keep only DELETE
        // Multiple UPDATEs -> keep only the last one
        return [lastOp];
    }

    // ===== AUTO-PURGE =====

    /**
     * Purges operations older than maxAgeMs from the queue OF THE MOUNTED ATLAS.
     *
     * It used to sweep every atlas at once, and it no longer can: since the physical split
     * this process only ever opens one queue database. The consequence is written down
     * rather than worked around, because working around it means enumerating databases the
     * browser will not enumerate: a stale operation of an unmounted atlas survives until
     * that atlas is mounted again (where this collects it) or destroyed (where
     * `dropAtlasDatabases` takes the whole database). Neither leaves it flushable, which is
     * the property that mattered.
     *
     * It ignores the stamp on purpose: age is a property of the entry, and an operation of
     * a foreign address sitting in this database is exactly the residue worth collecting.
     * @param {number} [maxAgeMs=604800000] - Max age in milliseconds (default: 7 days)
     * @returns {Promise<number>} Number of operations purged
     */
    async purgeOldOperations(maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
        const cutoff = Date.now() - maxAgeMs;
        const allOps = await this._loadOperations(await this._getOrderedKeys());
        const toPurge = allOps
            .filter(op => op.timestamp < cutoff)
            .map(op => op.id);

        if (toPurge.length > 0) {
            await this.dequeue(toPurge);
        }
        return toPurge.length;
    }

    /**
     * Starts periodic auto-purge of old operations.
     * Runs every 6 hours. Safe to call multiple times (idempotent).
     *
     * `initServices()` starts it BEFORE any atlas is mounted, which is why the queue falls
     * back to the legacy address instead of throwing: a timer that dies on its first tick
     * with "no active atlas scope" is a collector that silently never collects. Every tick
     * after the boot lands on whatever atlas is mounted then.
     */
    startAutoPurge() {
        if (this._purgeInterval) return;

        const SIX_HOURS = 6 * 60 * 60 * 1000;
        this._purgeInterval = setInterval(async () => {
            try {
                const purged = await this.purgeOldOperations();
                if (purged > 0) {
                    console.info(`Operation queue: purged ${purged} old operations`);
                }
            } catch (error) {
                console.warn('Operation queue purge error:', error);
            }
        }, SIX_HOURS);
    }

    /**
     * Stops the auto-purge interval (for testing/cleanup).
     */
    stopAutoPurge() {
        if (this._purgeInterval) {
            clearInterval(this._purgeInterval);
            this._purgeInterval = null;
        }
    }
}

/** Singleton operation queue instance. */
export const operationQueue = new OperationQueue();

// Export class for testing
export { OperationQueue };

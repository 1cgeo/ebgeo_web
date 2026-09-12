// Path: js/store/store-transaction.js

/**
 * @module store/store-transaction
 * @description Coordinates store operations to ensure persistence-first atomicity.
 * Side effects (color tracking, undo recording, sync logging) are deferred
 * until IndexedDB persistence succeeds. If persistence fails, no side effects run.
 * @dependencies store/store-errors
 */

import { StoreErrorEvents, emitStoreError } from './store-errors.js';
import { generateUUID } from '../utilities/uuid.js';
import { setActionTraceId } from './sync/operation-factory.js';
import { record } from './sync/diag/trace-core.js';
import { TraceStage } from './sync/diag/trace-stages.js';
import { getActiveScope } from '@store/atlas-namespace.js';
import { persistOperationIntents } from '@store/sync/operation-dispatcher.js';
import { beginStoreWrite } from './write-coordinator.js';
import { captureRemoteWriteFence } from './remote-write-fence.js';

const TxState = Object.freeze({
    OPEN: 'open',
    COMMITTED: 'committed',
    ROLLED_BACK: 'rolled_back'
});

/**
 * Collects deferred side effects and executes them only after persistence succeeds.
 * Not a database transaction — a coordination pattern for execution ordering.
 */
class StoreTransaction {
    constructor() {
        this._state = TxState.OPEN;
        this._syncEffects = [];
        this._asyncEffects = [];
        this._operations = [];
        this.scope = getActiveScope();
        this.assertWritable = captureRemoteWriteFence(this.scope);
    }

    get state() { return this._state; }

    /**
     * Queues a synchronous side effect to run after persistence.
     * @param {function(): void} fn
     */
    deferSync(fn) {
        this._assertOpen();
        this._syncEffects.push(fn);
    }

    /**
     * Queues an asynchronous side effect to run after persistence.
     * @param {function(): Promise<void>} fn
     */
    deferAsync(fn) {
        this._assertOpen();
        this._asyncEffects.push(fn);
    }

    /** Collect final edit descriptions before either journal or entity persistence. */
    recordOperation(entityType, operationType, entityId, mapId, data = null, previousData = null, options = {}) {
        this._assertOpen();
        this._operations.push({ entityType, operationType, entityId, mapId, data, previousData, ...options });
    }

    async writeIntents(traceId) {
        this.assertWritable();
        // The legacy local repository may initialize its bridge during the first read.
        // This is the initial local mount, not a transition between remote atlases.
        if (this.scope === null && getActiveScope()?.kind === 'local' && getActiveScope().dbSuffix === '') {
            this.scope = getActiveScope();
        }
        if (getActiveScope() !== this.scope) throw new Error('O atlas mudou durante a edição.');
        const materialized = await persistOperationIntents(this._operations, { scope: this.scope, traceId });
        if (getActiveScope() !== this.scope) throw new Error('O atlas mudou durante a gravação.');
        this.assertWritable();
        return materialized;
    }

    /**
     * Commits: runs all deferred side effects.
     * Sync effects first (in-memory, cannot fail in practice).
     * Async effects fire-and-forget with error logging.
     */
    commit() {
        this.assertWritable();
        if (this._state !== TxState.OPEN) {
            throw new Error(`Cannot commit ${this._state} transaction`);
        }
        this._state = TxState.COMMITTED;

        for (const fn of this._syncEffects) {
            try {
                fn();
            } catch (error) {
                console.warn('Sync side effect failed after persistence:', error);
            }
        }

        for (const fn of this._asyncEffects) {
            try {
                fn().catch(error => {
                    console.warn('Async side effect failed after persistence:', error);
                });
            } catch (error) {
                console.warn('Async side effect failed to start:', error);
            }
        }
    }

    /**
     * Rolls back: discards all deferred side effects without executing them.
     */
    rollback() {
        this._state = TxState.ROLLED_BACK;
        this._syncEffects = [];
        this._asyncEffects = [];
    }

    /** @private */
    _assertOpen() {
        if (this._state !== TxState.OPEN) {
            throw new Error(`Cannot defer to ${this._state} transaction`);
        }
    }
}

/**
 * Executes a persistence-first transaction.
 *
 * @param {function(StoreTransaction): Promise<function(): Promise<void>>} workFn
 *   Receives a transaction, performs data preparation and defers side effects.
 *   Must return an async function that performs the actual IndexedDB persistence.
 * @returns {Promise<void>}
 */
export async function runTransaction(workFn) {
    const tx = new StoreTransaction();
    const finishWrite = beginStoreWrite(tx.scope);
    // Mint one trace id per user gesture. It rides every op this transaction logs
    // (the ambient is read synchronously by createOperation during commit, so it is
    // safe even with concurrent transactions: there is no await between set and the
    // synchronous createOperation calls inside commit). Best-effort — op.id remains
    // the always-works correlation key, so a null/absent traceId never breaks sync.
    const traceId = generateUUID();
    try {
        const persistFn = await workFn(tx);
        const materialized = await tx.writeIntents(traceId);
        tx.assertWritable();
        await persistFn();
        tx.assertWritable();
        if (getActiveScope() !== tx.scope) throw new Error('O atlas mudou antes da confirmação da edição.');
        await materialized?.();
        setActionTraceId(traceId);
        try {
            record(TraceStage.ACTION_ORIGIN, { traceId, outcome: 'ok' });
            tx.commit();
        } finally {
            setActionTraceId(null);
        }
    } catch (error) {
        tx.rollback();
        emitStoreError(StoreErrorEvents.STORE_PERSIST_ERROR, {
            operation: 'transaction',
            error: error.message || String(error),
            timestamp: Date.now()
        });
        throw error;
    } finally {
        finishWrite();
    }
}

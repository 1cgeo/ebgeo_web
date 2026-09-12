// Path: js/store/sync/operation-queue.js
/**
 * Per-atlas durable intentions. New envelopes use a persistent monotonic sequence;
 * legacy keys remain readable and retain their original IDs and payloads.
 * No unconfirmed operation expires or is compacted. Metadata keys are not operations.
 * A prepared intention cannot be sent until its local projection is materialized.
 * Terminal issues remain on disk for explicit user resolution or confirmed logout.
 */
import {
    StoreName,
    getStoreFor,
    getActiveScope,
    UNMOUNTED_QUEUE_SCOPE
} from '@store/atlas-namespace.js';
import { appendJournal } from './queue-journal.js';
import { captureRemoteWriteFence } from '../remote-write-fence.js';
import { fenceStore } from '../fenced-store.js';

function queueScope() {
    return getActiveScope() ?? UNMOUNTED_QUEUE_SCOPE;
}

const KEY_PREFIX = 'op_';

const SEQ_WIDTH = 12;

const SEQ_PATTERN = /^[0-9]+$/;

const COUNT_BATCH_SIZE = 200;

export function operationBelongsToScope(operation, scopeSuffix) {
    if (scopeSuffix === null) return true;
    const born = operation?.scopeSuffix;
    if (born === null || born === undefined) return true;
    return born === scopeSuffix;
}

function operationIdFromKey(key) {
    if (typeof key !== 'string' || !key.startsWith(KEY_PREFIX)) return null;
    const rest = key.slice(KEY_PREFIX.length);
    const cut = rest.indexOf('_');
    if (cut === -1) return null;

    let id = rest.slice(cut + 1);
    if (rest.startsWith('z')) return id || null;
    const next = id.indexOf('_');
    if (next === SEQ_WIDTH && SEQ_PATTERN.test(id.slice(0, SEQ_WIDTH))) {
        id = id.slice(next + 1);
    }
    return id.length > 0 ? id : null;
}

class OperationQueue {
    constructor(scope = null) {
        this._scope = scope;
        this._assertWritable = scope ? captureRemoteWriteFence(scope) : null;
        this._purgeInterval = null;
    }

    forScope(scope) { return new OperationQueue(scope); }

    _context() {
        const scope = this._scope ?? queueScope();
        const assertWritable = this._assertWritable ?? captureRemoteWriteFence(scope);
        const raw = getStoreFor(StoreName.OPERATION_QUEUE, scope);
        const store = scope.kind === 'remote' ? fenceStore(raw, assertWritable) : raw;
        return { store, scopeSuffix: scope.dbSuffix, assertWritable };
    }

    _buildKey(operation) {
        const seq = Number.isFinite(operation.lamportTimestamp) && operation.lamportTimestamp > 0
            ? Math.trunc(operation.lamportTimestamp)
            : 0;
        const padded = String(seq).padStart(SEQ_WIDTH, '0');
        return `${KEY_PREFIX}${operation.timestamp}_${padded}_${operation.id}`;
    }

    async enqueue(operation) {
        const { store, assertWritable } = this._context();
        await appendJournal(store, [operation], { assertWritable });
    }

    async enqueueAll(operations, options) {
        const { store, assertWritable } = this._context();
        await appendJournal(store, operations, { ...options, assertWritable });
    }

    async markMaterialized(operations) {
        const { store } = this._context();
        for (const operation of operations) await store.removeItem('__journal_state__' + operation.id);
    }

    async getLatestPendingFeature(entityId) {
        const { store } = this._context();
        const key = await store.getItem('__journal_feature_head__' + entityId);
        return key ? store.getItem(key) : null;
    }

    async getLatestFeatureOperation(entityId) {
        const { store } = this._context();
        return store.getItem('__journal_feature_latest__' + entityId);
    }

    async recordIssue(operation, result) {
        const { store } = this._context();
        await store.setItem('__journal_issue__' + operation.id, { result, recordedAt: Date.now() });
    }

    async getIssues() {
        const { store, scopeSuffix } = this._context();
        const operations = await this._loadOperations(await this._getOrderedKeys(store), { store, scopeSuffix });
        const issues = [];
        for (const operation of operations) {
            const issue = await store.getItem('__journal_issue__' + operation.id);
            if (issue) issues.push({ operation, ...issue });
        }
        return issues;
    }

    async getPendingProjection() {
        const { store, scopeSuffix } = this._context();
        return this._loadOperations(await this._getOrderedKeys(store), { store, scopeSuffix, projectionOnly: true });
    }

    async peek(count = 10) {
        const context = this._context();
        const keys = await this._getOrderedKeys(context.store);
        return this._loadOperations(keys, { ...context, limit: count, readyOnly: true });
    }

    async dequeue(operationIds) {
        if (!Array.isArray(operationIds) || operationIds.length === 0) return 0;
        const wanted = new Set(operationIds);

        const { store } = this._context();
        let removed = 0;
        for (const key of await store.keys()) {
            const opId = operationIdFromKey(key);
            if (opId === null || !wanted.has(opId)) continue;
            await store.removeItem(key);
            removed++;
        }
        return removed;
    }

    async count() {
        const { store, scopeSuffix } = this._context();
        const keys = await this._getOrderedKeys(store);
        if (keys.length === 0) return 0;

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

    async size() {
        return this.count();
    }

    async clear() {
        const { store, scopeSuffix } = this._context();

        for (const key of await this._getOrderedKeys(store)) {
            const operation = await store.getItem(key);
            if (operation && !operationBelongsToScope(operation, scopeSuffix)) continue;
            await store.removeItem(key);
        }
    }

    async getAll() {
        const context = this._context();
        const keys = await this._getOrderedKeys(context.store);
        return this._loadOperations(keys, context);
    }

    async getByEntityType(entityType) {
        const all = await this.getAll();
        return all.filter(op => op.entityType === entityType);
    }

    async getByMapId(mapId) {
        const all = await this.getAll();
        return all.filter(op => op.mapId === mapId);
    }

    async _getOrderedKeys(store = this._context().store) {
        const keys = await store.keys();
        return keys
            .filter(k => k.startsWith(KEY_PREFIX))
            .sort();
    }

    async _loadOperations(keys, { limit = Infinity, scopeSuffix = null, store = this._context().store, readyOnly = false, projectionOnly = false } = {}) {
        const operations = [];
        if (limit <= 0) return operations;
        const blockedEntities = new Set();
        const blockedOperations = new Set();

        for (const key of keys) {
            const op = await store.getItem(key);
            if (!op) continue;
            if (!operationBelongsToScope(op, scopeSuffix)) continue;
            if ((readyOnly || projectionOnly) && (await store.getItem('__journal_issue__' + op.id)
                || blockedEntities.has(op.entityId) || blockedEntities.has(op.mapId)
                || blockedEntities.has(op.data?.briefingId ?? op.data?.briefing_id)
                || (op.dependsOn ?? []).some(id => blockedOperations.has(id)))) {
                blockedEntities.add(op.entityId);
                blockedOperations.add(op.id);
                continue;
            }
            if (readyOnly && await store.getItem('__journal_state__' + op.id) === 'prepared') break;
            operations.push(op);
            if (operations.length >= limit) break;
        }
        return operations;
    }

    async _compact() {
        // Compatibility entry point: immutable intentions are never compacted.
    }

    _compactEntityOps(ops) {
        return ops;
    }

    async purgeOldOperations() {
        return 0;
    }

    startAutoPurge() {
        this.stopAutoPurge();
    }

    stopAutoPurge() {
        if (this._purgeInterval) {
            clearInterval(this._purgeInterval);
            this._purgeInterval = null;
        }
    }
}

export const operationQueue = new OperationQueue();

export { OperationQueue };

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
import { appendJournal, materializeJournal, purgeJournalEntries, JournalKey } from './queue-journal.js';
import { captureRemoteWriteFence } from '../remote-write-fence.js';
import { fenceStore } from '../fenced-store.js';
import { legacyQueueIssue } from './legacy-queue.js';
import { IssueClass, classifyIssue } from './issue-classes.js';
import { openGestureBatchId } from './gesture-batch.js';

function queueScope() {
    return getActiveScope() ?? UNMOUNTED_QUEUE_SCOPE;
}

const KEY_PREFIX = 'op_';

const SEQ_WIDTH = 12;

const SEQ_PATTERN = /^[0-9]+$/;

const COUNT_BATCH_SIZE = 200;

/**
 * The dependency blockade of the outbound queue, in ONE place because TWO readers apply it.
 *
 * `_loadOperations` applies it to decide what the flush may send; `countByState` applies it to
 * decide what the census calls a problem. A second copy of the rule would drift, and the drift is
 * invisible from either side: the census would call sendable an operation the loader refuses, and
 * the flush loop would wake every 1.5 s to push nothing and report success.
 */
class PendingBlockade {
    constructor() {
        this._entities = new Set();
        this._operations = new Set();
    }

    /**
     * @param {Object} operation - Envelope being classified.
     * @returns {boolean} Whether something this operation needs is already blocked.
     */
    blocks(operation) {
        return this._entities.has(operation.entityId)
            || this._entities.has(operation.mapId)
            || this._entities.has(operation.data?.briefingId ?? operation.data?.briefing_id)
            || (operation.dependsOn ?? []).some(id => this._operations.has(id));
    }

    /**
     * Records an operation that will not be sent, so its descendants are blocked too.
     * @param {Object} operation - Envelope that stays on disk.
     * @returns {void}
     */
    add(operation) {
        this._entities.add(operation.entityId);
        this._operations.add(operation.id);
    }
}

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
        return { store, scopeSuffix: scope.dbSuffix, remote: scope.kind === 'remote', assertWritable };
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
        const { store, assertWritable } = this._context();
        await materializeJournal(store, operations, assertWritable);
    }

    async getLatestPendingFeature(entityId) {
        const { store } = this._context();
        const key = await store.getItem(JournalKey.FEATURE_HEAD + entityId);
        return key ? store.getItem(key) : null;
    }

    async getLatestFeatureOperation(entityId) {
        const { store } = this._context();
        return store.getItem(JournalKey.FEATURE_LATEST + entityId);
    }

    async recordIssue(operation, result) {
        const { store } = this._context();
        await store.setItem(JournalKey.ISSUE + operation.id, { result, recordedAt: Date.now() });
    }

    /**
     * As operações com um resultado GUARDADO, cada uma com a sua classe.
     *
     * A classe (`IssueClass`) separa disputa de recusa de política e de intenção retida para
     * revisão: as três chegavam como `rejected: true` mais uma frase, e pedem coisas diferentes de
     * quem as lê. A dependência bloqueada NÃO entra aqui, porque não é um registro: ver
     * {@link getProblems}.
     * @returns {Promise<Array<{operation: Object, result: Object, recordedAt: number, classe: string}>>}
     */
    async getIssues() {
        const { store, scopeSuffix } = this._context();
        const operations = await this._loadOperations(await this._getOrderedKeys(store), { store, scopeSuffix });
        const issues = [];
        for (const operation of operations) {
            const issue = await store.getItem(JournalKey.ISSUE + operation.id);
            if (issue) issues.push({ operation, ...issue, classe: classifyIssue(issue.result) });
        }
        return issues;
    }

    /**
     * TUDO que a fila não consegue enviar, classificado: o que foi recusado E o que está parado
     * atrás do que foi recusado.
     *
     * É a mesma contagem que `countByState().problemas` devolve, agora com os envelopes e com a
     * razão de cada um, e caminha com o MESMO {@link PendingBlockade} que o carregador usa, para
     * que a lista não possa discordar do que o flush de fato se recusa a enviar.
     *
     * SEPARADO DE {@link getIssues} DE PROPÓSITO. Aquele lê registros, e é o que o expurgo do
     * logout copia para a quarentena; este DERIVA, e a dependência que ele nomeia deixa de existir
     * assim que a operação da frente é resolvida. Guardar uma pendência cuja causa some sozinha
     * faria a leitura seguinte anunciar um problema que já não existe.
     * @returns {Promise<Array<{operation: Object, result: Object|null, recordedAt: number|null,
     *   classe: string, bloqueadaPor: string|null}>>}
     */
    async getProblems() {
        const { store, scopeSuffix } = this._context();
        const blockade = new PendingBlockade();
        const problems = [];
        let culpada = null;
        for (const key of await this._getOrderedKeys(store)) {
            const operation = await store.getItem(key);
            if (!operation) continue;
            if (!operationBelongsToScope(operation, scopeSuffix)) continue;
            const issue = await store.getItem(JournalKey.ISSUE + operation.id);
            if (issue) {
                blockade.add(operation);
                culpada = operation.id;
                problems.push({ operation, ...issue, classe: classifyIssue(issue.result), bloqueadaPor: null });
                continue;
            }
            if (!blockade.blocks(operation)) continue;
            blockade.add(operation);
            problems.push({
                operation, result: null, recordedAt: null,
                classe: IssueClass.DEPENDENCIA, bloqueadaPor: culpada,
            });
        }
        return problems;
    }

    async getPendingProjection() {
        const context = this._context();
        return this._loadOperations(await this._getOrderedKeys(context.store), { ...context, projectionOnly: true });
    }

    /**
     * The next operations the flush may send, cut at a LOGICAL BATCH boundary and never inside
     * one.
     *
     * `count` IS A BUDGET OF WHOLE BATCHES, NOT A SLICE, and that is the contract this signature
     * changed for. The server defines a logical batch as the operations sharing one `batchId`
     * THAT ARRIVE IN THE SAME PUSH (`docs/reviews/fechamento/04-comandos-compostos.md`): it
     * carries no total, so it cannot know a member is missing. A blind FIFO slice therefore
     * turned one gesture into two logical batches, each atomic in itself, and the gesture could
     * still be applied by halves, which is the very outcome the savepoint was bought to prevent.
     *
     * The packing is greedy over consecutive runs of the same `batchId` (an operation with no
     * `batchId` is a run of one): a run is taken whole while it fits in the budget, and the first
     * run is taken whole EVEN IF IT ALONE EXCEEDS the budget, because a gesture larger than the
     * budget must travel in a push of its own rather than be split. The server's own ceiling
     * (`LOTE_MAX_OPS`) is enforced by the caller, which is the side that knows the protocol.
     *
     * @param {number} [count=10] - How many operations the caller would like, at least.
     * @returns {Promise<Object[]>} Whole batches, in queue order.
     */
    async peek(count = 10) {
        const context = this._context();
        const keys = await this._getOrderedKeys(context.store);
        return this._loadOperations(keys, { ...context, limit: count, readyOnly: true });
    }

    /**
     * Removes confirmed operations AND the journal metadata that named them.
     *
     * Until 2026-09-13 it removed the `op_` key alone, so every confirmed operation left its
     * identity, its prepared mark and its issue record on disk for the life of the atlas:
     * metadata no wipe collected and that `appendJournal` still consulted. The metadata of an
     * envelope now leaves with it, in one transaction, which is `purgeJournalEntries`.
     * @param {string[]} operationIds - Ids to remove.
     * @returns {Promise<number>} How many envelopes were removed.
     */
    async dequeue(operationIds) {
        if (!Array.isArray(operationIds) || operationIds.length === 0) return 0;
        const wanted = new Set(operationIds);

        const { store, assertWritable } = this._context();
        const removals = [];
        for (const key of await store.keys()) {
            const opId = operationIdFromKey(key);
            if (opId === null || !wanted.has(opId)) continue;
            const operation = await store.getItem(key);
            removals.push({ key, id: opId, entityId: operation?.entityId });
        }
        await purgeJournalEntries(store, removals, assertWritable);
        return removals.length;
    }

    /**
     * The whole queue census in ONE sweep: what the flush can send now, what waits behind a
     * prepared intention, and what is stopped by a problem.
     *
     * WHY THREE NUMBERS AND NOT ONE. `count()` used to answer "every envelope on disk", and the
     * flush loop read that as "there is something to send": one refused operation with nothing
     * else in the queue woke the loop every 1.5 s to push nothing and register a SUCCESS. The
     * three buckets are disjoint and add up to that old total, so a caller that needs the total
     * (the exit warning, the pending census) sums the three, and a caller that needs sendable
     * work reads `pendentes`.
     *
     * `problemas` is BOTH the operation with a recorded issue and everything the queue refuses to
     * send because of it (same entity, same map, same briefing, or a declared dependency): the
     * rule is {@link PendingBlockade}, the same object `_loadOperations` walks with.
     *
     * `preparadas` is the first intention still marked prepared AND everything queued after it.
     * The loader STOPS at that mark (a projection that is not materialized cannot be sent, and
     * the order is the contract), so those operations are pending and not sendable, which is
     * exactly what this bucket says. It is not "how many carry the mark".
     *
     * IT READS THE ISSUE RECORD, IT NEVER DERIVES ONE. The legacy-protocol quarantine is derived
     * and WRITTEN by `_loadOperations`, which is the one writer of that fact; deriving it a
     * second time here would make the census disagree with the loader on the cycle before the
     * record is written, and disagree in the dangerous direction on any future rule the loader
     * gains and this method does not.
     *
     * The metadata comes from the KEY LIST, not from a read per operation: an issue key and a
     * prepared-state key exist only while they are true (`materializeJournal` deletes the state
     * key), so presence IS the fact, and it costs nothing on top of the listing the count
     * already pays for. Envelopes are still read in parallel batches, because the count decides
     * a rescue and sits on the critical path of the click on "Sair".
     * @returns {Promise<{pendentes: number, preparadas: number, problemas: number}>}
     */
    async countByState() {
        const { store, scopeSuffix } = this._context();
        const census = { pendentes: 0, preparadas: 0, problemas: 0 };

        const keys = await store.keys();
        const operationKeys = keys.filter(key => key.startsWith(KEY_PREFIX)).sort();
        if (operationKeys.length === 0) return census;

        const issued = new Set();
        const prepared = new Set();
        for (const key of keys) {
            if (key.startsWith(JournalKey.ISSUE)) issued.add(key.slice(JournalKey.ISSUE.length));
            else if (key.startsWith(JournalKey.STATE)) prepared.add(key.slice(JournalKey.STATE.length));
        }

        const blockade = new PendingBlockade();
        /** @type {Set<string>} Batches with an unsendable member, as in `_loadOperations`. */
        const poisonedBatches = new Set();
        let held = false;
        // THE RUN IS COUNTED TOGETHER, for the same reason the loader packs it together: a
        // gesture whose last member is still prepared is not partly sendable, so its earlier
        // members are `preparadas` too. Counting them as `pendentes` would make the census
        // promise work the flush refuses to send, which is the disagreement this class of
        // defect always takes.
        let runBatch = null;
        let run = [];
        let runHeld = false;
        const closeRun = () => {
            if (run.length === 0) return;
            if (held || runHeld) census.preparadas += run.length;
            else census.pendentes += run.length;
            if (runHeld) held = true;
            runBatch = null;
            run = [];
            runHeld = false;
        };

        for (let i = 0; i < operationKeys.length; i += COUNT_BATCH_SIZE) {
            const lote = operationKeys.slice(i, i + COUNT_BATCH_SIZE);
            const envelopes = await Promise.all(lote.map(key => store.getItem(key)));
            for (const op of envelopes) {
                if (!op) continue;
                if (!operationBelongsToScope(op, scopeSuffix)) continue;
                const batch = op.batchId ?? null;
                if (issued.has(op.id) || blockade.blocks(op)
                    || (batch !== null && poisonedBatches.has(batch))) {
                    blockade.add(op);
                    census.problemas += 1;
                    if (batch !== null) {
                        poisonedBatches.add(batch);
                        if (batch === runBatch) {
                            for (const irma of run) blockade.add(irma);
                            census.problemas += run.length;
                            run = [];
                            runBatch = null;
                            runHeld = false;
                        }
                    }
                    continue;
                }
                if (run.length > 0 && (batch === null || batch !== runBatch)) closeRun();
                runBatch = batch;
                run.push(op);
                // A mesma regra do carregador: gesto ABERTO ainda não é enviável, e o censo não
                // pode prometer trabalho que o flush se recusa a entregar.
                if (prepared.has(op.id) || (batch !== null && batch === openGestureBatchId())) runHeld = true;
                if (batch === null) closeRun();
            }
        }
        closeRun();
        return census;
    }

    /**
     * How many operations the flush can send RIGHT NOW: pending, with no issue of their own, no
     * blocked dependency, and ahead of any prepared intention.
     *
     * IT IS NOT THE SIZE OF THE QUEUE, and reading it as one is the defect this signature exists
     * to prevent. For everything the user would lose (the exit warning, the pending census, the
     * sync light) sum the three numbers of {@link countByState}.
     * @returns {Promise<number>}
     */
    async count() {
        return (await this.countByState()).pendentes;
    }

    /**
     * Alias kept for call-site stability. It answers the SENDABLE count, like {@link count}.
     * @returns {Promise<number>}
     */
    async size() {
        return this.count();
    }

    /**
     * Empties the queue of the ACTIVE scope, metadata included, by the same rule as
     * {@link dequeue}: an envelope of another address is left where it is.
     * @returns {Promise<void>}
     */
    async clear() {
        const { store, scopeSuffix, assertWritable } = this._context();

        const removals = [];
        for (const key of await this._getOrderedKeys(store)) {
            const operation = await store.getItem(key);
            if (operation && !operationBelongsToScope(operation, scopeSuffix)) continue;
            removals.push({
                key,
                id: operation?.id ?? operationIdFromKey(key),
                entityId: operation?.entityId
            });
        }
        await purgeJournalEntries(store, removals, assertWritable);
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

    /**
     * @private Walks the ordered keys applying the blockade, the prepared mark and, when the
     * caller set a finite `limit`, the WHOLE-BATCH packing described in {@link peek}.
     *
     * The run buffer is what makes the packing possible at all: whether a batch fits can only be
     * decided once its last member is known, so members are held aside and moved into the result
     * together. With no finite limit (the projection, `getAll`) the buffer is transparent, since
     * every run fits.
     */
    async _loadOperations(keys, { limit = Infinity, scopeSuffix = null, store = this._context().store, remote = false, readyOnly = false, projectionOnly = false } = {}) {
        const operations = [];
        if (limit <= 0) return operations;
        const blockade = new PendingBlockade();
        const bounded = Number.isFinite(limit);
        /** @type {Set<string>} Batches with an unsendable member: the whole gesture waits. */
        const poisonedBatches = new Set();

        /** @type {Object[]} Members of the batch under consideration, not yet accepted. */
        let run = [];
        /** @type {string|null} The `batchId` those members share. */
        let runBatch = null;

        /**
         * Moves the buffered run into the result when it fits the budget.
         * @returns {boolean} False when it does not fit, so the caller must stop.
         */
        const flushRun = () => {
            if (run.length === 0) return true;
            if (bounded && operations.length > 0 && operations.length + run.length > limit) return false;
            operations.push(...run);
            run = [];
            runBatch = null;
            return true;
        };

        /**
         * Withdraws the buffered run: its gesture cannot be sent, so no member of it may be.
         * @returns {void}
         */
        const poisonRun = () => {
            for (const held of run) blockade.add(held);
            run = [];
            runBatch = null;
        };

        for (const key of keys) {
            const op = await store.getItem(key);
            if (!op) continue;
            if (!operationBelongsToScope(op, scopeSuffix)) continue;
            if (remote && (readyOnly || projectionOnly)) {
                const issue = legacyQueueIssue(op);
                if (issue && !await store.getItem(JournalKey.ISSUE + op.id)) {
                    await store.setItem(JournalKey.ISSUE + op.id, { result: issue, recordedAt: Date.now() });
                }
            }
            const batch = op.batchId ?? null;
            if ((readyOnly || projectionOnly)
                && (await store.getItem(JournalKey.ISSUE + op.id)
                    || blockade.blocks(op)
                    || (batch !== null && poisonedBatches.has(batch)))) {
                blockade.add(op);
                // ONE UNSENDABLE MEMBER TAKES ITS WHOLE GESTURE WITH IT, siblings already buffered
                // included. Sending what is left of a batch is the half-gesture the boundary
                // exists to prevent, and it is the shape nothing downstream can repair.
                if (batch !== null) {
                    poisonedBatches.add(batch);
                    if (batch === runBatch) poisonRun();
                }
                continue;
            }
            // A GESTURE STILL OPEN IS NOT A BATCH YET. Its later transactions have not run, so
            // sending what is already on disk would hand the server a complete-looking gesture
            // that is in fact its first half. The 1,5 s flush tick landing between two
            // transactions of a conversion or of a layer transfer is exactly that window.
            const gestureOpen = readyOnly && batch !== null && batch === openGestureBatchId();
            if (gestureOpen || (readyOnly && await store.getItem(JournalKey.STATE + op.id) === 'prepared')) {
                // A MEMBER STILL PREPARED HOLDS ITS WHOLE BATCH, not only itself. One member of a
                // gesture can stay prepared while its siblings are materialized (an image feature
                // waiting for its blob), and the siblings must wait with it.
                if (batch !== null && batch === runBatch) run = [];
                flushRun();
                break;
            }
            if (run.length > 0 && (batch === null || batch !== runBatch)) {
                if (!flushRun()) return operations;
            }
            run.push(op);
            runBatch = batch;
            if (batch === null) {
                flushRun();
                if (bounded && operations.length >= limit) return operations;
            }
        }
        flushRun();
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

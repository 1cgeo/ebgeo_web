// Path: js/store/sync/remote-operation-handler.js
import { captureRemoteWriteFence } from '../remote-write-fence.js';

/**
 * @fileoverview Remote operation handler for sync system.
 * Applies operations received from other clients to the local store.
 *
 * This handler is the inverse of operation logging:
 * - Logging: local change -> create operation -> queue
 * - Remote: receive operation -> apply to local state -> emit events
 *
 * IMPORTANT: Remote operations MUST NOT:
 * - Check permissions (already validated by server)
 * - Log to operation queue (avoids feedback loop)
 * - Record undo actions (undo is per-user, local only)
 */

import { EventTypes } from '../../events/event_types.js';
import { getRepository } from '../repositories/index.js';
import { localRepository } from '../repositories/local.repository.js';
import { getStorageTypeFromSource } from '../store.constants.js';
import { ensureMapDataShape } from '../repository.utils.js';
import { applyRemoteAppearance } from '../atlas-appearance.service.js';
import { getControl } from '../control.registry.js';
import { mapResolver } from '../services/map-resolver.service.js';
import { memoryStore } from '../memory-store.js';
import { withMapDocument, withSideDocument, withDocumentLock } from '../document-lock.js';
import { EntityType, OperationType } from './operation-types.js';
import { editedRecentlyLocally } from './overwrite-notice.js';
import { record } from './diag/trace-core.js';
import { TraceStage, TraceOutcome, DropReason } from './diag/trace-stages.js';
import { operationQueue } from './operation-queue.js';
import {
    adoptActiveGeneration,
    dropGenerationDatabases,
    getActiveScope,
    pruneAtlasGenerations,
} from '@store/atlas-namespace.js';
import { readGeneration, writeGeneration } from '../namespace-generation.js';
import { pauseStoreWrites } from '../write-coordinator.js';
import { createAtlas } from '../atlas/atlas.entity.js';
import { generateUUID } from '../../utilities/uuid.js';
import { isClearedPositionPayload } from '../map-position-clear.js';
import {
    clearConfirmedVersion,
    stampConfirmedVersion,
    stampConfirmedVersionFromRow,
    stampConfirmedVersionFromRows,
} from './confirmed-version.js';

// ============================================================================
// MODULE STATE
// ============================================================================

/** @type {import('../../events/event_bus.js').EventBus|null} */
let _eventBus = null;

let applyContext = null;

/** Volatile ordering evidence belongs to one mount, never to a later atlas with equal IDs. */
class MountMap {
    constructor() { this.mounts = new WeakMap(); this.legacy = new Map(); }
    forScope(scope = applyContext?.scope ?? getActiveScope()) {
        if (!scope) return this.legacy;
        if (!this.mounts.has(scope)) this.mounts.set(scope, new Map());
        return this.mounts.get(scope);
    }
    get(key) { return this.forScope().get(key); }
    set(key, value) { return this.forScope().set(key, value); }
    delete(key) { return this.forScope().delete(key); }
    keys() { return this.forScope().keys(); }
    get size() { return this.forScope().size; }
}

function capturedApplyContext(options = {}) {
    const assertWritable = captureRemoteWriteFence(options.scope ?? getActiveScope());
    const context = {
        scope: options.scope ?? getActiveScope(),
        signal: options.signal,
        repo: options.repository,
        localRepo: options.repository,
        assertActive() {
            assertWritable();
            this.signal?.throwIfAborted();
            const active = getActiveScope();
            if (!this.scope && active?.kind === 'local' && active.dbSuffix === '') this.scope = active;
            if (active !== this.scope) throw new DOMException('O atlas desta aplicação foi desmontado.', 'AbortError');
        },
    };
    return context;
}

async function withApplyContext(context, work) {
    context.assertActive();
    applyContext = context;
    try {
        const result = await work();
        context.assertActive();
        return result;
    } finally {
        applyContext = null;
    }
}

function handlerRepository() {
    applyContext?.assertActive();
    if (!applyContext) return getRepository();
    const repo = getRepository();
    applyContext.repo ??= (repo.forScope?.(applyContext.scope) ?? repo);
    return applyContext.repo;
}

function handlerLocalRepository() {
    applyContext?.assertActive();
    if (!applyContext) return localRepository;
    applyContext.localRepo ??= (localRepository.forScope?.(applyContext.scope) ?? localRepository);
    return applyContext.localRepo;
}

function applyHandlerAppearance(data) {
    const context = applyContext;
    return applyRemoteAppearance(data, getControl('TerrainControl'), globalThis.__ebgeoMap, {
        repository: handlerRepository(),
        assertActive: () => context?.assertActive(),
        present,
    });
}

/** A staged generation must not change the visible map before its commit point. */
function present(fn) {
    const context = applyContext;
    context?.assertActive();
    if (context?.staging) {
        context.presentation.push(fn);
        return;
    }
    return fn();
}

/**
 * Feature ops whose map has not been applied locally yet, keyed by mapId. A feature/create
 * for a freshly-created map can arrive before that map's create op is persisted (A creates a
 * map and immediately draws on it). Buffering — instead of dropping — and replaying once the
 * map lands prevents silent data loss on the peer.
 * @type {Map<string, Array<{opType: string, featureId: string, data: Object}>>}
 */
const pendingFeatureOps = new MountMap();

/** Cap per map so a never-arriving map cannot grow the buffer unbounded. */
const MAX_PENDING_PER_MAP = 1000;

/** Buffers a feature op whose map is absent (replayed by drainPendingFeatureOps). */
function bufferPendingFeatureOp(mapId, op) {
    let arr = pendingFeatureOps.get(mapId);
    if (!arr) {
        arr = [];
        pendingFeatureOps.set(mapId, arr);
    }
    if (arr.some(item => item.opId === op.opId)) return;
    if (arr.length >= MAX_PENDING_PER_MAP) throw new Error('A recuperação precisa de um novo retrato do servidor.');
    arr.push(op);
}

/**
 * Re-applies, in arrival order, any feature ops buffered while `mapId` was missing.
 *
 * Deliberately NOT holding the map document lock: it awaits `applyRemoteFeatureOp`, which
 * takes that lock per op. Its two callers (`applyRemoteMapOp` CREATE and
 * `applyRemoteSnapshot`) therefore drain OUTSIDE their own locked save span, or the drain
 * would wait for a lock its own caller still holds and hang forever (document-lock.js).
 */
async function drainPendingFeatureOps(mapId) {
    const arr = pendingFeatureOps.get(mapId);
    if (!arr || arr.length === 0) return;
    for (const op of [...arr]) {
        // These ops bypass applyRemoteOperation, so apply the version guard here: skip one older
        // than what's already applied, and record the applied version on success so a later
        // concurrent op can't overwrite it (LWW by server arrival order).
        if (!shouldApplyVersion(op.featureId, op.serverVersion)) {
            arr.splice(arr.indexOf(op), 1);
            continue;
        }
        const applied = await applyRemoteFeatureOp(op.opType, op.featureId, mapId, op.data, op.serverVersion, op.opId, op.traceId);
        if (applied) {
            // Peer-side IndexedDB-write confirmation for a feature whose map arrived late
            // (buffered then replayed) — the apply.persist that applyRemoteOperation skipped.
            record(TraceStage.APPLY_PERSIST, {
                opId: op.opId, traceId: op.traceId,
                entityType: EntityType.FEATURE, operationType: op.opType,
                entityId: op.featureId, mapId, serverVersion: op.serverVersion,
                outcome: TraceOutcome.OK,
            });
            if (op.opType === OperationType.DELETE) {
                markAppliedVersion(op.featureId, op.serverVersion);
                lastRemoteAppliedVersion.delete(op.featureId);
            } else {
                markAppliedVersion(op.featureId, op.serverVersion);
                markRemoteApplied(op.featureId, op.serverVersion);
            }
            arr.splice(arr.indexOf(op), 1);
        }
    }
    if (!arr.length) pendingFeatureOps.delete(mapId);
}

/**
 * Last server arrival-order (serverVersion) applied per entity, keyed by entity id. Concurrent
 * edits to the SAME entity converge to the op with the highest serverVersion (LWW by arrival
 * order — the documented model): an inbound op OLDER than what was already applied is ignored.
 * The author seeds its OWN entries from the push ack (recordLocalAppliedVersion), because it
 * filters its own WS echo and would otherwise never learn its op's server order.
 * @type {Map<string, number>}
 */
const lastAppliedVersion = new MountMap();

/**
 * Highest serverVersion of a REMOTE op actually applied to each entity, kept apart from
 * {@link lastAppliedVersion} (which the author also seeds from its own acks). It is the only
 * evidence the author has that a peer's write landed on top of its own optimistic value.
 *
 * WHY IT EXISTS (2026-08-23): the defer guard below reads `pendingLocalEditCount` and the mark
 * that fills it is set in `logOperation` (`operation-dispatcher.js`), which runs from
 * `tx.deferAsync` — and `StoreTransaction.commit()` starts those effects FIRE-AND-FORGET
 * (`store-transaction.js`), after an `await operationQueue.enqueue`. So there is a real window
 * between "the local edit is durable" and "the entity is marked pending", and a second one even
 * with the mark moved earlier: `applyRemoteOperation` reads the count BEFORE
 * `applyRemoteFeatureOp` takes the map document lock, so a peer op can pass the guard, block on
 * the lock the local edit is holding, and write after it. A peer op landing in either window is
 * applied, and the author then NEVER learns it won: it filters its own WS echo
 * (`ws-client.js` `_isOwnClientId`), so nothing ever brings its value back. Measured symptom:
 * the server holds C's colour, C displays A's, forever.
 * @type {Map<string, number>}
 */
const lastRemoteAppliedVersion = new MountMap();

/**
 * Serialization chain for the CONVERGENCE-GUARDED apply path.
 *
 * The version guard only decides anything if the check, the write and the record are ONE step.
 * They were not: `applyRemoteOperation` reads `shouldApplyVersion` and only THEN calls a handler
 * that awaits the document lock, so two applies can both pass the check and land in lock order,
 * which is the opposite order. `ws-client.js` hid this for inbound ops by chaining them
 * (`_applyChain`), and exactly three call sites bypass that chain: the deferred-op replay and the
 * local-winner repair (both in `resolveLocalEdit`) and the post-flush replay in
 * `reconcilePendingLocalEdits`.
 *
 * Measured in the field on 2026-08-23, mirror signature `servidor=#0000ff
 * clientes=#0000ff,#0000ff,#00ff00`: the author's repair passed the check, the peer's WINNING op
 * passed it too, the peer wrote first and the repair wrote last, leaving the author on a value the
 * server had already superseded. With the chain the repair is re-checked after the peer recorded
 * its version, so it is simply dropped.
 *
 * NOT a substitute for the document lock: this orders the GUARD, that one orders the DOCUMENT
 * (and is per map, so unrelated maps still write in parallel). It does not reach
 * `drainPendingFeatureOps`, which applies its buffered ops through `applyRemoteFeatureOp`
 * directly and carries its own version check.
 * @type {Promise<void>}
 */
let guardedApplyChain = Promise.resolve();

/**
 * Queues `fn` after every guarded apply already in flight. A rejecting section never breaks the
 * chain for the next one (the tail swallows), and the rejection still reaches this caller.
 * @param {() => Promise<void>} fn
 * @returns {Promise<void>}
 */
/**
 * Avisa que a edição desta pessoa foi substituída pela de um colega, quando for o caso.
 *
 * TRÊS CONDIÇÕES, e cada uma tira um falso positivo: a op tem de vir de outra pessoa (o autor
 * chega no quadro, `authorUserId`), a entidade tem de ter sido editada AQUI nos últimos segundos
 * (`editedRecentlyLocally`), e a presença tem de saber o NOME de quem escreveu — sem nome não há
 * aviso, porque um "alguém alterou isto" gasta a atenção sem dar o que faria a pessoa agir.
 *
 * BEST-EFFORT E SÍNCRONO: roda dentro do caminho quente de aplicação, então não lê rede, não
 * espera nada e engole a própria falha. Um defeito no aviso não pode impedir a convergência.
 * @param {string} entityId
 * @param {string|null|undefined} authorUserId
 */
function announceOverwrite(entityId, authorUserId) {
    try {
        if (!authorUserId) return;
        if (!editedRecentlyLocally(entityId, Date.now())) return;
        // EMITE, NAO DESENHA. A primeira versao importava `presenceStore` e `showToast` daqui, e
        // isso arrastou o grafo do store para dentro deste modulo: SETE suites de integracao
        // pararam de CARREGAR, porque os mocks delas nao cobriam o que veio junto. O store emite e
        // a UI escuta, que e a regra da casa e tambem o que mantem este caminho leve.
        emit(EventTypes.REMOTE_EDIT_OVERWRITTEN, { entityId, authorUserId });
    } catch {
        // Um aviso que falha e um aviso a menos; uma excecao aqui seria uma op nao aplicada.
    }
}

function serializeGuardedApply(fn) {
    const run = guardedApplyChain.then(fn, fn);
    guardedApplyChain = run.then(() => {}, () => {});
    return run;
}

/** Records the highest REMOTE-applied serverVersion for `entityKey` (clobber evidence). */
function markRemoteApplied(entityKey, serverVersion) {
    if (serverVersion == null) return;
    const prev = lastRemoteAppliedVersion.get(entityKey);
    if (prev == null || serverVersion > prev) lastRemoteAppliedVersion.set(entityKey, serverVersion);
}

/**
 * Count of the local user's UN-ACKED edits per feature id. While > 0, a remote op for that
 * feature is DEFERRED (not applied), because the author's optimistic local edit has no
 * serverVersion yet — applying a remote op in that window could overwrite a (possibly-newer)
 * local edit and leave the clients divergent. The push ack (resolveLocalEdit) reveals the
 * server order and replays the deferred ops through the version guard.
 * @type {Map<string, number>}
 */
const pendingLocalEditCount = new MountMap();

/** Remote ops deferred while the local user had an un-acked edit, keyed by entity id. */
const deferredRemoteOps = new MountMap();
const deferredCompletions = new Map();

function completionKey(scope, operation) {
    return `${scope?.dbSuffix ?? ''}:${operation.id}`;
}

function waitForDeferredOperation(operation, context) {
    const buffered = deferredRemoteOps.get(operation.entityId);
    if (!buffered?.some(op => op.id === operation.id)) return false;
    return new Promise((resolve, reject) => {
        const key = completionKey(context.scope, operation);
        if (!deferredCompletions.has(key)) deferredCompletions.set(key, new Set());
        const waiters = deferredCompletions.get(key);
        const finish = error => {
            context.signal?.removeEventListener('abort', abort);
            waiters.delete(finish);
            if (!waiters.size) deferredCompletions.delete(key);
            if (error) reject(error); else resolve(true);
        };
        const abort = () => finish(context.signal.reason);
        waiters.add(finish);
        context.signal?.addEventListener('abort', abort, { once: true });
        if (context.signal?.aborted) abort();
    });
}

/** Cap so a never-acked local edit can't grow the deferred buffer unbounded. */
const MAX_DEFERRED_PER_ENTITY = 200;

/**
 * Entity types whose UPDATE blindly replaces and therefore need LWW-by-serverVersion to converge
 * on concurrent edits. The convergence guard (defer + version check + record) is applied
 * GENERICALLY in applyRemoteOperation for all of these, so each entity handler stays unaware of it.
 */
export const CONVERGENCE_GUARDED = new Set([
    EntityType.FEATURE,
    EntityType.LAYER,
    EntityType.GROUP,
    EntityType.MARKER_3D,
    EntityType.MEASUREMENT_3D,
    EntityType.VIEWSHED_3D,
    EntityType.CAMERA_POSITION_3D,
    EntityType.ORIENTATION_360,
    EntityType.MARKER_360,
    // BRIEFING entrou em 2026-07-25, e a ausência dele contradizia o critério declarado
    // logo acima: `applyRemoteBriefingOp` faz `saveBriefing(briefingId, data)` com o objeto
    // INTEIRO, array de slides incluído, que é a definição de "substitui em bloco". Como o
    // slide isolado é no-op inbound e converge pelo briefing pai, dois usuários editando
    // slides do mesmo briefing não tinham proteção LWW nenhuma: o último a chegar levava o
    // array inteiro e o trabalho do outro sumia sem erro.
    //
    // Repare por que basta acrescentar aqui: este Set é a fonte única das DUAS metades do
    // guarda. `operation-dispatcher.js:147` também gateia por ele para marcar a edição local
    // pendente, então o defer e a checagem de versão ligam juntos.
    EntityType.BRIEFING,
]);

/**
 * Entity types already warned about, so deploy skew does not flood the console.
 * @type {Set<string>}
 */
const warnedUnknownEntityTypes = new Set();

/** @returns {boolean} Whether an inbound op of `serverVersion` should apply to `entityKey`. */
function shouldApplyVersion(entityKey, serverVersion) {
    if (serverVersion == null) return true; // un-stamped (legacy / no backend) → no ordering guard
    const prev = lastAppliedVersion.get(entityKey);
    return prev == null || serverVersion >= prev;
}

/** Records the highest applied serverVersion for `entityKey`. */
function markAppliedVersion(entityKey, serverVersion) {
    if (serverVersion == null) return;
    const prev = lastAppliedVersion.get(entityKey);
    if (prev == null || serverVersion > prev) lastAppliedVersion.set(entityKey, serverVersion);
}

/**
 * Marks the start of a local (un-acked) edit on a feature, so a concurrent remote op for the
 * same feature is deferred until the author's ack reveals the order. Called from the outbound
 * logging path (operation-dispatcher) for every local feature op.
 * @param {string} featureId
 */
export function markLocalEditPending(featureId) {
    if (!featureId) return;
    const counts = pendingLocalEditCount.forScope(getActiveScope());
    counts.set(featureId, (counts.get(featureId) || 0) + 1);
}

/**
 * Ha alguma entidade com edicao local marcada como pendente?
 *
 * PERGUNTA BARATA DE PROPOSITO. Quem chama e o laco de auto-flush, a cada 1,5 s, para decidir se
 * vale pagar a leitura da fila que a reconciliacao faz. Ler o tamanho de um Map em memoria e
 * gratis; `operationQueue.getAll()` e uma ida ao IndexedDB.
 *
 * @returns {boolean} True enquanto qualquer entidade estiver com o freio de convergencia posto.
 */
export function hasPendingLocalEdits() {
    return pendingLocalEditCount.forScope(getActiveScope()).size > 0;
}

/** Buffers a remote op while the local user has an un-acked edit on the same entity. */
function deferRemoteOp(entityId, operation) {
    let arr = deferredRemoteOps.get(entityId);
    if (!arr) {
        arr = [];
        deferredRemoteOps.set(entityId, arr);
    }
    if (arr.some(op => op.id === operation.id)) return;
    if (arr.length >= MAX_DEFERRED_PER_ENTITY) throw new Error('Há alterações aguardando recuperação. Reconectando para obter uma base completa.');
    arr.push(operation);
}

/**
 * Resolves a local edit on its push ack: seeds the author's applied serverVersion, REPAIRS the
 * entity when a peer's OLDER op was applied over the local value, decrements the pending count,
 * and — once no local edit remains in flight — replays any deferred remote ops. The replayed ops
 * go through the version guard, so the entity converges to the highest serverVersion regardless
 * of delivery timing.
 *
 * THE REPAIR IS THE HALF THE DEFER GUARD CANNOT COVER (see {@link lastRemoteAppliedVersion}).
 * The ack is the ONLY moment the author learns its own arrival order, so it is also the only
 * moment it can discover it WON a race it had already visually lost. `localOp` is the op the
 * server just acked, and re-applying it is exactly what every peer did with it, so the author
 * ends in the same state as everyone else.
 *
 * It runs only when a remote op with a STRICTLY LOWER version was applied to this entity, which
 * is false for the overwhelming majority of acks (no peer touched the entity, or the peer op was
 * dropped/deferred by the guard and never applied). It is NOT free of redundant work: a peer op
 * applied cleanly BEFORE the local edit began also satisfies the condition, and the repair then
 * rewrites the value the store already holds. That is an idempotent write, and distinguishing it
 * would need a per-entity "remote applied since this op was created" stamp the queue does not
 * carry across a reload. One extra map-document write on an entity a peer just edited was the
 * price accepted for the guard failing CLOSED.
 *
 * It also only runs for the LAST un-acked local edit on that entity: an earlier op's data would
 * overwrite a newer local edit that is still in flight.
 *
 * Never throws (best-effort; called fire-and-forget from the flush path).
 * @param {string} entityId
 * @param {number} serverVersion
 * @param {Object} [localOp] - The acked local operation (entityType/operationType/entityId/
 *   mapId/data), used to restore the author's value when a peer's older op clobbered it.
 * @returns {Promise<void>}
 */
export async function resolveLocalEdit(entityId, serverVersion, localOp = null) {
    if (!entityId) return;
    const context = capturedApplyContext();
    const versions = lastAppliedVersion.forScope(context.scope);
    const counts = pendingLocalEditCount.forScope(context.scope);
    const remoteVersions = lastRemoteAppliedVersion.forScope(context.scope);
    if (serverVersion != null) versions.set(entityId, Math.max(versions.get(entityId) ?? 0, serverVersion));
    const remaining = (counts.get(entityId) || 0) - 1;
    if (remaining > 0) {
        counts.set(entityId, remaining);
        return;
    }
    counts.delete(entityId);

    // A snapshot can replace the local projection without an individual remote-op mark.
    if (localOp && serverVersion != null && versions.get(entityId) === serverVersion) {
        // Straight back through the inbound path: same handlers, same locks, same lifecycle
        // events, so the UI refreshes exactly as it does for a peer's op. The guard lets it
        // through by construction — the pending count was just cleared and
        // `shouldApplyVersion` compares `>=` against the version seeded three lines above.
        // `localRepair` identifies a local projection recovery, including slide intents.
        // The SyncLedger tap excludes it from peer delivery evidence.
        await applyRemoteOperation({ ...localOp, serverVersion, localRepair: true }, context);
    }
    context.assertActive();
    remoteVersions.delete(entityId);

    await replayDeferred(entityId, context);
}

async function replayDeferred(entityId, context) {
    const buffers = deferredRemoteOps.forScope(context.scope);
    const deferred = buffers.get(entityId);
    if (!deferred?.length) return;
    for (const op of [...deferred]) {
        context.assertActive();
        const applied = await applyRemoteOperation(op, context);
        context.assertActive();
        if (applied === false) break;
        deferred.splice(deferred.indexOf(op), 1);
    }
    if (!deferred.length) buffers.delete(entityId);
}

/**
 * Self-heals the pending-local-edit guard against the operation queue (the source of truth):
 * clears the deferral for any guarded entity that no longer has an un-acked op queued, and replays
 * its deferred remote ops. Called after every flush. The per-op count alone leaks when queue
 * compaction, batch ops, version-less acks, or a poison batch break the increment/decrement
 * symmetry — a leaked count would permanently defer that entity's remote ops (silent divergence).
 * @param {Set<string>} remainingEntityIds - entity ids that still have queued (un-acked) ops.
 * @returns {Promise<void>}
 */
export async function reconcilePendingLocalEdits(remainingEntityIds) {
    const context = capturedApplyContext();
    const counts = pendingLocalEditCount.forScope(context.scope);
    const stale = [];
    for (const entityId of counts.keys()) {
        if (!remainingEntityIds.has(entityId)) stale.push(entityId);
    }
    for (const entityId of stale) {
        context.assertActive();
        counts.delete(entityId);
        await replayDeferred(entityId, context);
    }
}

/** @deprecated Call-site alias of resolveLocalEdit (kept for stability). */
export const recordLocalAppliedVersion = resolveLocalEdit;

// ============================================================================
// INITIALIZATION
// ============================================================================

/**
 * Sets the EventBus dependency for emitting events.
 * Called once from initServices().
 *
 * @param {import('../../events/event_bus.js').EventBus} eventBus
 */
export function setRemoteHandlerEventBus(eventBus) {
    _eventBus = eventBus;
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

/**
 * Applies a remote operation to the local store.
 * Routes to entity-specific handlers based on entityType.
 *
 * @param {Object} operation - Remote operation
 * @param {string} operation.entityType - Entity type (from EntityType)
 * @param {string} operation.operationType - Operation type (from OperationType)
 * @param {string} operation.entityId - Entity UUID
 * @param {string} [operation.mapId] - Map UUID (context)
 * @param {Object} [operation.data] - Entity data (for CREATE/UPDATE)
 * @returns {Promise<void>}
 */
export async function applyRemoteOperation(operation, options = {}) {
    const context = capturedApplyContext(options);
    const guarded = CONVERGENCE_GUARDED.has(operation?.entityType) && !!operation?.entityId;
    const applied = await serializeGuardedApply(() => withApplyContext(context, () => applyRemoteOperationInner(operation, guarded)));
    if (applied === false && options.waitForDeferred) return waitForDeferredOperation(operation, context);
    if (applied !== false) {
        for (const finish of deferredCompletions.get(completionKey(context.scope, operation)) ?? []) finish();
    }
    return applied;
}

/**
 * @private Body of {@link applyRemoteOperation}. Runs inside the guarded-apply chain when
 * `guarded` is true, so its version check, its write and its record are one atomic step.
 * @param {Object} operation
 * @param {boolean} guarded
 * @returns {Promise<void>}
 */
async function applyRemoteOperationInner(operation, guarded) {
    const { entityType, operationType, entityId, mapId, data, serverVersion } = operation;

    // Convergence guard (LWW by server arrival order) for the entity types that blind-replace:
    //  1. defer the op while the local user has an un-acked edit on the same entity (so a peer's
    //     op can't overwrite a newer local edit before the ack reveals the order), and
    //  2. drop an op older than what was already applied.
    // The applied version is recorded AFTER the handler runs (below), and the whole span runs
    // inside the guarded-apply chain (see `serializeGuardedApply`), which is what makes
    // "check then write then record" atomic. Together these make concurrent edits to the same
    // entity converge deterministically.
    if (guarded) {
        if ((pendingLocalEditCount.get(entityId) || 0) > 0) {
            deferRemoteOp(entityId, operation);
            return false;
        }
        if (!shouldApplyVersion(entityId, serverVersion)) return;
    }

    let featureApplied = true;
    // Whether the entity handler actually wrote to IndexedDB (false for the redundant SLIDE
    // inbound no-op and unknown entity types) — gates the peer-side apply.persist span below.
    let entityPersisted = true;
    // A THIRD outcome, next to applied and failed: an op this BUILD cannot represent. See the
    // `default` branch below for why it is not a failure.
    let unknownType = false;
    switch (entityType) {
        case EntityType.FEATURE:
            // false = the op was BUFFERED (map not present yet), not applied — don't record its
            // version below, or a legitimate later op could be wrongly dropped by shouldApplyVersion.
            featureApplied = await applyRemoteFeatureOp(operationType, entityId, mapId, data, serverVersion, operation.id, operation.traceId);
            break;
        case EntityType.LAYER:
            await applyRemoteLayerOp(operationType, entityId, mapId, data, serverVersion);
            break;
        case EntityType.MAP:
            // A map op is atlas-level: its identity is `entityId` (the map id), and
            // `mapId` (the op context) is null. Pass entityId so remote MAP_CREATED/
            // MODIFIED/DELETED carry the real id (§1.8/§1.9).
            await applyRemoteMapOp(operationType, entityId, data, serverVersion);
            break;
        case EntityType.GROUP:
            await applyRemoteGroupOp(operationType, entityId, mapId, data);
            break;
        case EntityType.GROUP_FEATURE:
            // `entityId` is a throwaway UUID here (see logGroupFeatureOperation); the pair
            // this op is about travels in `data`.
            entityPersisted = await applyRemoteGroupFeatureOp(operationType, mapId, data);
            break;
        case EntityType.BRIEFING:
            await applyRemoteBriefingOp(operationType, entityId, data);
            break;
        case EntityType.COMMENT:
            await applyRemoteCommentOp(operationType, entityId, mapId, data);
            break;
        case EntityType.MARKER_3D:
            await applyRemoteCesium3dEntityOp('markers', EventTypes.MARKERS_3D_CHANGED, operationType, entityId, mapId, data);
            break;
        case EntityType.MEASUREMENT_3D:
            await applyRemoteCesium3dEntityOp('measurements', EventTypes.MEASUREMENTS_3D_CHANGED, operationType, entityId, mapId, data);
            break;
        case EntityType.VIEWSHED_3D:
            await applyRemoteCesium3dEntityOp('viewsheds', EventTypes.VIEWSHEDS_3D_CHANGED, operationType, entityId, mapId, data);
            break;
        case EntityType.CAMERA_POSITION_3D:
            await applyRemoteCameraOp(operationType, entityId, mapId, data);
            break;
        case EntityType.ORIENTATION_360:
            await applyRemoteOrientation360Op(operationType, entityId, mapId, data);
            break;
        case EntityType.MARKER_360:
            await applyRemoteMarker360Op(operationType, entityId, mapId, data);
            break;
        case EntityType.MAP_POSITION:
        case EntityType.BASE_LAYER:
        case EntityType.MAP_NOTES:
        case EntityType.GRID_STYLE:
        case EntityType.MAP_TEMPORAL:
            await applyRemoteMapSettingOp(entityType, mapId, data);
            break;
        case EntityType.CATALOG_LAYER:
            await applyRemoteCatalogLayerOp(operationType, entityId, mapId, data);
            break;
        case EntityType.SETTING:
            await applyRemoteSettingOp(data);
            break;
        case EntityType.SLIDE:
            // Live delivery carries the parent's full document. Recovery must also handle a
            // prepared slide whose parent envelope was already acknowledged before the crash.
            entityPersisted = operation.localRepair
                ? await applyLocalSlideIntent(operationType, entityId, mapId, data) : false;
            break;
        default:
            // AN ENTITY TYPE THIS BUILD DOES NOT KNOW IS IGNORED, NOT FAILED, and F13 is what the
            // old `false` cost. `_queueApply` (`ws-client.js`) reads `false` as a local write
            // failure and closes the socket with 4000; the reconnect replays the same op, which
            // fails again, so a server one deploy ahead of this client put it in a close/reconnect
            // loop and stopped ALL sync, for every entity type. `map_meta` and `atlas_meta` were
            // exactly that shape: targets the server accepted and rebroadcast with
            // `client_entity_type` preserved, with no branch here.
            //
            // AND THE CURSOR ADVANCES PAST IT, deliberately. The rule elsewhere is that the replay
            // boundary only moves when a `sync_response` was applied WHOLE, because a failed write
            // must stay eligible for replay. That rule assumes replay can succeed. Here it cannot:
            // no amount of replaying teaches this build a type it does not ship, so holding the
            // cursor would freeze the tail forever and cost every LATER op of every KNOWN type —
            // strictly worse than losing the one op this client cannot represent. The server stays
            // the durable copy, and the next snapshot re-derives whatever state the type carries.
            entityPersisted = false;
            unknownType = true;
            warnUnknownEntityTypeOnce(entityType);
            record(TraceStage.REMOTE_APPLIED, {
                opId: operation.id, traceId: operation.traceId,
                entityType, operationType, entityId, mapId, serverVersion,
                outcome: TraceOutcome.DROPPED, reason: DropReason.UNKNOWN_TYPE,
            });
    }

    // Record this entity's applied server order (DELETE clears it so a re-create starts fresh).
    // Skip when a feature op was only buffered (featureApplied === false) — it isn't applied yet.
    applyContext?.assertActive();
    if (guarded && featureApplied) {
        if (operationType === OperationType.DELETE) {
            markAppliedVersion(entityId, serverVersion);
            lastRemoteAppliedVersion.delete(entityId);
        } else {
            markAppliedVersion(entityId, serverVersion);
            // Clobber evidence for the author's ack-time repair. The local-winner repair below
            // re-enters here and marks itself, which is why `resolveLocalEdit` clears the entry
            // right AFTER awaiting it.
            markRemoteApplied(entityId, serverVersion);
            if (!operation.localRepair) announceOverwrite(entityId, operation.authorUserId);
        }
    }

    // Peer-side IndexedDB-write confirmation (full-chain "synced to peer IDB" link): the
    // entity handler above awaited its repo.saveXxx, so the write is durable now. A FEATURE op
    // that was only BUFFERED (map absent) has NOT been written — skip it here;
    // drainPendingFeatureOps emits apply.persist when it actually replays the write.
    if (entityPersisted && (entityType !== EntityType.FEATURE || featureApplied)) {
        record(TraceStage.APPLY_PERSIST, {
            opId: operation.id, traceId: operation.traceId,
            entityType, operationType, entityId, mapId, serverVersion,
            outcome: TraceOutcome.OK,
        });
    }

    emit(EventTypes.REMOTE_OPERATION_APPLIED, { operation });
    // `true` for the ignored unknown type: every consumer of this return compares against `false`
    // and only `false` means "this receive path failed, close the stream" (`_queueApply` in
    // `ws-client.js`, and the `=== false` bail in the engine's `syncResponse` loop). The trace span
    // above is what distinguishes ignored from applied for anyone diagnosing; the transport must
    // not be able to tell them apart, because one of them is not a failure.
    if (unknownType) return true;
    // UMA OP DE MEMBRESIA QUE NAO ESCREVEU NADA TAMBEM NAO FALHOU, e tratar as duas como a mesma
    // coisa custa exatamente o que o bloco de tipo desconhecido acima descreve: `_queueApply`
    // (`ws-client.js`) le o `false` como falha de escrita local e fecha o socket com 4000, o
    // `_onConnected` pede a cauda de novo, a MESMA op volta e falha de novo. Laco permanente, e o
    // par para de receber tudo, de todo tipo.
    //
    // O GATILHO E O CAMINHO NORMAL, nao um caso de borda. `GroupManager.createGroup` registra o
    // `group` CREATE com `data.features` JA POVOADO e, atras dele, um `group_feature` CREATE por
    // membro. Os dois alvos sao obrigatorios (o servidor ignora `data.features` no INSERT de grupo
    // e remonta a lista da tabela de juncao), mas o PAR ja recebeu o documento inteiro no primeiro
    // envelope: cada `group_feature` que vem atras encontra o membro no lugar, nao muda nada e
    // devolvia `false`. Ou seja, agrupar feicoes derrubava o socket de quem estava do outro lado,
    // na hora e sempre. Medido pelos dois casos de
    // `frontend/tests/e2e-ui/browser-collab-grupo-perde-membro.spec.js`, que morriam na primeira
    // assercao dependente de entrega AO VIVO depois da criacao do grupo.
    //
    // O `false` de `applyRemoteGroupFeatureOp` continua dizendo o que sempre disse — NADA FOI
    // ESCRITO —, e e ele que decide o span `apply.persist` acima. O que muda e so a traducao disso
    // para o transporte, que nao pode distinguir "ja convergido" de "quebrado".
    if (entityType === EntityType.GROUP_FEATURE) return true;
    return featureApplied && (entityPersisted || entityType === EntityType.SLIDE);
}

/**
 * Warns once per unknown entity type, for the life of the page.
 *
 * Once per TYPE and not once per op: deploy skew means a server one release ahead sends the same
 * unknown type on every broadcast and on every replay, so a per-op warning would bury the console
 * (which is where the diagnosis happens) under thousands of identical lines and hide whatever came
 * next. The trace span keeps the per-op record.
 * @param {string} entityType - The type this build does not know.
 * @returns {void}
 */
function warnUnknownEntityTypeOnce(entityType) {
    const key = String(entityType);
    if (warnedUnknownEntityTypes.has(key)) return;
    warnedUnknownEntityTypes.add(key);
    console.warn(`Remote operation handler: unknown entity type "${key}" — op ignored, not applied.`);
}

// ============================================================================
// ENTITY-SPECIFIC HANDLERS
// ============================================================================

/**
 * Finds a feature by ID within a storage type array.
 *
 * @param {Array} features - Feature array to search
 * @param {string} featureId - Feature UUID
 * @returns {number} Index of the feature, or -1 if not found
 */
function findFeatureIndex(features, featureId) {
    return features.findIndex(f => f.properties?.id === featureId);
}

/**
 * Applies a remote feature operation.
 *
 * @param {string} opType - Operation type
 * @param {string} featureId - Feature UUID
 * @param {string} mapId - Map UUID
 * @param {Object} data - Feature GeoJSON data
 * @param {number} [serverVersion] - Server arrival order, for the LWW guard
 * @param {string} [opId] - Op id, the SyncLedger join key
 * @param {string} [traceId] - Trace id, minted per user gesture
 *
 * `opId` e `traceId` são declarados aqui de propósito, ainda que a função não os use no
 * caminho direto: os dois call sites já os passavam (`:68` e `:282`) e a assinatura os
 * descartava, então o buffer nascia sem as chaves de junção do SyncLedger. `drainPendingFeatureOps`
 * lê `op.opId`/`op.traceId` ao emitir o span `apply.persist` do replay, e eles saíam
 * indefinidos: o elo full-chain se rompia exatamente no caso que o buffer existe para cobrir.
 *
 * @returns {Promise<boolean>} Whether the op was applied (false = buffered)
 */
async function applyRemoteFeatureOp(opType, featureId, mapId, data, serverVersion, opId, traceId) {
    // A confirmed move also removes the old projection. This marker comes from the
    // committed server row and is persisted in the replay, not inferred from a CREATE.
    if (data?.previousMapId && data.previousMapId !== mapId) {
        await withMapDocument(data.previousMapId, 'applyRemoteFeatureMove', async () => {
            const repo = handlerRepository();
            const previous = await repo.getMap(data.previousMapId);
            if (!previous) return;
            let removed = false;
            for (const bucket of Object.values(previous.features ?? {})) {
                if (!Array.isArray(bucket)) continue;
                const index = findFeatureIndex(bucket, featureId);
                if (index !== -1) { bucket.splice(index, 1); removed = true; }
            }
            if (removed) {
                await repo.saveMap(data.previousMapId, previous);
                emit(EventTypes.FEATURE_DELETED, { featureId, mapId: data.previousMapId, featureType: data.properties?.source });
            }
        });
    }
    // Inbound writes race with the LOCAL ones (a peer's op lands while the user is drawing),
    // and both are read-modify-writes of the same map document. Same lock key as the local
    // side, resolved through the map id (document-lock.js).
    return withMapDocument(mapId, 'applyRemoteFeatureOp', () =>
        applyRemoteFeatureOpLocked(opType, featureId, mapId, data, serverVersion, opId, traceId));
}

/**
 * Body of applyRemoteFeatureOp, already holding the map document lock.
 *
 * @param {string} opType - Operation type
 * @param {string} featureId - Feature UUID
 * @param {string} mapId - Map UUID
 * @param {Object} data - Feature GeoJSON data
 * @param {number} [serverVersion] - Server arrival order, for the LWW guard
 * @param {string} [opId] - Op id, the SyncLedger join key
 * @param {string} [traceId] - Trace id, minted per user gesture
 * @returns {Promise<boolean>} Whether the op was applied (false = buffered)
 */
async function applyRemoteFeatureOpLocked(opType, featureId, mapId, data, serverVersion, opId, traceId) {
    const repo = handlerRepository();
    const mapData = await repo.getMap(mapId);
    if (!mapData) {
        // The map hasn't been applied locally yet — a feature/create can arrive before its
        // map/create op (A creates a map and immediately draws on it). Buffer instead of
        // dropping (which was silent data loss); drainPendingFeatureOps replays it once the
        // map lands (applyRemoteMapOp CREATE / applyRemoteSnapshot).
        // `opId` e `traceId` viajam no buffer: sem eles o span `apply.persist` do replay sai
        // com a chave de junção indefinida e o SyncLedger perde o elo justamente no caminho
        // bufferizado, que é o mais difícil de diagnosticar sem ele.
        bufferPendingFeatureOp(mapId, { opType, featureId, data, serverVersion, opId, traceId });
        return false;
    }

    const sourceType = data?.properties?.source || 'point';
    const storageType = getStorageTypeFromSource(sourceType);

    if (!mapData.features[storageType]) {
        mapData.features[storageType] = [];
    }

    const features = mapData.features[storageType];

    switch (opType) {
        case OperationType.CREATE: {
            // Idempotent by id: a re-applied/echoed CREATE (e.g. the author's own
            // op coming back on a catch-up pull) must NOT duplicate the feature —
            // replace in place when it already exists instead of pushing a copy.
            const existingIndex = findFeatureIndex(features, featureId);
            if (existingIndex !== -1) {
                features[existingIndex] = data;
            } else {
                features.push(data);
            }
            await repo.saveMap(mapId, mapData);

            emit(EventTypes.FEATURE_CREATED, {
                featureId, featureType: sourceType, mapId, feature: data
            });
            break;
        }
        case OperationType.UPDATE: {
            const index = findFeatureIndex(features, featureId);
            if (index !== -1) {
                const previousFeature = features[index];
                features[index] = data;
                await repo.saveMap(mapId, mapData);

                emit(EventTypes.FEATURE_MODIFIED, {
                    featureId, featureType: sourceType, mapId,
                    feature: data, previousFeature
                });
            }
            break;
        }
        case OperationType.DELETE: {
            // A DELETE op carries no `data` (only previousData), so the source/storage
            // bucket can't be derived from it — sourceType defaulted to 'point', which
            // silently dropped the delete of EVERY non-point feature type (it searched
            // only the 'points' bucket). Search ALL buckets by id and remove it.
            let deletedFeature = null;
            for (const arr of Object.values(mapData.features)) {
                if (!Array.isArray(arr)) continue;
                const idx = findFeatureIndex(arr, featureId);
                if (idx !== -1) {
                    deletedFeature = arr[idx];
                    arr.splice(idx, 1);
                    break;
                }
            }
            if (deletedFeature) {
                await repo.saveMap(mapId, mapData);
                emit(EventTypes.FEATURE_DELETED, {
                    featureId, featureType: deletedFeature.properties?.source || sourceType, mapId
                });
            }
            break;
        }
    }

    emit(EventTypes.LAYERS_CHANGED, { mapName: mapId });
    return true;
}

/**
 * Applies a remote layer operation.
 *
 * The DELETE branch mirrors the server's layer cascade through
 * {@link cascadeRemoteLayerDelete}: deleting the layer deletes its features in this map. See
 * that helper's header for why the cascade belongs to whoever APPLIES the delete, and not to a
 * feature op emitted by the author.
 *
 * @param {string} opType - Operation type
 * @param {string} layerId - Layer UUID
 * @param {string} mapId - Map UUID
 * @param {Object} data - Layer data
 * @returns {Promise<void>} Resolves once persisted and announced
 */
/**
 * @private The confirmed revision of a layer record a live payload was merged into: the payload's
 * own when the server dated it (the canonical row a layer UPDATE ack carries), none otherwise.
 * @param {Object} merged - The record about to be stored.
 * @param {Object|null} data - The inbound payload.
 * @returns {Object} `merged`.
 */
function mergedLayerRevision(merged, data) {
    return data?.version != null
        ? stampConfirmedVersion(merged, data.version)
        : clearConfirmedVersion(merged);
}

async function applyRemoteLayerOp(opType, layerId, mapId, data, serverVersion) {
    const repo = handlerRepository();
    await flushLayerProjection(mapId);
    /** @type {Array<{featureId: string, featureType: string}>} */
    let cascaded = [];
    // Persist the layer to the local store like the map/feature handlers do. Emitting
    // an event alone left the peer WITHOUT the layer — the desktop has no subscriber
    // that persists LAYER_* events — so a collaborator's new/edited/deleted layer never
    // reached the other client.
    const layers = (await repo.getLayers?.(mapId)) || [];
    let next = layers;
    if (opType === OperationType.CREATE) {
        next = findFeatureIndexById(layers, layerId) !== -1
            ? layers.map((l) => (l.id === layerId ? data : l)) // idempotent re-apply
            : [...layers, data];
    } else if (opType === OperationType.UPDATE) {
        // MERGE, so the confirmed revision of the record being merged INTO survives unless the
        // payload dates itself. Same reasoning as `mergeRemoteMapUpdate`: a stale base is worse
        // than none, because it loses to a change the peer has already applied.
        next = layers.map((l) => (l.id === layerId
            ? mergedLayerRevision({ ...l, ...data }, data)
            : l));
        if (!next.some((l) => l.id === layerId) && data?.id === layerId && data.version != null) {
            next.push(stampConfirmedVersionFromRow(data));
        }
    } else if (opType === OperationType.DELETE) {
        next = layers.filter((l) => l.id !== layerId);
        // Add only missing survivors/replacements; an ACK must not overwrite a
        // newer local edit of an existing layer with the deletion's older snapshot.
        for (const layer of data?.replacementLayers ?? []) {
            if (shouldApplyVersion(layer.id, serverVersion) && !next.some((l) => l.id === layer.id)) {
                next.push(layer);
                markAppliedVersion(layer.id, serverVersion);
            }
        }
    }
    await repo.saveLayers?.(mapId, next);
    // The cascade runs AFTER the layer leaves the list, in the server's own order, and the
    // harvest is emitted outside the `try` so that a persistence failure cannot announce a
    // deletion that did not happen.
    if (opType === OperationType.DELETE) {
        cascaded = await cascadeRemoteLayerDelete(layerId, mapId);
    }
    // Refresh the in-memory layer cache so getVisibleLayerIds() and the features panel
    // see the new/changed layer immediately. The visibility filter reads memoryStore
    // (not the repo), so without this a peer's features on a brand-new layer are filtered
    // OUT until a manual map switch (§item3a). Only the current map has a live cache.
    const layerMapName = mapResolver.resolveToName(mapId) || mapId;
    if (memoryStore.currentMap === layerMapName) {
        await present(async () => {
            const { loadLayersToMemory } = await import('../layer.operations.js');
            await loadLayersToMemory(layerMapName);
        });
    }

    switch (opType) {
        case OperationType.CREATE:
            emit(EventTypes.LAYER_CREATED, { layerId, mapId, layer: data });
            break;
        case OperationType.UPDATE:
            emit(EventTypes.LAYER_MODIFIED, { layerId, mapId, layer: data });
            break;
        case OperationType.DELETE:
            emit(EventTypes.LAYER_DELETED, { layerId, mapId });
            // One per feature, in the SAME shape the feature-delete branch uses, because that
            // is the event the render layer and the features tab listen to. Nothing to emit
            // when the cascade removed nothing, which is the idempotent case.
            for (const { featureId, featureType } of cascaded) {
                emit(EventTypes.FEATURE_DELETED, { featureId, featureType, mapId });
            }
            break;
    }

    emit(EventTypes.LAYERS_CHANGED, { mapName: mapId });
}

/**
 * MIRRORS THE SERVER'S LAYER CASCADE: deleting a LAYER deletes its features.
 *
 * In the same transaction as the layer delete, the server runs
 * `UPDATE features SET deleted_at ... WHERE layer_id = $1 AND map_id = $2`
 * (`backend/src/modules/sync/sync.service.js`, the block marked as the layer cascade). The
 * client emits NO feature op on that path: `deleteLayerFeatures` empties the local document
 * without logging anything, so the only envelope that travels is the layer delete. While this
 * branch merely filtered the layer list, the peer kept every feature of the deleted layer
 * inside its map document, i.e. the database and the peer disagreed until the next snapshot.
 *
 * AND IT CANNOT BE FIXED BY EMITTING `feature delete` ON THE AUTHOR'S SIDE, which is the
 * obvious move: moving a layer between maps (`transferLayerToMap`) KEEPS the feature id and
 * relocates it through a `feature create` stamped with the DESTINATION map. Under LWW by
 * arrival order, a `feature delete` for that same id arriving behind it would erase exactly
 * what had just moved. The cascade belongs to whoever APPLIES the layer delete, on both sides
 * of the envelope.
 *
 * SAME SCOPE AS THE SERVER: layer AND map. No other map is touched, and the `layerId`
 * comparison is STRICT (no fallback to the local `'default'`), because in a server atlas every
 * layer carries a UUID and that fallback only exists for the synthesized layer of a LOCAL
 * atlas, which never arrives as a remote op.
 *
 * IDEMPOTENT: nothing to remove is the normal case (a re-applied delete, or an empty layer).
 *
 * @param {string} layerId - Layer UUID whose features go with it
 * @param {string} mapId - Map UUID that owns them
 * @returns {Promise<Array<{featureId: string, featureType: string}>>} What was removed
 */
function cascadeRemoteLayerDelete(layerId, mapId) {
    // Same lock key as `applyRemoteFeatureOp`: this is a read-modify-write of the SAME map
    // document, and it races the user's local drawing.
    return withMapDocument(mapId, 'applyRemoteLayerOp:cascade', async () => {
        const repo = handlerRepository();
        const mapData = await repo.getMap(mapId);
        if (!mapData?.features) return [];

        const removed = [];
        for (const arr of Object.values(mapData.features)) {
            if (!Array.isArray(arr) || arr.length === 0) continue;
            for (let i = arr.length - 1; i >= 0; i--) {
                if (arr[i]?.properties?.layerId !== layerId) continue;
                removed.push({
                    featureId: arr[i].properties?.id,
                    featureType: arr[i].properties?.source || 'point'
                });
                arr.splice(i, 1);
            }
        }

        if (removed.length > 0) await repo.saveMap(mapId, mapData);
        return removed;
    });
}

/** Index of a layer by its `id` (layers have a top-level id, not properties.id). */
function findFeatureIndexById(arr, id) {
    return arr.findIndex((x) => x && x.id === id);
}

/**
 * Applies a LIVE `map` UPDATE by MERGING the fields the payload carries into the stored record.
 *
 * IT USED TO BE A BLIND WHOLE-DOCUMENT WRITE, AND THAT WAS THE DEFECT REGISTERED IN
 * `.claude/rules/architecture.md` §Lock. A live `map` update carries only what CHANGED (the
 * server applies `MAP_UPDATE_FIELDS` dynamically and the broadcast echoes the client's payload),
 * so a lock toggle arrives as `{ locked: true }` and nothing else. Writing that verbatim replaced
 * the peer's whole map record: the measured symptom was the Editor's feature count falling from 2
 * to 0 and the map losing its name, in three runs of three. Diagnosed and fixed in 2026-09-13.
 *
 * THE SECOND HALF OF THE SAME DEFECT WAS THAT THE LOCK ITSELF WAS DROPPED, and it is the one that
 * is easy to miss: `reshapeSnapshotMap` keys the lock side-store by the map NAME
 * (`mapLocked_<name>`, which is what `setCurrentMap` reads) and a partial payload has no name, so
 * the only field the op carried went nowhere and the peer never read the map as locked. The name is
 * therefore resolved from the STORED record, or from the resolver, before the reshape runs.
 *
 * ONLY THE CARRIED KEYS ARE MERGED, never the reshaped object wholesale: `ensureMapDataShape`
 * inside the reshape can fabricate an empty feature collection, and `{ ...existing, ...reshaped }`
 * would hand the peer a map with no features, which is the very bug this replaces.
 *
 * @param {Object} repo - Active repository
 * @param {string} mapId - Map UUID
 * @param {Object} data - The partial map payload of the live op
 * @returns {Promise<Object>} The merged record that was written
 */
function mergeRemoteMapUpdate(repo, mapId, data) {
    // The same lock key as every other writer of this document: this is a read-modify-write and it
    // races the local user drawing on the same map.
    return withMapDocument(mapId, 'applyRemoteMapOp:update', async () => {
        const existing = await repo.getMap?.(mapId);
        const payload = { ...data };
        if (payload.name == null) {
            const known = existing?.name ?? mapResolver.resolveToName?.(mapId);
            // Only to key the name-addressed side stores (lock, temporal). It is the name the
            // record already has, so merging it back changes nothing.
            if (known) payload.name = known;
        }
        const reshaped = await reshapeSnapshotMap(repo, payload);
        const carried = new Set(Object.keys(payload));
        // `base_layer` arrives snake_case and lands as `baseLayer`.
        if (carried.has('base_layer')) carried.add('baseLayer');

        const merged = { ...(existing ?? {}) };
        for (const [key, value] of Object.entries(reshaped)) {
            if (carried.has(key)) merged[key] = value;
        }
        // The row moved and this payload does not say to what: keeping the old confirmed revision
        // would make the next local edit declare a base the server has already passed, and lose a
        // race against a change this peer has just been shown. No base is the honest answer.
        if (carried.has('version')) stampConfirmedVersion(merged, payload.version);
        else clearConfirmedVersion(merged);
        await repo.saveMap?.(mapId, merged);
        return merged;
    });
}

/**
 * Applies a remote map operation.
 *
 * @param {string} opType - Operation type
 * @param {string} mapId - Map UUID
 * @param {Object} data - Map data
 */
async function applyRemoteMapOp(opType, mapId, data, serverVersion) {
    const repo = handlerRepository();
    switch (opType) {
        case OperationType.CREATE: {
            // Persist a map another user created so it appears locally (§1.8). Reshape the
            // backend snake_case columns → local camelCase + side-stores first (same as the
            // snapshot path); a passthrough for already-camelCase live ops, but it keeps a
            // snake_case broadcast from corrupting the map's local shape (§item2). saveMap
            // registers the name↔UUID resolver mapping so the maps list shows the name.
            const reshaped = data ? await reshapeSnapshotMap(repo, data) : data;
            // Blind whole-document write: it needs the lock not to protect its own read (it
            // has none) but so it cannot land INSIDE another writer's read-modify-write
            // window, which would revert the map to this snapshot.
            if (reshaped) await withMapDocument(mapId, 'applyRemoteMapOp:create', () => repo.saveMap?.(mapId, reshaped));
            await applyConfirmedMapLayers(repo, mapId, data?.layers, serverVersion);
            if (reshaped?.name) present(() => mapResolver.registerMap(reshaped.name, mapId));
            // Replay any feature ops that arrived before this map existed (anti silent-drop).
            // OUTSIDE the lock above: each replayed op takes the same key itself, so draining
            // inside it makes the section wait for itself (measured: the guard test hangs).
            await drainPendingFeatureOps(mapId);
            emit(EventTypes.MAP_CREATED, { mapId, map: reshaped });
            break;
        }
        case OperationType.UPDATE: {
            const merged = data ? await mergeRemoteMapUpdate(repo, mapId, data) : data;
            emit(EventTypes.MAP_MODIFIED, { mapId, map: merged });
            break;
        }
        case OperationType.DELETE:
            // Remove the map another user deleted (§1.9). The resolver entry is left
            // intact so the maps tab can still resolve id→name for its redirect; the
            // resolver is rebuilt on the next snapshot/init.
            await repo.deleteMap?.(mapId);
            emit(EventTypes.MAP_DELETED, { mapId });
            break;
    }
    // The maps list, "Mapas" tab, current-map card and the recent-map badge all refresh on
    // LAYERS_CHANGED (not on MAP_*), so a peer's map create/rename/delete must emit it too —
    // otherwise the badge/list never sync until a fresh snapshot (mirrors applyRemoteSnapshot).
    emit(EventTypes.LAYERS_CHANGED, { mapName: null });
}

async function applyConfirmedMapLayers(repo, mapId, layers, serverVersion) {
    if (!Array.isArray(layers)) return;
    await flushLayerProjection(mapId);
    const current = (await repo.getLayers?.(mapId)) ?? [];
    const next = current.filter((layer) => layer.id !== 'default');
    for (const layer of layers) {
        if (shouldApplyVersion(layer.id, serverVersion) && !next.some((existing) => existing.id === layer.id)) {
            // Rows the server itself serialised, so their `version` is the confirmed revision.
            next.push(stampConfirmedVersionFromRow(layer));
            markAppliedVersion(layer.id, serverVersion);
        }
    }
    await repo.saveLayers?.(mapId, next);
    const mapName = mapResolver.resolveToName(mapId) || mapId;
    if (memoryStore.currentMap === mapName) {
        await present(async () => {
            const { loadLayersToMemory } = await import('../layer.operations.js');
            await loadLayersToMemory(mapName);
        });
    }
    emit(EventTypes.LAYERS_CHANGED, { mapName });
}

async function flushLayerProjection(mapId) {
    const mapName = mapResolver.resolveToName(mapId) || mapId;
    if (memoryStore.currentMap === mapName) {
        await present(async () => {
            const { flushPendingLayerWrites } = await import('../layer.operations.js');
            await flushPendingLayerWrites();
        });
    }
}

/** A map CREATE ACK adds server layers without rewriting newer features in the map. */
export async function applyMapCreationAck(operation) {
    const context = capturedApplyContext();
    return serializeGuardedApply(() => withApplyContext(context, async () => {
        if (!await handlerRepository().getMap?.(operation.entityId)) return;
        await applyConfirmedMapLayers(handlerRepository(), operation.entityId, operation.data?.layers, operation.serverVersion);
    }));
}

/**
 * Applies a remote group operation.
 *
 * @param {string} opType - Operation type
 * @param {string} groupId - Group UUID
 * @param {string} mapId - Map UUID
 * @param {Object} data - Group data
 */
async function applyRemoteGroupOp(opType, groupId, mapId, data) {
    const repo = handlerRepository();
    // Persist the group to BOTH the local group store (a separate store from map data,
    // keyed by map id) AND the in-memory cache (memoryStore.groups, keyed by map NAME —
    // what getMapGroups reads), mirroring how group_manager writes them. Emitting an event
    // alone left the peer WITHOUT the group: no subscriber persists GROUP_* events, and the
    // map-data save never touches the group store. The backend already stores groups and
    // returns them in the snapshot — this is the live-op half of that same contract.
    const mapName = mapResolver.resolveToName(mapId) || mapId;
    const groups = (await repo.getGroups?.(mapId)) || {};
    if (opType === OperationType.DELETE) {
        delete groups[groupId];
    } else if (data) {
        groups[groupId] = data;
    }
    await repo.saveGroups?.(mapId, groups);
    present(() => { memoryStore.groups[mapName] = groups; });

    switch (opType) {
        case OperationType.CREATE:
            emit(EventTypes.GROUP_CREATED, { groupId, mapId, group: data });
            break;
        case OperationType.UPDATE:
            emit(EventTypes.GROUP_MODIFIED, { groupId, mapId, group: data });
            break;
        case OperationType.DELETE:
            emit(EventTypes.GROUP_DELETED, { groupId, mapId });
            break;
    }

    emit(EventTypes.GROUPS_CHANGED, {});
}

/**
 * Applies a remote group MEMBERSHIP operation: one feature entering or leaving one group.
 *
 * The peer keeps membership inside the group document (`group.features`, a list of
 * `{type, id}`), while the server keeps it in a join table; this is where the two meet. It
 * edits the list IN PLACE instead of replacing the document, which is the whole point: the
 * author's `group` op is not resent on a membership change, so a blind replace here would
 * have nothing to replace with.
 *
 * Returns whether anything was written, so the caller does not record an `apply.persist`
 * span for an op that found no group (the same contract as the buffered-feature path).
 *
 * @param {string} opType - Operation type
 * @param {string} mapId - Map UUID
 * @param {Object} data - `{ group_id, feature_id, feature_type }`
 * @returns {Promise<boolean>} True when the local group document was updated
 */
async function applyRemoteGroupFeatureOp(opType, mapId, data) {
    const groupId = data?.group_id;
    const featureId = data?.feature_id;
    if (!groupId || !featureId) return false;

    const repo = handlerRepository();
    const mapName = mapResolver.resolveToName(mapId) || mapId;
    const groups = (await repo.getGroups?.(mapId)) || {};
    const group = groups[groupId];
    // No group locally: nothing to attach the member to. The `group` op that creates it
    // is logged BEFORE its membership ops, so in order this cannot be a race; an op for a
    // group this peer never received is residue, and inventing a group from it would put
    // a nameless entry in the tab.
    if (!group || !Array.isArray(group.features)) return false;

    // ONE identity predicate for both branches. A member is the PAIR (type, id), which is
    // what `GroupManager.getFeatureGroup` matches on locally; using it on the delete and
    // the plain id on the create would let a create and the delete that undoes it disagree
    // about what "the same member" is. A legacy op with no `feature_type` degrades to
    // matching by id alone, on both sides.
    const featureType = data.feature_type ?? null;
    const sameMember = (f) => f.id === featureId
        && (featureType === null || f.type === featureType);

    const before = group.features.length;
    if (opType === OperationType.DELETE) {
        group.features = group.features.filter((f) => !sameMember(f));
    } else if (!group.features.some(sameMember)) {
        group.features = [...group.features, { type: featureType, id: featureId }];
    }
    if (group.features.length === before) return false;

    groups[groupId] = group;
    await repo.saveGroups?.(mapId, groups);
    present(() => { memoryStore.groups[mapName] = groups; });

    emit(EventTypes.GROUP_MODIFIED, { groupId, mapId, group });
    emit(EventTypes.GROUPS_CHANGED, {});
    return true;
}

/**
 * Applies a remote briefing operation.
 *
 * @param {string} opType - Operation type
 * @param {string} briefingId - Briefing UUID
 * @param {Object} data - Briefing data
 */
async function applyRemoteBriefingOp(opType, briefingId, data) {
    return withDocumentLock(`briefing:${briefingId}`, 'applyRemoteBriefingOp', async () => {
        switch (opType) {
            case OperationType.CREATE:
            case OperationType.UPDATE: {
                if (data) {
                    await handlerLocalRepository().saveBriefing(briefingId, data);
                }
                const eventType = opType === OperationType.CREATE
                    ? EventTypes.BRIEFING_CREATED
                    : EventTypes.BRIEFING_UPDATED;
                emit(eventType, { briefingId, briefing: data });
                break;
            }
            case OperationType.DELETE:
                await handlerLocalRepository().deleteBriefing(briefingId);
                emit(EventTypes.BRIEFING_DELETED, { briefingId });
                break;
        }
    });
}

/** Materialize a pending local slide without generating another operation or undo entry. */
async function applyLocalSlideIntent(opType, slideId, briefingId, data) {
    if (!briefingId) return false;
    return withDocumentLock(`briefing:${briefingId}`, 'recoverLocalSlide', async () => {
        const repo = handlerLocalRepository();
        const briefing = await repo.getBriefing(briefingId);
        if (!briefing) return false;
        const slides = [...(briefing.slides || [])];
        const previousIndex = slides.findIndex(slide => slide.id === slideId);
        if (opType !== OperationType.DELETE && (!data || typeof data !== 'object')) return false;
        if (previousIndex !== -1) slides.splice(previousIndex, 1);
        if (opType !== OperationType.DELETE) {
            const position = Number.isInteger(data.order) ? Math.max(0, Math.min(data.order, slides.length))
                : previousIndex === -1 ? slides.length : previousIndex;
            slides.splice(position, 0, { ...data, id: slideId });
        }
        const updated = { ...briefing, slides };
        await repo.saveBriefing(briefingId, updated);
        emit(EventTypes.BRIEFING_UPDATED, { briefingId, briefing: updated });
        return true;
    });
}

/**
 * Applies a remote spatial-comment op. Comments are map-scoped, persisted in the per-map comment
 * side-store (the repo resolves the map id↔name key internally, so the op's `mapId` is passed
 * directly). Root and reply share the same store keyed by comment id.
 * @param {string} opType
 * @param {string} commentId
 * @param {string} mapId - The op's map context.
 * @param {Object} data - The comment object (root or reply).
 */
async function applyRemoteCommentOp(opType, commentId, mapId, data) {
    // The peer's comment and the local user's comment are two writers of the SAME document,
    // and this is the ordinary case for spatial comments, not a burst: without the lock the
    // later save drops the earlier one. Same key as the local side (`comments:<mapId>`), or
    // the two would not exclude each other at all.
    return withSideDocument('comments', mapId, 'applyRemoteCommentOp', async () => {
        const collection = await handlerLocalRepository().getMapComments(mapId);
        switch (opType) {
            case OperationType.CREATE:
            case OperationType.UPDATE: {
                if (data) collection[commentId] = data;
                await handlerLocalRepository().saveMapComments(mapId, collection);
                emit(opType === OperationType.CREATE ? EventTypes.COMMENT_CREATED : EventTypes.COMMENT_UPDATED, { comment: data });
                break;
            }
            case OperationType.DELETE:
                delete collection[commentId];
                await handlerLocalRepository().saveMapComments(mapId, collection);
                emit(EventTypes.COMMENT_DELETED, { commentId });
                break;
        }
    });
}

// 3D / 360 entities live in the per-map cesium3d / streetview360 stores, keyed by map NAME
// and backed by their own memory caches. To converge a LIVE op on a peer (P9), we persist to
// the repo (the durable truth) and INVALIDATE the canonical cache (best-effort, via the store
// module's own clear fn) — the emitted "changed" event then makes the UI re-read fresh from the
// repo. This avoids hand-syncing the cache internals (which the cache-clear functions own).

/** @private Best-effort invalidation of the cesium3d memory cache after a repo write. */
async function invalidateCesium3dCache() {
    try {
        const { clearCesium3dCache } = await import('../cesium3d.operations.js');
        clearCesium3dCache();
    } catch {
        // Cache invalidation is best-effort; the repo write is the durable part.
    }
}

/** @private Best-effort invalidation of the streetview360 memory cache after a repo write. */
async function invalidateStreetview360Cache() {
    try {
        const { clearStreetview360Cache } = await import('../streetview360.operations.js');
        clearStreetview360Cache();
    } catch {
        // best-effort
    }
}

/**
 * Applies a remote cesium3d ARRAY-entity op (markers / measurements / viewsheds). Persists into
 * the per-map cesium3d store's array bucket (replace-by-id / remove-by-id), then emits.
 *
 * @param {string} bucket - 'markers' | 'measurements' | 'viewsheds'.
 * @param {string} changeEvent - The coarse "changed" event to emit.
 * @param {string} opType - Operation type.
 * @param {string} entityId - The entity id (matches the stored item's `id`).
 * @param {string} mapId - Map UUID.
 * @param {Object|null} data - The entity (CREATE/UPDATE) or null (DELETE).
 * @returns {Promise<void>}
 */
async function applyRemoteCesium3dEntityOp(bucket, changeEvent, opType, entityId, mapId, data) {
    const repo = handlerRepository();
    const mapName = mapResolver.resolveToName(mapId) || mapId;
    const c3d = await repo.getCesium3d?.(mapName);
    if (c3d) {
        if (!Array.isArray(c3d[bucket])) c3d[bucket] = [];
        const idx = c3d[bucket].findIndex((e) => e && e.id === entityId);
        if (opType === OperationType.DELETE) {
            if (idx !== -1) c3d[bucket].splice(idx, 1);
        } else if (data) {
            if (idx !== -1) c3d[bucket][idx] = data; else c3d[bucket].push(data);
        }
        await repo.saveCesium3d?.(mapName, c3d);
        await present(invalidateCesium3dCache);
    }
    emit(changeEvent, { mapName: mapId });
}

/**
 * Applies a remote 3D camera position op. cameraPositions is an object keyed by `tilesetId`
 * (one saved camera per tileset). DELETE carries no data, so the tileset key is found by the
 * stored position's `id` matching the op `entityId`.
 *
 * @param {string} opType - Operation type.
 * @param {string} entityId - The camera position id.
 * @param {string} mapId - Map UUID.
 * @param {Object|null} [data] - Camera position ({ id, tilesetId, ... }) or null (DELETE).
 * @returns {Promise<void>}
 */
async function applyRemoteCameraOp(opType, entityId, mapId, data) {
    const repo = handlerRepository();
    const mapName = mapResolver.resolveToName(mapId) || mapId;
    const c3d = await repo.getCesium3d?.(mapName);
    if (c3d) {
        if (!c3d.cameraPositions) c3d.cameraPositions = {};
        if (opType === OperationType.DELETE) {
            const key = Object.keys(c3d.cameraPositions).find((k) => c3d.cameraPositions[k]?.id === entityId);
            if (key) delete c3d.cameraPositions[key];
        } else if (data?.tilesetId) {
            c3d.cameraPositions[data.tilesetId] = data;
        }
        await repo.saveCesium3d?.(mapName, c3d);
        await present(invalidateCesium3dCache);
    }
    if (opType !== OperationType.DELETE) {
        emit(EventTypes.CAMERA_3D_SAVED, { tilesetId: data?.tilesetId, mapName: mapId });
    }
    emit(EventTypes.MARKERS_3D_CHANGED, { mapName: mapId });
}

/**
 * Applies a remote 360 orientation op. orientations is an object keyed by `photoName`. DELETE
 * finds the key by the stored orientation's `id` matching the op `entityId`.
 *
 * @param {string} opType - Operation type.
 * @param {string} entityId - The orientation id.
 * @param {string} mapId - Map UUID.
 * @param {Object|null} [data] - Orientation ({ id, photoName, ... }) or null (DELETE).
 * @returns {Promise<void>}
 */
async function applyRemoteOrientation360Op(opType, entityId, mapId, data) {
    const repo = handlerRepository();
    const mapName = mapResolver.resolveToName(mapId) || mapId;
    const sv = await repo.getStreetview360?.(mapName);
    if (sv) {
        if (!sv.orientations) sv.orientations = {};
        if (opType === OperationType.DELETE) {
            const key = Object.keys(sv.orientations).find((k) => sv.orientations[k]?.id === entityId);
            if (key) delete sv.orientations[key];
        } else if (data?.photoName) {
            sv.orientations[data.photoName] = data;
        }
        await repo.saveStreetview360?.(mapName, sv);
        await present(invalidateStreetview360Cache);
    }
    const eventType = opType === OperationType.DELETE
        ? EventTypes.ORIENTATION_360_CLEARED
        : EventTypes.ORIENTATION_360_SAVED;
    emit(eventType, { photoName: data?.photoName, mapName: mapId });
}

/**
 * Applies a remote 360 marker op (streetview360 markers array; replace-by-id / remove-by-id).
 *
 * @param {string} opType - Operation type.
 * @param {string} entityId - The 360 marker id.
 * @param {string} mapId - Map UUID.
 * @param {Object|null} data - The marker (CREATE/UPDATE) or null (DELETE).
 * @returns {Promise<void>}
 */
async function applyRemoteMarker360Op(opType, entityId, mapId, data) {
    const repo = handlerRepository();
    const mapName = mapResolver.resolveToName(mapId) || mapId;
    const sv = await repo.getStreetview360?.(mapName);
    if (sv) {
        if (!Array.isArray(sv.markers)) sv.markers = [];
        const idx = sv.markers.findIndex((m) => m && m.id === entityId);
        if (opType === OperationType.DELETE) {
            if (idx !== -1) sv.markers.splice(idx, 1);
        } else if (data) {
            if (idx !== -1) sv.markers[idx] = data; else sv.markers.push(data);
        }
        await repo.saveStreetview360?.(mapName, sv);
        await present(invalidateStreetview360Cache);
    }
    emit(EventTypes.MARKERS_360_CHANGED, { mapName: mapId });
}

/**
 * Applies a remote map-level setting operation (position, base layer, notes,
 * grid style). These live on the map record itself, so a coarse MAP_MODIFIED
 * tells the app to re-read the map. A type-specific event is emitted when one
 * exists for the setting.
 *
 * @param {string} entityType - Entity type (from EntityType)
 * @param {string} mapId - Map UUID
 * @param {Object} [data] - Setting data
 */
async function applyRemoteMapSettingOp(entityType, mapId, data) {
    const repo = handlerRepository();
    switch (entityType) {
        case EntityType.BASE_LAYER: {
            // Persist the base layer onto the map record so a peer receiving a LIVE op
            // converges with the snapshot path (P9), not just emit. data = { baseLayer }.
            const layer = data?.baseLayer;
            if (layer) {
                await withMapDocument(mapId, 'applyRemoteMapSettingOp:baseLayer', async () => {
                    const mapData = await repo.getMap?.(mapId);
                    if (mapData) {
                        mapData.baseLayer = layer;
                        await repo.saveMap?.(mapId, mapData);
                    }
                });
                // The payload MUST be the layer id STRING (mirrors base-layer.control's emit). Emitting
                // the wrapper object `data` made the base-layer-selector render "[object Object]".
                emit(EventTypes.BASE_LAYER_CHANGED, { layer });
            }
            break;
        }
        case EntityType.MAP_NOTES:
            // Persist notes to the side-store (matches reshapeSnapshotMap + setMapNotes; P9).
            // data = { title, description }. The consumer (sidebar) keys by map NAME, so resolve
            // the UUID→name first (mirrors the MAP_TEMPORAL branch) instead of passing the raw UUID.
            if (data) await repo.saveMapNotes?.(mapId, data);
            emit(EventTypes.MAP_NOTES_REQUESTED, { mapName: mapResolver.resolveToName(mapId) || mapId });
            break;
        case EntityType.GRID_STYLE:
            // Persist grid style to the side-store (matches reshapeSnapshotMap + setGridStyle).
            if (data) await repo.saveGridStyle?.(mapId, data);
            break;
        case EntityType.MAP_POSITION: {
            // Persist the saved position onto the map record (savedPosition + legacy flat
            // fields) so the peer keeps the new center/zoom (P9).
            //
            // A CLEAR NOW ARRIVES AS AN UPDATE WHOSE FIVE FIELDS ARE NULL, not as a DELETE:
            // `clearMapPosition` stopped emitting the delete envelope, which on the server was
            // an act on the MAP and soft-deleted it (achado F1). Both shapes are accepted here
            // — the null payload is still what an older peer sends — and `isClearedPositionPayload`
            // is the single place that knows the difference, shared with the producer. Without
            // this branch the update would store an object of five nulls AS the saved position:
            // the flat fields would read cleared while `savedPosition` claimed one existed.
            await withMapDocument(mapId, 'applyRemoteMapSettingOp:position', async () => {
                const mapData = await repo.getMap?.(mapId);
                if (!mapData) return;
                if (isClearedPositionPayload(data)) {
                    delete mapData.savedPosition;
                    mapData.center_lat = null;
                    mapData.center_long = null;
                    mapData.zoom = null;
                    mapData.bearing = null;
                    mapData.pitch = null;
                } else {
                    mapData.savedPosition = data;
                    mapData.center_lat = data.center_lat ?? null;
                    mapData.center_long = data.center_long ?? null;
                    mapData.zoom = data.zoom ?? null;
                    mapData.bearing = data.bearing ?? null;
                    mapData.pitch = data.pitch ?? null;
                }
                await repo.saveMap?.(mapId, mapData);
            });
            break;
        }
        case EntityType.MAP_TEMPORAL: {
            // Persist the per-map temporal config so the peer actually adopts it — emitting
            // an event alone left B's stored config unchanged (same emit-without-persist
            // class as the layer bug). The config is keyed locally by map NAME
            // (`temporal_<name>`, matching temporal.operations.js), while the op carries the
            // map UUID, so resolve UUID→name first.
            const mapName = mapResolver.resolveToName(mapId) || mapId;
            if (data) {
                // Mesma chave que o lado local (`setMapTemporalConfig`), que faz MERGE de
                // patch sobre o estado anterior. Sem a exclusao, esta escrita inteira cai
                // no meio daquele merge e sai sobrescrita pelo estado velho mais o patch.
                await withSideDocument('temporal', mapName, 'applyRemoteMapSettingOp:temporal', async () => {
                    await repo.saveSetting(`temporal_${mapName}`, data);
                    present(() => memoryStore.temporalConfigs.set(mapName, data));
                });
                emit(EventTypes.TEMPORAL_CONFIG_CHANGED, { mapName, config: data });
                if (typeof data.ativo === 'boolean') {
                    // `remoto: true` MARCA A PROCEDENCIA, e ele existe para um assinante so: a
                    // telemetria de uso conta `temporal.ativado` neste evento, e esta emissao
                    // acontece a cada op de ENTRADA que carregue a config temporal, sem deteccao
                    // de mudanca. Sem a marca, o colega que liga a linha do tempo uma vez conta
                    // uma vez em cada aba do atlas, e a metrica passa a medir o tamanho da equipe.
                    // Nenhum outro assinante o le, e a ausencia do campo (emissor local) e o
                    // estado normal.
                    emit(EventTypes.MAP_TEMPORAL_CHANGED, { mapName, enabled: data.ativo, remoto: true });
                }
            }
            break;
        }
        default:
            break;
    }
    emit(EventTypes.MAP_MODIFIED, { mapId, map: data });
}

/**
 * Applies a remote catalog-layer op. Catalog layers (external/WMS/analysis/hillshade) live
 * inside the map record's `catalogLayers` array, so a LIVE op must mutate that array on the
 * peer (not just emit) — otherwise a collaborator's added external layer only reached peers via
 * a full snapshot (P9). CREATE/UPDATE replace-by-id (idempotent); DELETE removes by id.
 *
 * @param {string} opType - Operation type.
 * @param {string} layerId - Catalog layer id.
 * @param {string} mapId - Map UUID.
 * @param {Object|null} data - The catalog layer (CREATE/UPDATE) or null (DELETE).
 * @returns {Promise<void>}
 */
async function applyRemoteCatalogLayerOp(opType, layerId, mapId, data) {
    const repo = handlerRepository();
    await withMapDocument(mapId, 'applyRemoteCatalogLayerOp', async () => {
        const mapData = await repo.getMap?.(mapId);
        if (!mapData) return;
        if (!Array.isArray(mapData.catalogLayers)) mapData.catalogLayers = [];
        const idx = mapData.catalogLayers.findIndex((l) => l && l.id === layerId);
        if (opType === OperationType.DELETE) {
            if (idx !== -1) mapData.catalogLayers.splice(idx, 1);
        } else if (data) {
            const canonical = { ...data, id: layerId };
            if (idx !== -1) mapData.catalogLayers[idx] = canonical;
            else mapData.catalogLayers.push(canonical);
        }
        await repo.saveMap?.(mapId, mapData);
    });
    emit(EventTypes.LAYERS_CHANGED, { mapName: mapId });
}

/**
 * Applies a remote atlas-level setting op (§24.8 + datamodel-13/14): persists the
 * whitelisted preference(s) to the local stores using the EXACT same keys/setters the
 * local write path uses, and applies live where there is a control (terrain). Peers
 * see the change in real time. Best-effort and defensive.
 *
 * Keys handled (must match the emitters in operation-dispatcher.logAtlasSetting):
 * - terrainExaggeration → atlas.settings.terrainExaggeration + terrain control (§24.8)
 * - mapBadgeColors (datamodel-13) → repo.saveSetting('mapBadgeColors', obj)
 *      (the setSettingCompat key map.operations.js uses)
 * - colorUsage (datamodel-13) → per map: repo.saveSetting('color_usage_<mapName>', counts)
 *      (the setColorUsageCompat key; payload is { [mapName]: counts })
 * - customIcons (datamodel-14) → repo.saveSetting('custom_icons', list)
 *      (the SETTING_KEY customIcons.operations.js uses; blobs sync via images)
 *
 * @param {Object} [data] - Setting payload.
 * @returns {Promise<void>}
 */
async function applyRemoteSettingOp(data) {
    if (!data || typeof data !== 'object') return;

    // As duas chaves de APARÊNCIA passam pelo serviço que as escreve localmente, para que o
    // caminho remoto e o local não possam divergir. O que este bloco fazia à mão tinha três
    // defeitos, todos silenciosos: persistia com `getAtlas()` (que devolve null num slot sem
    // registro, e aí o valor do par sumia no F5), buscava o controle por `getControl('terrain')`
    // enquanto o registro usa `TerrainControl` (então o apply ao vivo NUNCA rodou), e não
    // conhecia `globeProjection`.
    await applyHandlerAppearance(data);

    await applyRemoteAppStateSettings(data);
}

/**
 * Applies the datamodel-13/14 app-state setting keys (mapBadgeColors, colorUsage,
 * customIcons) from a remote `setting` op or a snapshot's atlas.settings, writing
 * each to the same local store key its local setter uses. Best-effort per key.
 *
 * @param {Object} data - Object that may carry mapBadgeColors/colorUsage/customIcons.
 * @returns {Promise<void>}
 */
async function applyRemoteAppStateSettings(data) {
    const repo = handlerRepository();

    if (data.mapBadgeColors && typeof data.mapBadgeColors === 'object') {
        // setSettingCompat('mapBadgeColors', obj) → repo.saveSetting('mapBadgeColors', obj).
        // Consumers (getMapBadgeColors) re-read this key fresh, so a persist is enough.
        await repo.saveSetting?.('mapBadgeColors', data.mapBadgeColors);
    }

    if (data.colorUsage && typeof data.colorUsage === 'object') {
        // Per-map nested object { [mapName]: counts }; write each under color_usage_<mapName>
        // (the setColorUsageCompat key) so getColorUsage(mapName) reads it back.
        for (const [mapName, counts] of Object.entries(data.colorUsage)) {
            await repo.saveSetting?.(`color_usage_${mapName}`, counts);
        }
    }

    if (Array.isArray(data.customIcons)) {
        // setSettingCompat('custom_icons', list) — the customIcons.operations SETTING_KEY.
        // Reset the registry's in-memory cache so the next getCustomIcons() reloads the
        // synced list (mirrors the ALL_DATA_CLEARED reset the registry already does).
        // Dynamic import keeps customIcons.operations (and its wide store graph) OUT of
        // the remote handler's static import graph — loaded only when an icons op arrives.
        await repo.saveSetting?.('custom_icons', data.customIcons);
        await present(async () => {
            const { invalidateCustomIconsCache } = await import('../customIcons.operations.js');
            invalidateCustomIconsCache();
        });
    }

    if (Array.isArray(data.mapOrder)) {
        // setSettingCompat('mapOrder', list) — the key getMapOrder() reads. Emit LAYERS_CHANGED
        // so the maps tab re-renders in the new order (it reloads the list on that event).
        await repo.saveSetting?.('mapOrder', data.mapOrder);
        emit(EventTypes.LAYERS_CHANGED, { mapName: null });
    }
}

// ============================================================================
// SNAPSHOT
// ============================================================================

/**
 * Reshapes a backend-shaped snapshot map into the local store's shape and
 * redistributes the map-level settings the backend keeps as columns into the
 * local side-stores the rest of the app reads from.
 *
 * The backend returns these map fields snake_case (mirroring the `maps` table):
 * `base_layer`, `notes_title`, `notes_description`, `grid_style`,
 * `temporal_config`, `locked`. Locally the loader expects camelCase
 * (`baseLayer`) and reads notes/grid/temporal/lock from dedicated side-stores
 * keyed exactly as the setters below produce. If we saved the row verbatim the
 * camelCase loader would miss `baseLayer` and the side-stores would stay empty
 * (notes/grid/temporal/lock would vanish for the user) — so we strip those
 * columns off the map and push them through the same keys/setters the app uses.
 *
 * Key derivation MUST match the consumers:
 * - notes  → `repo.saveMapNotes(id, …)`   → `map_notes_<id>`  (keyed by map id)
 * - grid   → `repo.saveGridStyle(id, …)`  → `gridStyle_<id>`  (keyed by map id)
 * - temporal → `temporal_<name>`  (temporal.operations.js STORE_PREFIX; read in
 *   store-state-manager.setCurrentMap via `getSettingCompat('temporal_<name>')`)
 * - lock   → `mapLocked_<name>`    (map.operations.js setAppSetting; read in
 *   store-state-manager.setCurrentMap via `getSettingCompat('mapLocked_<name>')`)
 *
 * @param {Object} repo - Active repository
 * @param {Object} map - Backend-shaped snapshot map (mutated: columns removed)
 * @returns {Promise<Object>} The reshaped map ready for `repo.saveMap`
 */
async function reshapeSnapshotMap(repo, map) {
    const {
        base_layer: baseLayer,
        notes_title: notesTitle,
        notes_description: notesDescription,
        grid_style: gridStyle,
        temporal_config: temporalConfig,
        locked,
        ...rest
    } = map;

    // Notes / grid are keyed by map id (UUID); the repo resolves and writes
    // `map_notes_<id>` / `gridStyle_<id>` — the exact keys getMapNotes/getGridStyle read.
    if (notesTitle != null || notesDescription != null) {
        await repo.saveMapNotes?.(map.id, {
            title: notesTitle || '',
            description: notesDescription || ''
        });
    }
    if (gridStyle != null && Object.keys(gridStyle).length > 0) {
        await repo.saveGridStyle?.(map.id, gridStyle);
    }

    // Temporal / lock are keyed by map NAME (matches temporal.operations.js
    // `temporal_<name>` and map.operations.js `mapLocked_<name>`, which is how
    // store-state-manager loads them on map activation).
    const mapName = map.name;
    if (mapName) {
        if (temporalConfig != null && Object.keys(temporalConfig).length > 0) {
            await repo.saveSetting?.(`temporal_${mapName}`, temporalConfig);
        }
        if (locked != null) {
            await repo.saveSetting?.(`mapLocked_${mapName}`, locked);
            // Keep the in-memory lock set (read by isCurrentMapLockedSync — the ACTUAL edit gate)
            // in sync and notify the UI, so a peer ALREADY viewing the map disables editing
            // immediately. Persisting only the setting made the lock take effect on that peer
            // only after switching maps and back.
            present(() => {
                if (locked) memoryStore.lockedMaps.add(mapName);
                else memoryStore.lockedMaps.delete(mapName);
            });
            emit(EventTypes.MAP_LOCK_CHANGED, { mapName, locked: !!locked });
        }
    }

    // Rebuild the map with the camelCase field the loader expects; drop the
    // snake_case columns now living in side-stores.
    const reshaped = { ...rest };
    if (baseLayer !== undefined) {
        reshaped.baseLayer = baseLayer;
    }

    // THE THIRD ENTRY PATH a map can take into this repository, alongside the `.ebgeo`
    // importer and the IndexedDB read, and the one nobody thinks of: a map that has only
    // ever lived on the server arrives here with whatever buckets its peer wrote, and a peer
    // that predates the Coordination Line tool sends none. Without the collection the layer
    // setup builds no source and the tool activates, accepts clicks and draws nothing. Same
    // pure function as the other two, so the three cannot drift apart.
    const shaped = ensureMapDataShape(reshaped) ?? reshaped;
    // The server's own revision of the map row, when this payload came from the server. A live
    // partial update carries none, and then nothing is stamped: `mergeRemoteMapUpdate` is the one
    // that has to FORGET the old number, because it merges into a record that already has one.
    stampConfirmedVersionFromRow(shaped);
    // The catalogue layers ride inside the map document and each carries its own row revision.
    stampConfirmedVersionFromRows(shaped.catalogLayers);
    return shaped;
}

/**
 * Applies a full snapshot to the local store.
 *
 * Each map carries its `features`/`layers`/`groups`/`cesium3d`/`streetview360`
 * (saved verbatim) plus backend-only map columns that must be reshaped into the
 * local camelCase + side-store shape first (see `reshapeSnapshotMap`). Each
 * briefing is saved as-is. Defensive about missing fields.
 *
 * @param {Object} [snapshot] - Snapshot payload ({ maps?, briefings? })
 * @returns {Promise<void>}
 */
export function applyRemoteSnapshot(snapshot, options = {}) {
    const context = capturedApplyContext(options);
    return serializeGuardedApply(() => withApplyContext(context, async () => {
        if (context.scope?.kind !== 'remote') return applyRemoteSnapshotInner(snapshot);
        validateSnapshot(snapshot, true);
        // THE SAME SNAPSHOT TWICE IS STAGED ONCE. Opening a remote atlas answers two full
        // snapshots whenever the atlas has never had an operation written: the HTTP pull asks
        // from the durable cursor (zero, with no active generation), and the socket handshake
        // then asks again from the cursor that snapshot just wrote, also zero, which the
        // protocol cannot tell apart from "I hold nothing". The check is BEFORE
        // `pauseStoreWrites` on purpose: the cost being avoided is not only nine databases and
        // a prune, it is the write pause itself, which is what a concurrent atlas-opening paint
        // collides with.
        //
        // WHY EQUAL CURSORS MEAN NOTHING TO DO: the cursor is only written by a snapshot that
        // finished, so an active generation at exactly this server version already holds this
        // content. Re-staging would additionally DESTROY local edits that were journalled but
        // not yet pushed (they do not move the server version, so they cannot raise it either).
        // The catalog repair the server answers with a snapshot for cannot land here: it only
        // triggers on rows newer than the asked cursor, which puts `currentVersion` above it.
        if (activeGenerationHolds(context.scope, snapshot.currentVersion)) return;
        const pause = pauseStoreWrites(context.scope);
        // Which side of the durable commit a failure lands on: before it, the preparation is disk
        // to be deleted; after it, the same databases are the atlas the user is looking at. Both
        // live OUTSIDE the try because the cleanup is in the catch, and a preparation the catch
        // cannot name is a preparation nothing deletes.
        let activated = false;
        let generation = null;
        let previousRecord = null;
        try {
            await pause.settled;
            context.assertActive();
            const record = readGeneration(context.scope);
            previousRecord = record;
            if (snapshot.currentVersion < record.cursor) throw new Error('O retrato recebido é anterior à recuperação já confirmada.');
            generation = generateUUID();
            // Register ownership before creating any database. Failed preparations are still
            // included in scoped logout cleanup, without ever becoming the active atlas.
            const prepared = { ...record, known: knownGenerations(record, generation) };
            writeGeneration(context.scope, prepared);
            const stageScope = { ...context.scope, dataGeneration: generation };
            context.repo = localRepository.forScope(stageScope);
            context.localRepo = context.repo;
            context.staging = true;
            context.presentation = [];
            const atlas = { ...createAtlas(snapshot.atlas.name), ...snapshot.atlas,
                mapOrder: snapshot.maps.map(map => map.id), lastActiveMapId: null };
            await context.repo.saveAtlas(atlas);
            await applyRemoteSnapshotInner(snapshot);
            context.assertActive();
            // The pointer and cursor are a single durable commit; until this line every reader
            // still resolves the previous complete generation, including after a browser crash.
            const latest = readGeneration(context.scope);
            if (latest.active !== record.active) throw new Error('Outra aba atualizou o atlas durante a recuperação. Tente novamente.');
            writeGeneration(context.scope, { ...latest, active: generation, cursor: snapshot.currentVersion });
            activated = true;
            // This tab now READS the new generation, and says so with a lock, so that the pruning
            // below (and another tab's) can tell "superseded" from "still being read".
            await adoptActiveGeneration(context.scope, generation);
            context.staging = false;
            await context.markMaterialized?.();
            const maps = await context.repo.getAllMaps();
            context.assertActive();
            mapResolver.clear();
            memoryStore.groups = {};
            memoryStore.lockedMaps.clear();
            memoryStore.temporalConfigs.clear();
            for (const [id, map] of maps) mapResolver.registerMap(map.name, id);
            for (const effect of context.presentation) {
                context.assertActive();
                await effect();
            }
            await pruneSupersededGenerations(context.scope, generation, record.active);
        } catch (error) {
            // A PREPARATION THAT NEVER BECAME THE ATLAS IS DISK NOBODY WILL EVER READ, and it used
            // to stay there: quota was the first failure and the abandoned nine databases were the
            // reason the SECOND attempt failed too. Only the not-yet-activated one is cleaned here;
            // past this point the data is durable and the pointer names it.
            if (!activated && generation) await discardPreparedGeneration(context.scope, generation, previousRecord);
            throw error;
        } finally {
            pause.resume();
        }
    }));
}

/**
 * Whether a COMPLETE generation on disk already stands at exactly this server version.
 *
 * A CORRUPT RECORD ANSWERS NO, and that is not a swallowed error: the apply below reads the same
 * record inside its own try and throws there, so the corrupt case keeps the behaviour it had
 * before this shortcut existed instead of gaining a second, earlier failure point.
 *
 * @param {{ kind: string, dbSuffix: string }} scope - Scope the snapshot would be applied to.
 * @param {number} currentVersion - The snapshot's server version.
 * @returns {boolean}
 */
function activeGenerationHolds(scope, currentVersion) {
    try {
        const record = readGeneration(scope);
        return Boolean(record.active) && record.cursor === currentVersion;
    } catch {
        return false;
    }
}

/**
 * The `known` list a preparation must leave behind: everything already recorded, the generation
 * that is still active, and the one being prepared, with no null and no duplicate.
 *
 * Null used to travel in the list (a first snapshot prepares over `active: null`). It was
 * harmless, because `allGenerationStores` adds the generation-less names anyway, and it is now
 * filtered because the list became a statement about what is ON DISK: pruning has to be able to
 * subtract from it.
 *
 * @param {{ active: string|null, known: string[] }} record - Durable record before the preparation.
 * @param {string} generation - Generation being prepared.
 * @returns {string[]}
 */
function knownGenerations(record, generation) {
    return [...new Set([...record.known, record.active, generation])].filter(Boolean);
}

/**
 * Deletes the databases of a preparation that failed, and takes it out of `known`.
 *
 * IT REPORTS NOTHING TO THE CALLER, and the failure it is cleaning up is the one being rethrown:
 * the user is already being told the recovery did not happen. What it must never do is turn a
 * quota error into a cleanup error, because the caller's message names the real cause.
 *
 * A DELETE THAT DID NOT CONFIRM KEEPS THE GENERATION IN `known`. The list is what the scoped
 * logout cleanup is derived from (`allGenerationStores`), so forgetting a database that is still
 * on disk would leave server data no purge can find, which is worse than an entry that names a
 * database already gone.
 *
 * @param {{ kind: string, dbSuffix: string }} scope - Scope being recovered.
 * @param {string} generation - Generation that was prepared and never activated.
 * @param {{ active: string|null, known: string[], cursor: number }} record - Durable record as it
 *   was before the preparation, and what it goes back to when the deletes confirm.
 * @returns {Promise<void>}
 */
async function discardPreparedGeneration(scope, generation, record) {
    try {
        const { blocked } = await dropGenerationDatabases(scope, generation);
        writeGeneration(scope, blocked.length > 0
            ? { ...record, known: knownGenerations(record, generation) }
            : record);
    } catch (cleanupError) {
        // The original failure is the one that matters; this one only costs disk.
        console.warn('Não foi possível apagar a preparação interrompida do atlas:', cleanupError);
    }
}

/**
 * Prunes the generations the new one superseded, keeping ONE reserve (decision D3 of 2026-09-13),
 * and rewrites `known` so it names exactly what survived.
 *
 * BEST EFFORT ON PURPOSE, AND ONLY BECAUSE OF THE ORDER. It runs after the pointer commit, so the
 * data the user asked for is already durable and reachable: a failure here costs disk, never the
 * recovery, and raising would abort an apply that already succeeded. The next activation prunes
 * again, which is what makes the step idempotent rather than a one-shot.
 *
 * IT RE-READS THE RECORD BEFORE WRITING because the prune awaits, and another apply of the same
 * tab could have moved the pointer in the meantime; that apply owns the list, so this one steps
 * aside instead of writing a stale `known` over it.
 *
 * @param {{ kind: string, dbSuffix: string }} scope - Scope that was just recovered.
 * @param {string} active - Generation that just became active.
 * @param {string|null} reserve - The generation it replaced, kept as the reserve.
 * @returns {Promise<void>}
 */
async function pruneSupersededGenerations(scope, active, reserve) {
    try {
        const { spared, blocked } = await pruneAtlasGenerations(scope, { keep: [reserve].filter(Boolean) });
        const latest = readGeneration(scope);
        if (latest.active !== active) return;
        const survivors = [...new Set([active, reserve, ...spared, ...blocked])].filter(Boolean);
        writeGeneration(scope, { ...latest, known: survivors });
    } catch (error) {
        console.warn('Não foi possível podar as gerações antigas do atlas:', error);
    }
}

function validateSnapshot(snapshot, complete = false) {
    if (!snapshot || typeof snapshot !== 'object') throw new Error('Snapshot inválido.');
    if (complete && (!snapshot.atlas || snapshot.atlas.id !== applyContext.scope.atlasId
        || !Array.isArray(snapshot.maps) || !Array.isArray(snapshot.briefings)
        || !Number.isSafeInteger(snapshot.currentVersion) || snapshot.currentVersion < 0)) {
        throw new Error('O retrato do servidor está incompleto. Nenhum dado foi substituído.');
    }
    // Validate the complete collection before the first write. A truncated or malformed
    // response is not evidence that the user's existing maps were deleted remotely.
    for (const collection of ['maps', 'briefings']) {
        if (!(collection in snapshot)) continue;
        const entries = snapshot[collection];
        if (!Array.isArray(entries) || entries.some(entry => !entry || typeof entry.id !== 'string' || !entry.id)) {
            throw new Error(`Snapshot inválido: coleção ${collection}. Nenhum dado foi substituído.`);
        }
        if (new Set(entries.map(entry => entry.id)).size !== entries.length) {
            throw new Error(`Snapshot inválido: IDs duplicados em ${collection}.`);
        }
    }
}

async function applyRemoteSnapshotInner(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return;
    validateSnapshot(snapshot);

    const repo = handlerRepository();
    const queue = operationQueue.forScope?.(getActiveScope()) ?? operationQueue;
    const pending = await (queue.getPendingProjection?.() ?? queue.getAll());

    // datamodel-13/14: distribute the synced app-state settings the backend keeps in
    // atlas.settings (mapBadgeColors, colorUsage, customIcons) into the SAME local
    // store keys their local setters use, so a fresh snapshot rehydrates them. Uses
    // the analogous reshape the map fields get (reshapeSnapshotMap), but for atlas
    // settings keys.
    if (snapshot.atlas && snapshot.atlas.settings && typeof snapshot.atlas.settings === 'object') {
        await applyRemoteAppStateSettings(snapshot.atlas.settings);
        // E A APARÊNCIA, que esta linha dizia estar "loaded elsewhere" e não estava. O
        // "elsewhere" é o boot do mapa, que lê o atlas ANTES de o snapshot chegar: ao abrir um
        // projeto do servidor o wipe esvazia o namespace, a leitura acha um registro em branco, e
        // o valor que o snapshot traz logo depois não era aplicado por ninguém. O sintoma era
        // exatamente "mudo, salvo, dou F5 e perdi" — só no atlas remoto, porque no local nada
        // apaga o registro entre a escrita e a leitura.
        await applyHandlerAppearance(snapshot.atlas.settings);
    }

    const maps = Array.isArray(snapshot.maps) ? snapshot.maps : [];
    const keepMaps = new Set(maps.map(map => map.id));
    for (const [id] of await repo.getAllMaps?.() ?? []) {
        if ('maps' in snapshot && !keepMaps.has(id)) await repo.deleteMap(id);
    }
    for (const map of maps) {
        if (map && map.id) {
            const reshaped = await reshapeSnapshotMap(repo, map);
            // Locked so the snapshot cannot land inside a local writer's read-modify-write
            // window (which would revert the snapshot, or lose the local write).
            await withMapDocument(map.id, 'applyRemoteSnapshot', () => repo.saveMap(map.id, reshaped));
            // Replay any live feature ops that arrived (and buffered) before this map existed.
            // OUTSIDE the lock above: each replayed op takes the same key itself.
            if (!applyContext?.staging) await drainPendingFeatureOps(map.id);
            // Groups live in a SEPARATE local store (not part of map data), so saveMap does
            // not carry them. Restore the snapshot's map.groups (array → object keyed by id)
            // into both the group store (by id) and the in-memory cache (by name) so a peer
            // sees existing groups on open. Without this the snapshot dropped them silently.
            if (Array.isArray(map.groups)) {
                const byId = {};
                for (const g of map.groups) { if (g && g.id) byId[g.id] = stampConfirmedVersionFromRow(g); }
                await repo.saveGroups?.(map.id, byId);
                if (map.name) present(() => { memoryStore.groups[map.name] = byId; });
            }

            // P11 round-trip fidelity: layers / cesium3d / streetview360 are carried INLINE in the
            // snapshot map, but every reader (export loaders, layer manager) reads them from
            // DEDICATED side-stores — which the incremental op-handlers write but the bulk snapshot
            // path did not. Persist them here (mirrors the groups handling above), else a pulled
            // atlas re-exports without its layers/3D/360 (silent data loss).
            if (Array.isArray(map.layers)) {
                await repo.saveLayers?.(map.id, stampConfirmedVersionFromRows(map.layers));
                // Refresh the live layer cache if this is the active map (visibility filter reads it).
                if (map.name && memoryStore.currentMap === map.name) {
                    await present(async () => {
                        const { loadLayersToMemory } = await import('../layer.operations.js');
                        await loadLayersToMemory(map.name);
                    });
                }
            }
            if (map.cesium3d && typeof map.cesium3d === 'object') {
                stampBucketedRevisions(map.cesium3d, CESIUM3D_BUCKETS);
                await repo.saveCesium3d?.(map.id, map.cesium3d);
            }
            if (map.streetview360 && typeof map.streetview360 === 'object') {
                stampBucketedRevisions(map.streetview360, STREETVIEW360_BUCKETS);
                await repo.saveStreetview360?.(map.id, map.streetview360);
            }
            // Spatial comments: the backend snapshot sends them as an ARRAY per map; normalize to
            // the { [id]: comment } shape the side-store + overlay expect. Absent for read-only
            // viewers (the server omits them) — then the side-store simply stays empty.
            if (Array.isArray(map.comments)) {
                const commentsById = {};
                for (const c of map.comments) { if (c && c.id) commentsById[c.id] = stampConfirmedVersionFromRow(c); }
                await repo.saveMapComments?.(map.id, commentsById);
            }

            emit(EventTypes.MAP_MODIFIED, { mapId: map.id, map: reshaped });
        }
    }

    const briefings = Array.isArray(snapshot.briefings) ? snapshot.briefings : [];
    const keepBriefings = new Set(briefings.map(briefing => briefing.id));
    for (const briefing of await handlerLocalRepository().getAllBriefings?.() ?? []) {
        if ('briefings' in snapshot && !keepBriefings.has(briefing.id)) await handlerLocalRepository().deleteBriefing(briefing.id);
    }
    for (const briefing of briefings) {
        if (briefing && briefing.id) {
            stampConfirmedVersionFromRow(briefing);
            stampConfirmedVersionFromRows(briefing.slides);
            await handlerLocalRepository().saveBriefing(briefing.id, briefing);
            emit(EventTypes.BRIEFING_UPDATED, { briefingId: briefing.id, briefing });
        }
    }

    // Pending intentions belong to this session, not to the server snapshot. Rebuild their
    // projection without generating new operations or counting them as remotely applied.
    const projected = [];
    for (const op of pending) {
        if (await applyRemoteOperationInner({ ...op, localRepair: true }, false)) projected.push(op);
    }
    if (applyContext?.staging) applyContext.markMaterialized = () => queue.markMaterialized?.(projected);
    else await queue.markMaterialized?.(projected);
    emit(EventTypes.LAYERS_CHANGED, {});
    emit(EventTypes.GROUPS_CHANGED, {});
    // Signal the comment overlay to reload the active map's comments from the side-store.
    emit(EventTypes.COMMENT_UPDATED, {});
}

// ============================================================================
// CONFIRMED SERVER REVISION
// ============================================================================

/**
 * The 3D and 360 side-stores keep their entities in buckets, some as arrays keyed by `id` and
 * some as objects keyed by a natural key (tileset, photo). Declared once because BOTH the
 * snapshot path and the push-ack write-back have to walk exactly the same places: a bucket in one
 * list and not the other is an entity that gets a base it can never refresh.
 */
const CESIUM3D_BUCKETS = ['markers', 'measurements', 'viewsheds', 'cameraPositions'];
const STREETVIEW360_BUCKETS = ['markers', 'orientations'];

/**
 * Stamps every entity of every named bucket of a side-store document from its own `version`.
 * @param {Object} store - The per-map cesium3d / streetview360 document.
 * @param {string[]} buckets - Bucket names to walk.
 * @returns {Object} The same document.
 */
function stampBucketedRevisions(store, buckets) {
    for (const bucket of buckets) stampConfirmedVersionFromRows(store?.[bucket]);
    return store;
}

/** Client entity types that address the map RECORD itself (the map row's revision). */
const MAP_RECORD_ENTITIES = new Set([
    EntityType.MAP, EntityType.MAP_POSITION, EntityType.BASE_LAYER,
    EntityType.MAP_NOTES, EntityType.GRID_STYLE, EntityType.MAP_TEMPORAL,
]);

/** Client entity types stored in the per-map cesium3d document, and the bucket each lands in. */
const CESIUM3D_ENTITY_BUCKET = {
    [EntityType.MARKER_3D]: 'markers',
    [EntityType.MEASUREMENT_3D]: 'measurements',
    [EntityType.VIEWSHED_3D]: 'viewsheds',
    [EntityType.CAMERA_POSITION_3D]: 'cameraPositions',
};

/** Client entity types stored in the per-map streetview360 document. */
const STREETVIEW360_ENTITY_BUCKET = {
    [EntityType.MARKER_360]: 'markers',
    [EntityType.ORIENTATION_360]: 'orientations',
};

/** @private Stamps one entity of a bucketed side-store, by id, and reports whether it was found. */
function stampInBucket(bucket, entityId, entityVersion) {
    if (Array.isArray(bucket)) {
        const found = bucket.find((item) => item && item.id === entityId);
        if (!found) return false;
        stampConfirmedVersion(found, entityVersion);
        return true;
    }
    if (!bucket || typeof bucket !== 'object') return false;
    const key = Object.keys(bucket).find((k) => bucket[k]?.id === entityId);
    if (!key) return false;
    stampConfirmedVersion(bucket[key], entityVersion);
    return true;
}

/**
 * Writes the revision the server just confirmed for ONE entity onto its local document.
 *
 * WHY THE ACK IS NOT ENOUGH ON ITS OWN, and why this exists. The push receipt carries
 * `entityVersion` for every base-checked entity, but only three paths carry a `canonicalOperation`
 * the inbound handler can apply (feature, map create, layer update). Without this write-back the
 * author's SECOND consecutive edit of the same entity would declare the revision it read from the
 * snapshot, the server would find its own frontier already past it, and the author would lose a
 * race against nobody but themselves. That is not a hypothetical: it is what a base declaration
 * costs the moment the queue holds two edits of one document.
 *
 * IT WRITES ONE FIELD AND NOTHING ELSE. Re-applying the acked operation would have been shorter
 * (`resolveLocalEdit` already does it under one narrow condition) and it is the wrong instrument:
 * the operation's payload is the state at the time it was created, so replaying it over a newer
 * local edit would revert work the user can see. Reading the document, setting one number and
 * writing it back cannot lose anything it did not already hold.
 *
 * BEST-EFFORT BY DESIGN. It runs from the flush's ack loop; a failure here costs one operation of
 * arrival-order behaviour on the next edit, and must never be allowed to stall the queue.
 *
 * @param {Object} operation - The acked local operation (entityType/entityId/mapId).
 * @param {number} entityVersion - The revision the server committed.
 * @returns {Promise<boolean>} Whether a document was written.
 */
export async function confirmEntityVersion(operation, entityVersion) {
    const { entityType, entityId, mapId } = operation ?? {};
    if (!entityType || !entityId || !Number.isSafeInteger(entityVersion)) return false;
    try {
        return await writeConfirmedEntityVersion(entityType, entityId, mapId, entityVersion);
    } catch {
        // See the header: the next edit falls back to arrival order, which is where it started.
        return false;
    }
}

/**
 * @private The per-entity address of the confirmed revision. One switch, and the entity families
 * are the ones `applyRemoteOperation` already routes to, so a new entity type that forgets this
 * function simply never declares a base.
 */
async function writeConfirmedEntityVersion(entityType, entityId, mapId, entityVersion) {
    // A feature is stamped by the canonical operation the receipt already carries (the server
    // writes `confirmedVersion` into its properties, `feature-conflicts.js`), and re-stamping it
    // here would be a second writer of one fact.
    if (entityType === EntityType.FEATURE) return false;

    const repo = handlerRepository();
    const local = handlerLocalRepository();

    if (MAP_RECORD_ENTITIES.has(entityType)) {
        // A sub-typed map op (position, notes, grid, temporal, base layer) addresses the map
        // through `mapId`; a plain `map` op through its own id. Same split the server makes in
        // `revisionKeyOf`, and it has to be the same one or the two would name different rows.
        const id = entityType === EntityType.MAP ? entityId : (mapId ?? entityId);
        return withMapDocument(id, 'confirmEntityVersion:map', async () => {
            const document = await repo.getMap?.(id);
            if (!document) return false;
            stampConfirmedVersion(document, entityVersion);
            await repo.saveMap?.(id, document);
            return true;
        });
    }

    if (entityType === EntityType.LAYER) {
        const layers = (await repo.getLayers?.(mapId)) || [];
        const found = layers.find((layer) => layer && layer.id === entityId);
        if (!found) return false;
        stampConfirmedVersion(found, entityVersion);
        await repo.saveLayers?.(mapId, layers);
        return true;
    }

    if (entityType === EntityType.GROUP) {
        const groups = (await repo.getGroups?.(mapId)) || {};
        if (!groups[entityId]) return false;
        stampConfirmedVersion(groups[entityId], entityVersion);
        await repo.saveGroups?.(mapId, groups);
        return true;
    }

    if (entityType === EntityType.COMMENT) {
        return withSideDocument('comments', mapId, 'confirmEntityVersion:comment', async () => {
            const collection = await local.getMapComments(mapId);
            if (!collection?.[entityId]) return false;
            stampConfirmedVersion(collection[entityId], entityVersion);
            await local.saveMapComments(mapId, collection);
            return true;
        });
    }

    if (entityType === EntityType.BRIEFING || entityType === EntityType.SLIDE) {
        // A slide lives INSIDE its briefing document, and the op carries the briefing id in the
        // envelope's `mapId` slot (see `applyLocalSlideIntent`).
        const briefingId = entityType === EntityType.BRIEFING ? entityId : mapId;
        if (!briefingId) return false;
        return withDocumentLock(`briefing:${briefingId}`, 'confirmEntityVersion:briefing', async () => {
            const briefing = await local.getBriefing(briefingId);
            if (!briefing) return false;
            if (entityType === EntityType.BRIEFING) {
                stampConfirmedVersion(briefing, entityVersion);
            } else {
                const slide = (briefing.slides || []).find((item) => item && item.id === entityId);
                if (!slide) return false;
                stampConfirmedVersion(slide, entityVersion);
            }
            await local.saveBriefing(briefingId, briefing);
            return true;
        });
    }

    if (entityType === EntityType.CATALOG_LAYER) {
        return withMapDocument(mapId, 'confirmEntityVersion:catalogLayer', async () => {
            const document = await repo.getMap?.(mapId);
            const entry = (document?.catalogLayers ?? []).find((layer) => layer && layer.id === entityId);
            if (!entry) return false;
            stampConfirmedVersion(entry, entityVersion);
            await repo.saveMap?.(mapId, document);
            return true;
        });
    }

    // The 3D and 360 side-stores are keyed by map NAME, like every other writer of them.
    const mapName = mapResolver.resolveToName(mapId) || mapId;
    const cesiumBucket = CESIUM3D_ENTITY_BUCKET[entityType];
    if (cesiumBucket) {
        const document = await repo.getCesium3d?.(mapName);
        if (!stampInBucket(document?.[cesiumBucket], entityId, entityVersion)) return false;
        await repo.saveCesium3d?.(mapName, document);
        return true;
    }
    const streetviewBucket = STREETVIEW360_ENTITY_BUCKET[entityType];
    if (streetviewBucket) {
        const document = await repo.getStreetview360?.(mapName);
        if (!stampInBucket(document?.[streetviewBucket], entityId, entityVersion)) return false;
        await repo.saveStreetview360?.(mapName, document);
        return true;
    }
    return false;
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Emits an event if EventBus is available.
 *
 * @param {string} eventType
 * @param {Object} payload
 */
function emit(eventType, payload) {
    present(() => _eventBus?.emit(eventType, payload));
}

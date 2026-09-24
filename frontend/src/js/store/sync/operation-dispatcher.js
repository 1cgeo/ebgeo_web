// Path: js/store/sync/operation-dispatcher.js

/**
 * @fileoverview Operation dispatcher for sync system.
 * Coordinates logging of operations to the queue.
 * Operations are queued but not sent anywhere yet - ready for future backend.
 */

import { createOperation, createBatchOperations } from './operation-factory.js';
import { operationQueue } from './operation-queue.js';
import { getActiveScope, StoreScopeKind } from '../atlas-namespace.js';
import { EntityType, OperationType } from './operation-types.js';
import { StoreErrorEvents, emitStoreError } from '../store-errors.js';
import { generateUUID, isValidUUID } from '../../utilities/uuid.js';
import { record } from './diag/trace-core.js';
import { TraceStage, TraceOutcome, DropReason } from './diag/trace-stages.js';
import { markLocalEditPending, CONVERGENCE_GUARDED } from './remote-operation-handler.js';
import { blobUploadPending } from './blob-upload-queue.js';
import { checkPermission, GuardAction } from './permission-guard.js';
import { isDerivedOutputBucket } from '../analysis-output.js';

/**
 * Whether operation logging is enabled.
 * Disabled by default - enable when ready to start queuing operations.
 * @type {boolean}
 */
let enabled = false;

/**
 * A remote edit that cannot become an outbound intention. Named (and carrying a `code` from
 * {@link DropReason}) so a caller can tell it apart from an IndexedDB failure: `runTransaction`
 * turns it into a rollback plus `STORE_PERSIST_ERROR`, so the entity is NOT written and the
 * refusal reaches the producer instead of the edit dissolving into an `undefined` return.
 */
export class OperationIntentRefusedError extends Error {
    /**
     * @param {string} message - pt-BR sentence; it may surface to the user.
     * @param {string} code - One of DropReason.
     */
    constructor(message, code) {
        super(message);
        this.name = 'OperationIntentRefusedError';
        this.code = code;
    }
}

/**
 * Whether an edit born in this scope owes the server an operation.
 *
 * A LOCAL atlas has no outbound queue, so logging being off there is the ordinary state and
 * nothing is lost. A REMOTE atlas is the opposite: every edit owes the server an op, so a
 * dropped intention is data the peer never sees and the author never learns about.
 * @param {Object|null|undefined} scope
 * @returns {boolean}
 */
function owesOutboundIntent(scope) {
    return (scope ?? getActiveScope())?.kind === StoreScopeKind.REMOTE;
}

/**
 * Why one edit description can never be pushed, or null when it can.
 * Same poison-pill rule as {@link logOperation} (bug D): the backend rejects a non-UUID id with
 * 22P02 and that one op fails the ENTIRE flush batch.
 * @param {Object} op - Edit description collected by `tx.recordOperation`.
 * @returns {string|null} A DropReason, or null.
 */
function nonUuidDropReason(op) {
    if (op.entityType === EntityType.SETTING && op.entityId !== 'atlas' && !isValidUUID(op.entityId)) {
        return DropReason.NON_UUID_SETTING_ID;
    }
    if (op.mapId != null && !isValidUUID(op.mapId)) return DropReason.NON_UUID_MAPID;
    return null;
}

/**
 * Keeps the descriptions that may become outbound intentions, dropping the writes of a DERIVED
 * analysis output (`processed_*`, by the bucket the store op stamped as `storage`).
 *
 * The output is re-derived by every client from the synced input (`store/analysis-output.js`),
 * so its writes are local by definition, and they must not count as "un-pushable" either: a
 * transaction that only rewrites an output is a legitimate local write, not an edit the atlas of
 * the server is owed. The rule is by TYPE, never by id shape: a non-UUID id of any other type
 * still goes out and is refused loudly by the server, which is the signal a caller bug deserves.
 * @param {Array<Object>} descriptions - Edit descriptions from `tx.recordOperation`.
 * @returns {Array<Object>} The descriptions that are not derived output.
 */
function withoutDerivedOutputs(descriptions) {
    const outbound = [];
    for (const op of descriptions) {
        if (op.entityType === EntityType.FEATURE && isDerivedOutputBucket(op.storage)) {
            record(TraceStage.PREFLUSH_DROP, {
                entityType: op.entityType, operationType: op.operationType,
                entityId: op.entityId, mapId: op.mapId,
                outcome: TraceOutcome.DROPPED, reason: DropReason.DERIVED_OUTPUT
            });
            continue;
        }
        outbound.push(op);
    }
    return outbound;
}

/**
 * Write-ahead path used by store transactions. Failure prevents entity persistence.
 *
 * THE TWO REFUSALS BELOW USED TO BE BARE RETURNS, and that is F7. Between mounting a remote
 * namespace and finishing the handshake (`activateRemoteAtlas` → `markStoreRemote` → `connect`,
 * in `account/open-atlas.service.js`) the scope is remote while logging is still off; an edit in
 * that window persisted the entity and returned `undefined`, with no op, no error and no signal
 * outside the trace (which is off in production). Refusing is the only honest answer: the entity
 * is not written, so nothing looks saved that the server will never hear about.
 *
 * @param {Array<Object>} descriptions - Edit descriptions from `tx.recordOperation`.
 * @param {Object} [options]
 * @param {Object} [options.scope] - Scope the transaction was born in.
 * @param {string} [options.traceId] - Gesture-wide trace id.
 * @returns {Promise<(function(): Promise<void>)|undefined>} Materialization step, or undefined.
 * @throws {OperationIntentRefusedError} In a REMOTE scope, when no intention can be recorded.
 */
export async function persistOperationIntents(allDescriptions, { scope, traceId } = {}) {
    const descriptions = withoutDerivedOutputs(allDescriptions);
    if (descriptions.length === 0) return;
    if (!enabled) {
        record(TraceStage.PREFLUSH_DROP, {
            count: descriptions.length,
            outcome: TraceOutcome.DROPPED, reason: DropReason.LOGGING_DISABLED
        });
        if (owesOutboundIntent(scope)) {
            throw new OperationIntentRefusedError(
                'Edição recusada: a conexão com o atlas do servidor ainda não está pronta. Tente de novo em instantes.',
                DropReason.LOGGING_DISABLED
            );
        }
        return;
    }
    const safe = [];
    for (const op of descriptions) {
        const reason = nonUuidDropReason(op);
        if (!reason) {
            safe.push(op);
            continue;
        }
        record(TraceStage.PREFLUSH_DROP, {
            entityType: op.entityType, operationType: op.operationType,
            entityId: op.entityId, mapId: op.mapId,
            outcome: TraceOutcome.DROPPED, reason
        });
    }
    if (safe.length === 0) {
        // Every description was un-pushable. In a remote atlas that is a CALLER bug (a store op
        // aimed a synced entity at a name-keyed local map), so it throws: swallowing it wrote the
        // entity and left the atlas silently divergent.
        if (owesOutboundIntent(scope)) {
            throw new OperationIntentRefusedError(
                'Edição recusada: esta alteração não tem identidade válida para o atlas do servidor.',
                DropReason.NON_UUID_MAPID
            );
        }
        return;
    }
    const created = createBatchOperations(safe).map(op => ({ ...op, traceId }));
    const queue = scope ? operationQueue.forScope(scope) : operationQueue;
    // O ENCADEAMENTO VALE PARA TODA ENTIDADE QUE DECLARA BASE, e não só para a feição.
    //
    // Uma edição escrita antes de o recibo da anterior voltar declara a base que a ANTERIOR
    // observou, porque quem move o `confirmedVersion` do documento local é o recibo
    // (`confirmEntityVersion`). Enquanto isto era só de feição, a segunda edição de uma camada
    // perdia para a PRIMEIRA DO MESMO AUTOR: o servidor aplicava a primeira, levava a fronteira da
    // unidade adiante e recusava a segunda nomeando a unidade que a primeira acabara de mover. Não
    // havia colaborador nenhum na história. Medido em `tests/e2e/edicao-encadeada-por-entidade`,
    // que mostra o desfecho com e sem esta linha, e visto em duas browsers no par renomear/opacidade
    // de `browser-default-layer.spec.js`.
    //
    // O remédio já estava no servidor: `resolveObservedBase` (`entity-conflicts.js`) lê o recibo do
    // antecessor e adota a revisão que ELE commitou, e o cabeçalho dela diz por extenso que a
    // edição dependente "é comportamento de CLIENTE, não de feição, então toda entidade precisa da
    // mesma resolução". Faltava o carimbo.
    //
    // SÓ QUEM JÁ DECLARA BASE é encadeado, e o `??` importa: sem base declarada a op é aplicada por
    // ordem de chegada, e um `baseOperationId` sozinho TROCA esse regime por uma recusa quando o
    // recibo do antecessor não for encontrado. Estreitar aqui mantém a mudança incapaz de recusar o
    // que hoje se aplica.
    const predecessors = new Map();
    for (const op of created) {
        const feature = op.entityType === EntityType.FEATURE;
        if (!feature && (op.baseVersion ?? null) === null) continue;
        const chave = `${op.entityType}:${op.entityId}`;
        const predecessor = predecessors.get(chave)
            ?? await queue.getLatestPendingEntity(op.entityType, op.entityId)
            ?? (feature && op.featureIntent ? await queue.getLatestFeatureOperation(op.entityId) : null);
        if (predecessor && (op.operationType !== OperationType.CREATE || (feature && op.featureIntent))) {
            op.baseOperationId = predecessor.id;
            op.dependsOn = [predecessor.id];
        }
        predecessors.set(chave, op);
    }
    await queue.enqueueAll(created, { prepared: true });
    for (const op of created) {
        if (CONVERGENCE_GUARDED.has(op.entityType)) markLocalEditPending(op.entityId);
        // THE SPAN CARRIES THE SAME FIELDS AS THE TWO LEGACY EMITTERS BELOW, and that is a
        // contract with the readers, not tidiness: every consumer of an `enqueue` span narrows by
        // `operationType` (`waitForEntitySpan` in `tests/e2e-ui/helpers/trace-helpers.js`, the
        // ledger merger), so a span without it simply never matches and the wait times out on an
        // op that WAS enqueued. It cost 5 collab cases; a span missing a field is worse than no
        // span, because the reader reports "never reached this stage".
        record(TraceStage.ENQUEUE, {
            opId: op.id, traceId, entityType: op.entityType, operationType: op.operationType,
            entityId: op.entityId, mapId: op.mapId, batchId: op.batchId,
            lamportTimestamp: op.lamportTimestamp, outcome: TraceOutcome.OK,
        });
    }
    return async () => {
        // AN OPERATION WHOSE BLOB IS NOT ON THE SERVER STAYS PREPARED, and this is the only place
        // that can decide it: the mark is written by `enqueueAll` and would be cleared right here.
        //
        // An image feature carries the id of its own blob as its `entityId`, and there is no
        // incremental operation for bytes, so an operation that leaves ahead of its blob renders as
        // a hole on the peer (the flush leaves every 1.5 s). Keeping the prepared mark is the
        // queue's existing way of saying "this intention is not complete yet": it is durable, the
        // census counts it, and `blob-upload-queue.js` clears it when the server confirms the
        // bytes, or converts it into a durable issue when the server refuses them for good.
        const prontas = created.filter(op => !(
            op.entityType === EntityType.FEATURE && blobUploadPending(op.entityId)
        ));
        await queue.markMaterialized(prontas);
        for (const op of created) {
            record(TraceStage.APPLY_PERSIST, {
                opId: op.id, traceId, entityType: op.entityType, operationType: op.operationType,
                entityId: op.entityId, mapId: op.mapId, batchId: op.batchId, outcome: TraceOutcome.OK
            });
        }
    };
}

// ===== RETRY / CIRCUIT BREAKER STATE =====

/** Consecutive sync failures (reset on success) */
let consecutiveFailures = 0;

/** Stop retrying after this many consecutive failures */
const MAX_CONSECUTIVE_FAILURES = 5;

/** Delay before retry attempt (ms) */
const RETRY_DELAY_MS = 2000;

/**
 * Enables operation logging.
 */
export function enableOperationLogging() {
    enabled = true;
}

/**
 * Disables operation logging.
 */
export function disableOperationLogging() {
    enabled = false;
}

/**
 * Checks if operation logging is enabled.
 * @returns {boolean} True if enabled
 */
export function isOperationLoggingEnabled() {
    return enabled;
}

/**
 * Tells the producer that a REMOTE edit was not queued because logging is off.
 *
 * The legacy producers (`logOperation`/`logBatchOperations`) run in `deferAsync`, AFTER the
 * entity is durable, so there is nothing to roll back and throwing would only be swallowed by
 * `runTransaction`'s effect wrapper. The refusal is therefore an event, which is the house
 * pattern for an expected failure: the global `STORE_OPERATION_BLOCKED` listener names it to
 * the user, and `session/migalhas-do-barramento.js` keeps `reason` in the crumb trail because
 * it is a symbol, never user content. A LOCAL atlas stays silent: it owes no op.
 *
 * @param {string} operation - Human-readable label (e.g. "create feature").
 * @param {string|null} entityId - Entity id for the payload, or null for a batch.
 * @returns {void}
 */
function noteLoggingDisabled(operation, entityId) {
    if (!owesOutboundIntent(null)) return;
    emitStoreError(StoreErrorEvents.STORE_OPERATION_BLOCKED, {
        operation, entityId, reason: DropReason.LOGGING_DISABLED
    });
}

// ===== RETRY HELPER =====

/**
 * Handles a queue failure: increments circuit breaker, emits error event,
 * and schedules a non-blocking retry if under the failure threshold.
 *
 * @param {string} label - Human-readable description for error event (e.g. "create feature")
 * @param {string|null} entityId - Entity ID for error payload
 * @param {Error} error - The original error
 * @param {() => Promise<void>} retryFn - Function to call on retry
 */
function handleQueueFailure(label, entityId, error, retryFn) {
    consecutiveFailures++;
    console.warn('Failed to log operation:', error);

    emitStoreError(StoreErrorEvents.STORE_SYNC_ERROR, {
        operation: label,
        entityId,
        error: error.message || String(error),
        consecutiveFailures
    });

    if (retryFn && error.name !== 'AbortError' && consecutiveFailures <= MAX_CONSECUTIVE_FAILURES) {
        setTimeout(async () => {
            try {
                await retryFn();
                consecutiveFailures = 0;
            } catch (retryError) {
                console.error('Sync retry also failed:', retryError);
            }
        }, RETRY_DELAY_MS);
    }
}

// ===== CORE LOGGING =====

/**
 * Logs a single operation to the queue.
 *
 * @param {string} entityType - Type of entity (from EntityType)
 * @param {string} operationType - Operation type (from OperationType)
 * @param {string} entityId - ID of the affected entity
 * @param {string|null} mapId - Map context (null for atlas-level operations)
 * @param {Object|null} data - New/updated data
 * @param {Object|null} previousData - Previous data for undo support
 * @returns {Promise<void>}
 */
export async function logOperation(entityType, operationType, entityId, mapId, data = null, previousData = null) {
    if (!enabled) {
        // Offline/anonymous: logging is off, so the op is intentionally not queued.
        // The dominant "I edited but nothing synced" confusion — now a named cause.
        record(TraceStage.PREFLUSH_DROP, {
            entityType, operationType, entityId, mapId,
            outcome: TraceOutcome.DROPPED, reason: DropReason.LOGGING_DISABLED
        });
        noteLoggingDisabled(`${operationType} ${entityType}`, entityId);
        return;
    }

    // A SETTING op must scope to the atlas: a UUID id (per logAtlasSetting) or the
    // 'atlas' sentinel. A non-UUID local key (e.g. 'lastActiveMap' — per-client view
    // state) can never be pushed: the backend rejects it (22P02), and that one op
    // fails the ENTIRE flush batch, blocking all sync. Defense-in-depth for bug D.
    if (entityType === EntityType.SETTING && entityId !== 'atlas' && !isValidUUID(entityId)) {
        record(TraceStage.PREFLUSH_DROP, {
            entityType, operationType, entityId, mapId,
            outcome: TraceOutcome.DROPPED, reason: DropReason.NON_UUID_SETTING_ID
        });
        return;
    }

    // A map-scoped op (feature/layer/group/catalogLayer/3D/360) whose CONTEXT mapId is not a
    // UUID targets a non-synced local map (e.g. the local default 'Principal', keyed by name).
    // The backend rejects a non-UUID mapId (Postgres 22P02) and that one op fails the ENTIRE
    // flush batch, blocking all sync (bug D). Such an op can never bind server-side, so drop
    // it. Atlas-level ops (map/briefing/setting) pass mapId=null and are unaffected.
    if (mapId != null && !isValidUUID(mapId)) {
        record(TraceStage.PREFLUSH_DROP, {
            entityType, operationType, entityId, mapId,
            outcome: TraceOutcome.DROPPED, reason: DropReason.NON_UUID_MAPID
        });
        return;
    }

    const scope = getActiveScope();
    let operation;
    let queue;
    try {
        queue = scope ? operationQueue.forScope(scope) : operationQueue;
        operation = structuredClone(createOperation(entityType, operationType, entityId, mapId, data, previousData));
        await queue.enqueue(operation);
        // Mark a local un-acked edit (feature/layer/group/3D/360) so a concurrent remote op for
        // the SAME entity is deferred until this op's ack reveals the server order (deterministic
        // LWW convergence).
        if (getActiveScope() === scope && CONVERGENCE_GUARDED.has(entityType)) markLocalEditPending(entityId);
        // Author-side IndexedDB-write confirmation: the entity was persisted FIRST
        // (persistFn in runTransaction) before this logging runs in deferAsync, so by
        // now it is durable in IndexedDB. Records the op-keyed peer of the inbound
        // apply.persist span, closing the full-chain "wrote to local IDB" link.
        record(TraceStage.APPLY_PERSIST, {
            opId: operation.id, traceId: operation.traceId, entityType, operationType, entityId, mapId,
            outcome: TraceOutcome.OK
        });
        record(TraceStage.ENQUEUE, {
            opId: operation.id, traceId: operation.traceId, entityType, operationType, entityId, mapId,
            lamportTimestamp: operation.lamportTimestamp, outcome: TraceOutcome.OK
        });
        consecutiveFailures = 0;
    } catch (error) {
        handleQueueFailure(
            `${operationType} ${entityType}`,
            entityId,
            error,
            operation && queue ? () => queue.enqueue(operation) : null
        );
    }
}

/**
 * Logs multiple operations as a batch.
 *
 * @param {Array<{entityType: string, operationType: string, entityId: string, mapId?: string, data?: Object, previousData?: Object}>} operations - Operations to log
 * @returns {Promise<void>}
 */
export async function logBatchOperations(operations) {
    if (!enabled) {
        record(TraceStage.PREFLUSH_DROP, {
            count: (operations || []).length,
            outcome: TraceOutcome.DROPPED, reason: DropReason.LOGGING_DISABLED
        });
        noteLoggingDisabled(`batch (${(operations || []).length} ops)`, null);
        return;
    }

    // Same poison-pill defense as logOperation (bug D): drop ops that can never be pushed — a
    // map-scoped op whose context mapId is not a UUID, or a SETTING op without a UUID/'atlas'
    // id. One such op would fail the entire flush batch and stall all sync.
    const safe = (operations || []).filter((op) => {
        if (!op) return false;
        if (op.entityType === EntityType.SETTING) {
            return op.entityId === 'atlas' || isValidUUID(op.entityId);
        }
        return op.mapId == null || isValidUUID(op.mapId);
    });
    const filtered = (operations || []).length - safe.length;
    if (filtered > 0) {
        record(TraceStage.PREFLUSH_DROP, {
            count: filtered, outcome: TraceOutcome.DROPPED, reason: DropReason.BATCH_FILTERED
        });
    }
    if (safe.length === 0) return;

    const scope = getActiveScope();
    let created;
    let queue;
    try {
        queue = scope ? operationQueue.forScope(scope) : operationQueue;
        created = structuredClone(createBatchOperations(safe));
        await queue.enqueueAll(created);
        for (const op of created) {
            // Author-side IndexedDB-write confirmation (see logOperation) — per op in the batch.
            record(TraceStage.APPLY_PERSIST, {
                opId: op.id, traceId: op.traceId, entityType: op.entityType, operationType: op.operationType,
                entityId: op.entityId, mapId: op.mapId, batchId: op.batchId, outcome: TraceOutcome.OK
            });
            record(TraceStage.ENQUEUE, {
                opId: op.id, traceId: op.traceId, entityType: op.entityType, operationType: op.operationType,
                entityId: op.entityId, mapId: op.mapId, batchId: op.batchId, outcome: TraceOutcome.OK
            });
        }
        consecutiveFailures = 0;
    } catch (error) {
        handleQueueFailure(
            `batch (${safe.length} ops)`,
            null,
            error,
            created && queue ? () => queue.enqueueAll(created) : null
        );
    }
}

// ===== CONVENIENCE METHODS =====
// Type-safe helpers that delegate to logOperation with the correct EntityType.

/**
 * Creates a convenience logger for a given entity type.
 * @param {string} entityType - EntityType constant
 * @param {boolean} [atlasLevel=false] - If true, mapId is always null (atlas-level entity)
 * @returns {function} Async logger function
 */
function createEntityLogger(entityType, atlasLevel = false) {
    if (atlasLevel) {
        return async function (opType, entityId, data = null, previousData = null) {
            await logOperation(entityType, opType, entityId, null, data, previousData);
        };
    }
    return async function (opType, entityId, mapId, data = null, previousData = null) {
        await logOperation(entityType, opType, entityId, mapId, data, previousData);
    };
}

/**
 * Creates a convenience logger for map-scoped settings where entityId === mapId.
 * @param {string} entityType - EntityType constant
 * @returns {function} Async logger function
 */
function createMapSettingLogger(entityType) {
    return async function (opType, mapId, data = null, previousData = null) {
        // entityId === mapId here. A non-UUID id means the map is NOT a synced atlas
        // map (e.g. the local "Principal" default whose id is its name), so the op can
        // never be pushed — skip it. Otherwise the backend rejects the non-UUID map id
        // and that single op fails the ENTIRE flush batch, blocking all sync (bug D).
        if (!isValidUUID(mapId)) {
            record(TraceStage.PREFLUSH_DROP, {
                entityType, operationType: opType, entityId: mapId, mapId,
                outcome: TraceOutcome.DROPPED, reason: DropReason.NON_UUID_MAPID
            });
            return;
        }
        await logOperation(entityType, opType, mapId, mapId, data, previousData);
    };
}

/** Logs a feature operation. */
export const logFeatureOperation = createEntityLogger(EntityType.FEATURE);

/** Logs a layer operation. */
export const logLayerOperation = createEntityLogger(EntityType.LAYER);

/** Logs a group operation. */
export const logGroupOperation = createEntityLogger(EntityType.GROUP);

/**
 * Logs a group MEMBERSHIP operation: one feature entering or leaving one group.
 *
 * Why this is not a `group` update. The server stores a group's members in the
 * `group_features` join table, and `UPDATE_FIELDS.group` (backend `sync.service.js`) lists
 * name/visible/locked/style/parent_id only. A `group` op carrying `data.features` is therefore
 * applied with the members list SILENTLY DROPPED: peers converge live (the inbound handler
 * replaces the group document wholesale) while the server keeps the old membership, so the next
 * snapshot or F5 restores it. `group_feature` create/delete is the only channel the server has.
 *
 * The entity id is a FRESH UUID per op, and both halves of that matter:
 *  - `operations.entity_id` is a UUID column, so a composite `<group>:<feature>` key is out;
 *  - queue compaction groups by `scopeSuffix:entityType:entityId` and keeps ONE op per group
 *    (`operation-queue.js`), so reusing the GROUP id would collapse several membership changes
 *    of the same group into one and drop the rest. A unique id per op keeps every one of them.
 *
 * @param {string} opType - OperationType.CREATE (link) or OperationType.DELETE (unlink)
 * @param {string} groupId - Group UUID
 * @param {string} featureId - Feature UUID
 * @param {string} featureType - Feature source type, for the peer's `{type, id}` ref
 * @param {string|null} mapId - Map context UUID
 * @returns {Promise<void>}
 */
export async function logGroupFeatureOperation(opType, groupId, featureId, featureType, mapId) {
    await logOperation(
        EntityType.GROUP_FEATURE, opType, generateUUID(), mapId,
        { group_id: groupId, feature_id: featureId, feature_type: featureType }, null,
    );
}

/** Logs a map operation (atlas-level, mapId is always null). */
export const logMapOperation = createEntityLogger(EntityType.MAP, true);

/** Logs a 3D marker operation. */
export const logMarker3dOperation = createEntityLogger(EntityType.MARKER_3D);

/** Logs a 3D measurement operation. */
export const logMeasurement3dOperation = createEntityLogger(EntityType.MEASUREMENT_3D);

/** Logs a 3D viewshed operation. */
export const logViewshed3dOperation = createEntityLogger(EntityType.VIEWSHED_3D);

/** Logs a 360 orientation operation. */
export const logOrientation360Operation = createEntityLogger(EntityType.ORIENTATION_360);

/** Logs a 360 marker operation. */
export const logMarker360Operation = createEntityLogger(EntityType.MARKER_360);

/** Logs a briefing operation (atlas-level, mapId is always null). */
export const logBriefingOperation = createEntityLogger(EntityType.BRIEFING, true);

/** Logs a spatial comment operation (map-scoped — carries the comment's map UUID). */
export const logCommentOperation = createEntityLogger(EntityType.COMMENT);

/** Logs a 3D camera position operation. */
export const logCameraPosition3dOperation = createEntityLogger(EntityType.CAMERA_POSITION_3D);

/** Logs a catalog layer operation. */
export const logCatalogLayerOperation = createEntityLogger(EntityType.CATALOG_LAYER);

/** Logs a map position operation (entityId === mapId). */
export const logMapPositionOperation = createMapSettingLogger(EntityType.MAP_POSITION);

/** Logs a base layer change operation (entityId === mapId). */
export const logBaseLayerOperation = createMapSettingLogger(EntityType.BASE_LAYER);

/** Logs a map notes operation (entityId === mapId). */
export const logMapNotesOperation = createMapSettingLogger(EntityType.MAP_NOTES);

/** Logs a grid style operation (entityId === mapId). */
export const logGridStyleOperation = createMapSettingLogger(EntityType.GRID_STYLE);

/** Logs a per-map temporal config operation (entityId === mapId). */
export const logMapTemporalOperation = createMapSettingLogger(EntityType.MAP_TEMPORAL);

/** Logs an atlas-level setting operation (§24.8, e.g. terrainExaggeration; mapId always null). */
export const logSettingOperation = createEntityLogger(EntityType.SETTING, true);

/**
 * Convenience wrapper for syncing a WHITELISTED atlas-level app-preference patch
 * (datamodel-13/14: mapBadgeColors, customIcons, and §24.8 terrainExaggeration; `colorUsage` left
 * this door on 2026-09-21, because it is derived from the features and each client recomputes it). Resolves the atlas id best-effort so the op carries the
 * real entityId, then emits a `setting` UPDATE op. Offline-safe: when operation
 * logging is disabled (not connected) `logSettingOperation` is a no-op, so callers
 * may invoke this unconditionally from any write site. Never throws — a failure to
 * resolve/queue must not break the local write that triggered it.
 *
 * @param {Object} patch - The whitelisted setting patch (e.g. { mapBadgeColors }).
 * @returns {Promise<void>}
 */
export async function logAtlasSetting(patch) {
    if (!enabled) return;
    // O GUARDA ANTES DA FILA, e aqui ele vale por TODOS os chamadores desta porta.
    //
    // MEDIDO EM 2026-09-16, com um usuario de compartilhamento `read` aberto num atlas: o boot
    // recontava as cores do mapa e gravava `colorUsage`, que caia aqui e ia para a fila. O servidor
    // respondia 403 ("Seu acesso a este atlas e somente leitura."), a op nao desenfileirava, e o
    // cracha ficava preso em "Enviando 2..." para sempre, com a fila retida na cabeca: nada mais
    // sairia daquele cliente. Quem so le nao deve produzir escrita nenhuma.
    //
    // `checkPermission` e permissivo offline e em store local, entao o atlas local e o visitante
    // anonimo seguem escrevendo as preferencias deles como antes.
    if (!checkPermission(GuardAction.UPDATE_MAP).allowed) return;
    const scope = getActiveScope();
    try {
        if (scope?.kind === 'remote') {
            await logSettingOperation(OperationType.UPDATE, scope.atlasId, patch);
            return;
        }
        let atlasId = 'atlas';
        try {
            const { getRepository } = await import('../repositories/index.js');
            const atlas = await getRepository().getAtlas?.();
            if (atlas?.id) atlasId = atlas.id;
        } catch {
            // Repository/atlas not available — fall back to the 'atlas' sentinel.
            // The backend `setting` handler scopes by the ROUTE atlas and ignores
            // entityId, so the sentinel still applies the patch correctly.
        }
        if (getActiveScope() !== scope) throw new DOMException('O atlas desta preferência foi desmontado.', 'AbortError');
        await logSettingOperation(OperationType.UPDATE, atlasId, patch);
    } catch (error) {
        console.warn('Failed to log atlas setting op:', error);
    }
}

// Re-export types and queue for external access
export { EntityType, OperationType };
export { operationQueue };

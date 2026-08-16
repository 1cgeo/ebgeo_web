// Path: js/store/sync/remote-operation-handler.js

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
import { getRepository, setSettingCompat } from '../repositories/index.js';
import { localRepository } from '../repositories/local.repository.js';
import { getStorageTypeFromSource } from '../store.constants.js';
import { applyRemoteAppearance } from '../atlas-appearance.service.js';
import { getControl } from '../control.registry.js';
import { mapResolver } from '../services/map-resolver.service.js';
import { memoryStore } from '../memory-store.js';
import { withMapDocument, withSideDocument } from '../document-lock.js';
import { EntityType, OperationType } from './operation-types.js';
import { record } from './diag/trace-core.js';
import { TraceStage, TraceOutcome } from './diag/trace-stages.js';

// ============================================================================
// MODULE STATE
// ============================================================================

/** @type {import('../../events/event_bus.js').EventBus|null} */
let _eventBus = null;

/**
 * Feature ops whose map has not been applied locally yet, keyed by mapId. A feature/create
 * for a freshly-created map can arrive before that map's create op is persisted (A creates a
 * map and immediately draws on it). Buffering — instead of dropping — and replaying once the
 * map lands prevents silent data loss on the peer.
 * @type {Map<string, Array<{opType: string, featureId: string, data: Object}>>}
 */
const pendingFeatureOps = new Map();

/** Cap per map so a never-arriving map cannot grow the buffer unbounded. */
const MAX_PENDING_PER_MAP = 1000;

/** Buffers a feature op whose map is absent (replayed by drainPendingFeatureOps). */
function bufferPendingFeatureOp(mapId, op) {
    let arr = pendingFeatureOps.get(mapId);
    if (!arr) {
        arr = [];
        pendingFeatureOps.set(mapId, arr);
    }
    if (arr.length >= MAX_PENDING_PER_MAP) arr.shift();
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
    pendingFeatureOps.delete(mapId);
    for (const op of arr) {
        // These ops bypass applyRemoteOperation, so apply the version guard here: skip one older
        // than what's already applied, and record the applied version on success so a later
        // concurrent op can't overwrite it (LWW by server arrival order).
        if (!shouldApplyVersion(op.featureId, op.serverVersion)) continue;
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
            if (op.opType === OperationType.DELETE) lastAppliedVersion.delete(op.featureId);
            else markAppliedVersion(op.featureId, op.serverVersion);
        }
    }
}

/**
 * Last server arrival-order (serverVersion) applied per entity, keyed by entity id. Concurrent
 * edits to the SAME entity converge to the op with the highest serverVersion (LWW by arrival
 * order — the documented model): an inbound op OLDER than what was already applied is ignored.
 * The author seeds its OWN entries from the push ack (recordLocalAppliedVersion), because it
 * filters its own WS echo and would otherwise never learn its op's server order.
 * @type {Map<string, number>}
 */
const lastAppliedVersion = new Map();

/**
 * Count of the local user's UN-ACKED edits per feature id. While > 0, a remote op for that
 * feature is DEFERRED (not applied), because the author's optimistic local edit has no
 * serverVersion yet — applying a remote op in that window could overwrite a (possibly-newer)
 * local edit and leave the clients divergent. The push ack (resolveLocalEdit) reveals the
 * server order and replays the deferred ops through the version guard.
 * @type {Map<string, number>}
 */
const pendingLocalEditCount = new Map();

/** Remote ops deferred while the local user had an un-acked edit, keyed by entity id. */
const deferredRemoteOps = new Map();

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
    pendingLocalEditCount.set(featureId, (pendingLocalEditCount.get(featureId) || 0) + 1);
}

/** Buffers a remote op while the local user has an un-acked edit on the same entity. */
function deferRemoteOp(entityId, operation) {
    let arr = deferredRemoteOps.get(entityId);
    if (!arr) {
        arr = [];
        deferredRemoteOps.set(entityId, arr);
    }
    if (arr.length >= MAX_DEFERRED_PER_ENTITY) arr.shift();
    arr.push(operation);
}

/**
 * Resolves a local edit on its push ack: seeds the author's applied serverVersion, decrements
 * the pending count, and — once no local edit remains in flight — replays any deferred remote
 * ops. The replayed ops go through the version guard, so the feature converges to the highest
 * serverVersion regardless of delivery timing (this is what eliminates the ack-vs-peer race).
 * Never throws (best-effort; called fire-and-forget from the flush path).
 * @param {string} entityId
 * @param {number} serverVersion
 * @returns {Promise<void>}
 */
export async function resolveLocalEdit(entityId, serverVersion) {
    markAppliedVersion(entityId, serverVersion);
    if (!entityId) return;
    const remaining = (pendingLocalEditCount.get(entityId) || 0) - 1;
    if (remaining > 0) {
        pendingLocalEditCount.set(entityId, remaining);
        return;
    }
    pendingLocalEditCount.delete(entityId);
    const deferred = deferredRemoteOps.get(entityId);
    if (!deferred || deferred.length === 0) return;
    deferredRemoteOps.delete(entityId);
    for (const op of deferred) {
        try {
            await applyRemoteOperation(op);
        } catch (err) {
            console.warn('Deferred remote op replay failed:', err);
        }
    }
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
    const stale = [];
    for (const entityId of pendingLocalEditCount.keys()) {
        if (!remainingEntityIds.has(entityId)) stale.push(entityId);
    }
    for (const entityId of stale) {
        pendingLocalEditCount.delete(entityId);
        const deferred = deferredRemoteOps.get(entityId);
        if (!deferred || deferred.length === 0) continue;
        deferredRemoteOps.delete(entityId);
        for (const op of deferred) {
            try {
                await applyRemoteOperation(op);
            } catch (err) {
                console.warn('Deferred remote op replay failed:', err);
            }
        }
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
export async function applyRemoteOperation(operation) {
    const { entityType, operationType, entityId, mapId, data, serverVersion } = operation;

    // Convergence guard (LWW by server arrival order) for the entity types that blind-replace:
    //  1. defer the op while the local user has an un-acked edit on the same entity (so a peer's
    //     op can't overwrite a newer local edit before the ack reveals the order), and
    //  2. drop an op older than what was already applied.
    // The applied version is recorded AFTER the handler runs (below). Together these make
    // concurrent edits to the same entity converge deterministically.
    const guarded = CONVERGENCE_GUARDED.has(entityType) && !!entityId;
    if (guarded) {
        if ((pendingLocalEditCount.get(entityId) || 0) > 0) {
            deferRemoteOp(entityId, operation);
            return;
        }
        if (!shouldApplyVersion(entityId, serverVersion)) return;
    }

    let featureApplied = true;
    // Whether the entity handler actually wrote to IndexedDB (false for the redundant SLIDE
    // inbound no-op and unknown entity types) — gates the peer-side apply.persist span below.
    let entityPersisted = true;
    switch (entityType) {
        case EntityType.FEATURE:
            // false = the op was BUFFERED (map not present yet), not applied — don't record its
            // version below, or a legitimate later op could be wrongly dropped by shouldApplyVersion.
            featureApplied = await applyRemoteFeatureOp(operationType, entityId, mapId, data, serverVersion, operation.id, operation.traceId);
            break;
        case EntityType.LAYER:
            await applyRemoteLayerOp(operationType, entityId, mapId, data);
            break;
        case EntityType.MAP:
            // A map op is atlas-level: its identity is `entityId` (the map id), and
            // `mapId` (the op context) is null. Pass entityId so remote MAP_CREATED/
            // MODIFIED/DELETED carry the real id (§1.8/§1.9).
            await applyRemoteMapOp(operationType, entityId, data);
            break;
        case EntityType.GROUP:
            await applyRemoteGroupOp(operationType, entityId, mapId, data);
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
            // Slides converge via their parent BRIEFING op (updateBriefing logs the full slides
            // array, applied by applyRemoteBriefingOp); the standalone slide op is redundant
            // inbound. No-op here so it doesn't trip the "unknown entity type" warning.
            entityPersisted = false;
            break;
        default:
            entityPersisted = false;
            console.warn(`Remote operation handler: unknown entity type "${entityType}"`);
    }

    // Record this entity's applied server order (DELETE clears it so a re-create starts fresh).
    // Skip when a feature op was only buffered (featureApplied === false) — it isn't applied yet.
    if (guarded && featureApplied) {
        if (operationType === OperationType.DELETE) lastAppliedVersion.delete(entityId);
        else markAppliedVersion(entityId, serverVersion);
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
function applyRemoteFeatureOp(opType, featureId, mapId, data, serverVersion, opId, traceId) {
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
    const repo = getRepository();
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
 * @param {string} opType - Operation type
 * @param {string} layerId - Layer UUID
 * @param {string} mapId - Map UUID
 * @param {Object} data - Layer data
 */
async function applyRemoteLayerOp(opType, layerId, mapId, data) {
    const repo = getRepository();
    // Persist the layer to the local store like the map/feature handlers do. Emitting
    // an event alone left the peer WITHOUT the layer — the desktop has no subscriber
    // that persists LAYER_* events — so a collaborator's new/edited/deleted layer never
    // reached the other client.
    try {
        const layers = (await repo.getLayers?.(mapId)) || [];
        let next = layers;
        if (opType === OperationType.CREATE) {
            next = findFeatureIndexById(layers, layerId) !== -1
                ? layers.map((l) => (l.id === layerId ? data : l)) // idempotent re-apply
                : [...layers, data];
        } else if (opType === OperationType.UPDATE) {
            next = layers.map((l) => (l.id === layerId ? { ...l, ...data } : l));
        } else if (opType === OperationType.DELETE) {
            next = layers.filter((l) => l.id !== layerId);
        }
        await repo.saveLayers?.(mapId, next);
        // Refresh the in-memory layer cache so getVisibleLayerIds() and the features panel
        // see the new/changed layer immediately. The visibility filter reads memoryStore
        // (not the repo), so without this a peer's features on a brand-new layer are filtered
        // OUT until a manual map switch (§item3a). Only the current map has a live cache.
        const layerMapName = mapResolver.resolveToName(mapId) || mapId;
        if (memoryStore.currentMap === layerMapName) {
            const { loadLayersToMemory } = await import('../layer.operations.js');
            await loadLayersToMemory(layerMapName);
        }
    } catch (err) {
        console.warn('Remote layer op persist failed:', err);
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
            break;
    }

    emit(EventTypes.LAYERS_CHANGED, { mapName: mapId });
}

/** Index of a layer by its `id` (layers have a top-level id, not properties.id). */
function findFeatureIndexById(arr, id) {
    return arr.findIndex((x) => x && x.id === id);
}

/**
 * Applies a remote map operation.
 *
 * @param {string} opType - Operation type
 * @param {string} mapId - Map UUID
 * @param {Object} data - Map data
 */
async function applyRemoteMapOp(opType, mapId, data) {
    const repo = getRepository();
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
            if (reshaped?.name) mapResolver.registerMap(reshaped.name, mapId);
            // Replay any feature ops that arrived before this map existed (anti silent-drop).
            // OUTSIDE the lock above: each replayed op takes the same key itself, so draining
            // inside it makes the section wait for itself (measured: the guard test hangs).
            await drainPendingFeatureOps(mapId);
            emit(EventTypes.MAP_CREATED, { mapId, map: reshaped });
            break;
        }
        case OperationType.UPDATE: {
            const reshaped = data ? await reshapeSnapshotMap(repo, data) : data;
            if (reshaped) await withMapDocument(mapId, 'applyRemoteMapOp:update', () => repo.saveMap?.(mapId, reshaped));
            emit(EventTypes.MAP_MODIFIED, { mapId, map: reshaped });
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

/**
 * Applies a remote group operation.
 *
 * @param {string} opType - Operation type
 * @param {string} groupId - Group UUID
 * @param {string} mapId - Map UUID
 * @param {Object} data - Group data
 */
async function applyRemoteGroupOp(opType, groupId, mapId, data) {
    const repo = getRepository();
    // Persist the group to BOTH the local group store (a separate store from map data,
    // keyed by map id) AND the in-memory cache (memoryStore.groups, keyed by map NAME —
    // what getMapGroups reads), mirroring how group_manager writes them. Emitting an event
    // alone left the peer WITHOUT the group: no subscriber persists GROUP_* events, and the
    // map-data save never touches the group store. The backend already stores groups and
    // returns them in the snapshot — this is the live-op half of that same contract.
    try {
        const mapName = mapResolver.resolveToName(mapId) || mapId;
        const groups = (await repo.getGroups?.(mapId)) || {};
        if (!memoryStore.groups[mapName]) memoryStore.groups[mapName] = {};
        if (opType === OperationType.DELETE) {
            delete groups[groupId];
            delete memoryStore.groups[mapName][groupId];
        } else if (data) {
            groups[groupId] = data;
            memoryStore.groups[mapName][groupId] = data;
        }
        await repo.saveGroups?.(mapId, groups);
    } catch (err) {
        console.warn('Remote group op persist failed:', err);
    }

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
 * Applies a remote briefing operation.
 *
 * @param {string} opType - Operation type
 * @param {string} briefingId - Briefing UUID
 * @param {Object} data - Briefing data
 */
async function applyRemoteBriefingOp(opType, briefingId, data) {
    switch (opType) {
        case OperationType.CREATE:
        case OperationType.UPDATE: {
            if (data) {
                await localRepository.saveBriefing(briefingId, data);
            }
            const eventType = opType === OperationType.CREATE
                ? EventTypes.BRIEFING_CREATED
                : EventTypes.BRIEFING_UPDATED;
            emit(eventType, { briefingId, briefing: data });
            break;
        }
        case OperationType.DELETE:
            await localRepository.deleteBriefing(briefingId);
            emit(EventTypes.BRIEFING_DELETED, { briefingId });
            break;
    }
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
        const collection = await localRepository.getMapComments(mapId);
        switch (opType) {
            case OperationType.CREATE:
            case OperationType.UPDATE: {
                if (data) collection[commentId] = data;
                await localRepository.saveMapComments(mapId, collection);
                emit(opType === OperationType.CREATE ? EventTypes.COMMENT_CREATED : EventTypes.COMMENT_UPDATED, { comment: data });
                break;
            }
            case OperationType.DELETE:
                delete collection[commentId];
                await localRepository.saveMapComments(mapId, collection);
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
    const repo = getRepository();
    const mapName = mapResolver.resolveToName(mapId) || mapId;
    try {
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
            await invalidateCesium3dCache();
        }
    } catch (err) {
        console.warn('Remote cesium3d op persist failed:', err);
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
    const repo = getRepository();
    const mapName = mapResolver.resolveToName(mapId) || mapId;
    try {
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
            await invalidateCesium3dCache();
        }
    } catch (err) {
        console.warn('Remote camera op persist failed:', err);
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
    const repo = getRepository();
    const mapName = mapResolver.resolveToName(mapId) || mapId;
    try {
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
            await invalidateStreetview360Cache();
        }
    } catch (err) {
        console.warn('Remote orientation360 op persist failed:', err);
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
    const repo = getRepository();
    const mapName = mapResolver.resolveToName(mapId) || mapId;
    try {
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
            await invalidateStreetview360Cache();
        }
    } catch (err) {
        console.warn('Remote marker360 op persist failed:', err);
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
    const repo = getRepository();
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
            // fields) so the peer keeps the new center/zoom (P9). data = savedPosition, or
            // null on a clear (DELETE).
            await withMapDocument(mapId, 'applyRemoteMapSettingOp:position', async () => {
                const mapData = await repo.getMap?.(mapId);
                if (!mapData) return;
                if (data) {
                    mapData.savedPosition = data;
                    mapData.center_lat = data.center_lat ?? null;
                    mapData.center_long = data.center_long ?? null;
                    mapData.zoom = data.zoom ?? null;
                    mapData.bearing = data.bearing ?? null;
                    mapData.pitch = data.pitch ?? null;
                } else {
                    delete mapData.savedPosition;
                    mapData.center_lat = null;
                    mapData.center_long = null;
                    mapData.zoom = null;
                    mapData.bearing = null;
                    mapData.pitch = null;
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
                    await setSettingCompat(`temporal_${mapName}`, data);
                    memoryStore.temporalConfigs.set(mapName, data);
                });
                emit(EventTypes.TEMPORAL_CONFIG_CHANGED, { mapName, config: data });
                if (typeof data.ativo === 'boolean') {
                    emit(EventTypes.MAP_TEMPORAL_CHANGED, { mapName, enabled: data.ativo });
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
    const repo = getRepository();
    await withMapDocument(mapId, 'applyRemoteCatalogLayerOp', async () => {
        const mapData = await repo.getMap?.(mapId);
        if (!mapData) return;
        if (!Array.isArray(mapData.catalogLayers)) mapData.catalogLayers = [];
        const idx = mapData.catalogLayers.findIndex((l) => l && l.id === layerId);
        if (opType === OperationType.DELETE) {
            if (idx !== -1) mapData.catalogLayers.splice(idx, 1);
        } else if (data) {
            if (idx !== -1) mapData.catalogLayers[idx] = data;
            else mapData.catalogLayers.push(data);
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
    await applyRemoteAppearance(data, getControl('TerrainControl'), globalThis.__ebgeoMap);

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
    const repo = getRepository();

    if (data.mapBadgeColors && typeof data.mapBadgeColors === 'object') {
        // setSettingCompat('mapBadgeColors', obj) → repo.saveSetting('mapBadgeColors', obj).
        // Consumers (getMapBadgeColors) re-read this key fresh, so a persist is enough.
        try {
            await repo.saveSetting?.('mapBadgeColors', data.mapBadgeColors);
        } catch {
            // best-effort
        }
    }

    if (data.colorUsage && typeof data.colorUsage === 'object') {
        // Per-map nested object { [mapName]: counts }; write each under color_usage_<mapName>
        // (the setColorUsageCompat key) so getColorUsage(mapName) reads it back.
        for (const [mapName, counts] of Object.entries(data.colorUsage)) {
            try {
                await repo.saveSetting?.(`color_usage_${mapName}`, counts);
            } catch {
                // best-effort per map
            }
        }
    }

    if (Array.isArray(data.customIcons)) {
        // setSettingCompat('custom_icons', list) — the customIcons.operations SETTING_KEY.
        // Reset the registry's in-memory cache so the next getCustomIcons() reloads the
        // synced list (mirrors the ALL_DATA_CLEARED reset the registry already does).
        // Dynamic import keeps customIcons.operations (and its wide store graph) OUT of
        // the remote handler's static import graph — loaded only when an icons op arrives.
        try {
            await repo.saveSetting?.('custom_icons', data.customIcons);
            const { invalidateCustomIconsCache } = await import('../customIcons.operations.js');
            invalidateCustomIconsCache();
        } catch {
            // best-effort
        }
    }

    if (Array.isArray(data.mapOrder)) {
        // setSettingCompat('mapOrder', list) — the key getMapOrder() reads. Emit LAYERS_CHANGED
        // so the maps tab re-renders in the new order (it reloads the list on that event).
        try {
            await repo.saveSetting?.('mapOrder', data.mapOrder);
            emit(EventTypes.LAYERS_CHANGED, { mapName: null });
        } catch {
            // best-effort
        }
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
            if (locked) memoryStore.lockedMaps.add(mapName);
            else memoryStore.lockedMaps.delete(mapName);
            emit(EventTypes.MAP_LOCK_CHANGED, { mapName, locked: !!locked });
        }
    }

    // Rebuild the map with the camelCase field the loader expects; drop the
    // snake_case columns now living in side-stores.
    const reshaped = { ...rest };
    if (baseLayer !== undefined) {
        reshaped.baseLayer = baseLayer;
    }
    return reshaped;
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
export async function applyRemoteSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') {
        return;
    }

    const repo = getRepository();

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
        await applyRemoteAppearance(
            snapshot.atlas.settings, getControl('TerrainControl'), globalThis.__ebgeoMap,
        );
    }

    const maps = Array.isArray(snapshot.maps) ? snapshot.maps : [];
    for (const map of maps) {
        if (map && map.id) {
            const reshaped = await reshapeSnapshotMap(repo, map);
            // Locked so the snapshot cannot land inside a local writer's read-modify-write
            // window (which would revert the snapshot, or lose the local write).
            await withMapDocument(map.id, 'applyRemoteSnapshot', () => repo.saveMap(map.id, reshaped));
            // Replay any live feature ops that arrived (and buffered) before this map existed.
            // OUTSIDE the lock above: each replayed op takes the same key itself.
            await drainPendingFeatureOps(map.id);
            // Groups live in a SEPARATE local store (not part of map data), so saveMap does
            // not carry them. Restore the snapshot's map.groups (array → object keyed by id)
            // into both the group store (by id) and the in-memory cache (by name) so a peer
            // sees existing groups on open. Without this the snapshot dropped them silently.
            if (Array.isArray(map.groups)) {
                const byId = {};
                for (const g of map.groups) { if (g && g.id) byId[g.id] = g; }
                await repo.saveGroups?.(map.id, byId);
                if (map.name) memoryStore.groups[map.name] = byId;
            }

            // P11 round-trip fidelity: layers / cesium3d / streetview360 are carried INLINE in the
            // snapshot map, but every reader (export loaders, layer manager) reads them from
            // DEDICATED side-stores — which the incremental op-handlers write but the bulk snapshot
            // path did not. Persist them here (mirrors the groups handling above), else a pulled
            // atlas re-exports without its layers/3D/360 (silent data loss).
            if (Array.isArray(map.layers)) {
                await repo.saveLayers?.(map.id, map.layers);
                // Refresh the live layer cache if this is the active map (visibility filter reads it).
                if (map.name && memoryStore.currentMap === map.name) {
                    const { loadLayersToMemory } = await import('../layer.operations.js');
                    await loadLayersToMemory(map.name);
                }
            }
            if (map.cesium3d && typeof map.cesium3d === 'object') {
                await repo.saveCesium3d?.(map.id, map.cesium3d);
            }
            if (map.streetview360 && typeof map.streetview360 === 'object') {
                await repo.saveStreetview360?.(map.id, map.streetview360);
            }
            // Spatial comments: the backend snapshot sends them as an ARRAY per map; normalize to
            // the { [id]: comment } shape the side-store + overlay expect. Absent for read-only
            // viewers (the server omits them) — then the side-store simply stays empty.
            if (Array.isArray(map.comments)) {
                const commentsById = {};
                for (const c of map.comments) { if (c && c.id) commentsById[c.id] = c; }
                await repo.saveMapComments?.(map.id, commentsById);
            }

            emit(EventTypes.MAP_MODIFIED, { mapId: map.id, map: reshaped });
        }
    }

    const briefings = Array.isArray(snapshot.briefings) ? snapshot.briefings : [];
    for (const briefing of briefings) {
        if (briefing && briefing.id) {
            await localRepository.saveBriefing(briefing.id, briefing);
            emit(EventTypes.BRIEFING_UPDATED, { briefingId: briefing.id, briefing });
        }
    }

    emit(EventTypes.LAYERS_CHANGED, {});
    emit(EventTypes.GROUPS_CHANGED, {});
    // Signal the comment overlay to reload the active map's comments from the side-store.
    emit(EventTypes.COMMENT_UPDATED, {});
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
    if (_eventBus) {
        _eventBus.emit(eventType, payload);
    }
}

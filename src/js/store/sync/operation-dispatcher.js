// Path: js/store/sync/operation-dispatcher.js

/**
 * @fileoverview Operation dispatcher for sync system.
 * Coordinates logging of operations to the queue.
 * Operations are queued but not sent anywhere yet - ready for future backend.
 */

import { createOperation, createBatchOperations } from './operation-factory.js';
import { operationQueue } from './operation-queue.js';
import { EntityType, OperationType } from './operation-types.js';
import { StoreErrorEvents, emitStoreError } from '../store-errors.js';
import { isValidUUID } from '../../utilities/uuid.js';

/**
 * Whether operation logging is enabled.
 * Disabled by default - enable when ready to start queuing operations.
 * @type {boolean}
 */
let enabled = false;

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

    if (consecutiveFailures <= MAX_CONSECUTIVE_FAILURES) {
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
    if (!enabled) return;

    // A SETTING op must scope to the atlas: a UUID id (per logAtlasSetting) or the
    // 'atlas' sentinel. A non-UUID local key (e.g. 'lastActiveMap' — per-client view
    // state) can never be pushed: the backend rejects it (22P02), and that one op
    // fails the ENTIRE flush batch, blocking all sync. Defense-in-depth for bug D.
    if (entityType === EntityType.SETTING && entityId !== 'atlas' && !isValidUUID(entityId)) {
        return;
    }

    // A map-scoped op (feature/layer/group/catalogLayer/3D/360) whose CONTEXT mapId is not a
    // UUID targets a non-synced local map (e.g. the local default 'Principal', keyed by name).
    // The backend rejects a non-UUID mapId (Postgres 22P02) and that one op fails the ENTIRE
    // flush batch, blocking all sync (bug D). Such an op can never bind server-side, so drop
    // it. Atlas-level ops (map/briefing/setting) pass mapId=null and are unaffected.
    if (mapId != null && !isValidUUID(mapId)) {
        return;
    }

    try {
        const operation = createOperation(entityType, operationType, entityId, mapId, data, previousData);
        await operationQueue.enqueue(operation);
        consecutiveFailures = 0;
    } catch (error) {
        handleQueueFailure(
            `${operationType} ${entityType}`,
            entityId,
            error,
            async () => {
                const retryOp = createOperation(entityType, operationType, entityId, mapId, data, previousData);
                await operationQueue.enqueue(retryOp);
            }
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
    if (!enabled) return;

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
    if (safe.length === 0) return;

    try {
        const created = createBatchOperations(safe);
        await operationQueue.enqueueAll(created);
        consecutiveFailures = 0;
    } catch (error) {
        handleQueueFailure(
            `batch (${safe.length} ops)`,
            null,
            error,
            async () => {
                const retryCreated = createBatchOperations(safe);
                await operationQueue.enqueueAll(retryCreated);
            }
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
        if (!isValidUUID(mapId)) return;
        await logOperation(entityType, opType, mapId, mapId, data, previousData);
    };
}

/** Logs a feature operation. */
export const logFeatureOperation = createEntityLogger(EntityType.FEATURE);

/** Logs a layer operation. */
export const logLayerOperation = createEntityLogger(EntityType.LAYER);

/** Logs a group operation. */
export const logGroupOperation = createEntityLogger(EntityType.GROUP);

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
 * (datamodel-13/14: mapBadgeColors, colorUsage, customIcons — and §24.8
 * terrainExaggeration). Resolves the atlas id best-effort so the op carries the
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
    try {
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
        await logSettingOperation(OperationType.UPDATE, atlasId, patch);
    } catch (error) {
        console.warn('Failed to log atlas setting op:', error);
    }
}

// Re-export types and queue for external access
export { EntityType, OperationType };
export { operationQueue };

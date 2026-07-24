// Path: js/store/sync/index.js

/**
 * @fileoverview Barrel file for sync module.
 * Exports sync metadata utilities and operation logging infrastructure.
 *
 * SYNC READINESS STATUS:
 * ======================
 * All entity types are sync-ready with the following metadata:
 *
 * - Atlas: Full sync object (createdAt, updatedAt, version, ownerId, dirty, deleted)
 * - Map: Full sync object (createdAt, updatedAt, version, ownerId, dirty, deleted)
 * - Feature: Properties include createdAt, updatedAt, version
 * - Layer: Includes createdAt, updatedAt, version
 * - Group: Full sync object (createdAt, updatedAt, version, ownerId, dirty, deleted)
 *
 * Operation logging is integrated into CRUD operations for:
 * - Features (feature.operations.js)
 * - Layers (layer.manager.js)
 * - Groups (group_manager.js)
 * - Maps (map.operations.js)
 *
 * Operations are queued in IndexedDB (operation_queue store) with:
 * - Unique operation ID
 * - Entity type and operation type
 * - Entity ID and map context
 * - Current data and previous data (for undo/conflict resolution)
 * - Timestamp (wall clock + Lamport logical clock) and client ID
 *
 * CONFLICT RESOLUTION STRATEGY (LWW BY ARRIVAL):
 * The winner is decided by the SERVER, by order of arrival — never by a clock.
 * The server assigns a monotonic serverVersion as it accepts operations, and
 * the highest one wins; idempotency is by `op_id`. This is server-authoritative
 * LWW, NOT a CRDT.
 *
 * The Lamport timestamp each operation carries only advances the local logical
 * clock (causal ordering of what this client has seen). It is NOT consulted to
 * resolve conflicts, and neither is the wall clock — so clock skew between
 * clients cannot change an outcome. Nothing in production calls
 * setServerTimeOffset(); it is a vestige of the pre-backend design.
 *
 * This block previously described per-field LWW "by lamportTimestamp + version"
 * and skew compensation. None of that is the model; see the wiki page
 * `sintese-nao-e-crdt`.
 */

// Sync metadata utilities
export {
    createSyncMetadata,
    touchSyncMetadata,
    markSynced,
    markDeleted,
    markRestored,
    isActive,
    isDirty,
    isValidSyncMetadata,
    addSyncMetadataToEntity,
    setServerTimeOffset,
    getAdjustedTimestamp
} from './sync-metadata.js';

// Operation types
export {
    EntityType,
    OperationType,
    isValidEntityType,
    isValidOperationType
} from './operation-types.js';

// Operation factory
export {
    createOperation,
    createBatchOperations,
    getClientId,
    resetClientId,
    getLamportClock,
    advanceLamportClock
} from './operation-factory.js';

// Operation queue
export {
    operationQueue,
    OperationQueue
} from './operation-queue.js';

// Operation dispatcher
export {
    enableOperationLogging,
    disableOperationLogging,
    isOperationLoggingEnabled,
    logOperation,
    logBatchOperations,
    logFeatureOperation,
    logLayerOperation,
    logGroupOperation,
    logMapOperation,
    logMarker3dOperation,
    logMeasurement3dOperation,
    logViewshed3dOperation,
    logCameraPosition3dOperation,
    logOrientation360Operation,
    logMarker360Operation,
    logBriefingOperation,
    logCommentOperation,
    logMapPositionOperation,
    logBaseLayerOperation,
    logMapNotesOperation,
    logCatalogLayerOperation,
    logGridStyleOperation,
    logMapTemporalOperation,
    logSettingOperation,
    logAtlasSetting
} from './operation-dispatcher.js';

// Session context
export {
    sessionContext,
    SessionContext,
    SessionMode,
    UserRole,
    PermissionAction
} from './session-context.js';

// Connection state
export {
    connectionState,
    ConnectionState,
    ConnectionStates
} from './connection-state.js';

// Permission guard
export {
    checkPermission,
    assertPermission,
    GuardAction
} from './permission-guard.js';

// Sync gateway
export {
    syncGateway,
    SyncGateway
} from './sync-gateway.js';

// Remote operation handler
export {
    applyRemoteOperation,
    applyRemoteSnapshot,
    setRemoteHandlerEventBus
} from './remote-operation-handler.js';

// API client
export {
    apiClient,
    ApiClient,
    configureApiClient,
    ApiError
} from './api-client.js';

// WebSocket client
export {
    wsClient,
    WsClient
} from './ws-client.js';

// Sync engine
export {
    syncEngine
} from './sync-engine.js';

// Runtime config (deep-merge backend /api/config into static config)
export {
    applyRuntimeConfig,
    resolveBackendBaseUrl
} from './runtime-config.js';

// Auto-flush driver (periodic + change-driven engine.flush())
export {
    startAutoFlush,
    stopAutoFlush
} from './sync-flush.js';

// Sync scheduler
export {
    initSyncScheduler
} from './sync-scheduler.js';

// Event bridges
export {
    initSessionEventBridge,
    initConnectionEventBridge
} from './event-bridges.js';

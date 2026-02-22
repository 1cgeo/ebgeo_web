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
 * CONFLICT RESOLUTION STRATEGY (LWW):
 * The system uses Last-Writer-Wins with Lamport timestamps for ordering.
 * Each operation carries both a wall clock timestamp and a logical Lamport
 * timestamp. When a backend is available, conflicts are resolved by:
 * - Simple properties (name, color, style): LWW by lamportTimestamp + version
 * - Geometry (coordinates): LWW per feature (full replace, not vertex merge)
 * - Layers and maps: LWW per field (field-level granularity)
 * Server time offset can be set via setServerTimeOffset() to compensate
 * for clock skew between clients.
 *
 * FUTURE BACKEND INTEGRATION:
 * See repository.interface.js for RemoteRepository implementation guide.
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
    logMapPositionOperation,
    logBaseLayerOperation,
    logMapNotesOperation,
    logCatalogLayerOperation,
    logGridStyleOperation
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
    setRemoteHandlerEventBus
} from './remote-operation-handler.js';

// Sync scheduler
export {
    initSyncScheduler
} from './sync-scheduler.js';

// Event bridges
export {
    initSessionEventBridge,
    initConnectionEventBridge
} from './event-bridges.js';

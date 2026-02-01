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
 * - Timestamp and client ID
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
    addSyncMetadataToEntity
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
    resetClientId
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

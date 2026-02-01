// Path: js/store/sync/index.js

/**
 * @fileoverview Barrel file for sync module.
 * Exports sync metadata utilities and operation logging infrastructure.
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
    logOrientation360Operation,
    logMarker360Operation,
    logBriefingOperation
} from './operation-dispatcher.js';

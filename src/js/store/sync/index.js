// Path: js/store/sync/index.js

/**
 * @fileoverview Barrel file for sync metadata module.
 * Exports all sync metadata utilities.
 */

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

// Path: js/store/sync/sync-metadata.js

/**
 * @fileoverview Sync metadata utilities for future synchronization support.
 *
 * Every persistable entity (Atlas, Map, Feature, Layer, Group) will have
 * sync metadata attached. This metadata enables:
 * - Tracking of creation and modification times
 * - Version numbers for conflict resolution (CRDT-like)
 * - Owner identification for future multi-user support
 * - Dirty flag for pending sync detection
 * - Soft delete support
 *
 * IMPORTANT: In local-only mode (current), ownerId will be null and dirty
 * will always be true. These fields are prepared for future backend integration.
 */

/**
 * @typedef {Object} SyncMetadata
 * @property {number} createdAt - Unix timestamp (ms) of creation
 * @property {number} updatedAt - Unix timestamp (ms) of last modification
 * @property {number} version - Monotonically increasing version number
 * @property {string|null} ownerId - UUID of owner user (null for local-only)
 * @property {boolean} dirty - True if entity has unsynced changes
 * @property {boolean} deleted - True if entity is soft-deleted
 */

/**
 * Creates sync metadata for a new entity.
 * @param {string|null} [ownerId=null] - UUID of the owner user (null for local mode)
 * @returns {SyncMetadata} Fresh sync metadata
 */
export function createSyncMetadata(ownerId = null) {
    const now = Date.now();
    return {
        createdAt: now,
        updatedAt: now,
        version: 1,
        ownerId,
        dirty: true,
        deleted: false,
    };
}

/**
 * Updates sync metadata after a modification.
 * Increments version, updates timestamp, marks as dirty.
 * @param {SyncMetadata} sync - Existing sync metadata
 * @returns {SyncMetadata} Updated sync metadata (new object)
 */
export function touchSyncMetadata(sync) {
    if (!sync) {
        return createSyncMetadata(null);
    }
    return {
        ...sync,
        updatedAt: Date.now(),
        version: sync.version + 1,
        dirty: true,
    };
}

/**
 * Marks entity as synchronized (clears dirty flag).
 * Called after successful sync with backend.
 * @param {SyncMetadata} sync - Existing sync metadata
 * @returns {SyncMetadata} Updated sync metadata (new object)
 */
export function markSynced(sync) {
    if (!sync) return sync;
    return {
        ...sync,
        dirty: false,
    };
}

/**
 * Marks entity as soft-deleted.
 * The entity remains in storage but is marked for deletion.
 * This allows sync to propagate the deletion to other clients.
 * @param {SyncMetadata} sync - Existing sync metadata
 * @returns {SyncMetadata} Updated sync metadata (new object)
 */
export function markDeleted(sync) {
    if (!sync) {
        const freshSync = createSyncMetadata(null);
        return { ...freshSync, deleted: true };
    }
    return {
        ...sync,
        updatedAt: Date.now(),
        version: sync.version + 1,
        dirty: true,
        deleted: true,
    };
}

/**
 * Marks entity as restored (undeleted).
 * @param {SyncMetadata} sync - Existing sync metadata
 * @returns {SyncMetadata} Updated sync metadata (new object)
 */
export function markRestored(sync) {
    if (!sync) {
        return createSyncMetadata(null);
    }
    return {
        ...sync,
        updatedAt: Date.now(),
        version: sync.version + 1,
        dirty: true,
        deleted: false,
    };
}

/**
 * Checks if entity is considered active (not deleted).
 * @param {SyncMetadata} sync - Sync metadata to check
 * @returns {boolean} True if entity is active
 */
export function isActive(sync) {
    return sync && !sync.deleted;
}

/**
 * Checks if entity has pending changes to sync.
 * @param {SyncMetadata} sync - Sync metadata to check
 * @returns {boolean} True if entity needs sync
 */
export function isDirty(sync) {
    return sync && sync.dirty === true;
}

/**
 * Validates sync metadata structure.
 * @param {Object} obj - Object to validate
 * @returns {boolean} True if valid sync metadata
 */
export function isValidSyncMetadata(obj) {
    return (
        obj &&
        typeof obj === 'object' &&
        typeof obj.createdAt === 'number' &&
        typeof obj.updatedAt === 'number' &&
        typeof obj.version === 'number' &&
        (obj.ownerId === null || typeof obj.ownerId === 'string') &&
        typeof obj.dirty === 'boolean' &&
        typeof obj.deleted === 'boolean'
    );
}

/**
 * Migrates old entity data to include sync metadata.
 * Used during schema migration from v1.x to v2.0.
 * @param {Object} entity - Entity without sync metadata
 * @param {string|null} [ownerId=null] - Owner ID to assign
 * @returns {Object} Entity with sync metadata added
 */
export function addSyncMetadataToEntity(entity, ownerId = null) {
    if (!entity) return entity;
    if (entity.sync && isValidSyncMetadata(entity.sync)) {
        return entity; // Already has valid sync metadata
    }
    return {
        ...entity,
        sync: createSyncMetadata(ownerId),
    };
}

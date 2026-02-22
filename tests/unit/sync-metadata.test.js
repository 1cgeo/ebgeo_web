import { describe, it, expect, beforeEach } from 'vitest';
import {
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
} from '../../src/js/store/sync/sync-metadata.js';

// Reset server time offset before each test
beforeEach(() => {
    setServerTimeOffset(0);
});

// ============================================================================
// createSyncMetadata
// ============================================================================

describe('createSyncMetadata', () => {
    it('creates valid sync metadata with default values', () => {
        const sync = createSyncMetadata();
        expect(sync.version).toBe(1);
        expect(sync.ownerId).toBeNull();
        expect(sync.dirty).toBe(true);
        expect(sync.deleted).toBe(false);
        expect(sync.deletedAt).toBeNull();
        expect(typeof sync.createdAt).toBe('number');
        expect(sync.createdAt).toBe(sync.updatedAt);
    });

    it('sets ownerId when provided', () => {
        const sync = createSyncMetadata('user-123');
        expect(sync.ownerId).toBe('user-123');
    });

    it('passes validation', () => {
        const sync = createSyncMetadata();
        expect(isValidSyncMetadata(sync)).toBe(true);
    });
});

// ============================================================================
// touchSyncMetadata
// ============================================================================

describe('touchSyncMetadata', () => {
    it('increments version', () => {
        const sync = createSyncMetadata();
        const touched = touchSyncMetadata(sync);
        expect(touched.version).toBe(2);
    });

    it('marks as dirty', () => {
        const sync = markSynced(createSyncMetadata());
        expect(sync.dirty).toBe(false);
        const touched = touchSyncMetadata(sync);
        expect(touched.dirty).toBe(true);
    });

    it('updates updatedAt timestamp', () => {
        const sync = createSyncMetadata();
        const originalUpdatedAt = sync.updatedAt;
        // Small delay to ensure timestamp changes
        const touched = touchSyncMetadata(sync);
        expect(touched.updatedAt).toBeGreaterThanOrEqual(originalUpdatedAt);
    });

    it('returns new object (immutable)', () => {
        const sync = createSyncMetadata();
        const touched = touchSyncMetadata(sync);
        expect(touched).not.toBe(sync);
        expect(sync.version).toBe(1); // Original unchanged
    });

    it('creates fresh metadata when passed null', () => {
        const result = touchSyncMetadata(null);
        expect(isValidSyncMetadata(result)).toBe(true);
        expect(result.version).toBe(1);
    });

    it('preserves existing fields', () => {
        const sync = createSyncMetadata('owner-1');
        const touched = touchSyncMetadata(sync);
        expect(touched.ownerId).toBe('owner-1');
        expect(touched.createdAt).toBe(sync.createdAt);
    });
});

// ============================================================================
// markSynced
// ============================================================================

describe('markSynced', () => {
    it('clears dirty flag', () => {
        const sync = createSyncMetadata();
        expect(sync.dirty).toBe(true);
        const synced = markSynced(sync);
        expect(synced.dirty).toBe(false);
    });

    it('returns new object (immutable)', () => {
        const sync = createSyncMetadata();
        const synced = markSynced(sync);
        expect(synced).not.toBe(sync);
    });

    it('returns null when passed null', () => {
        expect(markSynced(null)).toBeNull();
    });
});

// ============================================================================
// markDeleted
// ============================================================================

describe('markDeleted', () => {
    it('sets deleted flag and deletedAt', () => {
        const sync = createSyncMetadata();
        const deleted = markDeleted(sync);
        expect(deleted.deleted).toBe(true);
        expect(deleted.deletedAt).toBeGreaterThan(0);
    });

    it('increments version', () => {
        const sync = createSyncMetadata();
        const deleted = markDeleted(sync);
        expect(deleted.version).toBe(2);
    });

    it('marks as dirty for sync', () => {
        const sync = markSynced(createSyncMetadata());
        const deleted = markDeleted(sync);
        expect(deleted.dirty).toBe(true);
    });

    it('handles null input', () => {
        const deleted = markDeleted(null);
        expect(deleted.deleted).toBe(true);
        expect(deleted.deletedAt).toBeGreaterThan(0);
    });
});

// ============================================================================
// markRestored
// ============================================================================

describe('markRestored', () => {
    it('clears deleted flag and deletedAt', () => {
        const sync = markDeleted(createSyncMetadata());
        const restored = markRestored(sync);
        expect(restored.deleted).toBe(false);
        expect(restored.deletedAt).toBeNull();
    });

    it('increments version', () => {
        const sync = createSyncMetadata(); // version 1
        const deleted = markDeleted(sync); // version 2
        const restored = markRestored(deleted); // version 3
        expect(restored.version).toBe(3);
    });

    it('handles null input', () => {
        const restored = markRestored(null);
        expect(isValidSyncMetadata(restored)).toBe(true);
    });
});

// ============================================================================
// Predicates
// ============================================================================

describe('isActive', () => {
    it('returns true for non-deleted entities', () => {
        expect(isActive(createSyncMetadata())).toBe(true);
    });

    it('returns false for deleted entities', () => {
        expect(isActive(markDeleted(createSyncMetadata()))).toBe(false);
    });

    it('returns falsy for null', () => {
        expect(isActive(null)).toBeFalsy();
    });
});

describe('isDirty', () => {
    it('returns true for new entities', () => {
        expect(isDirty(createSyncMetadata())).toBe(true);
    });

    it('returns false after markSynced', () => {
        expect(isDirty(markSynced(createSyncMetadata()))).toBe(false);
    });

    it('returns falsy for null', () => {
        expect(isDirty(null)).toBeFalsy();
    });
});

// ============================================================================
// isValidSyncMetadata
// ============================================================================

describe('isValidSyncMetadata', () => {
    it('validates correct metadata', () => {
        expect(isValidSyncMetadata(createSyncMetadata())).toBe(true);
    });

    it('rejects missing fields', () => {
        expect(isValidSyncMetadata({})).toBe(false);
        expect(isValidSyncMetadata({ createdAt: 1 })).toBe(false);
    });

    it('rejects wrong types', () => {
        const sync = createSyncMetadata();
        expect(isValidSyncMetadata({ ...sync, version: '1' })).toBe(false);
        expect(isValidSyncMetadata({ ...sync, dirty: 'true' })).toBe(false);
        expect(isValidSyncMetadata({ ...sync, deleted: 0 })).toBe(false);
    });

    it('accepts ownerId as null or string', () => {
        expect(isValidSyncMetadata(createSyncMetadata(null))).toBe(true);
        expect(isValidSyncMetadata(createSyncMetadata('user-1'))).toBe(true);
    });

    it('rejects non-object values', () => {
        expect(isValidSyncMetadata(null)).toBeFalsy();
        expect(isValidSyncMetadata(42)).toBeFalsy();
        expect(isValidSyncMetadata('string')).toBeFalsy();
    });

    it('accepts deletedAt as null, undefined, or number', () => {
        const base = createSyncMetadata();
        expect(isValidSyncMetadata({ ...base, deletedAt: null })).toBe(true);
        expect(isValidSyncMetadata({ ...base, deletedAt: undefined })).toBe(true);
        expect(isValidSyncMetadata({ ...base, deletedAt: Date.now() })).toBe(true);
        expect(isValidSyncMetadata({ ...base, deletedAt: 'string' })).toBe(false);
    });
});

// ============================================================================
// addSyncMetadataToEntity
// ============================================================================

describe('addSyncMetadataToEntity', () => {
    it('adds sync metadata to entity without it', () => {
        const entity = { name: 'test', data: [1, 2, 3] };
        const result = addSyncMetadataToEntity(entity);
        expect(result.name).toBe('test');
        expect(isValidSyncMetadata(result.sync)).toBe(true);
    });

    it('preserves existing valid sync metadata', () => {
        const sync = createSyncMetadata('user-1');
        const entity = { name: 'test', sync };
        const result = addSyncMetadataToEntity(entity);
        expect(result.sync).toBe(sync); // Same reference
    });

    it('returns null for null input', () => {
        expect(addSyncMetadataToEntity(null)).toBeNull();
    });
});

// ============================================================================
// Server time offset
// ============================================================================

describe('server time offset', () => {
    it('getAdjustedTimestamp returns Date.now() when offset is 0', () => {
        const before = Date.now();
        const adjusted = getAdjustedTimestamp();
        const after = Date.now();
        expect(adjusted).toBeGreaterThanOrEqual(before);
        expect(adjusted).toBeLessThanOrEqual(after);
    });

    it('applies positive offset (server ahead)', () => {
        setServerTimeOffset(5000);
        const before = Date.now() + 5000;
        const adjusted = getAdjustedTimestamp();
        const after = Date.now() + 5000;
        expect(adjusted).toBeGreaterThanOrEqual(before);
        expect(adjusted).toBeLessThanOrEqual(after);
    });

    it('applies negative offset (server behind)', () => {
        setServerTimeOffset(-3000);
        const before = Date.now() - 3000;
        const adjusted = getAdjustedTimestamp();
        const after = Date.now() - 3000;
        expect(adjusted).toBeGreaterThanOrEqual(before);
        expect(adjusted).toBeLessThanOrEqual(after);
    });

    it('sync metadata uses adjusted timestamp', () => {
        setServerTimeOffset(10000);
        const sync = createSyncMetadata();
        // Timestamp should be ~10s in the future relative to Date.now()
        expect(sync.createdAt).toBeGreaterThan(Date.now() + 9000);
    });

    it('lifecycle preserves offset through operations', () => {
        setServerTimeOffset(5000);
        const sync = createSyncMetadata();
        const touched = touchSyncMetadata(sync);
        const deleted = markDeleted(touched);
        // All timestamps should have the offset applied
        expect(deleted.updatedAt).toBeGreaterThan(Date.now() + 4000);
        expect(deleted.deletedAt).toBeGreaterThan(Date.now() + 4000);
    });
});

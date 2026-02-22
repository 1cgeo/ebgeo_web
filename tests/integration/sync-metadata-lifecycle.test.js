import { describe, it, expect, afterEach } from 'vitest';
import {
    createSyncMetadata,
    touchSyncMetadata,
    markSynced,
    markDeleted,
    markRestored,
    isActive,
    isDirty,
    isValidSyncMetadata,
    setServerTimeOffset,
    getAdjustedTimestamp,
    addSyncMetadataToEntity
} from '../../src/js/store/sync/sync-metadata.js';

// ============================================================================
// TESTS
// ============================================================================

describe('Sync metadata lifecycle (backend integration scenarios)', () => {

    afterEach(() => {
        // Always reset server time offset after each test
        setServerTimeOffset(0);
    });

    // ========================================================================
    // Full entity lifecycle
    // ========================================================================

    describe('full entity lifecycle', () => {
        it('create → touch → sync → touch → delete → restore', async () => {
            // Step 1: Create
            const meta1 = createSyncMetadata();
            expect(meta1.version).toBe(1);
            expect(meta1.dirty).toBe(true);
            expect(meta1.deleted).toBe(false);
            expect(meta1.deletedAt).toBeNull();
            expect(meta1.ownerId).toBeNull();
            expect(meta1.createdAt).toBe(meta1.updatedAt);

            // Small delay to ensure different timestamps
            await new Promise(r => setTimeout(r, 5));

            // Step 2: Touch (modification)
            const meta2 = touchSyncMetadata(meta1);
            expect(meta2.version).toBe(2);
            expect(meta2.dirty).toBe(true);
            expect(meta2.updatedAt).toBeGreaterThan(meta1.createdAt);
            // createdAt should be preserved
            expect(meta2.createdAt).toBe(meta1.createdAt);

            // Step 3: Mark synced (after backend confirms)
            const meta3 = markSynced(meta2);
            expect(meta3.dirty).toBe(false);
            expect(meta3.version).toBe(2); // Version NOT reset by sync

            // Small delay
            await new Promise(r => setTimeout(r, 5));

            // Step 4: Touch again (new local change)
            const meta4 = touchSyncMetadata(meta3);
            expect(meta4.version).toBe(3);
            expect(meta4.dirty).toBe(true);

            // Step 5: Mark deleted (soft delete)
            const meta5 = markDeleted(meta4);
            expect(meta5.deleted).toBe(true);
            expect(meta5.deletedAt).toBeGreaterThan(0);
            expect(meta5.dirty).toBe(true);
            expect(meta5.version).toBe(4); // Version incremented

            // Step 6: Mark restored (undelete)
            const meta6 = markRestored(meta5);
            expect(meta6.deleted).toBe(false);
            expect(meta6.deletedAt).toBeNull();
            expect(meta6.dirty).toBe(true);
            expect(meta6.version).toBe(5);
        });

        it('each step returns a new object (immutability)', () => {
            const meta1 = createSyncMetadata('user-1');
            const meta2 = touchSyncMetadata(meta1);
            const meta3 = markSynced(meta2);
            const meta4 = markDeleted(meta3);
            const meta5 = markRestored(meta4);

            // All should be different references
            const refs = [meta1, meta2, meta3, meta4, meta5];
            for (let i = 0; i < refs.length; i++) {
                for (let j = i + 1; j < refs.length; j++) {
                    expect(refs[i]).not.toBe(refs[j]);
                }
            }
        });
    });

    // ========================================================================
    // Version monotonicity
    // ========================================================================

    describe('version monotonicity', () => {
        it('100 touch() calls → versions strictly increasing', () => {
            let meta = createSyncMetadata();
            const versions = [meta.version];

            for (let i = 0; i < 100; i++) {
                meta = touchSyncMetadata(meta);
                versions.push(meta.version);
            }

            // Every version should be greater than the previous
            for (let i = 1; i < versions.length; i++) {
                expect(versions[i]).toBeGreaterThan(versions[i - 1]);
            }
            expect(meta.version).toBe(101);
        });

        it('markSynced does NOT reset version', () => {
            let meta = createSyncMetadata();
            meta = touchSyncMetadata(meta); // version=2
            meta = touchSyncMetadata(meta); // version=3

            const versionBefore = meta.version;
            meta = markSynced(meta);
            expect(meta.version).toBe(versionBefore);
        });

        it('markDeleted increments version', () => {
            let meta = createSyncMetadata();
            meta = touchSyncMetadata(meta); // version=2
            const versionBefore = meta.version;

            meta = markDeleted(meta);
            expect(meta.version).toBe(versionBefore + 1);
        });

        it('markRestored increments version', () => {
            let meta = createSyncMetadata();
            meta = markDeleted(meta); // version=2
            const versionBefore = meta.version;

            meta = markRestored(meta);
            expect(meta.version).toBe(versionBefore + 1);
        });
    });

    // ========================================================================
    // Server time offset
    // ========================================================================

    describe('server time offset', () => {
        it('offset +5000ms → timestamps adjusted forward', () => {
            setServerTimeOffset(5000);
            const before = Date.now();
            const ts = getAdjustedTimestamp();
            const after = Date.now();

            expect(ts).toBeGreaterThanOrEqual(before + 5000);
            expect(ts).toBeLessThanOrEqual(after + 5000);
        });

        it('offset -3000ms → timestamps adjusted backward', () => {
            setServerTimeOffset(-3000);
            const before = Date.now();
            const ts = getAdjustedTimestamp();
            const after = Date.now();

            expect(ts).toBeGreaterThanOrEqual(before - 3000);
            expect(ts).toBeLessThanOrEqual(after - 3000);
        });

        it('offset=0 → timestamps = Date.now()', () => {
            setServerTimeOffset(0);
            const before = Date.now();
            const ts = getAdjustedTimestamp();
            const after = Date.now();

            expect(ts).toBeGreaterThanOrEqual(before);
            expect(ts).toBeLessThanOrEqual(after);
        });

        it('createSyncMetadata uses adjusted timestamp', () => {
            setServerTimeOffset(10000);
            const before = Date.now() + 10000;
            const meta = createSyncMetadata();
            const after = Date.now() + 10000;

            expect(meta.createdAt).toBeGreaterThanOrEqual(before);
            expect(meta.createdAt).toBeLessThanOrEqual(after);
        });

        it('touchSyncMetadata uses adjusted timestamp', () => {
            setServerTimeOffset(0);
            const meta = createSyncMetadata();

            setServerTimeOffset(20000);
            const touched = touchSyncMetadata(meta);

            expect(touched.updatedAt).toBeGreaterThan(meta.createdAt + 19000);
        });
    });

    // ========================================================================
    // Conflict detection scenario
    // ========================================================================

    describe('conflict detection scenario', () => {
        it('local version < remote version → local is stale', () => {
            const localMeta = createSyncMetadata();
            // version=1
            const remoteMeta = { ...localMeta, version: 5 };

            const localIsStale = localMeta.version < remoteMeta.version;
            expect(localIsStale).toBe(true);
        });

        it('local version > remote version → remote is stale', () => {
            let localMeta = createSyncMetadata();
            localMeta = touchSyncMetadata(localMeta);
            localMeta = touchSyncMetadata(localMeta);
            localMeta = touchSyncMetadata(localMeta);
            localMeta = touchSyncMetadata(localMeta);
            // version=5

            const remoteMeta = { ...localMeta, version: 3 };

            const remoteIsStale = remoteMeta.version < localMeta.version;
            expect(remoteIsStale).toBe(true);
        });

        it('same version, different updatedAt → LWW by timestamp', async () => {
            const meta1 = createSyncMetadata();
            await new Promise(r => setTimeout(r, 5));
            const meta2 = createSyncMetadata();

            // Both version=1, but meta2 has later timestamp
            expect(meta1.version).toBe(meta2.version);
            expect(meta2.updatedAt).toBeGreaterThanOrEqual(meta1.updatedAt);

            // LWW: the one with the later updatedAt wins
            const winner = meta1.updatedAt > meta2.updatedAt ? meta1 : meta2;
            expect(winner).toBe(meta2);
        });
    });

    // ========================================================================
    // Dirty flag through sync cycle
    // ========================================================================

    describe('dirty flag through sync cycle', () => {
        it('tracks dirty state through create→sync→update→sync→delete→sync', () => {
            // Create: dirty
            let meta = createSyncMetadata();
            expect(isDirty(meta)).toBe(true);
            expect(isActive(meta)).toBe(true);

            // Sync: clean
            meta = markSynced(meta);
            expect(isDirty(meta)).toBe(false);
            expect(isActive(meta)).toBe(true);

            // Update: dirty again
            meta = touchSyncMetadata(meta);
            expect(isDirty(meta)).toBe(true);
            expect(isActive(meta)).toBe(true);

            // Sync: clean
            meta = markSynced(meta);
            expect(isDirty(meta)).toBe(false);

            // Delete: dirty (needs sync)
            meta = markDeleted(meta);
            expect(isDirty(meta)).toBe(true);
            expect(isActive(meta)).toBe(false);

            // Sync deletion: clean
            meta = markSynced(meta);
            expect(isDirty(meta)).toBe(false);
            expect(isActive(meta)).toBe(false);
        });
    });

    // ========================================================================
    // Validation
    // ========================================================================

    describe('validation', () => {
        it('createSyncMetadata produces valid metadata', () => {
            const meta = createSyncMetadata('user-123');
            expect(isValidSyncMetadata(meta)).toBe(true);
        });

        it('touchSyncMetadata preserves validity', () => {
            const meta = touchSyncMetadata(createSyncMetadata());
            expect(isValidSyncMetadata(meta)).toBe(true);
        });

        it('all lifecycle operations preserve validity', () => {
            let meta = createSyncMetadata();
            expect(isValidSyncMetadata(meta)).toBe(true);

            meta = touchSyncMetadata(meta);
            expect(isValidSyncMetadata(meta)).toBe(true);

            meta = markSynced(meta);
            expect(isValidSyncMetadata(meta)).toBe(true);

            meta = markDeleted(meta);
            expect(isValidSyncMetadata(meta)).toBe(true);

            meta = markRestored(meta);
            expect(isValidSyncMetadata(meta)).toBe(true);
        });

        it('invalid objects fail validation', () => {
            expect(isValidSyncMetadata(null)).toBeFalsy();
            expect(isValidSyncMetadata({})).toBe(false);
            expect(isValidSyncMetadata({ createdAt: 'not a number' })).toBe(false);
        });
    });

    // ========================================================================
    // Null safety
    // ========================================================================

    describe('null safety', () => {
        it('touchSyncMetadata with null creates fresh metadata', () => {
            const meta = touchSyncMetadata(null);
            expect(isValidSyncMetadata(meta)).toBe(true);
            expect(meta.version).toBe(1);
        });

        it('markSynced with null returns null', () => {
            expect(markSynced(null)).toBeNull();
        });

        it('markDeleted with null creates fresh deleted metadata', () => {
            const meta = markDeleted(null);
            expect(meta.deleted).toBe(true);
            expect(meta.deletedAt).toBeGreaterThan(0);
        });

        it('markRestored with null creates fresh active metadata', () => {
            const meta = markRestored(null);
            expect(meta.deleted).toBe(false);
            expect(meta.deletedAt).toBeNull();
        });
    });

    // ========================================================================
    // Entity migration helper
    // ========================================================================

    describe('addSyncMetadataToEntity', () => {
        it('adds sync metadata to entity without it', () => {
            const entity = { name: 'Test Map' };
            const result = addSyncMetadataToEntity(entity, 'user-1');
            expect(result.sync).toBeDefined();
            expect(isValidSyncMetadata(result.sync)).toBe(true);
            expect(result.sync.ownerId).toBe('user-1');
            expect(result.name).toBe('Test Map');
        });

        it('preserves existing valid sync metadata', () => {
            const existing = createSyncMetadata('user-2');
            const entity = { name: 'Map', sync: existing };
            const result = addSyncMetadataToEntity(entity);
            expect(result.sync).toBe(existing); // Same reference
        });

        it('returns null for null entity', () => {
            expect(addSyncMetadataToEntity(null)).toBeNull();
        });
    });
});

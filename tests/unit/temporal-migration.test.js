import { describe, it, expect } from 'vitest';
import { compareVersions } from '../../src/js/store/repository.utils.js';
import { ATLAS_SCHEMA_VERSION } from '../../src/js/store/atlas/atlas.entity.js';

/**
 * Regression guard for the Temporal Module schema bump (v2.1 -> v2.2).
 * The migration itself touches IndexedDB (not unit-testable in node), but the
 * version chain logic is pure: every pre-2.2 atlas must be detected as needing
 * the migration, and 2.2 must be considered current.
 */
describe('temporal schema migration (v2.1 -> v2.2)', () => {
    // Asserted against the CURRENT version instead of repeating '2.2' a second
    // time: this file guards the 2.1 -> 2.2 link, not whichever bump happens to
    // be last, and a ruler that hard-codes the number reproves good code every
    // time the schema moves on.
    it('keeps the temporal bump inside the chain', () => {
        expect(compareVersions('2.2', ATLAS_SCHEMA_VERSION) <= 0).toBe(true);
    });

    it('orders the version chain so older atlases trigger the migration', () => {
        expect(compareVersions('2.1', '2.2')).toBe(-1);
        expect(compareVersions('2.0', '2.2')).toBe(-1);
        expect(compareVersions('1.7', '2.2')).toBe(-1);
    });

    it('stops re-running the temporal migration once the atlas reaches 2.2', () => {
        expect(compareVersions('2.2', '2.2')).toBe(0);
        expect(compareVersions(ATLAS_SCHEMA_VERSION, '2.2') < 0).toBe(false);
    });

    it('matches the chained guard used by safelyMigrate (currentVersion < 2.2)', () => {
        // Mirrors: if (compareVersions(currentVersion, '2.2') < 0) await migrateToV2_2();
        const triggersMigration = (v) => compareVersions(v, '2.2') < 0;
        expect(triggersMigration('2.1')).toBe(true);
        expect(triggersMigration('2.2')).toBe(false);
    });
});

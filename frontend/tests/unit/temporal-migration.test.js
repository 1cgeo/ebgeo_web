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
    it('leaves 2.2 behind the chain head, which is now the named-local-atlas step (2.3)', () => {
        // This used to read `toBe('2.2')`, i.e. "2.2 is the head". The head moved when the
        // single local workspace became a named atlas, and the temporal step's own contract
        // (below) is what this file is actually about: a step's target version stops being
        // the head the moment another step is appended.
        expect(ATLAS_SCHEMA_VERSION).toBe('2.3');
        expect(compareVersions('2.2', ATLAS_SCHEMA_VERSION)).toBe(-1);
    });

    it('orders the version chain so older atlases trigger the migration', () => {
        expect(compareVersions('2.1', '2.2')).toBe(-1);
        expect(compareVersions('2.0', '2.2')).toBe(-1);
        expect(compareVersions('1.7', '2.2')).toBe(-1);
    });

    it('treats a 2.2 atlas as current FOR THE TEMPORAL STEP (no re-migration loop)', () => {
        expect(compareVersions('2.2', '2.2')).toBe(0);
        expect(compareVersions('2.2', '2.1') > 0).toBe(true);
    });

    it('matches the chained guard used by safelyMigrate (currentVersion < 2.2)', () => {
        // Mirrors: if (compareVersions(currentVersion, '2.2') < 0) await migrateToV2_2();
        const triggersMigration = (v) => compareVersions(v, '2.2') < 0;
        expect(triggersMigration('2.1')).toBe(true);
        expect(triggersMigration('2.2')).toBe(false);
    });
});

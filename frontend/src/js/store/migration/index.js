// Path: js/store/migration/index.js

/**
 * @fileoverview Barrel file for migration module.
 * Exports migration service and utilities.
 *
 * Every name here is re-exported from a module that actually defines it, which had stopped
 * being true: this barrel advertised `restoreLatestBackup`, `createFullBackup`,
 * `restoreFromBackup`, `validateMigration` and `cleanupOldBackups` long after the backup
 * machinery was removed, so importing the barrel threw. Nothing imported it, which is the
 * only reason the breakage was invisible.
 */

// Migration service (main entry point)
export {
    detectMigrationNeeded,
    isTooOldToMigrate,
    migrateActiveSlot,
    safelyMigrate,
    getMigrationStatus
} from './migration.service.js';

export { isLegacyScope, legacyScope } from './migration-scope.js';

// Migration logic (for testing and advanced use)
export {
    migrateToV2,
    createIdMappings,
    migrateFeature,
    migrateFeatures
} from './v1-to-v2.migration.js';

export { migrateToV2_1 } from './v2-to-v2.1.migration.js';

export { migrateToV2_2 } from './v2.1-to-v2.2.migration.js';

export { migrateToV3_0 } from './v2.x-to-v3.0.migration.js';

// The boot's reading of the pre-namespace installation, and the one line it writes about it.
export {
    MigrationBranch,
    observeLegacyInstallation,
    reportBootAtlasScope,
    resetBootLegacyAdoption
} from './boot-legacy-adoption.js';

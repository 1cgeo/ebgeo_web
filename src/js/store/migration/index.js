// Path: js/store/migration/index.js

/**
 * @fileoverview Barrel file for migration module.
 * Exports migration service and utilities.
 */

// Migration service (main entry point)
export {
    detectMigrationNeeded,
    isTooOldToMigrate,
    safelyMigrate,
    getMigrationStatus,
    restoreLatestBackup
} from './migration.service.js';

// Migration logic (for testing and advanced use)
export {
    migrateToV2,
    createFullBackup,
    restoreFromBackup,
    validateMigration,
    cleanupOldBackups,
    createIdMappings,
    migrateFeature,
    migrateFeatures
} from './v1-to-v2.migration.js';

export { migrateToV2_1 } from './v2-to-v2.1.migration.js';

export { migrateToV2_2 } from './v2.1-to-v2.2.migration.js';

export { migrateToV2_3, ensureCoordinationLines } from './v2.2-to-v2.3.migration.js';

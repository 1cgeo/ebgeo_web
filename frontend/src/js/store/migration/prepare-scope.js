// Path: js/store/migration/prepare-scope.js
import { ATLAS_RECORD_KEY, StoreName, getStoreFor } from '../atlas-namespace.js';
import { createAtlas } from '../atlas/atlas.entity.js';
import { runLegacyMigrations } from './legacy-backfills.js';
import { safelyMigrate, detectMigrationNeeded, isTooOldToMigrate } from './migration.service.js';
import { repairPlaceholderMapNames, migrateToV3_0 } from './v2.x-to-v3.0.migration.js';
import { MigrationRecoveryError } from './transition-state.js';

/** Transform an isolated copy without activating a scope or starting the editor. */
export async function prepareIsolatedScope(scope, name, { empty = false } = {}) {
    const settings = getStoreFor(StoreName.SETTINGS, scope);
    const atlasStore = getStoreFor(StoreName.ATLAS, scope);
    if (empty) {
        await atlasStore.setItem(ATLAS_RECORD_KEY, createAtlas(name));
        await settings.setItem('schemaVersion', '3.0');
    } else {
        // Validate BOTH markers before any backfill; use the same checkpoint as the
        // active-slot migrator, including interrupted steps and patch versions.
        const { currentVersion: version } = await detectMigrationNeeded(scope);
        if (!version || isTooOldToMigrate(version)) {
            throw new MigrationRecoveryError('unsupported_version', 'A cópia precisa de recuperação assistida; seus registros foram preservados.');
        }
        await runLegacyMigrations(version, scope);
        await safelyMigrate(scope);
        // Also completes a crash between the two v3 marker writes.
        await migrateToV3_0(scope);
        await repairPlaceholderMapNames(scope);
    }
    const record = await atlasStore.getItem(ATLAS_RECORD_KEY);
    if (record?.schemaVersion === '3.0') await settings.setItem('schemaVersion', '3.0');
    if (await settings.getItem('schemaVersion') !== '3.0') {
        throw new MigrationRecoveryError('migration_failed', 'A atualização não alcançou uma versão utilizável.');
    }
    if (record) await atlasStore.setItem(ATLAS_RECORD_KEY, { ...record, name });
}

// Path: js/store/migration/prepare-scope.js
import { ATLAS_RECORD_KEY, StoreName, getStoreFor } from '../atlas-namespace.js';
import { createAtlas } from '../atlas/atlas.entity.js';
import { runLegacyMigrations } from './legacy-backfills.js';
import { safelyMigrate } from './migration.service.js';
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
        const settingsVersion = await settings.getItem('schemaVersion');
        const atlas = await atlasStore.getItem(ATLAS_RECORD_KEY);
        const version = atlas?.schemaVersion || settingsVersion;
        if (!['1.3', '1.4', '1.5', '1.6', '1.7', '2.0', '2.1', '2.2', '2.3', '2.4', '3.0'].includes(version)) {
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

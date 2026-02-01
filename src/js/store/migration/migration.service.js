// Path: js/store/migration/migration.service.js

/**
 * @fileoverview Migration orchestration service.
 *
 * This service handles detection and execution of schema migrations.
 * If migration fails, an error is thrown and the application aborts.
 */

import localforage from 'localforage';
import { ATLAS_SCHEMA_VERSION } from '../atlas/atlas.entity.js';
import { migrateToV2 } from './v1-to-v2.migration.js';

// App settings store
const appStore = localforage.createInstance({ name: 'ebgeo_app_settings' });
const atlasStore = localforage.createInstance({ name: 'ebgeo_atlas' });

/**
 * Minimum schema version supported for migration.
 * Versions below this will have data cleared (too old to migrate).
 */
const MIN_MIGRATABLE_VERSION = '1.3';

/**
 * Compares two version strings.
 * @param {string} v1 - First version
 * @param {string} v2 - Second version
 * @returns {number} -1 if v1 < v2, 0 if equal, 1 if v1 > v2
 */
function compareVersions(v1, v2) {
    const parts1 = (v1 || '0').split('.').map(Number);
    const parts2 = (v2 || '0').split('.').map(Number);

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
        const p1 = parts1[i] || 0;
        const p2 = parts2[i] || 0;
        if (p1 < p2) return -1;
        if (p1 > p2) return 1;
    }
    return 0;
}

/**
 * Detects if migration is needed.
 * @returns {Promise<{needed: boolean, currentVersion: string|null, targetVersion: string}>}
 */
export async function detectMigrationNeeded() {
    const currentVersion = await appStore.getItem('schemaVersion');
    const atlas = await atlasStore.getItem('current_atlas');

    // If Atlas already exists with correct version, no migration needed
    if (atlas && atlas.schemaVersion === ATLAS_SCHEMA_VERSION) {
        return {
            needed: false,
            currentVersion: ATLAS_SCHEMA_VERSION,
            targetVersion: ATLAS_SCHEMA_VERSION
        };
    }

    // If no version or old version, migration is needed
    if (!currentVersion || compareVersions(currentVersion, ATLAS_SCHEMA_VERSION) < 0) {
        return {
            needed: true,
            currentVersion,
            targetVersion: ATLAS_SCHEMA_VERSION
        };
    }

    return {
        needed: false,
        currentVersion,
        targetVersion: ATLAS_SCHEMA_VERSION
    };
}

/**
 * Checks if the current version is too old to migrate.
 * @param {string|null} currentVersion - Current schema version
 * @returns {boolean} True if version is too old
 */
export function isTooOldToMigrate(currentVersion) {
    if (!currentVersion) return false; // No version = fresh install
    return compareVersions(currentVersion, MIN_MIGRATABLE_VERSION) < 0;
}

/**
 * Executes migration. If migration fails, throws an error.
 * @returns {Promise<{success: boolean, error?: string}>}
 * @throws {Error} If migration fails
 */
export async function safelyMigrate() {
    const { needed, currentVersion } = await detectMigrationNeeded();

    if (!needed) {
        console.log('No migration needed');
        return { success: true };
    }

    // Check if version is too old
    if (isTooOldToMigrate(currentVersion)) {
        console.warn(`Version ${currentVersion} is too old to migrate. Data will be cleared.`);
        return { success: true };
    }

    console.log(`Migration needed: ${currentVersion} -> ${ATLAS_SCHEMA_VERSION}`);

    try {
        console.log('Executing migration...');
        await migrateToV2();
        console.log('Migration completed successfully');
        return { success: true };
    } catch (error) {
        console.error('Migration failed:', error);
        throw new Error(`Falha na migração para v2.0: ${error.message}. Por favor, exporte seus dados e limpe o armazenamento local.`);
    }
}

/**
 * Gets migration status info.
 * @returns {Promise<Object>} Status information
 */
export async function getMigrationStatus() {
    const currentVersion = await appStore.getItem('schemaVersion');
    const atlas = await atlasStore.getItem('current_atlas');

    return {
        currentVersion,
        targetVersion: ATLAS_SCHEMA_VERSION,
        hasAtlas: !!atlas,
        atlasVersion: atlas?.schemaVersion || null
    };
}

// Path: js/store/migration/migration.service.js

/**
 * @fileoverview Migration orchestration service.
 *
 * Handles detection and execution of schema migrations.
 * If migration fails, an error is thrown and the application aborts.
 */

import localforage from 'localforage';
import { ATLAS_SCHEMA_VERSION } from '../atlas/atlas.entity.js';
import { migrateToV2 } from './v1-to-v2.migration.js';
import { migrateToV2_1 } from './v2-to-v2.1.migration.js';
import { migrateToV2_2 } from './v2.1-to-v2.2.migration.js';

const appStore = localforage.createInstance({ name: 'ebgeo_app_settings' });
const atlasStore = localforage.createInstance({ name: 'ebgeo_atlas' });

/** Versions below this will have data cleared (too old to migrate). */
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
    const maxLen = Math.max(parts1.length, parts2.length);

    for (let i = 0; i < maxLen; i++) {
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

    const atlasCurrent = atlas && atlas.schemaVersion === ATLAS_SCHEMA_VERSION;
    const versionCurrent = currentVersion && compareVersions(currentVersion, ATLAS_SCHEMA_VERSION) >= 0;
    const needed = !atlasCurrent && !versionCurrent;

    return {
        needed,
        currentVersion: atlasCurrent ? ATLAS_SCHEMA_VERSION : currentVersion,
        targetVersion: ATLAS_SCHEMA_VERSION
    };
}

/**
 * Checks if the current version is too old to migrate.
 * @param {string|null} currentVersion - Current schema version
 * @returns {boolean} True if version is too old (null means fresh install, not too old)
 */
export function isTooOldToMigrate(currentVersion) {
    if (!currentVersion) return false;
    return compareVersions(currentVersion, MIN_MIGRATABLE_VERSION) < 0;
}

/**
 * Executes migration. If migration fails, throws an error.
 * @returns {Promise<{success: boolean}>}
 * @throws {Error} If migration fails
 */
export async function safelyMigrate() {
    const { needed, currentVersion } = await detectMigrationNeeded();

    if (!needed) {
        console.log('No migration needed');
        return { success: true };
    }

    if (isTooOldToMigrate(currentVersion)) {
        console.warn(`Version ${currentVersion} is too old to migrate. Data will be cleared.`);
        return { success: true };
    }

    console.log(`Migration needed: ${currentVersion} -> ${ATLAS_SCHEMA_VERSION}`);

    try {
        if (compareVersions(currentVersion, '2.0') < 0) {
            await migrateToV2();
        }
        if (compareVersions(currentVersion, '2.1') < 0) {
            await migrateToV2_1();
        }
        if (compareVersions(currentVersion, '2.2') < 0) {
            await migrateToV2_2();
        }
        console.log('Migration completed successfully');
        return { success: true };
    } catch (error) {
        console.error('Migration failed:', error);
        throw new Error(
            `Falha na migração para ${ATLAS_SCHEMA_VERSION}: ${error.message}. Por favor, exporte seus dados e limpe o armazenamento local.`
        );
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

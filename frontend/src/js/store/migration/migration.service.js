// Path: js/store/migration/migration.service.js

/**
 * @fileoverview Migration orchestration service.
 *
 * Handles detection and execution of schema migrations.
 * If migration fails, an error is thrown and the application aborts.
 *
 * ===========================================================================
 * WHICH SLOT A MIGRATION OPERATES ON (read this before adding a step)
 * ===========================================================================
 * THE TARGET IS AN ARGUMENT, NEVER THE ACTIVE SCOPE. `detectMigrationNeeded(scope)` and
 * `safelyMigrate(scope)` take the scope they act on, defaulting to the pre-namespace
 * databases (`migration-scope.js`). Every step takes the same scope and resolves its stores
 * through `getStoreFor(..., scope)`, so nothing here is bound to a database name or to
 * whatever atlas happened to be mounted.
 *
 * WHY IT IS AN ARGUMENT AND NOT `getActiveScope()`, which is the fix that was tried and
 * REVERTED on 2026-08-15: a boot whose origin marker says REMOTE mounts the SERVER atlas's
 * namespace, which is empty, while the data that boot has to reach sits in the pre-namespace
 * databases. Inferring the target from the mounted scope aims the whole chain at the empty
 * namespace and the pre-namespace server residue is never discarded (four cases of
 * `tests/integration/migracao-22-para-23-fixture-real.test.js` measure exactly that). The two
 * jobs are different jobs and the code now says so:
 *
 *   1. `safelyMigrate()` with no argument = the INSTALLATION upgrade, on the pre-namespace
 *      databases. Runs the four steps, and it is `migrateToV3_0` that registers slot #1 and
 *      discards a REMOTE store instead of adopting it.
 *   2. `migrateActiveSlot()` = the MOUNTED slot, and only when it is a namespaced LOCAL one.
 *      A REMOTE scope is never a target: its content is a server snapshot, reshaped on
 *      arrival by the sync layer, and a schema step is not what brings it forward. An
 *      UNSTAMPED scope is never a target either: it is EMPTY, not old (the discriminator is
 *      `isVirginScope`, and reading it as "pre-1.0" would run the v1 step, which CREATES an
 *      atlas record, over a fresh slot).
 *
 * This closes the defect this header used to document as open: with one namespace per atlas,
 * a detector anchored on fixed names asked the LEGACY slot whether the MOUNTED one needed
 * work, so a slot carrying older data was compared against another slot's stamp, `needed`
 * came back false, and its migration never ran, with no error and no log.
 *
 * AND STILL BUMP `ATLAS_SCHEMA_VERSION` (`atlas/atlas.entity.js`) IN THE SAME COMMIT. The
 * detector compares against that constant; if it does not move, `needed` is false and the new
 * step simply never runs, silently. It is the step most easily forgotten in this repository.
 *
 * ===========================================================================================
 * THE CHAIN, AND WHAT EACH LINK IS GATED ON
 * ===========================================================================================
 *   < 2.0  -> `migrateToV2`    : wraps the maps in an Atlas entity and renumbers every id.
 *   < 2.1  -> `migrateToV2_1`  : backfills `sizeCreatedAtZoom` on point features.
 *   < 2.2  -> `migrateToV2_2`  : the Temporal Module's per-map configuration.
 *   < 3.0  -> `migrateToV3_0`  : the pre-namespace workspace becomes a NAMED local atlas.
 *
 * THE LAST LINK USED TO READ `< '2.3'`, AND THAT LITERAL WAS THE DEFECT. 2.3 is a number the
 * OTHER product line also carries, meaning something else there, and that line had already
 * moved past it to 2.4. A repository arriving from it therefore satisfied the gate, the
 * adoption step never ran, and nothing said so. Bumping only the constant does not fix it
 * either: the gate would still stop at 2.3, `detectMigrationNeeded` would report work on every
 * boot forever, and `safelyMigrate` would keep logging "Migration completed successfully" over
 * a chain in which nothing ran (measured on 2026-09-07). The step and its gate move together,
 * or neither moves.
 *
 * ===========================================================================================
 * THE VERSION AN INSTALLATION IS REALLY AT IS NOT ALWAYS THE ONE IN THE SETTINGS
 * ===========================================================================================
 * The other line's "Limpar Todos os Dados" empties eight databases, does NOT empty the atlas
 * record, and stamps the settings with its own LEGACY constant, `'1.7'`. Its own detector never
 * notices (it reads the surviving 2.x record and answers "current"), so the user goes on
 * drawing at 2.4 with `'1.7'` on the marker. Read literally here, that pair sends the chain
 * back to `migrateToV2`, which renumbers every feature id; the image blobs are keyed BY feature
 * id and nothing rewrites them, so all of them go orphan. Measured over the production fixture:
 * 805 features preserved, 0 ids surviving, 146 reachable blobs reduced to 0, with no undo.
 *
 * So the effective version is the ATLAS RECORD's whenever the settings marker claims a v1 while
 * the record declares 2.x or above (`effectiveVersion` below). It is the record that describes
 * the data; the marker, in that state, describes only which constant the other line wrote last.
 * `migrateToV2` carries the same guard from the other end, because a rule enforced in one place
 * is a rule that the next caller walks around.
 */

import {
    ATLAS_RECORD_KEY,
    StoreName,
    StoreScopeKind,
    getActiveScope,
    getStoreFor
} from '../atlas-namespace.js';
import { isLegacyScope, legacyScope } from './migration-scope.js';
import { ATLAS_SCHEMA_VERSION } from '../atlas/atlas.entity.js';
import { migrateToV2 } from './v1-to-v2.migration.js';
import { migrateToV2_1 } from './v2-to-v2.1.migration.js';
import { migrateToV2_2 } from './v2.1-to-v2.2.migration.js';
import { migrateToV3_0 } from './v2.x-to-v3.0.migration.js';

/** Key of the schema marker inside a scope's settings database. */
const SCHEMA_VERSION_KEY = 'schemaVersion';

/**
 * Versions below this will have data cleared (too old to migrate).
 *
 * IT STAYS AT 1.3, and raising it is not a tidy-up. Together with `MIN_SCHEMA_VERSION`
 * (`repository.utils.js`, the trigger of `clearLegacyStores`) this is the floor under which a
 * repository is DESTROYED rather than migrated, and real installations sit just above it: the
 * other product line's data-wipe stamps `'1.7'` on a repository whose atlas record is at 2.4,
 * so a floor at 2.0 would delete a full atlas instead of migrating it. Pinned by
 * `tests/store/pisos-de-migracao.test.js`.
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
 * @param {{ kind: string, dbSuffix: string }} scope - Target scope.
 * @returns {string} Short label for a log line, so a migration log says WHICH databases it
 *   is about. Without it two slots migrating in one boot produce identical lines.
 */
function describeScope(scope) {
    return isLegacyScope(scope) ? 'pre-namespace' : `${scope.kind}:${scope.dbSuffix}`;
}

/**
 * The version a scope is REALLY at, from the two markers it carries.
 *
 * Normally the settings marker answers alone. The exception it exists for is the "1.7 entry"
 * described in the fileoverview: a settings marker claiming a v1 next to an atlas record that
 * declares 2.x or above is NOT a v1 installation, it is a 2.x installation whose marker was
 * overwritten by the other line's data-wipe constant. Believing the marker there re-runs the v1
 * step over 2.x data and orphans every image blob.
 *
 * IT IS DELIBERATELY NOT "the higher of the two". `migrateToV2` writes the record at the version
 * IT reaches (2.0) precisely so an interrupted chain resumes at the right link; a max() would
 * also promote every mid-chain record and let a crash between two links declare the whole chain
 * finished, which is the defect `v1-to-v2.migration.js` documents.
 *
 * @param {string|null} settingsVersion - Marker in the settings database.
 * @param {Object|null} atlas - The scope's atlas record.
 * @returns {string|null} The version the rest of this module reasons with.
 */
function effectiveVersion(settingsVersion, atlas) {
    const recordVersion = typeof atlas?.schemaVersion === 'string' ? atlas.schemaVersion : null;
    if (!settingsVersion || !recordVersion) return settingsVersion;

    const settingsIsV1 = compareVersions(settingsVersion, '2.0') < 0;
    const recordIsV2OrLater = compareVersions(recordVersion, '2.0') >= 0;
    return settingsIsV1 && recordIsV2OrLater ? recordVersion : settingsVersion;
}

/**
 * Detects if migration is needed.
 * @param {{ kind: string, dbSuffix: string }} [scope] - Target scope. Defaults to the
 *   pre-namespace databases, which is the INSTALLATION upgrade.
 * @returns {Promise<{needed: boolean, currentVersion: string|null, targetVersion: string}>}
 */
export async function detectMigrationNeeded(scope = legacyScope()) {
    const settingsVersion = await getStoreFor(StoreName.SETTINGS, scope).getItem(SCHEMA_VERSION_KEY);
    const atlas = await getStoreFor(StoreName.ATLAS, scope).getItem(ATLAS_RECORD_KEY);
    const currentVersion = effectiveVersion(settingsVersion, atlas);

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
 * @param {{ kind: string, dbSuffix: string }} [scope] - Target scope. Defaults to the
 *   pre-namespace databases.
 * @returns {Promise<{success: boolean}>}
 * @throws {Error} If migration fails
 */
export async function safelyMigrate(scope = legacyScope()) {
    const { needed, currentVersion } = await detectMigrationNeeded(scope);

    if (!needed) {
        console.log('No migration needed');
        return { success: true };
    }

    if (isTooOldToMigrate(currentVersion)) {
        console.warn(`Version ${currentVersion} is too old to migrate. Data will be cleared.`);
        return { success: true };
    }

    console.log(
        `Migration needed: ${currentVersion} -> ${ATLAS_SCHEMA_VERSION} (${describeScope(scope)})`
    );

    try {
        if (compareVersions(currentVersion, '2.0') < 0) {
            await migrateToV2(scope);
        }
        if (compareVersions(currentVersion, '2.1') < 0) {
            await migrateToV2_1(scope);
        }
        if (compareVersions(currentVersion, '2.2') < 0) {
            await migrateToV2_2(scope);
        }
        if (compareVersions(currentVersion, '3.0') < 0) {
            await migrateToV3_0(scope);
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
 * Has this scope ever been written by a version of the app that stamps a schema?
 *
 * A scope with neither marker is EMPTY, not old, and the distinction decides whether a
 * chain runs over it: `detectMigrationNeeded` reports `needed: true` for a null version
 * (correct for the pre-namespace databases, where null means "a v1.x install that predates
 * the marker"), and running the v1 step over a fresh slot would CREATE an atlas record and
 * renumber nothing, i.e. spend a migration on a repository that has no data to migrate.
 *
 * @param {{ kind: string, dbSuffix: string }} scope - Target scope.
 * @returns {Promise<boolean>} True when the scope carries no schema marker at all.
 */
async function isVirginScope(scope) {
    const version = await getStoreFor(StoreName.SETTINGS, scope).getItem(SCHEMA_VERSION_KEY);
    if (version) return false;
    return !(await getStoreFor(StoreName.ATLAS, scope).getItem(ATLAS_RECORD_KEY));
}

/**
 * Brings the MOUNTED atlas forward, when it is a namespaced local slot that needs it.
 *
 * This is the half the fixed-name detector could not reach: `initializeRepository` runs once
 * per boot, and before this existed it asked the pre-namespace databases whether the mounted
 * slot needed work. The three cases that are deliberately NOT targets are listed in the
 * fileoverview; each one returns without touching storage.
 *
 * @returns {Promise<{success: boolean, migrated: boolean, reason: string}>} `reason` names
 *   why nothing ran, so a boot log can distinguish "already current" from "not a target".
 */
export async function migrateActiveSlot() {
    const scope = getActiveScope();
    if (!scope) return { success: true, migrated: false, reason: 'no-scope' };
    if (scope.kind !== StoreScopeKind.LOCAL) return { success: true, migrated: false, reason: 'remote' };
    if (isLegacyScope(scope)) return { success: true, migrated: false, reason: 'pre-namespace' };
    if (await isVirginScope(scope)) return { success: true, migrated: false, reason: 'empty' };

    const { needed } = await detectMigrationNeeded(scope);
    if (!needed) return { success: true, migrated: false, reason: 'current' };

    await safelyMigrate(scope);
    return { success: true, migrated: true, reason: 'migrated' };
}

/**
 * Gets migration status info.
 * @param {{ kind: string, dbSuffix: string }} [scope] - Target scope. Defaults to the
 *   pre-namespace databases.
 * @returns {Promise<Object>} Status information
 */
export async function getMigrationStatus(scope = legacyScope()) {
    const currentVersion = await getStoreFor(StoreName.SETTINGS, scope).getItem(SCHEMA_VERSION_KEY);
    const atlas = await getStoreFor(StoreName.ATLAS, scope).getItem(ATLAS_RECORD_KEY);

    return {
        currentVersion,
        targetVersion: ATLAS_SCHEMA_VERSION,
        hasAtlas: !!atlas,
        atlasVersion: atlas?.schemaVersion || null
    };
}

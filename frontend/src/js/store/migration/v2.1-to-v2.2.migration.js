// Path: js/store/migration/v2.1-to-v2.2.migration.js

/**
 * @fileoverview Migration from v2.1 to v2.2 — Temporal Module.
 *
 * v2.2 introduces the temporal dimension: features may carry optional
 * `temporalInicio` / `temporalFim` (epoch ms) validity windows and, for
 * point / military_symbol / coordination_measure, an optional `trajetoria`
 * keypoint array. Per-map temporal config lives in appStore (`temporal_<map>`).
 *
 * All new fields are OPTIONAL and default to "permanent / no trajectory", so no
 * feature backfill is required — a feature without temporal data is shown at any
 * cursor. This migration therefore only stamps the new schema version, keeping
 * the version-detection chain consistent and old `.ebgeo` files loadable.
 */

import { ATLAS_RECORD_KEY, StoreName, getStoreFor } from '../atlas-namespace.js';
import { legacyScope } from './migration-scope.js';

/**
 * The version THIS step reaches — not the chain's final version. See the same constant in
 * `v1-to-v2.migration.js` and `v2-to-v2.1.migration.js`: a step that stamps
 * `ATLAS_SCHEMA_VERSION` marks the database fully migrated while later steps have not run,
 * and an interrupted chain then never resumes, without a single error.
 */
const TARGET_VERSION = '2.2';

// Resolved against the TARGET scope on every call, never a fixed database name.
const atlasStore = (scope) => getStoreFor(StoreName.ATLAS, scope);
const appStore = (scope) => getStoreFor(StoreName.SETTINGS, scope);

/**
 * Main migration function: v2.1 to v2.2.
 * @param {{ kind: string, dbSuffix: string }} [scope] - Target scope. Defaults to the
 *   pre-namespace databases.
 * @returns {Promise<{success: boolean}>}
 */
export async function migrateToV2_2(scope = legacyScope()) {
    console.log('Starting migration to v2.2 (Temporal Module)...');

    // Temporal fields are additive and optional — no per-feature backfill needed.
    // Stamp the new schema version on both the atlas and the app settings store.
    const atlas = await atlasStore(scope).getItem(ATLAS_RECORD_KEY);
    if (atlas) {
        atlas.schemaVersion = TARGET_VERSION;
        await atlasStore(scope).setItem(ATLAS_RECORD_KEY, atlas);
    }
    await appStore(scope).setItem('schemaVersion', TARGET_VERSION);

    console.log('Migration to v2.2 complete');
    return { success: true };
}

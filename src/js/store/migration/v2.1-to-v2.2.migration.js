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

import localforage from 'localforage';
import { ATLAS_SCHEMA_VERSION } from '../atlas/atlas.entity.js';

const atlasStore = localforage.createInstance({ name: 'ebgeo_atlas' });
const appStore = localforage.createInstance({ name: 'ebgeo_app_settings' });

/**
 * Main migration function: v2.1 to v2.2.
 * @returns {Promise<{success: boolean}>}
 */
export async function migrateToV2_2() {
    console.log('Starting migration to v2.2 (Temporal Module)...');

    // Temporal fields are additive and optional — no per-feature backfill needed.
    // Stamp the new schema version on both the atlas and the app settings store.
    const atlas = await atlasStore.getItem('current_atlas');
    if (atlas) {
        atlas.schemaVersion = ATLAS_SCHEMA_VERSION;
        await atlasStore.setItem('current_atlas', atlas);
    }
    await appStore.setItem('schemaVersion', ATLAS_SCHEMA_VERSION);

    console.log('Migration to v2.2 complete');
    return { success: true };
}

// Path: js/store/migration/v2.2-to-v2.3.migration.js

/**
 * @fileoverview Migration from v2.2 to v2.3 — Coordination Line.
 *
 * v2.3 adds the Coordination Line tool, whose features are stored in a
 * `coordination_lines` bucket alongside the other feature collections.
 *
 * A map created before the tool existed has no such key, and that is NOT
 * harmless. The layer setup builds the MapLibre source out of that collection, so
 * on a map without it the tool has no source to draw into: it activates, accepts
 * clicks and draws NOTHING, with no error and no log, because every write goes
 * through `getSource(...)?.setData` and the optional chaining swallows the
 * absence. Normalising the shape of stored data is this migration's job, not the
 * renderer's.
 *
 * Nothing is added to the features themselves. An empty bucket is the honest
 * reading of "this map has no coordination lines yet".
 */

import localforage from 'localforage';
import { ATLAS_SCHEMA_VERSION } from '../atlas/atlas.entity.js';

const mapStore = localforage.createInstance({ name: 'ebgeo_maps' });
const atlasStore = localforage.createInstance({ name: 'ebgeo_atlas' });
const appStore = localforage.createInstance({ name: 'ebgeo_app_settings' });

/** The feature collection v2.3 introduces. */
const BUCKET = 'coordination_lines';

/**
 * Bring one map's feature collection to the v2.3 shape.
 *
 * Returns null when there is nothing to do, which is what keeps the migration
 * from rewriting every map of every atlas on a bump that does not concern them.
 *
 * @param {Object} features - The map's feature collection
 * @returns {Object|null} New feature collection, or null when already in shape
 */
export function ensureCoordinationLines(features) {
    if (!features || typeof features !== 'object') return null;
    if (Array.isArray(features[BUCKET])) return null;

    return { ...features, [BUCKET]: [] };
}

/**
 * Main migration function: v2.2 to v2.3.
 * @returns {Promise<{success: boolean}>} Resolves once every map is in shape
 */
export async function migrateToV2_3() {
    console.log('Starting migration to v2.3 (Coordination Line)...');

    const mapNames = await mapStore.keys();
    console.log(`Found ${mapNames.length} maps to check`);

    for (const mapName of mapNames) {
        const mapData = await mapStore.getItem(mapName);
        if (!mapData?.features) continue;

        const updatedFeatures = ensureCoordinationLines(mapData.features);
        if (updatedFeatures) {
            await mapStore.setItem(mapName, { ...mapData, features: updatedFeatures });
            console.log(`Added the coordination lines collection to map: ${mapName}`);
        }
    }

    const atlas = await atlasStore.getItem('current_atlas');
    if (atlas) {
        atlas.schemaVersion = ATLAS_SCHEMA_VERSION;
        await atlasStore.setItem('current_atlas', atlas);
    }
    await appStore.setItem('schemaVersion', ATLAS_SCHEMA_VERSION);

    console.log('Migration to v2.3 complete');
    return { success: true };
}

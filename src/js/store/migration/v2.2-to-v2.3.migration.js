// Path: js/store/migration/v2.2-to-v2.3.migration.js

/**
 * @fileoverview Migration from v2.2 to v2.3 — Coordination Line.
 *
 * The military line tool shipped as "Linha de Barreiras", drawing one symbol
 * (MD33 290199), under the feature type `barrier_line` in the `barrier_lines`
 * bucket. It then generalised into "Linha de Coordenação", drawing any of the
 * MD33 linear symbols, so the type became `coordination_line` and the bucket
 * `coordination_lines`.
 *
 * This one is NOT additive, which is why it needs a real backfill rather than a
 * version stamp: a feature left under the old type would sit in a bucket nothing
 * reads, in a source nothing creates, and would simply vanish from the map
 * without an error. Every path that could reach it (the layer setup, the
 * selection registry, the exporters) is keyed by the new name.
 *
 * The symbol code is stamped as 290199 because that is the only symbol the old
 * tool could draw, so a migrated feature keeps drawing exactly what it drew.
 */

import localforage from 'localforage';
import { ATLAS_SCHEMA_VERSION } from '../atlas/atlas.entity.js';

const mapStore = localforage.createInstance({ name: 'ebgeo_maps' });
const atlasStore = localforage.createInstance({ name: 'ebgeo_atlas' });
const appStore = localforage.createInstance({ name: 'ebgeo_app_settings' });

/** The bucket, feature type and symbol code involved in the rename. */
const OLD_BUCKET = 'barrier_lines';
const NEW_BUCKET = 'coordination_lines';
const OLD_TYPE = 'barrier_line';
const NEW_TYPE = 'coordination_line';
const BARRIER_SYMBOL_CODE = '290199';

/**
 * Rewrite one feature from the old type to the new one.
 * @param {Object} feature - Stored GeoJSON feature
 * @returns {Object} A new feature carrying the new type and a symbol code
 */
function migrateFeature(feature) {
    const properties = { ...(feature?.properties || {}) };

    if (properties.source === OLD_TYPE) properties.source = NEW_TYPE;
    if (properties.type === OLD_TYPE) properties.type = NEW_TYPE;
    if (!properties.symbol_code) properties.symbol_code = BARRIER_SYMBOL_CODE;

    return { ...feature, properties };
}

/**
 * Bring one map's feature collection to the v2.3 shape.
 *
 * Does TWO things, and the second is the one that is easy to forget: it renames
 * the old bucket, AND it guarantees the new bucket EXISTS even on a map that
 * never had a barrier line to rename. A map created before the tool shipped has
 * neither key, and leaving it that way is not harmless: the layer setup would
 * have no collection to build a source from, and the tool would activate, accept
 * clicks and draw nothing. Normalising the shape is the migration's job, not the
 * renderer's.
 *
 * Merges rather than overwrites: a map touched by a newer build could already
 * carry `coordination_lines`, and dropping those would lose work that the
 * migration exists to protect.
 *
 * @param {Object} features - The map's feature collection
 * @returns {Object|null} New feature collection, or null when nothing changed
 */
export function migrateBarrierLines(features) {
    if (!features || typeof features !== 'object') return null;

    const legacy = features[OLD_BUCKET];
    const temLegado = OLD_BUCKET in features;
    const temNovo = Array.isArray(features[NEW_BUCKET]);

    // Nothing to rename and the bucket is already in shape: no write for this map.
    if (!temLegado && temNovo) return null;

    const { [OLD_BUCKET]: _legacy, ...rest } = features;
    const existente = Array.isArray(rest[NEW_BUCKET]) ? rest[NEW_BUCKET] : [];
    const migradas = Array.isArray(legacy) ? legacy.map(migrateFeature) : [];

    return { ...rest, [NEW_BUCKET]: [...existente, ...migradas] };
}

/**
 * Main migration function: v2.2 to v2.3.
 * @returns {Promise<{success: boolean}>} Resolves once every map is rewritten
 */
export async function migrateToV2_3() {
    console.log('Starting migration to v2.3 (Coordination Line)...');

    const mapNames = await mapStore.keys();
    console.log(`Found ${mapNames.length} maps to check`);

    for (const mapName of mapNames) {
        const mapData = await mapStore.getItem(mapName);
        if (!mapData?.features) continue;

        const updatedFeatures = migrateBarrierLines(mapData.features);
        if (updatedFeatures) {
            await mapStore.setItem(mapName, { ...mapData, features: updatedFeatures });
            console.log(`Migrated barrier lines to coordination lines in map: ${mapName}`);
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

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
 * AND IT ALSO ADOPTS THE v2.2 BUCKET, which this migration used to leave behind.
 * Before the Coordination Line there was the Barrier Line, drawing into
 * `barrier_lines` with `source: 'barrier_line'`; v2.3 generalised that tool into
 * one that picks any of the ten MD33 linear symbols from a combobox, and the
 * barrier line is `290199` of that catalogue. This migration added the new bucket
 * EMPTY and moved nothing, so those features have been sitting on disk and inside
 * every exported `.ebgeo` ever since, while `barrier_lines` appears nowhere in the
 * code of 2.3 or 2.4: no MapLibre source, no layer, no row in the feature tab, no
 * count. Measured on 2026-09-07 with a forged five-line fixture: 5 features in, 5
 * features out of the `.ebgeo`, 0 drawn. Not lost bytes, lost reach.
 *
 * Nothing is INVENTED. A feature only ever gains what the Coordination Line tool
 * would have given it by default, an empty bucket is the honest reading of "this
 * map has no coordination lines yet", and a coordination line that is already
 * there is neither reordered nor rewritten.
 */

import localforage from 'localforage';
import { ATLAS_SCHEMA_VERSION } from '../atlas/atlas.entity.js';

const mapStore = localforage.createInstance({ name: 'ebgeo_maps' });
const atlasStore = localforage.createInstance({ name: 'ebgeo_atlas' });
const appStore = localforage.createInstance({ name: 'ebgeo_app_settings' });

/** The feature collection v2.3 introduces. */
const BUCKET = 'coordination_lines';

/** The bucket the v2.2 Barrier Line tool drew into, and the `source` it stamped. */
const LEGACY_BARRIER_BUCKET = 'barrier_lines';
const LEGACY_BARRIER_SOURCE = 'barrier_line';

/** The `source` every feature in the surviving bucket carries. */
const COORDINATION_LINE_SOURCE = 'coordination_line';

/**
 * What a v2.2 Barrier Line is missing to be a Coordination Line, with the values
 * the new tool would have given it.
 *
 * COPIED from `AddCoordinationLineControl.DEFAULT_PROPERTIES` rather than
 * imported: this module runs in the boot chain, and importing the tool (or its
 * catalogue, which lives in the same folder) would drag `military_tools/` into the
 * boot chunk for five literals. A copy without a guard is a copy that goes stale,
 * so `tests/unit/coordination-line-migration.test.js` reads both sources and
 * compares them.
 *
 * The two tables differ by exactly ONE property, measured on 2026-09-07 against
 * `add_barrier_line_control.js:58` at `24b07975` and
 * `add_coordination_line_control.js:73` here: `symbol_code`, which v2.3 added
 * because its combobox picks one of the MD33 linear symbols. `290199` IS the
 * barrier line of that catalogue (a hollow diamond interrupting the line), and it
 * is also the new tool's own default, so a v2.2 feature that crosses over draws
 * exactly the symbol it was drawn as. Everything else is name-for-name identical,
 * the zoom contract included, which is why the size, the spacing and the anchor
 * cross UNTOUCHED instead of being recomputed.
 *
 * `calculatedLineWidth`, `calculatedSymbolSize` and `calculatedSymbolSpacing` are
 * absent on purpose: they are DERIVED, and `applyZoomCorrections` rewrites all
 * three on load.
 */
const COORDINATION_LINE_FALLBACKS = Object.freeze({
    symbol_code: '290199',
    symbol_size: 0.5,
    symbol_spacing: 1.5,
    createdAtZoom: 0,
    zoomCorrectionEnabled: true,
});

/**
 * Turn one v2.2 Barrier Line feature into the Coordination Line it became.
 *
 * WHY `baseCoordinates` IS RECOVERED HERE. The load path runs every stored line
 * through `applyZoomCorrections`, which REGENERATES the geometry from the
 * properties, and `generateCoordinationLineGeometry` with no usable
 * `baseCoordinates` returns `{ LineString, [[0, 0], [0, 0]] }`. So a feature that
 * reaches this bucket without them does not merely draw wrong: it leaves its own
 * place and lands on Null Island, which is worse than the bug this rename fixes.
 * The v2.2 tool always wrote them, so the hole is the hand-edited file (and the
 * forged fixture that found this), and the honest recovery is the feature's own
 * geometry — but ONLY when it is a LineString. A drawn barrier line is a
 * MultiLineString (the interrupted spine plus one ring per diamond) and its
 * authored spine cannot be read back out of it, so that case is left alone rather
 * than guessed at.
 *
 * @param {Object} feature - A feature from the legacy bucket
 * @returns {Object|null} The adopted feature, or null when there is no feature to adopt
 */
function adoptBarrierLine(feature) {
    if (!feature || typeof feature !== 'object') return null;

    const properties = { ...(feature.properties || {}) };

    properties.source = COORDINATION_LINE_SOURCE;
    // `properties.type` is stripped by `cleanFeature` on the way to storage, so it
    // survives only on a feature that never went through it. When it is there, it
    // follows `source`.
    if (properties.type === LEGACY_BARRIER_SOURCE) properties.type = COORDINATION_LINE_SOURCE;

    for (const [key, value] of Object.entries(COORDINATION_LINE_FALLBACKS)) {
        if (properties[key] === undefined || properties[key] === null) properties[key] = value;
    }

    const coordinates = feature.geometry?.type === 'LineString' ? feature.geometry.coordinates : null;
    if (properties.baseCoordinates == null && Array.isArray(coordinates) && coordinates.length >= 2) {
        properties.baseCoordinates = coordinates.map(position => [position[0], position[1]]);
    }

    return { ...feature, properties };
}

/**
 * Bring one map's feature collection to the v2.3 shape.
 *
 * The v2.2 bucket is EMPTIED into the surviving one, its features stamped with the
 * new `source` and with the MD33 code of the barrier line, and the key itself is
 * dropped. Dropping it is what makes the pass idempotent: a second run finds no
 * legacy key and answers null.
 *
 * Returns null when there is nothing to do, which is what keeps the migration
 * from rewriting every map of every atlas on a bump that does not concern them.
 *
 * @param {Object} features - The map's feature collection
 * @returns {Object|null} New feature collection, or null when already in shape
 */
export function ensureCoordinationLines(features) {
    if (!features || typeof features !== 'object') return null;

    const hasLegacyBucket = Object.prototype.hasOwnProperty.call(features, LEGACY_BARRIER_BUCKET);
    const hasBucket = Array.isArray(features[BUCKET]);
    if (hasBucket && !hasLegacyBucket) return null;

    const { [LEGACY_BARRIER_BUCKET]: legacy, ...rest } = features;
    const kept = hasBucket ? features[BUCKET] : [];
    // A legacy bucket that is not an array carries nothing recoverable, and dropping
    // the key is still right: it is the shape no reader in this line knows how to read.
    const adopted = Array.isArray(legacy) ? legacy.map(adoptBarrierLine).filter(Boolean) : [];

    return { ...rest, [BUCKET]: adopted.length ? [...kept, ...adopted] : kept };
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

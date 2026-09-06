// Path: js/store/migration/v2.3-to-v2.4.migration.js

/**
 * @fileoverview Migration from v2.3 to v2.4 — cropped symbol bitmaps.
 *
 * Until v2.4 a military symbol and a coordination measure were rasterized into a
 * SQUARE canvas, the drawing fitted and centred inside it. A frame wider than it is
 * tall therefore carried transparent bands above and below — a third of the bitmap
 * height for a friendly unit. That was invisible while the selection box was drawn
 * from the geometry, and became visible the moment the box and the click hit-test
 * became the bitmap rectangle: the box reads much larger than the drawing.
 *
 * The fix is in the rasterizer, so every bitmap already on disk is the wrong shape.
 * This migration regenerates them, writes the new blob under the feature id and
 * stamps `bitmapVersion` on the properties.
 *
 * It is DELIBERATELY forgiving. A feature whose symbol cannot be regenerated (a
 * catalog point that no longer exists, a corrupt property set, a blob the image
 * store refuses) is left alone and counted, and the schema version is NOT advanced
 * while any feature is left that way: the next startup runs this rung again and
 * retries only the unstamped ones. The damage of a stale bitmap is a box larger
 * than the drawing. The damage of throwing here is an application that refuses to
 * start, since `safelyMigrate` turns any error into a fatal "export your data and
 * clear local storage".
 */

import localforage from 'localforage';
import { ATLAS_SCHEMA_VERSION } from '../atlas/atlas.entity.js';
import { refreshStaleBitmaps } from './symbol-bitmap.refresh.js';

const mapStore = localforage.createInstance({ name: 'ebgeo_maps' });
const imageStore = localforage.createInstance({ name: 'ebgeo_images' });
const atlasStore = localforage.createInstance({ name: 'ebgeo_atlas' });
const appStore = localforage.createInstance({ name: 'ebgeo_app_settings' });

/**
 * Startups with bitmaps left stale after which the version is stamped anyway.
 * A feature nobody can regenerate any more (a catalog code that was retired) would
 * otherwise hold the schema at 2.3 forever, and every later rung with it.
 */
const MAX_FAILED_ATTEMPTS = 3;

/** App-settings key counting those startups; removed once the rung is stamped. */
const ATTEMPTS_KEY = 'bitmapRefreshAttempts';

/**
 * Main migration function: v2.3 to v2.4.
 * @returns {Promise<{success: boolean, updated: number, failed: number}>} Pass summary
 */
export async function migrateToV2_4() {
    console.log('Starting migration to v2.4 (cropped symbol bitmaps)...');

    const mapNames = await mapStore.keys();
    let totalUpdated = 0;
    let totalFailed = 0;

    for (const mapName of mapNames) {
        const mapData = await mapStore.getItem(mapName);
        if (!mapData?.features) continue;

        // The blob is written as soon as it exists rather than collected: an atlas
        // can hold thousands of symbols, and holding every PNG in memory until the
        // end of the map would be a needless peak.
        const { updated, failed } = await refreshStaleBitmaps(mapData.features, {
            onBlob: (id, blob) => imageStore.setItem(id, blob),
        });

        totalUpdated += updated;
        totalFailed += failed;

        // Only a map that actually changed is rewritten, so a bump that does not
        // concern an atlas does not rewrite every map in it.
        if (updated > 0) {
            await mapStore.setItem(mapName, mapData);
        }
    }

    // The version is stamped only when every bitmap made it. A feature left stale
    // is still unstamped, so leaving the schema at 2.3 makes the next startup run
    // this rung again and retry just those (the stamped ones are skipped by
    // `findStaleBitmapFeatures`). The app starts either way: a stale bitmap only
    // means a larger selection box until the retry succeeds. The retries are
    // bounded: after MAX_FAILED_ATTEMPTS startups the rung gives up and stamps,
    // so a symbol nobody can regenerate does not pin the schema forever.
    const attempts = totalFailed === 0
        ? 0
        : (Number(await appStore.getItem(ATTEMPTS_KEY)) || 0) + 1;
    const giveUp = totalFailed > 0 && attempts >= MAX_FAILED_ATTEMPTS;

    if (totalFailed === 0 || giveUp) {
        const atlas = await atlasStore.getItem('current_atlas');
        if (atlas) {
            atlas.schemaVersion = ATLAS_SCHEMA_VERSION;
            await atlasStore.setItem('current_atlas', atlas);
        }
        await appStore.setItem('schemaVersion', ATLAS_SCHEMA_VERSION);
        await appStore.removeItem(ATTEMPTS_KEY);

        if (giveUp) {
            console.warn(
                `Migration to v2.4 stamped with ${totalFailed} bitmap(s) still stale `
                + `after ${attempts} attempts; those features keep their old bitmap`
            );
        } else {
            console.info(`Migration to v2.4 complete: ${totalUpdated} bitmap(s) regenerated`);
        }
    } else {
        await appStore.setItem(ATTEMPTS_KEY, attempts);
        console.warn(
            `Migration to v2.4 incomplete: ${totalUpdated} bitmap(s) regenerated, `
            + `${totalFailed} left stale; it runs again at the next startup `
            + `(attempt ${attempts} of ${MAX_FAILED_ATTEMPTS})`
        );
    }

    return { success: totalFailed === 0, updated: totalUpdated, failed: totalFailed };
}

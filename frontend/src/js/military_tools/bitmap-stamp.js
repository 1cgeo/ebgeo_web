// Path: js/military_tools/bitmap-stamp.js

/**
 * @fileoverview After a symbol bitmap is regenerated, make everything that DESCRIBES that
 * bitmap agree with it: the feature object in hand, the live GeoJSON source, and the stored
 * feature document. In that order, and without authoring anything.
 *
 * WHY IT EXISTS AT ALL. The bitmap of a military symbol or a coordination measure is rebuilt
 * from the synced properties whenever the local blob is missing or predates the current
 * layout (`layers/layer_setup.js`, through `layers/image-regen-registry.js`). Version 2 of
 * that bitmap is CROPPED to the drawing and may carry an `iconOffset`, so its `width`,
 * `height` and offset differ from the version 1 blob the feature was saved with. Regenerate
 * without writing those derived keys and the map draws the new bitmap while the selection
 * box, the click hit-test and the attribute panel keep reading the old numbers.
 *
 * WHY IT IS NOT AN EDIT. The blob is a per-client cache by design (it is never uploaded), and
 * these keys only describe that cache. Nothing is authored and nothing is sent: the source is
 * patched through the diff dispatcher, and the stored copy through the store's silent write
 * (`stampGeneratedBitmap`), which logs no operation and leaves `version` and `updatedAt`
 * alone. On a SERVER atlas the next snapshot may overwrite the local stamp, and then the
 * regeneration recurs once per session until an authored edit stamps the feature for good.
 * That is the accepted price of not spending a schema version on it.
 *
 * WHY BOTH SYMBOL CONTROLS CALL THE SAME FUNCTION. They differ only by source id, and the
 * three writes have to stay consistent with each other: `applyGeneratedBitmap` and
 * `generatedBitmapPatch` are the same decision in two shapes (`layers/bitmap-version.js`),
 * and splitting the call sites is how one of them gets a key the other does not.
 */

import { applyGeneratedBitmap, generatedBitmapPatch } from '@layers/bitmap-version.js';
import { stampGeneratedBitmap } from '@store';

/**
 * Writes a generator result into the feature in hand, the live source and the store.
 *
 * The source write goes through the diff dispatcher, never a raw `setData`: a raw write
 * issued while a diff is queued replaces MapLibre's pending-update slot and the queued diff
 * disappears with no error at all. During the BOOT pass the source does not exist yet, and
 * the dispatcher documents that case as stale-not-lost (it destroys itself, and the layer
 * setup that follows writes the whole collection); the mutation of `feature.properties` above
 * is what carries the new keys into that collection.
 *
 * TAKES THE DISPATCHER, not the map plus a source name, and that is not a style choice: the
 * structural guard `frontend/tests/unit/despachante-sem-escrita-crua.test.js` derives its
 * inventory of dispatched sources from LITERAL `getGeoJsonDispatcher` call sites, and a
 * dispatcher built here from a variable id would be a declared blind spot in it. Each control
 * already owns exactly one such literal site (`militarySymbolsSource` /
 * `coordinationMeasuresSource`), so handing the dispatcher in costs nothing and keeps the
 * inventory honest.
 *
 * @param {Object} dispatcher - The diff dispatcher owning this feature's source
 * @param {Object} feature - The regenerated feature (mutated)
 * @param {Object} result - Generator result { width, height, pixelRatio?, anchor?, iconOffset? }
 * @returns {Promise<void>} Resolves once the source settled and the store was written
 */
export async function stampRegeneratedBitmap(dispatcher, feature, result) {
    if (!dispatcher || !feature?.properties?.id || !result) return;

    applyGeneratedBitmap(feature.properties, result);

    const { setProps, unsetProps } = generatedBitmapPatch(result);
    dispatcher.patch(feature.properties.id, { setProps, unsetProps });
    await dispatcher.flush();

    await stampGeneratedBitmap(feature, result);
}

// Path: js/store/atlas-contents.js

/**
 * @module store/atlas-contents
 * @description How much there is inside an atlas scope, WITHOUT mounting it, and how to SAY it:
 * the three numbers a destructive dialog needs in order to name what it is about to destroy, plus
 * the one pt-BR rendering of them.
 *
 * WHY IT EXISTS. Two dialogs in this product empty or drop every database of an atlas, and until
 * now both described the loss in the abstract ("os mapas, feições e imagens deste atlas"), which is
 * the same sentence for a slot created a minute ago and for one holding an entire acquis. The
 * sentence cannot improve without a count, and the count cannot come from the mounted store: the
 * chooser page (`atlas.html`) boots without `initServices()`, and the card being deleted is often
 * NOT the mounted slot.
 *
 * SO IT READS BY EXPLICIT SCOPE, exactly like `projects/send-local-to-server.service.js` does for
 * the send-to-server path, and for the same reason stated there: `getStoreFor(storeId, scope)` is
 * already the way this codebase reads another namespace (`copyAtlasDatabases` does it database by
 * database). It never calls `activateScope`, so it takes no mount lock and moves no pointer, and it
 * only ever calls `iterate` and `keys` — nothing here writes.
 *
 * IT IS A SECOND READER OF THE DISK FORMAT, and the price is the one the send-to-server module
 * spells out: a change to how a map document stores its features has to reach here too. The
 * exposure is small on purpose (one key shape, `features` as an object of arrays) and the failure
 * is a number that drifts, never a lost byte.
 *
 * "I DO NOT KNOW" IS A RESULT, AND IT IS NOT ZERO. An unreadable maps database returns `null`, and
 * the caller degrades to the sentence that carries no numbers. Reporting zero there would let a
 * dialog announce "this atlas is empty" over a full one, which is the tela-que-mente failure the
 * whole change exists to remove.
 */

import { StoreName, getStoreFor } from './atlas-namespace.js';

/**
 * @typedef {Object} AtlasContents
 * @property {number} maps - Map documents in the scope.
 * @property {number} features - Features summed across every bucket of every map.
 * @property {number} images - Image blobs stored in the scope.
 */

/**
 * Counts what an atlas scope holds.
 *
 * The image count is by KEYS, never by value: the blobs are the heaviest thing in the namespace
 * (megabytes), and the dialog needs how many, not what.
 *
 * @param {{kind: string, atlasId: string|null, dbSuffix: string}|null} scope - The slot's scope,
 *   from `scopeOfLocalAtlas(entry)` or `getActiveScope()`.
 * @returns {Promise<AtlasContents|null>} The counts, or `null` when the maps database could not be
 *   read (unknown, which a caller must not render as zero).
 */
export async function countAtlasContents(scope) {
    if (!scope) return null;

    let maps = 0;
    let features = 0;
    try {
        // One pass over the database, like `copyAtlasDatabases`: `keys()` plus N `getItem` would
        // read every document twice.
        await getStoreFor(StoreName.MAPS, scope).iterate((value) => {
            if (!value || typeof value !== 'object') return;
            maps += 1;
            const buckets = value.features;
            if (!buckets || typeof buckets !== 'object') return;
            for (const bucket of Object.values(buckets)) {
                if (Array.isArray(bucket)) features += bucket.length;
            }
        });
    } catch (error) {
        console.warn('[atlas-contents] could not read the maps of this atlas:', error);
        return null;
    }

    // The images are counted SEPARATELY and degrade on their own: a missing image database is the
    // ordinary state of an atlas that never held a photo, and it must not cost the two numbers
    // that were already read.
    let images = 0;
    try {
        const keys = await getStoreFor(StoreName.IMAGES, scope).keys();
        images = Array.isArray(keys) ? keys.length : 0;
    } catch (error) {
        console.warn('[atlas-contents] could not read the images of this atlas:', error);
        images = 0;
    }

    return { maps, features, images };
}

/**
 * A count that only reaches a sentence when it is a real positive number.
 * @param {*} value
 * @returns {number} The integer, or zero.
 */
function positiveCount(value) {
    return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

/**
 * The loss, one pt-BR line per section the atlas actually has.
 *
 * ONE RENDERING FOR TWO DIALOGS. Deleting a local atlas (`projects/local-atlas-notices.js`) and
 * replacing the mounted one with a dropped `.ebgeo` (`import_export/drag-drop.handler.js`) destroy
 * the same thing and must not describe it in two different vocabularies, nor pluralise it twice.
 *
 * AN EMPTY SECTION IS NOT A LINE. "0 imagens" takes the same height on screen as "149 imagens" and
 * helps nobody decide; what decides is what exists.
 *
 * THE OUTLINE OF "EMPTY" INCLUDES ONE MAP WITH NOTHING IN IT, and that is the common case: the
 * repository initialisation writes a blank `Principal` into every freshly created slot, so "1 map,
 * 0 features, 0 images" is the shape of an atlas nobody has drawn in. Counting it would make the
 * long sentence the default and the short one the exception, inverting the signal it exists to
 * give. An unknown count (`null`, the failed read) is empty here for the same reason: not knowing
 * how much there is never authorises stating how much there is.
 *
 * @param {AtlasContents|null} [contents]
 * @returns {string[]} Empty when there is nothing worth announcing.
 */
export function atlasContentsLines(contents) {
    const maps = positiveCount(contents?.maps);
    const features = positiveCount(contents?.features);
    const images = positiveCount(contents?.images);

    if (features === 0 && images === 0 && maps <= 1) return [];

    const linhas = [];
    if (maps > 0) linhas.push(`${maps} ${maps === 1 ? 'mapa' : 'mapas'}`);
    if (features > 0) linhas.push(`${features} ${features === 1 ? 'feição' : 'feições'}`);
    if (images > 0) linhas.push(`${images} ${images === 1 ? 'imagem' : 'imagens'}`);
    return linhas;
}

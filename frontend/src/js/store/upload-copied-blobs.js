// Path: js/store/upload-copied-blobs.js

/**
 * @fileoverview Sends freshly minted image blobs to the server, when the mounted atlas is a
 * SERVER atlas. One helper for every gesture that COPIES a feature that owns a blob.
 *
 * WHY IT EXISTS AT ALL. `storeImage` writes to the LOCAL blob store and uploads nothing, and
 * there is no incremental sync op for an image: the op vocabulary carries features, maps,
 * layers, groups and the rest, never bytes. So every gesture that mints a NEW feature id for
 * an EXISTING picture (paste, "Colar Aqui", "Duplicar Seleção", copying a layer to another
 * map) produced, in a server atlas, a feature pointing at an id the server had never heard
 * of. The collaborator received the feature and an empty frame: `getImage` misses locally,
 * falls back to the backend, gets a 404, and the loader installs the error placeholder. No
 * error is raised anywhere, on either side.
 *
 * THE BULK ROUTE IS THE ONLY PATH THAT CAN CLAIM A CHOSEN ID. `POST /atlas/:atlasId/images/bulk`
 * preserves `localId` as the row id on the first occurrence, which is what lets the blob land
 * under the id the feature already carries (guard:
 * `frontend/tests/e2e/bulk-image-preserve-id.e2e.test.js`). The single-image route mints its
 * own id and would need the feature rewritten around it.
 *
 * IT MUST RUN BEFORE THE FEATURE OPS ARE LOGGED. The outbound flush leaves every 1.5 s, so a
 * feature op that reached a peer ahead of its blob renders as a hole until something re-reads
 * the image. Every caller therefore uploads first and writes the features afterwards.
 *
 * WHAT DOES NOT COME THROUGH HERE, and it is the other half of the rule: the three families
 * whose raster is REGENERATED from the feature's own synced properties (military symbol,
 * coordination measure, magnetic declination). Their PNG is drawn on the client and never
 * uploaded, by design, and the peer rebuilds it through `layers/image-regen-registry.js`.
 * Uploading them would be dead weight on every paste and would make the 404 fallback, which
 * is their normal path, look like a defect. The caller decides which ids are regenerable; a
 * closed list of types written here would be the fourth copy of a list that already drifted.
 *
 * BEST-EFFORT, AND THE ASYMMETRY IS DELIBERATE: a failed upload costs a picture, while
 * aborting would cost the whole gesture. Nothing here throws.
 *
 * `import_export/atlas-image-upload.js` is reached by a DYNAMIC import so the store's static
 * graph does not grow an edge into the lazy import/export chunk group.
 */

import { getImage } from './settings.operations.js';
import { isRemoteStoreSync } from './store-origin.js';
import { apiClient, syncEngine } from './sync/index.js';

/**
 * @typedef {Object} CopiedBlobUploadResult
 * @property {string[]} uploaded - Ids the server accepted
 * @property {Array<Object>} failed - Per-id refusals reported by the server (`{localId, error}`)
 * @property {string[]} skipped - Ids left out BEFORE the request, for either of two reasons:
 *   no blob was found under the id (the duplication that should have written it failed, or
 *   something released it in between), or the mime type is outside the server allowlist, such
 *   as an SVG custom icon. Both are reported rather than dropped: an id that silently vanishes
 *   here is a feature that will render as a hole on the peer, which is the exact defect this
 *   module exists to close
 */

/**
 * @returns {CopiedBlobUploadResult} A fresh empty result (never a shared frozen one, so a
 *   caller that mutates what it got cannot poison the next call).
 */
function nothingUploaded() {
    return { uploaded: [], failed: [], skipped: [] };
}

/**
 * Uploads the blobs stored under `newIds`, but only in a server atlas.
 *
 * THE REMOTE GATE IS INSIDE, before the blobs are read: in a local atlas this costs zero
 * IndexedDB reads, which is what lets every caller call it unconditionally instead of
 * repeating the `isRemoteStoreSync()` question and drifting on the answer.
 *
 * @param {Iterable<string>} newIds - Ids the copy just minted; the blob is expected to be in
 *   the local store already (the caller duplicated it there).
 * @param {Object} [options] - Options
 * @param {string} [options.context] - Prefix for the console warnings, so a report names the
 *   gesture that produced it ('paste', 'transferLayerToMap', ...)
 * @returns {Promise<CopiedBlobUploadResult>} What travelled. Empty in a local atlas, with no
 *   atlas connected, and on any failure: this never throws and never blocks the gesture.
 */
export async function uploadCopiedBlobsIfRemote(newIds, { context = 'uploadCopiedBlobs' } = {}) {
    const ids = [...new Set([...(newIds || [])].filter(Boolean))];
    if (ids.length === 0) return nothingUploaded();
    if (!isRemoteStoreSync()) return nothingUploaded();

    const atlasId = syncEngine?.atlasId;
    if (!atlasId) return nothingUploaded();

    try {
        const { buildImageUploads, uploadImagesInChunks } =
            await import('@js/import_export/atlas-image-upload.js');

        // An id with no blob under it is REPORTED, never dropped: it means the local
        // duplication did not land, and the feature it belongs to will render as a hole on the
        // peer. Dropping it here would hide exactly the failure this module exists to close.
        const blobs = [];
        const semBlob = [];
        for (const id of ids) {
            const blob = await getImage(id);
            if (blob) blobs.push([id, blob]);
            else semBlob.push(id);
        }
        if (blobs.length === 0) return { uploaded: [], failed: [], skipped: semBlob };

        const { uploads, skipped } = await buildImageUploads(blobs);
        const deixadosDeFora = [...semBlob, ...skipped];
        if (uploads.length === 0) return { uploaded: [], failed: [], skipped: deixadosDeFora };

        const { failed } = await uploadImagesInChunks(apiClient, atlasId, uploads);
        const refused = new Set(failed.map(item => item?.localId));
        const uploaded = uploads.map(item => item.localId).filter(id => !refused.has(id));

        if (failed.length > 0) {
            console.warn(`${context}: ${failed.length} image blob(s) refused by the server`);
        }
        return { uploaded, failed, skipped: deixadosDeFora };
    } catch (error) {
        console.warn(`${context}: image blobs could not be uploaded:`, error);
        return nothingUploaded();
    }
}

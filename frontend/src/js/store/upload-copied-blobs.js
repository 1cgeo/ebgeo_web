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
 * IT NO LONGER SWALLOWS THE FAILURE, and that is the change of B8. The gesture still cannot be
 * aborted by a network error (a failed upload costs a picture, aborting would cost the whole
 * paste), so nothing here throws; what changed is that the attempt is now REGISTERED in the
 * durable blob queue (`sync/blob-upload-queue.js`) before the first byte leaves. A chunk that does
 * not land stays a pendency instead of a `console.warn` nobody reads, and the same resumption that
 * serves the drawing tool retries it on the next reconnection, under the SAME id.
 *
 * The transport moved with it: the queue is what talks to `import_export/atlas-image-upload.js`
 * now, by a DYNAMIC import, for the reason this module used to state here — the store's static
 * graph must not grow an edge into the lazy import/export chunk group.
 */

import { getImage } from './settings.operations.js';
import { isRemoteStoreSync } from './store-origin.js';
import { syncEngine } from './sync/index.js';
import { enfileirarBlobs } from './sync/blob-upload-queue.js';

/**
 * @typedef {Object} CopiedBlobUploadResult
 * @property {string[]} uploaded - Ids the server accepted
 * @property {Array<Object>} failed - Per-id DEFINITIVE refusals (`{localId, error}`), in the shape
 *   the server produces. A refusal here is one no retry repairs: format outside the allowlist,
 *   size, an id already taken by other bytes
 * @property {string[]} pending - Ids whose transfer did not land for a TRANSIENT reason and are now
 *   a durable pendency: the queue retries them on the next reconnection, under the same id. They
 *   used to be indistinguishable from `failed`, which is why a network hiccup during a paste read
 *   as a permanent refusal and nothing ever tried again
 * @property {string[]} skipped - Ids left out BEFORE anything was registered, because no blob was
 *   found under the id (the duplication that should have written it failed, or something released
 *   it in between). Reported rather than dropped: an id that silently vanishes here is a feature
 *   that will render as a hole on the peer, which is the exact defect this module exists to close.
 *   It is the one outcome that cannot become a pendency, because there are no bytes to retry. A
 *   mime type outside the server allowlist is NOT here any more: it is a definitive refusal, and
 *   the queue records it as one
 */

/**
 * @returns {CopiedBlobUploadResult} A fresh empty result (never a shared frozen one, so a
 *   caller that mutates what it got cannot poison the next call).
 */
function nothingUploaded() {
    return { uploaded: [], failed: [], pending: [], skipped: [] };
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
        // An id with no blob under it is REPORTED, never dropped: it means the local
        // duplication did not land, and the feature it belongs to will render as a hole on the
        // peer. Dropping it here would hide exactly the failure this module exists to close.
        const pares = [];
        const semBlob = [];
        for (const id of ids) {
            const blob = await getImage(id);
            if (blob) pares.push([id, blob]);
            else semBlob.push(id);
        }
        if (pares.length === 0) {
            return { uploaded: [], failed: [], pending: [], skipped: semBlob };
        }

        const resultado = await enfileirarBlobs(pares, { atlasId, origem: context });

        if (resultado.recusados.length > 0) {
            console.warn(`${context}: ${resultado.recusados.length} image blob(s) refused by the server`);
        }
        if (resultado.pendentes.length > 0) {
            // NOT a warning shaped like a refusal, because this one is queued. Saying which it is
            // keeps the next reader from treating a reconnection away from repair as a lost picture.
            console.info(`${context}: ${resultado.pendentes.length} image blob(s) queued for retry`);
        }
        return {
            uploaded: resultado.confirmados,
            failed: resultado.recusados.map(item => ({ localId: item.imageId, error: item.motivo })),
            pending: resultado.pendentes,
            skipped: semBlob
        };
    } catch (error) {
        console.warn(`${context}: image blobs could not be uploaded:`, error);
        return nothingUploaded();
    }
}

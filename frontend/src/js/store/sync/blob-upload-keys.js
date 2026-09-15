// Path: js/store/sync/blob-upload-keys.js

/**
 * @fileoverview What a reader of the atlas IMAGES store needs to know about the blob-upload
 * pendencies living inside it, in a leaf with ZERO imports.
 *
 * The pendency records of `blob-upload-queue.js` live inside the atlas IMAGES store, so every
 * reader that COUNTS keys in that database has to know how to tell a pendency from a picture. One
 * of those readers is `store/atlas-contents.js`, which is reached by `atlas.html`, a page that
 * boots with no store and no services. Importing the queue from there would drag the outbound
 * queue, its journal and the HTTP client onto that page for the sake of one string.
 *
 * A COPIED STRING WAS THE OTHER OPTION and it is the one that rots: the day the prefix changes,
 * the counter goes on filtering the old one and starts counting pendencies as images, with nothing
 * red anywhere. One definition, three importers, no graph.
 *
 * THE THIRD IMPORTER IS THE WIPE, and it is here for the same reason: `repository.js` has to empty
 * the IMAGES store while SPARING the bytes the server has not received, and it must do that
 * without importing the queue (whose graph carries the HTTP client). See
 * {@link limparImagensPoupandoUploads} for what that sparing is and why it is not "always".
 */

/** Prefix of every pendency key inside the atlas IMAGES store. */
export const BLOB_UPLOAD_KEY_PREFIX = 'upload_pendente__';

/**
 * State of a pendency whose bytes the server does not have yet.
 *
 * It is DEFINED HERE and re-exported by `blob-upload-queue.js` as `BlobUploadState.PENDENTE`: the
 * wipe below has to recognise the state, and a second literal would be the same rot as a copied
 * prefix, one indirection away.
 */
export const BLOB_UPLOAD_PENDENTE = 'pendente';

/**
 * Empties the IMAGES store of one scope, KEEPING the uploads the server has not received and the
 * bytes those uploads name.
 *
 * WHY THE WIPE HAS TO SPARE ANYTHING AT ALL. The entry wipe of a server atlas
 * (`openRemoteAtlas` → `clearAllDataStore`) empties the ten data databases and then pulls the
 * server's snapshot back: everything it destroys is re-fetchable, which is what makes it safe. A
 * blob whose upload is still pending is the one thing in that database that is NOT re-fetchable,
 * because the server never received it. Until this existed, an F5 in the window between a failed
 * upload and its resumption destroyed the pendency AND the bytes, so the resumption that
 * `connect` runs found nothing to resume; and because the feature's operation stays PREPARED
 * while its blob is pending, and that hold is head-of-line, the atlas's whole outbound queue
 * stopped for good, with nothing red anywhere. Measured in
 * `frontend/tests/e2e-ui/browser-collab-imagem-retomada.spec.js`.
 *
 * WHY NOT ALWAYS, AND WHAT DECIDES. The caller passes the same answer it already gives for the
 * OUTBOUND QUEUE (`clearQueue`, `store.js`), because a pending blob is the payload of an
 * operation in that queue and the two have one lifetime. A wipe that ENDS in a blank local store
 * abandons the operations it wiped, so keeping their bytes would leave debt nobody will ever
 * collect; a wipe that mounts a REMOTE atlas one line later is the one this sparing is for.
 *
 * IT FALLS BACK TO `clear()` WHEN THERE IS NOTHING TO SPARE, which is the ordinary case: the
 * per-key removal below is paid only by the session that actually has an upload waiting.
 *
 * @param {{keys: Function, getItem: Function, removeItem: Function, clear: Function}} store - The
 *   IMAGES store of the scope being emptied.
 * @returns {Promise<number>} How many keys were spared (pendency records plus their blobs).
 */
export async function limparImagensPoupandoUploads(store) {
    const chaves = await store.keys();
    const poupadas = new Set();
    for (const chave of chaves) {
        if (!String(chave).startsWith(BLOB_UPLOAD_KEY_PREFIX)) continue;
        let registro = null;
        try {
            registro = await store.getItem(chave);
        } catch {
            // An unreadable record cannot name bytes to spare, and the wipe must not stop for it.
            registro = null;
        }
        if (!registro || registro.estado !== BLOB_UPLOAD_PENDENTE) continue;
        poupadas.add(chave);
        if (typeof registro.imageId === 'string') poupadas.add(registro.imageId);
    }

    if (poupadas.size === 0) {
        await store.clear();
        return 0;
    }
    for (const chave of chaves) {
        if (poupadas.has(chave)) continue;
        await store.removeItem(chave);
    }
    return poupadas.size;
}

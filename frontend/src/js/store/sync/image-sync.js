// Path: js/store/sync/image-sync.js

/**
 * @fileoverview Backend image gateway for multiuser image resources (§17.14 feature
 * photos / §17.19 custom marker icons).
 *
 * When the project is online, user-uploaded image blobs must live on the backend so
 * collaborators can fetch them: the feature references the blob by id, and a peer that
 * lacks the bytes locally fetches them by that id. This module is a thin,
 * dependency-light seam over {@link apiClient} — it imports no store/sync graph beyond
 * the blob queue, so it can be used from `customIcons.operations` and the image-feature
 * path without import cycles. The connected atlas id is injected by `sync-engine` via
 * {@link setImageSyncAtlas}.
 *
 * THE ID IS THE CLIENT'S NOW, AND THAT IS THE WHOLE CHANGE. This seam used to upload
 * through the single-image route, take the id the SERVER minted, and, when the upload
 * failed, hand the caller a local id instead — a reference no collaborator could ever
 * resolve, with a toast telling the person to insert the picture again. Nothing retried.
 * The transfer now goes through `blob-upload-queue.js`, which registers a durable
 * pendency before the first byte leaves and sends by the BULK route, the only one that
 * keeps the id: the caller therefore mints the id and keeps it in every outcome, and a
 * retry lands the bytes under that same id instead of producing a third one.
 *
 * WHAT THE CALLERS STILL HAVE TO DO. The upload no longer decides the id, so there is
 * nothing to fall back FROM; what they read is whether the bytes are confirmed, which is
 * what {@link uploadImageBlob} answers. While they are not, the feature's operation stays
 * held by the queue (see that module's fileoverview), so nothing reaches a peer ahead of
 * its bytes.
 *
 * THIS MODULE NO LONGER WRITES A SENTENCE. It used to own `imageUploadFailureNotice`, a
 * second wording of the same failure the queue had already worded, and it called it with
 * `{ message: resultado.motivo }` — an object whose only field that function never read,
 * because it branched on `status` alone. The result was the worst of both: the sentence
 * composed by `blob-upload-phrases.js` (which knows the cause, quotes the server and
 * separates a size refusal from a permission refusal) was discarded, and the generic
 * branch was printed every time, with the 403 and 413 branches unreachable from here.
 * The toast now shows the verdict's own `motivo`, the same string the pendency panel
 * renders for that record, and the phrases live in one place.
 */

import { apiClient } from './api-client.js';
import { showWarning } from '@utils/toast_service.js';
import { connectionState, ConnectionStates } from './connection-state.js';
import {
    enfileirarBlob,
    retomarBlobsPendentes,
    esquecerPendenciasEmMemoria
} from './blob-upload-queue.js';
import { fraseDeFalhaDeBlob } from './blob-upload-phrases.js';

/** @type {string|null} The connected atlas id (null when offline). */
let _atlasId = null;

/** @type {Function|null} Unsubscribe of the connection listener, so it is installed once. */
let _pararDeOuvir = null;

/**
 * Installs the reconnection trigger, once.
 *
 * IT LISTENS TO `connectionState` AND NOT TO THE EVENT BUS on purpose: this seam is reachable from
 * pages that never call `initServices()`, and the singleton is the same source the bus event is
 * bridged from (`event-bridges.js`), one hop earlier. Reaching ONLINE is the only transition that
 * can carry a blob, and the resumption is fire-and-forget: it must never delay the connection.
 * @returns {void}
 */
function ouvirReconexao() {
    if (_pararDeOuvir) return;
    _pararDeOuvir = connectionState.onStateChanged(({ currentState }) => {
        if (currentState !== ConnectionStates.ONLINE || !_atlasId) return;
        retomarBlobsPendentes(_atlasId).catch(() => {
            // Best effort: the pendency stays on disk and the next reconnection tries again.
        });
    });
}

/**
 * Sets (or clears) the connected atlas id. Called by the sync engine on
 * connect/disconnect. Passing a falsy value disables backend image sync.
 *
 * CONNECTING IS ALSO A RESUMPTION POINT, and it is the one that covers F5: after a reload the
 * pendencies are on disk and nothing else would ever look at them. The in-memory mirror of held
 * ids is dropped on disconnect, because it describes a scope that is no longer mounted.
 * @param {string|null} atlasId
 * @returns {void}
 */
export function setImageSyncAtlas(atlasId) {
    _atlasId = atlasId || null;
    if (!_atlasId) {
        esquecerPendenciasEmMemoria();
        return;
    }
    ouvirReconexao();
    retomarBlobsPendentes(_atlasId).catch(() => {
        // Best effort: connecting must not fail because an old blob still cannot be sent.
    });
}

/** @returns {boolean} Whether backend image sync is currently available. */
export function isImageSyncOnline() {
    return _atlasId !== null;
}

/**
 * Sends an image blob to the backend under the id the caller chose.
 *
 * @param {Blob} blob - The bytes. The caller must have written them locally already.
 * @param {string} imageId - The id the feature or the icon registry carries.
 * @param {Object} [options] - Options.
 * @param {string} [options.origem='imagem'] - Label recorded on the pendency.
 * @returns {Promise<{confirmado: boolean, registrado: boolean, estado: string|null}>} Whether the
 *   server holds the bytes. In a local atlas nothing is registered and nothing is sent, which is
 *   not a failure and says nothing to the user.
 */
export async function uploadImageBlob(blob, imageId, { origem = 'imagem' } = {}) {
    if (!_atlasId || !blob || !imageId) {
        return { confirmado: false, registrado: false, estado: null };
    }

    const resultado = await enfileirarBlob({ imageId, blob, atlasId: _atlasId, origem });
    if (resultado.confirmado || !resultado.registrado) {
        return {
            confirmado: resultado.confirmado,
            registrado: resultado.registrado,
            estado: resultado.estado
        };
    }

    try {
        // THE VERDICT ALREADY CARRIES THE SENTENCE, and composing a second one here is what this
        // line used to do wrong: it called `imageUploadFailureNotice({ message: resultado.motivo })`
        // over a function that read only `status`, so the composed sentence was dropped and a
        // generic one was printed instead. The fallback is for the one path that produces no
        // sentence: a record whose OUTCOME could not be written to disk (`assentar` returns the
        // untouched record), which is transient and resumed like any other pendency.
        showWarning(resultado.motivo || fraseDeFalhaDeBlob({}), { duration: 8000 });
    } catch {
        // Headless (tests, worker): no UI to tell.
    }
    return { confirmado: false, registrado: true, estado: resultado.estado };
}

/**
 * Fetches an image blob from the backend by id (best-effort). Returns null when
 * offline or on any error, so the renderer degrades to "no image" rather than throw.
 * @param {string} imageId
 * @returns {Promise<Blob|null>}
 */
export async function fetchImageBlob(imageId) {
    if (!_atlasId || !imageId) return null;
    try {
        return await apiClient.fetchImageBlob(_atlasId, imageId);
    } catch {
        return null;
    }
}

// Path: js/store/sync/image-sync.js

/**
 * @fileoverview Backend image gateway for multiuser image resources (§17.14 feature
 * photos / §17.19 custom marker icons).
 *
 * When the project is online, user-uploaded image blobs must live on the backend so
 * collaborators can fetch them: the upload returns an id that the feature references
 * (e.g. `markerSymbol`/`photoId`), and a peer that lacks the blob locally fetches it
 * by that id. This module is a thin, dependency-light seam over {@link apiClient} —
 * it imports no store/sync graph, so it can be used from `customIcons.operations`
 * and the image-feature path without import cycles. The connected atlas id is
 * injected by `sync-engine` via {@link setImageSyncAtlas}.
 *
 * OFFLINE and FAILED are NOT the same outcome, and returning `null` for both is
 * what made the second one invisible: with no atlas connected a local id is the
 * correct answer, but with an atlas connected a failed upload leaves the feature
 * pointing at an id that exists only on this machine — every collaborator
 * resolves it to nothing. The failed case now says so (see
 * {@link imageUploadFailureNotice}). The toast module is DOM-only, so importing
 * it keeps this seam free of the store/sync graph.
 */

import { apiClient } from './api-client.js';
import { showWarning } from '@utils/toast_service.js';

/** @type {string|null} The connected atlas id (null when offline). */
let _atlasId = null;

/**
 * Sets (or clears) the connected atlas id. Called by the sync engine on
 * connect/disconnect. Passing a falsy value disables backend image sync.
 * @param {string|null} atlasId
 * @returns {void}
 */
export function setImageSyncAtlas(atlasId) {
    _atlasId = atlasId || null;
}

/** @returns {boolean} Whether backend image sync is currently available. */
export function isImageSyncOnline() {
    return _atlasId !== null;
}

/**
 * What to tell the user when an upload fails WITH an atlas connected. Pure: no
 * I/O, no module state, so the wording rules are testable in node.
 *
 * There is no retry queue for image blobs, so the honest thing is to name the
 * consequence (the image is local-only) instead of failing silently.
 * @param {*} error - The error thrown by `apiClient.uploadImage` (ApiError carries `status`).
 * @returns {string} A pt-BR message for the user.
 */
export function imageUploadFailureNotice(error) {
    const status = error?.status ?? error?.statusCode;
    if (status === 403) {
        return 'Você não tem permissão para enviar imagens neste atlas: a imagem ficará visível '
            + 'apenas para você.';
    }
    if (status === 413) {
        return 'A imagem é grande demais para o servidor: ela ficará visível apenas para você. '
            + 'Reduza o arquivo e insira novamente.';
    }
    return 'A imagem não foi enviada ao servidor e ficará visível apenas para você. Refaça a '
        + 'inserção quando a conexão voltar.';
}

/**
 * Uploads an image blob to the backend (best-effort). Returns the created image
 * record ({ id, ... }) when online and the upload succeeds, else null — callers
 * fall back to a local-only id.
 *
 * The two `null`s mean different things: no connected atlas is the normal offline
 * path (silent, the local id is correct), while a FAILED upload on a connected
 * atlas produces a reference no collaborator can resolve — that one warns.
 * @param {Blob} blob
 * @param {string} [filename='image.png']
 * @returns {Promise<Object|null>}
 */
export async function uploadImageBlob(blob, filename = 'image.png') {
    if (!_atlasId || !blob) return null;
    try {
        return await apiClient.uploadImage(_atlasId, blob, filename);
    } catch (error) {
        try {
            showWarning(imageUploadFailureNotice(error), { duration: 8000 });
        } catch {
            // Headless (tests, worker): no UI to tell.
        }
        return null;
    }
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

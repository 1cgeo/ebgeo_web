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
 */

import { apiClient } from './api-client.js';

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
 * Uploads an image blob to the backend (best-effort). Returns the created image
 * record ({ id, ... }) when online and the upload succeeds, else null — callers
 * fall back to a local-only id.
 * @param {Blob} blob
 * @param {string} [filename='image.png']
 * @returns {Promise<Object|null>}
 */
export async function uploadImageBlob(blob, filename = 'image.png') {
    if (!_atlasId || !blob) return null;
    try {
        return await apiClient.uploadImage(_atlasId, blob, filename);
    } catch {
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

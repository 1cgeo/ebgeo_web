// Path: js/import_export/atlas-image-upload.js

/**
 * @fileoverview Uploading image blobs into a server atlas — the half of "package an atlas for the
 * server" that does NOT read the local store.
 *
 * It was extracted from `save-local-atlas.service.js` when the project chooser page gained
 * "Importar .ebgeo": that page builds the same upload from blobs inside a ZIP, and it boots without
 * `@store`. Importing the original module there would have dragged the whole store onto a page that
 * has no map. Keep this file store-free — that property is the reason it exists.
 */

/** Backend bulk-upload batch cap. */
const CHUNK_SIZE = 50;
/** MIME types the server accepts (SVG custom icons are deliberately excluded). */
export const ALLOWED_IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);
export const IMAGE_EXT_BY_MIME = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

/**
 * Reads a Blob as a base64 data URL (the backend strips the `data:...,` prefix).
 * @param {Blob} blob
 * @returns {Promise<string>}
 */
export function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error || new Error('FileReader failed'));
        reader.readAsDataURL(blob);
    });
}

/**
 * Turns `{ id: Blob }` into bulk-upload items, reporting ids outside the server allowlist as
 * skipped rather than failing the whole batch.
 * @param {Map<string, Blob>|Array<[string, Blob]>} blobsById
 * @returns {Promise<{ uploads: Array<{localId: string, filename: string, mimeType: string, data: string}>, skipped: string[] }>}
 */
export async function buildImageUploads(blobsById) {
    const uploads = [];
    const skipped = [];
    for (const [id, blob] of blobsById) {
        try {
            if (!blob) continue;
            const mimeType = blob.type || 'image/png';
            if (!ALLOWED_IMAGE_MIME.has(mimeType)) {
                skipped.push(id);
                continue;
            }
            const data = await blobToBase64(blob);
            uploads.push({ localId: id, filename: `${id}.${IMAGE_EXT_BY_MIME[mimeType]}`, mimeType, data });
        } catch {
            skipped.push(id);
        }
    }
    return { uploads, skipped };
}

/**
 * Uploads image items in chunks of ≤50 (the backend batch cap), merging each chunk's
 * `localId → serverId` mapping and `failed` list. Pure transport helper (unit-testable).
 * @param {{ bulkUploadImages: Function }} apiClient
 * @param {string} atlasId
 * @param {Array<Object>} uploads
 * @returns {Promise<{ mapping: Object, failed: Array<Object> }>}
 */
export async function uploadImagesInChunks(apiClient, atlasId, uploads) {
    const mapping = {};
    const failed = [];
    for (let i = 0; i < uploads.length; i += CHUNK_SIZE) {
        const chunk = uploads.slice(i, i + CHUNK_SIZE);
        const res = await apiClient.bulkUploadImages(atlasId, chunk);
        Object.assign(mapping, res?.mapping || {});
        if (Array.isArray(res?.failed)) failed.push(...res.failed);
    }
    return { mapping, failed };
}

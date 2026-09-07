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
 * Reads the MIME type out of the FIRST BYTES of a blob, for the blobs that carry no `type`.
 *
 * WHY THIS EXISTS. A blob restored from a `.ebgeo` used to reach here with an empty `type`, and
 * `blob.type || 'image/png'` then declared PNG over JPEG bytes. The server sniffs the bytes
 * itself (`fileTypeFromBuffer`, `backend/src/modules/images/images.service.js`) and answers
 * `Content does not match declared type`, so the photo was silently dropped: 4 of 4 JPEG measured
 * on 2026-09-07. The reader half of that defect is fixed where it is born
 * (`export-import.service.js`, `loadImagesFromZip` now types the blob from the file extension);
 * this sniff is the belt for every other typeless source (an older store written before that fix,
 * a canvas export, a blob rebuilt by a browser that dropped the type).
 *
 * SIGNATURES, not guesses: PNG `89 50 4E 47`, JPEG `FF D8 FF`, WebP the `RIFF....WEBP` container,
 * and SVG by its opening text. Anything else keeps the historical `image/png` default, so the
 * server stays the last word on what it accepts.
 *
 * @param {Blob} blob
 * @returns {Promise<string|null>} The detected MIME type, or `null` when nothing matched.
 */
async function sniffImageMime(blob) {
    const head = new Uint8Array(await blob.slice(0, 32).arrayBuffer());
    if (head.length >= 4 && head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return 'image/png';
    if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
    if (head.length >= 12
        && head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46
        && head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50) return 'image/webp';
    const text = new TextDecoder('utf-8', { fatal: false }).decode(head).trim().toLowerCase();
    if (text.startsWith('<svg') || text.startsWith('<?xml')) return 'image/svg+xml';
    return null;
}

/**
 * Turns `{ id: Blob }` into bulk-upload items, reporting ids outside the server allowlist as
 * skipped rather than failing the whole batch.
 *
 * The declared `blob.type` always wins; the byte sniff only answers for a blob that has none.
 * The filename extension follows the type that was actually decided, so the server never gets a
 * `.png` holding JPEG bytes.
 *
 * @param {Map<string, Blob>|Array<[string, Blob]>} blobsById
 * @returns {Promise<{ uploads: Array<{localId: string, filename: string, mimeType: string, data: string}>, skipped: string[] }>}
 */
export async function buildImageUploads(blobsById) {
    const uploads = [];
    const skipped = [];
    for (const [id, blob] of blobsById) {
        try {
            if (!blob) continue;
            const mimeType = blob.type || (await sniffImageMime(blob)) || 'image/png';
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
 *
 * ONE CHUNK THAT FALLS DOES NOT TAKE THE REST WITH IT. Without the try/catch this loop threw on
 * the first network failure: chunks 1..k-1 were already written on the server, chunks k+1..n were
 * never attempted, and the caller showed the raw `fetch` text ("Failed to fetch") over an atlas
 * that already existed server-side with no images (measured 2026-09-07). Catching per chunk turns
 * a transport failure into what it really is — those ≤50 images did not make it — and lets the
 * remaining chunks land, so the atlas ends up as complete as the network allowed.
 *
 * The `failed` entries keep the SAME shape the server produces (`{ localId, error }`,
 * `backend/src/modules/images/images.service.js`), because every caller counts `failed.length`
 * and one of them reads the message. `transportErrors` counts the chunks that never got an
 * answer, which is the one thing the merged `failed` list cannot say: it separates "the server
 * refused these images" from "the network dropped".
 *
 * @param {{ bulkUploadImages: Function }} apiClient
 * @param {string} atlasId
 * @param {Array<Object>} uploads
 * @returns {Promise<{ mapping: Object, failed: Array<{localId: string, error: string}>, transportErrors: number }>}
 */
export async function uploadImagesInChunks(apiClient, atlasId, uploads) {
    const mapping = {};
    const failed = [];
    let transportErrors = 0;
    for (let i = 0; i < uploads.length; i += CHUNK_SIZE) {
        const chunk = uploads.slice(i, i + CHUNK_SIZE);
        try {
            const res = await apiClient.bulkUploadImages(atlasId, chunk);
            Object.assign(mapping, res?.mapping || {});
            if (Array.isArray(res?.failed)) failed.push(...res.failed);
        } catch (error) {
            transportErrors += 1;
            const message = error?.message || String(error || 'Erro de transporte');
            for (const item of chunk) failed.push({ localId: item.localId, error: message });
        }
    }
    return { mapping, failed, transportErrors };
}

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

import { mimeDoBlob } from '@utils/image_utils.js';

/**
 * The SVG to PNG conversion, loaded ON DEMAND.
 *
 * DYNAMIC AND NOT STATIC, because this module is in the EAGER graph of the map page (`map_sig.js`
 * reaches it through `account.control.js` → `save-local-atlas.service.js`), and
 * `tests/unit/teto-de-peso-da-pagina-do-mapa.test.js` budgets that folder module by module. An SVG
 * icon is rare and only matters while packaging an atlas, so its converter has no business in the
 * boot payload.
 *
 * @param {Blob} blob
 * @returns {Promise<Blob>}
 */
async function rasterizeSvgOnDemand(blob) {
    const { rasterizeSvgToPng } = await import('@js/import_export/svg-to-png.js');
    return rasterizeSvgToPng(blob);
}

/**
 * Loads the APNG flattener on first use, like the SVG rasterizer above.
 * @param {Blob} blob
 * @returns {Promise<Blob>}
 */
async function flattenApngOnDemand(blob) {
    const { achatarApngEmPng } = await import('@js/import_export/apng-to-png.js');
    return achatarApngEmPng(blob);
}

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
 * Reads the MIME type out of the FIRST BYTES of a blob. Since 2026-09-24 it answers FIRST, and the
 * declared `type` only when the bytes are of no known format (see {@link buildImageUploads}).
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
 * SIGNATURES, not guesses, and ONE list of them for the whole client: `mimeDosBytes`
 * (`utilities/image_utils.js`), which the photo conversion reads too. Anything unknown keeps the
 * declared type or the historical `image/png` default, so the server stays the last word on what
 * it accepts.
 *
 * @param {Blob} blob
 * @returns {Promise<string|null>} The detected MIME type, or `null` when nothing matched.
 */
function sniffImageMime(blob) {
    return mimeDoBlob(blob);
}

/**
 * Turns `{ id: Blob }` into bulk-upload items, reporting ids outside the server allowlist as
 * skipped rather than failing the whole batch.
 *
 * THE BYTES WIN OVER THE DECLARED `blob.type` (2026-09-24, review). The server sniffs the bytes and
 * refuses a declared type they contradict, and the atomic import refuses the WHOLE atlas for one such
 * picture; a PNG saved as `.jpg` by the previous line arrives declared `image/jpeg`. The declared
 * type answers only for bytes of no known format. The filename extension follows the type that was
 * actually decided, so the server never gets a `.png` holding JPEG bytes.
 *
 * SVG IS CONVERTED HERE, NOT REFUSED (owner's decision, 2026-09-19). The server allowlist stays
 * png/jpeg/webp and SVG will never be added to it, but a custom point icon saved as SVG used to
 * land in `skipped`, and since the three send ports turned `skipped` into a refusal of the WHOLE
 * atlas, such an atlas had no path to the server at all. The bytes that travel are rasterized to
 * PNG in the browser (`svg-to-png.js`) under the SAME id, because the bulk route preserves the
 * `localId` as the server id and every feature references its icon by that id. The local record is
 * NOT rewritten: the disk may keep the SVG.
 *
 * THE DECISION IS RE-TAKEN ON THE PRODUCED BLOB, never assumed: the rasterization result goes back
 * through the same type question and the same allowlist, so a converter that returns something
 * other than an image still ends in `skipped` instead of uploading bytes under a lying MIME.
 *
 * `rasterizeSvg` is injected so the conversion is exercisable without a DOM; passing `null`
 * restores the pre-2026-09-19 behaviour, which is the negative control of the unit test.
 *
 * AN ANIMATED PNG IS FLATTENED THE SAME WAY (2026-09-24, second review of the attached photos). The
 * server calls it `image/apng` and accepts only png/jpeg/webp; declared `image/png`, as the client
 * did while it read only the file's head, it was refused as a contradicted type, and the atomic
 * import refused the whole atlas for it. It travels as a still PNG under the same id
 * (`apng-to-png.js` says why the map loses nothing); `flattenApng: null` restores the refusal.
 *
 * @param {Map<string, Blob>|Array<[string, Blob]>} blobsById
 * @param {Object} [options]
 * @param {((blob: Blob) => Promise<Blob>)|null} [options.rasterizeSvg] - SVG to PNG converter.
 * @param {((blob: Blob) => Promise<Blob>)|null} [options.flattenApng] - APNG to still PNG converter.
 * @returns {Promise<{ uploads: Array<{localId: string, filename: string, mimeType: string, data: string}>, skipped: string[], skippedReasons: Array<{id: string, reason: string}> }>}
 */
export async function buildImageUploads(blobsById, { rasterizeSvg = rasterizeSvgOnDemand, flattenApng = flattenApngOnDemand } = {}) {
    const uploads = [];
    const skipped = [];
    const skippedReasons = [];
    const skip = (id, reason) => { skipped.push(id); skippedReasons.push({ id, reason }); };

    for (const [id, blob] of blobsById) {
        try {
            if (!blob) continue;
            let bytes = blob;
            let mimeType = (await sniffImageMime(blob)) || blob.type || 'image/png';
            if (mimeType === 'image/svg+xml' && typeof rasterizeSvg === 'function') {
                bytes = await rasterizeSvg(blob);
                mimeType = (bytes ? await sniffImageMime(bytes) : null) || bytes?.type || 'image/png';
            } else if (mimeType === 'image/apng' && typeof flattenApng === 'function') {
                bytes = await flattenApng(blob);
                mimeType = (bytes ? await sniffImageMime(bytes) : null) || bytes?.type || 'image/png';
            }
            if (!ALLOWED_IMAGE_MIME.has(mimeType)) {
                skip(id, `O servidor não aceita imagens do tipo ${mimeType}.`);
                continue;
            }
            const data = await blobToBase64(bytes);
            uploads.push({ localId: id, filename: `${id}.${IMAGE_EXT_BY_MIME[mimeType]}`, mimeType, data });
        } catch (error) {
            skip(id, error?.message || 'Esta imagem não pôde ser preparada para o envio.');
        }
    }
    return { uploads, skipped, skippedReasons };
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
 * A REFUSAL OF THE WHOLE REQUEST IS AN ANSWER, NOT A LOST NETWORK (2026-09-24, review). A 400, 403,
 * 404, 413, 415 or 422 used to land here as a transport failure, and the blob queue retried it
 * forever: a pendency that could never pass, holding every operation that cited it. The server
 * said no, so each item comes back `permanent: true` with the `status`, the same flag the server
 * puts on a per-item validation failure. Two statuses are about the REQUEST, not about an image,
 * and there the chunk is split in halves until the refusal names the item it is about: a 413 on 50
 * pictures that fit one by one, or a 400 of the schema on one bad item among good ones.
 *
 * @param {{ bulkUploadImages: Function }} apiClient
 * @param {string} atlasId
 * @param {Array<Object>} uploads
 * @returns {Promise<{ mapping: Object, failed: Array<{localId: string, error: string, permanent?: boolean, status?: number}>, transportErrors: number }>}
 */
export async function uploadImagesInChunks(apiClient, atlasId, uploads) {
    const mapping = {};
    const failed = [];
    let transportErrors = 0;
    const enviar = async (chunk) => {
        try {
            const res = await apiClient.bulkUploadImages(atlasId, chunk);
            Object.assign(mapping, res?.mapping || {});
            if (Array.isArray(res?.failed)) failed.push(...res.failed);
        } catch (error) {
            const message = error?.message || String(error || 'Erro de transporte');
            const status = error?.status ?? error?.statusCode ?? null;
            if (status !== null && STATUS_QUE_DIVIDE_O_LOTE.has(status) && chunk.length > 1) {
                const meio = Math.ceil(chunk.length / 2);
                await enviar(chunk.slice(0, meio));
                await enviar(chunk.slice(meio));
                return;
            }
            if (status !== null && STATUS_DE_RECUSA_DO_LOTE.has(status)) {
                for (const item of chunk) failed.push({ localId: item.localId, error: message, permanent: true, status });
                return;
            }
            transportErrors += 1;
            for (const item of chunk) failed.push({ localId: item.localId, error: message });
        }
    };
    for (let i = 0; i < uploads.length; i += CHUNK_SIZE) {
        await enviar(uploads.slice(i, i + CHUNK_SIZE));
    }
    return { mapping, failed, transportErrors };
}

/** Statuses of a whole-request refusal that no retry of the same request changes. */
const STATUS_DE_RECUSA_DO_LOTE = new Set([400, 403, 404, 413, 415, 422]);

/** Of those, the ones that may be about ONE item of the chunk (the body size, the schema). */
const STATUS_QUE_DIVIDE_O_LOTE = new Set([400, 413, 422]);

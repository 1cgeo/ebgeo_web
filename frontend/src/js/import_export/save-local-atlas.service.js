// Path: js/import_export/save-local-atlas.service.js

/**
 * @fileoverview Orchestrates "Salvar atlas local no servidor" (item 2): packages the current local
 * store as a NEW server atlas. Order matters —
 *   1. build the in-memory `.ebgeo` data (`exportService.buildExportDataObject`),
 *   2. transform it to the import payload (`buildServerImportPayload`),
 *   3. `importAtlas` (creates the atlas + entities; image refs use the LOCAL image ids),
 *   4. upload the image blobs PRESERVING those ids (backend keeps the client id), so the refs in
 *      the just-imported features stay valid with no post-import rewrite.
 * It does NOT connect/switch the store — the caller (UI) wires sharing + `clearAllDataStore` +
 * `markStoreRemote` + `connect` afterwards so the saved atlas becomes the live remote one.
 */

import { buildServerImportPayload } from './local-atlas-to-server.js';
import { getImage, getAllMapNamesStore } from '@store';

const CHUNK_SIZE = 50; // backend bulk-upload batch cap
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);
const EXT_BY_MIME = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

/**
 * Reads a Blob as a base64 data URL (the backend strips the `data:...,` prefix).
 * @param {Blob} blob
 * @returns {Promise<string>}
 */
function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error || new Error('FileReader failed'));
        reader.readAsDataURL(blob);
    });
}

/**
 * Reads the blobs for `imageIds` from the local image store and builds the bulk-upload items.
 * Ids with no backing blob (e.g. a non-image feature id) are ignored; images outside the server
 * allowlist (e.g. SVG custom icons) are reported as skipped.
 * @param {string[]} imageIds
 * @returns {Promise<{ uploads: Array<{localId:string, filename:string, mimeType:string, data:string}>, skipped: string[] }>}
 */
async function collectImageUploads(imageIds) {
    const uploads = [];
    const skipped = [];
    for (const id of imageIds) {
        try {
            const blob = await getImage(id);
            if (!blob) continue;
            const mimeType = blob.type || 'image/png';
            if (!ALLOWED_MIME.has(mimeType)) {
                skipped.push(id);
                continue;
            }
            const data = await blobToBase64(blob);
            uploads.push({ localId: id, filename: `${id}.${EXT_BY_MIME[mimeType]}`, mimeType, data });
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

/**
 * Saves the current local store as a NEW server atlas. See file header for the ordering rationale.
 * @param {Object} apiClient - The sync ApiClient.
 * @param {Object} exportService - The ExportImportService (provides `buildExportDataObject`).
 * @param {{ name: string, description?: string }} meta
 * @returns {Promise<{ atlasId: string, atlas: Object, mapNameToId: Object, stats: Object, imageStats: Object }>}
 */
export async function saveLocalAtlasToServer(apiClient, exportService, { name, description } = {}) {
    const mapsToExport = await getAllMapNamesStore();
    if (!mapsToExport || mapsToExport.length === 0) {
        throw new Error('Nenhum mapa local para salvar no servidor.');
    }

    const exportData = await exportService.buildExportDataObject(mapsToExport);
    const built = buildServerImportPayload(exportData, { name, description });

    const atlas = await apiClient.importAtlas(built.payload);
    const atlasId = atlas.id;

    // Phase 2/3: upload blobs preserving their ids so the imported features' refs stay valid.
    const { uploads, skipped } = await collectImageUploads(built.imageIds);
    const { failed } = await uploadImagesInChunks(apiClient, atlasId, uploads);

    return {
        atlasId,
        atlas,
        mapNameToId: built.mapNameToId,
        stats: built.stats,
        imageStats: {
            total: built.imageIds.length,
            uploaded: uploads.length - failed.length,
            skipped: skipped.length,
            failed: failed.length,
        },
    };
}

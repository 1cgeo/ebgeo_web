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
import { buildImageUploads, uploadImagesInChunks } from './atlas-image-upload.js';
import { getImage, getAllMapNamesStore } from '@store';

/**
 * Reads the blobs for `imageIds` from the LOCAL image store and builds the bulk-upload items.
 * Ids with no backing blob (e.g. a non-image feature id) are simply absent.
 * @param {string[]} imageIds
 * @returns {Promise<{ uploads: Array<Object>, skipped: string[] }>}
 */
async function collectImageUploads(imageIds) {
    const found = [];
    for (const id of imageIds) {
        try {
            const blob = await getImage(id);
            if (blob) found.push([id, blob]);
        } catch {
            // An unreadable blob is reported by buildImageUploads only if it got this far; a
            // failed READ is not a skipped image, it is an id with nothing behind it.
        }
    }
    return buildImageUploads(found);
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

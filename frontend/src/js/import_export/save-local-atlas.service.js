// Path: js/import_export/save-local-atlas.service.js

/**
 * Packages the mounted local atlas without discarding unreadable sections. Image bytes
 * are read before network writes. The server prepares privately and publishes metadata,
 * images and the recovery receipt together; the caller switches only after confirmation.
 */

import { buildServerImportPayload } from './local-atlas-to-server.js';
import { buildImageUploads } from './atlas-image-upload.js';
import { classifyMissingImages, missingImagesUploadConfirm, uploadCancelledError } from './ebgeo-missing-images.js';
import { getImage, getAllMapNamesStore } from '@store';
import { generateUUID } from '@utils/uuid.js';

/**
 * Reads the blobs for `imageIds` from the LOCAL image store and builds the bulk-upload items.
 * A missing original is RETURNED, not thrown (2026-09-21): the caller asks the person before any
 * network write. It used to abort, and one picture with no file made the atlas unpublishable.
 *
 * O blob e LIDO pelo id local e ENVIADO com o id novo de `imageIdMap`: e a mesma troca que o
 * payload ja fez nas referencias, e as duas metades precisam concordar.
 * @param {string[]} imageIds - Ids LOCAIS dos blobs.
 * @param {Object} imageIdMap - `{ localId: novoId }`.
 * @returns {Promise<{ uploads: Array<Object>, skipped: string[], missing: string[] }>} `missing`
 *   holds LOCAL ids.
 */
async function collectImageUploads(imageIds, imageIdMap) {
    const found = [];
    const missing = [];
    for (const id of imageIds) {
        const blob = await getImage(id);
        if (!blob) { missing.push(id); continue; }
        found.push([imageIdMap[id] || id, blob]);
    }
    return { ...(await buildImageUploads(found)), missing };
}

/**
 * Saves the current local store as a NEW server atlas. See file header for the ordering rationale.
 * @param {Object} apiClient - The sync ApiClient.
 * @param {Object} exportService - The ExportImportService (provides `buildExportDataObject`).
 * @param {{ name: string, description?: string, confirmMissingImages?: Function }} meta -
 *   `confirmMissingImages(question)` resolves true to publish without the missing pictures. Absent
 *   or false, nothing is published and the error carries `cancelled: true`.
 * @returns {Promise<{ atlasId: string, atlas: Object, mapNameToId: Object, stats: Object, imageStats: Object }>}
 */
export async function saveLocalAtlasToServer(apiClient, exportService, { name, description, confirmMissingImages } = {}) {
    const mapsToExport = await getAllMapNamesStore();
    if (!mapsToExport || mapsToExport.length === 0) {
        throw new Error('Nenhum mapa local para salvar no servidor.');
    }

    const exportData = await exportService.buildExportDataObject(mapsToExport, { strict: true });

    // Images have globally unique identities. Mint them before transforming all references;
    // a resumed attempt reuses the first manifest and payload held by the server.
    const sondagem = buildServerImportPayload(exportData, { name, description });
    const imageIdMap = Object.fromEntries(sondagem.imageIds.map((id) => [id, generateUUID()]));
    const built = buildServerImportPayload(exportData, { name, description, imageIdMap });

    const { uploads, skipped, missing } = await collectImageUploads(built.imageIds, imageIdMap);
    if (skipped.length || built.stats.droppedFeatures) throw new Error('Há imagens ou feições que não podem ser convertidas. Nenhum atlas foi publicado.');
    // ASKED BEFORE ANY NETWORK WRITE, and the answer decides: see `missingImagesUploadConfirm`.
    const question = missingImagesUploadConfirm(classifyMissingImages(missing, exportData), { from: 'disco' });
    if (question && !(await confirmMissingImages?.(question))) throw uploadCancelledError();
    const atlas = await apiClient.importAtlas(built.payload, {
        images: uploads,
        source: { exportData, name, description },
        missingImageIds: missing.map((id) => imageIdMap[id] || id),
    });
    const atlasId = atlas.id;

    return {
        atlasId,
        atlas,
        mapNameToId: built.mapNameToId,
        stats: built.stats,
        imageStats: {
            total: built.imageIds.length,
            uploaded: uploads.length,
            skipped: skipped.length,
            failed: 0,
            // Published WITHOUT, by the person's decision. Not `skipped`: nothing failed.
            missing: missing.length,
        },
    };
}

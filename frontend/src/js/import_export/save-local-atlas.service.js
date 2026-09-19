// Path: js/import_export/save-local-atlas.service.js

/**
 * Packages the mounted local atlas without discarding unreadable sections. Image bytes
 * are read before network writes. The server prepares privately and publishes metadata,
 * images and the recovery receipt together; the caller switches only after confirmation.
 */

import { buildServerImportPayload } from './local-atlas-to-server.js';
import { buildImageUploads } from './atlas-image-upload.js';
import { getImage, getAllMapNamesStore } from '@store';
import { generateUUID } from '@utils/uuid.js';

/**
 * Reads the blobs for `imageIds` from the LOCAL image store and builds the bulk-upload items.
 * A missing original aborts the import before any network write.
 *
 * O blob e LIDO pelo id local e ENVIADO com o id novo de `imageIdMap`: e a mesma troca que o
 * payload ja fez nas referencias, e as duas metades precisam concordar.
 * @param {string[]} imageIds - Ids LOCAIS dos blobs.
 * @param {Object} imageIdMap - `{ localId: novoId }`.
 * @returns {Promise<{ uploads: Array<Object>, skipped: string[] }>}
 */
async function collectImageUploads(imageIds, imageIdMap) {
    const found = [];
    for (const id of imageIds) {
        const blob = await getImage(id);
        if (!blob) throw new Error('Uma imagem original está ausente. Nenhum atlas foi publicado.');
        found.push([imageIdMap[id] || id, blob]);
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

    const exportData = await exportService.buildExportDataObject(mapsToExport, { strict: true });

    // Images have globally unique identities. Mint them before transforming all references;
    // a resumed attempt reuses the first manifest and payload held by the server.
    const sondagem = buildServerImportPayload(exportData, { name, description });
    const imageIdMap = Object.fromEntries(sondagem.imageIds.map((id) => [id, generateUUID()]));
    const built = buildServerImportPayload(exportData, { name, description, imageIdMap });

    const { uploads, skipped } = await collectImageUploads(built.imageIds, imageIdMap);
    if (skipped.length || built.stats.droppedFeatures) throw new Error('Há imagens ou feições que não podem ser convertidas. Nenhum atlas foi publicado.');
    const atlas = await apiClient.importAtlas(built.payload, { images: uploads, source: { exportData, name, description } });
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
        },
    };
}

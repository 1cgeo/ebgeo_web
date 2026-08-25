// Path: js/import_export/save-local-atlas.service.js

/**
 * @fileoverview Orchestrates "Salvar atlas local no servidor" (item 2): packages the current local
 * store as a NEW server atlas. Order matters —
 *   1. build the in-memory `.ebgeo` data (`exportService.buildExportDataObject`),
 *   2. transform it to the import payload (`buildServerImportPayload`), minting a FRESH id for
 *      every image blob and rewriting the refs to it (see the comment at the mint),
 *   3. `importAtlas` (creates the atlas + entities),
 *   4. upload the image blobs under those fresh ids, so the refs in the just-imported features
 *      stay valid with no post-import rewrite.
 * It does NOT connect/switch the store — the caller (UI) wires sharing + `clearAllDataStore` +
 * `markStoreRemote` + `connect` afterwards so the saved atlas becomes the live remote one.
 */

import { buildServerImportPayload } from './local-atlas-to-server.js';
import { buildImageUploads, uploadImagesInChunks } from './atlas-image-upload.js';
import { getImage, getAllMapNamesStore } from '@store';
import { generateUUID } from '@utils/uuid.js';

/**
 * Reads the blobs for `imageIds` from the LOCAL image store and builds the bulk-upload items.
 * Ids with no backing blob (e.g. a non-image feature id) are simply absent.
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
        try {
            const blob = await getImage(id);
            if (blob) found.push([imageIdMap[id] || id, blob]);
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

    // O BLOB GANHA ID NOVO A CADA ENVIO, e a assimetria com o resto do atlas e deliberada.
    //
    // `images.id` tambem e chave primaria GLOBAL. As demais entidades (feicao, camada, grupo)
    // preservam o id do cliente e o SERVIDOR recunha as que ja estao ocupadas, porque so ele
    // sabe o que esta livre. Com o blob esse conserto nao alcanca: ele sobe DEPOIS do import,
    // entao um id recunhado ali deixaria a referencia ja gravada na feicao apontando para o
    // nada. Cunhar antes de montar o payload resolve pela construcao, e nada precisa voltar
    // do servidor.
    //
    // DUAS PASSADAS da funcao PURA, e so a primeira serve para descobrir QUAIS blobs o atlas
    // cita. A leitura cara (`buildExportDataObject`, que varre o IndexedDB) continua sendo
    // uma so. A segunda passada reescreve, pelo `imageIdMap`, todas as referencias de blob de
    // uma vez: id de feicao de imagem, `markerSymbol` de icone proprio, `images[]` de 3D/360 e
    // `settings.customIcons`.
    const sondagem = buildServerImportPayload(exportData, { name, description });
    const imageIdMap = Object.fromEntries(sondagem.imageIds.map((id) => [id, generateUUID()]));
    const built = buildServerImportPayload(exportData, { name, description, imageIdMap });

    const atlas = await apiClient.importAtlas(built.payload);
    const atlasId = atlas.id;

    // Phase 2/3: upload the blobs under the ids the payload already points at.
    const { uploads, skipped } = await collectImageUploads(built.imageIds, imageIdMap);
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

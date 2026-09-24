// Path: js/projects/import-ebgeo.service.js
import { registrarUso } from '@js/session/uso-lote.js';
import { EventoDeUso } from '@js/session/eventos-de-uso.js';

/**
 * @fileoverview "Importar .ebgeo" on the chooser page: turns a `.ebgeo` file straight into a NEW
 * server atlas, without ever loading it into the local store.
 *
 * The pre-existing route to the server was "open the file on the map, then Enviar ao servidor" —
 * which destroys whatever the local workspace held, just to pass a file through it. Here the file
 * IS the source: a `.ebgeo` is a ZIP carrying `data.json` (the very shape
 * `buildExportDataObject` produces) plus `images/<id>.<ext>`, so the same pure transform that
 * powers "Enviar ao servidor" applies directly.
 *
 * Store-free by construction — this page has no map. It is loaded on demand (dynamic import) so
 * neither JSZip nor the transform is part of the page's initial payload.
 */

import { readEbgeoArchive, importVersionRefusal, isV1Format } from '@js/import_export/ebgeo-file-gate.js';
import { migrateImportDataToV2 } from '@js/import_export/import-normalize.js';
import { generateUUID } from '@utils/uuid.js';
import { buildServerImportPayload } from '@js/import_export/local-atlas-to-server.js';
import { buildImageUploads } from '@js/import_export/atlas-image-upload.js';
import { classifyMissingImages, missingImagesUploadConfirm, uploadCancelledError } from '@js/import_export/ebgeo-missing-images.js';
import { atlasNameFromFilename } from './ebgeo-filename.js';

/** Matches `images/<id>.<ext>` entries inside the archive. */
const IMAGE_ENTRY = /^images\/(.+)\.(png|jpe?g|svg|webp)$/i;

/**
 * MIME by archive extension. JSZip hands back a Blob with an EMPTY `type`, and the uploader
 * defaults an empty type to PNG — so a JPEG would be uploaded announcing itself as a PNG, and an
 * SVG would slip past the allowlist that exists to reject it. The extension is the only type
 * information a ZIP entry carries; re-stamp the blob with it.
 */
const MIME_BY_EXT = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    svg: 'image/svg+xml',
};

/**
 * Re-exported from a module with no imports, so the signed-out `.ebgeo` path of "Seus atlas" can
 * name a file without dragging JSZip in (see `ebgeo-filename.js`). Every existing call site keeps
 * importing it from here.
 */
export { atlasNameFromFilename };

/**
 * Imports a `.ebgeo` file as a new server atlas.
 *
 * @param {File|Blob} file - The `.ebgeo` archive.
 * @param {Object} deps
 * @param {Object} deps.apiClient - The sync ApiClient (`importAtlas` with atomic image preparation).
 * @param {string} [deps.name] - Overrides the name derived from the filename.
 * @param {Function} [deps.confirmMissingImages] - `(question) => Promise<boolean>`: true publishes
 *   without the pictures the archive does not carry. Absent or false, nothing is created and the
 *   error carries `cancelled: true`.
 * @returns {Promise<{ atlasId: string, name: string, stats: Object, imageStats: Object }>}
 * @throws {Error} On preflight or preparation failure, or when publication cannot be confirmed.
 *   Retrying the same content resumes preparation or recovers the committed receipt.
 */
export async function importEbgeoAsAtlas(file, { apiClient, name, confirmMissingImages } = {}) {
    const { zip, data } = await readEbgeoArchive(file);
    const refusal = importVersionRefusal(data);
    if (refusal) throw new Error(refusal);
    const originalData = structuredClone(data); // Migration adds timestamps; retries identify the original file.
    const exportData = isV1Format(data) ? migrateImportDataToV2(data) : data;

    const atlasName = (name || atlasNameFromFilename(file?.name)).trim();
    const first = buildServerImportPayload(exportData, { name: atlasName });
    if (first.stats.droppedFeatures) {
        const n = first.stats.droppedFeatures;
        throw new Error(`Importação interrompida: ${n === 1 ? '1 feição não pôde ser convertida' : `${n} feições não puderam ser convertidas`} para o servidor. Nenhum atlas foi criado; guarde o arquivo original.`);
    }
    // Image IDs are global on the server. Isolate EVERY import (including UUID
    // sources) and use the same mapping for photos, custom icons and 3D/360 refs.
    const imageIdMap = Object.fromEntries(first.imageIds.map(id => [id, generateUUID()]));
    const built = buildServerImportPayload(exportData, { name: atlasName, imageIdMap });

    // Images travel as ZIP entries here (not the local image store). Only the ids the transform
    // actually referenced are uploaded — an archive may carry blobs no surviving feature points at.
    const wanted = new Set(built.imageIds);
    const found = [];
    const foundIds = new Set();
    for (const entryName of Object.keys(zip.files)) {
        const match = IMAGE_ENTRY.exec(entryName);
        // An inline photo's bytes are taken from the document below, never from an entry.
        if (!match || !wanted.has(match[1]) || built.inlineImages.has(match[1])) continue;
        if (foundIds.has(match[1])) throw new Error('O arquivo contém imagens com o mesmo identificador. Nenhum atlas foi criado.');
        const raw = await zip.file(entryName).async('blob');
        const mimeType = MIME_BY_EXT[match[2].toLowerCase()] || 'application/octet-stream';
        foundIds.add(match[1]);
        found.push([imageIdMap[match[1]], new Blob([raw], { type: mimeType })]);
    }
    // THE INLINE PHOTO GOES UP AS A BLOB TOO (phase 2c of the attached photos): a file written by a
    // local atlas before phase 2b carries its photos as data URLs inside the document, and the
    // transform took them out of the payload, so their bytes travel from here.
    for (const [id, blob] of built.inlineImages) {
        if (!wanted.has(id)) continue;
        foundIds.add(id);
        found.push([imageIdMap[id], blob]);
    }
    // A PICTURE THE ARCHIVE DOES NOT CARRY IS A QUESTION, NOT A REFUSAL (2026-09-21). It used to
    // stop the import, and since the exporter may now write a file KNOWING a picture is missing
    // (the person confirmed it there), refusing here would make that file unusable on a server.
    const missing = [...wanted].filter(id => !foundIds.has(id));
    const question = missingImagesUploadConfirm(classifyMissingImages(missing, exportData), { from: 'arquivo', exportData });
    if (question && !(await confirmMissingImages?.(question))) throw uploadCancelledError();
    const { uploads, skipped } = await buildImageUploads(found);
    if (skipped.length) throw new Error(`Importação interrompida: ${skipped.length === 1 ? '1 imagem não pôde ser enviada' : `${skipped.length} imagens não puderam ser enviadas`} ao servidor. Nenhum atlas foi criado.`);
    // All archive reads/conversions above must succeed before creating the atlas.
    const atlas = await apiClient.importAtlas(built.payload, {
        images: uploads,
        source: { exportData: originalData, name: atlasName },
        missingImageIds: missing.map(id => imageIdMap[id]),
    });

    registrarUso(EventoDeUso.EBGEO_IMPORTADO);
    return {
        atlasId: atlas.id,
        name: atlasName,
        stats: built.stats,
        imageStats: {
            total: built.imageIds.length,
            uploaded: uploads.length,
            skipped: skipped.length,
            failed: 0,
            // Created WITHOUT, by the person's decision. Not `skipped`: nothing failed.
            missing: missing.length,
        },
    };
}

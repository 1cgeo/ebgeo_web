// Path: js/projects/import-ebgeo.service.js

/**
 * @fileoverview "Importar .ebgeo" on the chooser page: turns a `.ebgeo` file straight into a NEW
 * server atlas, without ever loading it into the local store.
 *
 * The pre-existing route to the server was "open the file on the map, then Salvar no servidor" —
 * which destroys whatever the local workspace held, just to pass a file through it. Here the file
 * IS the source: a `.ebgeo` is a ZIP carrying `data.json` (the very shape
 * `buildExportDataObject` produces) plus `images/<id>.<ext>`, so the same pure transform that
 * powers "Salvar no servidor" applies directly.
 *
 * Store-free by construction — this page has no map. It is loaded on demand (dynamic import) so
 * neither JSZip nor the transform is part of the page's initial payload.
 */

import JSZip from 'jszip';
import { buildServerImportPayload } from '@js/import_export/local-atlas-to-server.js';
import { buildImageUploads, uploadImagesInChunks } from '@js/import_export/atlas-image-upload.js';

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
 * The project name carried by the file: its own name, minus the extension.
 *
 * A `.ebgeo` has no atlas-name field — the format predates server atlases and only names MAPS. The
 * filename is what the user themself called this project when they saved it, so it is the closest
 * thing to an authored name; `currentMap` would name one map inside it instead. Falls back to a
 * generic label for an empty/odd filename, and the card menu can rename afterwards.
 * @param {string} filename
 * @returns {string}
 */
export function atlasNameFromFilename(filename) {
    const base = String(filename || '').split(/[\\/]/).pop() || '';
    const stem = base.replace(/\.ebgeo$/i, '').trim();
    return stem || 'Projeto importado';
}

/**
 * Imports a `.ebgeo` file as a new server atlas.
 *
 * @param {File|Blob} file - The `.ebgeo` archive.
 * @param {Object} deps
 * @param {Object} deps.apiClient - The sync ApiClient (`importAtlas` + `bulkUploadImages`).
 * @param {string} [deps.name] - Overrides the name derived from the filename.
 * @returns {Promise<{ atlasId: string, name: string, stats: Object, imageStats: Object }>}
 * @throws {Error} When the archive has no `data.json` (i.e. it is not a `.ebgeo`), or the
 *   server rejects the import. NOTHING is created in either case.
 */
export async function importEbgeoAsAtlas(file, { apiClient, name } = {}) {
    const zip = await JSZip.loadAsync(file);
    const dataFile = zip.file('data.json');
    if (!dataFile) {
        throw new Error('Arquivo .ebgeo inválido: data.json não encontrado.');
    }

    let exportData;
    try {
        exportData = JSON.parse(await dataFile.async('string'));
    } catch {
        throw new Error('Arquivo .ebgeo inválido: data.json corrompido.');
    }

    const atlasName = (name || atlasNameFromFilename(file?.name)).trim();
    const built = buildServerImportPayload(exportData, { name: atlasName });

    const atlas = await apiClient.importAtlas(built.payload);

    // Images travel as ZIP entries here (not the local image store). Only the ids the transform
    // actually referenced are uploaded — an archive may carry blobs no surviving feature points at.
    const wanted = new Set(built.imageIds);
    const found = [];
    for (const entryName of Object.keys(zip.files)) {
        const match = IMAGE_ENTRY.exec(entryName);
        if (!match || !wanted.has(match[1])) continue;
        const raw = await zip.file(entryName).async('blob');
        const mimeType = MIME_BY_EXT[match[2].toLowerCase()] || 'application/octet-stream';
        found.push([match[1], new Blob([raw], { type: mimeType })]);
    }
    const { uploads, skipped } = await buildImageUploads(found);
    const { failed } = await uploadImagesInChunks(apiClient, atlas.id, uploads);

    return {
        atlasId: atlas.id,
        name: atlasName,
        stats: built.stats,
        imageStats: {
            total: built.imageIds.length,
            uploaded: uploads.length - failed.length,
            skipped: skipped.length,
            failed: failed.length,
        },
    };
}

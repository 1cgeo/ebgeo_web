// Path: js/store/photo-attach.js

/**
 * @fileoverview Attaching a photo to an entity, in the shape of phase 2b: the bytes become a blob in
 * the atlas image store and travel by the durable blob queue; the entity keeps only the reference
 * and the thumbnail.
 *
 * WHY (fase 2 of the attached photos, owner's approval of 2026-09-24). The photo used to live inline
 * as a data URL inside the entity, and every edit of the entity carried the whole array twice: a
 * camera photo made a 1.4 MB edit before phase 1 and a 463 KB one after it, and above 10 MB per
 * operation an edit never synchronised. With the reference, an edit carries a thumbnail of about
 * 2 KB per photo, and the photo goes up once, on its own.
 *
 * THE ORDER IS THE IMAGE TOOL'S (`add_image_control.js`): the bytes are stored and the upload is
 * REGISTERED before the entity is saved, so an F5 in between still finds the pendency on disk; the
 * transfer starts only after the save succeeded (`confirmar`), and a refused save drops both
 * (`descartar`). One deliberate difference: the entity's operation does NOT wait for the blob. The
 * gallery draws the thumbnail, which travels with the entity, so there is no hole to prevent, and
 * holding the operation would hold every later edit behind a slow photo. Opening the WHOLE photo
 * before its bytes reach the server says so (`photoNotArrivedNotice`) and can be tried again.
 *
 * In a local atlas nothing is registered and nothing is sent: the blob stays in the local store.
 * The store owns no toast; the callers word what the person reads.
 */

import { processImageFile } from '../utilities/image_utils.js';
import { generateUUID } from '../utilities/uuid.js';
import { storeImage, removeImage } from './settings.operations.js';
import { registrarEnvioDeImagem } from './sync/image-sync.js';

/**
 * Processes a photo file, stores its bytes and registers their upload, and hands back the item the
 * entity must carry plus the two ways out.
 *
 * @param {File} file - Image file, already accepted by `validateImageFile`
 * @param {Object} [opcoes]
 * @param {string} [opcoes.origem='foto-anexa'] - Label of the upload pendency
 * @returns {Promise<{item: Object, bytes: number, confirmar: () => void, descartar: () => Promise<void>}>}
 *   `item`: `{ id, name, type, size, thumbnail, addedAt }`, with no `data`. `confirmar` after the
 *   entity was saved; `descartar` when the save refused or threw.
 */
export async function prepararFotoAnexa(file, { origem = 'foto-anexa' } = {}) {
    const { blob, thumbnail } = await processImageFile(file);
    const id = generateUUID();
    await storeImage(id, blob);
    const envio = await registrarEnvioDeImagem(blob, id, { origem, nomeDaFigura: () => file.name });
    const item = {
        id,
        name: file.name,
        type: blob.type || file.type,
        size: blob.size,
        thumbnail,
        addedAt: Date.now(),
    };
    return {
        item,
        bytes: blob.size,
        confirmar: () => {
            envio.enviar();
        },
        descartar: async () => {
            await envio.descartar();
            // The bytes were never referenced by any entity (the id was minted here), so they go.
            await removeImage(id).catch(() => {});
        },
    };
}

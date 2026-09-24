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
 * transfer starts after the save (`confirmar`), ALSO after a save that threw (the intention may
 * already be in the journal, see `comConversao`), and only a CLEAN refusal drops both (`descartar`).
 *
 * AND THE ENTITY'S OPERATION WAITS FOR THE BLOB, as the image feature's does (`operacaoEsperaBlob`,
 * `sync/blob-upload-queue.js`). Phase 2b let it leave first, on the argument that the thumbnail
 * travels with the entity and a slow photo should not hold later edits. The review of 2026-09-24
 * found what that cost: an operation already sent made the exit census count zero, "Sair" asked
 * nothing, the namespace and the only copy of the bytes were destroyed, and the server kept a
 * reference to a picture nobody would ever upload. Holding later edits behind a photo on a slow link
 * is the price, paid in time, never in data.
 *
 * In a local atlas nothing is registered and nothing is sent: the blob stays in the local store.
 * The store owns no toast; the callers word what the person reads.
 */

import { processImageFile, mimeDeFotoInlineQueSobe, blobDeDataUrl } from '@utils/image_utils.js';
import { generateUUID } from '@utils/uuid.js';
import { getActiveScope } from '@store/atlas-namespace.js';
import { storeImage, removeImage } from './settings.operations.js';
import { registrarEnvioDeImagem, isImageSyncOnline } from './sync/image-sync.js';
// Leaf module (zero imports).
import { OperationType } from './sync/operation-types.js';
import { fotosSemBytes, fotoSemBytes } from '@js/user_data/photo-refs.js';

/**
 * Processes a photo file and hands back the item the entity must carry, the WRITE of its bytes and
 * upload pendency (`gravar`), and the two ways out.
 *
 * NOTHING IS WRITTEN HERE (2026-09-24, review, item 5). The processing (a canvas re-encode, the heavy
 * part) runs outside the entity's transaction; `gravar` stores the bytes and registers the upload,
 * and each door calls it INSIDE the transaction's work, under the scope stamp, the logout barrier and
 * the per-tab pause. Before, the bytes and the pendency were written up front, so a write the
 * transaction then refused had already stored and registered a photo for an entity never saved.
 *
 * @param {File} file - Image file, already accepted by `validateImageFile`
 * @param {Object} [opcoes]
 * @param {string} [opcoes.origem='foto-anexa'] - Label of the upload pendency
 * @returns {Promise<{item: Object, bytes: number, gravar: () => Promise<void>, confirmar: () => void,
 *   descartar: () => Promise<void>}>} `item`: `{ id, name, type, size, thumbnail, addedAt }`, with no
 *   `data`. `gravar` inside the transaction, before the intention; `confirmar` after the entity was
 *   saved AND after a write that THREW; `descartar` only on a CLEAN refusal (see {@link comConversao}
 *   for why an error is not a refusal). Both are no-ops when `gravar` never ran.
 */
export async function prepararFotoAnexa(file, { origem = 'foto-anexa' } = {}) {
    const { blob, thumbnail } = await processImageFile(file);
    const id = generateUUID();
    let escopo = null;
    let gravou = false;
    let envio = null;
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
        gravar: async () => {
            if (gravou) return;
            gravou = true;
            escopo = getActiveScope();
            await storeImage(id, blob);
            envio = await registrarEnvioDeImagem(blob, id, { origem, nomeDaFigura: () => file.name });
            // A SERVER ATLAS WITH NO UPLOAD ON RECORD MUST NOT GET THE REFERENCE (2026-09-24, review).
            // The registration writes the pendency; when it fails (the disk refused it) nothing would
            // ever send the bytes, and the entity would cite, for every peer, a photo that exists
            // only here. Thrown here, inside the transaction's work and before the intention, the
            // edit does not happen; the bytes just stored are removed. A local atlas registers
            // nothing by design, which is not a failure.
            if (!envio.registrado && isImageSyncOnline()) {
                await removerSeNoMesmoAtlas(escopo, id);
                gravou = false;
                envio = null;
                throw Object.assign(new Error(FALHA_AO_REGISTRAR_A_FOTO), { fotoNaoRegistrada: true });
            }
        },
        confirmar: () => {
            envio?.enviar();
        },
        descartar: async () => {
            if (!gravou) return;
            await envio?.descartar();
            await removerSeNoMesmoAtlas(escopo, id);
        },
    };
}

/**
 * What the door reports when the upload of an attached photo could not be put on record. The error
 * carries `fotoNaoRegistrada: true`, which is what the galleries test before showing it.
 */
export const FALHA_AO_REGISTRAR_A_FOTO = 'Não foi possível anexar a foto: o navegador não conseguiu '
    + 'guardar o envio dela. Libere espaço e tente de novo.';

/**
 * Removes bytes minted here and referenced by nothing, but only in the atlas they were written to.
 *
 * `removeImage` acts on the ACTIVE repository, and a switch of atlas between the preparation and the
 * refusal would aim it at another atlas (2026-09-24, review). There the id does not exist, so the
 * removal did nothing, and the bytes stayed where they were written anyway: the honest version keeps
 * them and says so. An orphan blob is the cheap failure.
 * @param {Object|null} escopo - The scope active when the bytes were written
 * @param {string} id
 * @returns {Promise<void>}
 */
async function removerSeNoMesmoAtlas(escopo, id) {
    if (getActiveScope() !== escopo) return;
    await removeImage(id).catch(() => {});
}

/**
 * THE SAFETY NET OF PHASE 2c (owner's decision of 2026-09-24): the next write of an entity of a
 * SERVER atlas that still carries INLINE photos converts them, so its operation leaves with the
 * references and the thumbnails only. Nothing converts the acervo in bulk, neither on the server
 * nor locally. For a FEATURE the write that converts is an edit OF ITS PHOTOS (second review,
 * item 4, `fotosMudaram` in `feature.operations.js`): its patch is per property, and a conversion
 * riding on a rename claimed `images` and disputed it with a colleague who edited something else.
 * A 3D or 360 item is disputed as a whole document, so any write of it converts.
 *
 * A NEW ID PER CONVERTED PHOTO, never the inline one. Cloning a server atlas passes an inline photo
 * untouched, so two atlases can hold the same inline id, and `images.id` is a GLOBAL primary key on
 * the server: the second atlas's upload under that id would be refused for good. Two items of the
 * same array with the same inline id (a duplicated photo) become one blob.
 *
 * The order is the attach's ({@link prepararFotoAnexa}): the bytes are stored and the upload is
 * registered BEFORE the entity is written, `confirmar` after it was, `descartar` when it was not.
 * Which photos convert is `mimeDeFotoInlineQueSobe`, the same rule as the boundary of a local atlas
 * going up; the others keep travelling inline, as before.
 *
 * ONLY IN A SERVER ATLAS, and the question is the image sync's (`isImageSyncOnline`), asked before a
 * single byte is written: a local atlas keeps its photos as they are until it goes up, and the
 * boundary converts them there (`buildServerImportPayload`).
 *
 * NULL MEANS "WRITE AS BEFORE": nothing inline goes up, no server atlas is connected, the upload
 * could not be registered, or the disk refused a write (a full quota, 2026-09-24 review), in which
 * case every byte stored here is dropped again. Leaving the photo inline is never worse than today;
 * converting without a registered upload would lose it, and throwing would make an edit that has
 * nothing to do with the photo (a rename) fail because of it. IT NEVER THROWS.
 *
 * @param {Array} fotos - The entity's `images` array
 * @param {Object} [opcoes]
 * @param {string} [opcoes.origem='foto-convertida'] - Label of the upload pendency
 * @returns {Promise<{fotos: Array, confirmar: () => void, descartar: () => Promise<void>}|null>}
 */
export async function converterFotosInline(fotos, { origem = 'foto-convertida' } = {}) {
    if (!isImageSyncOnline() || !Array.isArray(fotos) || !fotos.some((foto) => mimeDeFotoInlineQueSobe(foto))) return null;
    const escopo = getActiveScope();
    const feitos = [];
    const descartar = async () => {
        for (const { id, envio } of feitos) {
            await envio.descartar();
            await removerSeNoMesmoAtlas(escopo, id);
        }
    };
    const novosIds = new Map();
    const novas = [];
    try {
        for (const foto of fotos) {
            const mime = mimeDeFotoInlineQueSobe(foto);
            if (mime && !novosIds.has(foto.id)) {
                const blob = blobDeDataUrl(foto.data);
                if (blob) {
                    const id = generateUUID();
                    await storeImage(id, blob);
                    const envio = await registrarEnvioDeImagem(blob, id, { origem, nomeDaFigura: () => foto.name || null });
                    feitos.push({ id, envio });
                    if (!envio.registrado) {
                        await descartar();
                        return null;
                    }
                    novosIds.set(foto.id, id);
                }
            }
            const id = mime ? novosIds.get(foto.id) : null;
            if (!id) {
                novas.push(foto);
                continue;
            }
            novas.push({ ...fotoSemBytes(foto), id, type: mime });
        }
    } catch (error) {
        console.warn('[photo-attach] could not convert an inline photo; the edit keeps it inline:', error);
        await descartar().catch(() => {});
        return null;
    }
    if (feitos.length === 0) return null;
    return {
        fotos: novas,
        confirmar: () => {
            for (const { envio } of feitos) envio.enviar();
        },
        descartar,
    };
}

/**
 * The same safety net for the 3D and 360 funnels (`editCesium3d`, `editStreetview360`), whose
 * operations carry the LIVE item of the document: the `images` of every item a CREATE or UPDATE
 * writes are converted in place, so the persisted document and the operation agree. A DELETE carries
 * nothing worth uploading. Only in a server atlas, as {@link converterFotosInline} decides.
 *
 * Called INSIDE the transaction's work, where the items are known; the funnel confirms after the
 * transaction, and ALSO after a throw (`comConversao`). It never throws either: an item whose photos
 * could not be converted is written as before, inline, and an item already converted keeps its
 * conversion, because its operation data now cites the new ids.
 *
 * @param {Array<{type: string, data?: Object}>} operacoes - The edit's operations
 * @param {Object} [opcoes]
 * @param {string} [opcoes.origem='foto-convertida'] - Label of the upload pendency
 * @returns {Promise<{confirmar: () => void, descartar: () => Promise<void>}|null>}
 */
export async function converterFotosDasOperacoes(operacoes, { origem = 'foto-convertida' } = {}) {
    if (!Array.isArray(operacoes)) return null;
    const conversoes = [];
    const descartar = async () => {
        for (const conversao of conversoes) await conversao.descartar();
    };
    for (const op of operacoes) {
        if (op?.type === OperationType.DELETE || !op?.data) continue;
        const conversao = await converterFotosInline(op.data.images, { origem });
        if (!conversao) continue;
        op.data.images = conversao.fotos;
        // The PREVIOUS side travels too (the envelope carries `previousData`): see fotosSemBytes.
        if (op.previous && op.previous !== op.data) op.previous = { ...op.previous, images: fotosSemBytes(op.previous.images) };
        conversoes.push(conversao);
    }
    if (conversoes.length === 0) return null;
    return {
        confirmar: () => {
            for (const conversao of conversoes) conversao.confirmar();
        },
        descartar,
    };
}

/**
 * Awaits the write, then starts the uploads of the photos it converted, AND ALSO WHEN THE WRITE
 * THREW.
 *
 * AN ERROR IS NOT A REFUSAL (2026-09-24, review). `runTransaction` can throw AFTER the intention is
 * already in the journal (the persistence of the entity, the fence, a switch of scope, the
 * materialisation mark): the intention is re-projected and SENT on the next connect, citing the
 * photo. Dropping the bytes and the pendency there published a reference to a picture nobody would
 * ever upload, for every peer. Keeping and sending them costs, at worst, an orphan blob on the
 * server, which is the cheap failure. Dropping belongs only to a CLEAN refusal (a falsy result with
 * nothing written), which the callers decide, as `add_image_control.js` does.
 *
 * The conversion is read through a function because the 3D and 360 funnels only learn it inside the
 * transaction's work, after the write promise already exists.
 *
 * @param {() => ({confirmar: () => void, descartar: () => Promise<void>}|null)} conversao
 * @param {Promise<*>} escrita - The write
 * @returns {Promise<*>} What the write resolved with
 */
export async function comConversao(conversao, escrita) {
    let resultado;
    try {
        resultado = await escrita;
    } catch (error) {
        conversao()?.confirmar();
        throw error;
    }
    conversao()?.confirmar();
    return resultado;
}

// `fotosSemBytes` moved to the zero-import leaf (`user_data/photo-refs.js`), because the feature
// patch reads it too; re-exported here for the callers that ask this module.
export { fotosSemBytes };

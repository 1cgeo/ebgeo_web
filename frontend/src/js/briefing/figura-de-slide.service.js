// Path: js/briefing/figura-de-slide.service.js

/**
 * @fileoverview The bytes of a slide figure held by reference (`figura-de-slide.js`): storing a new
 * one with its upload on record, and resolving the ones a piece of DOM draws.
 *
 * THE SAME DOOR AS AN ATTACHED PHOTO (`store/photo-attach.js`): the bytes go to this atlas's image
 * store first, the upload is registered in the durable queue before a byte leaves, and the operation
 * of the slide that cites the figure waits for them (`idsDeFotosDaEntidade` reads the sentinels of a
 * slide's `content`), so no peer ever gets a reference to bytes that are not on the server. In a
 * local atlas nothing is registered, by design, and the bytes travel with "Enviar ao servidor" or
 * the `.ebgeo`.
 *
 * RESOLVING READS `getImage`, which falls back to the server and caches, so a peer, the visitor of a
 * public link and the PDF all see the figure. The object URLs are cached per id for the page's
 * lifetime: a figure is at most 800x600 JPEG, and a slide show goes back and forth over them.
 */

import { storeImage, getImage, removeImage } from '@store/settings.operations.js';
import { registrarEnvioDeImagem, isImageSyncOnline } from '@store/sync/image-sync.js';
import { blobDeDataUrl } from '@utils/image_utils.js';
import { generateUUID } from '@utils/uuid.js';
import { srcDaFigura, ATRIBUTO_DA_FIGURA, embutirFigurasNoHtml } from './figura-de-slide.js';

/** The origin the upload queue records for a slide figure (its refusal is worded as a figure's). */
export const ORIGEM_FIGURA_DE_SLIDE = 'figura-de-slide';

/** Said when the upload could not be put on record in a server atlas: the figure is not inserted. */
export const FALHA_AO_GUARDAR_A_FIGURA = 'Não foi possível inserir a figura: o navegador não '
    + 'conseguiu guardá-la. Tente de novo. Se continuar, avise o administrador.';

/**
 * Stores a compressed figure and puts its upload on record.
 * @param {string} dataUrl - What `compressQuillImage` produced.
 * @param {string} [nome] - The file's name, for the refusal notice.
 * @returns {Promise<string>} The sentinel src to embed in the slide.
 * @throws {Error} Flagged `isImageRefusal` when the upload could not be put on record.
 */
export async function guardarFiguraDeSlide(dataUrl, nome = '') {
    const blob = blobDeDataUrl(dataUrl);
    if (!blob) throw Object.assign(new Error(FALHA_AO_GUARDAR_A_FIGURA), { isImageRefusal: true });
    const id = generateUUID();
    await storeImage(id, blob);
    const envio = await registrarEnvioDeImagem(blob, id, {
        origem: ORIGEM_FIGURA_DE_SLIDE, nomeDaFigura: () => nome || null,
    });
    // A SERVER ATLAS WITH NO UPLOAD ON RECORD MUST NOT GET THE REFERENCE, the rule of the attached
    // photo: nothing would ever send the bytes, and every peer would see a figure that exists only
    // here. A local atlas registers nothing by design.
    if (!envio.registrado && isImageSyncOnline()) {
        await removeImage(id).catch(() => {});
        throw Object.assign(new Error(FALHA_AO_GUARDAR_A_FIGURA), { isImageRefusal: true });
    }
    envio.enviar();
    return srcDaFigura(id);
}

/** Object URLs already made, by figure id. */
const urls = new Map();

/**
 * @param {string} id - A figure's image id.
 * @returns {Promise<string|null>} An object URL of its bytes, or null when they cannot be had.
 */
export async function urlDaFiguraDeSlide(id) {
    if (urls.has(id)) return urls.get(id);
    const blob = await getImage(id).catch(() => null);
    if (!blob || typeof URL?.createObjectURL !== 'function') return null;
    const url = URL.createObjectURL(blob);
    urls.set(id, url);
    return url;
}

/**
 * Fills in the bytes of ONE figure element (what Quill calls when it creates one). A figure whose
 * bytes cannot be had keeps the placeholder, which is empty space and never a request.
 * @param {HTMLImageElement} img
 * @returns {Promise<void>}
 */
export async function resolverFigura(img) {
    const id = img?.getAttribute?.(ATRIBUTO_DA_FIGURA);
    if (!id) return;
    const url = await urlDaFiguraDeSlide(id);
    // The element may have been given to another figure meanwhile (Quill reuses nothing, but a
    // re-render of the same root can): the id is read again before writing.
    if (url && img.getAttribute(ATRIBUTO_DA_FIGURA) === id) img.setAttribute('src', url);
}

/**
 * Fills in the bytes of every figure a piece of DOM draws (the output of `sanitizeQuillHtml`, whose
 * figures carry the placeholder and the id attribute).
 * @param {ParentNode|null|undefined} raiz
 * @returns {Promise<void>} Resolves when every figure was tried (the PDF awaits it before capturing).
 */
export async function resolverFiguras(raiz) {
    const figuras = raiz?.querySelectorAll?.(`img[${ATRIBUTO_DA_FIGURA}]`) ?? [];
    await Promise.all([...figuras].map(resolverFigura));
}

/**
 * @param {Blob} blob
 * @returns {Promise<string|null>} The blob as a `data:` URL, or null when it cannot be read.
 */
function dataUrlDoBlob(blob) {
    return new Promise((resolve) => {
        const leitor = new FileReader();
        leitor.onload = () => resolve(typeof leitor.result === 'string' ? leitor.result : null);
        leitor.onerror = () => resolve(null);
        leitor.readAsDataURL(blob);
    });
}

/**
 * Drawn HTML (the output of `sanitizeQuillHtml`) with each figure's bytes written inline, for a copy
 * that leaves the app and has no store to resolve from (the notes downloaded as a file).
 * @param {string} html
 * @returns {Promise<string>}
 */
export async function embutirFiguras(html) {
    if (typeof html !== 'string' || !html.includes(ATRIBUTO_DA_FIGURA)) return html;
    const ids = [...new Set([...html.matchAll(/data-figura-id="([A-Za-z0-9-]{8,64})"/g)].map((m) => m[1]))];
    const dataUrls = new Map();
    await Promise.all(ids.map(async (id) => {
        const blob = await getImage(id).catch(() => null);
        const dataUrl = blob ? await dataUrlDoBlob(blob) : null;
        if (dataUrl) dataUrls.set(id, dataUrl);
    }));
    return embutirFigurasNoHtml(html, dataUrls);
}

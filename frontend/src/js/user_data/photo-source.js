// Path: js/user_data/photo-source.js

/**
 * @fileoverview The bytes of an attached photo, in either of its two shapes (`photo-refs.js`).
 *
 * An inline photo answers at once from its `data`. A photo held by reference is read from the atlas
 * image store by `getImage`, which falls back to the server and caches what comes back. A photo whose
 * bytes are not on the server yet (the colleague who attached it is still uploading, or is offline)
 * answers null, and the viewer says so and lets the person try again: the gallery never shows a hole,
 * because the thumbnail always travels inline with the item.
 */

import { getImage } from '@store/settings.operations.js';
import { fotoTemBytesInline, idDeFotoPorReferencia } from './photo-refs.js';

/**
 * The bytes of a photo as a Blob, or null when they are not available.
 * @param {Object|string} foto - An item of an `images` array
 * @returns {Promise<Blob|null>}
 */
export async function blobDaFoto(foto) {
    if (fotoTemBytesInline(foto)) {
        try {
            return await (await fetch(foto.data)).blob();
        } catch {
            return null;
        }
    }
    const id = idDeFotoPorReferencia(foto);
    if (!id) return null;
    try {
        return (await getImage(id)) ?? null;
    } catch {
        return null;
    }
}

/**
 * A URL an `<img>` or an `<a download>` can take for the WHOLE photo, and how to release it.
 * @param {Object|string} foto - An item of an `images` array
 * @returns {Promise<{url: string, liberar: () => void}|null>}
 */
export async function urlDaFoto(foto) {
    if (fotoTemBytesInline(foto)) return { url: foto.data, liberar: () => {} };
    const blob = await blobDaFoto(foto);
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    return { url, liberar: () => URL.revokeObjectURL(url) };
}

/**
 * Shows the WHOLE photo in an `<img>` of a viewer: the thumbnail at once, then the photo when its
 * bytes arrive. Returns how to release it, which the viewer calls on navigation and on close.
 *
 * A photo held by reference whose bytes are not available yet keeps the thumbnail and calls
 * `aoFaltar`, so the viewer can say so; opening it again tries again (`getImage` asks the server
 * each time until it has the bytes).
 * @param {HTMLImageElement} img
 * @param {Object|string} foto - An item of an `images` array
 * @param {{ aoFaltar?: () => void }} [opcoes]
 * @returns {() => void} Releases the object URL, and cancels a lookup still in flight
 */
export function mostrarFotoInteira(img, foto, { aoFaltar } = {}) {
    let ativo = true;
    let liberar = () => {};
    if (fotoTemBytesInline(foto)) {
        img.src = foto.data;
    } else {
        img.src = (foto && typeof foto === 'object' && foto.thumbnail) || '';
        urlDaFoto(foto).then((fonte) => {
            if (!ativo) {
                fonte?.liberar();
                return;
            }
            if (!fonte) {
                aoFaltar?.();
                return;
            }
            img.src = fonte.url;
            liberar = fonte.liberar;
        });
    }
    return () => {
        ativo = false;
        liberar();
    };
}

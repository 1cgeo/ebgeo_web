// Path: js/user_data/photo-refs.js

/**
 * @fileoverview Where the photos attached to an entity live, and which of them carry their bytes.
 *
 * TWO SHAPES OF THE SAME PHOTO, READ FOREVER (fase 2 of the attached photos, owner's approval of
 * 2026-09-24). A photo attached to a feature (`properties.images[]`), to a 3D marker, measurement or
 * viewshed, or to a 360 marker (`images[]`) used to carry its bytes inline, as a data URL in `data`.
 * From phase 2b on, the bytes are a blob in the atlas image store under the photo's `id`, and the
 * item keeps only the reference and its `thumbnail`. Every reader accepts both, because nothing
 * converts the old ones in bulk: the acervo of the previous line, old `.ebgeo` files and atlases that
 * never reached a server keep the inline shape, and they are converted only at the boundary.
 *
 * The legacy shape of a 3D/360 item's photo can also be a bare id string: that is a reference too.
 *
 * ZERO IMPORTS, so the rules are testable in node and reachable from any module.
 */

/**
 * Whether a photo item carries its own bytes (the inline shape).
 * @param {*} foto - An item of an `images` array
 * @returns {boolean}
 */
export function fotoTemBytesInline(foto) {
    return !!foto && typeof foto === 'object' && typeof foto.data === 'string' && foto.data.length > 0;
}

/**
 * The image-store id a photo item points at when it does NOT carry its bytes, or null.
 * @param {*} foto - An item of an `images` array
 * @returns {string|null}
 */
export function idDeFotoPorReferencia(foto) {
    if (typeof foto === 'string') return foto.length > 0 ? foto : null;
    if (!foto || typeof foto !== 'object' || fotoTemBytesInline(foto)) return null;
    return typeof foto.id === 'string' && foto.id.length > 0 ? foto.id : null;
}

/**
 * Every `images` array of a 3D or 360 document, at any depth (markers, measurements, viewsheds).
 * @param {*} valor
 * @param {(fotos: Array) => void} visitar
 */
function percorrerImagens(valor, visitar) {
    if (!valor || typeof valor !== 'object') return;
    if (Array.isArray(valor)) {
        for (const item of valor) percorrerImagens(item, visitar);
        return;
    }
    for (const [chave, filho] of Object.entries(valor)) {
        if (chave === 'images' && Array.isArray(filho)) visitar(filho);
        else percorrerImagens(filho, visitar);
    }
}

/**
 * The ids of every photo held BY REFERENCE in an atlas document, in document order and without
 * duplicates: the ones whose bytes must travel beside the document (an export, an upload).
 *
 * The feature buckets are walked by `properties.images` only, never by an `images` key, because the
 * bucket of image FEATURES is also called `images` and its items are features, not photos. The 3D
 * and 360 documents are walked for every `images` array, at any depth.
 *
 * @param {Object} documento - The shape of the export document: `maps` (name to `{ features }`),
 *   `cesium3d` and `streetview360` (name to the map's document)
 * @returns {string[]}
 */
export function idsDeFotosPorReferencia(documento) {
    const vistos = new Set();
    const ids = [];
    const colher = (fotos) => {
        for (const foto of fotos) {
            const id = idDeFotoPorReferencia(foto);
            if (id && !vistos.has(id)) {
                vistos.add(id);
                ids.push(id);
            }
        }
    };
    for (const mapa of Object.values(documento?.maps || {})) {
        for (const lista of Object.values(mapa?.features || {})) {
            if (!Array.isArray(lista)) continue;
            for (const feicao of lista) {
                const fotos = feicao?.properties?.images;
                if (Array.isArray(fotos)) colher(fotos);
            }
        }
    }
    percorrerImagens(documento?.cesium3d, colher);
    percorrerImagens(documento?.streetview360, colher);
    return ids;
}

/**
 * The ids of the photos an ENTITY payload cites by reference: the `properties.images` of a feature
 * and the `images` of a 3D or 360 item. Inline photos carry their bytes and are not cited.
 *
 * It is what the outbound hold asks (`operacaoEsperaBlob`, `store/sync/blob-upload-queue.js`): an
 * operation that cites a photo whose bytes the server has not confirmed stays prepared, the rule of
 * the image feature extended to the photo (2026-09-24, review of phases 2b/2c).
 *
 * @param {*} dados - The `data` of an operation (a feature, or a 3D/360 item)
 * @returns {string[]}
 */
export function idsDeFotosDaEntidade(dados) {
    const ids = [];
    for (const lista of [dados?.properties?.images, dados?.images]) {
        if (!Array.isArray(lista)) continue;
        for (const foto of lista) {
            const id = idDeFotoPorReferencia(foto);
            if (id) ids.push(id);
        }
    }
    return ids;
}

// Path: js/store/foto-recusada.operations.js

/**
 * @fileoverview "Descartar" of a refused attached photo: the photo leaves every entity that cites it.
 *
 * WHY (owner's decision of 2026-09-26). The server can refuse the bytes of an attached photo for good,
 * and then this browser holds the only copy of a photo an entity still shows; the collaborators see
 * it as unavailable. The pendencies panel had no command for it. "Descartar" gives the photo up: it is
 * taken out of the entity, by the same store operations the gallery uses, so the edit syncs and the
 * entity reads the same for everyone; the record of the refusal then leaves by itself, because no
 * entity cites the photo any more (`recusa-de-foto-sem-citacao.js`). The alternative the owner
 * refused kept the reference and dropped only the local copy, which left a photo nobody has.
 *
 * EVERY MAP, NOT THE ONE IN MEMORY: the memory holds one map at a time, and the photo may be on any of
 * them. Features are rewritten with {@link updateFeature} and the map's name; 3D and 360 items go
 * through their own image removal, which carries the map's name too. Each door keeps its own gates
 * (role, map lock, missing map), so a refusal leaves the photo where it is, and the answer says
 * whether it is gone from everywhere.
 */

import { getAllMapNamesStore } from './map.operations.js';
import { getMapDataCompat } from './repositories/index.js';
import { updateFeature } from './feature.operations.js';
import {
    getCesium3dDataForExport, removeMarkerImage, removeMeasurementImage, removeViewshedImage,
} from './cesium3d.operations.js';
import { getStreetview360DataForExport, removeMarker360Image } from './streetview360.operations.js';

/**
 * Whether an `images` array holds the photo (a reference item, or the bare id of a legacy 3D/360 item).
 * @param {*} fotos
 * @param {string} imageId
 * @returns {boolean}
 */
function cita(fotos, imageId) {
    return Array.isArray(fotos) && fotos.some((foto) => foto === imageId || foto?.id === imageId);
}

/** The 3D collections that can hold photos, with the operation that removes one. */
const COLECOES_3D = Object.freeze([
    ['markers', removeMarkerImage],
    ['measurements', removeMeasurementImage],
    ['viewsheds', removeViewshedImage],
]);

/**
 * How many entities of the mounted atlas still cite the photo, over every map.
 * @param {string} imageId
 * @returns {Promise<number>}
 */
async function contarCitacoes(imageId) {
    let total = 0;
    for (const mapa of await getAllMapNamesStore()) {
        const documento = await getMapDataCompat(mapa);
        for (const lista of Object.values(documento?.features ?? {})) {
            if (Array.isArray(lista)) total += lista.filter((f) => cita(f?.properties?.images, imageId)).length;
        }
        const dados3d = await getCesium3dDataForExport(mapa);
        for (const [colecao] of COLECOES_3D) {
            total += (dados3d?.[colecao] ?? []).filter((item) => cita(item?.images, imageId)).length;
        }
        const dados360 = await getStreetview360DataForExport(mapa);
        total += (dados360?.markers ?? []).filter((m) => cita(m?.images, imageId)).length;
    }
    return total;
}

/**
 * Takes a photo out of every entity of the mounted atlas that cites it.
 * @param {string} imageId - The photo's id (the refused record's `imageId`).
 * @param {Object} [opcoes]
 * @param {function(string, string): void} [opcoes.aoTirarDaFeicao] - Called with the feature's id and
 *   `source` after each feature edit, so the caller can tell an open photo gallery, which redraws
 *   only on the event the gallery's own removal emits (seen in the capture of 2026-09-26: the feature
 *   panel kept showing the photo it had just lost). A callback, not the bus, so this module stays
 *   out of the services container and its graph.
 * @returns {Promise<{tirada: boolean, restantes: number}>} `tirada` when no entity cites it any more;
 *   `restantes` counts the entities a gate kept it on (a locked map, a missing permission).
 */
export async function tirarFotoDasEntidades(imageId, { aoTirarDaFeicao = null } = {}) {
    if (typeof imageId !== 'string' || imageId === '') return { tirada: false, restantes: 0 };

    for (const mapa of await getAllMapNamesStore()) {
        const documento = await getMapDataCompat(mapa);
        for (const [tipo, lista] of Object.entries(documento?.features ?? {})) {
            if (!Array.isArray(lista)) continue;
            for (const feicao of lista) {
                if (!cita(feicao?.properties?.images, imageId)) continue;
                // Applied to the feature as stored under the document lock, like the gallery's
                // removal (`userDataManager.removeImage`): a peer's edit in between is kept.
                await updateFeature(tipo, feicao, mapa, {
                    preserveUserData: false,
                    transform: (atual) => ({
                        ...atual,
                        properties: {
                            ...atual.properties,
                            images: (atual.properties?.images ?? []).filter((foto) => foto !== imageId && foto?.id !== imageId),
                        },
                    }),
                });
                aoTirarDaFeicao?.(feicao.properties?.id, feicao.properties?.source);
            }
        }

        const dados3d = await getCesium3dDataForExport(mapa);
        for (const [colecao, remover] of COLECOES_3D) {
            for (const item of dados3d?.[colecao] ?? []) {
                if (cita(item?.images, imageId)) await remover(item.id, imageId, mapa);
            }
        }

        const dados360 = await getStreetview360DataForExport(mapa);
        for (const marcador of dados360?.markers ?? []) {
            if (cita(marcador?.images, imageId)) await removeMarker360Image(marcador.id, imageId, mapa);
        }
    }

    // THE ANSWER IS READ BACK, never assumed: every door above may refuse without throwing.
    const restantes = await contarCitacoes(imageId);
    return { tirada: restantes === 0, restantes };
}

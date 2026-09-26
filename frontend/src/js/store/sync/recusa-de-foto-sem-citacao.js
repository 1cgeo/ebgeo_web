// Path: js/store/sync/recusa-de-foto-sem-citacao.js

/**
 * @fileoverview A refused ATTACHED photo stops being a pendency when no entity cites it any more.
 *
 * WHY (owner's decision of 2026-09-26, third review of the attached photos, item 5). The server can
 * refuse the bytes of an attached photo for good, and the record of that refusal is kept because
 * this browser then holds the only copy of a photo an entity still shows (`countPendingBlobUploadsIn`,
 * `session/unsynced-work-exit.js`). But nothing ever took the record away: after the person removed
 * the photo from the feature, or deleted the feature, every exit from the account still asked about
 * it and the pendencies panel still listed it, with no command to make it leave. The record means
 * something exactly while the photo is cited, so that is the rule: cited, it stays; not cited, it
 * goes.
 *
 * THE CENSUS READS THE DISK OF THE SCOPE, never the memory store, because the memory holds one map
 * at a time (`.claude/rules/architecture.md`, "Data Model") and a photo on another map is still
 * cited. It is the same walk the export uses to know which photos travel (`idsDeFotosPorReferencia`,
 * `user_data/photo-refs.js`): features by `properties.images`, 3D and 360 items by any `images` array.
 *
 * LIGHT ON PURPOSE, AND IT ONLY READS: the exit count runs on `atlas.html`, which boots without the
 * store, so this module imports only the namespace, the photo reference rules and the record
 * vocabulary. Removing a record is the queue's own write, through its fenced store
 * (`listarPendenciasDeBlob`, `blob-upload-queue.js`), never a raw write from here.
 */

import { getStoreFor, StoreName } from '@store/atlas-namespace.js';
import { idsDeFotosPorReferencia } from '@js/user_data/photo-refs.js';
import { BLOB_UPLOAD_RECUSADO, ORIGEM_FOTO_ANEXA } from './blob-upload-keys.js';

/** How many values are read at once from one store. */
const LOTE_DE_LEITURA = 200;

/**
 * Whether a pendency record is the definitive refusal of an ATTACHED photo (not of an image feature,
 * whose refusal became a durable issue of its operation, nor of a converted inline photo).
 * @param {*} registro - A pendency record of the IMAGES store.
 * @returns {boolean}
 */
export function ehRecusaDeFotoAnexa(registro) {
    return registro?.estado === BLOB_UPLOAD_RECUSADO
        && typeof registro.origem === 'string' && registro.origem.startsWith(ORIGEM_FOTO_ANEXA)
        && typeof registro.imageId === 'string';
}

/**
 * Every value of one store of the scope, read in batches.
 * @param {string} storeName
 * @param {Object} scope
 * @returns {Promise<Object<string, *>>} Key to value.
 */
async function valoresDaLoja(storeName, scope) {
    const store = getStoreFor(storeName, scope);
    const chaves = await store.keys();
    const valores = {};
    for (let i = 0; i < chaves.length; i += LOTE_DE_LEITURA) {
        const lote = chaves.slice(i, i + LOTE_DE_LEITURA);
        const lidos = await Promise.all(lote.map((chave) => store.getItem(chave)));
        lote.forEach((chave, j) => { valores[chave] = lidos[j]; });
    }
    return valores;
}

/**
 * The ids of every photo cited BY REFERENCE in a scope, read from its disk: all maps, not the one in
 * memory. A read failure THROWS: the callers decide, and none of them may read it as "cited by no one".
 * @param {Object} scope - The atlas scope.
 * @returns {Promise<Set<string>>}
 */
export async function idsDeFotosCitadasNoEscopo(scope) {
    const [maps, cesium3d, streetview360] = await Promise.all([
        valoresDaLoja(StoreName.MAPS, scope),
        valoresDaLoja(StoreName.CESIUM3D, scope),
        valoresDaLoja(StoreName.STREETVIEW360, scope),
    ]);
    return new Set(idsDeFotosPorReferencia({ maps, cesium3d, streetview360 }));
}

/**
 * The records that are refusals of attached photos no entity of the scope cites. Reads the census only
 * when there is at least one such refusal, which is the rare case: every other call costs nothing.
 * @param {Array<Object>} registros - The pendency records of the scope.
 * @param {Object} scope
 * @returns {Promise<Array<Object>>} Throws when the census cannot be read.
 */
export async function recusasDeFotoSemCitacao(registros, scope) {
    const recusas = registros.filter(ehRecusaDeFotoAnexa);
    if (recusas.length === 0) return [];
    const citadas = await idsDeFotosCitadasNoEscopo(scope);
    return recusas.filter((registro) => !citadas.has(registro.imageId));
}


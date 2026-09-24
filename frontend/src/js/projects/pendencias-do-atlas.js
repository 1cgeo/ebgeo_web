// Path: js/projects/pendencias-do-atlas.js

/**
 * @fileoverview How much work THIS computer still owes the server for a named server atlas, read
 * from `atlas.html`, which has no atlas mounted.
 *
 * WHY THE ATLAS PAGE NEEDS IT. "Copiar no servidor" clones the atlas ON THE SERVER, so the copy has
 * what the server has. Work still in this computer's queue (an edit waiting for the next flush, a
 * picture whose bytes are still uploading, and that picture's feature, held behind its bytes by the
 * outbound dispatcher) is not in the copy. Measured on 2026-09-24: a clone made a moment after
 * placing a picture came out without it, with no word (`tests/e2e-ui/copia-sem-figura-recem-posta.repro.spec.js`).
 *
 * TWO READS, BECAUSE THE PICTURE OWES TWICE. The operation queue holds the feature's operation
 * (prepared, held); the IMAGES store holds the upload pendency. Either one alone is enough to make
 * the copy incomplete, and reading both keeps the answer right in the window where the pendency is
 * registered and the feature not written yet.
 *
 * IT READS, IT NEVER MOUNTS, and it never OPENS a database this computer has no record of: an atlas
 * absent from the remote registry was never opened here, owes nothing, and opening its databases
 * to find that out would leave empty databases no purge knows about. An atlas whose namespace a
 * LOCAL slot has adopted (the logout rescue) is left out for the same reason the logout census
 * leaves it out: that work belongs to the local slot now, and opening the server atlas does not
 * send it.
 *
 * A READ THAT FAILS OR STALLS ANSWERS null, "unknown", and the caller asks. Zero would copy without
 * a word, which is the defect.
 *
 * REFUSED WORK IS COUNTED APART (review of 2026-09-24). Opening the atlas sends what is on its way,
 * never what the server refused, so the two need different advice, and the split is the queue's
 * OWN census (`countByState` on that atlas's queue, by `forScope`, which reads without mounting):
 * `pendentes` and `preparadas` go out, `problemas` do not.
 */

import { operationQueue } from '@store/sync/operation-queue.js';
import { listRemoteAtlases } from '@store/remote-atlas.api.js';
import { getStoreFor, readLocalAtlasRegistry, remoteScope, StoreName } from '@store/atlas-namespace.js';
import { BLOB_UPLOAD_KEY_PREFIX, BLOB_UPLOAD_PENDENTE } from '@store/sync/blob-upload-keys.js';

/** A census that has not answered by then is "unknown". The click is waiting on it. */
const PRAZO_DA_LEITURA_MS = 3000;

/**
 * Upload pendencies still owed to the server, in the IMAGES store of `scope`.
 * @param {{kind: string, atlasId: string, dbSuffix: string}} scope
 * @returns {Promise<number>}
 */
async function blobsPendentes(scope) {
    const store = getStoreFor(StoreName.IMAGES, scope);
    const chaves = (await store.keys()).filter(k => typeof k === 'string' && k.startsWith(BLOB_UPLOAD_KEY_PREFIX));
    const registros = await Promise.all(chaves.map(k => store.getItem(k)));
    return registros.filter(r => r?.estado === BLOB_UPLOAD_PENDENTE).length;
}

/**
 * @param {string} atlasId
 * @returns {Promise<{enviaveis: number, recusadas: number}>}
 */
async function contar(atlasId) {
    const nada = { enviaveis: 0, recusadas: 0 };
    const registrado = (await listRemoteAtlases()).find(e => e.atlasId === atlasId);
    if (!registrado) return nada;
    const adotados = new Set((await readLocalAtlasRegistry()).map(e => e.dbSuffix));
    if (adotados.has(registrado.dbSuffix)) return nada;
    const scope = remoteScope(atlasId);
    const [censo, figuras] = await Promise.all([
        operationQueue.forScope(scope).countByState(),
        blobsPendentes(scope),
    ]);
    const enviaveis = censo.pendentes + censo.preparadas + figuras;
    const recusadas = censo.problemas;
    if (!Number.isFinite(enviaveis) || !Number.isFinite(recusadas)) throw new Error('census is not a number');
    return { enviaveis, recusadas };
}

/**
 * What this computer still owes the server for `atlasId`, split by what the person can do about it.
 * `enviaveis` goes out when the atlas is open (queued and held operations, and pictures whose bytes
 * are not confirmed; a held picture counts twice, so read zero against non-zero only); `recusadas`
 * is what the server refused and only the Pendências panel decides about.
 * @param {string} atlasId - Server atlas UUID.
 * @returns {Promise<{enviaveis: number, recusadas: number}|null>} Zeros for an atlas never opened
 *   here; null when it could not be read.
 */
export async function pendenciasDoAtlasNesteComputador(atlasId) {
    if (typeof atlasId !== 'string' || atlasId.length === 0) return null;
    let timer;
    try {
        return await Promise.race([
            contar(atlasId),
            new Promise(resolve => { timer = setTimeout(() => resolve(null), PRAZO_DA_LEITURA_MS); }),
        ]);
    } catch (error) {
        console.warn('[atlas-copy] could not read the pending work of this computer:', error);
        return null;
    } finally {
        clearTimeout(timer);
    }
}

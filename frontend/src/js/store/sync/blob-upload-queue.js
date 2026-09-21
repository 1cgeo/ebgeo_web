// Path: js/store/sync/blob-upload-queue.js

/**
 * @fileoverview Durable per-atlas queue of image blobs waiting to reach the server.
 *
 * WHY IT EXISTS. There is no incremental sync operation for bytes: the operation vocabulary
 * carries features, maps, layers and the rest, never a blob. So an image resource travels by its
 * own door, and until this module existed the failure of that door was invisible. `uploadImageBlob`
 * warned the user once ("refaça a inserção quando a conexão voltar") and returned null, the caller
 * fell back to a local-only id, and nothing ever tried again: the author saw the picture and every
 * collaborator got a 404 forever. The comment in `customIcons.operations.js` promised a
 * reconciliation "on a later sync" that did not exist anywhere.
 *
 * THREE PROPERTIES DECIDE THE DESIGN, and each one is a defect that was measured.
 *
 * 1. THE RECORD IS WRITTEN BEFORE THE FIRST BYTE LEAVES. A pendency created after the upload
 *    cannot describe the upload that died halfway, which is exactly the case that needs it. The
 *    record is therefore the FIRST thing that happens, and the transfer the second.
 *
 * 2. THE ID IS THE CLIENT'S, ALWAYS, and that is why the transfer uses the BULK route.
 *    `POST /images/bulk` preserves `localId` as the row id, so a retry lands the bytes under the id
 *    the feature already carries; the single-image route mints its own id, which is why the old
 *    failure path (upload, fall back to a local id, never retry) could not be repaired by simply
 *    retrying: the second attempt would have produced a THIRD id. Since the upload-dedup columns of `images` (003_atlas.sql)
 *    the server recognises the retry by (id, content hash) and answers with the row it already has.
 *
 * 3. THE OPERATION WAITS FOR THE BLOB. An image feature whose operation reaches a peer before its
 *    bytes renders as a hole, and the outbound flush leaves every 1.5 s. The hold reuses the
 *    queue's own prepared mark (`operation-dispatcher.js` keeps the operation prepared while
 *    {@link blobUploadPending} is true for its entity), so the waiting is visible to the same
 *    census every other unfinished intention is visible to. It is a HEAD-OF-LINE hold, by
 *    construction: `_loadOperations` stops at the first prepared operation, so while the blob is
 *    pending nothing behind it is sent either. That is the honest state (the network is down, and
 *    nothing could be sent anyway), and a definitive refusal converts it into a per-entity problem
 *    via `recordIssue`, which the queue SKIPS instead of stopping at.
 *
 * WHERE THE RECORDS LIVE, and why not in a database of their own. They are keys prefixed
 * {@link KEY_PREFIX} inside the atlas's IMAGES store. A new logical store would be a new line in
 * `STORE_DESCRIPTORS`, and the pendency has no lifecycle of its own to justify one: it is
 * meaningful exactly while the blob it names is in that database. Sharing it costs two things, and
 * the first is small: `atlas-contents.js` must not count these keys as images, and it does not.
 *
 * THE SECOND IS THE ENTRY WIPE, AND IT WAS A DEFECT. This fileoverview used to say the sharing
 * made three lists right for free, the first being "the entry wipe empties it with the blobs". It
 * does not any more, and it must not: `openRemoteAtlas` empties the ten data databases and pulls
 * the server's snapshot back, so everything it destroys is re-fetchable EXCEPT a blob the server
 * never received. Destroying the pendency and its bytes left the resumption on `connect` with
 * nothing to resume, and the feature's prepared mark (head-of-line) then stopped the whole
 * outbound queue for good, silently. The wipe now spares a PENDENTE record and the bytes it names,
 * under the same answer that spares the outbound queue, because this blob is the payload of an
 * operation in it (`limparImagensPoupandoUploads` in `blob-upload-keys.js`,
 * `clearAllAtlasStores` in `store/repository.js`). The other two lists are unchanged: namespace
 * destruction (confirmed logout) drops the records with the blobs, and a local-atlas copy carries
 * them as inert baggage, because a local atlas never uploads.
 *
 * NOTHING HERE THROWS. A failed upload costs a picture; a gesture aborted by a network error costs
 * the drawing. The callers get a verdict object and decide what to say.
 *
 * ONE GAP, DECLARED. A definitive refusal on the FIRST attempt happens before the feature's
 * operation exists (the caller uploads and only then writes the feature), so there is nothing to
 * mark with an issue: the caller is told, the picture stays local, and the peer draws the error
 * placeholder under an id the server refused. The refusal that the operation DOES hear about is the
 * one that arrives on a resumption, which is the case the retry produces. Closing the first one
 * needs the dispatcher to ask about refused ids too, and that question has no home yet.
 */

import {
    StoreName,
    getStoreFor,
    getActiveScope,
    StoreScopeKind
} from '@store/atlas-namespace.js';
import { captureRemoteWriteFence } from '../remote-write-fence.js';
import { fenceStore } from '../fenced-store.js';
// Direct file, never the `@utils` barrel: it drags the whole store back in through
// `feature_navigation_utils`, and this module is imported by the outbound dispatcher.
import { generateUUID } from '@utils/uuid.js';
import { apiClient } from './api-client.js';
import { operationQueue } from './operation-queue.js';
import { BLOB_UPLOAD_KEY_PREFIX, BLOB_UPLOAD_PENDENTE } from './blob-upload-keys.js';
import {
    CausaDeFalha,
    FALHA_SEM_BYTES,
    causaDeErroLancado,
    fraseDeFalhaDeBlob,
    mensagemCrua
} from './blob-upload-phrases.js';

/**
 * Key prefix of a pendency record inside the atlas IMAGES store.
 *
 * Defined in a zero-import leaf because `store/atlas-contents.js` also needs it, and that module is
 * reached by `atlas.html`, which boots with no store: see `blob-upload-keys.js`.
 */
const KEY_PREFIX = BLOB_UPLOAD_KEY_PREFIX;

/**
 * States of one attempt. `pendente` is retried; the other two never are.
 * @readonly
 * @enum {string}
 */
export const BlobUploadState = Object.freeze({
    /**
     * Registered, not confirmed by the server: eligible for resumption.
     *
     * The string is defined in the zero-import leaf because the atlas WIPE has to recognise it
     * without importing this module's graph (`limparImagensPoupandoUploads`).
     */
    PENDENTE: BLOB_UPLOAD_PENDENTE,
    /** The server holds the bytes under this id. */
    CONFIRMADO: 'confirmado',
    /** The server refused for a reason no retry changes (type, size, id taken by other bytes). */
    RECUSADO: 'recusado'
});

/** HTTP statuses whose refusal no retry repairs. */
const RECUSA_DEFINITIVA = new Set([400, 403, 404, 413, 415, 422]);

/** Backoff between resumed attempts, in ms. Serial on purpose: a blob can be megabytes. */
const BACKOFF_MS = [0, 1000, 4000];

/**
 * Image ids whose bytes are registered and not yet confirmed, mirrored in memory.
 *
 * IT EXISTS BECAUSE THE HOLD DECISION IS SYNCHRONOUS: `operation-dispatcher.js` has to decide
 * whether to keep an operation prepared while it is building the batch, and a disk read there
 * would turn every edit into an IndexedDB round trip. Staleness is harmless in the one direction
 * it can happen: a set emptied by a reload cannot release a hold, because the prepared mark is on
 * disk and the head-of-line rule holds everything behind it regardless of what this set says.
 * @type {Set<string>}
 */
const _pendentes = new Set();

/**
 * @returns {{kind: string, dbSuffix: string}|null} The active scope when it is a SERVER atlas, else
 *   null. A local atlas has nowhere to upload to, and asking costs no read.
 */
function escopoRemoto() {
    const scope = getActiveScope();
    return scope && scope.kind === StoreScopeKind.REMOTE ? scope : null;
}

/**
 * @param {{kind: string, dbSuffix: string}} scope - A remote scope.
 * @returns {object} The IMAGES store of that scope, fenced like every other remote write.
 */
function loja(scope) {
    return fenceStore(getStoreFor(StoreName.IMAGES, scope), captureRemoteWriteFence(scope));
}

/**
 * @param {string} tentativaId
 * @returns {string} The record key.
 */
function chaveDe(tentativaId) {
    return `${KEY_PREFIX}${tentativaId}`;
}

/**
 * Whether an image id has bytes registered and not confirmed on the server.
 *
 * Synchronous by contract: it is read while an outbound batch is being built.
 * @param {string} imageId
 * @returns {boolean}
 */
export function blobUploadPending(imageId) {
    return typeof imageId === 'string' && _pendentes.has(imageId);
}

/**
 * The image ids whose bytes are still owed to the server, READ FROM DISK.
 *
 * IT EXISTS BECAUSE THE MEMORY MIRROR IS EMPTY EXACTLY WHEN THE HANDSHAKE NEEDS THE ANSWER. The
 * mirror above is filled by {@link retomarBlobsPendentes}, which runs INSIDE the connect it would
 * have to precede: a reload comes back with `_pendentes` empty, and the snapshot's re-projection
 * of pending intentions (`applyRemoteSnapshot`, `remote-operation-handler.js`) happens in that same
 * handshake. Asking the mirror there answers "nothing is pending" and releases the operation of an
 * image feature whose bytes are still on this machine: measured three times out of three, the peer
 * fetched the image 1 s before the upload finished, took a 404 and drew the error placeholder
 * under that id, permanently (the placeholder is never replaced once installed).
 *
 * The synchronous {@link blobUploadPending} stays the answer where the caller cannot await (the
 * outbound batch being built); this one is for the paths that can.
 * @returns {Promise<Set<string>>} Ids with a PENDENTE record; empty in a local atlas.
 */
export async function idsComBlobPendente() {
    const ids = new Set();
    for (const registro of await listarPendenciasDeBlob()) {
        if (registro?.estado === BlobUploadState.PENDENTE && typeof registro.imageId === 'string') {
            ids.add(registro.imageId);
        }
    }
    return ids;
}

/**
 * Every pendency record of the mounted atlas, newest last.
 * @returns {Promise<Array<Object>>} Records; empty in a local atlas and on any read failure.
 */
export async function listarPendenciasDeBlob() {
    const scope = escopoRemoto();
    if (!scope) return [];
    try {
        const store = loja(scope);
        const chaves = (await store.keys()).filter(k => k.startsWith(KEY_PREFIX));
        const registros = [];
        for (const chave of chaves) {
            const registro = await store.getItem(chave);
            if (registro) registros.push(registro);
        }
        return registros.sort((a, b) => (a.criadoEm ?? 0) - (b.criadoEm ?? 0));
    } catch (error) {
        console.warn('[blob-upload-queue] could not read the pending uploads:', error);
        return [];
    }
}

/**
 * Writes (or rewrites) one record.
 * @param {object} scope - The remote scope.
 * @param {Object} registro - The record.
 * @returns {Promise<void>}
 */
async function gravar(scope, registro) {
    await loja(scope).setItem(chaveDe(registro.tentativaId), registro);
}

/**
 * Reflects a record's state into the in-memory set of held ids.
 * @param {Object} registro
 * @returns {void}
 */
function espelhar(registro) {
    if (registro.estado === BlobUploadState.PENDENTE) _pendentes.add(registro.imageId);
    else _pendentes.delete(registro.imageId);
}

/**
 * Releases the prepared marks of every queued operation of one entity.
 *
 * THE WHOLE ENTITY, not the newest operation of it: the hold is head-of-line, so releasing an
 * UPDATE while its CREATE stays prepared would leave the queue exactly as blocked, and the release
 * would look like it worked. `getAll` is the only reader that returns prepared envelopes too,
 * which is why the filter happens here and not through `peek`.
 * @param {string} entityId - The image id, which for an image feature is also its feature id.
 * @returns {Promise<number>} How many operations were released.
 */
async function liberarOperacoes(entityId) {
    try {
        const todas = await operationQueue.getAll();
        const minhas = todas.filter(op => op.entityId === entityId);
        if (minhas.length > 0) await operationQueue.markMaterialized(minhas);
        return minhas.length;
    } catch (error) {
        console.warn('[blob-upload-queue] could not release the operations waiting for a blob:', error);
        return 0;
    }
}

/**
 * Turns a refused blob into a durable problem on the operations that were waiting for it.
 *
 * The operations are NOT released: a released operation would be sent, and the peer would draw a
 * hole under an id the server refused. They are marked with an issue, which the queue skips
 * (instead of stopping at) and the census counts as a problem, so the rest of the atlas keeps
 * synchronising while this one entity waits for a person.
 * @param {string} entityId - The image id.
 * @param {string} motivo - pt-BR reason, shown to whoever reviews the pendency.
 * @param {number|null} status - HTTP status, when there was one.
 * @returns {Promise<number>} How many operations received an issue.
 */
async function marcarProblema(entityId, motivo, status) {
    try {
        const todas = await operationQueue.getAll();
        const minhas = todas.filter(op => op.entityId === entityId);
        for (const op of minhas) {
            await operationQueue.recordIssue(op, { rejected: true, reason: motivo, status });
        }
        return minhas.length;
    } catch (error) {
        console.warn('[blob-upload-queue] could not record the issue of a refused blob:', error);
        return 0;
    }
}

/**
 * Classifies a thrown transport error.
 *
 * THE MESSAGE IS THE RAW ONE, and it stays raw all the way to {@link assentar}: it is the browser's
 * or the server's own text (`Failed to fetch` is the common one), which is diagnosis and never a
 * sentence for a person. What the person reads is composed from `causa` by `blob-upload-phrases.js`.
 * @param {*} error
 * @returns {{definitiva: boolean, status: number|null, causa: string, motivo: string|null}}
 */
function classificarErro(error) {
    const status = error?.status ?? error?.statusCode ?? null;
    const definitiva = status !== null && RECUSA_DEFINITIVA.has(status);
    return {
        definitiva,
        status,
        causa: causaDeErroLancado({ status, definitiva }),
        motivo: mensagemCrua(error?.message)
    };
}

/**
 * Sends a whole batch of blobs through the bulk route, which is the only one that keeps the ids.
 *
 * ONE REQUEST PER CHUNK OF 50, not one per blob, because the copy gestures hand over dozens at a
 * time ("Duplicar Seleção", a layer copied to another map): a request per picture would turn one
 * paste into a burst a just-restored connection cannot afford. `uploadImagesInChunks` already
 * merges the per-chunk results and counts the chunks that got no answer at all.
 *
 * @param {string} atlasId
 * @param {Array<[string, Blob]>} pares - Id and bytes of each blob.
 * @returns {Promise<Map<string, {confirmado: boolean, definitiva: boolean, status: number|null, motivo: string}>>}
 *   One verdict per id: an id the answer did not mention gets a verdict too, never silence.
 */
async function transferirLote(atlasId, pares) {
    // Dynamic, as in `upload-copied-blobs.js`: the store's static graph must not grow an edge into
    // the lazy import/export chunk group.
    const { buildImageUploads, uploadImagesInChunks } =
        await import('@js/import_export/atlas-image-upload.js');

    const veredictos = new Map();
    const { uploads, skipped } = await buildImageUploads(pares);
    for (const id of skipped) {
        // Refused HERE, before a byte leaves: there is no server message to quote, and the cause is
        // known outright.
        veredictos.set(id, {
            confirmado: false, definitiva: true, status: null,
            causa: CausaDeFalha.ARQUIVO, motivo: null
        });
    }
    if (uploads.length === 0) return veredictos;

    const { mapping, failed, transportErrors } = await uploadImagesInChunks(apiClient, atlasId, uploads);
    const motivoPorId = new Map((failed ?? []).map(item => [item?.localId, item?.error]));
    for (const { localId } of uploads) {
        if (mapping[localId]) {
            veredictos.set(localId, {
                confirmado: true, definitiva: false, status: null, causa: null, motivo: null
            });
            continue;
        }
        // `uploadImagesInChunks` folds a transport failure into `failed` too, so the count of chunks
        // that never got an answer is the ONLY thing separating "the server refused" from "the
        // network dropped". Without it every outage would read as a definitive refusal and the retry
        // this module exists for would never happen. The count is per REQUEST, not per item, so a
        // batch that lost one chunk treats its unanswered items as transient, which is the safe side.
        veredictos.set(localId, transportErrors > 0
            ? {
                confirmado: false, definitiva: false, status: null,
                causa: CausaDeFalha.REDE, motivo: mensagemCrua(motivoPorId.get(localId))
            }
            : {
                confirmado: false, definitiva: true, status: null,
                causa: CausaDeFalha.RECUSA, motivo: mensagemCrua(motivoPorId.get(localId))
            });
    }
    return veredictos;
}

/**
 * Writes one verdict onto its record, and does to the waiting operations what the verdict implies.
 * @param {object} scope - The remote scope.
 * @param {Object} registro - The record as stored.
 * @param {{confirmado: boolean, definitiva: boolean, status: number|null, motivo: string}} desfecho
 * @returns {Promise<Object>} The record as it now stands on disk.
 */
async function assentar(scope, registro, desfecho) {
    // THE TRANSLATION HAPPENS HERE, in the one place every path passes through: three producers
    // build verdicts and each of them would otherwise need to remember to write a pt-BR sentence.
    // `ultimoErro` is what the pendency panel renders; `ultimoErroCru` is the untouched message,
    // kept for diagnosis and read by no screen.
    const atualizado = {
        ...registro,
        tentativas: (registro.tentativas ?? 0) + 1,
        atualizadoEm: Date.now(),
        estado: desfecho.confirmado
            ? BlobUploadState.CONFIRMADO
            : (desfecho.definitiva ? BlobUploadState.RECUSADO : BlobUploadState.PENDENTE),
        ultimoErro: desfecho.confirmado ? null : fraseDeFalhaDeBlob(desfecho),
        ultimoErroCru: desfecho.confirmado ? null : mensagemCrua(desfecho.motivo)
    };

    try {
        await gravar(scope, atualizado);
    } catch (error) {
        // The disk refused the state, not the transfer. Keeping the id held is the safe side: an
        // operation that waits is recoverable, one sent ahead of its bytes is a hole on the peer.
        console.warn('[blob-upload-queue] could not record the outcome of an upload:', error);
        return registro;
    }
    espelhar(atualizado);

    if (atualizado.estado === BlobUploadState.CONFIRMADO) {
        await liberarOperacoes(atualizado.imageId);
    } else if (atualizado.estado === BlobUploadState.RECUSADO) {
        await marcarProblema(atualizado.imageId, atualizado.ultimoErro, desfecho.status ?? null);
    }
    return atualizado;
}

/** A verdict for an id the answer did not mention. Transient, because silence is not a refusal. */
const semVeredicto = () => ({
    confirmado: false, definitiva: false, status: null,
    causa: CausaDeFalha.SEM_RESPOSTA, motivo: null
});

/**
 * One attempt over an already registered record. Updates the record and the held set.
 * @param {object} scope - The remote scope.
 * @param {Object} registro - The record, as stored.
 * @param {Blob} blob - The bytes.
 * @returns {Promise<Object>} The record as it now stands on disk.
 */
async function tentar(scope, registro, blob) {
    let desfecho;
    try {
        const veredictos = await transferirLote(registro.atlasId, [[registro.imageId, blob]]);
        desfecho = veredictos.get(registro.imageId) ?? semVeredicto();
    } catch (error) {
        desfecho = { confirmado: false, ...classificarErro(error) };
    }
    return assentar(scope, registro, desfecho);
}

/**
 * Builds one pendency record. It is written to disk by the caller, BEFORE any byte leaves.
 * @param {string} imageId
 * @param {string} atlasId
 * @param {string} origem
 * @param {Blob} blob
 * @returns {Object}
 */
function novoRegistro(imageId, atlasId, origem, blob) {
    return {
        tentativaId: generateUUID(),
        imageId,
        atlasId,
        origem,
        mime: blob.type || null,
        tamanho: blob.size ?? null,
        estado: BlobUploadState.PENDENTE,
        tentativas: 0,
        ultimoErro: null,
        ultimoErroCru: null,
        criadoEm: Date.now(),
        atualizadoEm: Date.now()
    };
}

/**
 * Registers a BATCH of blobs and attempts to send them, in that order.
 *
 * IT IS THE PRIMITIVE OF THE MODULE and {@link enfileirarBlob} is the one-item case. The copy
 * gestures (paste, "Colar Aqui", "Duplicar Seleção", a layer copied to another map) mint new ids
 * for bytes that already exist and hand them over together, and they used to upload OUTSIDE any
 * queue: a failed chunk cost a picture with nothing recorded anywhere and nothing to retry it.
 *
 * @param {Iterable<[string, Blob]>} pares - Id and bytes of each blob.
 * @param {Object} params
 * @param {string} params.atlasId - The connected atlas.
 * @param {string} [params.origem] - Label for the records, so a pendency names the gesture.
 * @returns {Promise<{registrados: string[], confirmados: string[], pendentes: string[], recusados: Array<{imageId: string, motivo: string}>}>}
 */
export async function enfileirarBlobs(pares, { atlasId, origem = 'copia' }) {
    const lista = [...pares].filter(par => par && par[0] && par[1]);
    const vazio = { registrados: [], confirmados: [], pendentes: [], recusados: [] };
    const scope = escopoRemoto();
    if (!scope || !atlasId || lista.length === 0) return vazio;

    const bytesPorId = new Map(lista);
    const registros = [];
    for (const [imageId, blob] of lista) {
        const registro = novoRegistro(imageId, atlasId, origem, blob);
        try {
            await gravar(scope, registro);
        } catch (error) {
            // WITHOUT A RECORD THERE IS NO RETRY, so there must be no hold either.
            console.warn('[blob-upload-queue] could not register an upload attempt:', error);
            continue;
        }
        espelhar(registro);
        registros.push(registro);
    }
    if (registros.length === 0) return vazio;

    let veredictos;
    try {
        veredictos = await transferirLote(
            atlasId, registros.map(r => [r.imageId, bytesPorId.get(r.imageId)])
        );
    } catch (error) {
        const desfecho = { confirmado: false, ...classificarErro(error) };
        veredictos = new Map(registros.map(r => [r.imageId, desfecho]));
    }

    const resultado = {
        registrados: registros.map(r => r.imageId),
        confirmados: [], pendentes: [], recusados: []
    };
    for (const registro of registros) {
        const final = await assentar(scope, registro, veredictos.get(registro.imageId) ?? semVeredicto());
        if (final.estado === BlobUploadState.CONFIRMADO) {
            resultado.confirmados.push(final.imageId);
        } else if (final.estado === BlobUploadState.RECUSADO) {
            resultado.recusados.push({ imageId: final.imageId, motivo: final.ultimoErro });
        } else {
            resultado.pendentes.push(final.imageId);
        }
    }
    return resultado;
}

/**
 * Registers a blob and attempts to send it, in that order.
 *
 * @param {Object} params
 * @param {string} params.imageId - The id the feature (or the icon registry) already carries.
 * @param {Blob} params.blob - The bytes, already written to the local store by the caller.
 * @param {string} params.atlasId - The connected atlas.
 * @param {string} [params.origem] - Label for the record, so a pendency names the gesture.
 * @returns {Promise<{registrado: boolean, confirmado: boolean, estado: string|null, motivo: string}>}
 *   `registrado: false` means a local atlas (nothing to upload and nothing recorded).
 */
export async function enfileirarBlob({ imageId, blob, atlasId, origem = 'imagem' }) {
    const scope = escopoRemoto();
    if (!scope || !atlasId || !imageId || !blob) {
        return { registrado: false, confirmado: false, estado: null, motivo: '' };
    }

    const registro = novoRegistro(imageId, atlasId, origem, blob);

    try {
        await gravar(scope, registro);
    } catch (error) {
        // WITHOUT A RECORD THERE IS NO RETRY, so there must be no hold either: holding an id whose
        // pendency nobody can read would stall the queue with nothing able to release it.
        console.warn('[blob-upload-queue] could not register an upload attempt:', error);
        return { registrado: false, confirmado: false, estado: null, motivo: '' };
    }
    espelhar(registro);

    const final = await tentar(scope, registro, blob);
    return {
        registrado: true,
        confirmado: final.estado === BlobUploadState.CONFIRMADO,
        estado: final.estado,
        motivo: final.ultimoErro || ''
    };
}

/**
 * Resumes every pending upload of the mounted atlas, in series.
 *
 * IN SERIES AND WITH BACKOFF because each item is a full blob: a parallel burst on a connection
 * that just came back is how a reconnection turns into a second outage. The blob is read back from
 * the local store, and a record whose bytes are gone is closed as refused instead of retried
 * forever: nothing will ever produce those bytes again.
 *
 * @param {string} atlasId - The connected atlas; records of another atlas are ignored.
 * @returns {Promise<{tentadas: number, confirmadas: number, pendentes: number, recusadas: number}>}
 */
export async function retomarBlobsPendentes(atlasId) {
    const scope = escopoRemoto();
    const resumo = { tentadas: 0, confirmadas: 0, pendentes: 0, recusadas: 0 };
    if (!scope || !atlasId) return resumo;

    const registros = (await listarPendenciasDeBlob())
        .filter(r => r.estado === BlobUploadState.PENDENTE && r.atlasId === atlasId);
    for (const registro of registros) espelhar(registro);

    for (const registro of registros) {
        const espera = BACKOFF_MS[Math.min(registro.tentativas ?? 0, BACKOFF_MS.length - 1)];
        if (espera > 0) await new Promise(resolve => setTimeout(resolve, espera));

        let blob = null;
        try {
            blob = await loja(scope).getItem(registro.imageId);
        } catch (error) {
            console.warn('[blob-upload-queue] could not read a pending blob:', error);
        }
        resumo.tentadas += 1;

        if (!blob) {
            const semBytes = {
                ...registro,
                estado: BlobUploadState.RECUSADO,
                ultimoErro: FALHA_SEM_BYTES,
                ultimoErroCru: null,
                atualizadoEm: Date.now()
            };
            try {
                await gravar(scope, semBytes);
                espelhar(semBytes);
                await marcarProblema(semBytes.imageId, semBytes.ultimoErro, null);
            } catch (error) {
                console.warn('[blob-upload-queue] could not close a pendency without bytes:', error);
            }
            resumo.recusadas += 1;
            continue;
        }

        const final = await tentar(scope, registro, blob);
        if (final.estado === BlobUploadState.CONFIRMADO) resumo.confirmadas += 1;
        else if (final.estado === BlobUploadState.RECUSADO) resumo.recusadas += 1;
        else resumo.pendentes += 1;
    }
    return resumo;
}

/**
 * Drops the in-memory mirror. For a scope change and for tests; the records on disk are the truth
 * and are dropped with the namespace they live in.
 * @returns {void}
 */
export function esquecerPendenciasEmMemoria() {
    _pendentes.clear();
}

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
 *    retrying: the second attempt would have produced a THIRD id. Since 013_imagens_idempotentes.sql
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
 * meaningful exactly while the blob it names is in that database. Sharing the database makes the
 * three lists that matter correct for free — the entry wipe empties it with the blobs, namespace
 * destruction (confirmed logout) drops it with the blobs, and a local-atlas copy carries it as
 * inert baggage, because a local atlas never uploads. The one thing the sharing costs is that
 * `atlas-contents.js` must not count these keys as images, and it does not.
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
import { BLOB_UPLOAD_KEY_PREFIX } from './blob-upload-keys.js';

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
    /** Registered, not confirmed by the server: eligible for resumption. */
    PENDENTE: 'pendente',
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
 * @param {*} error
 * @returns {{definitiva: boolean, status: number|null, motivo: string}}
 */
function classificarErro(error) {
    const status = error?.status ?? error?.statusCode ?? null;
    return {
        definitiva: status !== null && RECUSA_DEFINITIVA.has(status),
        status,
        motivo: error?.message || 'Falha de rede ao enviar a imagem.'
    };
}

/**
 * Sends ONE blob through the bulk route, which is the only one that keeps the id.
 * @param {string} atlasId
 * @param {string} imageId
 * @param {Blob} blob
 * @returns {Promise<{confirmado: boolean, definitiva: boolean, status: number|null, motivo: string}>}
 */
async function transferir(atlasId, imageId, blob) {
    // Dynamic, as in `upload-copied-blobs.js`: the store's static graph must not grow an edge into
    // the lazy import/export chunk group.
    const { buildImageUploads, uploadImagesInChunks } =
        await import('@js/import_export/atlas-image-upload.js');

    const { uploads, skipped } = await buildImageUploads([[imageId, blob]]);
    if (uploads.length === 0) {
        return {
            confirmado: false,
            definitiva: true,
            status: null,
            motivo: skipped.length > 0
                ? 'O servidor não aceita este formato de imagem.'
                : 'A imagem não pôde ser preparada para envio.'
        };
    }

    const { mapping, failed, transportErrors } = await uploadImagesInChunks(apiClient, atlasId, uploads);
    if (mapping[imageId]) {
        return { confirmado: true, definitiva: false, status: null, motivo: '' };
    }
    // `uploadImagesInChunks` folds a transport failure into `failed` too, so the count of chunks
    // that never got an answer is the ONLY thing that separates "the server refused" from "the
    // network dropped". Without it every outage would be read as a definitive refusal and the
    // retry this module exists for would never happen.
    if (transportErrors > 0) {
        return {
            confirmado: false, definitiva: false, status: null,
            motivo: failed[0]?.error || 'A imagem não chegou ao servidor.'
        };
    }
    return {
        confirmado: false, definitiva: true, status: null,
        motivo: failed[0]?.error || 'O servidor recusou a imagem.'
    };
}

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
        desfecho = await transferir(registro.atlasId, registro.imageId, blob);
    } catch (error) {
        desfecho = { confirmado: false, ...classificarErro(error) };
    }

    const atualizado = {
        ...registro,
        tentativas: (registro.tentativas ?? 0) + 1,
        atualizadoEm: Date.now(),
        estado: desfecho.confirmado
            ? BlobUploadState.CONFIRMADO
            : (desfecho.definitiva ? BlobUploadState.RECUSADO : BlobUploadState.PENDENTE),
        ultimoErro: desfecho.confirmado ? null : desfecho.motivo
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

    const registro = {
        tentativaId: generateUUID(),
        imageId,
        atlasId,
        origem,
        mime: blob.type || null,
        tamanho: blob.size ?? null,
        estado: BlobUploadState.PENDENTE,
        tentativas: 0,
        ultimoErro: null,
        criadoEm: Date.now(),
        atualizadoEm: Date.now()
    };

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
                ultimoErro: 'Os bytes desta imagem não estão mais neste computador.',
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

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
 * THE GAP THAT WAS DECLARED HERE IS CLOSED (2026-09-23). A definitive refusal on the FIRST attempt
 * used to happen before the feature's operation existed, because the image tool awaited the whole
 * upload and only then wrote the feature: there was nothing to mark, and the peer drew the error
 * placeholder under an id the server refused. It also meant that on a slow link the picture
 * appeared for its author only when the upload ended (38.7 s for 138 KB at 40 kbps, measured), with
 * nothing on screen meanwhile. Now the tool REGISTERS the pendency ({@link registrarBlob}, awaited:
 * the record on disk and the id held) and writes the feature at once, while the transfer
 * ({@link enviarBlobRegistrado}) runs behind it. A refusal can then land on either side of the
 * operation's birth, and both are covered: after it, {@link marcarProblema} finds the operation;
 * before it, the id stays in the refused set ({@link blobUploadRefusal}) and the dispatcher turns the
 * operation into a durable issue at birth instead of releasing it.
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
// Leaf modules (zero imports).
import { EntityType } from './operation-types.js';
import { idsDeFotosDaEntidade } from '@js/user_data/photo-refs.js';
import { connectionState } from './connection-state.js';
import { BLOB_UPLOAD_KEY_PREFIX, BLOB_UPLOAD_PENDENTE, BLOB_UPLOAD_RECUSADO } from './blob-upload-keys.js';
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
    RECUSADO: BLOB_UPLOAD_RECUSADO
});

/** HTTP statuses whose refusal no retry repairs. */
const RECUSA_DEFINITIVA = new Set([400, 403, 404, 413, 415, 422]);

/** Backoff between resumed attempts, in ms. Serial on purpose: a blob can be megabytes. */
const BACKOFF_MS = [0, 1000, 4000];

/**
 * Delays of the resumption that runs WHILE THE CONNECTION STAYS UP, in ms, one per consecutive
 * transient failure (the last one repeats).
 *
 * WHY A THIRD TRIGGER (2026-09-23). The resumption ran only on a connect and on the transition back
 * to ONLINE (`image-sync.js`), both driven by the collab SOCKET. A transfer that fails while the
 * socket stays up (the bulk request cut by its deadline, a 502 from a proxy, a 5xx) has neither: the
 * pendency stayed PENDENTE, the feature operation stayed prepared, and the head-of-line hold of
 * `_loadOperations` kept every later edit on this machine until something reconnected, which on a
 * healthy socket can be hours. `tests/e2e-ui/subida-de-imagem-pendurada.repro.spec.js`.
 */
const RETOMADA_COM_CONEXAO_MS = [15000, 30000, 60000, 120000, 300000];

/** The single timer of {@link agendarRetomada}, and how many transient failures in a row it has seen. */
let _retomadaAgendada = null;
let _falhasSeguidas = 0;

/**
 * Image ids with a transfer IN FLIGHT from this page: one transfer per id at a time.
 *
 * WHY (2026-09-24, review of the image tool change). The tool stopped waiting for the upload, so
 * two pictures in a row go up in parallel, and a resumption (the 15 s timer after one of them
 * failed, a reconnection) re-reads every PENDENTE record, including one whose FIRST attempt is still
 * on the wire. On a 40 kbps link that is three streams plus the push sharing 5000 B/s, each under
 * the 2000 B/s floor `uploadDeadlineMs` is sized for, all cut, and the cycle could repeat. And the
 * duplicate's verdict was written from the record read before the original ended: a duplicate that
 * failed AFTER the original confirmed put PENDENTE back on disk over CONFIRMADO, and the feature's
 * operations stayed held until the next resumption.
 * @type {Set<string>}
 */
const _emVoo = new Set();

/**
 * Image ids RESERVED by {@link registrarBlob} until the caller says {@link enviarBlobRegistrado} or
 * {@link descartarBlobRegistrado}: the window in which the entity is being saved.
 *
 * WHY (2026-09-24, final review). The record is on disk from the registration on, and a resumption
 * landing in that window (the 15 s timer, the transition back to ONLINE, a connect) read it as an
 * ordinary PENDENTE and started the upload before the save had an outcome. A save that then
 * succeeded found its own id in flight and reported the old record as a failure, with the upload
 * running; a save that was refused dropped the record, and the in-flight attempt wrote it back.
 * The resumption skips a reserved id. The reservation lives in memory only: an F5 in the window
 * drops it, and the record on disk is resumed on connect like any other.
 * @type {Set<string>}
 */
const _reservados = new Set();

/**
 * Schedules one resumption of the pending blobs of `atlasId`, unless one is already scheduled.
 *
 * It does nothing when it fires OFFLINE: the transition back to ONLINE is the trigger that owns that
 * case, and it runs at once. It never throws; a resumption that fails again schedules the next one
 * from {@link assentar}.
 * @param {string} atlasId
 * @returns {void}
 */
function agendarRetomada(atlasId) {
    if (_retomadaAgendada || !atlasId) return;
    const espera = RETOMADA_COM_CONEXAO_MS[Math.min(_falhasSeguidas, RETOMADA_COM_CONEXAO_MS.length - 1)];
    _falhasSeguidas += 1;
    _retomadaAgendada = setTimeout(() => {
        _retomadaAgendada = null;
        if (!escopoRemoto() || !connectionState.isOnline()) return;
        retomarBlobsPendentes(atlasId).catch(() => {
            // Best effort: the pendency stays on disk, and the next trigger tries again.
        });
    }, espera);
    _retomadaAgendada?.unref?.();
}

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
 * Image ids whose bytes the server refused for good, with the reason, mirrored in memory.
 *
 * The other half of {@link _pendentes}: an operation born AFTER its blob was refused must not be
 * released either, and the dispatcher asks synchronously, while it builds the batch. Only the
 * current page needs it: an operation that already existed at the refusal got its issue from
 * {@link marcarProblema}, on disk.
 * @type {Map<string, {motivo: string, status: (number|null)}>}
 */
const _recusados = new Map();

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
 * Whether an operation has to wait for bytes the server has not confirmed yet.
 *
 * TWO WAYS TO CITE A BLOB, ONE RULE. An image feature IS its blob (its `entityId` is the image id),
 * and that was the only case until 2026-09-24. An attached photo has an id of its own, cited from
 * the entity's `properties.images` (a feature) or `images` (a 3D or 360 item), and the review of
 * phases 2b/2c found the loss it allowed: on a 40 kbps link, renaming a feature whose photo was just
 * converted sent the operation in a second while the photo took minutes; "Sair" counted zero pending
 * operations and asked nothing, the namespace and the bytes died, and the server kept a reference to
 * a picture it would never receive, for everyone. The operation now waits for every photo it cites,
 * exactly like the image feature waits for itself.
 *
 * A REFUSED photo does not hold (only a pending one does): the operation leaves with the reference,
 * the thumbnail keeps drawing, and the notice already named the photo.
 *
 * @param {{entityType: string, entityId: string, data?: Object}} op
 * @param {Set<string>} [pendentes] - Ids with pending bytes; the memory mirror by default, the disk
 *   read (`idsComBlobPendente`) where the mirror can be empty (the snapshot inside a connect)
 * @returns {boolean}
 */
export function operacaoEsperaBlob(op, pendentes = _pendentes) {
    if (!op) return false;
    if (op.entityType === EntityType.FEATURE && pendentes.has(op.entityId)) return true;
    return idsDeFotosDaEntidade(op.data).some((id) => pendentes.has(id));
}

/**
 * Whether an operation cites an image id: as its own blob (an image feature) or as a photo.
 * @param {Object} op
 * @param {string} imageId
 * @returns {boolean}
 */
function operacaoCita(op, imageId) {
    return op?.entityId === imageId || idsDeFotosDaEntidade(op?.data).includes(imageId);
}

/**
 * The single line every transfer of this page waits in: ONE blob on the wire at a time.
 *
 * WHY (2026-09-24, review). An edit that converts N inline photos, or N photos attached in a row,
 * called `enviar` N times without awaiting, and N transfers shared a link sized for one: at 40 kbps
 * each one falls under the 2000 B/s floor its deadline is sized for, all are cut, and the cycle can
 * repeat (the same arithmetic as {@link _emVoo}). The resumption was already serial; this puts the
 * first attempts in the same line. The COPIES stay out of it ({@link enfileirarBlobs}): a gesture
 * awaits them, and a gesture must not wait for a photo that is not its own.
 * @type {Promise<void>}
 */
let _filaDeTransferencia = Promise.resolve();

/**
 * Image ids WAITING in {@link _filaDeTransferencia}, not yet on the wire. A second send of the same
 * id steps aside as it does for one on the wire ({@link _emVoo}): queueing it would upload the same
 * bytes twice, and a caller waiting behind its own first attempt would never return.
 * @type {Set<string>}
 */
const _naFila = new Set();

/**
 * Runs one transfer when the ones before it have ended. Never rejects on behalf of an earlier one.
 * @template T
 * @param {() => Promise<T>} transferir
 * @returns {Promise<T>}
 */
function emSerie(transferir) {
    const vez = _filaDeTransferencia.then(transferir);
    _filaDeTransferencia = vez.then(() => undefined, () => undefined);
    return vez;
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
    if (registro.estado === BlobUploadState.RECUSADO) {
        _recusados.set(registro.imageId, { motivo: registro.ultimoErro, status: registro.ultimoStatus ?? null });
    } else {
        _recusados.delete(registro.imageId);
    }
}

/**
 * Why the server refused the bytes of an image id for good, or null. Synchronous by contract, like
 * {@link blobUploadPending}: the dispatcher asks while it builds the batch.
 * @param {string} imageId
 * @returns {{motivo: string, status: (number|null)}|null}
 */
export function blobUploadRefusal(imageId) {
    return (typeof imageId === 'string' && _recusados.get(imageId)) || null;
}

/**
 * Releases the prepared marks of every queued operation of one entity.
 *
 * THE WHOLE ENTITY, not the newest operation of it: the hold is head-of-line, so releasing an
 * UPDATE while its CREATE stays prepared would leave the queue exactly as blocked, and the release
 * would look like it worked. `getAll` is the only reader that returns prepared envelopes too,
 * which is why the filter happens here and not through `peek`.
 *
 * AN OPERATION THAT STILL WAITS FOR ANOTHER BLOB STAYS HELD (2026-09-24): an edit that cites two
 * photos leaves when the SECOND one is confirmed, never in between.
 * @param {string} entityId - The image id: an image feature's own id, or a photo's.
 * @param {Object} [opcoes]
 * @param {boolean} [opcoes.soFotos=false] - Release only the operations that cite it as a PHOTO
 *   (the refusal of a photo; an image feature refused becomes an issue instead).
 * @returns {Promise<number>} How many operations were released.
 */
async function liberarOperacoes(entityId, { soFotos = false } = {}) {
    try {
        const todas = await operationQueue.getAll();
        const minhas = todas.filter(op => (!soFotos || op.entityId !== entityId)
            && operacaoCita(op, entityId) && !operacaoEsperaBlob(op));
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
 * @param {Object} [opcoes]
 * @param {boolean} [opcoes.citantes=false] - Also the operations that cite it as a PHOTO.
 * @returns {Promise<number>} How many operations received an issue.
 */
async function marcarProblema(entityId, motivo, status, { citantes = false } = {}) {
    try {
        const todas = await operationQueue.getAll();
        const minhas = todas.filter(op => op.entityId === entityId || (citantes && operacaoCita(op, entityId)));
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
    const falhaPorId = new Map((failed ?? []).map(item => [item?.localId, item]));
    for (const { localId } of uploads) {
        if (mapping[localId]) {
            veredictos.set(localId, {
                confirmado: true, definitiva: false, status: null, causa: null, motivo: null
            });
            continue;
        }
        const falha = falhaPorId.get(localId);
        const motivo = mensagemCrua(falha?.error);
        // ONLY THE SERVER CALLS A FAILURE FINAL, per item (`permanent`, 2026-09-24). Every per-item
        // failure used to be read as a refusal whenever the request itself arrived, and a full disk or
        // a database error on the server (`bulkUploadImages`) closed a photo for good: a converted
        // photo's edit had already dropped its inline bytes, so that was the last copy on the server.
        // Now the server says which failures are VALIDATION (`permanent: true`); anything else is
        // retried. `uploadImagesInChunks` folds a chunk that got no answer into `failed` too, with no
        // `permanent`, and the count of such chunks names the network as the cause.
        if (falha?.permanent === true) {
            // A whole-request refusal carries its status (`uploadImagesInChunks`), which names the
            // cause: the file (413, 415), the account (403), or the server's answer.
            const status = Number.isInteger(falha.status) ? falha.status : null;
            veredictos.set(localId, {
                confirmado: false, definitiva: true, status,
                causa: status === null ? CausaDeFalha.RECUSA : causaDeErroLancado({ status, definitiva: true }),
                motivo
            });
        } else {
            veredictos.set(localId, {
                confirmado: false, definitiva: false, status: null,
                causa: falha?.permanent === false || transportErrors === 0 ? CausaDeFalha.SERVIDOR : CausaDeFalha.REDE,
                motivo
            });
        }
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
    // A RECORD DROPPED WHILE THIS ATTEMPT WAS ON THE WIRE STAYS DROPPED ({@link descartarBlobRegistrado}):
    // writing the verdict would bring back a pendency for an entity that was never saved, retried
    // forever or left CONFIRMADO as orphan bytes.
    try {
        if (!(await loja(scope).getItem(chaveDe(registro.tentativaId)))) return { ...registro, descartado: true };
    } catch {
        // Unreadable: fall through and write, which is the behaviour before this check.
    }
    const atualizado = {
        ...registro,
        tentativas: (registro.tentativas ?? 0) + 1,
        atualizadoEm: Date.now(),
        estado: desfecho.confirmado
            ? BlobUploadState.CONFIRMADO
            : (desfecho.definitiva ? BlobUploadState.RECUSADO : BlobUploadState.PENDENTE),
        ultimoErro: desfecho.confirmado ? null : fraseDeFalhaDeBlob(desfecho),
        ultimoErroCru: desfecho.confirmado ? null : mensagemCrua(desfecho.motivo),
        // The cause and the status travel on the record so the caller of the first attempt can
        // word its notice from them (`avisoDeFiguraRecusada`), instead of parsing the sentence.
        ultimaCausa: desfecho.confirmado ? null : (desfecho.causa ?? null),
        ultimoStatus: desfecho.confirmado ? null : (desfecho.status ?? null)
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

    if (atualizado.estado === BlobUploadState.PENDENTE) agendarRetomada(atualizado.atlasId);
    else _falhasSeguidas = 0;

    if (atualizado.estado === BlobUploadState.CONFIRMADO) {
        await liberarOperacoes(atualizado.imageId);
    } else if (atualizado.estado === BlobUploadState.RECUSADO) {
        await aplicarRecusa(atualizado, desfecho.status ?? null);
    }
    return atualizado;
}

/** Prefix of the `origem` of a photo converted from inline bytes by an edit (`photo-attach.js`). */
const ORIGEM_CONVERTIDA = 'foto-convertida';

/**
 * Whether a record is the upload of an INLINE photo that an edit converted to a reference.
 * @param {Object} registro
 * @returns {boolean}
 */
function ehConversao(registro) {
    return typeof registro?.origem === 'string' && registro.origem.startsWith(ORIGEM_CONVERTIDA);
}

/**
 * What a definitive refusal does to the operations that were waiting for these bytes.
 *
 * THREE CASES, AND THE THIRD IS THE ONE THAT LOST A PHOTO (2026-09-24, review).
 *  - An IMAGE FEATURE is its blob: its operations become durable issues, as always.
 *  - A photo ATTACHED here (phase 2b) never existed on the server in any other shape: the edit leaves
 *    with the reference, the thumbnail keeps drawing, and the local blob stays the only copy, which
 *    the exit census counts (`unsynced-work-exit.js`).
 *  - A photo CONVERTED by an edit (phase 2c) is different: the server still holds its bytes INLINE
 *    in the entity, and the operation that would replace them with the reference is exactly what
 *    must not leave. Its operations become durable issues too, and the server keeps its copy.
 * @param {Object} registro - The record, as it now stands on disk.
 * @param {number|null} status
 * @returns {Promise<void>}
 */
async function aplicarRecusa(registro, status) {
    const conversao = ehConversao(registro);
    await marcarProblema(registro.imageId, registro.ultimoErro, status, { citantes: conversao });
    if (!conversao) await liberarOperacoes(registro.imageId, { soFotos: true });
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
    // ONE TRANSFER PER ID (see {@link _emVoo}). The attempt already on the wire owns the verdict;
    // this one steps aside and SAYS so (`emVoo`), so no caller reads the untouched record as a
    // failed attempt.
    if (_emVoo.has(registro.imageId)) return { ...registro, emVoo: true };
    _emVoo.add(registro.imageId);
    try {
        let desfecho;
        try {
            const veredictos = await transferirLote(registro.atlasId, [[registro.imageId, blob]]);
            desfecho = veredictos.get(registro.imageId) ?? semVeredicto();
        } catch (error) {
            desfecho = { confirmado: false, ...classificarErro(error) };
        }
        return await assentar(scope, registro, desfecho);
    } finally {
        _emVoo.delete(registro.imageId);
    }
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

    // The batch is IN FLIGHT for every id it carries, like a single attempt ({@link _emVoo}): a
    // resumption that starts meanwhile must not send the same bytes a second time.
    const meus = registros.map(r => r.imageId).filter(id => !_emVoo.has(id));
    for (const id of meus) _emVoo.add(id);
    try {
        let veredictos;
        try {
            // NOT IN LINE ({@link emSerie}), on purpose (2026-09-24, review): a COPY gesture (paste,
            // "Duplicar Seleção", a layer copied to another map) awaits this before it writes its
            // features, and behind a photo still uploading on a slow link it froze the screen for
            // minutes. The copy competes for the link instead of waiting for it.
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
    } finally {
        for (const id of meus) _emVoo.delete(id);
    }
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
    const registrado = await registrarBlob({ imageId, blob, atlasId, origem });
    if (!registrado) return { registrado: false, confirmado: false, estado: null, motivo: '' };
    return enviarBlobRegistrado(registrado, blob);
}

/**
 * The FIRST half of {@link enfileirarBlob}: the pendency on disk and the id held, nothing sent.
 *
 * After it resolves, an operation of this id is kept prepared by the dispatcher, and an F5 finds
 * the record on disk and resumes it on connect. That is what lets a caller write the entity at once
 * and send the bytes behind it ({@link enviarBlobRegistrado}).
 * @param {Object} params
 * @param {string} params.imageId
 * @param {Blob} params.blob
 * @param {string} params.atlasId
 * @param {string} [params.origem]
 * @returns {Promise<{scope: object, registro: Object}|null>} Null in a local atlas and when the
 *   record could not be written (then nothing is held either).
 */
export async function registrarBlob({ imageId, blob, atlasId, origem = 'imagem' }) {
    const scope = escopoRemoto();
    if (!scope || !atlasId || !imageId || !blob) return null;

    const registro = novoRegistro(imageId, atlasId, origem, blob);

    // RESERVED BEFORE THE RECORD EXISTS, so no resumption can read the record without the
    // reservation ({@link _reservados}).
    _reservados.add(imageId);
    try {
        await gravar(scope, registro);
    } catch (error) {
        // WITHOUT A RECORD THERE IS NO RETRY, so there must be no hold either: holding an id whose
        // pendency nobody can read would stall the queue with nothing able to release it.
        console.warn('[blob-upload-queue] could not register an upload attempt:', error);
        _reservados.delete(imageId);
        return null;
    }
    espelhar(registro);
    return { scope, registro };
}

/**
 * Undoes a {@link registrarBlob} whose entity was NOT written after all (the save refused: the map
 * locked by a colleague in between, a switch of map or atlas). Removes the record and the hold, so
 * nothing uploads bytes for a feature that does not exist, nothing retries it, and no notice speaks
 * of a figure that is not there. Called before any transfer started. Never throws.
 * @param {{scope: object, registro: Object}} registrado
 * @returns {Promise<void>}
 */
export async function descartarBlobRegistrado({ scope, registro }) {
    _reservados.delete(registro.imageId);
    try {
        await loja(scope).removeItem(chaveDe(registro.tentativaId));
    } catch (error) {
        console.warn('[blob-upload-queue] could not drop an unused upload record:', error);
    }
    _pendentes.delete(registro.imageId);
}

/**
 * The SECOND half of {@link enfileirarBlob}: one attempt over a record {@link registrarBlob} wrote.
 * Never throws.
 * @param {{scope: object, registro: Object}} registrado
 * @param {Blob} blob
 * @returns {Promise<{registrado: boolean, confirmado: boolean, estado: string|null, motivo: string,
 *   causa: (string|null), status: (number|null)}>}
 */
export async function enviarBlobRegistrado({ scope, registro }, blob) {
    const id = registro.imageId;
    const final = _emVoo.has(id) || _naFila.has(id)
        ? { ...registro, emVoo: true }
        : await (() => {
            _naFila.add(id);
            // The reservation is lifted when THIS transfer's turn comes, not before: a resumption
            // landing while it waits in line must still step aside ({@link emSerie}).
            return emSerie(() => {
                _naFila.delete(id);
                _reservados.delete(id);
                return tentar(scope, registro, blob);
            });
        })();
    return {
        registrado: true,
        emVoo: final.emVoo === true,
        confirmado: final.estado === BlobUploadState.CONFIRMADO,
        estado: final.estado,
        motivo: final.ultimoErro || '',
        causa: final.ultimaCausa ?? null,
        status: final.ultimoStatus ?? null
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

    for (const lido of registros) {
        const espera = BACKOFF_MS[Math.min(lido.tentativas ?? 0, BACKOFF_MS.length - 1)];
        if (espera > 0) await new Promise(resolve => setTimeout(resolve, espera));

        // RE-READ AFTER THE WAIT, and skip what is no longer this loop's to send: an attempt on the
        // wire for the same id ({@link _emVoo}), or a record another attempt already settled while
        // this loop was waiting. Trying the copy read at the start would write its verdict over a
        // newer one (a CONFIRMADO turned back into PENDENTE).
        if (_emVoo.has(lido.imageId) || _reservados.has(lido.imageId) || _naFila.has(lido.imageId)) continue;
        let registro = lido;
        try {
            registro = (await loja(scope).getItem(chaveDe(lido.tentativaId))) ?? null;
        } catch (error) {
            console.warn('[blob-upload-queue] could not re-read a pending upload:', error);
        }
        if (!registro || registro.estado !== BlobUploadState.PENDENTE
            || _emVoo.has(registro.imageId) || _reservados.has(registro.imageId)
            || _naFila.has(registro.imageId)) continue;

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
                // THE SAME THREE CASES AS A REFUSAL (`aplicarRecusa`, 2026-09-24). Only the image
                // feature's operations used to be marked here: an operation that cited a PHOTO whose
                // bytes vanished stayed held, and the queue of the whole atlas behind it, until the
                // next connect happened to look again.
                await aplicarRecusa(semBytes, null);
            } catch (error) {
                console.warn('[blob-upload-queue] could not close a pendency without bytes:', error);
            }
            resumo.recusadas += 1;
            continue;
        }

        const final = await emSerie(() => tentar(scope, registro, blob));
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
    _recusados.clear();
    _reservados.clear();
    // A new scope starts a new line: a transfer of the scope left behind must not hold this one's.
    _naFila.clear();
    _filaDeTransferencia = Promise.resolve();
    if (_retomadaAgendada) clearTimeout(_retomadaAgendada);
    _retomadaAgendada = null;
    _falhasSeguidas = 0;
}

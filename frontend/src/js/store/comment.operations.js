// Path: js/store/comment.operations.js

/**
 * @fileoverview Spatial comment CRUD operations (Fase 3 — comentário espacial).
 *
 * Comments are a dedicated per-map entity: a ROOT comment is a pin (lng/lat) labelled with the
 * author's initials; REPLIES are separate entities (parentId) so concurrent replies never clobber
 * (P10). Persistence-first via runTransaction (like feature.operations); the sync op is logged in
 * deferAsync. Each op emits a COMMENT_* event so the map overlay + thread panel refresh — local and
 * remote are symmetric (remote-operation-handler emits the same events).
 *
 * COMMENTING DOES NOT WORK OFFLINE, and this header claimed the opposite until 2026-08-23 ("so
 * commenting works fully offline (P1)"). `guardComment`, twenty lines below, refuses every write
 * with `not-authenticated` when there is no session, and the reason is in its own comment: a comment
 * needs an AUTHOR, and anonymous has none. What the dispatcher's non-UUID drop buys is narrower:
 * on the local-only map a LOGGED-IN user comments without the op leaking to a server that has no
 * such map. Two opposite claims lived in one file, and the false one was the one a reader meets
 * first. Anonymous can only VIEW comments, e.g. ones imported from a remote `.ebgeo`.
 */

import { getRepository } from './repositories/index.js';
import mapManager from './store-state-manager.js';
import { sessionContext } from './sync/session-context.js';
import { EntityType, OperationType } from './sync/index.js';
import { checkPermission, GuardAction } from './sync/permission-guard.js';
import { emitStoreError, StoreErrorEvents } from './store-errors.js';
import { runTransaction } from './store-transaction.js';
import { withSideDocument } from './document-lock.js';
import { generateUUID } from '@utils/uuid.js';
import { getEventBus } from './services.js';
import { EventTypes } from '@events/event_types.js';

/** @private Resolves the target map name (defaults to the current map). */
function resolveMap(mapName) {
    return mapName || mapManager.getCurrentMapName();
}

/** @private Permission gate for a comment write; emits STORE_OPERATION_BLOCKED if denied. */
function guardComment(guardAction, operationName) {
    // A comment needs an author — without a logged-in user there is no author. Anonymous/offline can
    // only VIEW comments (e.g. ones imported from a remote .ebgeo), never create/edit/resolve/delete.
    if (!sessionContext.isAuthenticated()) {
        emitStoreError(StoreErrorEvents.STORE_OPERATION_BLOCKED, { operation: operationName, reason: 'not-authenticated' });
        return false;
    }
    const perm = checkPermission(guardAction);
    if (!perm.allowed) {
        emitStoreError(StoreErrorEvents.STORE_OPERATION_BLOCKED, { operation: operationName, reason: perm.reason, required: perm.required });
        return false;
    }
    return true;
}

/** @private Fire-and-forget event emit (degrades quietly with no service bus). */
function emitComment(eventType, payload) {
    try {
        getEventBus().emit(eventType, payload);
    } catch {
        // No event bus (headless) — the persisted data is the source of truth.
    }
}

/**
 * Creates a root spatial comment (a pin) on a map, na superficie em que o gesto aconteceu.
 * @param {{ lng?:number, lat?:number, text:string, surface?:('2d'|'360'|'3d'),
 *   photoName?:string, tilesetId?:string, heading?:number, pitch?:number, alt?:number,
 *   authorId?:string, authorInitials?:string, authorColor?:string }} input
 * @param {string} [mapName=null]
 * @returns {Promise<Object|undefined>} The created comment, or undefined if blocked.
 */
export async function addComment(input, mapName = null) {
    const targetMap = resolveMap(mapName);
    if (!guardComment(GuardAction.CREATE_COMMENT, 'addComment')) return;

    const now = Date.now();
    const comment = {
        id: generateUUID(),
        parentId: null,
        // Nulo, e nao `undefined`, quando a superficie nao tem coordenada: a coluna aceita nulo, e
        // o overlay do 2D ja descarta o que nao for finito, o que mantem o comentario do 360 fora
        // do mapa sem nenhuma regra nova.
        lng: Number.isFinite(input.lng) ? input.lng : null,
        lat: Number.isFinite(input.lat) ? input.lat : null,
        text: input.text || '',
        status: 'open',
        // A SUPERFICIE E A ANCORA DELA (2026-09-17, a pedido do dono: o mesmo sistema de
        // comentarios no 360 e no 3D). Um comentario continua sendo UMA entidade, na colecao do
        // MAPA, com o mesmo guarda, o mesmo documento lateral e o mesmo sync: o que muda e onde ele
        // se prende. O padrao e o do MARCADOR de cada superficie, para as duas coisas se ancorarem
        // igual e a tela poder desenha-las lado a lado.
        //
        //   '2d'  -> lng, lat                     (a coordenada do mapa)
        //   '360' -> photoName, heading, pitch    (a foto e a direcao dentro dela)
        //   '3d'  -> tilesetId, lng, lat, alt     (o modelo e o ponto sobre ele)
        //
        // OS CAMPOS ATRAVESSAM O SERVIDOR SEM MIGRACAO, e isso foi medido antes de escrever a
        // linha: o payload de `comment` esta em `SCALAR_PAYLOAD_ENTITIES` (free-field.schemas.js),
        // que preserva todo escalar; o INSERT grava `JSON.stringify(data)` inteiro na coluna
        // `data` JSONB; e o retrato devolve `...c.data` com o espalhamento. A coluna `lng`/`lat`
        // continua recebendo o que o 2D e o 3D tem, e nulo no 360, que nao tem coordenada.
        surface: input.surface ?? '2d',
        photoName: input.photoName ?? null,
        tilesetId: input.tilesetId ?? null,
        ...(input.surface === 'fp' ? {
            x: Number.isFinite(input.x) ? input.x : null,
            y: Number.isFinite(input.y) ? input.y : null,
            z: Number.isFinite(input.z) ? input.z : null,
        } : {}),
        heading: Number.isFinite(input.heading) ? input.heading : null,
        pitch: Number.isFinite(input.pitch) ? input.pitch : null,
        alt: Number.isFinite(input.alt) ? input.alt : null,
        authorId: input.authorId ?? null,
        authorInitials: input.authorInitials ?? '',
        authorColor: input.authorColor ?? null,
        createdAt: now,
        updatedAt: now,
    };

    // Leaf read-modify-write of the comments document. Without the lock the later save
    // drops the earlier one: measured, 20 concurrent writers persisted 1. The peer's
    // inbound comment is the second writer in the real case, not a burst. See
    // document-lock.js; `resolveComment` is deliberately NOT locked (it awaits
    // `updateComment`, and a section that waits on its own key waits forever).
    await withSideDocument('comments', targetMap, 'addComment', () => runTransaction(async (tx) => {
        const collection = await getRepository().getMapComments(targetMap);
        collection[comment.id] = comment;
        tx.deferSync(() => emitComment(EventTypes.COMMENT_CREATED, { comment }));
        {
            const mapId = mapManager.getMapId(targetMap);
            tx.recordOperation(EntityType.COMMENT, OperationType.CREATE, comment.id, mapId, comment);
        }
        return () => getRepository().saveMapComments(targetMap, collection);
    }));

    return comment;
}

/**
 * Adds a reply to a root comment (a separate entity with parentId — P10).
 * @param {string} parentId - The root comment id.
 * @param {{ text:string, authorId?:string, authorInitials?:string }} input
 * @param {string} [mapName=null]
 * @returns {Promise<Object|undefined>}
 */
export async function addReply(parentId, input, mapName = null) {
    const targetMap = resolveMap(mapName);
    if (!guardComment(GuardAction.CREATE_COMMENT, 'addReply')) return;

    // Don't create an orphan reply (and a doomed sync op) if the root was deleted out from under us,
    // and don't reply to a resolved comment (it must be reopened first — UI enforces this too).
    const parent = (await getRepository().getMapComments(targetMap))[parentId];
    if (!parent || parent.deleted || parent.status === 'resolved') return;

    const now = Date.now();
    const reply = {
        id: generateUUID(),
        parentId,
        text: input.text || '',
        authorId: input.authorId ?? null,
        authorInitials: input.authorInitials ?? '',
        createdAt: now,
        updatedAt: now,
    };

    // Leaf RMW of the comments document; see the note on `addComment` and document-lock.js.
    await withSideDocument('comments', targetMap, 'addReply', () => runTransaction(async (tx) => {
        const collection = await getRepository().getMapComments(targetMap);
        collection[reply.id] = reply;
        tx.deferSync(() => emitComment(EventTypes.COMMENT_CREATED, { comment: reply }));
        {
            const mapId = mapManager.getMapId(targetMap);
            tx.recordOperation(EntityType.COMMENT, OperationType.CREATE, reply.id, mapId, reply);
        }
        return () => getRepository().saveMapComments(targetMap, collection);
    }));

    return reply;
}

/**
 * Updates a comment (edited text, or resolved/reopened status).
 * @param {Object} comment - The full comment object with the new fields.
 * @param {string} [mapName=null]
 */
export async function updateComment(comment, mapName = null) {
    const targetMap = resolveMap(mapName);
    if (!guardComment(GuardAction.UPDATE_COMMENT, 'updateComment')) return;
    if (!comment?.id) return;

    // Leaf RMW of the comments document; see the note on `addComment` and document-lock.js.
    await withSideDocument('comments', targetMap, 'updateComment', () => runTransaction(async (tx) => {
        const collection = await getRepository().getMapComments(targetMap);
        const previous = collection[comment.id];
        if (!previous) return () => {};
        const next = { ...previous, ...comment, updatedAt: Date.now() };
        collection[comment.id] = next;
        tx.deferSync(() => emitComment(EventTypes.COMMENT_UPDATED, { comment: next }));
        {
            const mapId = mapManager.getMapId(targetMap);
            tx.recordOperation(EntityType.COMMENT, OperationType.UPDATE, next.id, mapId, next, previous);
        }
        return () => getRepository().saveMapComments(targetMap, collection);
    }));
}

/**
 * Resolves or reopens a root comment.
 * @param {string} commentId
 * @param {boolean} resolved - true = resolved, false = reopened.
 * @param {string} [mapName=null]
 */
export async function resolveComment(commentId, resolved, mapName = null) {
    const targetMap = resolveMap(mapName);
    const collection = await getRepository().getMapComments(targetMap);
    const existing = collection[commentId];
    if (!existing) return;
    return updateComment({ ...existing, status: resolved ? 'resolved' : 'open' }, mapName);
}

/**
 * Deletes a comment (and, if it is a root, its replies — a local cascade).
 * @param {string} commentId
 * @param {string} [mapName=null]
 */
export async function removeComment(commentId, mapName = null) {
    const targetMap = resolveMap(mapName);
    if (!guardComment(GuardAction.DELETE_COMMENT, 'removeComment')) return;

    // Leaf RMW of the comments document; see the note on `addComment` and document-lock.js.
    await withSideDocument('comments', targetMap, 'removeComment', () => runTransaction(async (tx) => {
        const collection = await getRepository().getMapComments(targetMap);
        const root = collection[commentId];
        if (!root) return () => {};
        const toDelete = [root, ...Object.values(collection).filter((c) => c && c.parentId === commentId)];
        const prevById = {};
        for (const c of toDelete) prevById[c.id] = c;
        const ids = Object.keys(prevById);
        for (const id of ids) delete collection[id];

        tx.deferSync(() => {
            for (const id of ids) emitComment(EventTypes.COMMENT_DELETED, { commentId: id });
        });
        {
            const mapId = mapManager.getMapId(targetMap);
            for (const id of ids) {
                tx.recordOperation(EntityType.COMMENT, OperationType.DELETE, id, mapId, null, prevById[id]);
            }
        }
        return () => getRepository().saveMapComments(targetMap, collection);
    }));
}

/**
 * Returns all comments for a map (root + replies), keyed by id.
 * @param {string} [mapName=null]
 * @returns {Promise<Object>}
 */
export async function getComments(mapName = null) {
    return getRepository().getMapComments(resolveMap(mapName));
}

/**
 * Bulk-restores a map's comments (used by .ebgeo import). Local persistence only — it does NOT log
 * sync ops (a project import is a local restore, like setMapTemporalConfig / setGridStyle on import).
 * @param {string} mapName
 * @param {Object} comments - id → comment.
 */
export async function setMapComments(mapName, comments) {
    if (!comments || typeof comments !== 'object') return;
    const targetMap = resolveMap(mapName);
    // Bulk restore is a whole-document write, so it must not land in the middle of a
    // read-modify-write that already read the old collection.
    await withSideDocument('comments', targetMap, 'setMapComments', () =>
        getRepository().saveMapComments(targetMap, comments));
}

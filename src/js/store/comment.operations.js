// Path: js/store/comment.operations.js

/**
 * @fileoverview Spatial comment CRUD operations (Fase 3 — comentário espacial).
 *
 * Comments are a dedicated per-map entity: a ROOT comment is a pin (lng/lat) labelled with the
 * author's initials; REPLIES are separate entities (parentId) so concurrent replies never clobber
 * (P10). Persistence-first via runTransaction (like feature.operations); the sync op is logged in
 * deferAsync. Each op emits a COMMENT_* event so the map overlay + thread panel refresh — local and
 * remote are symmetric (remote-operation-handler emits the same events). On the local-only map the
 * dispatcher drops the op (non-UUID mapId), so commenting works fully offline (P1).
 */

import { getRepository } from './repositories/index.js';
import mapManager from './store-state-manager.js';
import { logCommentOperation, OperationType } from './sync/index.js';
import { checkPermission, GuardAction } from './sync/permission-guard.js';
import { emitStoreError, StoreErrorEvents } from './store-errors.js';
import { runTransaction } from './store-transaction.js';
import { generateUUID } from '@utils/uuid.js';
import { getEventBus } from './services.js';
import { EventTypes } from '@events/event_types.js';

/** @private Resolves the target map name (defaults to the current map). */
function resolveMap(mapName) {
    return mapName || mapManager.getCurrentMapName();
}

/** @private Permission gate for a comment write; emits STORE_OPERATION_BLOCKED if denied. */
function guardComment(guardAction, operationName) {
    const perm = checkPermission(guardAction);
    if (!perm.allowed) {
        emitStoreError(StoreErrorEvents.STORE_OPERATION_BLOCKED, { operation: operationName, reason: perm.reason });
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
 * Creates a root spatial comment (a pin) on a map.
 * @param {{ lng:number, lat:number, text:string, authorId?:string, authorInitials?:string, authorColor?:string }} input
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
        lng: input.lng,
        lat: input.lat,
        text: input.text || '',
        status: 'open',
        authorId: input.authorId ?? null,
        authorInitials: input.authorInitials ?? '',
        authorColor: input.authorColor ?? null,
        createdAt: now,
        updatedAt: now,
    };

    await runTransaction(async (tx) => {
        const collection = await getRepository().getMapComments(targetMap);
        collection[comment.id] = comment;
        tx.deferSync(() => emitComment(EventTypes.COMMENT_CREATED, { comment }));
        tx.deferAsync(() => {
            const mapId = mapManager.getMapId(targetMap);
            return logCommentOperation(OperationType.CREATE, comment.id, mapId, comment);
        });
        return () => getRepository().saveMapComments(targetMap, collection);
    });

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

    // Don't create an orphan reply (and a doomed sync op) if the root was deleted out from under us.
    const parent = (await getRepository().getMapComments(targetMap))[parentId];
    if (!parent || parent.deleted) return;

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

    await runTransaction(async (tx) => {
        const collection = await getRepository().getMapComments(targetMap);
        collection[reply.id] = reply;
        tx.deferSync(() => emitComment(EventTypes.COMMENT_CREATED, { comment: reply }));
        tx.deferAsync(() => {
            const mapId = mapManager.getMapId(targetMap);
            return logCommentOperation(OperationType.CREATE, reply.id, mapId, reply);
        });
        return () => getRepository().saveMapComments(targetMap, collection);
    });

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

    await runTransaction(async (tx) => {
        const collection = await getRepository().getMapComments(targetMap);
        const previous = collection[comment.id];
        if (!previous) return () => {};
        const next = { ...previous, ...comment, updatedAt: Date.now() };
        collection[comment.id] = next;
        tx.deferSync(() => emitComment(EventTypes.COMMENT_UPDATED, { comment: next }));
        tx.deferAsync(() => {
            const mapId = mapManager.getMapId(targetMap);
            return logCommentOperation(OperationType.UPDATE, next.id, mapId, next, previous);
        });
        return () => getRepository().saveMapComments(targetMap, collection);
    });
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

    await runTransaction(async (tx) => {
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
        tx.deferAsync(async () => {
            const mapId = mapManager.getMapId(targetMap);
            for (const id of ids) {
                await logCommentOperation(OperationType.DELETE, id, mapId, null, prevById[id]);
            }
        });
        return () => getRepository().saveMapComments(targetMap, collection);
    });
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
    await getRepository().saveMapComments(resolveMap(mapName), comments);
}

// Path: js/store/cesium3d.operations.js

/**
 * @fileoverview Cesium 3D CRUD operations.
 * Handles camera positions, markers, measurements, and viewsheds for 3D models.
 */

import { memoryStore } from './memory-store.js';
import { getCesium3dCompat, setCesium3dCompat } from './repositories/index.js';
// A pergunta de EXISTÊNCIA do mapa alvo (D2): este arquivo não lê o documento do mapa, só precisa
// saber se ele existe antes de gravar o lateral `cesium3d_<chave>`.
import { mapExistsForGesture } from './mapa-inexistente.js';
import mapManager from './store-state-manager.js';
import { EventTypes } from '../events';
import { validateImageFile } from '../utilities/image_utils.js';
import { prepararFotoAnexa } from './photo-attach.js';
import { createSyncMetadata, touchSyncMetadata, isActive } from './sync/sync-metadata.js';
import { generateUUID } from '../utilities/uuid.js';
import { deepClone } from '../utilities/deep-utils.js';
import { emitStoreError, StoreErrorEvents } from './store-errors.js';
import { checkPermission, GuardAction } from './sync/permission-guard.js';
import { withSideDocument } from './document-lock.js';
import { runTransaction } from './store-transaction.js';
// The leaf module, never the `sync/index.js` barrel: five store suites mock that barrel
// without `EntityType`, so reaching for it there breaks them at load time.
import { EntityType, OperationType } from './sync/operation-types.js';

/** @type {{ eventBus: import('../events/event_bus.js').EventBus | null }} */
const deps = { eventBus: null };

/**
 * Sets dependencies for cesium3d operations.
 * @param {{ eventBus: import('../events/event_bus.js').EventBus }} dependencies
 */
export function setCesium3dDependencies(dependencies) {
    deps.eventBus = dependencies.eventBus;
}

// ===== HELPERS =====

/**
 * Resolves map name, falling back to current map.
 *
 * WHOEVER RESOLVES A MAP HERE ALSO STAMPS THE OP WITH `mapManager.getMapId(targetMap)`, never
 * with `getCurrentMapId()`. Thirteen writers in this file read and wrote the DATA of the
 * resolved map and then tagged the op with the CURRENT map's id (achado F15): called with an
 * explicit map name that is not the active one, the local side changed the right map and the
 * op travelled to the wrong one, so the peer grew a marker, a measurement or a viewshed in a
 * map nobody touched while the map that actually changed never converged. Neither side errors.
 * The two functions that already did it right (`removeEntitiesByTileset`, the bulk tileset
 * wipe) carry the same note inline.
 *
 * @param {string|null} mapName
 * @returns {string}
 */
function getTargetMapName(mapName) {
    return mapName || mapManager.getCurrentMapName();
}

/**
 * Permission gate for a 3D write. Emits STORE_OPERATION_BLOCKED when denied so the UI
 * shows the read-only toast, and — critically — stops the caller BEFORE the op is
 * queued: an op the server refuses (403) aborts the whole push batch and, since 403 is
 * not a permanent rejection, that batch is retried forever, freezing outbound sync
 * (including the comments a Comentarista IS allowed to write).
 *
 * The gate is hierarchical by construction (GuardAction → PermissionAction →
 * sessionContext.canPerformAction), so Manager/Owner/Admin pass without any closed
 * role list. Offline / local-only stores are always allowed (checkPermission, P1).
 *
 * @param {string} guardAction - Key from GuardAction
 * @param {string} operationName - Operation label carried in the error payload
 * @returns {boolean} True when the write may proceed
 */
function guardCesium3dWrite(guardAction, operationName) {
    const perm = checkPermission(guardAction);
    if (!perm.allowed) {
        emitStoreError(StoreErrorEvents.STORE_OPERATION_BLOCKED, {
            operation: operationName,
            reason: perm.reason,
            required: perm.required
        });
        return false;
    }
    return true;
}

/**
 * Gets cesium3d data from memory cache or loads from DB.
 * @param {string} mapName
 * @returns {Promise<Object>}
 */
async function getCesium3dDataWithCache(mapName) {
    if (memoryStore.cesium3d && memoryStore.cesium3d._mapName === mapName) {
        // Return a clone so mutators work on a throwaway copy. If the subsequent
        // persist fails, the live cache stays consistent with disk (mirrors
        // getMapDataCompat, which returns a fresh deserialized copy each call).
        return deepClone(memoryStore.cesium3d);
    }
    return getCesium3dCompat(mapName);
}

/**
 * Writes the cesium3d document to IndexedDB. The ONLY writer.
 *
 * It no longer touches the memory cache and no longer emits STORE_PERSIST_ERROR of its own:
 * both belong to `runTransaction`, which defers the cache mirror until the write is confirmed
 * and reports the failure once. Two emitters for one failure was noise, not defence.
 *
 * @param {string} mapName - Map the document belongs to
 * @param {Object} data - Document to persist
 * @returns {Promise<void>}
 */
async function persistCesium3dData(mapName, data) {
    const dataToSave = { ...data };
    delete dataToSave._mapName;
    await setCesium3dCompat(mapName, dataToSave);
}

/**
 * Mirrors the just-persisted document into the memory cache.
 * @param {string} mapName - Map the document belongs to
 * @param {Object} data - Document already written to disk
 * @returns {void}
 */
function mirrorCesium3dInMemory(mapName, data) {
    memoryStore.cesium3d = { ...data, _mapName: mapName };
}

/**
 * @typedef {Object} Cesium3dIntent
 * @property {string} entityType - EntityType constant of the 3D family
 * @property {string} type - OperationType constant
 * @property {string} id - Entity id the op addresses
 * @property {Object|null} [data] - Post-edit entity, null for a deletion
 * @property {Object|null} [previous] - Pre-edit snapshot, null for a creation
 */

/**
 * @typedef {Object} Cesium3dEdit
 * @property {Cesium3dIntent[]} operations - Every intent this edit produces
 * @property {*} [result] - Value the exported operation returns on success
 * @property {function(): void} [effect] - Events to emit, run only after the write
 */

/**
 * Journals a 3D edit before the cesium3d document is written.
 *
 * The contract is the one `editCatalogLayers` established: the side-document lock serializes
 * writers, `prepare` reads and builds the WHOLE edit (it may await, because an image has to be
 * decoded before its entity is known), `recordOperation` states the intention while the copy on
 * disk is still the old one, and the returned closure is the ONLY writer. The memory mirror and
 * the events are deferred, so a write that fails leaves neither behind and the intention stays
 * in the journal for recovery.
 *
 * `prepare` returning null means "nothing to do": no op, no write, and `missing` comes back.
 *
 * O MAPA ALVO TEM DE EXISTIR (D2, 2026-09-21), e a pergunta mora AQUI porque este é o funil: todos
 * os escritores deste arquivo passam por ele, e nenhum deles é escrita DERIVADA — conferido um a
 * um em 2026-09-21, inclusive os dois que a intuição diria que são. Ver o bloco de classificação
 * em `tests/unit/escrita-de-conteudo-nao-fabrica-mapa.test.js`.
 *
 * ELA VEM DENTRO DA TRANSAÇÃO, antes da leitura do lateral. A primeira versão a punha ANTES de
 * `withSideDocument`, para poupar à recusa a trava, a transação e um lote de intenções vazio; o
 * preço apareceu no mesmo dia: uma leitura de disco fora da transação fica fora do carimbo de
 * escopo, e uma troca de atlas durante ela deixava a escrita cair no OUTRO atlas. O custo da recusa
 * (caminho raro) é o preço declarado.
 *
 * A RECUSA DEVOLVE `missing`, QUE É O VALOR QUE O CHAMADOR JÁ TRATA. Cada entrada deste arquivo
 * passa o seu (`null`, `false`, `0`, `undefined`) como "não achei / não fiz nada", então nenhuma
 * delas precisa mudar e nenhum contrato de retorno se desloca. O motivo REAL não se perde: ele sai
 * no `STORE_OPERATION_BLOCKED`, que o listener global traduz em frase.
 *
 * @param {string} targetMap - Resolved map name or id
 * @param {string} label - Operation label, for the deadlock report AND for the refusal payload
 * @param {function(Object): (Promise<Cesium3dEdit|null>|Cesium3dEdit|null)} prepare - Receives
 *   the cesium3d document to mutate in place
 * @param {*} [missing] - Value returned when `prepare` declines the edit
 * @returns {Promise<*>} `edit.result`, or `missing`
 */
async function editCesium3d(targetMap, label, prepare, missing = undefined) {
    let output = missing;
    // Leaf read-modify-write of the cesium3d document; see document-lock.js.
    await withSideDocument('cesium3d', targetMap, label, () => runTransaction(async tx => {
        // THE EXISTENCE QUESTION LIVES INSIDE THE TRANSACTION (2026-09-21). It was first placed
        // BEFORE the side-document lock, to spare a refusal the cost of lock plus transaction. That
        // put a disk read outside the transaction's scope stamp: an atlas switch during it went
        // unnoticed and the write could land in the OTHER atlas. The sibling guard of the map
        // settings was caught by `map-settings-write-ahead.test.js` the same day; this funnel had
        // the same shape and no test looking at that read. Correctness over the cost of a rare path.
        if (!await mapExistsForGesture(targetMap, label)) return async () => {};
        const data = await getCesium3dDataWithCache(targetMap);
        const edit = await prepare(data);
        if (!edit) return async () => {};
        // getMapId(targetMap), NOT getCurrentMapId(): these entries accept an explicit map
        // name and may edit a map that is not the active one (achado F15).
        const mapId = mapManager.getMapId(targetMap);
        for (const op of edit.operations) {
            tx.recordOperation(op.entityType, op.type, op.id, mapId, op.data ?? null, op.previous ?? null);
        }
        tx.deferSync(() => {
            mirrorCesium3dInMemory(targetMap, data);
            edit.effect?.();
        });
        output = edit.result;
        return () => persistCesium3dData(targetMap, data);
    }));
    return output;
}

/**
 * Emits an event if the event bus is available.
 * @param {string} eventType
 * @param {Object} payload
 */
function emit(eventType, payload) {
    if (deps.eventBus) {
        deps.eventBus.emit(eventType, payload);
    }
}

/**
 * Gets the next auto-naming number for entities matching a pattern.
 * @param {Array} items - Existing items to scan
 * @param {RegExp} regex - Pattern with a capture group for the number
 * @param {function} [filter] - Optional filter predicate
 * @returns {number}
 */
function getNextAutoNumber(items, regex, filter) {
    let maxNumber = 0;
    for (const item of items) {
        if (filter && !filter(item)) continue;
        const match = item.properties?.nome?.match(regex);
        if (match) {
            const num = parseInt(match[1], 10);
            if (num > maxNumber) maxNumber = num;
        }
    }
    return maxNumber + 1;
}

/**
 * Reads user-defined default style from localStorage.
 * @param {string} storageKey
 * @returns {Object}
 */
function getUserDefaultStyle(storageKey) {
    try {
        const saved = localStorage.getItem(storageKey);
        if (saved) return JSON.parse(saved);
    } catch (e) {
        console.warn(`Failed to parse saved style from ${storageKey}:`, e);
    }
    return {};
}

/**
 * Adds an image to an entity (marker, measurement, or viewshed).
 * @param {string} entityId - Entity ID
 * @param {File} file - Image file
 * @param {string} collectionKey - Key in cesium3d data ('markers', 'measurements', 'viewsheds')
 * @param {string} changeEvent - Event type to emit
 * @param {string|null} mapName
 * @param {string} entityType - The entity's EntityType (e.g. EntityType.MARKER_3D). The photo's
 *   REFERENCE lives in the entity's `images[]` (its bytes are a blob, see `photo-attach.js`), so
 *   attaching it is an entity UPDATE that must propagate to peers (the `data` carries the new
 *   `images[]`); without this it stayed local.
 * @returns {Promise<Object|null>}
 */
async function addEntityImage(entityId, file, collectionKey, changeEvent, mapName, entityType) {
    if (!guardCesium3dWrite(GuardAction.CREATE_MARKER_3D, `addImage:${collectionKey}`)) return null;

    // A REFUSAL THE PERSON CANNOT SEE IS A CLICK THAT DID NOTHING. This used to stop at
    // `console.warn`, so picking an oversized or unsupported picture left the gallery unchanged
    // with no explanation anywhere. The block event is the house channel for an expected refusal
    // (the store owns no toast), and `message` is the branch of `store-error-listener.js` that
    // shows a sentence of our own instead of the canned lock/read-only ones.
    const validation = validateImageFile(file);
    if (!validation.valid) {
        emitStoreError(StoreErrorEvents.STORE_OPERATION_BLOCKED, {
            operation: `addImage:${collectionKey}`,
            reason: 'imagem-invalida',
            message: validation.reason,
        });
        return null;
    }

    const targetMap = getTargetMapName(mapName);
    // THE PHOTO IS A BLOB WITH A REFERENCE since phase 2b (`photo-attach.js`): stored and its upload
    // registered BEFORE the entity is written, sent only after, dropped when the write did not happen.
    const foto = await prepararFotoAnexa(file, { origem: 'foto-anexa-3d' });
    // The `catch` that used to wrap this whole body turned a quota failure into a silent null.
    // With the journal ahead of the entity the failure has to reach the caller, or an intention
    // already on disk would be reported to the user as "nothing happened".
    let resultado;
    try {
        resultado = await editCesium3d(targetMap, `addImage:${collectionKey}`, async data => {
            if (!data[collectionKey]) return null;

            const entityIndex = data[collectionKey].findIndex(e => e.id === entityId);
            if (entityIndex === -1) {
                console.warn(`Entity not found: ${entityId}`);
                return null;
            }

            const imageData = foto.item;

            const entity = data[collectionKey][entityIndex];
            // Snapshot the pre-image state (shallow + a copy of images) for the op's oldData.
            const previousEntity = { ...entity, images: entity.images ? [...entity.images] : [] };
            if (!entity.images) entity.images = [];
            entity.images.push(imageData);
            entity.updatedAt = Date.now();
            entity.sync = touchSyncMetadata(entity.sync);

            return {
                operations: [{
                    entityType, type: OperationType.UPDATE, id: entityId,
                    data: entity, previous: previousEntity
                }],
                result: imageData,
                effect: () => emit(changeEvent, { mapName: targetMap })
            };
        }, null);
    } catch (error) {
        await foto.descartar();
        throw error;
    }
    if (!resultado) {
        await foto.descartar();
        return null;
    }
    foto.confirmar();
    return resultado;
}

/**
 * Gets images for an entity.
 * @param {string} entityId
 * @param {string} collectionKey
 * @param {string|null} mapName
 * @returns {Promise<Array>}
 */
async function getEntityImages(entityId, collectionKey, mapName) {
    const targetMap = getTargetMapName(mapName);
    const data = await getCesium3dDataWithCache(targetMap);
    const entity = (data[collectionKey] || []).find(e => e.id === entityId);
    return entity?.images || [];
}

/**
 * Removes an image from an entity.
 * @param {string} entityId
 * @param {string} imageId
 * @param {string} collectionKey
 * @param {string} changeEvent
 * @param {string|null} mapName
 * @param {string} entityType - The entity's EntityType (removing an inline image is an entity
 *   UPDATE that must propagate to peers).
 * @returns {Promise<boolean>}
 */
async function removeEntityImage(entityId, imageId, collectionKey, changeEvent, mapName, entityType) {
    if (!guardCesium3dWrite(GuardAction.DELETE_MARKER_3D, `removeImage:${collectionKey}`)) return false;

    const targetMap = getTargetMapName(mapName);
    return editCesium3d(targetMap, `removeImage:${collectionKey}`, data => {
        if (!data[collectionKey]) return null;

        const entityIndex = data[collectionKey].findIndex(e => e.id === entityId);
        if (entityIndex === -1) return null;

        const entity = data[collectionKey][entityIndex];
        if (!entity.images) return null;

        const initialLength = entity.images.length;
        const previousEntity = { ...entity, images: [...entity.images] };
        entity.images = entity.images.filter(img => img.id !== imageId);
        if (entity.images.length === initialLength) return null;

        entity.updatedAt = Date.now();
        entity.sync = touchSyncMetadata(entity.sync);

        return {
            operations: [{
                entityType, type: OperationType.UPDATE, id: entityId,
                data: entity, previous: previousEntity
            }],
            result: true,
            effect: () => emit(changeEvent, { mapName: targetMap })
        };
    }, false);
}

/**
 * Removes all entities in a collection that belong to a specific tileset.
 * @param {string} tilesetId
 * @param {string} collectionKey
 * @param {string} changeEvent
 * @param {string|null} mapName
 * @param {string} entityType - The entity family's EntityType. A bulk removal is still a
 *   removal per entity: without one DELETE op each, wiping a tileset's entities stayed local
 *   and peers kept showing them. The N intents share ONE journal write, so either every
 *   deletion is recoverable or none of them happened.
 * @returns {Promise<number>}
 */
async function removeByTileset(tilesetId, collectionKey, changeEvent, mapName, entityType) {
    if (!guardCesium3dWrite(GuardAction.DELETE_MARKER_3D, `removeByTileset:${collectionKey}`)) return 0;

    const targetMap = getTargetMapName(mapName);
    return editCesium3d(targetMap, `removeByTileset:${collectionKey}`, data => {
        if (!data[collectionKey]) return null;

        // Snapshot the entities being dropped so each one can carry its own oldData.
        const removed = data[collectionKey].filter(item => item.tilesetId === tilesetId);
        if (removed.length === 0) return null;
        data[collectionKey] = data[collectionKey].filter(item => item.tilesetId !== tilesetId);

        return {
            operations: removed.map(entity => ({
                entityType, type: OperationType.DELETE, id: entity.id,
                data: null, previous: entity
            })),
            result: removed.length,
            effect: () => emit(changeEvent, { mapName: targetMap })
        };
    }, 0);
}

// ===== CAMERA POSITION OPERATIONS =====

/**
 * Saves camera position for a tileset.
 *
 * @param {string} tilesetId - Tileset ID
 * @param {Object} position - Position { longitude, latitude, height }
 * @param {Object} orientation - Orientation { heading, pitch, roll }
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<void>}
 */
export async function saveCameraPosition(tilesetId, position, orientation, mapName = null) {
    // RETURNS A BOOLEAN since 2026-09-21. It used to return `undefined` on success AND on every
    // refusal (role, lock, and now a map the atlas no longer has), so the viewer announced
    // success unconditionally: a refused save showed the success toast next to the refusal.
    if (!guardCesium3dWrite(GuardAction.CREATE_MARKER_3D, 'saveCameraPosition')) return false;

    const targetMap = getTargetMapName(mapName);
    return editCesium3d(targetMap, 'saveCameraPosition', data => {
        const existing = data.cameraPositions[tilesetId];
        const isUpdate = !!existing;
        const previousData = existing ? { ...existing } : null;

        const sync = existing?.sync
            ? touchSyncMetadata(existing.sync)
            : createSyncMetadata(null);

        const newPosition = {
            id: existing?.id || generateUUID(),
            tilesetId,
            position,
            orientation,
            savedAt: Date.now(),
            sync
        };
        data.cameraPositions[tilesetId] = newPosition;

        return {
            operations: [{
                entityType: EntityType.CAMERA_POSITION_3D,
                type: isUpdate ? OperationType.UPDATE : OperationType.CREATE,
                id: newPosition.id,
                data: newPosition,
                previous: isUpdate ? previousData : null
            }],
            effect: () => emit(EventTypes.CAMERA_3D_SAVED, { tilesetId, mapName: targetMap }),
            result: true
        };
    }, false);
}

/**
 * Gets saved camera position for a tileset.
 *
 * @param {string} tilesetId - Tileset ID
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<Object|null>}
 */
export async function getCameraPosition(tilesetId, mapName = null) {
    const targetMap = getTargetMapName(mapName);
    const data = await getCesium3dDataWithCache(targetMap);
    return data.cameraPositions[tilesetId] || null;
}

/**
 * Checks if a tileset has a saved camera position.
 *
 * @param {string} tilesetId - Tileset ID
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<boolean>}
 */
export async function hasSavedCameraPosition(tilesetId, mapName = null) {
    const position = await getCameraPosition(tilesetId, mapName);
    return position !== null;
}

/**
 * Clears saved camera position for a tileset.
 *
 * @param {string} tilesetId - Tileset ID
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<boolean>}
 */
export async function clearCameraPosition(tilesetId, mapName = null) {
    if (!guardCesium3dWrite(GuardAction.DELETE_MARKER_3D, 'clearCameraPosition')) return false;

    const targetMap = getTargetMapName(mapName);
    return editCesium3d(targetMap, 'clearCameraPosition', data => {
        const existing = data.cameraPositions[tilesetId];
        if (!existing) return null;

        const previousData = { ...existing };
        const positionId = existing.id || tilesetId;
        delete data.cameraPositions[tilesetId];

        return {
            operations: [{
                entityType: EntityType.CAMERA_POSITION_3D,
                type: OperationType.DELETE,
                id: positionId,
                data: null,
                previous: previousData
            }],
            result: true
        };
    }, false);
}

/**
 * Gets all saved camera positions for a map.
 *
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<Object>} Object with tilesetId as keys
 */
export async function getAllCameraPositions(mapName = null) {
    const targetMap = getTargetMapName(mapName);
    const data = await getCesium3dDataWithCache(targetMap);
    return data.cameraPositions || {};
}

// ===== MARKER OPERATIONS =====

/**
 * Default marker style configuration.
 */
export const DEFAULT_MARKER_STYLE = {
    markerColor: '#3f4fb5',
    markerSize: 32,
    markerOpacity: 1,
    showMarker: true,
    showLabel: true,
    labelText: '',
    labelColor: '#ffffff',
    labelBackgroundColor: '#3f4fb5',
    labelBackgroundOpacity: 0.9,
    labelSize: 14,
    labelOutlineColor: '#000000',
    labelOutlineWidth: 2
};

/**
 * Adds a new marker to a tileset.
 *
 * @param {string} tilesetId - Tileset ID
 * @param {Object} markerData - Marker data { position, properties, style }
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<Object>} Created marker
 */
export async function addMarker(tilesetId, markerData, mapName = null) {
    if (!guardCesium3dWrite(GuardAction.CREATE_MARKER_3D, 'addMarker')) return null;

    const targetMap = getTargetMapName(mapName);
    return editCesium3d(targetMap, 'addMarker', data => {
        const nextNumber = getNextAutoNumber(data.markers, /^Ponto #(\d+)$/);
        const defaultName = `Ponto #${nextNumber}`;
        const userDefaultStyle = getUserDefaultStyle('marker3d_default_style');

        const marker = {
            id: generateUUID(),
            tilesetId,
            position: markerData.position,
            properties: {
                nome: markerData.properties?.nome || defaultName,
                descricao: markerData.properties?.descricao || ''
            },
            style: {
                ...DEFAULT_MARKER_STYLE,
                ...userDefaultStyle,
                labelText: markerData.properties?.rotulo || '',
                ...(markerData.style || {})
            },
            sync: createSyncMetadata(null)
        };

        data.markers.push(marker);

        return {
            operations: [{
                entityType: EntityType.MARKER_3D, type: OperationType.CREATE,
                id: marker.id, data: marker, previous: null
            }],
            result: marker,
            effect: () => emit(EventTypes.MARKERS_3D_CHANGED, { mapName: targetMap })
        };
    }, null);
}

/**
 * Gets all markers for a specific tileset. Filters out soft-deleted markers.
 *
 * @param {string} tilesetId - Tileset ID
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<Array>}
 */
export async function getMarkers(tilesetId, mapName = null) {
    const targetMap = getTargetMapName(mapName);
    const data = await getCesium3dDataWithCache(targetMap);
    return data.markers.filter(m => m.tilesetId === tilesetId && isActive(m.sync));
}

/**
 * Gets all markers for the current map. Filters out soft-deleted markers.
 *
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<Array>}
 */
export async function getAllMarkers(mapName = null) {
    const targetMap = getTargetMapName(mapName);
    const data = await getCesium3dDataWithCache(targetMap);
    return (data.markers || []).filter(m => isActive(m.sync));
}

/**
 * Gets a marker by ID.
 *
 * @param {string} markerId - Marker ID
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<Object|null>}
 */
export async function getMarkerById(markerId, mapName = null) {
    const targetMap = getTargetMapName(mapName);
    const data = await getCesium3dDataWithCache(targetMap);
    return data.markers.find(m => m.id === markerId) || null;
}

/**
 * Updates a marker's properties, style, or position.
 *
 * Temporal validity (optional, additive) lives on `properties.temporalInicio`
 * and `properties.temporalFim` (epoch ms); pass them inside `updates.properties`
 * to persist a marker's visibility window.
 *
 * @param {string} markerId - Marker ID
 * @param {Object} updates - Properties to update { properties, style, position }
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<Object|null>} Updated marker or null if not found
 */
export async function updateMarker(markerId, updates, mapName = null) {
    if (!guardCesium3dWrite(GuardAction.CREATE_MARKER_3D, 'updateMarker')) return null;

    const targetMap = getTargetMapName(mapName);
    return editCesium3d(targetMap, 'updateMarker', data => {
        const markerIndex = data.markers.findIndex(m => m.id === markerId);
        if (markerIndex === -1) return null;

        const marker = data.markers[markerIndex];
        const oldMarker = { ...marker };

        if (updates.properties) {
            marker.properties = { ...marker.properties, ...updates.properties };
        }
        if (updates.style) {
            marker.style = { ...(marker.style || DEFAULT_MARKER_STYLE), ...updates.style };
        }
        if (updates.position) {
            marker.position = updates.position;
        }
        marker.sync = touchSyncMetadata(marker.sync);

        data.markers[markerIndex] = marker;

        return {
            operations: [{
                entityType: EntityType.MARKER_3D, type: OperationType.UPDATE,
                id: markerId, data: marker, previous: oldMarker
            }],
            result: marker,
            effect: () => emit(EventTypes.MARKERS_3D_CHANGED, { mapName: targetMap })
        };
    }, null);
}

/**
 * Removes a marker.
 *
 * @param {string} markerId - Marker ID
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<boolean>}
 */
export async function removeMarker(markerId, mapName = null) {
    if (!guardCesium3dWrite(GuardAction.DELETE_MARKER_3D, 'removeMarker')) return false;

    const targetMap = getTargetMapName(mapName);
    return editCesium3d(targetMap, 'removeMarker', data => {
        const deletedMarker = data.markers.find(m => m.id === markerId);
        if (!deletedMarker) return null;

        data.markers = data.markers.filter(m => m.id !== markerId);

        return {
            operations: [{
                entityType: EntityType.MARKER_3D, type: OperationType.DELETE,
                id: markerId, data: null, previous: deletedMarker
            }],
            result: true,
            effect: () => emit(EventTypes.MARKERS_3D_CHANGED, { mapName: targetMap })
        };
    }, false);
}

/**
 * Removes all markers for a specific tileset.
 *
 * @param {string} tilesetId - Tileset ID
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<number>} Number of markers removed
 */
export async function removeMarkersByTileset(tilesetId, mapName = null) {
    return removeByTileset(tilesetId, 'markers', EventTypes.MARKERS_3D_CHANGED, mapName, EntityType.MARKER_3D);
}

// ===== MEMORY OPERATIONS =====

/**
 * Loads cesium3d data to memory for a map.
 *
 * @param {string} mapName
 * @returns {Promise<void>}
 */
export async function loadCesium3dDataToMemory(mapName) {
    const data = await getCesium3dCompat(mapName);
    memoryStore.cesium3d = { ...data, _mapName: mapName };
}

/**
 * Clears cesium3d memory cache.
 */
export function clearCesium3dCache() {
    memoryStore.cesium3d = {
        cameraPositions: {},
        markers: [],
        measurements: [],
        viewsheds: [],
        _mapName: null
    };
}

// ===== IMPORT / EXPORT =====

/**
 * Sets cesium3d data for a map (used by import).
 *
 * @param {string} mapName
 * @param {Object} cesium3dData
 * @returns {Promise<void>}
 */
export async function setCesium3dDataForImport(mapName, cesium3dData) {
    const normalizedData = {
        cameraPositions: cesium3dData.cameraPositions || {},
        markers: cesium3dData.markers || [],
        measurements: cesium3dData.measurements || [],
        viewsheds: cesium3dData.viewsheds || []
    };

    await setCesium3dCompat(mapName, normalizedData);

    if (mapName === mapManager.getCurrentMapName()) {
        memoryStore.cesium3d = { ...normalizedData, _mapName: mapName };
        emit(EventTypes.MARKERS_3D_CHANGED, { mapName });
        emit(EventTypes.MEASUREMENTS_3D_CHANGED, { mapName });
        emit(EventTypes.VIEWSHEDS_3D_CHANGED, { mapName });
    }
}

/**
 * Gets cesium3d data for export. Returns null if no data exists.
 *
 * @param {string} mapName
 * @returns {Promise<Object|null>}
 */
export async function getCesium3dDataForExport(mapName) {
    const data = await getCesium3dCompat(mapName);

    const hasData = Object.keys(data.cameraPositions).length > 0
        || data.markers.length > 0
        || (data.measurements && data.measurements.length > 0)
        || (data.viewsheds && data.viewsheds.length > 0);

    if (!hasData) return null;

    return {
        cameraPositions: data.cameraPositions,
        markers: data.markers,
        measurements: data.measurements || [],
        viewsheds: data.viewsheds || []
    };
}

// ===== MARKER IMAGE OPERATIONS =====

/**
 * Adds an image to a marker.
 *
 * @param {string} markerId - Marker ID
 * @param {File} file - Image file
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<Object|null>}
 */
export async function addMarkerImage(markerId, file, mapName = null) {
    return addEntityImage(markerId, file, 'markers', EventTypes.MARKERS_3D_CHANGED, mapName, EntityType.MARKER_3D);
}

/**
 * Gets all images for a marker.
 *
 * @param {string} markerId - Marker ID
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<Array>}
 */
export async function getMarkerImages(markerId, mapName = null) {
    return getEntityImages(markerId, 'markers', mapName);
}

/**
 * Removes an image from a marker.
 *
 * @param {string} markerId - Marker ID
 * @param {string} imageId - Image ID
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<boolean>}
 */
export async function removeMarkerImage(markerId, imageId, mapName = null) {
    return removeEntityImage(markerId, imageId, 'markers', EventTypes.MARKERS_3D_CHANGED, mapName, EntityType.MARKER_3D);
}

// ===== MEASUREMENT OPERATIONS =====

/**
 * Default measurement style configuration.
 */
export const DEFAULT_MEASUREMENT_STYLE = {
    lineColor: '#FFFF00',
    lineWidth: 3,
    lineOpacity: 1,
    fillColor: '#FFFF00',
    fillOpacity: 0.2,
    labelColor: '#ffffff',
    labelSize: 14,
    labelOutlineColor: '#000000',
    labelOutlineWidth: 2,
    labelBackgroundColor: '#FFFF00',
    labelBackgroundOpacity: 0.8
};

/**
 * Adds a new measurement to a tileset.
 *
 * @param {string} tilesetId - Tileset ID
 * @param {Object} measurementData - { type, positions, result, properties, style }
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<Object>} Created measurement
 */
export async function addMeasurement(tilesetId, measurementData, mapName = null) {
    if (!guardCesium3dWrite(GuardAction.CREATE_MARKER_3D, 'addMeasurement')) return null;

    const targetMap = getTargetMapName(mapName);
    return editCesium3d(targetMap, 'addMeasurement', data => {
        if (!data.measurements) data.measurements = [];

        const type = measurementData.type || 'distance';
        const prefix = type === 'distance' ? 'Distância' : 'Área';
        const nextNumber = getNextAutoNumber(
            data.measurements,
            new RegExp(`^${prefix} #(\\d+)$`),
            (m) => m.type === type
        );
        const defaultName = `${prefix} #${nextNumber}`;
        const userDefaultStyle = getUserDefaultStyle('measurement3d_default_style');

        const measurement = {
            id: generateUUID(),
            tilesetId,
            type,
            positions: measurementData.positions || [],
            result: measurementData.result || { value: 0, formatted: '' },
            properties: {
                nome: measurementData.properties?.nome || defaultName,
                descricao: measurementData.properties?.descricao || ''
            },
            style: {
                ...DEFAULT_MEASUREMENT_STYLE,
                ...userDefaultStyle,
                ...(measurementData.style || {})
            },
            images: [],
            sync: createSyncMetadata(null)
        };

        data.measurements.push(measurement);

        return {
            operations: [{
                entityType: EntityType.MEASUREMENT_3D, type: OperationType.CREATE,
                id: measurement.id, data: measurement, previous: null
            }],
            result: measurement,
            effect: () => emit(EventTypes.MEASUREMENTS_3D_CHANGED, { mapName: targetMap })
        };
    }, null);
}

/**
 * Gets all measurements for a specific tileset. Filters out soft-deleted.
 *
 * @param {string} tilesetId - Tileset ID
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<Array>}
 */
export async function getMeasurements(tilesetId, mapName = null) {
    const targetMap = getTargetMapName(mapName);
    const data = await getCesium3dDataWithCache(targetMap);
    return (data.measurements || []).filter(m => m.tilesetId === tilesetId && isActive(m.sync));
}

/**
 * Gets all measurements for the current map. Filters out soft-deleted.
 *
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<Array>}
 */
export async function getAllMeasurements(mapName = null) {
    const targetMap = getTargetMapName(mapName);
    const data = await getCesium3dDataWithCache(targetMap);
    return (data.measurements || []).filter(m => isActive(m.sync));
}

/**
 * Gets a measurement by ID.
 *
 * @param {string} measurementId - Measurement ID
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<Object|null>}
 */
export async function getMeasurementById(measurementId, mapName = null) {
    const targetMap = getTargetMapName(mapName);
    const data = await getCesium3dDataWithCache(targetMap);
    return (data.measurements || []).find(m => m.id === measurementId) || null;
}

/**
 * Updates a measurement's properties or style.
 *
 * @param {string} measurementId - Measurement ID
 * @param {Object} updates - { properties, style }
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<Object|null>} Updated measurement or null if not found
 */
export async function updateMeasurement(measurementId, updates, mapName = null) {
    if (!guardCesium3dWrite(GuardAction.CREATE_MARKER_3D, 'updateMeasurement')) return null;

    const targetMap = getTargetMapName(mapName);
    return editCesium3d(targetMap, 'updateMeasurement', data => {
        if (!data.measurements) return null;

        const measurementIndex = data.measurements.findIndex(m => m.id === measurementId);
        if (measurementIndex === -1) return null;

        const measurement = data.measurements[measurementIndex];
        const oldMeasurement = { ...measurement };

        if (updates.properties) {
            measurement.properties = { ...measurement.properties, ...updates.properties };
        }
        if (updates.style) {
            measurement.style = { ...(measurement.style || DEFAULT_MEASUREMENT_STYLE), ...updates.style };
        }
        measurement.sync = touchSyncMetadata(measurement.sync);

        data.measurements[measurementIndex] = measurement;

        return {
            operations: [{
                entityType: EntityType.MEASUREMENT_3D, type: OperationType.UPDATE,
                id: measurementId, data: measurement, previous: oldMeasurement
            }],
            result: measurement,
            effect: () => emit(EventTypes.MEASUREMENTS_3D_CHANGED, { mapName: targetMap })
        };
    }, null);
}

/**
 * Removes a measurement.
 *
 * @param {string} measurementId - Measurement ID
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<boolean>}
 */
export async function removeMeasurement(measurementId, mapName = null) {
    if (!guardCesium3dWrite(GuardAction.DELETE_MARKER_3D, 'removeMeasurement')) return false;

    const targetMap = getTargetMapName(mapName);
    return editCesium3d(targetMap, 'removeMeasurement', data => {
        if (!data.measurements) return null;

        const deletedMeasurement = data.measurements.find(m => m.id === measurementId);
        if (!deletedMeasurement) return null;

        data.measurements = data.measurements.filter(m => m.id !== measurementId);

        return {
            operations: [{
                entityType: EntityType.MEASUREMENT_3D, type: OperationType.DELETE,
                id: measurementId, data: null, previous: deletedMeasurement
            }],
            result: true,
            effect: () => emit(EventTypes.MEASUREMENTS_3D_CHANGED, { mapName: targetMap })
        };
    }, false);
}

/**
 * Adds an image to a measurement.
 *
 * @param {string} measurementId - Measurement ID
 * @param {File} file - Image file
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<Object|null>}
 */
export async function addMeasurementImage(measurementId, file, mapName = null) {
    return addEntityImage(measurementId, file, 'measurements', EventTypes.MEASUREMENTS_3D_CHANGED, mapName, EntityType.MEASUREMENT_3D);
}

/**
 * Gets all images for a measurement.
 *
 * @param {string} measurementId - Measurement ID
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<Array>}
 */
export async function getMeasurementImages(measurementId, mapName = null) {
    return getEntityImages(measurementId, 'measurements', mapName);
}

/**
 * Removes an image from a measurement.
 *
 * @param {string} measurementId - Measurement ID
 * @param {string} imageId - Image ID
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<boolean>}
 */
export async function removeMeasurementImage(measurementId, imageId, mapName = null) {
    return removeEntityImage(measurementId, imageId, 'measurements', EventTypes.MEASUREMENTS_3D_CHANGED, mapName, EntityType.MEASUREMENT_3D);
}

// ===== VIEWSHED OPERATIONS =====

/**
 * Adds a new viewshed to a tileset.
 *
 * @param {string} tilesetId - Tileset ID
 * @param {Object} viewshedData - { position, targetPosition, terrainBaseHeight, direction, parameters, observerHeight, properties }
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<Object>} Created viewshed
 */
export async function addViewshed(tilesetId, viewshedData, mapName = null) {
    if (!guardCesium3dWrite(GuardAction.CREATE_MARKER_3D, 'addViewshed')) return null;

    const targetMap = getTargetMapName(mapName);
    return editCesium3d(targetMap, 'addViewshed', data => {
        if (!data.viewsheds) data.viewsheds = [];

        const nextNumber = getNextAutoNumber(data.viewsheds, /^Visibilidade #(\d+)$/);
        const defaultName = `Visibilidade #${nextNumber}`;

        const viewshed = {
            id: generateUUID(),
            tilesetId,
            position: viewshedData.position || { longitude: 0, latitude: 0, height: 0 },
            targetPosition: viewshedData.targetPosition || null,
            terrainBaseHeight: viewshedData.terrainBaseHeight ?? null,
            direction: viewshedData.direction || { heading: 0, pitch: 0 },
            parameters: viewshedData.parameters || { horizontalAngle: 150, verticalAngle: 120, distance: 10 },
            observerHeight: viewshedData.observerHeight ?? 1.5,
            properties: {
                nome: viewshedData.properties?.nome || defaultName,
                descricao: viewshedData.properties?.descricao || ''
            },
            images: [],
            sync: createSyncMetadata(null)
        };

        data.viewsheds.push(viewshed);

        return {
            operations: [{
                entityType: EntityType.VIEWSHED_3D, type: OperationType.CREATE,
                id: viewshed.id, data: viewshed, previous: null
            }],
            result: viewshed,
            effect: () => emit(EventTypes.VIEWSHEDS_3D_CHANGED, { mapName: targetMap })
        };
    }, null);
}

/**
 * Gets all viewsheds for a specific tileset. Filters out soft-deleted.
 *
 * @param {string} tilesetId - Tileset ID
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<Array>}
 */
export async function getViewsheds(tilesetId, mapName = null) {
    const targetMap = getTargetMapName(mapName);
    const data = await getCesium3dDataWithCache(targetMap);
    return (data.viewsheds || []).filter(v => v.tilesetId === tilesetId && isActive(v.sync));
}

/**
 * Gets all viewsheds for the current map. Filters out soft-deleted.
 *
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<Array>}
 */
export async function getAllViewsheds(mapName = null) {
    const targetMap = getTargetMapName(mapName);
    const data = await getCesium3dDataWithCache(targetMap);
    return (data.viewsheds || []).filter(v => isActive(v.sync));
}

/**
 * Gets a viewshed by ID.
 *
 * @param {string} viewshedId - Viewshed ID
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<Object|null>}
 */
export async function getViewshedById(viewshedId, mapName = null) {
    const targetMap = getTargetMapName(mapName);
    const data = await getCesium3dDataWithCache(targetMap);
    return (data.viewsheds || []).find(v => v.id === viewshedId) || null;
}

/**
 * Updates a viewshed's properties, analysis parameters or observer height.
 *
 * @param {string} viewshedId - Viewshed ID
 * @param {Object} updates - { properties, parameters, observerHeight }
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<Object|null>} Updated viewshed or null if not found
 */
export async function updateViewshed(viewshedId, updates, mapName = null) {
    if (!guardCesium3dWrite(GuardAction.CREATE_MARKER_3D, 'updateViewshed')) return null;

    const targetMap = getTargetMapName(mapName);
    return editCesium3d(targetMap, 'updateViewshed', data => {
        if (!data.viewsheds) return null;

        const viewshedIndex = data.viewsheds.findIndex(v => v.id === viewshedId);
        if (viewshedIndex === -1) return null;

        const viewshed = data.viewsheds[viewshedIndex];
        const oldViewshed = { ...viewshed };

        if (updates.properties) {
            viewshed.properties = { ...viewshed.properties, ...updates.properties };
        }
        // Os parâmetros da análise (campo horizontal, campo vertical, distância) são
        // FUNDIDOS, no mesmo padrão do updateMarker. Sem esta linha eles caíam em silêncio:
        // o painel manda `{ parameters: {...} }`, o atualizador só conhecia `properties` e
        // `observerHeight`, o retorno vinha com o valor velho e o cone era recriado igual.
        // Preso por tests/store/viewshed-parametros.test.js.
        if (updates.parameters) {
            viewshed.parameters = { ...(viewshed.parameters || {}), ...updates.parameters };
        }
        if (updates.observerHeight !== undefined) {
            viewshed.observerHeight = updates.observerHeight;
        }
        viewshed.sync = touchSyncMetadata(viewshed.sync);

        data.viewsheds[viewshedIndex] = viewshed;

        return {
            operations: [{
                entityType: EntityType.VIEWSHED_3D, type: OperationType.UPDATE,
                id: viewshedId, data: viewshed, previous: oldViewshed
            }],
            result: viewshed,
            effect: () => emit(EventTypes.VIEWSHEDS_3D_CHANGED, { mapName: targetMap })
        };
    }, null);
}

/**
 * Removes a viewshed.
 *
 * @param {string} viewshedId - Viewshed ID
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<boolean>}
 */
export async function removeViewshed(viewshedId, mapName = null) {
    if (!guardCesium3dWrite(GuardAction.DELETE_MARKER_3D, 'removeViewshed')) return false;

    const targetMap = getTargetMapName(mapName);
    return editCesium3d(targetMap, 'removeViewshed', data => {
        if (!data.viewsheds) return null;

        const deletedViewshed = data.viewsheds.find(v => v.id === viewshedId);
        if (!deletedViewshed) return null;

        data.viewsheds = data.viewsheds.filter(v => v.id !== viewshedId);

        return {
            operations: [{
                entityType: EntityType.VIEWSHED_3D, type: OperationType.DELETE,
                id: viewshedId, data: null, previous: deletedViewshed
            }],
            result: true,
            effect: () => emit(EventTypes.VIEWSHEDS_3D_CHANGED, { mapName: targetMap })
        };
    }, false);
}

/**
 * Adds an image to a viewshed.
 *
 * @param {string} viewshedId - Viewshed ID
 * @param {File} file - Image file
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<Object|null>}
 */
export async function addViewshedImage(viewshedId, file, mapName = null) {
    return addEntityImage(viewshedId, file, 'viewsheds', EventTypes.VIEWSHEDS_3D_CHANGED, mapName, EntityType.VIEWSHED_3D);
}

/**
 * Gets all images for a viewshed.
 *
 * @param {string} viewshedId - Viewshed ID
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<Array>}
 */
export async function getViewshedImages(viewshedId, mapName = null) {
    return getEntityImages(viewshedId, 'viewsheds', mapName);
}

/**
 * Removes an image from a viewshed.
 *
 * @param {string} viewshedId - Viewshed ID
 * @param {string} imageId - Image ID
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<boolean>}
 */
export async function removeViewshedImage(viewshedId, imageId, mapName = null) {
    return removeEntityImage(viewshedId, imageId, 'viewsheds', EventTypes.VIEWSHEDS_3D_CHANGED, mapName, EntityType.VIEWSHED_3D);
}

// ===== BULK REMOVAL OPERATIONS =====

/**
 * Removes all measurements for a specific tileset.
 *
 * @param {string} tilesetId - Tileset ID
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<number>}
 */
export async function removeMeasurementsByTileset(tilesetId, mapName = null) {
    return removeByTileset(tilesetId, 'measurements', EventTypes.MEASUREMENTS_3D_CHANGED, mapName, EntityType.MEASUREMENT_3D);
}

/**
 * Removes all viewsheds for a specific tileset.
 *
 * @param {string} tilesetId - Tileset ID
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<number>}
 */
export async function removeViewshedsByTileset(tilesetId, mapName = null) {
    return removeByTileset(tilesetId, 'viewsheds', EventTypes.VIEWSHEDS_3D_CHANGED, mapName, EntityType.VIEWSHED_3D);
}

/**
 * Removes all features (markers, measurements, viewsheds) for a specific tileset.
 *
 * @param {string} tilesetId - Tileset ID
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<{markers: number, measurements: number, viewsheds: number, total: number}>}
 */
export async function removeAllFeaturesByTileset(tilesetId, mapName = null) {
    if (!guardCesium3dWrite(GuardAction.DELETE_MARKER_3D, 'removeAllFeaturesByTileset')) {
        return { markers: 0, measurements: 0, viewsheds: 0, total: 0 };
    }

    const targetMap = getTargetMapName(mapName);
    let counts = { markers: 0, measurements: 0, viewsheds: 0, total: 0 };
    await editCesium3d(targetMap, 'removeAllFeaturesByTileset', data => {
        const belongs = (item) => item.tilesetId === tilesetId;

        // Snapshot each family's dropped entities so every one can carry its own oldData.
        const removedMarkers = data.markers.filter(belongs);
        const removedMeasurements = (data.measurements || []).filter(belongs);
        const removedViewsheds = (data.viewsheds || []).filter(belongs);

        const totalRemoved = removedMarkers.length + removedMeasurements.length + removedViewsheds.length;
        counts = {
            markers: removedMarkers.length,
            measurements: removedMeasurements.length,
            viewsheds: removedViewsheds.length,
            total: totalRemoved
        };
        // Nothing matched: no op, no write, and the counts are already all zero.
        if (totalRemoved === 0) return null;

        data.markers = data.markers.filter(m => !belongs(m));
        if (data.measurements) {
            data.measurements = data.measurements.filter(m => !belongs(m));
        }
        if (data.viewsheds) {
            data.viewsheds = data.viewsheds.filter(v => !belongs(v));
        }

        // Without a DELETE op per entity the bulk wipe stayed local and peers kept rendering
        // the removed features. The three families share ONE journal write, so either the
        // whole wipe is recoverable or none of it happened.
        const families = [
            [removedMarkers, EntityType.MARKER_3D],
            [removedMeasurements, EntityType.MEASUREMENT_3D],
            [removedViewsheds, EntityType.VIEWSHED_3D]
        ];
        const operations = [];
        for (const [entities, entityType] of families) {
            for (const entity of entities) {
                operations.push({
                    entityType, type: OperationType.DELETE, id: entity.id,
                    data: null, previous: entity
                });
            }
        }

        return {
            operations,
            effect: () => {
                if (removedMarkers.length > 0) emit(EventTypes.MARKERS_3D_CHANGED, { mapName: targetMap });
                if (removedMeasurements.length > 0) emit(EventTypes.MEASUREMENTS_3D_CHANGED, { mapName: targetMap });
                if (removedViewsheds.length > 0) emit(EventTypes.VIEWSHEDS_3D_CHANGED, { mapName: targetMap });
            }
        };
    });
    return counts;
}

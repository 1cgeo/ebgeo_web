// Path: js/store/feature.operations.js

/**
 * @fileoverview Feature CRUD operations.
 */

import { cleanFeature } from './repository.utils.js';
import { getMapDataCompat, updateMapDataCompat, getLayersCompat } from './repositories/index.js';
// A LEITURA ESTRITA DAS ESCRITAS (D2). Toda leitura deste arquivo que termine gravando o
// documento do mapa passa por aqui; as duas leituras PURAS (`getCurrentMapFeatures`,
// `getFeatureById`) seguem no `getMapDataCompat` tolerante, que é o certo para elas.
import { mapDocumentForDerivedWrite, mapDocumentForGesture } from './mapa-inexistente.js';
import { FEATURE_TYPE_MAPPINGS, getAllStorageTypes, getStorageTypeFromSource, getSourceTypeFromStorage, IMAGE_RESOURCE_FEATURE_TYPES } from './store.constants.js';
import { removeImage } from './settings.operations.js';
import mapManager from './store-state-manager.js';
import { memoryStore } from './memory-store.js';
import { isCurrentMapLockedSync } from './map.operations.js';
import { OperationType } from './sync/index.js';
// Leaf module (zero imports): keeps the vocabulary out of the sync barrel's graph.
import { EntityType } from './sync/operation-types.js';
import { checkPermission, GuardAction } from './sync/permission-guard.js';
import { emitStoreError, StoreErrorEvents } from './store-errors.js';
import { runTransaction } from './store-transaction.js';
import { withMapDocument } from './document-lock.js';
import { deepClone, deepEqual } from '../utilities/deep-utils.js';
import { EventTypes } from '../events';
import { applyGeneratedBitmap } from '../layers/bitmap-version.js';
// Leaf modules (no store in their graph), so the mirror below shares the PANEL'S derivation
// instead of carrying a second copy of it. `temporal-attributes.model.js` imports only
// `temporal-model.js` and `temporal.utils.js`; nothing there reaches back into the store.
import { derivarCamposDtg } from '../temporal/temporal-attributes.model.js';
import { derivedOutputBucketOf, replaceDerivedOutput } from './analysis-output.js';
import { FeatureLockState, lockedLayerCreateNotice, featureLockNotice } from './denial-phrases.js';
import { converterFotosInline, comConversao, fotosSemBytes } from './photo-attach.js';
import { fotoTemBytesInline } from '../user_data/photo-refs.js';

// ===== ATTACHED PHOTOS =====

/**
 * THE SAFETY NET OF PHASE 2c of the attached photos, for a FEATURE: an edit OF THE PHOTOS of a
 * feature of a SERVER atlas that still carries inline photos writes them as blobs with a reference,
 * so the operation leaves without the bytes (`converterFotosInline`, `photo-attach.js`, says which
 * convert, why under a new id, and why only in a server atlas). Mutates `feature.properties.images`
 * when something converted. An edit of anything else leaves them as they are ({@link fotosMudaram}).
 *
 * CALLED INSIDE THE TRANSACTION'S WORK (2026-09-24, review, item 5), like the 3D and 360 funnels:
 * it writes to IndexedDB (the bytes and the upload pendency), and outside the work those writes
 * happened before `runTransaction` asked for the scope stamp, the logout barrier and the per-tab
 * pause, so a write the transaction then refused had already stored and registered a photo. The
 * caller reads the conversion through `comConversao`, which sends it after the write, also after
 * a write that threw.
 *
 * @param {Object} feature - The feature about to be written
 * @returns {Promise<{confirmar: () => void, descartar: () => Promise<void>}|null>}
 */
async function converterFotosDaFeicao(feature) {
    const conversao = await converterFotosInline(feature?.properties?.images);
    if (conversao) feature.properties.images = conversao.fotos;
    return conversao;
}

/**
 * Whether an edit changes the attached photos of a feature (compared with their bytes).
 *
 * THE CONVERSION RIDES ONLY ON AN EDIT OF THE PHOTOS (2026-09-24, second review of the attached
 * photos, item 4). Converting on ANY edit put `properties.images` in the patch of an edit that had
 * nothing to do with them, under new ids, so two colleagues editing the name and the description of
 * the same feature both claimed the photos and the second was refused as a dispute over a field
 * neither touched. When the person edits the photos, the patch claims `images` anyway, and the
 * conversion adds no unit to it. The weight that made the conversion ride on every edit (the old
 * side carrying the bytes) is taken off by {@link previousOfFeatureEdit} instead.
 *
 * THE COST, accepted by the coordinator of the review on 2026-09-24: an edit that does not touch the
 * photos carries the bytes of an inline photo ONCE, in the new side (zero while every edit converted,
 * two before phase 2c), and the inline acervo converges to blobs more slowly, only when someone edits
 * the photos of a feature or when a local atlas goes up. A false dispute that holds the whole feature
 * was judged worse than both.
 * @param {Object} anterior - The feature as it was
 * @param {Object} nova - The feature about to be written
 * @returns {boolean}
 */
function fotosMudaram(anterior, nova) {
    return !deepEqual(anterior?.properties?.images ?? null, nova?.properties?.images ?? null);
}

/**
 * The previous side of a feature edit, as the envelope carries it: without the bytes of its inline
 * photos. The client reads from `previousData` only the confirmed version and the patch, and the
 * patch compares photos without their bytes (`store/sync/feature-patch.js`), so the bytes there were
 * dead weight: an edit of a feature with an inline photo sent the photo twice. The NEW side keeps
 * them, because a pending intention is reprojected over a snapshot by writing its `data` as the
 * entity (`applyRemoteSnapshot`), and a new side without bytes would drop the photo locally.
 * @param {Object} anterior - The feature as it was
 * @returns {Object}
 */
function previousOfFeatureEdit(anterior) {
    const fotos = anterior?.properties?.images;
    if (!Array.isArray(fotos) || !fotos.some(fotoTemBytesInline)) return anterior;
    return { ...anterior, properties: { ...anterior.properties, images: fotosSemBytes(fotos) } };
}


// ===== TIMESTAMP AND VERSION HELPERS =====

/**
 * Adds createdAt timestamp and initial version to a new feature.
 * @param {Object} feature - Feature to timestamp
 * @returns {Object} Feature with createdAt, updatedAt, and version in properties
 */
function addCreatedTimestamp(feature) {
    if (!feature || !feature.properties) return feature;
    if (!feature.properties.createdAt) {
        feature.properties.createdAt = Date.now();
    }
    if (!feature.properties.updatedAt) {
        feature.properties.updatedAt = feature.properties.createdAt;
    }
    if (feature.properties.version === undefined) {
        feature.properties.version = 1;
    }
    return feature;
}

/**
 * Updates the updatedAt timestamp and increments version on a feature.
 * @param {Object} feature - Feature to update
 * @returns {Object} Feature with updated timestamp and version
 */
function touchUpdatedTimestamp(feature) {
    if (!feature || !feature.properties) return feature;
    feature.properties.updatedAt = Date.now();
    feature.properties.version = (feature.properties.version || 0) + 1;
    return feature;
}

/**
 * Compares two features ignoring auto-managed metadata (updatedAt, version).
 * Used to detect no-op updates before touching timestamps.
 * @param {Object} a - First feature (stored)
 * @param {Object} b - Second feature (incoming, after cleanFeature + preserve)
 * @returns {boolean} True if features are equivalent
 */
function isFeatureEqual(a, b) {
    if (!deepEqual(a.geometry, b.geometry)) return false;

    const propsA = { ...a.properties };
    const propsB = { ...b.properties };
    delete propsA.updatedAt;
    delete propsB.updatedAt;
    delete propsA.version;
    delete propsB.version;

    return deepEqual(propsA, propsB);
}

// ===== DEPENDENCY INJECTION =====

/** @type {import('./store.types.js').StoreDependencies} */
const deps = { eventBus: null, groupManager: null, layerManager: null };

/**
 * Sets dependencies for feature operations.
 * @param {import('./store.types.js').StoreDependencies} dependencies
 */
export function setFeatureDependencies(dependencies) {
    Object.assign(deps, dependencies);
}

// ===== INTERNAL HELPERS =====

/**
 * Returns the storage type for a feature based on its source property.
 * @param {Object} feature
 * @returns {string|undefined}
 */
function getFeatureType(feature) {
    return FEATURE_TYPE_MAPPINGS[feature.properties?.source];
}

/**
 * Returns the processed storage type key for analysis features.
 * @param {string} type - 'los' or 'visibility'
 * @returns {string|null}
 */
function getProcessedType(type) {
    // The one list (`DERIVED_OUTPUT_BUCKET_OF`, read through the leaf), not a second copy of it.
    return derivedOutputBucketOf(type);
}

/**
 * Resolves the target map name, defaulting to the current map.
 * @param {string|null} mapName
 * @returns {string}
 */
function resolveMap(mapName) {
    return mapName || mapManager.getCurrentMapName();
}

/**
 * Checks permission and map lock for a write operation.
 * Returns an object with `blocked` flag. If blocked, emits the appropriate error.
 * Uses isCurrentMapLockedSync for current-map operations (includes briefing lock override),
 * and memoryStore.lockedMaps for explicit cross-map operations.
 * @param {string} guardAction - GuardAction constant
 * @param {string} operationName - Name for error reporting
 * @param {string} [targetMap] - Map name to check lock against
 * @returns {{ blocked: boolean }}
 */
function guardWrite(guardAction, operationName, targetMap) {
    const perm = checkPermission(guardAction);
    if (!perm.allowed) {
        emitStoreError(StoreErrorEvents.STORE_OPERATION_BLOCKED, { operation: operationName, reason: perm.reason, required: perm.required });
        return { blocked: true };
    }
    if (targetMap) {
        const isCurrentMap = targetMap === mapManager.getCurrentMapName();
        const isLocked = isCurrentMap
            ? isCurrentMapLockedSync()
            : memoryStore.lockedMaps.has(targetMap);
        if (isLocked) {
            emitStoreError(StoreErrorEvents.STORE_OPERATION_BLOCKED, { operation: operationName, reason: 'map_locked' });
            return { blocked: true };
        }
    }
    return { blocked: false };
}

/**
 * Refuses a LOCAL creation of a feature into a LOCKED layer of the current map.
 *
 * A layer's `locked` is a client convention: the server stores it and never asks. Until
 * 2026-09-24 nothing on the creation path asked either, so with the ACTIVE layer locked (by its
 * owner, or by a peer while this person had it active) every drawing tool, the batch points and a
 * paste wrote the new feature INTO the locked layer, and the server accepted it. Measured with two
 * browsers, owner and editor alike. The drawing tools also refuse at activation
 * (`ToolManager.setActiveTool`); this is the funnel under all of them, so the lock that lands in
 * the middle of a drawing refuses at the commit, before anything is painted (the tools paint only
 * what `addFeature` returned).
 *
 * WHAT IS LEFT OUT, and why:
 * - a REMOTE op never comes here (it is applied by the remote handler), and it is never refused:
 *   the lock is a convention of each client, not of the author's peer;
 * - a restore (`featureIntent`: undo, redo, the move half of a layer transfer) re-creates what
 *   existed, and refusing it in the middle of an undo batch is a question of its own;
 * - a map that is NOT the current one: `memoryStore.layers` is hydrated one map at a time, and
 *   for any other map the lookup would answer from a fabricated default layer (see
 *   `.claude/rules/architecture.md`, the synchronous getter trap). Every path that creates into
 *   another map is a whole-entity operation (transfer, merge) with its own checks.
 * @param {Array<Object>} features
 * @param {string} targetMap
 * @param {string} operationName
 * @param {Object} options - The caller's options (`featureIntent`).
 * @returns {boolean} True when refused (the refusal has already been announced).
 */
function refuseCreationInLockedLayer(features, targetMap, operationName, options) {
    if (options?.featureIntent) return false;
    if (targetMap !== mapManager.getCurrentMapName() || typeof deps.layerManager?.getLayerById !== 'function') return false;
    for (const feature of features) {
        const layerId = feature?.properties?.layerId || 'default';
        const layer = deps.layerManager.getLayerById(layerId, targetMap);
        if (layer?.locked !== true) continue;
        const isActive = deps.layerManager.getActiveLayerIdSync?.() === layerId;
        emitStoreError(StoreErrorEvents.STORE_OPERATION_BLOCKED, {
            operation: operationName,
            message: lockedLayerCreateNotice(isActive),
            reason: 'layer_locked',
            timestamp: Date.now()
        });
        return true;
    }
    return false;
}

/**
 * Returns whether undo should be recorded for this operation.
 * Undo is recorded when the operation targets the current map.
 * @param {string|null} mapName - Explicit map name (null means current)
 * @returns {boolean}
 */
function shouldRecordUndo(mapName) {
    return !mapName || mapName === mapManager.getCurrentMapName();
}

function findRelatedProcessedFeatures(type, featureId, mapData) {
    const processedType = getProcessedType(type);
    if (!processedType) return [];
    return mapData.features[processedType].filter(pf =>
        pf.properties.id.startsWith(featureId + '-')
    );
}

function removeProcessedFeaturesFromData(processedType, processedFeatures, mapData) {
    if (!processedType || !processedFeatures.length) return;
    const processedIds = new Set(processedFeatures.map(pf => pf.properties.id));
    mapData.features[processedType] = mapData.features[processedType]
        .filter(pf => !processedIds.has(pf.properties.id));
}

/**
 * Preserves user-managed data from oldFeature onto cleanedFeature.
 * Images, attributes, and description are managed separately by userDataManager
 * and should not be overwritten by MapLibre source updates.
 * @param {Object} oldFeature - Stored feature
 * @param {Object} cleanedFeature - Incoming cleaned feature
 */
function preserveUserData(oldFeature, cleanedFeature) {
    const oldProps = oldFeature.properties;
    const newProps = cleanedFeature.properties;

    if (Array.isArray(oldProps.images) && oldProps.images.length > 0 &&
        (!Array.isArray(newProps.images) || newProps.images.length === 0)) {
        newProps.images = oldProps.images;
    }

    if (oldProps.attributes && Object.keys(oldProps.attributes).length > 0 &&
        (!newProps.attributes || Object.keys(newProps.attributes).length === 0)) {
        newProps.attributes = oldProps.attributes;
    }

    if (oldProps.descricao && !newProps.descricao) {
        newProps.descricao = oldProps.descricao;
    }
}

/**
 * Preserves sync metadata (createdAt, version) from the stored feature.
 * @param {Object} oldFeature - Stored feature
 * @param {Object} cleanedFeature - Incoming cleaned feature
 */
function preserveSyncMetadata(oldFeature, cleanedFeature) {
    if (oldFeature.properties.confirmedVersion !== undefined) {
        cleanedFeature.properties.confirmedVersion = oldFeature.properties.confirmedVersion;
    }
    if (oldFeature.properties.createdAt) {
        cleanedFeature.properties.createdAt = oldFeature.properties.createdAt;
    }
    if (oldFeature.properties.version !== undefined) {
        cleanedFeature.properties.version = oldFeature.properties.version;
    }
}

/**
 * Undo and redo of a feature edit: the target is `to`, EXCEPT where somebody changed the feature
 * after the edit being reverted.
 *
 * An undo entry holds the WHOLE feature before and after the edit, and writing the whole "before"
 * back also rewrote every field a peer had changed since: a colleague renames a line, I undo my
 * recolor, and the line gets its old name back, on every client and on the server (the op leaves
 * with an up-to-date base, so the server has nothing to call disputed). Measured with two real
 * browsers in `frontend/tests/e2e-ui/desfazer-preserva-edicao-do-par.repro.spec.js`. Undo is local
 * to each person (P8), so it may only take back what THIS edit did: a field whose current value is
 * no longer what the edit left there (`from`) was written by someone after it, and stays.
 *
 * The unit is the geometry as a whole and each top-level property, EXCEPT the custom attributes,
 * whose unit is each key (owner's decision, 2026-09-24, the same split the sync patch and the
 * server's frontier use, `store/sync/feature-patch.js`): with the whole bag as the unit, undoing my
 * change of "x" after a colleague changed "z" kept the whole current bag and undid nothing.
 * Bookkeeping properties (`confirmedVersion`, `updatedAt`, ...) always differ from the recorded
 * snapshot, so they keep the current value, which is also what `preserveSyncMetadata` does.
 *
 * @param {Object} current - The feature as stored now.
 * @param {Object} from - The feature as the edit being reverted left it.
 * @param {Object} to - The feature the revert wants to restore.
 * @returns {Object} A new feature: `to`, with every field changed since `from` taken from `current`.
 */
export function keepLaterEdits(current, from, to) {
    const result = deepClone(to);
    if (!current || !from) return result;
    if (!deepEqual(current.geometry, from.geometry)) result.geometry = deepClone(current.geometry);
    const now = current.properties ?? {};
    const then = from.properties ?? {};
    result.properties = result.properties ?? {};
    for (const key of new Set([...Object.keys(now), ...Object.keys(then), ...Object.keys(result.properties)])) {
        if (deepEqual(now[key], then[key])) continue;
        if (key === 'attributes' && keepLaterAttributeEdits(result.properties, now[key], then[key])) continue;
        if (now[key] === undefined) delete result.properties[key];
        else result.properties[key] = deepClone(now[key]);
    }
    return result;
}

/** @returns {boolean} Whether `value` is an attribute bag that can be compared key by key. */
function isAttributeBag(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * {@link keepLaterEdits} inside the attribute bag: the target's bag, with every KEY changed since
 * the reverted edit taken from the current bag. Answers false, leaving the whole-bag rule in charge,
 * when one of the three is not a bag (absent counts as empty).
 * @param {Object} properties - The result's properties, rewritten in place.
 * @param {*} now - The current bag.
 * @param {*} then - The bag the reverted edit left.
 * @returns {boolean}
 */
function keepLaterAttributeEdits(properties, now, then) {
    const target = properties.attributes === undefined ? {} : properties.attributes;
    const current = now === undefined ? {} : now;
    const left = then === undefined ? {} : then;
    if (!isAttributeBag(target) || !isAttributeBag(current) || !isAttributeBag(left)) return false;
    const bag = deepClone(target);
    for (const key of new Set([...Object.keys(current), ...Object.keys(left), ...Object.keys(bag)])) {
        if (deepEqual(current[key], left[key])) continue;
        if (!Object.hasOwn(current, key)) delete bag[key];
        else bag[key] = deepClone(current[key]);
    }
    properties.attributes = bag;
    return true;
}

// ===== CRUD OPERATIONS =====

/**
 * Adds a new feature to a map.
 * @param {string} type - Storage type (e.g., 'points')
 * @param {Object} feature - GeoJSON feature to add
 * @param {string} [mapName=null] - Target map name
 * @returns {Promise<Object|undefined>} Cleaned feature or undefined if blocked
 */
export async function addFeature(type, feature, mapName = null, options = {}) {
    if (!options.featureIntent && (memoryStore.isUndoing || memoryStore.isRedoing)) options = { ...options, featureIntent: 'restore' };
    const targetMap = resolveMap(mapName);
    if (guardWrite(GuardAction.CREATE_FEATURE, 'addFeature', targetMap).blocked) return;
    if (refuseCreationInLockedLayer([feature], targetMap, 'addFeature', options)) return;

    const cleanedFeature = cleanFeature(feature);
    if (!cleanedFeature) {
        console.warn('Feature ignored after cleanup:', feature);
        return;
    }

    addCreatedTimestamp(cleanedFeature);

    // The read-modify-write below must not interleave with another writer of the same map
    // document, or the later save drops this feature. See document-lock.js.
    return withMapDocument(targetMap, 'addFeature', async () => {
        // A LEITURA SAIU DE DENTRO DE `runTransaction` (D2), e o que ela NÃO perdeu é o que
        // importa: ela continua dentro de `withMapDocument`, que é quem fecha a janela de leitura
        // obsoleta. O que ela deixa de fazer é ABRIR uma transação para descobrir que não há
        // escrita nenhuma a fazer, o que custava a barreira de logout, o carimbo do escopo e uma
        // chamada de `persistOperationIntents` com lista VAZIA. É também a forma que as outras dez
        // funções deste arquivo já usam: `addFeature` era a única que lia lá dentro.
        const currentMapData = await mapDocumentForGesture(targetMap, 'addFeature');
        if (!currentMapData) return;

        await runTransaction(async (tx) => {
            if (!currentMapData.features[type]) {
                currentMapData.features[type] = [];
            }
            currentMapData.features[type].push(cleanedFeature);

            const colors = mapManager.getFeatureColors(cleanedFeature);
            tx.deferSync(() => {
                for (const color of colors) {
                    mapManager.updateColorUsage(null, color, targetMap);
                }
            });

            if (shouldRecordUndo(mapName)) {
                tx.deferSync(() => {
                    mapManager.recordAction({
                        type: 'add',
                        featureType: type,
                        feature: deepClone(cleanedFeature)
                    });
                });
            }

            {
                const mapId = mapManager.getMapId(targetMap);
                tx.recordOperation(EntityType.FEATURE, OperationType.CREATE, cleanedFeature.properties.id, mapId, cleanedFeature,
                    options.featureIntent ? cleanedFeature : null, { ...options, storage: type });
            }

            return () => updateMapDataCompat(targetMap, currentMapData);
        });

        return cleanedFeature;
    });
}

/**
 * Updates an existing feature.
 * @param {string} type - Storage type
 * @param {Object} feature - Feature with updated properties
 * @param {string} [mapName=null] - Target map name
 * @param {Object} [options]
 * @param {boolean} [options.preserveUserData=true] - Restore user data the incoming feature lacks.
 * @param {Object} [options.revertFrom] - Undo/redo only: the feature as the reverted edit left it.
 *   Fields changed since then keep their current value (see {@link keepLaterEdits}).
 * @param {function(Object): Object} [options.transform] - Builds the feature to store FROM A CLONE
 *   OF THE STORED ONE, read under the document lock; `feature` then only names the target. For a
 *   caller whose change is a function of the current feature (the attribute manager): a copy read
 *   before the lock would carry back whatever a peer's op wrote in between.
 * @param {() => Promise<void>} [options.antesDaIntencao] - Async write that belongs to this edit and
 *   must happen INSIDE the transaction, before the intention is journaled (the bytes and upload
 *   pendency of a photo attached by `userDataManager.addImage`, `photo-attach.js`).
 */
export async function updateFeature(type, feature, mapName = null, { preserveUserData: keepUserData = true, revertFrom = null, transform = null, antesDaIntencao = null } = {}) {
    const targetMap = resolveMap(mapName);
    if (guardWrite(GuardAction.UPDATE_FEATURE, 'updateFeature', targetMap).blocked) return;

    let cleanedFeature = cleanFeature(feature);
    if (!cleanedFeature) {
        console.warn('Feature ignored after cleanup:', feature);
        return;
    }

    // The lock opens BEFORE the read: the stale-read window is the defect, so a read taken
    // outside it would be exactly as lost-update-prone as before.
    return withMapDocument(targetMap, 'updateFeature', async () => {
        const currentMapData = await mapDocumentForGesture(targetMap, 'updateFeature');
        if (!currentMapData) return;
        const index = currentMapData.features[type].findIndex(f => f.properties.id === cleanedFeature.properties.id);
        if (index === -1) return;

        const oldFeature = currentMapData.features[type][index];
        const oldColor = mapManager.getFeatureColor(oldFeature);
        if (typeof transform === 'function') {
            cleanedFeature = cleanFeature(transform(deepClone(oldFeature)));
            if (!cleanedFeature) return;
        }
        // Read under the document lock, like `oldFeature`: a peer's op applied between a read
        // outside it and this write would be exactly the edit the revert must not take back.
        if (revertFrom) cleanedFeature = cleanFeature(keepLaterEdits(oldFeature, cleanFeature(revertFrom), cleanedFeature));

        // Skip for authoritative user-data writes: UserDataManager passes a full clone, so an
        // intentionally-emptied attributes/images collection must NOT be restored from the old value.
        // Skip for undo and redo too: `keepLaterEdits` above already kept whatever changed after
        // the reverted edit, and restoring the stored collection when the target is empty made
        // undoing "add the first attribute" (or the first photo) do nothing, silently.
        if (keepUserData && !revertFrom) preserveUserData(oldFeature, cleanedFeature);
        preserveSyncMetadata(oldFeature, cleanedFeature);

        if (isFeatureEqual(oldFeature, cleanedFeature)) return;

        touchUpdatedTimestamp(cleanedFeature);
        let conversao = null;
        const mexeNasFotos = fotosMudaram(oldFeature, cleanedFeature);

        await comConversao(() => conversao, runTransaction(async (tx) => {
            conversao = mexeNasFotos ? await converterFotosDaFeicao(cleanedFeature) : null;
            // The door's own write (an attached photo's bytes and pendency), under this transaction.
            if (typeof antesDaIntencao === 'function') await antesDaIntencao();
            currentMapData.features[type][index] = cleanedFeature;

            const newColor = mapManager.getFeatureColor(cleanedFeature);
            if (oldColor !== newColor) {
                tx.deferSync(() => mapManager.updateColorUsage(oldColor, newColor, targetMap));
            }

            if (shouldRecordUndo(mapName)) {
                tx.deferSync(() => {
                    mapManager.recordAction({
                        type: 'update',
                        featureType: type,
                        oldFeature: deepClone(oldFeature),
                        newFeature: deepClone(cleanedFeature)
                    });
                });
            }

            {
                const mapId = mapManager.getMapId(targetMap);
                tx.recordOperation(EntityType.FEATURE, OperationType.UPDATE, cleanedFeature.properties.id, mapId, cleanedFeature, previousOfFeatureEdit(oldFeature), { storage: type });
            }

            return () => updateMapDataCompat(targetMap, currentMapData);
        }));
    });
}

/**
 * Removes a feature from a map.
 * @param {string} type - Storage type
 * @param {string} id - Feature ID to remove
 * @param {string} [mapName=null] - Target map name
 */
export async function removeFeature(type, id, mapName = null) {
    const targetMap = resolveMap(mapName);
    if (guardWrite(GuardAction.DELETE_FEATURE, 'removeFeature', targetMap).blocked) return;

    return withMapDocument(targetMap, 'removeFeature', async () => {
        const currentMapData = await mapDocumentForGesture(targetMap, 'removeFeature');
        if (!currentMapData) return;
        const featureIndex = currentMapData.features[type].findIndex(f => f.properties.id === id);
        if (featureIndex === -1) return;

        const mainFeature = currentMapData.features[type].splice(featureIndex, 1)[0];
        const processedFeatures = findRelatedProcessedFeatures(type, id, currentMapData);
        const processedType = getProcessedType(type);

        if (processedType && processedFeatures.length > 0) {
            removeProcessedFeaturesFromData(processedType, processedFeatures, currentMapData);
        }

        await runTransaction(async (tx) => {
            const colors = mapManager.getFeatureColors(mainFeature);
            if (colors.length > 0) {
                tx.deferSync(() => {
                    // Decrement ALL color props (matching addFeature/addFeatures), so a
                    // multi-color feature's usage counts don't drift on create/delete.
                    for (const color of colors) mapManager.updateColorUsage(color, null, targetMap);
                });
            }

            // PREPARE, and no longer `tx.deferSync`, since the group side became write-ahead
            // (bloco B4). It records the `group_feature` DELETE of every group that held the
            // feature (plus the `group` DELETE of one that drops to a single member) in THIS
            // transaction, and hands back the groups-document write, chained onto the persistence
            // below. It must not open a transaction of its own: a nested one commits FIRST, so the
            // groups would be durable before this deletion had recorded anything.
            const persistGroups = deps.groupManager.removeFeatureFromAllGroups(
                tx, mainFeature.properties.source, id, targetMap
            );

            if (shouldRecordUndo(mapName)) {
                tx.deferSync(() => {
                    mapManager.recordAction({
                        type: 'removeWithProcessed',
                        mainFeatureType: type,
                        mainFeature: deepClone(mainFeature),
                        processedFeatures: processedFeatures.length > 0 ? {
                            type: processedType,
                            features: deepClone(processedFeatures)
                        } : null
                    });
                });
            }

            {
                const mapId = mapManager.getMapId(targetMap);
                tx.recordOperation(EntityType.FEATURE, OperationType.DELETE, id, mapId, null, mainFeature, { storage: type });
            }

            return async () => {
                await updateMapDataCompat(targetMap, currentMapData);
                await persistGroups?.();
            };
        });
    });
}

/**
 * Records the undo entries of ONE plural store operation as ONE Ctrl+Z.
 *
 * Inside a collector the caller opened (`startBatchUndo`, as `deleteSelectedFeatures` and the
 * panel's "Salvar" over several features do) each entry goes in flat, as the single path does, and
 * the caller commits them as one. Without one, the plural operation wraps its own entries: a mass
 * restyle saved by a path that opens no collector (the panel with one feature type, the symbol
 * selector) was undone one feature per Ctrl+Z (review finding, 2026-09-24).
 * @param {Object[]} actions - Undo entries, in the order the operation applied them.
 * @returns {void}
 */
function recordUndoEntries(actions) {
    if (actions.length === 0) return;
    if (actions.length === 1 || Array.isArray(memoryStore.batchCollector)) {
        for (const action of actions) mapManager.recordAction(action);
        return;
    }
    mapManager.recordBatchOperation(actions);
}

/**
 * The distinct `{type, id}` pairs of a list of references, in their first order.
 * @param {Array<{type: string, id: string}>} refs
 * @returns {Array<{type: string, id: string}>}
 */
function distinctRefs(refs) {
    const seen = new Map();
    const out = [];
    for (const ref of refs ?? []) {
        if (!ref?.type || ref.id === undefined || ref.id === null) continue;
        if (!seen.has(ref.type)) seen.set(ref.type, new Set());
        if (seen.get(ref.type).has(ref.id)) continue;
        seen.get(ref.type).add(ref.id);
        out.push({ type: ref.type, id: ref.id });
    }
    return out;
}

/**
 * Removes MANY features of one map with ONE read and ONE write of the map document, in ONE
 * write-ahead transaction.
 *
 * WHY IT EXISTS. Every feature of a map lives in one document, so {@link removeFeature} is a
 * read-modify-write of the WHOLE map, and a loop of it over a selection pays that once per
 * feature: deleting 1 000 points took 19 s of the author's gesture in Chromium, and its redo
 * 41 s (measured on 2026-09-24 with two browsers and the real backend). Here the document is read
 * once under the document lock, every removal is applied to it in memory, and it is written once.
 * `frontend/tests/store/gesto-local-em-massa-um-documento.repro.test.js` counts the reads and the
 * writes.
 *
 * WHAT STAYS AS IN {@link removeFeature}, per feature and in the order of `refs`: the analysis
 * output leaves with its input; the group memberships go (and a group left with one member), all
 * through the transaction's overlay, so the groups document is written once too; the color counts;
 * one `removeWithProcessed` undo entry per feature, grouped by the caller's batch collector, or
 * by this operation when there is none (`recordUndoEntries`); and the DELETE operation, recorded BEFORE the entity is written, with the whole feature
 * as `previousData`. No feature event is emitted, exactly as in the single path: the author's map
 * is repainted by the control that called this, and the peers' events come from the inbound path.
 *
 * THE GATE IS ASKED ONCE, for the role and for the map lock, as the single path asks it per call.
 * The feature, layer and group locks are client conventions asked by the caller that owns the
 * selection (`deleteSelectedFeatures`), which is where they were asked before.
 *
 * EACH DELETE STILL TRAVELS ALONE (owner decision, 2026-09-24, refining B6.1): the operations are
 * marked `independent`, so outside a gesture they leave with no batch and no part chain, and a
 * conflict on one feature costs that feature, as in the one-by-one path. The group operations of
 * the same transaction stay one batch. Inside a gesture (a conversion, a composite undo) the mark
 * is ignored and the gesture keeps its atomicity (`createBatchOperations`).
 *
 * @param {Array<{type: string, id: string}>} refs - Storage type and id of each feature.
 * @param {string} [mapName=null] - Target map name
 * @returns {Promise<number>} How many features were removed.
 */
export async function removeFeatures(refs, mapName = null) {
    const wanted = distinctRefs(refs);
    if (wanted.length === 0) return 0;
    const targetMap = resolveMap(mapName);
    if (guardWrite(GuardAction.DELETE_FEATURE, 'removeFeatures', targetMap).blocked) return 0;

    return withMapDocument(targetMap, 'removeFeatures', async () => {
        const currentMapData = await mapDocumentForGesture(targetMap, 'removeFeatures');
        if (!currentMapData) return 0;

        // One pass per bucket, never one scan per feature: the first copy of each id leaves, as
        // `findIndex` + `splice` did.
        const idsByType = new Map();
        for (const { type, id } of wanted) {
            if (!idsByType.has(type)) idsByType.set(type, new Set());
            idsByType.get(type).add(id);
        }
        const found = new Map();
        for (const [type, ids] of idsByType) {
            const bucket = currentMapData.features[type];
            if (!Array.isArray(bucket)) continue;
            const hits = new Map();
            const kept = [];
            for (const feature of bucket) {
                const id = feature?.properties?.id;
                if (ids.has(id) && !hits.has(id)) hits.set(id, feature);
                else kept.push(feature);
            }
            if (hits.size === 0) continue;
            currentMapData.features[type] = kept;
            found.set(type, hits);
        }

        const removed = [];
        for (const { type, id } of wanted) {
            const mainFeature = found.get(type)?.get(id);
            if (!mainFeature) continue;
            const processedType = getProcessedType(type);
            const processedFeatures = processedType && Array.isArray(currentMapData.features[processedType])
                ? findRelatedProcessedFeatures(type, id, currentMapData)
                : [];
            removeProcessedFeaturesFromData(processedType, processedFeatures, currentMapData);
            removed.push({ type, id, mainFeature, processedType, processedFeatures });
        }
        if (removed.length === 0) return 0;

        await runTransaction(async (tx) => {
            const mapId = mapManager.getMapId(targetMap);
            const colors = [];
            // N removals, ONE groups document: every call composes with the previous ones through
            // the transaction's overlay, and every closure writes that same accumulated object, so
            // keeping the last non-null one persists all of them (as `deleteLayerFeatures` does).
            let persistGroups = null;
            for (const { type, id, mainFeature } of removed) {
                for (const color of mapManager.getFeatureColors(mainFeature)) colors.push(color);
                persistGroups = deps.groupManager.removeFeatureFromAllGroups(
                    tx, mainFeature.properties.source, id, targetMap
                ) ?? persistGroups;
                // INDEPENDENT (owner decision, 2026-09-24): outside a gesture each DELETE travels alone,
                // so a conflict on one feature costs that feature (`createBatchOperations`).
                tx.recordOperation(EntityType.FEATURE, OperationType.DELETE, id, mapId, null, mainFeature, { storage: type, independent: true });
            }

            if (colors.length > 0) {
                tx.deferSync(() => {
                    for (const color of colors) mapManager.updateColorUsage(color, null, targetMap);
                });
            }

            if (shouldRecordUndo(mapName)) {
                tx.deferSync(() => recordUndoEntries(removed.map(({ type, mainFeature, processedType, processedFeatures }) => ({
                    type: 'removeWithProcessed',
                    mainFeatureType: type,
                    mainFeature: deepClone(mainFeature),
                    processedFeatures: processedFeatures.length > 0 ? {
                        type: processedType,
                        features: deepClone(processedFeatures)
                    } : null
                }))));
            }

            return async () => {
                await updateMapDataCompat(targetMap, currentMapData);
                await persistGroups?.();
            };
        });
        return removed.length;
    });
}

/**
 * Updates MANY features of one map with ONE read and ONE write of the map document, in ONE
 * write-ahead transaction. The counterpart of {@link removeFeatures}, for the same reason: a loop
 * of {@link updateFeature} restyling 1 000 points took 28.6 s of the author's gesture, and the
 * undo of it 16 s (measured on 2026-09-24).
 *
 * Each item is exactly one {@link updateFeature} call, with the same options and the same rules,
 * applied in order to the SAME in-memory document: an item whose feature is absent is skipped,
 * `transform` and `revertFrom` read the feature as the previous items left it (so two items on
 * one feature compose as two calls would), user data and sync metadata are preserved, an item that
 * changes nothing records nothing, and every written item records its `update` undo entry and its
 * UPDATE operation with the stored feature as `previousData`. One addition, which the single path
 * does not need because its analysis callers write the output themselves: an item on an analysis
 * INPUT re-derives that input's output in the same write (`replaceDerivedOutput`), so a batch that
 * reaches one (an undo in mass) cannot leave the green and red drawing on the old geometry.
 *
 * The gate, and the independent UPDATE of each feature, are those of {@link removeFeatures}.
 *
 * @param {Array<{type: string, feature: Object, options?: {preserveUserData?: boolean,
 *   revertFrom?: Object, transform?: function(Object): Object}}>} items - One per feature write.
 * @param {string} [mapName=null] - Target map name
 * @returns {Promise<number>} How many features were written.
 */
export async function updateFeatures(items, mapName = null) {
    const list = (items ?? []).filter(item => item?.type && item.feature);
    if (list.length === 0) return 0;
    const targetMap = resolveMap(mapName);
    if (guardWrite(GuardAction.UPDATE_FEATURE, 'updateFeatures', targetMap).blocked) return 0;

    const prepared = [];
    for (const { type, feature, options } of list) {
        const cleaned = cleanFeature(feature);
        if (!cleaned) {
            console.warn('Feature ignored after cleanup:', feature);
            continue;
        }
        prepared.push({ type, incoming: cleaned, options: options ?? {} });
    }
    if (prepared.length === 0) return 0;

    return withMapDocument(targetMap, 'updateFeatures', async () => {
        const currentMapData = await mapDocumentForGesture(targetMap, 'updateFeatures');
        if (!currentMapData) return 0;

        // One index per bucket, the FIRST position of each id, as `findIndex` answered.
        const positions = new Map();
        const positionOf = (type, id) => {
            if (!positions.has(type)) {
                const index = new Map();
                currentMapData.features[type].forEach((f, i) => {
                    const fid = f?.properties?.id;
                    if (!index.has(fid)) index.set(fid, i);
                });
                positions.set(type, index);
            }
            return positions.get(type).get(id);
        };

        const written = [];
        for (const { type, incoming, options } of prepared) {
            const bucket = currentMapData.features[type];
            if (!Array.isArray(bucket)) continue;
            const index = positionOf(type, incoming.properties.id);
            if (index === undefined) continue;

            const { preserveUserData: keepUserData = true, revertFrom = null, transform = null } = options;
            const oldFeature = bucket[index];
            const oldColor = mapManager.getFeatureColor(oldFeature);
            let cleanedFeature = incoming;
            if (typeof transform === 'function') {
                cleanedFeature = cleanFeature(transform(deepClone(oldFeature)));
                if (!cleanedFeature) continue;
            }
            if (revertFrom) cleanedFeature = cleanFeature(keepLaterEdits(oldFeature, cleanFeature(revertFrom), cleanedFeature));
            // Not under undo or redo, as in `updateFeature`: `keepLaterEdits` already kept what changed
            // after the reverted edit, and restoring the stored collection made undoing "add the first
            // attribute" through a mass entry do nothing (2026-09-25, integration review).
            if (keepUserData && !revertFrom) preserveUserData(oldFeature, cleanedFeature);
            preserveSyncMetadata(oldFeature, cleanedFeature);
            if (isFeatureEqual(oldFeature, cleanedFeature)) continue;
            // A PHOTO CHANGE DOES NOT GO THROUGH HERE. `updateFeature` converts inline photos to blobs and
            // registers their upload inside the entity's transaction, and this path has neither: it would
            // put the bytes on the wire unconverted. No mass gesture edits photos today; a caller that
            // starts to is a bug, told loudly before anything is written.
            if (fotosMudaram(oldFeature, cleanedFeature)) {
                throw new Error(`updateFeatures: the photos of ${cleanedFeature.properties.id} changed; use updateFeature`);
            }
            touchUpdatedTimestamp(cleanedFeature);

            bucket[index] = cleanedFeature;
            // Re-deriving REPLACES the output bucket with a new array, so its cached index is stale
            // from here on: a later item on that bucket would write over another feature's half.
            if (replaceDerivedOutput(currentMapData.features, type, cleanedFeature.properties.id, cleanedFeature)) {
                positions.delete(derivedOutputBucketOf(type));
            }
            written.push({ type, oldFeature, cleanedFeature, oldColor, newColor: mapManager.getFeatureColor(cleanedFeature) });
        }
        if (written.length === 0) return 0;

        await runTransaction(async (tx) => {
            const recolored = written.filter(w => w.oldColor !== w.newColor);
            if (recolored.length > 0) {
                tx.deferSync(() => {
                    for (const w of recolored) mapManager.updateColorUsage(w.oldColor, w.newColor, targetMap);
                });
            }

            if (shouldRecordUndo(mapName)) {
                tx.deferSync(() => recordUndoEntries(written.map(({ type, oldFeature, cleanedFeature }) => ({
                    type: 'update',
                    featureType: type,
                    oldFeature: deepClone(oldFeature),
                    newFeature: deepClone(cleanedFeature)
                }))));
            }

            const mapId = mapManager.getMapId(targetMap);
            // INDEPENDENT, as in `removeFeatures`: one conflict costs one feature.
            for (const { type, oldFeature, cleanedFeature } of written) {
                // The previous side without inline photo bytes, as `updateFeature` sends it: with them on
                // both sides a feature with old photos went over the body limit (413, a lasting refusal).
                tx.recordOperation(EntityType.FEATURE, OperationType.UPDATE, cleanedFeature.properties.id, mapId, cleanedFeature, previousOfFeatureEdit(oldFeature), { storage: type, independent: true });
            }

            return () => updateMapDataCompat(targetMap, currentMapData);
        });
        return written.length;
    });
}

/**
 * Adds a feature to a specific map.
 * @param {string} type - Storage type
 * @param {Object} feature - Feature to add
 * @param {string} mapName - Target map name
 * @returns {Promise<Object|undefined>} Cleaned feature or undefined
 */
export async function addFeatureToMap(type, feature, mapName, options = {}) {
    return await addFeature(type, feature, mapName, options);
}

/**
 * Removes a feature from a specific map and returns removed data.
 *
 * ELA ERA A UNICA ENTRADA DE ESCRITA DE FEICAO DESTE ARQUIVO SEM `guardWrite`, e nao por ser
 * interna: o barril `@store` a reexporta, e os executores de DESFAZER e REFAZER de
 * `moveBetweenMaps` (`store/store-state-manager.js`) a chamam SEM opcoes, isto e, com
 * `logOperation` no default `true`. Um Ctrl+Z depois de o share cair de Editor para Leitor
 * enfileirava um `feature` DELETE que o servidor recusa com 403 no lote INTEIRO, e lote
 * nao-2xx nao e desenfileirado pelo cliente: a fila para de andar.
 *
 * O caminho legitimo nao muda de comportamento: `moveFeaturesToMap` ja consultou o MESMO
 * guard na MESMA chave de mapa antes de chegar aqui, entao a segunda pergunta so custa o
 * `allowed` que ja era verdadeiro.
 *
 * @param {string} type - Storage type
 * @param {string} id - Feature ID
 * @param {string} mapName - Target map name
 * @returns {Promise<Object|null>} Removed feature data, or null when the rank refuses
 */
export async function removeFeatureFromMap(type, id, mapName, { logOperation = true } = {}) {
    if (guardWrite(GuardAction.DELETE_FEATURE, 'removeFeatureFromMap', mapName).blocked) return null;
    // Leaf: it takes the lock, so its caller `moveFeaturesToMap` must NOT (it awaits this
    // one and `addFeatureToMap`, and a section awaiting a section on the same key hangs).
    return withMapDocument(mapName, 'removeFeatureFromMap', async () => {
        const mapData = await mapDocumentForGesture(mapName, 'removeFeatureFromMap');
        if (!mapData) return null;
        const featureIndex = mapData.features[type].findIndex(f => f.properties.id === id);
        if (featureIndex === -1) return null;

        const mainFeature = mapData.features[type].splice(featureIndex, 1)[0];
        const processedFeatures = findRelatedProcessedFeatures(type, id, mapData);
        const processedType = getProcessedType(type);

        if (processedType && processedFeatures.length > 0) {
            removeProcessedFeaturesFromData(processedType, processedFeatures, mapData);
        }

        const result = {
            mainFeature,
            processedFeatures: processedFeatures.length > 0 ? {
                type: processedType,
                features: processedFeatures
            } : null
        };

        await runTransaction(async (tx) => {
            const colors = mapManager.getFeatureColors(mainFeature);
            if (colors.length > 0) {
                tx.deferSync(() => {
                    for (const color of colors) mapManager.updateColorUsage(color, null, mapName);
                });
            }

            // PREPARE, and no longer `tx.deferSync`: see the same call in `removeFeature`. The
            // membership ops travel even when `logOperation` is false, and that asymmetry is
            // right: a MOVE keeps the feature alive in another map, so it must not emit a feature
            // DELETE, but it does leave the groups of THIS map.
            const persistGroups = deps.groupManager.removeFeatureFromAllGroups(
                tx, mainFeature.properties.source, id, mapName
            );

            // A real deletion syncs. The source cleanup of an explicit move does not:
            // its canonical response removes the old projection without deleting the
            // same entity after it has already reached its destination.
            if (logOperation) {
                const mapId = mapManager.getMapId(mapName);
                tx.recordOperation(EntityType.FEATURE, OperationType.DELETE, id, mapId, null, mainFeature, { storage: type });
            }

            return async () => {
                await updateMapDataCompat(mapName, mapData);
                await persistGroups?.();
            };
        });

        return result;
    });
}

/**
 * Adds a feature without recording undo action.
 * @param {string} type - Storage type
 * @param {Object} feature - Feature to add
 * @param {string} [mapName=null] - Target map name
 */
export async function addFeatureSilent(type, feature, mapName = null) {
    const cleanedFeature = cleanFeature(feature);
    if (!cleanedFeature) return;

    addCreatedTimestamp(cleanedFeature);

    const targetMap = resolveMap(mapName);
    return withMapDocument(targetMap, 'addFeatureSilent', async () => {
        // ESCRITA DERIVADA: as duas funções `*Silent` não têm gesto a quem responder (não
        // consultam papel, não gravam desfazer e não registram intenção), então um mapa ausente
        // as faz sumir CALADAS, no lugar de anunciar uma recusa que ninguém pediu.
        const currentMapData = await mapDocumentForDerivedWrite(targetMap);
        if (!currentMapData) return;
        currentMapData.features[type].push(cleanedFeature);
        await updateMapDataCompat(targetMap, currentMapData);
    });
}

/**
 * Removes a feature without recording undo action.
 * @param {string} type - Storage type
 * @param {string} id - Feature ID
 * @param {string} [mapName=null] - Target map name
 */
export async function removeFeatureSilent(type, id, mapName = null) {
    const targetMap = resolveMap(mapName);
    return withMapDocument(targetMap, 'removeFeatureSilent', async () => {
        const currentMapData = await mapDocumentForDerivedWrite(targetMap);
        if (!currentMapData) return;
        const featureIndex = currentMapData.features[type].findIndex(f => f.properties.id === id);
        if (featureIndex === -1) return;

        currentMapData.features[type].splice(featureIndex, 1);
        await updateMapDataCompat(targetMap, currentMapData);
    });
}

/**
 * Adds multiple features at once.
 * @param {Object<string, Array>} featuresMap - Map of type to features array
 * @param {string} [mapName=null] - Target map name
 * @param {Object} [options] - `featureIntent` and the sync options of each operation, plus
 *   `createdLayer`: the layer the SAME gesture created to hold these features (processing output,
 *   import). The undo entry then carries the layer too, so undo removes it with the features and
 *   redo brings both back with the same ids (owner's decision of 2026-09-26). It is recorded here,
 *   in the entry this write already records, and not through `startBatchUndo`: that collector is
 *   global, and a processing run is long enough for another gesture to fall into it.
 * @returns {Promise<true|undefined>} True when the batch was stored, undefined when refused
 */
export async function addFeatures(featuresMap, mapName = null, allOptions = {}) {
    const { createdLayer = null, ...options } = allOptions;
    const targetMap = resolveMap(mapName);
    if (guardWrite(GuardAction.CREATE_FEATURE, 'addFeatures', targetMap).blocked) return;
    if (refuseCreationInLockedLayer(Object.values(featuresMap || {}).flat(), targetMap, 'addFeatures', options)) return;

    return withMapDocument(targetMap, 'addFeatures', async () => {
        const currentMapData = await mapDocumentForGesture(targetMap, 'addFeatures');
        if (!currentMapData) return;
        const action = { type: 'addMultiple', features: {} };
        const colorDeferrals = [];

        for (const type of Object.keys(featuresMap)) {
            const features = featuresMap[type] || [];
            if (features.length === 0) continue;

            const cleanedFeatures = features.map(cleanFeature).filter(Boolean);
            cleanedFeatures.forEach(addCreatedTimestamp);
            // Defensive init: maps loaded from older .ebgeo files may lack a newer
            // storage-type array. Mirror the guard in addFeature() so a batch add of
            // such a type cannot throw on push.
            if (!currentMapData.features[type]) {
                currentMapData.features[type] = [];
            }
            currentMapData.features[type].push(...cleanedFeatures);
            action.features[type] = deepClone(cleanedFeatures);

            for (const feat of cleanedFeatures) {
                // Track ALL color properties (getFeatureColors), matching addFeature();
                // getFeatureColor (singular) would miss e.g. a polygon's lineColor.
                const colors = mapManager.getFeatureColors(feat);
                for (const color of colors) colorDeferrals.push(color);
            }
        }

        await runTransaction(async (tx) => {
            if (colorDeferrals.length > 0) {
                tx.deferSync(() => {
                    for (const color of colorDeferrals) {
                        mapManager.updateColorUsage(null, color, targetMap);
                    }
                });
            }

            if (Object.keys(action.features).length > 0 && shouldRecordUndo(mapName)) {
                // The layer goes FIRST: redo runs a batch in order (layer, then the features that
                // live in it) and undo in reverse (the features, then the layer they leave empty).
                const entry = createdLayer
                    ? { type: 'batch', operations: [{ type: 'createLayer', layer: deepClone(createdLayer) }, action] }
                    : action;
                tx.deferSync(() => mapManager.recordAction(entry));
            }

            // Enqueue a sync op per created feature so a BATCH add (import, processing output, paste)
            // reaches collaborators — mirrors the singular addFeature(). Without this, batch-added
            // features persisted locally but never synced (P9 sync-coverage gap).
            {
                const mapId = mapManager.getMapId(targetMap);
                for (const type of Object.keys(action.features)) {
                    for (const feat of action.features[type]) {
                        tx.recordOperation(EntityType.FEATURE, OperationType.CREATE, feat.properties.id, mapId, feat, options.featureIntent ? feat : null, { ...options, storage: type });
                    }
                }
            }

            return () => updateMapDataCompat(targetMap, currentMapData);
        });
        // TRUE ONLY HERE, and every refusal above returns undefined. It is how a caller that
        // paints and announces after the write (`ClipboardManager.paste`) tells a batch that was
        // stored from one the store refused in silence (role, map lock, locked layer).
        return true;
    });
}

// ===== READ OPERATIONS =====

/**
 * Gets all features from a map.
 * @param {string} [mapName=null] - Target map name
 * @returns {Promise<Object>} Features collection
 */
export async function getCurrentMapFeatures(mapName = null) {
    const targetMap = resolveMap(mapName);
    const currentMapData = await getMapDataCompat(targetMap);
    return deepClone(currentMapData.features);
}

/**
 * Gets a feature by ID.
 * @param {string} featureType - Storage type
 * @param {string} featureId - Feature ID
 * @param {string} [mapName=null] - Target map name
 * @returns {Promise<Object|undefined>} Feature or undefined
 */
export async function getFeatureById(featureType, featureId, mapName = null) {
    const targetMap = resolveMap(mapName);
    const currentMapData = await getMapDataCompat(targetMap);
    return currentMapData.features[featureType].find(f => f.properties.id === featureId);
}

/**
 * Writes the DERIVED properties of a freshly generated bitmap into the STORED feature,
 * without authoring anything.
 *
 * WHY THIS IS NOT `updateFeature`. The PNG of a military symbol or a coordination measure
 * is a per-client cache by design: it is never uploaded, and every client rebuilds it from
 * the synced properties (`layers/image-regen-registry.js`). `width`, `height`,
 * `pixelRatio`, `anchor`, `iconOffset` and `bitmapVersion` only DESCRIBE that cache. When
 * the load path rebuilds an old bitmap (`layers/layer_setup.js`), nobody edited the
 * feature: no user gesture, nothing to send to a peer, nothing to undo. An `updateFeature`
 * here would bump `version` and `updatedAt`, queue an outbound UPDATE op and, through LWW,
 * hand every peer a write nobody made.
 *
 * SO IT IS THE SILENT PATH, the same shape `applyRemoteFeatureOpLocked`
 * (`store/sync/remote-operation-handler.js`) uses to land a peer's op: the map document
 * lock, a read through the repository, the mutation, a save through the repository. What it
 * deliberately does NOT do, item by item, because each omission is the point:
 * - no `logFeatureOperation`: no outbound operation, no sync metadata, no LWW;
 * - no `touchUpdatedTimestamp`: `updatedAt` and `version` describe AUTHORSHIP;
 * - no `runTransaction`: there is no side effect to order after persistence, and it would
 *   mint a trace id, recording a user gesture in the ledger that never happened;
 * - no event: `FEATURE_MODIFIED` is what the sync scheduler and the panels listen to;
 * - no `guardWrite`: a Viewer, or a locked map, still gets its own local cache described.
 *
 * The rendered side is the caller's business (the tool control patches the live source
 * through the diff dispatcher). This is only the stored copy.
 *
 * One thing it cannot avoid, and does not try to: the repository's `saveMap` touches the
 * MAP document's own sync metadata on every save, the same as the remote path does. That
 * marks the document, not the feature, and nothing reads that mark to enqueue an op.
 *
 * A feature that is not in the target map is a no-op, and that is the normal case for a
 * peer operation applied to a map that is not the open one.
 *
 * @param {Object} feature - The feature whose bitmap was regenerated (needs `properties.id`
 *   and `properties.source`)
 * @param {Object} result - Generator result { width, height, pixelRatio?, anchor?, iconOffset? }
 * @param {string} [mapName=null] - Target map name (defaults to the current map)
 * @returns {Promise<boolean>} Whether the stored feature was found and stamped
 */
export async function stampGeneratedBitmap(feature, result, mapName = null, isCurrent = () => true) {
    const featureId = feature?.properties?.id;
    const source = feature?.properties?.source;
    if (!featureId || !source || !result) return false;

    const targetMap = resolveMap(mapName);
    const storageType = getStorageTypeFromSource(source);

    return withMapDocument(targetMap, 'stampGeneratedBitmap', async () => {
        if (!isCurrent()) return false;
        // ESCRITA DERIVADA, e este é o exemplo canônico da classe: o PNG é cache por cliente, nada
        // aqui responde a um gesto (ver o cabeçalho acima), então um mapa ausente devolve `false`
        // como qualquer outro "não achei", sem anunciar recusa nenhuma.
        const currentMapData = await mapDocumentForDerivedWrite(targetMap);
        if (!isCurrent() || !currentMapData) return false;
        const bucket = currentMapData?.features?.[storageType];
        if (!Array.isArray(bucket)) return false;

        const stored = bucket.find(f => f.properties?.id === featureId);
        if (!stored) return false;

        applyGeneratedBitmap(stored.properties, result);
        await updateMapDataCompat(targetMap, currentMapData);
        return true;
    });
}

/**
 * Updates a single property on a feature.
 *
 * UNDO IS OPT-IN, AND THE DEFAULT IS "NO UNDO" ON PURPOSE. This is the property write of the
 * whole product: the visibility eye, the padlock, a cell of the attribute table, the temporal
 * amplifiers. Most of those are not gestures a person expects Ctrl+Z to reach, and several of
 * them run in LOOPS over a multi-selection, where one entry per feature would bury the undo
 * stack. So the caller that IS a gesture says so, with `{ recordUndo: true }`, and gets the same
 * `'update'` entry that `updateFeature` records: the inversion goes back through `updateFeature`
 * with the pre-write clone, and the repaint of the MapLibre source is the one the undo runner
 * already does for every action (`map/undo-redo.runner.js` calls `switchMap`).
 *
 * WHO ASKS FOR IT TODAY: every trajectory gesture (drag / insert / remove a keypoint, and the
 * whole "Adicionar no mapa" session, which persists once at the end so it is ONE entry). Until
 * 2026-09-21 no trajectory edit was undoable at all, while dragging the FIRST keypoint was,
 * because that one goes through the owning control's `updateFeatures` → `updateFeature`: the
 * same gesture had two rules (achado E2).
 *
 * GROUPING IS THE CALLER'S TOO: `recordAction` honours `memoryStore.batchCollector`, so a caller
 * that wraps several writes in `startBatchUndo()` / `commitBatchUndo()` gets a single entry.
 *
 * @param {string} featureType - Storage type
 * @param {string} featureId - Feature ID
 * @param {string} property - Property name
 * @param {*} value - New value
 * @param {string} [mapName=null] - Target map name
 * @param {{recordUndo?: boolean}} [options] - `recordUndo` pushes one 'update' undo entry.
 * @returns {Promise<boolean>} Whether update was successful
 */
export async function updateFeatureProperty(featureType, featureId, property, value, mapName = null, { recordUndo = false } = {}) {
    const targetMap = resolveMap(mapName);
    if (guardWrite(GuardAction.UPDATE_FEATURE, 'updateFeatureProperty', targetMap).blocked) return false;

    return withMapDocument(targetMap, 'updateFeatureProperty', async () => {
        const currentMapData = await mapDocumentForGesture(targetMap, 'updateFeatureProperty');
        if (!currentMapData) return false;
        const feature = currentMapData.features[featureType].find(f => f.properties.id === featureId);

        if (!feature) {
            console.warn(`Feature ${featureId} not found in ${featureType}`);
            return false;
        }

        const oldFeature = deepClone(feature);

        const COLOR_PROPERTIES = ['color', 'fillColor', 'lineColor', 'outlinecolor', 'backgroundColor'];
        const isColorProperty = COLOR_PROPERTIES.includes(property);
        const oldColor = isColorProperty ? mapManager.getFeatureColor(feature) : null;

        feature.properties[property] = value;
        touchUpdatedTimestamp(feature);
        let conversao = null;
        const mexeNasFotos = fotosMudaram(oldFeature, feature);

        await comConversao(() => conversao, runTransaction(async (tx) => {
            conversao = mexeNasFotos ? await converterFotosDaFeicao(feature) : null;
            if (isColorProperty) {
                const newColor = mapManager.getFeatureColor(feature);
                if (oldColor !== newColor) {
                    tx.deferSync(() => mapManager.updateColorUsage(oldColor, newColor, targetMap));
                }
            }

            if (recordUndo && shouldRecordUndo(mapName)) {
                // The clone of the NEW side is taken inside the deferral's closure argument, not
                // after persistence: `feature` is the live object inside `currentMapData` and a
                // later write to the same property would otherwise rewrite the redo snapshot.
                const newFeature = deepClone(feature);
                tx.deferSync(() => {
                    mapManager.recordAction({
                        type: 'update',
                        featureType,
                        oldFeature,
                        newFeature
                    });
                });
            }

            {
                const mapId = mapManager.getMapId(targetMap);
                tx.recordOperation(EntityType.FEATURE, OperationType.UPDATE, featureId, mapId, feature, previousOfFeatureEdit(oldFeature), { storage: featureType });
            }

            return () => updateMapDataCompat(targetMap, currentMapData);
        }));

        return true;
    });
}

/**
 * Re-derives the auto DTG/GDH amplifiers for a feature whose temporal window just
 * shifted, so a `dateTimeGroup` / `gdhIni` / `gdhFim` bound to the timeline (the
 * `autoDtg` opt-in) does not go stale after "Reagendar". No-op unless `autoDtg` is
 * on. Mirrors deriveDtgFields in temporal-attributes-section.js (canonical values only).
 *
 * Takes the SOURCE type (singular), which is the namespace the constants below live in.
 * The JSDoc used to say "Storage feature type" while the body compared against the
 * singulars, and the only caller passes a bucket key (plural): both branches were
 * unreachable and nothing threw, so a rescheduled symbol kept the old date-time group
 * printed beside its new window. Converted at the call site with
 * `getSourceTypeFromStorage`.
 *
 * NÃO É MAIS UM ESPELHO, É O MESMO CÓDIGO (2026-09-21). A regra vive em `derivarCamposDtg`
 * (`temporal/temporal-attributes.model.js`, folha, testável em node), que o painel de atributos
 * também chama: duas cópias da mesma derivação divergem, e divergiram — o painel ganhou a
 * limpeza do amplificador (E8) enquanto esta cópia seguia escrevendo o valor velho depois de um
 * Reagendar.
 *
 * A CHAMADA DECIDE UMA COISA AQUI, e ela não é da função pura: o instante AUSENTE escreve
 * vazio, e não deixa o amplificador velho impresso; mas `''` não é gravado por cima de
 * `undefined`, porque isso seria uma mudança de propriedade que enfileiraria op de sync para
 * uma feição que nunca teve o campo.
 *
 * A LENTE NÃO ENTRA NA CONTA, e por um dia ela entrou. Entre a manhã e a tarde de 2026-09-21
 * esta função recebia um `relativo` e saía sem escrever nada sob a lente D+N, para casar com o
 * que a caixa do painel dizia. O ramo era pior que o desalinho: o "Reagendar" só existe no modo
 * RELATIVO (a engrenagem só o desenha ali), então no ÚNICO caminho que chega aqui a rederivação
 * nunca acontecia, e o símbolo ficava com o GDH velho descrevendo uma janela que acabara de
 * andar. Um GDH absoluto fresco num mapa D+N é no máximo estranho; um GDH velho é dado errado
 * impresso. A invariante que vale: `autoDtg` ligado implica GDH igual à janela, em qualquer
 * lente, como manda o modelo de lente pura.
 *
 * @param {string} sourceType - Source feature type: 'military_symbol' / 'coordination_measure'.
 * @param {Object} p - Feature properties (already shifted in place).
 */
function rederiveAutoDtg(sourceType, p) {
    for (const [prop, valor] of Object.entries(derivarCamposDtg(p, sourceType))) {
        if (valor === '' && p[prop] === undefined) continue;
        p[prop] = valor;
    }
}

/**
 * Shifts every temporal timestamp on a map's features by `deltaMs`:
 * `temporalInicio`, `temporalFim`, and each trajectory keypoint's `t`. Driven by
 * the explicit "Reagendar" action (move the whole exercise to a new real D-Day,
 * keeping the D+N offsets). Atomic (one transaction, one persist). Not undoable.
 * Each shifted feature emits a `feature` UPDATE op (carrying the shifted temporal
 * fields) so collaborators receive the new window; the logger is a no-op offline.
 * @param {string|null} mapName - Target map (null = current).
 * @param {number} deltaMs - Amount to add to each temporal timestamp.
 * @returns {Promise<number>} Number of features changed.
 */
export async function shiftMapTemporalTimes(mapName, deltaMs) {
    const targetMap = resolveMap(mapName);
    if (!Number.isFinite(deltaMs) || deltaMs === 0) return 0;
    if (guardWrite(GuardAction.UPDATE_FEATURE, 'shiftMapTemporalTimes', targetMap).blocked) return 0;

    return withMapDocument(targetMap, 'shiftMapTemporalTimes', async () => {
        const currentMapData = await mapDocumentForGesture(targetMap, 'shiftMapTemporalTimes');
        if (!currentMapData) return 0;
        // Collect shifted features so each can emit a feature UPDATE op after the single
        // persist. Snapshot the pre-shift feature for the op's previousData, mirroring
        // updateFeature's logFeatureOperation(UPDATE, ...) call shape.
        const shifted = [];
        for (const type of Object.keys(currentMapData.features)) {
            for (const feature of currentMapData.features[type]) {
                const p = feature.properties;
                if (!p) continue;
                let touched = false;
                const oldFeature = deepClone(feature);
                if (Number.isFinite(p.temporalInicio)) { p.temporalInicio += deltaMs; touched = true; }
                if (Number.isFinite(p.temporalFim)) { p.temporalFim += deltaMs; touched = true; }
                if (Array.isArray(p.trajetoria)) {
                    for (const kp of p.trajetoria) {
                        if (kp && Number.isFinite(kp.t)) { kp.t += deltaMs; touched = true; }
                    }
                }
                if (touched) {
                    // `type` is a STORAGE bucket key ('military_symbols'); the derivation
                    // reasons in SOURCE types ('military_symbol'). Converting here rather
                    // than restating the table inside the helper.
                    rederiveAutoDtg(getSourceTypeFromStorage(type), p); // keep auto DTG/GDH amplifiers in sync
                    touchUpdatedTimestamp(feature);
                    shifted.push({ feature, oldFeature, storage: type });
                }
            }
        }

        if (shifted.length === 0) return 0;

        await runTransaction(async (tx) => {
            {
                const mapId = mapManager.getMapId(targetMap);
                for (const { feature, oldFeature, storage } of shifted) {
                    tx.recordOperation(EntityType.FEATURE, OperationType.UPDATE, feature.properties.id, mapId, feature, oldFeature, { storage });
                }
            }

            return () => updateMapDataCompat(targetMap, currentMapData);
        });
        return shifted.length;
    });
}

// ===== MOVE OPERATIONS =====

/**
 * Moves features between maps.
 *
 * Deliberately NOT wrapped in `withMapDocument`: it awaits `addFeatureToMap` and
 * `removeFeatureFromMap`, which take the lock themselves, on the target and the source
 * map. Taking either key here would make this function wait for itself (the queue has no
 * reentrancy — see document-lock.js). Each leaf write stays atomic; the move as a whole
 * is not, which is exactly what it already was.
 *
 * @param {Array} features - Features to move
 * @param {string} targetMapName - Target map name
 */
export async function moveFeaturesToMap(features, targetMapName) {
    if (!features || features.length === 0) return;

    const sourceMapName = mapManager.getCurrentMapName();
    if (guardWrite(GuardAction.UPDATE_FEATURE, 'moveFeaturesToMap', sourceMapName).blocked) return;
    if (memoryStore.lockedMaps.has(targetMapName)) {
        emitStoreError(StoreErrorEvents.STORE_OPERATION_BLOCKED, { operation: 'moveFeaturesToMap', reason: 'target_map_locked' });
        return;
    }
    if (sourceMapName === targetMapName) {
        console.warn('Attempt to move features to the same map');
        return;
    }

    // A CHECAGEM QUE MORAVA AQUI NUNCA DISPAROU, e é a forma pura do defeito D2: ela perguntava
    // `Object.keys(targetMapData).length === 0` sobre a resposta de `getMapDataCompat`, que num
    // mapa AUSENTE devolve `getEmptyMapData()` — um documento com catorze chaves e vinte e dois
    // baldes de feição. A condição era falsa por construção, com ou sem mapa, e o
    // `throw new Error('Target map not found')` era código morto: a mudança dos itens para um mapa
    // inexistente seguia adiante e os cravava num registro novo sob o NOME.
    //
    // A leitura estrita a torna verdadeira de novo, e a recusa troca de forma junto: mover itens é
    // um gesto ESPERADO de falhar (o mapa de destino pode ter acabado de ser apagado por um par),
    // então ela emite e volta, como os outros dois gates desta mesma função, em vez de estourar.
    const targetMapData = await mapDocumentForGesture(targetMapName, 'moveFeaturesToMap');
    if (!targetMapData) return;

    const layerIdMapping = await buildLayerMappingForMove(features, sourceMapName, targetMapName);

    const featuresByType = features.reduce((acc, feature) => {
        const type = getFeatureType(feature);
        if (!acc[type]) acc[type] = [];
        acc[type].push(feature);
        return acc;
    }, {});

    const batchOperation = {
        type: 'moveBetweenMaps',
        sourceMapName,
        targetMapName,
        movedFeatures: {}
    };

    try {
        for (const [type, featuresOfType] of Object.entries(featuresByType)) {
            const typeOperations = { mainFeatures: [], processedFeatures: [] };

            for (const feature of featuresOfType) {
                // Add to the target map FIRST. If the add fails (persist error or
                // cleanFeature rejects it), we leave the source untouched, so the
                // feature is never lost — worst case is a recoverable duplicate.
                updateLayerId(feature, layerIdMapping);
                const addedFeature = await addFeatureToMap(type, feature, targetMapName, { featureIntent: 'move', sourceMapId: mapManager.getMapId(sourceMapName) });
                if (!addedFeature) continue;

                // Only after the target add succeeded do we remove from the source.
                // removeFeatureFromMap also strips and returns related processed
                // (LOS/visibility) children so they can be moved too.
                const removedData = await removeFeatureFromMap(type, feature.properties.id, sourceMapName, { logOperation: false });
                if (!removedData) continue;

                typeOperations.mainFeatures.push({
                    feature: deepClone(addedFeature),
                    removedData: {
                        mainFeature: deepClone(removedData.mainFeature),
                        processedFeatures: removedData.processedFeatures
                            ? deepClone(removedData.processedFeatures)
                            : null
                    }
                });

                if (removedData.processedFeatures) {
                    for (const pf of removedData.processedFeatures.features) {
                        updateLayerId(pf, layerIdMapping);
                        await addFeatureToMap(removedData.processedFeatures.type, pf, targetMapName, { featureIntent: 'move', sourceMapId: mapManager.getMapId(sourceMapName) });
                    }
                }
            }

            if (typeOperations.mainFeatures.length > 0) {
                batchOperation.movedFeatures[type] = typeOperations;
            }
        }

        if (Object.keys(batchOperation.movedFeatures).length > 0) {
            mapManager.recordAction(batchOperation);
        }
    } catch (error) {
        console.error('Error moving features:', error);
        throw error;
    }
}

/**
 * Updates a feature's layerId based on the layer mapping.
 * @param {Object} feature
 * @param {Map} layerIdMapping
 */
function updateLayerId(feature, layerIdMapping) {
    const oldLayerId = feature.properties.layerId || 'default';
    const newLayerId = layerIdMapping.get(oldLayerId);
    if (newLayerId && newLayerId !== oldLayerId) {
        feature.properties.layerId = newLayerId;
    }
}

/**
 * Builds layer ID mapping for moving features between maps.
 * Creates layers in target map if they don't exist (matching by name).
 * @param {Array} features - Features being moved
 * @param {string} sourceMapName - Source map name
 * @param {string} targetMapName - Target map name
 * @returns {Promise<Map>} Mapping of source layerId to target layerId
 */
export async function buildLayerMappingForMove(features, sourceMapName, targetMapName) {
    const layerIdMapping = new Map();

    if (!deps.layerManager) {
        layerIdMapping.set('default', 'default');
        return layerIdMapping;
    }

    try {
        const sourceLayerIds = new Set(
            features.map(f => f.properties?.layerId || 'default')
        );

        const sourceLayers = await getLayersCompat(sourceMapName);
        const sourceLayersById = new Map(sourceLayers.map(l => [l.id, l]));

        const targetLayers = await getLayersCompat(targetMapName);
        const targetLayersByName = new Map(targetLayers.map(l => [l.name, l.id]));

        let createdNewLayers = false;

        for (const sourceLayerId of sourceLayerIds) {
            if (sourceLayerId === 'default') {
                layerIdMapping.set('default', 'default');
                continue;
            }

            const sourceLayer = sourceLayersById.get(sourceLayerId);
            if (!sourceLayer) {
                layerIdMapping.set(sourceLayerId, 'default');
                continue;
            }

            const existingTargetLayerId = targetLayersByName.get(sourceLayer.name);
            if (existingTargetLayerId) {
                layerIdMapping.set(sourceLayerId, existingTargetLayerId);
            } else {
                // `createLayerForImport` e ASSINCRONA desde 2026-09-13 (write-ahead). O `await`
                // e seguro aqui porque `moveFeaturesToMap` e um COMPOSTO que nao toma trava
                // nenhuma (ver o cabecalho de `store/document-lock.js`), e a criacao de camada
                // toma a chave lateral 'layers', nunca `map:<id>`.
                const newLayer = await deps.layerManager.createLayerForImport(sourceLayer.name, targetMapName);
                layerIdMapping.set(sourceLayerId, newLayer.id);
                targetLayersByName.set(newLayer.name, newLayer.id);
                createdNewLayers = true;
            }
        }

        // Notify visibility system so new layers appear in the visible set
        if (createdNewLayers && deps.eventBus) {
            deps.eventBus.emit(EventTypes.LAYERS_CHANGED, { mapName: targetMapName });
        }
    } catch (error) {
        console.warn('Error building layer mapping for move:', error);
        layerIdMapping.set('default', 'default');
    }

    return layerIdMapping;
}

// ===== BATCH OPERATIONS FOR LOS/VISIBILITY =====

/**
 * Shared implementation for batch-updating an analysis feature and its processed results.
 * @param {string} mainType - 'los' or 'visibility'
 * @param {Object} mainFeature - The analysis feature
 * @param {Array} processedFeatures - Processed result features
 * @param {string|null} mapName - Target map name
 */
async function batchUpdateAnalysisFeatures(mainType, mainFeature, processedFeatures, mapName) {
    const operationName = `batchUpdate${mainType.charAt(0).toUpperCase() + mainType.slice(1)}Features`;
    const targetMap = resolveMap(mapName);
    if (guardWrite(GuardAction.UPDATE_FEATURE, operationName, targetMap).blocked) return false;

    const processedType = getProcessedType(mainType);

    return withMapDocument(targetMap, operationName, async () => {
        const currentMapData = await mapDocumentForGesture(targetMap, operationName);
        if (!currentMapData) return false;

        // Defensive init: older/imported maps may predate these arrays.
        if (!currentMapData.features[mainType]) currentMapData.features[mainType] = [];
        if (!currentMapData.features[processedType]) currentMapData.features[processedType] = [];

        const mainIndex = currentMapData.features[mainType].findIndex(
            f => f.properties.id === mainFeature.properties.id
        );
        if (mainIndex === -1) return false;

        const oldFeature = currentMapData.features[mainType][mainIndex];
        const cleanedMain = cleanFeature(mainFeature);
        if (!cleanedMain) return false;
        // The same two preservations `updateFeature` applies, and for the same reasons, which
        // matter more now that this write travels: the caller hands in the MapLibre SOURCE copy,
        // so a user-data collection absent from it would go out as a `remove` in the patch, and
        // the confirmed revision must stay the one the server recognises.
        preserveUserData(oldFeature, cleanedMain);
        preserveSyncMetadata(oldFeature, cleanedMain);
        const mainChanged = !isFeatureEqual(oldFeature, cleanedMain);
        if (mainChanged) touchUpdatedTimestamp(cleanedMain);
        currentMapData.features[mainType][mainIndex] = cleanedMain;

        const featureIdPrefix = mainFeature.properties.id + '-';

        const oldProcessedFeatures = currentMapData.features[processedType].filter(f =>
            f.properties.id.startsWith(featureIdPrefix)
        );

        currentMapData.features[processedType] = currentMapData.features[processedType].filter(f =>
            !f.properties.id.startsWith(featureIdPrefix)
        );

        const cleanedProcessed = processedFeatures.map(cleanFeature).filter(Boolean);
        currentMapData.features[processedType].push(...cleanedProcessed);

        await runTransaction(async (tx) => {
            // An entry only for an edit that changed the input: the output is derived from it, so
            // an unchanged input means nothing to take back, and an empty entry makes the next
            // Ctrl+Z announce "desfeita" and do nothing (measured: the observer-height field
            // commits twice, on its debounce and on blur, and the second commit recorded one).
            if (mainChanged && shouldRecordUndo(mapName)) {
                tx.deferSync(() => {
                    mapManager.recordAction({
                        type: 'updateWithProcessed',
                        mainFeatureType: mainType,
                        oldFeature: deepClone(oldFeature),
                        newFeature: deepClone(cleanedMain),
                        oldProcessedFeatures: {
                            type: processedType,
                            features: deepClone(oldProcessedFeatures)
                        },
                        newProcessedFeatures: {
                            type: processedType,
                            features: deepClone(cleanedProcessed)
                        }
                    });
                });
            }

            // THE INPUT'S EDIT TRAVELS, and until 2026-09-23 nothing here did: every edit of a line
            // of sight or a viewshed other than its creation (the recalculation of a parameter, the
            // drag of an endpoint, the panel's "Salvar") passes through this function, and it wrote
            // the disk and logged no operation at all. In an atlas of the server the edit existed
            // only on this computer, the peer never saw it, and the next snapshot undid it on the
            // author. The OUTPUT is not logged: every client derives it from the input
            // (`store/analysis-output.js`), and the dispatcher would drop it by type anyway.
            if (mainChanged) {
                const mapId = mapManager.getMapId(targetMap);
                tx.recordOperation(EntityType.FEATURE, OperationType.UPDATE, cleanedMain.properties.id, mapId,
                    cleanedMain, oldFeature, { storage: mainType });
            }

            return () => updateMapDataCompat(targetMap, currentMapData);
        });
        return true;
    });
}

/**
 * Re-derives, IN PLACE, the analysis output of one input feature from the input as it is stored
 * NOW (`store/analysis-output.js`). The output is never synced, so this writes no operation.
 *
 * It exists for undo and redo, which used to REINSERT the halves they had kept in the history
 * entry. Since an undo takes back only what its own edit changed (`keepLaterEdits`), the input it
 * leaves may carry a peer's later geometry, and the kept halves were drawn on the old one: the
 * analysis showed in the wrong place on the author's screen until a reload. Deriving from the
 * resulting input cannot disagree with it.
 *
 * A derived write, so a map that no longer exists is skipped in silence.
 * @param {string} inputType - Store bucket of the input (`los` or `visibility`)
 * @param {string} inputId - Id of the input feature
 * @param {string} [mapName=null] - Target map name
 * @returns {Promise<boolean>} Whether an output bucket was rewritten
 */
export async function rederiveAnalysisOutput(inputType, inputId, mapName = null) {
    if (!derivedOutputBucketOf(inputType) || !inputId) return false;
    const targetMap = resolveMap(mapName);
    return withMapDocument(targetMap, 'rederiveAnalysisOutput', async () => {
        const currentMapData = await mapDocumentForDerivedWrite(targetMap);
        if (!currentMapData?.features) return false;
        const input = (currentMapData.features[inputType] ?? []).find(f => f.properties?.id === inputId) ?? null;
        replaceDerivedOutput(currentMapData.features, inputType, inputId, input);
        await runTransaction(async () => () => updateMapDataCompat(targetMap, currentMapData));
        return true;
    });
}

/**
 * Batch updates LOS feature and its processed features.
 * @param {Object} losFeature - LOS feature
 * @param {Array} processedFeatures - Processed LOS features
 * @param {string} [mapName=null] - Target map name
 */
export async function batchUpdateLOSFeatures(losFeature, processedFeatures, mapName = null) {
    return batchUpdateAnalysisFeatures('los', losFeature, processedFeatures, mapName);
}

/**
 * Batch updates visibility feature and its processed features.
 * @param {Object} visibilityFeature - Visibility feature
 * @param {Array} processedFeatures - Processed visibility features
 * @param {string} [mapName=null] - Target map name
 */
export async function batchUpdateVisibilityFeatures(visibilityFeature, processedFeatures, mapName = null) {
    return batchUpdateAnalysisFeatures('visibility', visibilityFeature, processedFeatures, mapName);
}

// ===== LAYER-FEATURE OPERATIONS =====

/**
 * Deletes all features from a specific layer.
 *
 * `releaseImages: false` detaches the features from the map WITHOUT destroying their
 * image blobs. The blob store is keyed by the feature id, so a move to another map
 * carries the same ids and must keep the blobs alive: releasing them here would leave
 * the just-moved features pointing at nothing. `transferLayerToMap` is the only caller
 * that passes it.
 *
 * @param {string} layerId - Layer ID
 * @param {string} [mapName=null] - Target map name
 * @param {Object} [options] - Deletion options
 * @param {boolean} [options.releaseImages=true] - Whether to delete image blobs
 * @returns {Promise<boolean>} Whether any features were deleted
 */
export async function deleteLayerFeatures(layerId, mapName = null, { releaseImages = true } = {}) {
    const targetMap = resolveMap(mapName);
    if (guardWrite(GuardAction.DELETE_FEATURE, 'deleteLayerFeatures', targetMap).blocked) return false;

    return withMapDocument(targetMap, 'deleteLayerFeatures', async () => {
        const currentMapData = await mapDocumentForGesture(targetMap, 'deleteLayerFeatures');
        if (!currentMapData) return false;
        let modified = false;
        const groupCleanups = [];
        const imageCleanups = [];

        for (const storageType of getAllStorageTypes()) {
            const typeFeatures = currentMapData.features[storageType] || [];
            const initialLength = typeFeatures.length;

            currentMapData.features[storageType] = typeFeatures.filter(feature => {
                const featureLayerId = feature.properties?.layerId || 'default';
                if (featureLayerId === layerId) {
                    const featureId = feature.properties?.id;
                    if (featureId) {
                        // Groups index features by the SINGULAR source type, which is what
                        // every other caller passes; handing them the PLURAL storage type
                        // matched nothing and left orphan references behind.
                        const sourceType = feature.properties?.source
                            || getSourceTypeFromStorage(storageType);
                        groupCleanups.push({ sourceType, featureId });
                        // Deleting a whole layer bypasses the per-tool deleteFeatures,
                        // so release the image blob here for image-bearing feature types.
                        if (releaseImages
                            && IMAGE_RESOURCE_FEATURE_TYPES.includes(feature.properties?.source)) {
                            imageCleanups.push(featureId);
                        }
                    }
                    return false;
                }
                return true;
            });

            if (currentMapData.features[storageType].length < initialLength) {
                modified = true;
            }
        }

        if (modified) {
            await runTransaction(async (tx) => {
                // N removals, ONE groups document. Every call composes with the previous ones
                // through the transaction's overlay (see `pendingGroupEdits` in
                // `tool_manager/group_manager.js`) and every closure it returns writes that same
                // accumulated object, so keeping the last non-null one persists all of them.
                let persistGroups = null;
                for (const { sourceType, featureId } of groupCleanups) {
                    persistGroups = deps.groupManager.removeFeatureFromAllGroups(
                        tx, sourceType, featureId, targetMap
                    ) ?? persistGroups;
                }

                if (imageCleanups.length > 0) {
                    tx.deferAsync(async () => {
                        for (const featureId of imageCleanups) {
                            await removeImage(featureId);
                        }
                    });
                }

                return async () => {
                    await updateMapDataCompat(targetMap, currentMapData);
                    await persistGroups?.();
                };
            });
        }
        return modified;
    });
}

/**
 * Gets features from a specific layer.
 * @param {string} layerId - Layer ID
 * @param {string} [mapName=null] - Target map name
 * @returns {Promise<Array>} Array of features
 */
export async function getLayerFeatures(layerId, mapName = null) {
    const features = await getCurrentMapFeatures(mapName);
    const result = [];

    for (const storageType of getAllStorageTypes()) {
        const typeFeatures = features[storageType] || [];
        for (const feature of typeFeatures) {
            const featureLayerId = feature.properties?.layerId || 'default';
            if (featureLayerId === layerId) {
                result.push(feature);
            }
        }
    }
    return result;
}

/**
 * Gets a layer's features KEYED BY STORAGE TYPE (the shape `addFeatures` eats).
 *
 * The flat `getLayerFeatures` loses the bucket a feature came from, and rebuilding it
 * from `properties.source` is lossy: a feature with no `source` would be filed under a
 * bucket that does not exist. Reading the buckets straight from the map data keeps the
 * key exact.
 *
 * Features come deep-cloned (via `getCurrentMapFeatures`), so the caller may reshape them
 * without touching what is stored.
 *
 * @param {string} layerId - Layer ID
 * @param {string} [mapName=null] - Target map name
 * @returns {Promise<Object<string, Object[]>>} Features by storage type (empty buckets omitted)
 */
export async function getLayerFeaturesByStorageType(layerId, mapName = null) {
    const features = await getCurrentMapFeatures(mapName);
    const result = {};

    for (const storageType of getAllStorageTypes()) {
        const typeFeatures = (features[storageType] || []).filter(feature =>
            (feature.properties?.layerId || 'default') === layerId
        );
        if (typeFeatures.length > 0) {
            result[storageType] = typeFeatures;
        }
    }
    return result;
}

/**
 * Refuses a move between layers that a lock forbids, and names the lock.
 *
 * A locked layer, a locked group and a feature's own `bloqueado` are client conventions (the server
 * stores them and never asks), and the move asked none of them: dragging a row of the layers tree
 * moved a feature OUT of a locked layer and INTO one, on the server, for the owner and the editor
 * alike (measured with two browsers). The context menu filtered locked DESTINATIONS on its own and
 * nothing else did. Same scope as `refuseCreationInLockedLayer`: the current map only.
 * @param {Array<Object>} features - The features about to move.
 * @param {string} targetLayerId
 * @param {string} targetMap
 * @returns {boolean} True when refused (the refusal has already been announced).
 */
function refuseLockedLayerMove(features, targetLayerId, targetMap) {
    if (targetMap !== mapManager.getCurrentMapName() || typeof deps.layerManager?.getLayerById !== 'function') return false;
    let message = null;
    if (deps.layerManager.getLayerById(targetLayerId, targetMap)?.locked === true) {
        message = lockedLayerCreateNotice(false);
    } else {
        for (const feature of features) {
            const state = featureLockState(feature);
            if (state) { message = featureLockNotice(state); break; }
        }
    }
    if (!message) return false;
    emitStoreError(StoreErrorEvents.STORE_OPERATION_BLOCKED, {
        operation: 'moveFeaturesToLayer',
        message,
        reason: 'layer_locked',
        timestamp: Date.now()
    });
    return true;
}

/**
 * Moves features to another layer.
 * @param {Array} featureRefs - Array of layer IDs or feature references
 * @param {string} targetLayerId - Target layer ID
 * @param {string} [mapName=null] - Target map name
 * @returns {Promise<boolean>} Whether any features were moved
 */
export async function moveFeaturesToLayer(featureRefs, targetLayerId, mapName = null) {
    if (featureRefs.length === 0) return false;

    const targetMap = resolveMap(mapName);
    if (guardWrite(GuardAction.UPDATE_FEATURE, 'moveFeaturesToLayer', targetMap).blocked) return false;

    return withMapDocument(targetMap, 'moveFeaturesToLayer', async () => {
        const currentMapData = await mapDocumentForGesture(targetMap, 'moveFeaturesToLayer');
        if (!currentMapData) return false;
        let modified = false;
        const moved = [];
        const candidates = [];
        const isLayerIdArray = typeof featureRefs[0] === 'string';

        for (const storageType of getAllStorageTypes()) {
            const typeFeatures = currentMapData.features[storageType] || [];
            for (const feature of typeFeatures) {
                let shouldMove = false;
                if (isLayerIdArray) {
                    const featureLayerId = feature.properties?.layerId || 'default';
                    shouldMove = featureRefs.includes(featureLayerId);
                } else {
                    shouldMove = featureRefs.some(ref => {
                        const refStorageType = getStorageTypeFromSource(ref.type);
                        return refStorageType === storageType && ref.id === feature.properties?.id;
                    });
                }

                if (shouldMove) candidates.push({ feature, storage: storageType });
            }
        }

        // DECIDED BEFORE ANY FEATURE IS TOUCHED, because the document read above may be the
        // cached one and a mutation left behind by a refusal would be read by the next writer.
        if (refuseLockedLayerMove(candidates.map(c => c.feature), targetLayerId, targetMap)) return false;

        for (const { feature, storage } of candidates) {
            const oldFeature = deepClone(feature);
            feature.properties.layerId = targetLayerId;
            moved.push({ feature, oldFeature, storage });
            modified = true;
        }

        if (modified) {
            const mapId = mapManager.getMapId(targetMap);
            await runTransaction(async tx => {
                for (const { feature, oldFeature, storage } of moved) {
                    tx.recordOperation(EntityType.FEATURE, OperationType.UPDATE, feature.properties.id, mapId, feature, oldFeature, { storage });
                }
                return () => updateMapDataCompat(targetMap, currentMapData);
            });
        }
        return modified;
    });
}

// ===== VISIBILITY/LOCK CHECKS =====

/**
 * Checks if a feature is effectively locked.
 * @param {Object} feature - Feature to check
 * @returns {boolean} True if locked
 */
export function isFeatureEffectivelyLocked(feature) {
    return featureLockState(feature) !== null;
}

/**
 * WHICH of the three client-convention locks holds a feature, so a refusal can name the one the
 * person has to lift: the feature's own `bloqueado`, then its layer's `locked`, then its group's
 * `locked` (the map lock is asked separately, and is the only one the server enforces).
 * @param {Object} feature - Feature to check
 * @returns {string|null} A value of `FeatureLockState` (`store/denial-phrases.js`), or null.
 */
export function featureLockState(feature) {
    if (!feature || !feature.properties) return null;

    if (feature.properties.bloqueado === true) return FeatureLockState.FEATURE;
    if (deps.layerManager.isFeatureEffectivelyLocked(feature)) return FeatureLockState.LAYER;

    const featureId = feature.properties.id;
    const sourceType = feature.properties.source;
    if (featureId && sourceType) {
        const group = deps.groupManager.getFeatureGroup(sourceType, featureId);
        if (group && group.locked === true) return FeatureLockState.GROUP;
    }
    return null;
}

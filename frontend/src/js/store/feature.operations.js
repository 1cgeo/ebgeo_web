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
    if (type === 'los') return 'processed_los';
    if (type === 'visibility') return 'processed_visibility';
    return null;
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
 * The unit is the geometry as a whole and each top-level property. Bookkeeping properties
 * (`confirmedVersion`, `updatedAt`, ...) always differ from the recorded snapshot, so they keep
 * the current value, which is also what `preserveSyncMetadata` does.
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
        if (now[key] === undefined) delete result.properties[key];
        else result.properties[key] = deepClone(now[key]);
    }
    return result;
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
 */
export async function updateFeature(type, feature, mapName = null, { preserveUserData: keepUserData = true, revertFrom = null } = {}) {
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
        // Read under the document lock, like `oldFeature`: a peer's op applied between a read
        // outside it and this write would be exactly the edit the revert must not take back.
        if (revertFrom) cleanedFeature = cleanFeature(keepLaterEdits(oldFeature, cleanFeature(revertFrom), cleanedFeature));

        // Skip for authoritative user-data writes: UserDataManager passes a full clone, so an
        // intentionally-emptied attributes/images collection must NOT be restored from the old value.
        if (keepUserData) preserveUserData(oldFeature, cleanedFeature);
        preserveSyncMetadata(oldFeature, cleanedFeature);

        if (isFeatureEqual(oldFeature, cleanedFeature)) return;

        touchUpdatedTimestamp(cleanedFeature);

        await runTransaction(async (tx) => {
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
                tx.recordOperation(EntityType.FEATURE, OperationType.UPDATE, cleanedFeature.properties.id, mapId, cleanedFeature, oldFeature, { storage: type });
            }

            return () => updateMapDataCompat(targetMap, currentMapData);
        });
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
 */
export async function addFeatures(featuresMap, mapName = null, options = {}) {
    const targetMap = resolveMap(mapName);
    if (guardWrite(GuardAction.CREATE_FEATURE, 'addFeatures', targetMap).blocked) return;

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
                tx.deferSync(() => mapManager.recordAction(action));
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

        await runTransaction(async (tx) => {
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
                tx.recordOperation(EntityType.FEATURE, OperationType.UPDATE, featureId, mapId, feature, oldFeature, { storage: featureType });
            }

            return () => updateMapDataCompat(targetMap, currentMapData);
        });

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
            if (shouldRecordUndo(mapName)) {
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

            return () => updateMapDataCompat(targetMap, currentMapData);
        });
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

                if (shouldMove) {
                    const oldFeature = deepClone(feature);
                    feature.properties.layerId = targetLayerId;
                    moved.push({ feature, oldFeature, storage: storageType });
                    modified = true;
                }
            }
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
    if (!feature || !feature.properties) return false;

    if (deps.layerManager.isFeatureEffectivelyLocked(feature)) return true;

    const featureId = feature.properties.id;
    const sourceType = feature.properties.source;
    if (featureId && sourceType) {
        const group = deps.groupManager.getFeatureGroup(sourceType, featureId);
        if (group && group.locked === true) return true;
    }
    return false;
}

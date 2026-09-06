// Path: js/store/feature.operations.js

/**
 * @fileoverview Feature CRUD operations.
 */

import { cleanFeature } from './repository.utils.js';
import { getMapDataCompat, updateMapDataCompat, getLayersCompat } from './repositories/index.js';
import { FEATURE_TYPE_MAPPINGS, getAllStorageTypes, getStorageTypeFromSource, getSourceTypeFromStorage, IMAGE_RESOURCE_FEATURE_TYPES } from './store.constants.js';
import { removeImage } from './settings.operations.js';
import mapManager from './store-state-manager.js';
import { memoryStore } from './memory-store.js';
import { isCurrentMapLockedSync } from './map.operations.js';
import { logFeatureOperation, OperationType } from './sync/index.js';
import { checkPermission, GuardAction } from './sync/permission-guard.js';
import { emitStoreError, StoreErrorEvents } from './store-errors.js';
import { runTransaction } from './store-transaction.js';
import { withMapDocument } from './document-lock.js';
import { deepClone, deepEqual } from '../utilities/deep-utils.js';
import { EventTypes } from '../events';
import { applyGeneratedBitmap } from '../layers/bitmap-version.js';
import { formatDTG } from '../temporal/temporal.utils.js';

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
    if (oldFeature.properties.createdAt) {
        cleanedFeature.properties.createdAt = oldFeature.properties.createdAt;
    }
    if (oldFeature.properties.version !== undefined) {
        cleanedFeature.properties.version = oldFeature.properties.version;
    }
}

// ===== CRUD OPERATIONS =====

/**
 * Adds a new feature to a map.
 * @param {string} type - Storage type (e.g., 'points')
 * @param {Object} feature - GeoJSON feature to add
 * @param {string} [mapName=null] - Target map name
 * @returns {Promise<Object|undefined>} Cleaned feature or undefined if blocked
 */
export async function addFeature(type, feature, mapName = null) {
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
        await runTransaction(async (tx) => {
            const currentMapData = await getMapDataCompat(targetMap);
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

            tx.deferAsync(() => {
                const mapId = mapManager.getMapId(targetMap);
                return logFeatureOperation(OperationType.CREATE, cleanedFeature.properties.id, mapId, cleanedFeature);
            });

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
 */
export async function updateFeature(type, feature, mapName = null, { preserveUserData: keepUserData = true } = {}) {
    const targetMap = resolveMap(mapName);
    if (guardWrite(GuardAction.UPDATE_FEATURE, 'updateFeature', targetMap).blocked) return;

    const cleanedFeature = cleanFeature(feature);
    if (!cleanedFeature) {
        console.warn('Feature ignored after cleanup:', feature);
        return;
    }

    // The lock opens BEFORE the read: the stale-read window is the defect, so a read taken
    // outside it would be exactly as lost-update-prone as before.
    return withMapDocument(targetMap, 'updateFeature', async () => {
        const currentMapData = await getMapDataCompat(targetMap);
        const index = currentMapData.features[type].findIndex(f => f.properties.id === cleanedFeature.properties.id);
        if (index === -1) return;

        const oldFeature = currentMapData.features[type][index];
        const oldColor = mapManager.getFeatureColor(oldFeature);

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

            tx.deferAsync(() => {
                const mapId = mapManager.getMapId(targetMap);
                return logFeatureOperation(OperationType.UPDATE, cleanedFeature.properties.id, mapId, cleanedFeature, oldFeature);
            });

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
        const currentMapData = await getMapDataCompat(targetMap);
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

            tx.deferSync(() => {
                deps.groupManager.removeFeatureFromAllGroups(mainFeature.properties.source, id, targetMap);
            });

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

            tx.deferAsync(() => {
                const mapId = mapManager.getMapId(targetMap);
                return logFeatureOperation(OperationType.DELETE, id, mapId, null, mainFeature);
            });

            return () => updateMapDataCompat(targetMap, currentMapData);
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
export async function addFeatureToMap(type, feature, mapName) {
    return await addFeature(type, feature, mapName);
}

/**
 * Removes a feature from a specific map and returns removed data.
 * @param {string} type - Storage type
 * @param {string} id - Feature ID
 * @param {string} mapName - Target map name
 * @returns {Promise<Object|null>} Removed feature data
 */
export async function removeFeatureFromMap(type, id, mapName) {
    // Leaf: it takes the lock, so its caller `moveFeaturesToMap` must NOT (it awaits this
    // one and `addFeatureToMap`, and a section awaiting a section on the same key hangs).
    return withMapDocument(mapName, 'removeFeatureFromMap', async () => {
        const mapData = await getMapDataCompat(mapName);
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

            tx.deferSync(() => {
                deps.groupManager.removeFeatureFromAllGroups(mainFeature.properties.source, id, mapName);
            });

            // Emit the DELETE op so the source-map removal SYNCS (this is the source half of
            // moveFeaturesToMap). Without it, a moved feature stayed on the source map for
            // every other client — it left but they never saw it leave.
            tx.deferAsync(() => {
                const mapId = mapManager.getMapId(mapName);
                return logFeatureOperation(OperationType.DELETE, id, mapId, null, mainFeature);
            });

            return () => updateMapDataCompat(mapName, mapData);
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
        const currentMapData = await getMapDataCompat(targetMap);
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
        const currentMapData = await getMapDataCompat(targetMap);
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
export async function addFeatures(featuresMap, mapName = null) {
    const targetMap = resolveMap(mapName);
    if (guardWrite(GuardAction.CREATE_FEATURE, 'addFeatures', targetMap).blocked) return;

    return withMapDocument(targetMap, 'addFeatures', async () => {
        const currentMapData = await getMapDataCompat(targetMap);
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
            tx.deferAsync(async () => {
                const mapId = mapManager.getMapId(targetMap);
                for (const type of Object.keys(action.features)) {
                    for (const feat of action.features[type]) {
                        await logFeatureOperation(OperationType.CREATE, feat.properties.id, mapId, feat);
                    }
                }
            });

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
export async function stampGeneratedBitmap(feature, result, mapName = null) {
    const featureId = feature?.properties?.id;
    const source = feature?.properties?.source;
    if (!featureId || !source || !result) return false;

    const targetMap = resolveMap(mapName);
    const storageType = getStorageTypeFromSource(source);

    return withMapDocument(targetMap, 'stampGeneratedBitmap', async () => {
        const currentMapData = await getMapDataCompat(targetMap);
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
 * @param {string} featureType - Storage type
 * @param {string} featureId - Feature ID
 * @param {string} property - Property name
 * @param {*} value - New value
 * @param {string} [mapName=null] - Target map name
 * @returns {Promise<boolean>} Whether update was successful
 */
export async function updateFeatureProperty(featureType, featureId, property, value, mapName = null) {
    const targetMap = resolveMap(mapName);
    if (guardWrite(GuardAction.UPDATE_FEATURE, 'updateFeatureProperty', targetMap).blocked) return false;

    return withMapDocument(targetMap, 'updateFeatureProperty', async () => {
        const currentMapData = await getMapDataCompat(targetMap);
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

            tx.deferAsync(() => {
                const mapId = mapManager.getMapId(targetMap);
                return logFeatureOperation(OperationType.UPDATE, featureId, mapId, feature, oldFeature);
            });

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
 * @param {string} sourceType - Source feature type: 'military_symbol' / 'coordination_measure'.
 * @param {Object} p - Feature properties (already shifted in place).
 */
function rederiveAutoDtg(sourceType, p) {
    if (p.autoDtg !== true) return;
    if (sourceType === 'military_symbol') {
        if (Number.isFinite(p.temporalInicio)) p.dateTimeGroup = formatDTG(p.temporalInicio, 'military');
    } else if (sourceType === 'coordination_measure') {
        if (Number.isFinite(p.temporalInicio)) p.gdhIni = formatDTG(p.temporalInicio, 'coordination');
        if (Number.isFinite(p.temporalFim)) p.gdhFim = formatDTG(p.temporalFim, 'coordination');
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
        const currentMapData = await getMapDataCompat(targetMap);
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
                    shifted.push({ feature, oldFeature });
                }
            }
        }

        if (shifted.length === 0) return 0;

        await runTransaction(async (tx) => {
            tx.deferAsync(async () => {
                const mapId = mapManager.getMapId(targetMap);
                for (const { feature, oldFeature } of shifted) {
                    await logFeatureOperation(OperationType.UPDATE, feature.properties.id, mapId, feature, oldFeature);
                }
            });

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

    const targetMapData = await getMapDataCompat(targetMapName);
    if (!targetMapData || Object.keys(targetMapData).length === 0) {
        throw new Error(`Target map "${targetMapName}" not found`);
    }

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
                const addedFeature = await addFeatureToMap(type, feature, targetMapName);
                if (!addedFeature) continue;

                // Only after the target add succeeded do we remove from the source.
                // removeFeatureFromMap also strips and returns related processed
                // (LOS/visibility) children so they can be moved too.
                const removedData = await removeFeatureFromMap(type, feature.properties.id, sourceMapName);
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
                        await addFeatureToMap(removedData.processedFeatures.type, pf, targetMapName);
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
                const newLayer = deps.layerManager.createLayerForImport(sourceLayer.name, targetMapName);
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
    if (guardWrite(GuardAction.UPDATE_FEATURE, operationName, targetMap).blocked) return;

    const processedType = getProcessedType(mainType);

    return withMapDocument(targetMap, operationName, async () => {
        const currentMapData = await getMapDataCompat(targetMap);

        // Defensive init: older/imported maps may predate these arrays.
        if (!currentMapData.features[mainType]) currentMapData.features[mainType] = [];
        if (!currentMapData.features[processedType]) currentMapData.features[processedType] = [];

        const mainIndex = currentMapData.features[mainType].findIndex(
            f => f.properties.id === mainFeature.properties.id
        );
        if (mainIndex === -1) return;

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
        const currentMapData = await getMapDataCompat(targetMap);
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
                if (groupCleanups.length > 0) {
                    tx.deferSync(() => {
                        for (const { sourceType, featureId } of groupCleanups) {
                            deps.groupManager.removeFeatureFromAllGroups(sourceType, featureId, targetMap);
                        }
                    });
                }

                if (imageCleanups.length > 0) {
                    tx.deferAsync(async () => {
                        for (const featureId of imageCleanups) {
                            await removeImage(featureId);
                        }
                    });
                }

                return () => updateMapDataCompat(targetMap, currentMapData);
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
        const currentMapData = await getMapDataCompat(targetMap);
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
                    moved.push({ feature, oldFeature });
                    modified = true;
                }
            }
        }

        if (modified) {
            await updateMapDataCompat(targetMap, currentMapData);
            // Sync the layerId change to peers — it was persisted locally but never logged, so a
            // collaborator kept the feature in its old layer (with the wrong visibility/lock).
            const mapId = mapManager.getMapId(targetMap);
            for (const { feature, oldFeature } of moved) {
                await logFeatureOperation(OperationType.UPDATE, feature.properties.id, mapId, feature, oldFeature);
            }
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

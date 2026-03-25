// Path: js/store/sync/remote-operation-handler.js

/**
 * @fileoverview Remote operation handler for sync system.
 * Applies operations received from other clients to the local store.
 *
 * This handler is the inverse of operation logging:
 * - Logging: local change -> create operation -> queue
 * - Remote: receive operation -> apply to local state -> emit events
 *
 * IMPORTANT: Remote operations MUST NOT:
 * - Check permissions (already validated by server)
 * - Log to operation queue (avoids feedback loop)
 * - Record undo actions (undo is per-user, local only)
 */

import { EventTypes } from '../../events/event_types.js';
import { getRepository } from '../repositories/index.js';
import { localRepository } from '../repositories/local.repository.js';
import { getStorageTypeFromSource } from '../store.constants.js';
import { EntityType, OperationType } from './operation-types.js';

// ============================================================================
// MODULE STATE
// ============================================================================

/** @type {import('../../events/event_bus.js').EventBus|null} */
let _eventBus = null;

// ============================================================================
// INITIALIZATION
// ============================================================================

/**
 * Sets the EventBus dependency for emitting events.
 * Called once from initServices().
 *
 * @param {import('../../events/event_bus.js').EventBus} eventBus
 */
export function setRemoteHandlerEventBus(eventBus) {
    _eventBus = eventBus;
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

/**
 * Applies a remote operation to the local store.
 * Routes to entity-specific handlers based on entityType.
 *
 * @param {Object} operation - Remote operation
 * @param {string} operation.entityType - Entity type (from EntityType)
 * @param {string} operation.operationType - Operation type (from OperationType)
 * @param {string} operation.entityId - Entity UUID
 * @param {string} [operation.mapId] - Map UUID (context)
 * @param {Object} [operation.data] - Entity data (for CREATE/UPDATE)
 * @returns {Promise<void>}
 */
export async function applyRemoteOperation(operation) {
    const { entityType, operationType, entityId, mapId, data } = operation;

    switch (entityType) {
        case EntityType.FEATURE:
            await applyRemoteFeatureOp(operationType, entityId, mapId, data);
            break;
        case EntityType.LAYER:
            applyRemoteLayerOp(operationType, entityId, mapId, data);
            break;
        case EntityType.MAP:
            applyRemoteMapOp(operationType, mapId, data);
            break;
        case EntityType.GROUP:
            applyRemoteGroupOp(operationType, entityId, mapId, data);
            break;
        case EntityType.BRIEFING:
            await applyRemoteBriefingOp(operationType, entityId, data);
            break;
        default:
            console.warn(`Remote operation handler: unknown entity type "${entityType}"`);
    }

    emit(EventTypes.REMOTE_OPERATION_APPLIED, { operation });
}

// ============================================================================
// ENTITY-SPECIFIC HANDLERS
// ============================================================================

/**
 * Finds a feature by ID within a storage type array.
 *
 * @param {Array} features - Feature array to search
 * @param {string} featureId - Feature UUID
 * @returns {number} Index of the feature, or -1 if not found
 */
function findFeatureIndex(features, featureId) {
    return features.findIndex(f => f.properties?.id === featureId);
}

/**
 * Applies a remote feature operation.
 *
 * @param {string} opType - Operation type
 * @param {string} featureId - Feature UUID
 * @param {string} mapId - Map UUID
 * @param {Object} data - Feature GeoJSON data
 */
async function applyRemoteFeatureOp(opType, featureId, mapId, data) {
    const repo = getRepository();
    const mapData = await repo.getMap(mapId);
    if (!mapData) {
        console.warn(`Remote feature op: map "${mapId}" not found`);
        return;
    }

    const sourceType = data?.properties?.source || 'point';
    const storageType = getStorageTypeFromSource(sourceType);

    if (!mapData.features[storageType]) {
        mapData.features[storageType] = [];
    }

    const features = mapData.features[storageType];

    switch (opType) {
        case OperationType.CREATE: {
            features.push(data);
            await repo.saveMap(mapId, mapData);

            emit(EventTypes.FEATURE_CREATED, {
                featureId, featureType: sourceType, mapId, feature: data
            });
            break;
        }
        case OperationType.UPDATE: {
            const index = findFeatureIndex(features, featureId);
            if (index !== -1) {
                const previousFeature = features[index];
                features[index] = data;
                await repo.saveMap(mapId, mapData);

                emit(EventTypes.FEATURE_MODIFIED, {
                    featureId, featureType: sourceType, mapId,
                    feature: data, previousFeature
                });
            }
            break;
        }
        case OperationType.DELETE: {
            const index = findFeatureIndex(features, featureId);
            if (index !== -1) {
                features.splice(index, 1);
                await repo.saveMap(mapId, mapData);

                emit(EventTypes.FEATURE_DELETED, {
                    featureId, featureType: sourceType, mapId
                });
            }
            break;
        }
    }

    emit(EventTypes.LAYERS_CHANGED, { mapName: mapId });
}

/**
 * Applies a remote layer operation.
 *
 * @param {string} opType - Operation type
 * @param {string} layerId - Layer UUID
 * @param {string} mapId - Map UUID
 * @param {Object} data - Layer data
 */
function applyRemoteLayerOp(opType, layerId, mapId, data) {
    switch (opType) {
        case OperationType.CREATE:
            emit(EventTypes.LAYER_CREATED, { layerId, mapId, layer: data });
            break;
        case OperationType.UPDATE:
            emit(EventTypes.LAYER_MODIFIED, { layerId, mapId, layer: data });
            break;
        case OperationType.DELETE:
            emit(EventTypes.LAYER_DELETED, { layerId, mapId });
            break;
    }

    emit(EventTypes.LAYERS_CHANGED, { mapName: mapId });
}

/**
 * Applies a remote map operation.
 *
 * @param {string} opType - Operation type
 * @param {string} mapId - Map UUID
 * @param {Object} data - Map data
 */
function applyRemoteMapOp(opType, mapId, data) {
    switch (opType) {
        case OperationType.CREATE:
            emit(EventTypes.MAP_CREATED, { mapId, map: data });
            break;
        case OperationType.UPDATE:
            emit(EventTypes.MAP_MODIFIED, { mapId, map: data });
            break;
        case OperationType.DELETE:
            emit(EventTypes.MAP_DELETED, { mapId });
            break;
    }
}

/**
 * Applies a remote group operation.
 *
 * @param {string} opType - Operation type
 * @param {string} groupId - Group UUID
 * @param {string} mapId - Map UUID
 * @param {Object} data - Group data
 */
function applyRemoteGroupOp(opType, groupId, mapId, data) {
    switch (opType) {
        case OperationType.CREATE:
            emit(EventTypes.GROUP_CREATED, { groupId, mapId, group: data });
            break;
        case OperationType.UPDATE:
            emit(EventTypes.GROUP_MODIFIED, { groupId, mapId, group: data });
            break;
        case OperationType.DELETE:
            emit(EventTypes.GROUP_DELETED, { groupId, mapId });
            break;
    }

    emit(EventTypes.GROUPS_CHANGED, {});
}

/**
 * Applies a remote briefing operation.
 *
 * @param {string} opType - Operation type
 * @param {string} briefingId - Briefing UUID
 * @param {Object} data - Briefing data
 */
async function applyRemoteBriefingOp(opType, briefingId, data) {
    switch (opType) {
        case OperationType.CREATE:
        case OperationType.UPDATE: {
            if (data) {
                await localRepository.saveBriefing(briefingId, data);
            }
            const eventType = opType === OperationType.CREATE
                ? EventTypes.BRIEFING_CREATED
                : EventTypes.BRIEFING_UPDATED;
            emit(eventType, { briefingId, briefing: data });
            break;
        }
        case OperationType.DELETE:
            await localRepository.deleteBriefing(briefingId);
            emit(EventTypes.BRIEFING_DELETED, { briefingId });
            break;
    }
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Emits an event if EventBus is available.
 *
 * @param {string} eventType
 * @param {Object} payload
 */
function emit(eventType, payload) {
    if (_eventBus) {
        _eventBus.emit(eventType, payload);
    }
}

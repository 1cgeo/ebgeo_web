// Path: js/store/sync/operation-dispatcher.js

/**
 * @fileoverview Operation dispatcher for sync system.
 * Coordinates logging of operations to the queue.
 * Operations are queued but not sent anywhere yet - ready for future backend.
 */

import { createOperation, createBatchOperations } from './operation-factory.js';
import { operationQueue } from './operation-queue.js';
import { EntityType, OperationType } from './operation-types.js';

/**
 * Whether operation logging is enabled.
 * Disabled by default - enable when ready to start queuing operations.
 * @type {boolean}
 */
let enabled = false;

/**
 * Enables operation logging.
 */
export function enableOperationLogging() {
    enabled = true;
}

/**
 * Disables operation logging.
 */
export function disableOperationLogging() {
    enabled = false;
}

/**
 * Checks if operation logging is enabled.
 * @returns {boolean} True if enabled
 */
export function isOperationLoggingEnabled() {
    return enabled;
}

/**
 * Logs a single operation to the queue.
 *
 * @param {string} entityType - Type of entity (from EntityType)
 * @param {string} operationType - Operation type (from OperationType)
 * @param {string} entityId - ID of the affected entity
 * @param {string|null} mapId - Map context (null for atlas-level operations)
 * @param {Object|null} data - New/updated data
 * @param {Object|null} previousData - Previous data for undo support
 * @returns {Promise<void>}
 */
export async function logOperation(entityType, operationType, entityId, mapId, data = null, previousData = null) {
    if (!enabled) return;

    try {
        const operation = createOperation(entityType, operationType, entityId, mapId, data, previousData);
        await operationQueue.enqueue(operation);
    } catch (error) {
        console.warn('Failed to log operation:', error);
    }
}

/**
 * Logs multiple operations as a batch.
 *
 * @param {Array<{entityType: string, operationType: string, entityId: string, mapId?: string, data?: Object, previousData?: Object}>} operations - Operations to log
 * @returns {Promise<void>}
 */
export async function logBatchOperations(operations) {
    if (!enabled) return;

    try {
        const created = createBatchOperations(operations);
        await operationQueue.enqueueAll(created);
    } catch (error) {
        console.warn('Failed to log batch operations:', error);
    }
}

// ===== CONVENIENCE METHODS =====
// These provide type-safe helpers for common operations

/**
 * Logs a feature operation.
 * @param {string} opType - Operation type
 * @param {string} featureId - Feature ID
 * @param {string} mapId - Map ID
 * @param {Object|null} data - Feature data
 * @param {Object|null} previousData - Previous feature data
 */
export async function logFeatureOperation(opType, featureId, mapId, data = null, previousData = null) {
    await logOperation(EntityType.FEATURE, opType, featureId, mapId, data, previousData);
}

/**
 * Logs a layer operation.
 * @param {string} opType - Operation type
 * @param {string} layerId - Layer ID
 * @param {string} mapId - Map ID
 * @param {Object|null} data - Layer data
 * @param {Object|null} previousData - Previous layer data
 */
export async function logLayerOperation(opType, layerId, mapId, data = null, previousData = null) {
    await logOperation(EntityType.LAYER, opType, layerId, mapId, data, previousData);
}

/**
 * Logs a group operation.
 * @param {string} opType - Operation type
 * @param {string} groupId - Group ID
 * @param {string} mapId - Map ID
 * @param {Object|null} data - Group data
 * @param {Object|null} previousData - Previous group data
 */
export async function logGroupOperation(opType, groupId, mapId, data = null, previousData = null) {
    await logOperation(EntityType.GROUP, opType, groupId, mapId, data, previousData);
}

/**
 * Logs a map operation.
 * @param {string} opType - Operation type
 * @param {string} mapId - Map ID
 * @param {Object|null} data - Map data
 * @param {Object|null} previousData - Previous map data
 */
export async function logMapOperation(opType, mapId, data = null, previousData = null) {
    await logOperation(EntityType.MAP, opType, mapId, null, data, previousData);
}

/**
 * Logs a 3D marker operation.
 * @param {string} opType - Operation type
 * @param {string} markerId - Marker ID
 * @param {string} mapId - Map ID
 * @param {Object|null} data - Marker data
 * @param {Object|null} previousData - Previous marker data
 */
export async function logMarker3dOperation(opType, markerId, mapId, data = null, previousData = null) {
    await logOperation(EntityType.MARKER_3D, opType, markerId, mapId, data, previousData);
}

/**
 * Logs a 3D measurement operation.
 * @param {string} opType - Operation type
 * @param {string} measurementId - Measurement ID
 * @param {string} mapId - Map ID
 * @param {Object|null} data - Measurement data
 * @param {Object|null} previousData - Previous measurement data
 */
export async function logMeasurement3dOperation(opType, measurementId, mapId, data = null, previousData = null) {
    await logOperation(EntityType.MEASUREMENT_3D, opType, measurementId, mapId, data, previousData);
}

/**
 * Logs a 3D viewshed operation.
 * @param {string} opType - Operation type
 * @param {string} viewshedId - Viewshed ID
 * @param {string} mapId - Map ID
 * @param {Object|null} data - Viewshed data
 * @param {Object|null} previousData - Previous viewshed data
 */
export async function logViewshed3dOperation(opType, viewshedId, mapId, data = null, previousData = null) {
    await logOperation(EntityType.VIEWSHED_3D, opType, viewshedId, mapId, data, previousData);
}

/**
 * Logs a 360 orientation operation.
 * @param {string} opType - Operation type
 * @param {string} orientationId - Orientation ID
 * @param {string} mapId - Map ID
 * @param {Object|null} data - Orientation data
 * @param {Object|null} previousData - Previous orientation data
 */
export async function logOrientation360Operation(opType, orientationId, mapId, data = null, previousData = null) {
    await logOperation(EntityType.ORIENTATION_360, opType, orientationId, mapId, data, previousData);
}

/**
 * Logs a 360 marker operation.
 * @param {string} opType - Operation type
 * @param {string} markerId - Marker ID
 * @param {string} mapId - Map ID
 * @param {Object|null} data - Marker data
 * @param {Object|null} previousData - Previous marker data
 */
export async function logMarker360Operation(opType, markerId, mapId, data = null, previousData = null) {
    await logOperation(EntityType.MARKER_360, opType, markerId, mapId, data, previousData);
}

/**
 * Logs a briefing operation.
 * @param {string} opType - Operation type
 * @param {string} briefingId - Briefing ID
 * @param {Object|null} data - Briefing data
 * @param {Object|null} previousData - Previous briefing data
 */
export async function logBriefingOperation(opType, briefingId, data = null, previousData = null) {
    await logOperation(EntityType.BRIEFING, opType, briefingId, null, data, previousData);
}

// Re-export types and queue for external access
export { EntityType, OperationType };
export { operationQueue };

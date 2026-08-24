// Path: js/store/group.operations.js

/**
 * @fileoverview Group operations.
 * Delegates to GroupManager for actual implementation.
 */

import { isCurrentMapLockedSync } from './map.operations.js';
import { checkPermission, GuardAction } from './sync/permission-guard.js';
import { emitStoreError, StoreErrorEvents } from './store-errors.js';

// ===== DEPENDENCY INJECTION =====

/** @type {import('./store.types.js').StoreDependencies} */
const deps = {
    eventBus: null,
    groupManager: null,
    layerManager: null
};

/**
 * Sets dependencies for group operations.
 *
 * @param {import('./store.types.js').StoreDependencies} dependencies
 */
export function setGroupDependencies(dependencies) {
    Object.assign(deps, dependencies);
}

// ===== GUARD HELPER =====

/**
 * Checks permission and map lock before a mutating operation.
 *
 * @param {string} action - GuardAction constant
 * @param {string} operation - Operation name for error reporting
 * @returns {{ blocked: boolean }} Whether the operation is blocked
 */
function guardMutation(action, operation) {
    const perm = checkPermission(action);
    if (!perm.allowed) {
        emitStoreError(StoreErrorEvents.STORE_OPERATION_BLOCKED, { operation, reason: perm.reason, required: perm.required });
        return { blocked: true };
    }

    if (isCurrentMapLockedSync()) {
        console.warn(`Map is locked. Cannot ${operation}.`);
        return { blocked: true };
    }

    return { blocked: false };
}

// ===== CREATE OPERATIONS =====

/**
 * Creates a group from features.
 *
 * @param {Array} features - Features to group
 * @param {string} [mapName=null] - Map name
 * @returns {import('./store.types.js').Group|null} Created group
 */
export function createGroup(features, mapName = null) {
    if (guardMutation(GuardAction.CREATE_GROUP, 'createGroup').blocked) return null;
    return deps.groupManager.createGroup(features, mapName);
}

/**
 * Combines multiple groups into one.
 *
 * @param {string[]} groupIds - Group IDs to combine
 * @param {Array} [selectedFeatures=[]] - Additional selected features
 * @param {string} [mapName=null] - Map name
 * @returns {import('./store.types.js').Group|null} Combined group
 */
export function combineGroups(groupIds, selectedFeatures = [], mapName = null) {
    if (guardMutation(GuardAction.UPDATE_GROUP, 'combineGroups').blocked) return null;
    return deps.groupManager.combineGroups(groupIds, selectedFeatures, mapName);
}

// ===== READ OPERATIONS =====

/**
 * Gets all groups for a map.
 *
 * @param {string} [mapName=null] - Map name
 * @returns {Object<string, import('./store.types.js').Group>} Groups keyed by group id. NOT an
 *   array and NOT a Map: it is `memoryStore.groups[mapName]`, a plain object. The old JSDoc said
 *   "Array of groups", and the exporter believed a third thing (`v?.size`, i.e. a Map), which is
 *   how every group was silently dropped from the .ebgeo.
 */
export function getMapGroups(mapName = null) {
    return deps.groupManager.getMapGroups(mapName);
}

/**
 * Gets a group by ID.
 *
 * @param {string} groupId - Group ID
 * @param {string} [mapName=null] - Map name
 * @returns {import('./store.types.js').Group|null} Group or null
 */
export function getGroupById(groupId, mapName = null) {
    return deps.groupManager.getGroupById(groupId, mapName);
}

/**
 * Gets the group a feature belongs to.
 *
 * @param {string} type - Feature type
 * @param {string} featureId - Feature ID
 * @param {string} [mapName=null] - Map name
 * @returns {import('./store.types.js').Group|null} Group or null
 */
export function getFeatureGroup(type, featureId, mapName = null) {
    return deps.groupManager.getFeatureGroup(type, featureId, mapName);
}

/**
 * Gets all features in a group.
 *
 * @param {string} groupId - Group ID
 * @param {string} [mapName=null] - Map name
 * @returns {Array} Array of feature references
 */
export function getGroupFeatures(groupId, mapName = null) {
    return deps.groupManager.getGroupFeatures(groupId, mapName);
}

/**
 * Checks if a feature is in a group.
 *
 * @param {string} type - Feature type
 * @param {string} featureId - Feature ID
 * @param {string} [mapName=null] - Map name
 * @returns {boolean} True if feature is grouped
 */
export function isFeatureGrouped(type, featureId, mapName = null) {
    return deps.groupManager.isFeatureGrouped(type, featureId, mapName);
}

// ===== UPDATE OPERATIONS =====

/**
 * Updates a group property.
 *
 * @param {string} groupId - Group ID
 * @param {string} property - Property name
 * @param {*} value - New value
 * @param {string} [mapName=null] - Map name
 * @returns {boolean} Whether update was successful
 */
export function updateGroupProperty(groupId, property, value, mapName = null) {
    if (guardMutation(GuardAction.UPDATE_GROUP, 'updateGroupProperty').blocked) return false;
    return deps.groupManager.updateGroupProperty(groupId, property, value, mapName);
}

// ===== DELETE OPERATIONS =====

/**
 * Ungroups features from a group.
 *
 * @param {string} groupId - Group ID
 * @param {string} [mapName=null] - Map name
 * @returns {boolean} Whether ungroup was successful
 */
export function ungroupFeatures(groupId, mapName = null) {
    if (guardMutation(GuardAction.DELETE_GROUP, 'ungroupFeatures').blocked) return false;
    return deps.groupManager.ungroupFeatures(groupId, mapName);
}

/**
 * Removes a feature from all groups.
 *
 * @param {string} type - Feature type
 * @param {string} featureId - Feature ID
 * @param {string} [mapName=null] - Map name
 * @returns {boolean} Whether removal was successful
 */
export function removeFeatureFromAllGroups(type, featureId, mapName = null) {
    return deps.groupManager.removeFeatureFromAllGroups(type, featureId, mapName);
}

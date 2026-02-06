// Path: js/store/group.operations.js

/**
 * @fileoverview Group operations.
 * Delegates to GroupManager for actual implementation.
 */

import { isCurrentMapLockedSync } from './map.operations.js';

// ===== DEPENDENCY INJECTION =====

/**
 * Module-level dependencies
 * @type {import('./store.types.js').StoreDependencies}
 */
const deps = {
    eventBus: null,
    groupManager: null,
    layerManager: null
};

/**
 * Sets dependencies for group operations.
 *
 * @param {import('./store.types.js').StoreDependencies} dependencies - Dependencies object
 */
export function setGroupDependencies(dependencies) {
    Object.assign(deps, dependencies);
}

// ===== CREATE OPERATIONS =====

/**
 * Creates a group from features.
 *
 * @param {Array} features - Features to group
 * @param {string} [mapName=null] - Map name
 * @returns {import('./store.types.js').Group} Created group
 */
export const createGroup = (features, mapName = null) => {
    if (isCurrentMapLockedSync()) {
        console.warn('Map is locked. Cannot create group.');
        return null;
    }
    return deps.groupManager.createGroup(features, mapName);
};

/**
 * Combines multiple groups into one.
 *
 * @param {string[]} groupIds - Group IDs to combine
 * @param {Array} [selectedFeatures=[]] - Additional selected features
 * @param {string} [mapName=null] - Map name
 * @returns {import('./store.types.js').Group} Combined group
 */
export const combineGroups = (groupIds, selectedFeatures = [], mapName = null) => {
    if (isCurrentMapLockedSync()) {
        console.warn('Map is locked. Cannot combine groups.');
        return null;
    }
    return deps.groupManager.combineGroups(groupIds, selectedFeatures, mapName);
};

// ===== READ OPERATIONS =====

/**
 * Gets all groups for a map.
 *
 * @param {string} [mapName=null] - Map name
 * @returns {import('./store.types.js').Group[]} Array of groups
 */
export const getMapGroups = (mapName = null) => {
    return deps.groupManager.getMapGroups(mapName);
};

/**
 * Gets a group by ID.
 *
 * @param {string} groupId - Group ID
 * @param {string} [mapName=null] - Map name
 * @returns {import('./store.types.js').Group|null} Group or null
 */
export const getGroupById = (groupId, mapName = null) => {
    return deps.groupManager.getGroupById(groupId, mapName);
};

/**
 * Gets the group a feature belongs to.
 *
 * @param {string} type - Feature type
 * @param {string} featureId - Feature ID
 * @param {string} [mapName=null] - Map name
 * @returns {import('./store.types.js').Group|null} Group or null
 */
export const getFeatureGroup = (type, featureId, mapName = null) => {
    return deps.groupManager.getFeatureGroup(type, featureId, mapName);
};

/**
 * Gets all features in a group.
 *
 * @param {string} groupId - Group ID
 * @param {string} [mapName=null] - Map name
 * @returns {Array} Array of feature references
 */
export const getGroupFeatures = (groupId, mapName = null) => {
    return deps.groupManager.getGroupFeatures(groupId, mapName);
};

/**
 * Checks if a feature is in a group.
 *
 * @param {string} type - Feature type
 * @param {string} featureId - Feature ID
 * @param {string} [mapName=null] - Map name
 * @returns {boolean} True if feature is grouped
 */
export const isFeatureGrouped = (type, featureId, mapName = null) => {
    return deps.groupManager.isFeatureGrouped(type, featureId, mapName);
};

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
export const updateGroupProperty = (groupId, property, value, mapName = null) => {
    if (isCurrentMapLockedSync()) {
        console.warn('Map is locked. Cannot update group property.');
        return false;
    }
    return deps.groupManager.updateGroupProperty(groupId, property, value, mapName);
};

// ===== DELETE OPERATIONS =====

/**
 * Ungroups features from a group.
 *
 * @param {string} groupId - Group ID
 * @param {string} [mapName=null] - Map name
 * @returns {boolean} Whether ungroup was successful
 */
export const ungroupFeatures = (groupId, mapName = null) => {
    if (isCurrentMapLockedSync()) {
        console.warn('Map is locked. Cannot ungroup features.');
        return false;
    }
    return deps.groupManager.ungroupFeatures(groupId, mapName);
};

/**
 * Removes a feature from all groups.
 *
 * @param {string} type - Feature type
 * @param {string} featureId - Feature ID
 * @param {string} [mapName=null] - Map name
 * @returns {boolean} Whether removal was successful
 */
export const removeFeatureFromAllGroups = (type, featureId, mapName = null) => {
    return deps.groupManager.removeFeatureFromAllGroups(type, featureId, mapName);
};

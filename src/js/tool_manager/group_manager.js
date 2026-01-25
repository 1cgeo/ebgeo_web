// Path: js/tool_manager/group_manager.js

import { memoryStore, setMapGroups, getMapGroupsFromDB } from '../store';
import { IDUtils } from '../utilities';
import { EventTypes } from '../events';

/**
 * Central manager for feature groups
 * Maintains memory cache for synchronous queries and persists to IndexedDB
 */
class GroupManager {
    /**
     * @param {import('../events/event_bus.js').EventBus} eventBus - Event bus for notifications
     */
    constructor(eventBus) {
        this.memoryStore = memoryStore;
        this._eventBus = eventBus;
    }

    // ===== MAIN OPERATIONS =====

    /**
     * Create a new group with specified features
     * @param {Array} features - Array of features to be grouped
     * @param {string} mapName - Map name (null = current map)
     * @returns {Object} Created group
     */
    createGroup(features, mapName = null) {
        const targetMap = mapName || this.memoryStore.currentMap;

        const groupedFeatures = features.filter(feature =>
            this.isFeatureGrouped(feature.properties.source, feature.properties.id, targetMap)
        );

        if (groupedFeatures.length > 0) {
            throw new Error('Algumas features já estão agrupadas. Use "combinar grupos" em vez disso.');
        }

        if (features.length < 2) {
            throw new Error('É necessário pelo menos 2 features para criar um grupo.');
        }

        const groupId = IDUtils.generateUniqueId();
        const groupName = this.generateGroupName(targetMap);

        const newGroup = {
            id: groupId,
            name: groupName,
            features: features.map(feature => ({
                type: feature.properties.source,
                id: feature.properties.id
            })),
            visible: true,
            locked: false
        };

        this._ensureMapGroupsExist(targetMap);
        this.memoryStore.groups[targetMap].set(groupId, newGroup);

        this._saveGroupsToDBAsync(targetMap);

        this._notifyGroupsChanged();

        return newGroup;
    }

    /**
     * Combine existing groups and/or loose features into a new group
     * @param {Array} groupIds - IDs of groups to combine
     * @param {Array} selectedFeatures - Additional features to include
     * @param {string} mapName - Map name
     * @returns {Object} Combined group
     */
    combineGroups(groupIds, selectedFeatures = [], mapName = null) {
        const targetMap = mapName || this.memoryStore.currentMap;
        this._ensureMapGroupsExist(targetMap);

        const groupsCache = this.memoryStore.groups[targetMap];

        const allFeatures = [];
        let combinedGroupName = '';

        groupIds.forEach((groupId, index) => {
            const group = groupsCache.get(groupId);
            if (group) {
                allFeatures.push(...group.features);
                if (index === 0) {
                    combinedGroupName = group.name;
                }
            }
        });

        selectedFeatures.forEach(feature => {
            const isGrouped = this.isFeatureGrouped(
                feature.properties.source,
                feature.properties.id,
                targetMap
            );

            if (!isGrouped) {
                allFeatures.push({
                    type: feature.properties.source,
                    id: feature.properties.id
                });
            }
        });

        if (allFeatures.length < 2) {
            throw new Error('É necessário pelo menos 2 features para formar um grupo.');
        }

        const newGroupId = IDUtils.generateUniqueId();
        const finalGroupName = combinedGroupName || this.generateGroupName(targetMap);

        const combinedGroup = {
            id: newGroupId,
            name: finalGroupName,
            features: allFeatures,
            visible: true,
            locked: false
        };

        groupIds.forEach(groupId => {
            groupsCache.delete(groupId);
        });

        groupsCache.set(newGroupId, combinedGroup);

        this._saveGroupsToDBAsync(targetMap);

        this._notifyGroupsChanged();

        return combinedGroup;
    }

    /**
     * Ungroup features, leaving them loose
     * @param {string} groupId - ID of group to ungroup
     * @param {string} mapName - Map name
     * @returns {Array} Features that were in the group
     */
    ungroupFeatures(groupId, mapName = null) {
        const targetMap = mapName || this.memoryStore.currentMap;
        this._ensureMapGroupsExist(targetMap);

        const groupsCache = this.memoryStore.groups[targetMap];
        const group = groupsCache.get(groupId);

        if (!group) {
            throw new Error(`Grupo ${groupId} não encontrado.`);
        }

        const features = [...group.features];

        groupsCache.delete(groupId);

        this._saveGroupsToDBAsync(targetMap);

        this._notifyGroupsChanged();

        return features;
    }

    /**
     * Update group property (visibility, lock, etc.)
     */
    updateGroupProperty(groupId, property, value, mapName = null) {
        const targetMap = mapName || this.memoryStore.currentMap;
        this._ensureMapGroupsExist(targetMap);

        const groupsCache = this.memoryStore.groups[targetMap];
        const group = groupsCache.get(groupId);

        if (!group) {
            throw new Error(`Grupo ${groupId} não encontrado.`);
        }

        group[property] = value;

        this._saveGroupsToDBAsync(targetMap);

        return group;
    }

    // ===== SYNCHRONOUS QUERIES =====

    /**
     * Find the group containing a specific feature
     * @param {string} type - Feature type (source)
     * @param {string} featureId - Feature ID
     * @param {string} mapName - Map name
     * @returns {Object|null} Found group or null
     */
    getFeatureGroup(type, featureId, mapName = null) {
        const targetMap = mapName || this.memoryStore.currentMap;
        this._ensureMapGroupsExist(targetMap);

        const groupsCache = this.memoryStore.groups[targetMap];

        for (const group of groupsCache.values()) {
            const hasFeature = group.features.some(f =>
                f.type === type && f.id === featureId
            );

            if (hasFeature) {
                return group;
            }
        }

        return null;
    }

    /**
     * Check if a feature is in any group
     */
    isFeatureGrouped(type, featureId, mapName = null) {
        return this.getFeatureGroup(type, featureId, mapName) !== null;
    }

    /**
     * Return all groups of a map
     */
    getMapGroups(mapName = null) {
        const targetMap = mapName || this.memoryStore.currentMap;
        this._ensureMapGroupsExist(targetMap);

        return this.memoryStore.groups[targetMap];
    }

    /**
     * Return a specific group by ID
     */
    getGroupById(groupId, mapName = null) {
        const targetMap = mapName || this.memoryStore.currentMap;
        this._ensureMapGroupsExist(targetMap);

        return this.memoryStore.groups[targetMap].get(groupId);
    }

    /**
     * Return all features of a group
     */
    getGroupFeatures(groupId, mapName = null) {
        const group = this.getGroupById(groupId, mapName);
        return group ? group.features : [];
    }

    // ===== UTILITIES =====

    /**
     * Generate unique name for a group ("Grupo 1", "Grupo 2", etc.)
     */
    generateGroupName(mapName) {
        this._ensureMapGroupsExist(mapName);
        const groupsCache = this.memoryStore.groups[mapName];

        const existingNames = new Set();
        for (const group of groupsCache.values()) {
            existingNames.add(group.name);
        }

        let counter = 1;
        let groupName;

        do {
            groupName = `Grupo ${counter}`;
            counter++;
        } while (existingNames.has(groupName));

        return groupName;
    }

    /**
     * Load groups from IndexedDB to memory cache
     */
    async loadGroupsToMemory(mapName) {
        try {
            const groupsData = await getMapGroupsFromDB(mapName);

            const groupsMap = new Map();
            Object.entries(groupsData).forEach(([groupId, groupData]) => {
                groupsMap.set(groupId, groupData);
            });

            this.memoryStore.groups[mapName] = groupsMap;

        } catch (error) {
            console.warn(`Erro ao carregar grupos do mapa ${mapName}:`, error);
            this.memoryStore.groups[mapName] = new Map();
        }
    }

    /**
     * Duplicate groups from one map to another (for map copy)
     * @param {string} sourceMapName - Source map name
     * @param {string} targetMapName - Target map name
     * @param {Map} [featureIdMapping=null] - Mapping of old feature IDs to new feature IDs
     */
    async duplicateMapGroups(sourceMapName, targetMapName, featureIdMapping = null) {
        try {
            const sourceGroupsData = await getMapGroupsFromDB(sourceMapName);

            if (Object.keys(sourceGroupsData).length === 0) {
                return;
            }

            const duplicatedGroups = {};

            Object.values(sourceGroupsData).forEach(group => {
                const newGroupId = IDUtils.generateUniqueId();
                const newGroup = {
                    ...group,
                    id: newGroupId,
                };

                // Update feature IDs if mapping is provided
                if (featureIdMapping && group.features && Array.isArray(group.features)) {
                    newGroup.features = group.features.map(featureRef => {
                        const newFeatureId = featureIdMapping.get(featureRef.id);
                        return {
                            ...featureRef,
                            id: newFeatureId || featureRef.id
                        };
                    });
                }

                duplicatedGroups[newGroupId] = newGroup;
            });

            await setMapGroups(targetMapName, duplicatedGroups);

            if (targetMapName === this.memoryStore.currentMap) {
                const groupsMap = new Map();
                Object.entries(duplicatedGroups).forEach(([groupId, groupData]) => {
                    groupsMap.set(groupId, groupData);
                });
                this.memoryStore.groups[targetMapName] = groupsMap;
            }

        } catch (error) {
            console.error(`Erro ao duplicar grupos de ${sourceMapName} para ${targetMapName}:`, error);
        }
    }

    /**
     * Combine groups from multiple maps into a target map
     * @param {Array} sourceMapNames - Source map names
     * @param {string} targetMapName - Target map name
     * @param {Object} idMappings - ID mappings old -> new by map
     */
    async combineMapGroups(sourceMapNames, targetMapName, idMappings = {}) {
        try {
            const targetGroups = await getMapGroupsFromDB(targetMapName);
            const existingNames = new Set(
                Object.values(targetGroups).map(group => group.name)
            );

            for (const sourceMapName of sourceMapNames) {
                const sourceGroups = await getMapGroupsFromDB(sourceMapName);

                const mapIdMapping = idMappings[sourceMapName] || new Map();

                const updatedGroups = this._updateGroupFeatureIds(sourceGroups, mapIdMapping);

                Object.values(updatedGroups).forEach(group => {
                    const newGroupId = IDUtils.generateUniqueId();

                    let finalName = group.name;
                    let counter = 1;
                    while (existingNames.has(finalName)) {
                        finalName = `${group.name}_${counter}`;
                        counter++;
                    }
                    existingNames.add(finalName);

                    targetGroups[newGroupId] = {
                        ...group,
                        id: newGroupId,
                        name: finalName
                    };
                });
            }

            await setMapGroups(targetMapName, targetGroups);

            if (targetMapName === this.memoryStore.currentMap) {
                await this.loadGroupsToMemory(targetMapName);
            }

        } catch (error) {
            console.error(`Erro ao combinar grupos em ${targetMapName}:`, error);
        }
    }

    /**
     * Remove all groups from a map
     */
    async clearMapGroups(mapName) {
        try {
            await setMapGroups(mapName, {});

            if (this.memoryStore.groups[mapName]) {
                this.memoryStore.groups[mapName].clear();
            }

        } catch (error) {
            console.error(`Erro ao limpar grupos do mapa ${mapName}:`, error);
        }
    }

    /**
     * Remove feature from all groups (when feature is deleted)
     */
    removeFeatureFromAllGroups(type, featureId, mapName = null) {
        const targetMap = mapName || this.memoryStore.currentMap;
        this._ensureMapGroupsExist(targetMap);

        const groupsCache = this.memoryStore.groups[targetMap];
        let modified = false;

        for (const [groupId, group] of groupsCache) {
            const initialLength = group.features.length;
            group.features = group.features.filter(f =>
                !(f.type === type && f.id === featureId)
            );

            if (group.features.length <= 1) {
                groupsCache.delete(groupId);
                modified = true;
            } else if (group.features.length < initialLength) {
                modified = true;
            }
        }

        if (modified) {
            this._saveGroupsToDBAsync(targetMap);
        }
    }

    // ===== PRIVATE METHODS =====

    /**
     * Emit groups changed event via EventBus
     * @private
     */
    _notifyGroupsChanged() {
        this._eventBus.emit(EventTypes.GROUPS_CHANGED, {
            mapName: this.memoryStore.currentMap
        });
    }

    /**
     * Ensure group cache exists for a map
     */
    _ensureMapGroupsExist(mapName) {
        if (!this.memoryStore.groups[mapName]) {
            this.memoryStore.groups[mapName] = new Map();
        }
    }

    /**
     * Save groups to IndexedDB in background
     */
    _saveGroupsToDBAsync(mapName) {
        setTimeout(async () => {
            try {
                const groupsCache = this.memoryStore.groups[mapName];
                const groupsData = Object.fromEntries(groupsCache);
                await setMapGroups(mapName, groupsData);
            } catch (error) {
                console.error(`Erro ao salvar grupos do mapa ${mapName}:`, error);
            }
        }, 0);
    }

    /**
     * Update feature IDs within groups after regeneration
     * @param {Object} groups - Groups with old IDs
     * @param {Map} idMapping - Mapping oldId -> newId
     * @returns {Object} Groups with updated IDs
     */
    _updateGroupFeatureIds(groups, idMapping) {
        const updatedGroups = {};

        Object.entries(groups).forEach(([groupId, group]) => {
            updatedGroups[groupId] = {
                ...group,
                features: group.features.map(featureRef => {
                    const newId = idMapping.get(featureRef.id);
                    return {
                        type: featureRef.type,
                        id: newId || featureRef.id
                    };
                })
            };
        });

        return updatedGroups;
    }
}

/**
 * Factory function to create GroupManager instance.
 * @param {import('../events/event_bus.js').EventBus} eventBus - Event bus for notifications
 * @returns {GroupManager} New GroupManager instance
 */
export function createGroupManager(eventBus) {
    return new GroupManager(eventBus);
}

/**
 * Module-level instance holder for backward compatibility.
 * Set by services.js after initialization.
 * @type {{instance: GroupManager|null}}
 */
export const groupManagerHolder = { instance: null };

/**
 * Proxy for backward compatibility with default import.
 * Delegates all property access/calls to the initialized instance.
 * @type {GroupManager}
 */
const groupManagerProxy = new Proxy({}, {
    get(target, prop) {
        if (!groupManagerHolder.instance) {
            throw new Error('GroupManager not initialized. Ensure initServices() is called first.');
        }
        const value = groupManagerHolder.instance[prop];
        // Bind methods to the instance
        return typeof value === 'function' ? value.bind(groupManagerHolder.instance) : value;
    },
    set(target, prop, value) {
        if (!groupManagerHolder.instance) {
            throw new Error('GroupManager not initialized. Ensure initServices() is called first.');
        }
        groupManagerHolder.instance[prop] = value;
        return true;
    }
});

export default groupManagerProxy;
export { GroupManager };

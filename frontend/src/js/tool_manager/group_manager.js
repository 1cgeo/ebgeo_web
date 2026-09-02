// Path: js/tool_manager/group_manager.js

import { memoryStore, setMapGroups, getMapGroupsFromDB } from '../store';
import { generateUUID } from '../utilities/uuid.js';
import { EventTypes } from '../events';
import { createSyncMetadata, touchSyncMetadata, markDeleted, isActive } from '../store/sync/sync-metadata.js';
import { logGroupOperation, logGroupFeatureOperation, OperationType } from '../store/sync/index.js';
import { mapResolver } from '../store/services/map-resolver.service.js';

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

        const groupId = generateUUID();
        const groupName = this.generateGroupName(targetMap);

        const newGroup = {
            id: groupId,
            name: groupName,
            features: features.map(feature => ({
                type: feature.properties.source,
                id: feature.properties.id
            })),
            visible: true,
            locked: false,
            sync: createSyncMetadata(null)
        };

        this._ensureMapGroupsExist(targetMap);
        this.memoryStore.groups[targetMap][groupId] = newGroup;

        this._saveGroupsToDBAsync(targetMap);

        this._notifyGroupsChanged();

        // Log operation for sync
        // Tag the sync op with the map's UUID (not its name) — a non-UUID map id would be
        // rejected by the backend and POISON A's whole flush batch (every op queued after
        // it would never reach peers), the same flush-poison class as feature/layer/temporal.
        const mapId = mapResolver.resolveToId(targetMap);
        logGroupOperation(OperationType.CREATE, groupId, mapId, newGroup);
        // The members list is NOT part of the `group` row: `data.features` is dropped by the
        // server's group insert, so membership has to travel as its own ops, AFTER the group
        // exists (the join insert is gated on the group row being there).
        for (const member of newGroup.features) {
            logGroupFeatureOperation(OperationType.CREATE, groupId, member.id, member.type, mapId);
        }

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
            const group = groupsCache[groupId];
            if (group && isActive(group.sync)) {
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

        const newGroupId = generateUUID();
        const finalGroupName = combinedGroupName || this.generateGroupName(targetMap);

        const combinedGroup = {
            id: newGroupId,
            name: finalGroupName,
            features: allFeatures,
            visible: true,
            locked: false,
            sync: createSyncMetadata(null)
        };

        // Soft delete old groups and log deletions
        groupIds.forEach(groupId => {
            if (groupsCache[groupId]) {
                const oldGroup = { ...groupsCache[groupId] };
                groupsCache[groupId].sync = markDeleted(groupsCache[groupId].sync);
                // Log delete operation for old group
                logGroupOperation(OperationType.DELETE, groupId, mapResolver.resolveToId(targetMap), null, oldGroup);
            }
        });

        groupsCache[newGroupId] = combinedGroup;

        this._saveGroupsToDBAsync(targetMap);

        this._notifyGroupsChanged();

        // Log create operation for the combined group
        const combinedMapId = mapResolver.resolveToId(targetMap);
        logGroupOperation(OperationType.CREATE, newGroupId, combinedMapId, combinedGroup);
        // Membership of the NEW group (see createGroup). The old groups' rows are left alone:
        // they are soft-deleted above, so they no longer surface in any snapshot.
        for (const member of combinedGroup.features) {
            logGroupFeatureOperation(OperationType.CREATE, newGroupId, member.id, member.type, combinedMapId);
        }

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
        const group = groupsCache[groupId];

        if (!group || !isActive(group.sync)) {
            throw new Error(`Grupo ${groupId} não encontrado.`);
        }

        const features = [...group.features];

        // Capture old state for logging
        const oldGroup = { ...group };

        // Soft delete the group
        group.sync = markDeleted(group.sync);

        this._saveGroupsToDBAsync(targetMap);

        this._notifyGroupsChanged();

        // Log operation for sync
        logGroupOperation(OperationType.DELETE, groupId, mapResolver.resolveToId(targetMap), null, oldGroup);

        return features;
    }

    /**
     * Update group property (visibility, lock, etc.)
     */
    updateGroupProperty(groupId, property, value, mapName = null) {
        const targetMap = mapName || this.memoryStore.currentMap;
        this._ensureMapGroupsExist(targetMap);

        const groupsCache = this.memoryStore.groups[targetMap];
        const group = groupsCache[groupId];

        if (!group || !isActive(group.sync)) {
            throw new Error(`Grupo ${groupId} não encontrado.`);
        }

        // Capture old state for logging
        const oldGroup = { ...group };

        group[property] = value;
        group.sync = touchSyncMetadata(group.sync);

        this._saveGroupsToDBAsync(targetMap);

        // Log operation for sync
        logGroupOperation(OperationType.UPDATE, groupId, mapResolver.resolveToId(targetMap), group, oldGroup);

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

        for (const group of Object.values(groupsCache)) {
            // Only check active groups
            if (!isActive(group.sync)) continue;

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

        const group = this.memoryStore.groups[targetMap][groupId];
        return group && isActive(group.sync) ? group : null;
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
        for (const group of Object.values(groupsCache)) {
            if (isActive(group.sync)) {
                existingNames.add(group.name);
            }
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

            // Ensure all groups have sync metadata (migration support)
            const normalizedGroups = {};
            for (const [groupId, groupData] of Object.entries(groupsData)) {
                normalizedGroups[groupId] = {
                    ...groupData,
                    sync: groupData.sync || createSyncMetadata(null)
                };
            }

            this.memoryStore.groups[mapName] = normalizedGroups;

        } catch (error) {
            console.warn(`Erro ao carregar grupos do mapa ${mapName}:`, error);
            this.memoryStore.groups[mapName] = {};
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

            // Only include active groups
            const activeGroups = Object.values(sourceGroupsData).filter(g => isActive(g.sync));

            if (activeGroups.length === 0) {
                return;
            }

            const duplicatedGroups = {};

            activeGroups.forEach(group => {
                const newGroupId = generateUUID();
                const newGroup = {
                    ...group,
                    id: newGroupId,
                    sync: createSyncMetadata(null)
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
                this.memoryStore.groups[targetMapName] = duplicatedGroups;
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
                Object.values(targetGroups)
                    .filter(g => isActive(g.sync))
                    .map(group => group.name)
            );

            for (const sourceMapName of sourceMapNames) {
                const sourceGroups = await getMapGroupsFromDB(sourceMapName);

                const mapIdMapping = idMappings[sourceMapName] || new Map();

                // Only include active groups
                const activeSourceGroups = {};
                for (const [id, group] of Object.entries(sourceGroups)) {
                    if (isActive(group.sync)) {
                        activeSourceGroups[id] = group;
                    }
                }

                const updatedGroups = this._updateGroupFeatureIds(activeSourceGroups, mapIdMapping);

                Object.values(updatedGroups).forEach(group => {
                    const newGroupId = generateUUID();

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
                        name: finalName,
                        sync: createSyncMetadata(null)
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
                this.memoryStore.groups[mapName] = {};
            }

        } catch (error) {
            console.error(`Erro ao limpar grupos do mapa ${mapName}:`, error);
        }
    }

    /**
     * Import groups into a map from external data.
     * Replaces existing groups if `replace` is true; otherwise merges.
     * Syncs memory cache for the current map and persists to IndexedDB.
     *
     * @param {string} mapName - Target map name
     * @param {Object} groupsData - Plain object keyed by group ID
     * @param {Object} [options] - Import options
     * @param {boolean} [options.replace=false] - Replace all groups instead of merging
     */
    async importMapGroups(mapName, groupsData, options = {}) {
        const { replace = false } = options;

        this._ensureMapGroupsExist(mapName);

        if (replace) {
            this.memoryStore.groups[mapName] = {};
        }

        const cache = this.memoryStore.groups[mapName];
        for (const [groupId, groupData] of Object.entries(groupsData)) {
            cache[groupId] = groupData;
        }

        this._saveGroupsToDBAsync(mapName);
    }

    /**
     * Remove a feature from every group of a map, and SYNC that removal.
     *
     * Called from the delete/move paths (feature delete, move to another map, layer
     * transfer), all of which run it inside a `tx.deferSync`. The op loggers are
     * fire-and-forget there, exactly as in {@link updateGroupProperty}: `logOperation`
     * swallows and reports its own failures, so nothing rejects into the transaction.
     *
     * TWO ops per affected group, because they say different things to the server:
     *  - `group_feature` DELETE removes the join row, which is the ONLY place the server
     *    keeps membership (a `group` update never touches it, see
     *    {@link logGroupFeatureOperation});
     *  - `group` DELETE, when the group drops to one member or none, mirrors the
     *    soft-delete this function already did locally. Without it the peer and the server
     *    kept a group this client had already dissolved.
     *
     * Idempotent by construction: a group that did not hold the feature is skipped whole,
     * so it logs nothing. That skip also FIXED a live hazard rather than just adding one:
     * the previous code soft-deleted every active group with one member or none on ANY
     * call, related or not, and once that soft-delete became a synced op it would have
     * dissolved a peer's unrelated group as a side effect of deleting some other feature.
     *
     * @param {string} type - Feature source type
     * @param {string} featureId - Feature ID
     * @param {string} [mapName=null] - Map name (null = current map)
     */
    removeFeatureFromAllGroups(type, featureId, mapName = null) {
        const targetMap = mapName || this.memoryStore.currentMap;
        this._ensureMapGroupsExist(targetMap);

        const groupsCache = this.memoryStore.groups[targetMap];
        // Resolved once: same NAME->UUID rule as every other op logged here (a raw map name
        // would be dropped pre-flush, or poison the batch if it reached the server).
        const mapId = mapResolver.resolveToId(targetMap);
        let modified = false;

        for (const group of Object.values(groupsCache)) {
            // Skip deleted groups
            if (!isActive(group.sync)) continue;

            // Held BEFORE the filter, because `filter` returns a NEW array and the previous
            // one is what `previousData` has to carry: a shallow copy taken after the
            // reassignment would ship the already-reduced list as the "previous" state, i.e.
            // an undo payload missing the very member that was removed.
            const previousFeatures = group.features;
            const remaining = previousFeatures.filter(f =>
                !(f.type === type && f.id === featureId)
            );
            // This group did not hold the feature: nothing changed, nothing to log.
            if (remaining.length === previousFeatures.length) continue;
            group.features = remaining;

            logGroupFeatureOperation(OperationType.DELETE, group.id, featureId, type, mapId);

            if (remaining.length <= 1) {
                // Soft delete the group if only 0-1 features left. `group.sync` is still the
                // pre-delete metadata at this point, so the copy is the whole prior document.
                const oldGroup = { ...group, features: previousFeatures };
                group.sync = markDeleted(group.sync);
                logGroupOperation(OperationType.DELETE, group.id, mapId, null, oldGroup);
            } else {
                // Update sync metadata if features were removed
                group.sync = touchSyncMetadata(group.sync);
            }
            modified = true;
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
            this.memoryStore.groups[mapName] = {};
        }
    }

    /**
     * Save groups to IndexedDB in background
     */
    _saveGroupsToDBAsync(mapName) {
        setTimeout(async () => {
            try {
                const groupsCache = this.memoryStore.groups[mapName];
                await setMapGroups(mapName, groupsCache);
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

export { GroupManager };

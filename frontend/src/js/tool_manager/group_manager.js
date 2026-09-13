// Path: js/tool_manager/group_manager.js

import { memoryStore, setMapGroups, getMapGroupsFromDB } from '../store';
import { generateUUID } from '../utilities/uuid.js';
import { EventTypes } from '../events';
import { createSyncMetadata, touchSyncMetadata, markDeleted, isActive } from '../store/sync/sync-metadata.js';
import { logGroupOperation, logGroupFeatureOperation } from '../store/sync/index.js';
// The leaf module, never the `sync/index.js` barrel: five store suites mock that barrel
// without `EntityType`, so reaching for it there breaks them at load time.
import { EntityType, OperationType } from '../store/sync/operation-types.js';
import { runTransaction } from '../store/store-transaction.js';
import { withSideDocument } from '../store/document-lock.js';
import { mapResolver } from '../store/services/map-resolver.service.js';

/**
 * Resolves the target map, defaulting to the current one.
 * @param {GroupManager} manager - The manager whose memory store holds the current map
 * @param {string|null} mapName - Explicit map name or null for current
 * @returns {string} Resolved map name
 */
function targetMapOf(manager, mapName) {
    return mapName || manager.memoryStore.currentMap;
}

/**
 * Returns the live, non-deleted group, or throws.
 *
 * It runs INSIDE the critical section on purpose: a group read before the lock may have been
 * dissolved by the writer ahead in the queue, and editing it would resurrect it.
 *
 * @param {Object} groupsCache - The map's groups cache
 * @param {string} groupId - Group ID
 * @returns {Object} The group
 */
function requireActiveGroup(groupsCache, groupId) {
    const group = groupsCache[groupId];
    if (!group || !isActive(group.sync)) {
        throw new Error(`Grupo ${groupId} não encontrado.`);
    }
    return group;
}

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
     * Create a new group with specified features.
     *
     * ASYNC since 2026-09-13 (write-ahead, bloco B4). It declares 1 + N intentions in ONE
     * transaction: the `group` CREATE and one `group_feature` CREATE per member, in that ORDER.
     * The order is not cosmetic and is not luck either. The server gates the membership insert on
     * an EXISTS over the groups table, so a `group_feature` that arrives ahead of its group writes
     * ZERO rows and comes back acked as a success; and the queue key carries the Lamport sequence
     * (`op_{timestamp}_{sequencia}_{id}`), which is minted in `recordOperation` order, so the
     * insertion order here IS the order the server applies.
     *
     * THE MEMBERSHIP OP CARRIES A THROWAWAY UUID as its entity id, and both halves of that matter
     * (see `logGroupFeatureOperation` in `store/sync/operation-dispatcher.js`, which this
     * reproduces inline because the write-ahead path builds its own descriptions):
     * `operations.entity_id` is a UUID column, so a composite `<group>:<feature>` key is out; and
     * queue compaction groups by `scopeSuffix:entityType:entityId` keeping ONE op per group, so
     * reusing the GROUP id would collapse several membership changes into one and drop the rest.
     * The payload is `{group_id, feature_id, feature_type}`, the same shape the peer reads.
     *
     * The members list is NOT part of the `group` row: `UPDATE_FIELDS.group` (backend
     * `sync.service.js`) is name/visible/locked/style/parent_id, and `data.features` is dropped by
     * the insert, so membership has no channel other than its own ops.
     *
     * @param {Array} features - Array of features to be grouped
     * @param {string} [mapName=null] - Map name (null = current map)
     * @returns {Promise<Object>} Created group
     */
    async createGroup(features, mapName = null) {
        return this._writeGroups(targetMapOf(this, mapName), 'createGroup', () => {
            const targetMap = targetMapOf(this, mapName);
            // The two refusals run INSIDE the critical section, so they read the membership the
            // writer ahead in the queue left behind instead of a pre-lock snapshot.
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
            const newGroup = {
                id: groupId,
                name: this.generateGroupName(targetMap),
                features: features.map(feature => ({
                    type: feature.properties.source,
                    id: feature.properties.id
                })),
                visible: true,
                locked: false,
                sync: createSyncMetadata(null)
            };

            const operations = [{
                entityType: EntityType.GROUP,
                type: OperationType.CREATE,
                id: groupId,
                data: newGroup
            }];
            for (const member of newGroup.features) {
                operations.push({
                    entityType: EntityType.GROUP_FEATURE,
                    type: OperationType.CREATE,
                    id: generateUUID(),
                    data: { group_id: groupId, feature_id: member.id, feature_type: member.type }
                });
            }

            return {
                groups: { [groupId]: newGroup },
                operations,
                result: newGroup,
                effect: () => this._notifyGroupsChanged()
            };
        });
    }

    /**
     * Combine existing groups and/or loose features into a new group.
     *
     * STILL ON THE OLD PATH (memory first, `setTimeout(0)` write, logs without waiting), and it is
     * the wave after this one. Migrating it is NOT a copy of {@link createGroup}: it dissolves N
     * groups and creates one, so the transaction has to carry the N `group` DELETEs plus the
     * create plus one `group_feature` per member of the result, and a partial failure must leave
     * the old groups intact rather than dissolved into nothing.
     *
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
     * Ungroup features, leaving them loose.
     *
     * ASYNC since 2026-09-13 (write-ahead, bloco B4). Only the `group` DELETE travels: the
     * server soft-deletes the row and rebuilds membership from LIVE groups only, so one
     * `group_feature` delete per member would be work with no effect on either side.
     *
     * @param {string} groupId - ID of group to ungroup
     * @param {string} [mapName=null] - Map name (null = current map)
     * @returns {Promise<Array>} Features that were in the group
     */
    async ungroupFeatures(groupId, mapName = null) {
        return this._writeGroups(targetMapOf(this, mapName), 'ungroupFeatures', (groupsCache) => {
            const group = requireActiveGroup(groupsCache, groupId);
            const next = { ...group, sync: markDeleted(group.sync) };
            return {
                groups: { [groupId]: next },
                operations: [{
                    entityType: EntityType.GROUP,
                    type: OperationType.DELETE,
                    id: groupId,
                    data: null,
                    previous: { ...group }
                }],
                result: [...group.features],
                effect: () => this._notifyGroupsChanged()
            };
        });
    }

    /**
     * Update group property (visibility, lock, etc.).
     *
     * ASYNC since 2026-09-13 (write-ahead, bloco B4). It does NOT emit GROUPS_CHANGED, as
     * before: the caller owns the visual state of the row it just toggled.
     *
     * @param {string} groupId - Group ID
     * @param {string} property - Property name
     * @param {*} value - New value
     * @param {string} [mapName=null] - Map name (null = current map)
     * @returns {Promise<Object>} The updated group
     */
    async updateGroupProperty(groupId, property, value, mapName = null) {
        return this._writeGroups(targetMapOf(this, mapName), 'updateGroupProperty', (groupsCache) => {
            const group = requireActiveGroup(groupsCache, groupId);
            const next = { ...group, [property]: value, sync: touchSyncMetadata(group.sync) };
            return {
                groups: { [groupId]: next },
                operations: [{
                    entityType: EntityType.GROUP,
                    type: OperationType.UPDATE,
                    id: groupId,
                    data: next,
                    previous: { ...group }
                }],
                result: next
            };
        });
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
     * Journals a group edit before the per-map groups document is written.
     *
     * The contract is the one `editCatalogLayers` established: the side-document lock
     * serializes writers, `prepare` reads the cache and builds the WHOLE edit,
     * `recordOperation` states the intention while the copy on disk is still the old one, and
     * the returned closure is the ONLY writer. The memory cache is updated in `tx.deferSync`,
     * so a write that fails leaves the cache agreeing with disk instead of showing an edit
     * that nothing persisted.
     *
     * This REPLACES `_saveGroupsToDBAsync` for the three migrated entries: a `setTimeout(0)`
     * whose `catch` only logged meant the edit was already on screen and in memory when the
     * write failed, with nobody told. The entries still on the old path are `combineGroups`,
     * `importMapGroups` and `removeFeatureFromAllGroups` (the last one runs inside its parent's
     * transaction and has to receive it instead of opening its own, which is why it is a wave of
     * its own and not a line of this one).
     *
     * The edited group is REPLACED, not mutated in place, which is what keeps the failed
     * write invisible. Read it back through `getMapGroups`/`getGroupById`, never through a
     * reference held across the await.
     *
     * @private
     * @param {string} targetMap - Resolved map name
     * @param {string} label - Operation label, for the deadlock report
     * @param {function(Object): (Object|null)} prepare - Receives the groups cache; returns
     *   `{ groups, operations, result, effect }` or null to abort with no write
     * @returns {Promise<*>} `edit.result`
     */
    async _writeGroups(targetMap, label, prepare) {
        let output;
        // Leaf read-modify-write of the per-map groups document; see store/document-lock.js.
        await withSideDocument('groups', targetMap, label, () => runTransaction(async (tx) => {
            this._ensureMapGroupsExist(targetMap);
            const groupsCache = this.memoryStore.groups[targetMap];
            const edit = prepare(groupsCache);
            if (!edit) return async () => {};
            // The map UUID, never the name: a non-UUID map id is rejected by the backend and
            // poisons the whole flush batch.
            const mapId = mapResolver.resolveToId(targetMap);
            for (const op of edit.operations) {
                tx.recordOperation(op.entityType, op.type, op.id, mapId, op.data ?? null, op.previous ?? null);
            }
            const document = { ...groupsCache, ...edit.groups };
            tx.deferSync(() => {
                Object.assign(this.memoryStore.groups[targetMap], edit.groups);
                edit.effect?.();
            });
            output = edit.result;
            return () => setMapGroups(targetMap, document);
        }));
        return output;
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

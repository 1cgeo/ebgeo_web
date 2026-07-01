// Path: js/store/store-state-manager.js

import { memoryStore } from './memory-store.js';
import {
    setSettingCompat as setAppSetting,
    getSettingCompat,
    getColorUsageCompat as getColorUsage,
    setColorUsageCompat as setColorUsage,
    removeColorUsageCompat as removeColorUsage,
    getAllMapKeysCompat as getAllMapNames,
    getMapDataCompat as getMapData,
    // Imported from repositories instead of settings.operations to avoid
    // a static store ↔ state-manager import cycle.
    deleteImageCompat as removeImage
} from './repositories/index.js';
import { getGroupManager } from './services.js';
import { mapResolver } from './services/map-resolver.service.js';
import { logOperation, EntityType, OperationType, sessionContext } from './sync/index.js';
import { LRUCache } from '../utilities/lru-cache.js';
import { IMAGE_RESOURCE_FEATURE_TYPES } from './store.constants.js';

/** @type {string[]} All feature properties that hold color values */
const COLOR_PROPERTIES = [
    'color',
    'fillColor',
    'lineColor',
    'outlinecolor',
    'backgroundColor',
    'hatchColor',
    'backgroundFillColor',
    'backgroundBorderColor'
];

/**
 * Adjusts a color count in a Map cache: increments or decrements,
 * removing the entry when it drops to zero or below.
 * @param {Map<string, number>} cache - Color count cache
 * @param {string} color - Color value
 * @param {number} delta - Amount to add (positive) or subtract (negative)
 */
function adjustColorCount(cache, color, delta) {
    const updated = (cache.get(color) || 0) + delta;
    if (updated <= 0) {
        cache.delete(color);
    } else {
        cache.set(color, updated);
    }
}

/**
 * Converts a plain object of color counts to a Map with numeric values.
 * @param {Object} colorData - { color: count } object
 * @returns {Map<string, number>}
 */
function colorDataToMap(colorData) {
    const map = new Map();
    for (const [color, count] of Object.entries(colorData)) {
        map.set(color, Number(count) || 0);
    }
    return map;
}

/**
 * Counts all colors across feature groups in map data.
 * @param {Object} mapData - Map data containing features
 * @returns {Map<string, number>} Color counts
 */
function countMapColors(mapData) {
    const colorCounts = new Map();

    for (const features of Object.values(mapData.features || {})) {
        if (!Array.isArray(features)) continue;

        for (const feature of features) {
            const props = feature.properties;
            if (!props) continue;

            for (const prop of COLOR_PROPERTIES) {
                if (props[prop] && typeof props[prop] === 'string') {
                    colorCounts.set(props[prop], (colorCounts.get(props[prop]) || 0) + 1);
                }
            }
        }
    }

    return colorCounts;
}

/**
 * In-memory state manager with undo/redo system and color tracking.
 * Manages map state, history, and integrates with group management.
 */
class MapManager {
    constructor() {
        this.memoryStore = memoryStore;
        this.projectColorCache = new LRUCache(200);
    }

    // ===== MEMORY STORE MANAGEMENT =====

    /**
     * Gets the current map name.
     * @returns {string} Current map name
     */
    getCurrentMapName() {
        return this.memoryStore.currentMap;
    }

    /**
     * Gets the current map UUID.
     * Falls back to the name if the resolver is not initialized.
     * @returns {string} Current map UUID
     */
    getCurrentMapId() {
        const mapName = this.memoryStore.currentMap;
        if (!mapName) return mapName;
        return mapResolver.resolveToId(mapName);
    }

    /**
     * Gets both the current map name and ID.
     * @returns {{name: string, id: string}}
     */
    getCurrentMapInfo() {
        const name = this.memoryStore.currentMap;
        const id = this.getCurrentMapId();
        return { name, id };
    }

    setCurrentMapName(mapName) {
        this.memoryStore.currentMap = mapName;

        if (!this.memoryStore.maps[mapName]) {
            this.memoryStore.maps[mapName] = {
                undoStacks: {},
                redoStacks: {}
            };
        }
    }

    async setCurrentMap(mapName) {
        const previousMap = this.memoryStore.currentMap;

        if (previousMap && previousMap !== mapName) {
            await this.saveColorUsageToDB(previousMap);
            this.clearHistory(previousMap);
        }

        this.setCurrentMapName(mapName);

        await this.loadColorUsageFromDB(mapName);
        await getGroupManager().loadGroupsToMemory(mapName);
        await setAppSetting('lastActiveMap', mapName);

        const locked = await getSettingCompat(`mapLocked_${mapName}`);
        if (locked) {
            this.memoryStore.lockedMaps.add(mapName);
        } else {
            this.memoryStore.lockedMaps.delete(mapName);
        }

        // Load temporal config into the sync cache for the active map.
        const temporalCfg = await getSettingCompat(`temporal_${mapName}`);
        if (temporalCfg) {
            this.memoryStore.temporalConfigs.set(mapName, temporalCfg);
        } else {
            this.memoryStore.temporalConfigs.delete(mapName);
        }

        logOperation(
            EntityType.SETTING,
            OperationType.UPDATE,
            'lastActiveMap',
            null,
            { value: mapName },
            { value: previousMap }
        );
    }

    // ===== COLOR TRACKING SYSTEM =====

    /**
     * Extracts the primary color from a feature.
     * @param {Object} feature - GeoJSON feature
     * @returns {string|null} Color value or null
     */
    getFeatureColor(feature) {
        const props = feature.properties;
        if (!props) return null;

        return props.color ||
               props.fillColor ||
               props.lineColor ||
               props.outlinecolor ||
               props.backgroundColor;
    }

    /**
     * Extracts ALL color properties from a feature.
     * @param {Object} feature - GeoJSON feature
     * @returns {string[]} Array of color values
     */
    getFeatureColors(feature) {
        const props = feature.properties;
        if (!props) return [];

        const colors = [];
        for (const prop of COLOR_PROPERTIES) {
            if (props[prop] && typeof props[prop] === 'string') {
                colors.push(props[prop]);
            }
        }

        return colors;
    }

    /**
     * Processes colors for a map (used in addMap).
     * @param {string} mapName - Map name
     * @param {Object} mapData - Map data
     * @param {Object} colorUsageData - Optional pre-calculated color usage
     */
    async processMapColors(mapName, mapData, colorUsageData = null) {
        const mapColorCounts = colorUsageData
            ? colorDataToMap(colorUsageData)
            : countMapColors(mapData);

        // Remove old colors before adding new ones to prevent inflated counts on reload
        try {
            const oldColorData = await getColorUsage(mapName);
            if (oldColorData && Object.keys(oldColorData).length > 0) {
                this.updateProjectColorCache(new Map(Object.entries(oldColorData)), 'remove');
            }
        } catch (_) { /* first time -- no old data */ }

        await setColorUsage(mapName, Object.fromEntries(mapColorCounts));
        this.updateProjectColorCache(mapColorCounts, 'add');

        if (mapName === this.memoryStore.currentMap) {
            this.memoryStore.colorUsageCache = mapColorCounts;
        }
    }

    /**
     * Updates project color cache (sum of all maps).
     * @param {Map<string, number>} mapColors - Color counts to apply
     * @param {'add'|'remove'} operation - Direction of update
     */
    updateProjectColorCache(mapColors, operation) {
        const multiplier = operation === 'add' ? 1 : -1;

        for (const [color, count] of mapColors) {
            adjustColorCount(this.projectColorCache, color, count * multiplier);
        }
    }

    /**
     * Loads color usage from IndexedDB to the in-memory cache.
     * @param {string} mapName - Map name
     */
    async loadColorUsageFromDB(mapName) {
        try {
            const colorData = await getColorUsage(mapName);
            const colorMap = colorDataToMap(colorData);

            this.memoryStore.colorUsageCache = colorMap;

            if (colorMap.size === 0) {
                setTimeout(() => this.performInitialColorAnalysis(mapName), 100);
            }

        } catch (error) {
            console.warn(`Error loading colors for map ${mapName}:`, error);
            this.memoryStore.colorUsageCache = new Map();
        }
    }

    /**
     * Saves color cache to IndexedDB.
     * @param {string} mapName - Map name
     */
    async saveColorUsageToDB(mapName) {
        try {
            const colorData = Object.fromEntries(this.memoryStore.colorUsageCache);
            await setColorUsage(mapName, colorData);
        } catch (error) {
            console.warn(`Error saving colors for map ${mapName}:`, error);
        }
    }

    /**
     * Performs initial color analysis for an existing map that has no cached data.
     * @param {string} mapName - Map name
     */
    async performInitialColorAnalysis(mapName) {
        try {
            const mapData = await getMapData(mapName);
            const colorCounts = countMapColors(mapData);

            if (mapName === this.memoryStore.currentMap) {
                this.memoryStore.colorUsageCache = colorCounts;
            }

            await setColorUsage(mapName, Object.fromEntries(colorCounts));
            this.updateProjectColorCache(colorCounts, 'add');

        } catch (error) {
            console.warn(`Error in initial color analysis for map ${mapName}:`, error);
        }
    }

    /**
     * Updates color tracking when features change.
     * @param {string|null} oldColor - Previous color
     * @param {string|null} newColor - New color
     * @param {string} [mapName] - Map name (defaults to current)
     */
    updateColorUsage(oldColor, newColor, mapName = null) {
        const targetMap = mapName || this.memoryStore.currentMap;
        const isCurrentMap = targetMap === this.memoryStore.currentMap;

        if (oldColor === 'none') oldColor = null;
        if (newColor === 'none') newColor = null;

        if (isCurrentMap) {
            if (oldColor) {
                adjustColorCount(this.memoryStore.colorUsageCache, oldColor, -1);
            }
            if (newColor) {
                adjustColorCount(this.memoryStore.colorUsageCache, newColor, 1);
            }
            setTimeout(() => this.saveColorUsageToDB(targetMap), 100);
        } else {
            // colorUsageCache holds the CURRENT map's counts; for another map we
            // accumulate the deltas and flush them in a SINGLE read-modify-write,
            // avoiding lost updates and N IndexedDB round-trips on batch cross-map ops.
            this._scheduleColorPersist(targetMap, oldColor, newColor);
        }

        if (oldColor) {
            adjustColorCount(this.projectColorCache, oldColor, -1);
        }
        if (newColor) {
            adjustColorCount(this.projectColorCache, newColor, 1);
        }
    }

    /**
     * Accumulates a color-usage delta for a NON-current map and debounces a single
     * read-modify-write flush per map. Coalescing a burst (e.g. moving N colored
     * features) into one flush avoids the lost-update race of independent timers.
     * @param {string} mapName - Target map name
     * @param {string|null} oldColor - Color being removed (or null)
     * @param {string|null} newColor - Color being added (or null)
     */
    _scheduleColorPersist(mapName, oldColor, newColor) {
        if (!this._pendingColorDeltas) this._pendingColorDeltas = new Map();
        if (!this._colorPersistTimers) this._colorPersistTimers = new Map();

        let deltas = this._pendingColorDeltas.get(mapName);
        if (!deltas) {
            deltas = new Map();
            this._pendingColorDeltas.set(mapName, deltas);
        }
        if (oldColor) deltas.set(oldColor, (deltas.get(oldColor) || 0) - 1);
        if (newColor) deltas.set(newColor, (deltas.get(newColor) || 0) + 1);

        if (this._colorPersistTimers.has(mapName)) return; // flush already scheduled
        const timer = setTimeout(() => {
            this._colorPersistTimers.delete(mapName);
            this._flushColorDeltas(mapName);
        }, 100);
        this._colorPersistTimers.set(mapName, timer);
    }

    /**
     * Applies the accumulated color deltas for a non-current map in one
     * read-modify-write. Fire-and-forget.
     * @param {string} mapName - Target map name
     */
    async _flushColorDeltas(mapName) {
        const deltas = this._pendingColorDeltas?.get(mapName);
        this._pendingColorDeltas?.delete(mapName);
        if (!deltas || deltas.size === 0) return;
        try {
            const colorMap = colorDataToMap(await getColorUsage(mapName));
            for (const [color, delta] of deltas) {
                adjustColorCount(colorMap, color, delta);
            }
            await setColorUsage(mapName, Object.fromEntries(colorMap));
        } catch (error) {
            console.warn(`Error flushing persisted colors for map ${mapName}:`, error);
        }
    }

    /**
     * Gets frequently used colors sorted by count descending.
     * @param {number} limit - Maximum number of colors to return
     * @param {'current'|'project'} scope - Which cache to query
     * @returns {Array<{color: string, count: number}>}
     */
    getFrequentColors(limit = 10, scope = 'current') {
        const sourceCache = scope === 'project'
            ? this.projectColorCache
            : this.memoryStore.colorUsageCache;

        return Array.from(sourceCache.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, limit)
            .map(([color, count]) => ({ color, count }));
    }

    /**
     * Clears all color caches (memory and IndexedDB).
     */
    async clearAllColorCaches() {
        this.memoryStore.colorUsageCache = new Map();
        this.projectColorCache.clear();

        try {
            const allMaps = await getAllMapNames();
            for (const mapName of allMaps) {
                await removeColorUsage(mapName);
            }
        } catch (error) {
            console.warn('Error clearing color caches:', error);
        }
    }

    /**
     * Initializes project color cache by aggregating colors from all maps.
     */
    async initializeProjectColorCache() {
        try {
            this.projectColorCache.clear();
            const allMaps = await getAllMapNames();

            for (const mapName of allMaps) {
                const colorData = await getColorUsage(mapName);
                this.updateProjectColorCache(new Map(Object.entries(colorData)), 'add');
            }
        } catch (error) {
            console.warn('Error initializing project color cache:', error);
        }
    }

    // ===== UNDO/REDO SYSTEM =====

    /** @type {number} Maximum number of actions kept in undo history per map */
    static MAX_UNDO_HISTORY = 20;

    /**
     * Gets a named stack (undo or redo) for the current user on the current map.
     * Creates the stack if it does not exist.
     * @private
     * @param {'undoStacks'|'redoStacks'} stackName
     * @returns {Array}
     */
    _getStack(stackName) {
        const mapState = this.memoryStore.maps[this.memoryStore.currentMap];
        if (!mapState) return [];
        const userId = sessionContext.getUserId();
        if (!mapState[stackName][userId]) {
            mapState[stackName][userId] = [];
        }
        return mapState[stackName][userId];
    }

    /** @private @returns {Array} */
    _getUndoStack() {
        return this._getStack('undoStacks');
    }

    /** @private @returns {Array} */
    _getRedoStack() {
        return this._getStack('redoStacks');
    }

    /**
     * Releases image blobs for delete actions that have been evicted from undo
     * history (so the deletion is now permanent). Handles single 'removeWithProcessed'
     * actions and 'batch' wrappers. Best-effort and async — never throws into
     * recordAction, and only targets image-bearing feature types.
     * @param {Array} actions - Actions evicted from the undo stack
     * @private
     */
    _purgeOrphanedImageBlobs(actions) {
        const ids = [];
        const collect = (list) => {
            for (const action of list) {
                if (!action) continue;
                if (action.type === 'batch' && Array.isArray(action.operations)) {
                    collect(action.operations);
                } else if (action.type === 'removeWithProcessed' && action.mainFeature) {
                    const source = action.mainFeature.properties?.source;
                    if (IMAGE_RESOURCE_FEATURE_TYPES.includes(source)) {
                        ids.push(action.mainFeature.properties.id);
                    }
                }
            }
        };
        collect(actions);
        if (ids.length === 0) return;

        for (const id of ids) {
            Promise.resolve(removeImage(id)).catch(() => { /* best effort */ });
        }
    }

    recordAction(action) {
        if (this.memoryStore.isUndoing || this.memoryStore.isRedoing) return;

        if (this.memoryStore.batchCollector !== null) {
            this.memoryStore.batchCollector.push(action);
            return;
        }

        const undoStack = this._getUndoStack();
        undoStack.push(action);
        const excess = undoStack.length - MapManager.MAX_UNDO_HISTORY;
        if (excess > 0) {
            // Evicted delete actions are now beyond undo, so the deletion is
            // permanent — release any image blobs they reference (deferred cleanup
            // that keeps blobs restorable while the delete is still undoable).
            const evicted = undoStack.splice(0, excess);
            this._purgeOrphanedImageBlobs(evicted);
        }
        // Clear redo on new action (fork)
        const mapState = this.memoryStore.maps[this.memoryStore.currentMap];
        const userId = sessionContext.getUserId();
        mapState.redoStacks[userId] = [];
    }

    /**
     * Starts collecting undo actions into a batch.
     * While collecting, recordAction() accumulates actions instead of pushing to undoStack.
     * Call commitBatchCollection() to finalize as a single batch undo entry.
     */
    startBatchCollection() {
        this.memoryStore.batchCollector = [];
    }

    /**
     * Commits collected actions as a single batch undo entry.
     * If only one action was collected, records it directly (no batch wrapper).
     */
    commitBatchCollection() {
        const collected = this.memoryStore.batchCollector;
        this.memoryStore.batchCollector = null;
        if (collected && collected.length > 0) {
            this.recordBatchOperation(collected);
        }
    }

    /**
     * Discards any collected batch actions without recording.
     */
    discardBatchCollection() {
        this.memoryStore.batchCollector = null;
    }

    async undoLastAction(executeFunction) {
        const undoStack = this._getUndoStack();
        const lastAction = undoStack.pop();
        if (!lastAction) return false;

        this.memoryStore.isUndoing = true;
        try {
            await this._executeUndoAction(lastAction, executeFunction);
            this._getRedoStack().push(lastAction);
        } catch (error) {
            undoStack.push(lastAction);
            throw error;
        } finally {
            this.memoryStore.isUndoing = false;
        }

        return lastAction;
    }

    async redoLastAction(executeFunction) {
        const redoStack = this._getRedoStack();
        const lastUndoneAction = redoStack.pop();
        if (!lastUndoneAction) return false;

        this.memoryStore.isRedoing = true;
        try {
            await this._executeRedoAction(lastUndoneAction, executeFunction);
            this._getUndoStack().push(lastUndoneAction);
        } catch (error) {
            redoStack.push(lastUndoneAction);
            throw error;
        } finally {
            this.memoryStore.isRedoing = false;
        }

        return lastUndoneAction;
    }

    async _executeUndoAction(action, executeFunction) {
        switch (action.type) {
            case 'add':
                await executeFunction.removeFeature(action.featureType, action.feature.properties.id);
                break;
            case 'update':
                await executeFunction.updateFeature(action.featureType, action.oldFeature);
                break;
            case 'remove':
                await executeFunction.addFeature(action.featureType, action.feature);
                break;
            case 'removeWithProcessed':
                await executeFunction.addFeature(action.mainFeatureType, action.mainFeature);
                if (action.processedFeatures) {
                    for (const pf of action.processedFeatures.features) {
                        await executeFunction.addFeature(action.processedFeatures.type, pf);
                    }
                }
                break;
            case 'updateWithProcessed':
                await executeFunction.updateFeature(action.mainFeatureType, action.oldFeature);
                if (action.newProcessedFeatures) {
                    for (const pf of action.newProcessedFeatures.features) {
                        await executeFunction.removeFeature(action.newProcessedFeatures.type, pf.properties.id);
                    }
                }
                if (action.oldProcessedFeatures) {
                    for (const pf of action.oldProcessedFeatures.features) {
                        await executeFunction.addFeature(action.oldProcessedFeatures.type, pf);
                    }
                }
                break;
            case 'addMultiple':
                for (const [type, features] of Object.entries(action.features)) {
                    for (const feature of features) {
                        await executeFunction.removeFeature(type, feature.properties.id);
                    }
                }
                break;
            case 'moveBetweenMaps':
                for (const [type, typeOps] of Object.entries(action.movedFeatures)) {
                    for (const featureOp of typeOps.mainFeatures) {
                        await executeFunction.removeFeatureFromMap(type, featureOp.feature.properties.id, action.targetMapName);
                        await executeFunction.addFeatureToMap(type, featureOp.removedData.mainFeature, action.sourceMapName);

                        if (featureOp.removedData.processedFeatures) {
                            for (const pf of featureOp.removedData.processedFeatures.features) {
                                await executeFunction.addFeatureToMap(featureOp.removedData.processedFeatures.type, pf, action.sourceMapName);
                            }
                        }
                    }
                }
                break;
            case 'batch':
                for (let i = action.operations.length - 1; i >= 0; i--) {
                    await this._executeUndoAction(action.operations[i], executeFunction);
                }
                break;
        }
    }

    async _executeRedoAction(action, executeFunction) {
        switch (action.type) {
            case 'add':
                await executeFunction.addFeature(action.featureType, action.feature);
                break;
            case 'update':
                await executeFunction.updateFeature(action.featureType, action.newFeature);
                break;
            case 'remove':
                await executeFunction.removeFeature(action.featureType, action.feature.properties.id);
                break;
            case 'removeWithProcessed':
                await executeFunction.removeFeature(action.mainFeatureType, action.mainFeature.properties.id);
                break;
            case 'updateWithProcessed':
                await executeFunction.updateFeature(action.mainFeatureType, action.newFeature);
                if (action.oldProcessedFeatures) {
                    for (const pf of action.oldProcessedFeatures.features) {
                        await executeFunction.removeFeature(action.oldProcessedFeatures.type, pf.properties.id);
                    }
                }
                if (action.newProcessedFeatures) {
                    for (const pf of action.newProcessedFeatures.features) {
                        await executeFunction.addFeature(action.newProcessedFeatures.type, pf);
                    }
                }
                break;
            case 'addMultiple':
                for (const [type, features] of Object.entries(action.features)) {
                    for (const feature of features) {
                        await executeFunction.addFeature(type, feature);
                    }
                }
                break;
            case 'moveBetweenMaps':
                for (const [type, typeOps] of Object.entries(action.movedFeatures)) {
                    for (const featureOp of typeOps.mainFeatures) {
                        await executeFunction.removeFeatureFromMap(type, featureOp.removedData.mainFeature.properties.id, action.sourceMapName);
                        await executeFunction.addFeatureToMap(type, featureOp.feature, action.targetMapName);

                        if (featureOp.removedData.processedFeatures) {
                            for (const pf of featureOp.removedData.processedFeatures.features) {
                                await executeFunction.addFeatureToMap(featureOp.removedData.processedFeatures.type, pf, action.targetMapName);
                            }
                        }
                    }
                }
                break;
            case 'batch':
                for (const op of action.operations) {
                    await this._executeRedoAction(op, executeFunction);
                }
                break;
        }
    }

    // ===== UTILITY METHODS =====

    isUndoing() {
        return this.memoryStore.isUndoing;
    }

    isRedoing() {
        return this.memoryStore.isRedoing;
    }

    canUndo() {
        return this._getUndoStack().length > 0;
    }

    canRedo() {
        return this._getRedoStack().length > 0;
    }

    clearHistory(mapName = null) {
        const targetMap = mapName || this.memoryStore.currentMap;
        if (this.memoryStore.maps[targetMap]) {
            this.memoryStore.maps[targetMap].undoStacks = {};
            this.memoryStore.maps[targetMap].redoStacks = {};
        }
    }

    // ===== MAP MANAGEMENT =====

    addMapToMemory(mapName) {
        this.memoryStore.maps[mapName] = {
            undoStacks: {},
            redoStacks: {}
        };
    }

    async removeMapFromMemory(mapName) {
        delete this.memoryStore.maps[mapName];
        delete this.memoryStore.layers[mapName];
        delete this.memoryStore.groups[mapName];
        this.memoryStore.lockedMaps.delete(mapName);

        try {
            const mapColors = await getColorUsage(mapName);
            if (mapColors && Object.keys(mapColors).length > 0) {
                this.updateProjectColorCache(new Map(Object.entries(mapColors)), 'remove');
            }
            await removeColorUsage(mapName);
        } catch (error) {
            console.warn(`Error removing colors for map ${mapName}:`, error);
        }

        try {
            await getGroupManager().clearMapGroups(mapName);
        } catch (error) {
            console.warn(`Error removing groups for map ${mapName}:`, error);
        }
    }

    renameMapInMemory(oldName, newName) {
        const store = this.memoryStore;

        for (const key of ['maps', 'groups', 'layers']) {
            if (store[key][oldName]) {
                store[key][newName] = store[key][oldName];
                delete store[key][oldName];
            }
        }

        if (store.currentMap === oldName) {
            store.currentMap = newName;
        }

        if (store.lockedMaps.has(oldName)) {
            store.lockedMaps.delete(oldName);
            store.lockedMaps.add(newName);
        }
    }

    // ===== BATCH OPERATIONS =====

    recordBatchOperation(operations) {
        if (operations.length === 0) return;

        if (operations.length === 1) {
            this.recordAction(operations[0]);
        } else {
            this.recordAction({
                type: 'batch',
                operations
            });
        }
    }
}

if (!memoryStore.colorUsageCache) {
    memoryStore.colorUsageCache = new Map();
}

if (!memoryStore.groups) {
    memoryStore.groups = {};
}

const mapManagerInstance = new MapManager();

export default mapManagerInstance;

// Path: js/store/store-state-manager.js

import { memoryStore } from './memory-store.js';
import {
    setSettingCompat as setAppSetting,
    getSettingCompat,
    getColorUsageCompat as getColorUsage,
    setColorUsageCompat as setColorUsage,
    removeColorUsageCompat as removeColorUsage,
    getAllMapKeysCompat as getAllMapNames,
    getMapDataCompat as getMapData
} from './repositories/index.js';
import { getGroupManager } from './services.js';
import { mapResolver } from './services/map-resolver.service.js';
import { logOperation, EntityType, OperationType, sessionContext } from './sync/index.js';
import { LRUCache } from '../utilities/lru-cache.js';

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
        }

        if (oldColor) {
            adjustColorCount(this.projectColorCache, oldColor, -1);
        }
        if (newColor) {
            adjustColorCount(this.projectColorCache, newColor, 1);
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
            undoStack.splice(0, excess);
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

// Path: js/store/store-state-manager.js

import { memoryStore } from './memory-store.js';
import {
    setSettingCompat,
    getSettingCompat,
    getColorUsageCompat,
    setColorUsageCompat,
    removeColorUsageCompat,
    getAllMapKeysCompat,
    getMapDataCompat
} from './repositories/index.js';
import { getGroupManager } from './services.js';
import { mapResolver } from './services/map-resolver.service.js';
import { logOperation, EntityType, OperationType, sessionContext } from './sync/index.js';
import { LRUCache } from '../utilities/lru-cache.js';

// Alias for backward compatibility during migration
const setAppSetting = setSettingCompat;
const setColorUsage = setColorUsageCompat;
const getColorUsage = getColorUsageCompat;
const removeColorUsage = removeColorUsageCompat;
const getAllMapNames = getAllMapKeysCompat;
const getMapData = getMapDataCompat;

/**
 * In-memory state manager with undo/redo system and color tracking
 * Manages map state, history, and integrates with group management
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
     * Uses the MapResolverService to resolve the name to an ID.
     * @returns {string} Current map UUID (or name if resolver not initialized)
     */
    getCurrentMapId() {
        const mapName = this.memoryStore.currentMap;
        if (!mapName) return mapName;

        // Use the mapResolver to get the UUID
        // If resolver is not initialized, returns the name as fallback
        return mapResolver.resolveToId(mapName);
    }

    /**
     * Gets both the current map name and ID.
     * @returns {{name: string, id: string}} Object with name and id
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
            // Free undo/redo memory for inactive map
            this.clearHistory(previousMap);
        }

        this.setCurrentMapName(mapName);

        await this.loadColorUsageFromDB(mapName);
        await getGroupManager().loadGroupsToMemory(mapName);
        await setAppSetting('lastActiveMap', mapName);

        // Load lock state into memory cache
        const locked = await getSettingCompat(`mapLocked_${mapName}`);
        if (locked) {
            this.memoryStore.lockedMaps.add(mapName);
        } else {
            this.memoryStore.lockedMaps.delete(mapName);
        }

        // Log operation for sync
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
     * Extracts the primary color from a feature based on layer_setup.js properties
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
     * Used to track all colors when a feature is created.
     * @param {Object} feature - GeoJSON feature
     * @returns {string[]} Array of color values (may have duplicates if same color used multiple times)
     */
    getFeatureColors(feature) {
        const props = feature.properties;
        if (!props) return [];

        const colorProperties = [
            'color',
            'fillColor',
            'lineColor',
            'outlinecolor',
            'backgroundColor',
            'hatchColor',
            'backgroundFillColor',
            'backgroundBorderColor'
        ];

        const colors = [];
        for (const prop of colorProperties) {
            if (props[prop] && typeof props[prop] === 'string') {
                colors.push(props[prop]);
            }
        }

        return colors;
    }

    /**
     * Processes colors for a map (used in addMap)
     * @param {string} mapName - Map name
     * @param {Object} mapData - Map data
     * @param {Object} colorUsageData - Optional pre-calculated color usage
     */
    async processMapColors(mapName, mapData, colorUsageData = null) {
        let mapColorCounts;

        if (colorUsageData) {
            mapColorCounts = new Map();
            for (const [color, count] of Object.entries(colorUsageData)) {
                mapColorCounts.set(color, Number(count) || 0);
            }
        } else {
            mapColorCounts = await this.calculateMapColors(mapData);
        }

        // Remove old colors before adding new ones to prevent inflated counts on reload
        try {
            const oldColorData = await getColorUsage(mapName);
            if (oldColorData && Object.keys(oldColorData).length > 0) {
                const oldColors = new Map(Object.entries(oldColorData));
                this.updateProjectColorCache(oldColors, 'remove');
            }
        } catch (_) { /* first time — no old data */ }

        await setColorUsage(mapName, Object.fromEntries(mapColorCounts));
        this.updateProjectColorCache(mapColorCounts, 'add');

        if (mapName === this.memoryStore.currentMap) {
            this.memoryStore.colorUsageCache = mapColorCounts;
        }
    }

    /**
     * Calculates colors for a map from scratch
     * @param {Object} mapData - Map data
     * @returns {Map} Map of color counts
     */
    async calculateMapColors(mapData) {
        const colorCounts = new Map();

        Object.entries(mapData.features || {}).forEach(([_featureType, features]) => {
            if (!Array.isArray(features)) return;

            features.forEach(feature => {
                // Get all colors from the feature
                const colors = this.getFeatureColors(feature);
                for (const color of colors) {
                    colorCounts.set(color, (colorCounts.get(color) || 0) + 1);
                }
            });
        });

        return colorCounts;
    }

    /**
     * Updates project color cache (sum of all maps)
     * @param {Map} mapColors - Map colors to add or remove
     * @param {string} operation - 'add' or 'remove'
     */
    updateProjectColorCache(mapColors, operation) {
        const multiplier = operation === 'add' ? 1 : -1;

        for (const [color, count] of mapColors) {
            const currentCount = this.projectColorCache.get(color) || 0;
            const newCount = currentCount + (count * multiplier);

            if (newCount <= 0) {
                this.projectColorCache.delete(color);
            } else {
                this.projectColorCache.set(color, newCount);
            }
        }
    }

    /**
     * Loads color usage from IndexedDB to cache
     * @param {string} mapName - Map name
     */
    async loadColorUsageFromDB(mapName) {
        try {
            const colorData = await getColorUsage(mapName);
            const colorMap = new Map();

            for (const [color, count] of Object.entries(colorData)) {
                colorMap.set(color, Number(count) || 0);
            }

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
     * Saves color cache to IndexedDB (background)
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
     * Performs initial color analysis for an existing map
     * @param {string} mapName - Map name
     */
    async performInitialColorAnalysis(mapName) {
        try {
            const mapData = await getMapData(mapName);
            const colorCounts = new Map();

            Object.entries(mapData.features || {}).forEach(([_featureType, features]) => {
                if (!Array.isArray(features)) return;

                features.forEach(feature => {
                    const color = this.getFeatureColor(feature);
                    if (color) {
                        colorCounts.set(color, (colorCounts.get(color) || 0) + 1);
                    }
                });
            });

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
     * Updates color tracking when features change
     * @param {string} oldColor - Previous color
     * @param {string} newColor - New color
     * @param {string} mapName - Map name
     */
    updateColorUsage(oldColor, newColor, mapName = null) {
        const targetMap = mapName || this.memoryStore.currentMap;
        const isCurrentMap = targetMap === this.memoryStore.currentMap;

        if (oldColor === 'none') oldColor = null;
        if (newColor === 'none') newColor = null;

        if (isCurrentMap) {
            if (oldColor) {
                const oldCount = this.memoryStore.colorUsageCache.get(oldColor) || 0;
                if (oldCount <= 1) {
                    this.memoryStore.colorUsageCache.delete(oldColor);
                } else {
                    this.memoryStore.colorUsageCache.set(oldColor, oldCount - 1);
                }
            }

            if (newColor) {
                const newCount = this.memoryStore.colorUsageCache.get(newColor) || 0;
                this.memoryStore.colorUsageCache.set(newColor, newCount + 1);
            }

            setTimeout(() => this.saveColorUsageToDB(targetMap), 100);
        }

        if (oldColor) {
            const oldProjectCount = this.projectColorCache.get(oldColor) || 0;
            if (oldProjectCount <= 1) {
                this.projectColorCache.delete(oldColor);
            } else {
                this.projectColorCache.set(oldColor, oldProjectCount - 1);
            }
        }

        if (newColor) {
            const newProjectCount = this.projectColorCache.get(newColor) || 0;
            this.projectColorCache.set(newColor, newProjectCount + 1);
        }
    }

    /**
     * Gets frequently used colors
     * @param {number} limit - Maximum number of colors to return
     * @param {string} scope - 'current' or 'project'
     * @returns {Array} Array of {color, count} objects
     */
    getFrequentColors(limit = 10, scope = 'current') {
        const sourceCache = scope === 'project' ?
            this.projectColorCache :
            this.memoryStore.colorUsageCache;

        return Array.from(sourceCache.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, limit)
            .map(([color, count]) => ({ color, count }));
    }

    /**
     * Clears all color caches
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
     * Initializes project color cache by loading colors from all maps
     */
    async initializeProjectColorCache() {
        try {
            this.projectColorCache.clear();
            const allMaps = await getAllMapNames();

            for (const mapName of allMaps) {
                const colorData = await getColorUsage(mapName);
                const mapColors = new Map(Object.entries(colorData));
                this.updateProjectColorCache(mapColors, 'add');
            }
        } catch (error) {
            console.warn('Error initializing project color cache:', error);
        }
    }

    // ===== UNDO/REDO SYSTEM =====

    /** @type {number} Maximum number of actions kept in undo history per map */
    static MAX_UNDO_HISTORY = 20;

    /**
     * Gets the undo stack for the current user on the current map.
     * Creates the stack if it doesn't exist.
     * @private
     * @returns {Array}
     */
    _getUndoStack() {
        const mapState = this.memoryStore.maps[this.memoryStore.currentMap];
        if (!mapState) return [];
        const userId = sessionContext.getUserId();
        if (!mapState.undoStacks[userId]) {
            mapState.undoStacks[userId] = [];
        }
        return mapState.undoStacks[userId];
    }

    /**
     * Gets the redo stack for the current user on the current map.
     * Creates the stack if it doesn't exist.
     * @private
     * @returns {Array}
     */
    _getRedoStack() {
        const mapState = this.memoryStore.maps[this.memoryStore.currentMap];
        if (!mapState) return [];
        const userId = sessionContext.getUserId();
        if (!mapState.redoStacks[userId]) {
            mapState.redoStacks[userId] = [];
        }
        return mapState.redoStacks[userId];
    }

    recordAction(action) {
        if (!this.memoryStore.isUndoing && !this.memoryStore.isRedoing) {
            if (this.memoryStore.batchCollector !== null) {
                // Batch mode: collect instead of pushing directly
                this.memoryStore.batchCollector.push(action);
            } else {
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
        }
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
            // Only move to redoStack after successful execution
            const redoStack = this._getRedoStack();
            redoStack.push(lastAction);
        } catch (error) {
            // Restore to undoStack so the user can retry
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
            // Only move to undoStack after successful execution
            const undoStack = this._getUndoStack();
            undoStack.push(lastUndoneAction);
        } catch (error) {
            // Restore to redoStack so the user can retry
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
                // Undo batch: execute each operation in reverse order
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
                // Redo batch: execute each operation in original order
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
        const undoStack = this._getUndoStack();
        return undoStack.length > 0;
    }

    canRedo() {
        const redoStack = this._getRedoStack();
        return redoStack.length > 0;
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
                const mapColorsMap = new Map(Object.entries(mapColors));
                this.updateProjectColorCache(mapColorsMap, 'remove');
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
        if (this.memoryStore.maps[oldName]) {
            this.memoryStore.maps[newName] = this.memoryStore.maps[oldName];
            delete this.memoryStore.maps[oldName];

            if (this.memoryStore.currentMap === oldName) {
                this.memoryStore.currentMap = newName;
            }
        }

        if (this.memoryStore.groups[oldName]) {
            this.memoryStore.groups[newName] = this.memoryStore.groups[oldName];
            delete this.memoryStore.groups[oldName];
        }

        if (this.memoryStore.layers[oldName]) {
            this.memoryStore.layers[newName] = this.memoryStore.layers[oldName];
            delete this.memoryStore.layers[oldName];
        }

        if (this.memoryStore.lockedMaps.has(oldName)) {
            this.memoryStore.lockedMaps.delete(oldName);
            this.memoryStore.lockedMaps.add(newName);
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
                operations: operations
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

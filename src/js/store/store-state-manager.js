// Path: js/store/store-state-manager.js

import { memoryStore } from './memory-store.js';
import {
    setSettingCompat,
    getColorUsageCompat,
    setColorUsageCompat,
    removeColorUsageCompat,
    getAllMapKeysCompat,
    getMapDataCompat
} from './repositories/index.js';
import { groupManager } from '../tool_manager';
import { mapResolver } from './services/map-resolver.service.js';
import { logOperation, EntityType, OperationType } from './sync/index.js';

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
        this.projectColorCache = new Map();
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
                undoStack: [],
                redoStack: []
            };
        }
    }

    async setCurrentMap(mapName) {
        const previousMap = this.memoryStore.currentMap;

        if (previousMap && previousMap !== mapName) {
            await this.saveColorUsageToDB(previousMap);
        }

        this.setCurrentMapName(mapName);

        await this.loadColorUsageFromDB(mapName);
        await groupManager.loadGroupsToMemory(mapName);
        await setAppSetting('lastActiveMap', mapName);

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

    recordAction(action) {
        const currentMap = this.memoryStore.maps[this.memoryStore.currentMap];
        if (!this.memoryStore.isUndoing && !this.memoryStore.isRedoing) {
            currentMap.undoStack.push(action);
            if (currentMap.undoStack.length > 20) {
                currentMap.undoStack.shift();
            }
            currentMap.redoStack = [];
        }
    }

    async undoLastAction(executeFunction) {
        const currentMap = this.memoryStore.maps[this.memoryStore.currentMap];
        const lastAction = currentMap.undoStack.pop();
        if (!lastAction) return false;

        this.memoryStore.isUndoing = true;
        currentMap.redoStack.push(lastAction);

        try {
            await this._executeUndoAction(lastAction, executeFunction);
        } finally {
            this.memoryStore.isUndoing = false;
        }

        return true;
    }

    async redoLastAction(executeFunction) {
        const currentMap = this.memoryStore.maps[this.memoryStore.currentMap];
        const lastUndoneAction = currentMap.redoStack.pop();
        if (!lastUndoneAction) return false;

        this.memoryStore.isRedoing = true;
        currentMap.undoStack.push(lastUndoneAction);

        try {
            await this._executeRedoAction(lastUndoneAction, executeFunction);
        } finally {
            this.memoryStore.isRedoing = false;
        }

        return true;
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
        const currentMap = this.memoryStore.maps[this.memoryStore.currentMap];
        return currentMap?.undoStack.length > 0;
    }

    canRedo() {
        const currentMap = this.memoryStore.maps[this.memoryStore.currentMap];
        return currentMap?.redoStack.length > 0;
    }

    clearHistory(mapName = null) {
        const targetMap = mapName || this.memoryStore.currentMap;
        if (this.memoryStore.maps[targetMap]) {
            this.memoryStore.maps[targetMap].undoStack = [];
            this.memoryStore.maps[targetMap].redoStack = [];
        }
    }

    // ===== MAP MANAGEMENT =====

    addMapToMemory(mapName) {
        this.memoryStore.maps[mapName] = {
            undoStack: [],
            redoStack: []
        };
    }

    async removeMapFromMemory(mapName) {
        delete this.memoryStore.maps[mapName];

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
            await groupManager.clearMapGroups(mapName);
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

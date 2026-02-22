// Path: js/layers/layer.manager.js

import {
    memoryStore,
    setLayersRepo,
    getLayersRepo,
    setActiveLayerIdRepo,
    getActiveLayerIdRepo,
    getDefaultLayer,
    StoreErrorEvents,
    emitStoreError
} from '../store';
import { IDUtils } from '../utilities';
import { DebouncedPersist } from '../utilities/debounced-persist.js';
import { EventTypes } from '../events';
import { logLayerOperation, OperationType } from '../store/sync/index.js';

/**
 * Central layer manager
 * Follows the same pattern as GroupManager:
 * - In-memory cache (Map) for synchronous O(1) queries
 * - Asynchronous persistence to IndexedDB
 * - Events to notify changes
 */
class LayerManager {
    /**
     * @param {import('../events/event_bus.js').EventBus} eventBus - Event bus for notifications
     */
    constructor(eventBus) {
        this.memoryStore = memoryStore;
        this._eventBus = eventBus;

        /** @type {DebouncedPersist} Debounced persistence for layers array */
        this._layersPersist = new DebouncedPersist({
            delay: 300,
            maxRetries: 3,
            onError: (key, error) => emitStoreError(StoreErrorEvents.STORE_PERSIST_ERROR, {
                operation: `persist layers [${key}]`,
                error: error.message || String(error),
                timestamp: Date.now()
            })
        });

        /** @type {DebouncedPersist} Debounced persistence for active layer ID */
        this._activeLayerPersist = new DebouncedPersist({
            delay: 300,
            maxRetries: 3,
            onError: (key, error) => emitStoreError(StoreErrorEvents.STORE_PERSIST_ERROR, {
                operation: `persist active layer [${key}]`,
                error: error.message || String(error),
                timestamp: Date.now()
            })
        });
    }

    // ===== SYNCHRONOUS READ OPERATIONS =====

    /**
     * Get all layers from a map (sorted by order)
     * @param {string} mapName - Map name (null = current map)
     * @returns {Array} Sorted array of layers
     */
    getLayers(mapName = null) {
        const targetMap = mapName || this.memoryStore.currentMap;
        this._ensureMapLayersExist(targetMap);

        return Array.from(this.memoryStore.layers[targetMap].values())
            .sort((a, b) => (a.order || 0) - (b.order || 0));
    }

    /**
     * Get layer by ID - O(1) lookup
     * @param {string} layerId - Layer ID
     * @param {string} mapName - Map name
     * @returns {Object|null} Layer or null
     */
    getLayerById(layerId, mapName = null) {
        const targetMap = mapName || this.memoryStore.currentMap;
        this._ensureMapLayersExist(targetMap);
        return this.memoryStore.layers[targetMap].get(layerId) || null;
    }

    /**
     * Get active layer ID (synchronous)
     * @returns {string} Active layer ID
     */
    getActiveLayerIdSync() {
        return this.memoryStore.activeLayerId || 'default';
    }

    /**
     * Get active layer object
     * @param {string} mapName - Map name
     * @returns {Object|null} Active layer or null
     */
    getActiveLayer(mapName = null) {
        const activeId = this.getActiveLayerIdSync();
        return this.getLayerById(activeId, mapName);
    }

    /**
     * Get visible layer IDs
     * @param {string} mapName - Map name
     * @returns {Array} Array of visible layer IDs
     */
    getVisibleLayerIds(mapName = null) {
        return this.getLayers(mapName)
            .filter(l => l.visible)
            .map(l => l.id);
    }

    /**
     * Get unlocked layer IDs
     * @param {string} mapName - Map name
     * @returns {Array} Array of unlocked layer IDs
     */
    getUnlockedLayerIds(mapName = null) {
        return this.getLayers(mapName)
            .filter(l => !l.locked)
            .map(l => l.id);
    }

    // ===== STATE CHECKS =====

    /**
     * Check if a feature is effectively visible (considering layer)
     * @param {Object} feature - Feature to check
     * @param {string} mapName - Map name
     * @returns {boolean} True if feature is visible
     */
    isFeatureEffectivelyVisible(feature, mapName = null) {
        if (!feature || !feature.properties) return true;

        // Individual visibility
        if (feature.properties.visivel === false) return false;

        // Layer visibility
        const layerId = feature.properties.layerId || 'default';
        const layer = this.getLayerById(layerId, mapName);
        return layer?.visible ?? true;
    }

    /**
     * Check if a feature is effectively locked (layer OR feature)
     * @param {Object} feature - Feature to check
     * @param {string} mapName - Map name
     * @returns {boolean} True if feature is locked
     */
    isFeatureEffectivelyLocked(feature, mapName = null) {
        if (!feature || !feature.properties) return false;

        // Individual lock (legacy)
        if (feature.properties.bloqueado === true) return true;

        // Layer lock
        const layerId = feature.properties.layerId || 'default';
        const layer = this.getLayerById(layerId, mapName);
        return layer?.locked ?? false;
    }

    // ===== WRITE OPERATIONS =====

    /**
     * Create a new layer
     * @param {string} name - Layer name (if not provided, generates unique default name)
     * @param {string} mapName - Map name (null = current map)
     * @returns {Object} Created layer
     */
    createLayer(name, mapName = null) {
        const targetMap = mapName || this.memoryStore.currentMap;
        this._ensureMapLayersExist(targetMap);

        const layerId = IDUtils.generateUniqueId('layer');
        const order = this._getNextLayerOrder(targetMap);

        // Generate unique name if not provided
        let layerName = name;
        if (!layerName) {
            const existingLayers = Array.from(this.memoryStore.layers[targetMap].values());
            layerName = IDUtils.generateUniqueLayerName(existingLayers, 'Nova Camada');
        }

        const now = Date.now();
        const newLayer = {
            id: layerId,
            name: layerName,
            visible: true,
            locked: false,
            order: order,
            createdAt: now,
            updatedAt: now,
            version: 1
        };

        this.memoryStore.layers[targetMap].set(layerId, newLayer);
        this._persistLayersAsync(targetMap);
        this._notifyLayersChanged();

        // Log operation for sync
        logLayerOperation(OperationType.CREATE, layerId, targetMap, newLayer);

        return newLayer;
    }

    /**
     * Create a new layer for import (no event emission, no active layer change)
     * @param {string} name - Layer name (if not provided, generates unique default name)
     * @param {string} mapName - Map name
     * @returns {Object} Created layer
     */
    createLayerForImport(name, mapName = null) {
        const targetMap = mapName || this.memoryStore.currentMap;
        this._ensureMapLayersExist(targetMap);

        const layerId = IDUtils.generateUniqueId('layer');
        const order = this._getNextLayerOrder(targetMap);

        // Generate unique name if not provided
        let layerName = name;
        if (!layerName) {
            const existingLayers = Array.from(this.memoryStore.layers[targetMap].values());
            layerName = IDUtils.generateUniqueLayerName(existingLayers, 'Importação');
        }

        const now = Date.now();
        const newLayer = {
            id: layerId,
            name: layerName,
            visible: true,
            locked: false,
            order: order,
            createdAt: now,
            updatedAt: now,
            version: 1
        };

        this.memoryStore.layers[targetMap].set(layerId, newLayer);
        this._persistLayersAsync(targetMap);
        // No event emission - will be emitted after import is complete

        // Log operation for sync
        logLayerOperation(OperationType.CREATE, layerId, targetMap, newLayer);

        return newLayer;
    }

    /**
     * Delete a layer in cascade
     * If deleting the last layer, creates a new "Padrão" layer automatically
     * @param {string} layerId - Layer ID to delete
     * @param {string} mapName - Map name
     * @returns {Object} Information about the deletion
     */
    deleteLayer(layerId, mapName = null) {
        const targetMap = mapName || this.memoryStore.currentMap;
        this._ensureMapLayersExist(targetMap);

        const layersMap = this.memoryStore.layers[targetMap];

        if (!layersMap.has(layerId)) {
            throw new Error(`Layer ${layerId} not found.`);
        }

        // Capture layer data before deletion for logging
        const deletedLayer = layersMap.get(layerId);

        const isLastLayer = layersMap.size <= 1;
        let createdDefaultLayer = null;

        // If deleting the last layer, create a new default layer first
        if (isLastLayer) {
            const defaultLayer = getDefaultLayer();
            // Ensure unique ID if 'default' already exists (edge case)
            if (layerId === 'default') {
                defaultLayer.id = IDUtils.generateUniqueId('layer');
            }
            layersMap.set(defaultLayer.id, defaultLayer);
            this.memoryStore.activeLayerId = defaultLayer.id;
            createdDefaultLayer = defaultLayer;
        } else {
            // If deleting active layer, switch to another
            if (this.memoryStore.activeLayerId === layerId) {
                const remaining = Array.from(layersMap.values())
                    .filter(l => l.id !== layerId && !l.locked);

                if (remaining.length > 0) {
                    this.memoryStore.activeLayerId = remaining[0].id;
                } else {
                    const anyOther = Array.from(layersMap.values())
                        .find(l => l.id !== layerId);
                    if (anyOther) {
                        anyOther.locked = false;
                        this.memoryStore.activeLayerId = anyOther.id;
                    }
                }
            }
        }

        layersMap.delete(layerId);
        this._persistLayersAsync(targetMap);
        this._persistActiveLayerAsync(targetMap);
        this._notifyLayersChanged();

        // Log operation for sync
        logLayerOperation(OperationType.DELETE, layerId, targetMap, null, deletedLayer);

        return {
            success: true,
            deletedLayerId: layerId,
            createdDefaultLayer: createdDefaultLayer
        };
    }

    /**
     * Rename a layer
     * @param {string} layerId - Layer ID
     * @param {string} newName - New name
     * @param {string} mapName - Map name
     * @returns {Object} Renamed layer
     */
    renameLayer(layerId, newName, mapName = null) {
        const targetMap = mapName || this.memoryStore.currentMap;
        const layer = this.getLayerById(layerId, targetMap);

        if (!layer) {
            throw new Error(`Layer ${layerId} not found.`);
        }

        // Capture old state for logging
        const oldLayer = { ...layer };

        layer.name = newName;
        layer.updatedAt = Date.now();
        layer.version = (layer.version || 0) + 1;
        this._persistLayersAsync(targetMap);
        this._notifyLayersChanged();

        // Log operation for sync
        logLayerOperation(OperationType.UPDATE, layerId, targetMap, layer, oldLayer);

        return layer;
    }

    // ===== ACTIVE LAYER =====

    /**
     * Set the active layer
     * @param {string} layerId - Layer ID to activate
     * @param {string} mapName - Map name
     * @returns {Object} Activated layer
     * @throws {Error} If the layer is locked
     */
    setActiveLayer(layerId, mapName = null) {
        const targetMap = mapName || this.memoryStore.currentMap;
        const layer = this.getLayerById(layerId, targetMap);

        if (!layer) {
            throw new Error(`Layer ${layerId} not found.`);
        }

        if (layer.locked) {
            throw new Error('Cannot activate a locked layer.');
        }

        this.memoryStore.activeLayerId = layerId;
        this._persistActiveLayerAsync(targetMap);
        this._notifyLayersChanged();

        return layer;
    }

    // ===== VISIBILITY AND LOCK =====

    /**
     * Set layer visibility
     * @param {string} layerId - Layer ID
     * @param {boolean} visible - Visibility state
     * @param {string} mapName - Map name
     * @returns {Object} Updated layer
     */
    setLayerVisibility(layerId, visible, mapName = null) {
        const targetMap = mapName || this.memoryStore.currentMap;
        const layer = this.getLayerById(layerId, targetMap);

        if (!layer) {
            throw new Error(`Layer ${layerId} not found.`);
        }

        // Capture old state for logging
        const oldLayer = { ...layer };

        layer.visible = visible;
        layer.updatedAt = Date.now();
        layer.version = (layer.version || 0) + 1;
        this._persistLayersAsync(targetMap);
        this._notifyLayersChanged();

        // Log operation for sync
        logLayerOperation(OperationType.UPDATE, layerId, targetMap, layer, oldLayer);

        return layer;
    }

    /**
     * Set layer lock state
     * @param {string} layerId - Layer ID
     * @param {boolean} locked - Lock state
     * @param {string} mapName - Map name
     * @returns {Object} Updated layer
     */
    setLayerLocked(layerId, locked, mapName = null) {
        const targetMap = mapName || this.memoryStore.currentMap;

        const layer = this.getLayerById(layerId, targetMap);
        if (!layer) {
            throw new Error(`Layer ${layerId} not found.`);
        }

        // Capture old state for logging
        const oldLayer = { ...layer };

        layer.locked = locked;
        layer.updatedAt = Date.now();
        layer.version = (layer.version || 0) + 1;
        this._persistLayersAsync(targetMap);
        this._notifyLayersChanged();

        // Log operation for sync
        logLayerOperation(OperationType.UPDATE, layerId, targetMap, layer, oldLayer);

        return layer;
    }

    /**
     * Reorder layers based on array of IDs
     * @param {string[]} orderedLayerIds - Array of layer IDs in new order
     * @param {string} mapName - Map name
     */
    reorderLayers(orderedLayerIds, mapName = null) {
        const targetMap = mapName || this.memoryStore.currentMap;
        this._ensureMapLayersExist(targetMap);

        const layersMap = this.memoryStore.layers[targetMap];

        orderedLayerIds.forEach((layerId, index) => {
            const layer = layersMap.get(layerId);
            if (layer) {
                layer.order = index;
            }
        });

        this._persistLayersAsync(targetMap);
        // No notify - UI already updated by drag
    }

    // ===== LIFECYCLE / PERSISTENCE =====

    /**
     * Load layers from IndexedDB to in-memory cache
     * @param {string} mapName - Map name
     */
    async loadLayersToMemory(mapName) {
        try {
            // Flush any pending debounced writes before reading from IndexedDB
            await this._layersPersist.flush(mapName);
            await this._activeLayerPersist.flush(mapName);

            const layersArray = await getLayersRepo(mapName);
            const activeId = await getActiveLayerIdRepo(mapName);

            const layersMap = new Map();
            layersArray.forEach((layer, index) => {
                // Ensure order exists
                if (layer.order === undefined) {
                    layer.order = index;
                }
                layersMap.set(layer.id, layer);
            });

            this.memoryStore.layers[mapName] = layersMap;
            this.memoryStore.activeLayerId = activeId;

        } catch (error) {
            console.warn(`Error loading layers for map ${mapName}:`, error);
            this._ensureMapLayersExist(mapName);
        }
    }

    /**
     * Duplicate layers from one map to another
     * @param {string} sourceMapName - Source map name
     * @param {string} targetMapName - Target map name
     * @param {Map} idMapping - ID mapping for updating layer references
     * @returns {Map} ID mapping with layer ID translations
     */
    async duplicateMapLayers(sourceMapName, targetMapName, idMapping = new Map()) {
        try {
            const sourceLayers = await getLayersRepo(sourceMapName);
            const sourceActiveId = await getActiveLayerIdRepo(sourceMapName);

            if (!sourceLayers || sourceLayers.length === 0) {
                return idMapping;
            }

            const duplicatedLayers = [];
            let newActiveId = 'default';

            const now = Date.now();
            sourceLayers.forEach(layer => {
                const newId = layer.id === 'default' ? 'default' : IDUtils.generateUniqueId('layer');

                duplicatedLayers.push({
                    ...layer,
                    id: newId,
                    createdAt: now,
                    updatedAt: now,
                    version: 1
                });

                idMapping.set(layer.id, newId);

                if (sourceActiveId === layer.id) {
                    newActiveId = newId;
                }
            });

            await setLayersRepo(targetMapName, duplicatedLayers);
            await setActiveLayerIdRepo(targetMapName, newActiveId);

            // Update memory if target is current map
            if (targetMapName === this.memoryStore.currentMap) {
                await this.loadLayersToMemory(targetMapName);
            }

            return idMapping;
        } catch (error) {
            console.error(`Error duplicating layers from ${sourceMapName} to ${targetMapName}:`, error);
            return idMapping;
        }
    }

    /**
     * Remove all layers from a map
     * @param {string} mapName - Map name
     */
    async clearMapLayers(mapName) {
        // Cancel pending debounced writes (would re-write deleted layers)
        this._layersPersist.cancel(mapName);
        this._activeLayerPersist.cancel(mapName);

        try {
            await setLayersRepo(mapName, []);

            if (this.memoryStore.layers[mapName]) {
                this.memoryStore.layers[mapName].clear();
            }
        } catch (error) {
            console.error(`Error clearing layers for map ${mapName}:`, error);
        }
    }

    /**
     * Clear the in-memory cache for layers
     */
    clearLayersCache() {
        // Cancel all pending debounced writes — clean slate
        this._layersPersist.cancelAll();
        this._activeLayerPersist.cancelAll();

        this.memoryStore.layers = {};
        this.memoryStore.activeLayerId = 'default';
    }

    // ===== PRIVATE METHODS =====

    /**
     * Emit layers-changed event via EventBus
     * @private
     */
    _notifyLayersChanged() {
        this._eventBus.emit(EventTypes.LAYERS_CHANGED, {
            mapName: this.memoryStore.currentMap
        });
    }

    /**
     * Ensure layer cache exists for a map
     * @private
     */
    _ensureMapLayersExist(mapName) {
        if (!this.memoryStore.layers) {
            this.memoryStore.layers = {};
        }
        if (!this.memoryStore.layers[mapName]) {
            const defaultLayer = getDefaultLayer();
            this.memoryStore.layers[mapName] = new Map([['default', defaultLayer]]);
        }
        if (!this.memoryStore.activeLayerId) {
            this.memoryStore.activeLayerId = 'default';
        }
    }

    /**
     * Get next order value for a new layer
     * @private
     */
    _getNextLayerOrder(mapName) {
        const layersMap = this.memoryStore.layers[mapName];
        const orders = Array.from(layersMap.values()).map(l => l.order || 0);
        const maxOrder = orders.length > 0 ? Math.max(...orders) : -1;
        return maxOrder + 1;
    }

    /**
     * Persist layers to IndexedDB via debounced write with retry.
     * Multiple rapid calls for the same map coalesce into a single IndexedDB write.
     * @private
     */
    _persistLayersAsync(mapName) {
        this._layersPersist.schedule(mapName, async () => {
            const layersMap = this.memoryStore.layers[mapName];
            if (!layersMap) return;
            const layersArray = Array.from(layersMap.values());
            await setLayersRepo(mapName, layersArray);
        });
    }

    /**
     * Persist active layer ID to IndexedDB via debounced write with retry.
     * @private
     */
    _persistActiveLayerAsync(mapName) {
        this._activeLayerPersist.schedule(mapName, async () => {
            await setActiveLayerIdRepo(mapName, this.memoryStore.activeLayerId);
        });
    }
}

/**
 * Factory function to create LayerManager instance.
 * @param {import('../events/event_bus.js').EventBus} eventBus - Event bus for notifications
 * @returns {LayerManager} New LayerManager instance
 */
export function createLayerManager(eventBus) {
    return new LayerManager(eventBus);
}

/**
 * Module-level instance holder for backward compatibility.
 * Set by services.js after initialization.
 * @type {{instance: LayerManager|null}}
 */
export const layerManagerHolder = { instance: null };

export { LayerManager };

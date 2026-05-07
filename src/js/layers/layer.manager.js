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
 * Create a DebouncedPersist with standard error handling.
 * @param {string} label - Human-readable label for error messages
 * @returns {DebouncedPersist}
 */
function createPersist(label) {
    return new DebouncedPersist({
        delay: 300,
        maxRetries: 3,
        onError: (key, error) => emitStoreError(StoreErrorEvents.STORE_PERSIST_ERROR, {
            operation: `persist ${label} [${key}]`,
            error: error.message || String(error),
            timestamp: Date.now()
        })
    });
}

/**
 * Central layer manager.
 * In-memory cache (Map) for synchronous O(1) queries,
 * asynchronous persistence to IndexedDB, events to notify changes.
 */
class LayerManager {
    /** @param {import('../events/event_bus.js').EventBus} eventBus */
    constructor(eventBus) {
        this.memoryStore = memoryStore;
        this._eventBus = eventBus;
        this._layersPersist = createPersist('layers');
        this._activeLayerPersist = createPersist('active layer');
    }

    // ===== SYNCHRONOUS READ OPERATIONS =====

    /**
     * Get all layers from a map (sorted by order).
     * @param {string} mapName - Map name (null = current map)
     * @returns {Array} Sorted array of layers
     */
    getLayers(mapName = null) {
        const targetMap = this._resolveMap(mapName);
        return Array.from(this.memoryStore.layers[targetMap].values())
            .sort((a, b) => (a.order || 0) - (b.order || 0));
    }

    /**
     * Get layer by ID - O(1) lookup.
     * @param {string} layerId
     * @param {string} mapName
     * @returns {Object|null}
     */
    getLayerById(layerId, mapName = null) {
        const targetMap = this._resolveMap(mapName);
        return this.memoryStore.layers[targetMap].get(layerId) || null;
    }

    /**
     * Get active layer ID (synchronous).
     * @returns {string}
     */
    getActiveLayerIdSync() {
        return this.memoryStore.activeLayerId || 'default';
    }

    /**
     * Get active layer object.
     * @param {string} mapName
     * @returns {Object|null}
     */
    getActiveLayer(mapName = null) {
        return this.getLayerById(this.getActiveLayerIdSync(), mapName);
    }

    /**
     * Get visible layer IDs.
     * @param {string} mapName
     * @returns {Array<string>}
     */
    getVisibleLayerIds(mapName = null) {
        return this.getLayers(mapName)
            .filter(l => l.visible)
            .map(l => l.id);
    }

    /**
     * Get unlocked layer IDs.
     * @param {string} mapName
     * @returns {Array<string>}
     */
    getUnlockedLayerIds(mapName = null) {
        return this.getLayers(mapName)
            .filter(l => !l.locked)
            .map(l => l.id);
    }

    // ===== STATE CHECKS =====

    /**
     * Check if a feature is effectively visible (considering layer).
     * @param {Object} feature
     * @param {string} mapName
     * @returns {boolean}
     */
    isFeatureEffectivelyVisible(feature, mapName = null) {
        if (!feature?.properties) return true;
        if (feature.properties.visivel === false) return false;

        const layer = this.getLayerById(feature.properties.layerId || 'default', mapName);
        return layer?.visible ?? true;
    }

    /**
     * Check if a feature is effectively locked (layer OR feature).
     * @param {Object} feature
     * @param {string} mapName
     * @returns {boolean}
     */
    isFeatureEffectivelyLocked(feature, mapName = null) {
        if (!feature?.properties) return false;
        if (feature.properties.bloqueado === true) return true;

        const layer = this.getLayerById(feature.properties.layerId || 'default', mapName);
        return layer?.locked ?? false;
    }

    // ===== WRITE OPERATIONS =====

    /**
     * Create a new layer.
     * @param {string} name - Layer name (if not provided, generates unique default name)
     * @param {string} mapName
     * @returns {Object} Created layer
     */
    createLayer(name, mapName = null) {
        return this._createLayerInternal(name, 'Nova Camada', mapName, true);
    }

    /**
     * Create a new layer for import (no event emission, no active layer change).
     * @param {string} name
     * @param {string} mapName
     * @returns {Object} Created layer
     */
    createLayerForImport(name, mapName = null) {
        return this._createLayerInternal(name, 'Importação', mapName, false);
    }

    /**
     * Delete a layer in cascade.
     * If deleting the last layer, creates a new default layer automatically.
     * @param {string} layerId
     * @param {string} mapName
     * @returns {Object} Information about the deletion
     */
    deleteLayer(layerId, mapName = null) {
        const targetMap = this._resolveMap(mapName);
        const layersMap = this.memoryStore.layers[targetMap];

        if (!layersMap.has(layerId)) {
            throw new Error(`Layer ${layerId} not found.`);
        }

        const deletedLayer = layersMap.get(layerId);
        let createdDefaultLayer = null;

        if (layersMap.size <= 1) {
            const defaultLayer = getDefaultLayer();
            if (layerId === 'default') {
                defaultLayer.id = IDUtils.generateUniqueId('layer');
            }
            layersMap.set(defaultLayer.id, defaultLayer);
            this.memoryStore.activeLayerId = defaultLayer.id;
            createdDefaultLayer = defaultLayer;
        } else if (this.memoryStore.activeLayerId === layerId) {
            this._switchActiveLayerOnDelete(layersMap, layerId);
        }

        layersMap.delete(layerId);
        this._persistLayersAsync(targetMap);
        this._persistActiveLayerAsync(targetMap);
        this._notifyLayersChanged();

        logLayerOperation(OperationType.DELETE, layerId, targetMap, null, deletedLayer);

        return { success: true, deletedLayerId: layerId, createdDefaultLayer };
    }

    /**
     * Rename a layer.
     * @param {string} layerId
     * @param {string} newName
     * @param {string} mapName
     * @returns {Object} Renamed layer
     */
    renameLayer(layerId, newName, mapName = null) {
        return this._updateLayerProperty(layerId, mapName, { name: newName });
    }

    // ===== ACTIVE LAYER =====

    /**
     * Set the active layer.
     * @param {string} layerId
     * @param {string} mapName
     * @returns {Object} Activated layer
     * @throws {Error} If the layer is locked
     */
    setActiveLayer(layerId, mapName = null) {
        const targetMap = this._resolveMap(mapName);
        const layer = this.getLayerById(layerId, targetMap);

        if (!layer) throw new Error(`Layer ${layerId} not found.`);
        if (layer.locked) throw new Error('Cannot activate a locked layer.');

        this.memoryStore.activeLayerId = layerId;
        this._persistActiveLayerAsync(targetMap);
        this._notifyLayersChanged();

        return layer;
    }

    // ===== VISIBILITY AND LOCK =====

    /**
     * Set layer visibility.
     * @param {string} layerId
     * @param {boolean} visible
     * @param {string} mapName
     * @returns {Object} Updated layer
     */
    setLayerVisibility(layerId, visible, mapName = null) {
        return this._updateLayerProperty(layerId, mapName, { visible });
    }

    /**
     * Set layer lock state.
     * @param {string} layerId
     * @param {boolean} locked
     * @param {string} mapName
     * @returns {Object} Updated layer
     */
    setLayerLocked(layerId, locked, mapName = null) {
        return this._updateLayerProperty(layerId, mapName, { locked });
    }

    /**
     * Set layer opacity (clamped to 0..1).
     * @param {string} layerId
     * @param {number} opacity
     * @param {string} mapName
     * @returns {Object} Updated layer
     */
    setLayerOpacity(layerId, opacity, mapName = null) {
        const clamped = Math.max(0, Math.min(1, Number(opacity)));
        const layer = this.getLayerById(layerId, mapName);
        if (layer && layer.opacity === clamped) return layer;
        return this._updateLayerProperty(layerId, mapName, { opacity: clamped });
    }

    /**
     * Reorder layers based on array of IDs.
     * @param {string[]} orderedLayerIds
     * @param {string} mapName
     */
    reorderLayers(orderedLayerIds, mapName = null) {
        const targetMap = this._resolveMap(mapName);
        const layersMap = this.memoryStore.layers[targetMap];

        orderedLayerIds.forEach((layerId, index) => {
            const layer = layersMap.get(layerId);
            if (layer) {
                layer.order = index;
            }
        });

        this._persistLayersAsync(targetMap);
    }

    // ===== LIFECYCLE / PERSISTENCE =====

    /**
     * Load layers from IndexedDB to in-memory cache.
     * @param {string} mapName
     */
    async loadLayersToMemory(mapName) {
        try {
            await this._layersPersist.flush(mapName);
            await this._activeLayerPersist.flush(mapName);

            const layersArray = await getLayersRepo(mapName);
            const activeId = await getActiveLayerIdRepo(mapName);

            const layersMap = new Map();
            layersArray.forEach((layer, index) => {
                if (layer.order === undefined) {
                    layer.order = index;
                }
                if (typeof layer.opacity !== 'number') {
                    layer.opacity = 1;
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
     * Duplicate layers from one map to another.
     * @param {string} sourceMapName
     * @param {string} targetMapName
     * @param {Map} idMapping
     * @returns {Map} ID mapping with layer ID translations
     */
    async duplicateMapLayers(sourceMapName, targetMapName, idMapping = new Map()) {
        try {
            const sourceLayers = await getLayersRepo(sourceMapName);
            const sourceActiveId = await getActiveLayerIdRepo(sourceMapName);

            if (!sourceLayers || sourceLayers.length === 0) {
                return idMapping;
            }

            const now = Date.now();
            let newActiveId = 'default';

            const duplicatedLayers = sourceLayers.map(layer => {
                const newId = layer.id === 'default' ? 'default' : IDUtils.generateUniqueId('layer');
                idMapping.set(layer.id, newId);
                if (sourceActiveId === layer.id) {
                    newActiveId = newId;
                }
                return { ...layer, id: newId, createdAt: now, updatedAt: now, version: 1 };
            });

            await setLayersRepo(targetMapName, duplicatedLayers);
            await setActiveLayerIdRepo(targetMapName, newActiveId);

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
     * Remove all layers from a map.
     * @param {string} mapName
     */
    async clearMapLayers(mapName) {
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
     * Clear the in-memory cache for layers.
     */
    clearLayersCache() {
        this._layersPersist.cancelAll();
        this._activeLayerPersist.cancelAll();
        this.memoryStore.layers = {};
        this.memoryStore.activeLayerId = 'default';
    }

    // ===== PRIVATE METHODS =====

    /**
     * Resolve map name, defaulting to current map, and ensure cache exists.
     * @param {string} mapName
     * @returns {string} Resolved map name
     * @private
     */
    _resolveMap(mapName) {
        const resolved = mapName || this.memoryStore.currentMap;
        this._ensureMapLayersExist(resolved);
        return resolved;
    }

    /**
     * Shared layer creation logic.
     * @param {string} name - Explicit name (may be falsy)
     * @param {string} defaultPrefix - Prefix for auto-generated name
     * @param {string} mapName
     * @param {boolean} notify - Whether to emit LAYERS_CHANGED
     * @returns {Object} Created layer
     * @private
     */
    _createLayerInternal(name, defaultPrefix, mapName, notify) {
        const targetMap = this._resolveMap(mapName);
        const layersMap = this.memoryStore.layers[targetMap];

        const layerName = name || IDUtils.generateUniqueLayerName(
            Array.from(layersMap.values()), defaultPrefix
        );

        const now = Date.now();
        const newLayer = {
            id: IDUtils.generateUniqueId('layer'),
            name: layerName,
            visible: true,
            locked: false,
            opacity: 1,
            order: this._getNextLayerOrder(targetMap),
            createdAt: now,
            updatedAt: now,
            version: 1
        };

        layersMap.set(newLayer.id, newLayer);
        this._persistLayersAsync(targetMap);
        if (notify) this._notifyLayersChanged();

        logLayerOperation(OperationType.CREATE, newLayer.id, targetMap, newLayer);
        return newLayer;
    }

    /**
     * Update one or more properties on a layer, with versioning and sync logging.
     * @param {string} layerId
     * @param {string} mapName
     * @param {Object} changes - Key/value pairs to apply
     * @returns {Object} Updated layer
     * @private
     */
    _updateLayerProperty(layerId, mapName, changes) {
        const targetMap = this._resolveMap(mapName);
        const layer = this.getLayerById(layerId, targetMap);

        if (!layer) throw new Error(`Layer ${layerId} not found.`);

        const oldLayer = { ...layer };
        Object.assign(layer, changes);
        layer.updatedAt = Date.now();
        layer.version = (oldLayer.version || 0) + 1;

        this._persistLayersAsync(targetMap);
        this._notifyLayersChanged();

        logLayerOperation(OperationType.UPDATE, layerId, targetMap, layer, oldLayer);
        return layer;
    }

    /**
     * When deleting the active layer, switch to the best alternative.
     * @param {Map} layersMap
     * @param {string} deletedId
     * @private
     */
    _switchActiveLayerOnDelete(layersMap, deletedId) {
        const remaining = Array.from(layersMap.values())
            .filter(l => l.id !== deletedId && !l.locked);

        if (remaining.length > 0) {
            this.memoryStore.activeLayerId = remaining[0].id;
            return;
        }

        const anyOther = Array.from(layersMap.values())
            .find(l => l.id !== deletedId);
        if (anyOther) {
            anyOther.locked = false;
            this.memoryStore.activeLayerId = anyOther.id;
        }
    }

    /** @private */
    _notifyLayersChanged() {
        this._eventBus.emit(EventTypes.LAYERS_CHANGED, {
            mapName: this.memoryStore.currentMap
        });
    }

    /** @private */
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

    /** @private */
    _getNextLayerOrder(mapName) {
        const values = Array.from(this.memoryStore.layers[mapName].values());
        return values.length === 0 ? 0 : Math.max(...values.map(l => l.order || 0)) + 1;
    }

    /** @private */
    _persistLayersAsync(mapName) {
        this._layersPersist.schedule(mapName, async () => {
            const layersMap = this.memoryStore.layers[mapName];
            if (!layersMap) return;
            await setLayersRepo(mapName, Array.from(layersMap.values()));
        });
    }

    /** @private */
    _persistActiveLayerAsync(mapName) {
        this._activeLayerPersist.schedule(mapName, async () => {
            await setActiveLayerIdRepo(mapName, this.memoryStore.activeLayerId);
        });
    }
}

/**
 * Factory function to create LayerManager instance.
 * @param {import('../events/event_bus.js').EventBus} eventBus
 * @returns {LayerManager}
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

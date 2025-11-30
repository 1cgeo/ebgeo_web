// Path: src/js/controls_sig/layer_manager.js
import { memoryStore, setMapLayers, getMapLayers } from './store/repository.js';
import { IDUtils } from './id_utils.js';

/**
 * Central layer manager
 * Follows the same pattern as GroupManager:
 * - In-memory cache for synchronous queries
 * - Asynchronous persistence to IndexedDB
 * - Events to notify changes
 */
export class LayerManager {
    constructor() {
        this.memoryStore = memoryStore;
    }

    // ===== MAIN OPERATIONS =====

    /**
     * Create a new layer
     * @param {string} name - Layer name
     * @param {string} mapName - Map name (null = current map)
     * @returns {Object} Created layer
     */
    createLayer(name, mapName = null) {
        const targetMap = mapName || this.memoryStore.currentMap;
        this._ensureMapLayersExist(targetMap);

        const layerId = IDUtils.generateUniqueId();
        const order = this._getNextLayerOrder(targetMap);

        const newLayer = {
            id: layerId,
            name: name || 'Nova Camada',
            visible: true,
            locked: false,
            order: order,
            createdAt: Date.now()
        };

        this.memoryStore.layers[targetMap][layerId] = newLayer;
        this._saveLayersToDBAsync(targetMap);
        this._notifyLayersChanged();

        return newLayer;
    }

    /**
     * Delete a layer in cascade
     * - Deletes all features from the layer
     * - Removes features from groups (groups with <2 features are deleted)
     * @param {string} layerId - Layer ID to delete
     * @param {string} mapName - Map name
     * @returns {Object} Information about the deletion
     */
    deleteLayer(layerId, mapName = null) {
        const targetMap = mapName || this.memoryStore.currentMap;
        this._ensureMapLayersExist(targetMap);

        const layers = this.memoryStore.layers[targetMap];

        if (!layers[layerId]) {
            throw new Error(`Layer ${layerId} not found.`);
        }

        const layerCount = Object.keys(layers).length;
        if (layerCount <= 1) {
            throw new Error('Cannot delete the last layer.');
        }

        if (this.memoryStore.activeLayerId === layerId) {
            const otherLayers = Object.values(layers).filter(l => l.id !== layerId && !l.locked);
            if (otherLayers.length > 0) {
                this.setActiveLayer(otherLayers[0].id, targetMap);
            } else {
                const anyOther = Object.values(layers).find(l => l.id !== layerId);
                if (anyOther) {
                    anyOther.locked = false;
                    this.setActiveLayer(anyOther.id, targetMap);
                }
            }
        }

        delete layers[layerId];
        this._saveLayersToDBAsync(targetMap);
        this._notifyLayersChanged();

        return { success: true, deletedLayerId: layerId };
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
        this._ensureMapLayersExist(targetMap);

        const layer = this.memoryStore.layers[targetMap][layerId];
        if (!layer) {
            throw new Error(`Layer ${layerId} not found.`);
        }

        layer.name = newName;
        this._saveLayersToDBAsync(targetMap);
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
        this._ensureMapLayersExist(targetMap);

        const layer = this.memoryStore.layers[targetMap][layerId];
        if (!layer) {
            throw new Error(`Layer ${layerId} not found.`);
        }

        layer.visible = visible;
        this._saveLayersToDBAsync(targetMap);
        this._notifyLayersChanged();

        return layer;
    }

    /**
     * Set layer lock state
     * @param {string} layerId - Layer ID
     * @param {boolean} locked - Lock state
     * @param {string} mapName - Map name
     * @returns {Object} Updated layer
     * @throws {Error} If trying to lock the active layer
     */
    setLayerLocked(layerId, locked, mapName = null) {
        const targetMap = mapName || this.memoryStore.currentMap;
        this._ensureMapLayersExist(targetMap);

        if (locked && this.memoryStore.activeLayerId === layerId) {
            throw new Error('Cannot lock the active layer.');
        }

        const layer = this.memoryStore.layers[targetMap][layerId];
        if (!layer) {
            throw new Error(`Layer ${layerId} not found.`);
        }

        layer.locked = locked;
        this._saveLayersToDBAsync(targetMap);
        this._notifyLayersChanged();

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
        this._ensureMapLayersExist(targetMap);

        const layer = this.memoryStore.layers[targetMap][layerId];
        if (!layer) {
            throw new Error(`Layer ${layerId} not found.`);
        }

        if (layer.locked) {
            throw new Error('Cannot activate a locked layer.');
        }

        this.memoryStore.activeLayerId = layerId;
        this._saveActiveLayerToDBAsync(targetMap);
        this._notifyLayersChanged();

        return layer;
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
        const targetMap = mapName || this.memoryStore.currentMap;
        this._ensureMapLayersExist(targetMap);

        const activeId = this.memoryStore.activeLayerId || 'default';
        return this.memoryStore.layers[targetMap][activeId] || null;
    }

    // ===== SYNCHRONOUS QUERIES =====

    /**
     * Get all layers from a map (sorted by order)
     * @param {string} mapName - Map name
     * @returns {Array} Sorted array of layers
     */
    getLayers(mapName = null) {
        const targetMap = mapName || this.memoryStore.currentMap;
        this._ensureMapLayersExist(targetMap);

        const layers = this.memoryStore.layers[targetMap];
        return Object.values(layers).sort((a, b) => (a.order || 0) - (b.order || 0));
    }

    /**
     * Get layers as object (for access by ID)
     * @param {string} mapName - Map name
     * @returns {Object} Layers object indexed by ID
     */
    getLayersObject(mapName = null) {
        const targetMap = mapName || this.memoryStore.currentMap;
        this._ensureMapLayersExist(targetMap);
        return this.memoryStore.layers[targetMap];
    }

    /**
     * Get layer by ID
     * @param {string} layerId - Layer ID
     * @param {string} mapName - Map name
     * @returns {Object|null} Layer or null
     */
    getLayerById(layerId, mapName = null) {
        const targetMap = mapName || this.memoryStore.currentMap;
        this._ensureMapLayersExist(targetMap);
        return this.memoryStore.layers[targetMap][layerId] || null;
    }

    /**
     * Get visible layer IDs
     * @param {string} mapName - Map name
     * @returns {Array} Array of visible layer IDs
     */
    getVisibleLayerIds(mapName = null) {
        const layers = this.getLayers(mapName);
        return layers.filter(l => l.visible).map(l => l.id);
    }

    /**
     * Get unlocked layer IDs
     * @param {string} mapName - Map name
     * @returns {Array} Array of unlocked layer IDs
     */
    getUnlockedLayerIds(mapName = null) {
        const layers = this.getLayers(mapName);
        return layers.filter(l => !l.locked).map(l => l.id);
    }

    // ===== STATE CHECKS =====

    /**
     * Check if a feature is effectively visible (considering layer)
     * @param {Object} feature - Feature to check
     * @param {string} mapName - Map name
     * @returns {boolean} True if feature is visible
     */
    isFeatureEffectivelyVisible(feature, mapName = null) {
        const layerId = feature.properties?.layerId || 'default';
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
        const layerId = feature.properties?.layerId || 'default';
        const layer = this.getLayerById(layerId, mapName);
        const layerLocked = layer?.locked ?? false;
        const featureLocked = feature.properties?.bloqueado ?? false;
        return layerLocked || featureLocked;
    }

    // ===== PERSISTENCE =====

    /**
     * Load layers from IndexedDB to in-memory cache
     * @param {string} mapName - Map name
     */
    async loadLayersToMemory(mapName) {
        try {
            const layersData = await getMapLayers(mapName);

            if (!layersData || Object.keys(layersData).length === 0) {
                this.memoryStore.layers[mapName] = {
                    'default': {
                        id: 'default',
                        name: 'Padrão',
                        visible: true,
                        locked: false,
                        order: 0,
                        createdAt: Date.now()
                    }
                };
                this.memoryStore.activeLayerId = 'default';
            } else {
                this.memoryStore.layers[mapName] = layersData.layers || layersData;
                this.memoryStore.activeLayerId = layersData.activeLayerId || 'default';
            }

        } catch (error) {
            console.warn(`Error loading layers from map ${mapName}:`, error);
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
            const sourceLayers = await getMapLayers(sourceMapName);

            if (!sourceLayers || Object.keys(sourceLayers).length === 0) {
                return;
            }

            const duplicatedLayers = {};
            let activeLayerId = 'default';

            Object.values(sourceLayers.layers || sourceLayers).forEach(layer => {
                const newLayerId = layer.id === 'default' ? 'default' : IDUtils.generateUniqueId();
                duplicatedLayers[newLayerId] = {
                    ...layer,
                    id: newLayerId,
                    createdAt: Date.now()
                };
                idMapping.set(layer.id, newLayerId);

                if ((sourceLayers.activeLayerId || 'default') === layer.id) {
                    activeLayerId = newLayerId;
                }
            });

            await setMapLayers(targetMapName, {
                layers: duplicatedLayers,
                activeLayerId: activeLayerId
            });

            if (targetMapName === this.memoryStore.currentMap) {
                this.memoryStore.layers[targetMapName] = duplicatedLayers;
                this.memoryStore.activeLayerId = activeLayerId;
            }

            return idMapping;
        } catch (error) {
            console.error(`Error duplicating layers from ${sourceMapName} to ${targetMapName}:`, error);
        }
    }

    /**
     * Remove all layers from a map
     * @param {string} mapName - Map name
     */
    async clearMapLayers(mapName) {
        try {
            await setMapLayers(mapName, {});
            if (this.memoryStore.layers[mapName]) {
                delete this.memoryStore.layers[mapName];
            }
        } catch (error) {
            console.error(`Error clearing layers from map ${mapName}:`, error);
        }
    }

    // ===== PRIVATE METHODS =====

    _notifyLayersChanged() {
        document.dispatchEvent(new CustomEvent('layers-changed'));
    }

    _ensureMapLayersExist(mapName) {
        if (!this.memoryStore.layers) {
            this.memoryStore.layers = {};
        }
        if (!this.memoryStore.layers[mapName]) {
            this.memoryStore.layers[mapName] = {
                'default': {
                    id: 'default',
                    name: 'Padrão',
                    visible: true,
                    locked: false,
                    order: 0,
                    createdAt: Date.now()
                }
            };
        }
        if (!this.memoryStore.activeLayerId) {
            this.memoryStore.activeLayerId = 'default';
        }
    }

    _getNextLayerOrder(mapName) {
        const layers = this.memoryStore.layers[mapName];
        const maxOrder = Math.max(0, ...Object.values(layers).map(l => l.order || 0));
        return maxOrder + 1;
    }

    _saveLayersToDBAsync(mapName) {
        setTimeout(async () => {
            try {
                const layersData = this.memoryStore.layers[mapName];
                await setMapLayers(mapName, {
                    layers: layersData,
                    activeLayerId: this.memoryStore.activeLayerId
                });
            } catch (error) {
                console.error(`Error saving layers from map ${mapName}:`, error);
            }
        }, 0);
    }

    _saveActiveLayerToDBAsync(mapName) {
        this._saveLayersToDBAsync(mapName);
    }
}

const layerManagerInstance = new LayerManager();

export default layerManagerInstance;

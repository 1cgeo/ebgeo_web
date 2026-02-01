// Path: js/store/repositories/local.repository.js

/**
 * @fileoverview Local Repository implementation using IndexedDB (via LocalForage).
 *
 * This is the primary data persistence layer for EBGeo in offline/local mode.
 * It wraps all existing localforage stores and provides a unified interface.
 *
 * Key features:
 * - Encapsulates all 8 IndexedDB databases used by EBGeo
 * - Automatically adds/updates sync metadata on writes
 * - Maintains backward compatibility with existing data access patterns
 * - Prepares for future sync by tracking all modifications
 */

import localforage from 'localforage';
import { touchSyncMetadata, createSyncMetadata } from '../sync/sync-metadata.js';
import { createAtlas, isValidAtlas } from '../atlas/atlas.entity.js';

// ===== LOCALFORAGE INSTANCES =====

/**
 * Atlas store - stores the project wrapper.
 * Key: 'current_atlas' (single atlas in local mode)
 */
const atlasStore = localforage.createInstance({ name: 'ebgeo_atlas' });

/**
 * Map store - stores map data.
 * Key: mapId (UUID in v2.0, was mapName in v1.x)
 */
const mapStore = localforage.createInstance({ name: 'ebgeo_maps' });

/**
 * Image store - stores binary image blobs.
 * Key: imageId (UUID)
 */
const imageStore = localforage.createInstance({ name: 'ebgeo_images' });

/**
 * App settings store - stores application settings.
 * Key: setting name
 */
const appStore = localforage.createInstance({ name: 'ebgeo_app_settings' });

/**
 * Group store - stores feature groups.
 * Key: mapId
 */
const groupStore = localforage.createInstance({ name: 'ebgeo_groups' });

/**
 * Layer store - stores layer definitions.
 * Key: 'layers_' + mapId or 'activeLayer_' + mapId
 */
const layerStore = localforage.createInstance({ name: 'ebgeo_layers' });

/**
 * Cesium 3D store - stores 3D viewer data.
 * Key: 'cesium3d_' + mapId
 */
const cesium3dStore = localforage.createInstance({ name: 'ebgeo_cesium3d' });

/**
 * Street View 360 store - stores 360 panorama data.
 * Key: 'streetview360_' + mapId
 */
const streetview360Store = localforage.createInstance({ name: 'ebgeo_streetview360' });

/**
 * Briefings store - stores briefing/story map data.
 * Key: briefingId (UUID)
 */
const briefingStore = localforage.createInstance({ name: 'ebgeo_briefings' });

// ===== HELPER FUNCTIONS =====

/**
 * Returns empty map data structure.
 * Exported for use by migration and other modules.
 * @returns {Object} Empty map data
 */
export function getEmptyMapData() {
    return {
        id: null,
        name: 'Novo Mapa',
        sync: createSyncMetadata(null),
        baseLayer: 'carta-topografica',
        analysisLayers: {},
        features: {
            polygons: [],
            lines: [],
            points: [],
            texts: [],
            images: [],
            los: [],
            visibility: [],
            processed_los: [],
            processed_visibility: [],
            brushes: [],
            rectangles: [],
            circles: [],
            ellipses: [],
            arrows: [],
            boundarys: [],
            occupied_fronts: [],
            military_symbols: [],
            setores: [],
            coordenadas: [],
            coordination_measures: []
        },
        zoom: null,
        center_lat: null,
        center_long: null,
        bearing: null,
        pitch: null
    };
}

/**
 * Returns empty Cesium 3D data structure.
 * @returns {Object} Empty cesium3d data
 */
function getEmptyCesium3dData() {
    return {
        cameraPositions: {},
        markers: [],
        measurements: [],
        viewsheds: []
    };
}

/**
 * Returns empty Street View 360 data structure.
 * @returns {Object} Empty streetview360 data
 */
function getEmptyStreetview360Data() {
    return {
        orientations: {},
        markers: []
    };
}

/**
 * Returns default layer structure.
 * @returns {Object} Default layer
 */
function getDefaultLayer() {
    return {
        id: 'default',
        name: 'Padrão',
        visible: true,
        locked: false,
        order: 0,
        createdAt: Date.now()
    };
}

// ===== LOCAL REPOSITORY CLASS =====

/**
 * Local Repository implementation using IndexedDB.
 * Implements the IRepository interface.
 */
export class LocalRepository {

    // ===== ATLAS OPERATIONS =====

    /**
     * Gets the current Atlas.
     * @returns {Promise<import('../atlas/atlas.entity.js').Atlas|null>}
     */
    async getAtlas() {
        return await atlasStore.getItem('current_atlas');
    }

    /**
     * Saves the Atlas.
     * @param {import('../atlas/atlas.entity.js').Atlas} atlas
     * @returns {Promise<void>}
     */
    async saveAtlas(atlas) {
        if (!isValidAtlas(atlas)) {
            throw new Error('Invalid Atlas structure');
        }
        atlas.sync = touchSyncMetadata(atlas.sync);
        await atlasStore.setItem('current_atlas', atlas);
    }

    /**
     * Creates a new Atlas if none exists.
     * @param {string} [name='Meu Atlas']
     * @returns {Promise<import('../atlas/atlas.entity.js').Atlas>}
     */
    async ensureAtlas(name = 'Meu Atlas') {
        let atlas = await this.getAtlas();
        if (!atlas) {
            atlas = createAtlas(name);
            await atlasStore.setItem('current_atlas', atlas);
        }
        return atlas;
    }

    // ===== KEY RESOLUTION =====

    /**
     * Resolves a map key by trying direct lookup first, then searching by name.
     * @private
     * @param {string} mapIdOrName - Map ID or name
     * @returns {Promise<string>} Resolved map key
     */
    async _resolveMapKey(mapIdOrName) {
        // Try direct lookup in maps
        const directMap = await mapStore.getItem(mapIdOrName);
        if (directMap) return mapIdOrName;

        // Search for a map with matching name
        const keys = await mapStore.keys();
        for (const key of keys) {
            const mapData = await mapStore.getItem(key);
            if (mapData && mapData.name === mapIdOrName) {
                return key; // Return the actual key (ID)
            }
        }

        // Return original as fallback
        return mapIdOrName;
    }

    // ===== MAP OPERATIONS =====

    /**
     * Gets a map by ID or name (with fallback).
     * Tries the provided key first, then falls back to searching all maps.
     * @param {string} mapIdOrName - Map ID or name
     * @returns {Promise<Object|null>}
     */
    async getMap(mapIdOrName) {
        // Try direct lookup first
        const directResult = await mapStore.getItem(mapIdOrName);
        if (directResult) return directResult;

        // Fallback: search all maps for matching ID or name
        const keys = await mapStore.keys();
        for (const key of keys) {
            const mapData = await mapStore.getItem(key);
            if (mapData) {
                // Check if the stored map's name or id matches what we're looking for
                if (mapData.name === mapIdOrName || mapData.id === mapIdOrName) {
                    return mapData;
                }
            }
        }

        return null;
    }

    /**
     * Gets a map by ID only (no fallback).
     * Use this when you're sure you have a valid ID.
     * @param {string} mapId - Map ID
     * @returns {Promise<Object|null>}
     */
    async getMapById(mapId) {
        return await mapStore.getItem(mapId);
    }

    /**
     * Gets all maps.
     * @returns {Promise<Map<string, Object>>}
     */
    async getAllMaps() {
        const maps = new Map();
        const keys = await mapStore.keys();
        for (const key of keys) {
            const data = await mapStore.getItem(key);
            if (data) {
                maps.set(key, data);
            }
        }
        return maps;
    }

    /**
     * Gets all map IDs.
     * @returns {Promise<string[]>}
     */
    async getAllMapIds() {
        return await mapStore.keys();
    }

    /**
     * Saves a map.
     * If mapIdOrName resolves to an existing map, updates it.
     * Otherwise, creates a new entry with the provided key.
     * @param {string} mapIdOrName - Map ID or name
     * @param {Object} data
     * @returns {Promise<void>}
     */
    async saveMap(mapIdOrName, data) {
        // Try to resolve to existing map key
        const resolvedKey = await this._resolveMapKey(mapIdOrName);
        const mapData = { ...data, id: resolvedKey };

        // Ensure name is set
        if (!mapData.name) {
            mapData.name = mapIdOrName;
        }

        if (mapData.sync) {
            mapData.sync = touchSyncMetadata(mapData.sync);
        } else {
            mapData.sync = createSyncMetadata(null);
        }
        await mapStore.setItem(resolvedKey, mapData);
    }

    /**
     * Deletes a map and all associated data.
     * @param {string} mapIdOrName - Map ID or name
     * @returns {Promise<void>}
     */
    async deleteMap(mapIdOrName) {
        const resolvedKey = await this._resolveMapKey(mapIdOrName);

        // Remove main map data
        await mapStore.removeItem(resolvedKey);

        // Remove associated data with resolved key
        await groupStore.removeItem(resolvedKey);
        await layerStore.removeItem(`layers_${resolvedKey}`);
        await layerStore.removeItem(`activeLayer_${resolvedKey}`);
        await cesium3dStore.removeItem(`cesium3d_${resolvedKey}`);
        await streetview360Store.removeItem(`streetview360_${resolvedKey}`);

        // Also try to remove with original key if different (legacy cleanup)
        if (resolvedKey !== mapIdOrName) {
            await mapStore.removeItem(mapIdOrName);
            await groupStore.removeItem(mapIdOrName);
            await layerStore.removeItem(`layers_${mapIdOrName}`);
            await layerStore.removeItem(`activeLayer_${mapIdOrName}`);
            await cesium3dStore.removeItem(`cesium3d_${mapIdOrName}`);
            await streetview360Store.removeItem(`streetview360_${mapIdOrName}`);
        }
    }

    // ===== IMAGE OPERATIONS =====

    /**
     * Saves an image blob.
     * @param {string} imageId
     * @param {Blob} blob
     * @returns {Promise<void>}
     */
    async saveImage(imageId, blob) {
        await imageStore.setItem(imageId, blob);
    }

    /**
     * Gets an image blob.
     * @param {string} imageId
     * @returns {Promise<Blob|null>}
     */
    async getImage(imageId) {
        return await imageStore.getItem(imageId);
    }

    /**
     * Deletes an image.
     * @param {string} imageId
     * @returns {Promise<void>}
     */
    async deleteImage(imageId) {
        await imageStore.removeItem(imageId);
    }

    /**
     * Checks if an image exists.
     * @param {string} imageId
     * @returns {Promise<boolean>}
     */
    async hasImage(imageId) {
        try {
            const image = await imageStore.getItem(imageId);
            return image !== null;
        } catch {
            return false;
        }
    }

    // ===== LAYER OPERATIONS =====

    /**
     * Gets layers for a map.
     * @param {string} mapIdOrName - Map ID or name
     * @returns {Promise<Array>}
     */
    async getLayers(mapIdOrName) {
        const resolvedKey = await this._resolveMapKey(mapIdOrName);
        const key = `layers_${resolvedKey}`;
        let layers = await layerStore.getItem(key);

        // Fallback: try with original key if resolved key didn't work
        if (!layers && resolvedKey !== mapIdOrName) {
            const fallbackKey = `layers_${mapIdOrName}`;
            layers = await layerStore.getItem(fallbackKey);
        }

        if (!layers || layers.length === 0) {
            return [getDefaultLayer()];
        }
        return layers;
    }

    /**
     * Saves layers for a map.
     * @param {string} mapIdOrName - Map ID or name
     * @param {Array} layers
     * @returns {Promise<void>}
     */
    async saveLayers(mapIdOrName, layers) {
        const resolvedKey = await this._resolveMapKey(mapIdOrName);
        const key = `layers_${resolvedKey}`;
        await layerStore.setItem(key, layers);
    }

    /**
     * Gets active layer ID for a map.
     * @param {string} mapIdOrName - Map ID or name
     * @returns {Promise<string>}
     */
    async getActiveLayerId(mapIdOrName) {
        const resolvedKey = await this._resolveMapKey(mapIdOrName);
        const key = `activeLayer_${resolvedKey}`;
        let activeId = await layerStore.getItem(key);

        // Fallback: try with original key if resolved key didn't work
        if (!activeId && resolvedKey !== mapIdOrName) {
            const fallbackKey = `activeLayer_${mapIdOrName}`;
            activeId = await layerStore.getItem(fallbackKey);
        }

        return activeId || 'default';
    }

    /**
     * Saves active layer ID for a map.
     * @param {string} mapIdOrName - Map ID or name
     * @param {string} layerId
     * @returns {Promise<void>}
     */
    async saveActiveLayerId(mapIdOrName, layerId) {
        const resolvedKey = await this._resolveMapKey(mapIdOrName);
        const key = `activeLayer_${resolvedKey}`;
        await layerStore.setItem(key, layerId);
    }

    // ===== GROUP OPERATIONS =====

    /**
     * Gets groups for a map.
     * @param {string} mapIdOrName - Map ID or name
     * @returns {Promise<Object>}
     */
    async getGroups(mapIdOrName) {
        const resolvedKey = await this._resolveMapKey(mapIdOrName);
        let groups = await groupStore.getItem(resolvedKey);

        // Fallback: try with original key if resolved key didn't work
        if (!groups && resolvedKey !== mapIdOrName) {
            groups = await groupStore.getItem(mapIdOrName);
        }

        return groups || {};
    }

    /**
     * Saves groups for a map.
     * @param {string} mapIdOrName - Map ID or name
     * @param {Object} groups
     * @returns {Promise<void>}
     */
    async saveGroups(mapIdOrName, groups) {
        const resolvedKey = await this._resolveMapKey(mapIdOrName);
        await groupStore.setItem(resolvedKey, groups);
    }

    // ===== CESIUM 3D OPERATIONS =====

    /**
     * Gets Cesium 3D data for a map.
     * @param {string} mapIdOrName - Map ID or name
     * @returns {Promise<Object>}
     */
    async getCesium3d(mapIdOrName) {
        const resolvedKey = await this._resolveMapKey(mapIdOrName);
        const key = `cesium3d_${resolvedKey}`;
        let data = await cesium3dStore.getItem(key);

        // Fallback: try with original key if resolved key didn't work
        if (!data && resolvedKey !== mapIdOrName) {
            const fallbackKey = `cesium3d_${mapIdOrName}`;
            data = await cesium3dStore.getItem(fallbackKey);
        }

        return data || getEmptyCesium3dData();
    }

    /**
     * Saves Cesium 3D data for a map.
     * @param {string} mapIdOrName - Map ID or name
     * @param {Object} data
     * @returns {Promise<void>}
     */
    async saveCesium3d(mapIdOrName, data) {
        const resolvedKey = await this._resolveMapKey(mapIdOrName);
        const key = `cesium3d_${resolvedKey}`;
        await cesium3dStore.setItem(key, data);
    }

    // ===== STREET VIEW 360 OPERATIONS =====

    /**
     * Gets Street View 360 data for a map.
     * @param {string} mapIdOrName - Map ID or name
     * @returns {Promise<Object>}
     */
    async getStreetview360(mapIdOrName) {
        const resolvedKey = await this._resolveMapKey(mapIdOrName);
        const key = `streetview360_${resolvedKey}`;
        let data = await streetview360Store.getItem(key);

        // Fallback: try with original key if resolved key didn't work
        if (!data && resolvedKey !== mapIdOrName) {
            const fallbackKey = `streetview360_${mapIdOrName}`;
            data = await streetview360Store.getItem(fallbackKey);
        }

        return data || getEmptyStreetview360Data();
    }

    /**
     * Saves Street View 360 data for a map.
     * @param {string} mapIdOrName - Map ID or name
     * @param {Object} data
     * @returns {Promise<void>}
     */
    async saveStreetview360(mapIdOrName, data) {
        const resolvedKey = await this._resolveMapKey(mapIdOrName);
        const key = `streetview360_${resolvedKey}`;
        await streetview360Store.setItem(key, data);
    }

    // ===== SETTINGS OPERATIONS =====

    /**
     * Gets a setting.
     * @param {string} key
     * @returns {Promise<any>}
     */
    async getSetting(key) {
        return await appStore.getItem(key);
    }

    /**
     * Saves a setting.
     * @param {string} key
     * @param {any} value
     * @returns {Promise<void>}
     */
    async saveSetting(key, value) {
        await appStore.setItem(key, value);
    }

    /**
     * Deletes a setting.
     * @param {string} key
     * @returns {Promise<void>}
     */
    async deleteSetting(key) {
        await appStore.removeItem(key);
    }

    // ===== BRIEFING OPERATIONS =====

    /**
     * Gets all briefings.
     * @returns {Promise<Array>} Array of briefings sorted by updatedAt desc
     */
    async getAllBriefings() {
        const briefings = [];
        const keys = await briefingStore.keys();
        for (const key of keys) {
            const data = await briefingStore.getItem(key);
            if (data) {
                briefings.push(data);
            }
        }
        // Sort by updatedAt descending (most recent first)
        briefings.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        return briefings;
    }

    /**
     * Gets a briefing by ID.
     * @param {string} briefingId
     * @returns {Promise<Object|null>}
     */
    async getBriefing(briefingId) {
        return await briefingStore.getItem(briefingId);
    }

    /**
     * Saves a briefing.
     * @param {string} briefingId
     * @param {Object} data
     * @returns {Promise<void>}
     */
    async saveBriefing(briefingId, data) {
        const briefingData = {
            ...data,
            id: briefingId,
            updatedAt: Date.now()
        };
        if (!briefingData.createdAt) {
            briefingData.createdAt = Date.now();
        }
        await briefingStore.setItem(briefingId, briefingData);
    }

    /**
     * Deletes a briefing.
     * @param {string} briefingId
     * @returns {Promise<void>}
     */
    async deleteBriefing(briefingId) {
        await briefingStore.removeItem(briefingId);
    }

    // ===== BULK OPERATIONS =====

    /**
     * Clears all data from all stores.
     * Use with caution!
     * @returns {Promise<void>}
     */
    async clearAll() {
        await atlasStore.clear();
        await mapStore.clear();
        await imageStore.clear();
        await appStore.clear();
        await groupStore.clear();
        await layerStore.clear();
        await cesium3dStore.clear();
        await streetview360Store.clear();
        await briefingStore.clear();
    }
}

/**
 * Singleton instance of LocalRepository.
 */
export const localRepository = new LocalRepository();

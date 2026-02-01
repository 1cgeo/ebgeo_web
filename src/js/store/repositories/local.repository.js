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

    // ===== MAP OPERATIONS =====

    /**
     * Gets a map by ID.
     * @param {string} mapId
     * @returns {Promise<Object|null>}
     */
    async getMap(mapId) {
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
     * @param {string} mapId
     * @param {Object} data
     * @returns {Promise<void>}
     */
    async saveMap(mapId, data) {
        const mapData = { ...data, id: mapId };
        if (mapData.sync) {
            mapData.sync = touchSyncMetadata(mapData.sync);
        } else {
            mapData.sync = createSyncMetadata(null);
        }
        await mapStore.setItem(mapId, mapData);
    }

    /**
     * Deletes a map and all associated data.
     * @param {string} mapId
     * @returns {Promise<void>}
     */
    async deleteMap(mapId) {
        await mapStore.removeItem(mapId);
        await groupStore.removeItem(mapId);
        await layerStore.removeItem(`layers_${mapId}`);
        await layerStore.removeItem(`activeLayer_${mapId}`);
        await cesium3dStore.removeItem(`cesium3d_${mapId}`);
        await streetview360Store.removeItem(`streetview360_${mapId}`);
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
     * @param {string} mapId
     * @returns {Promise<Array>}
     */
    async getLayers(mapId) {
        const key = `layers_${mapId}`;
        const layers = await layerStore.getItem(key);
        if (!layers || layers.length === 0) {
            return [getDefaultLayer()];
        }
        return layers;
    }

    /**
     * Saves layers for a map.
     * @param {string} mapId
     * @param {Array} layers
     * @returns {Promise<void>}
     */
    async saveLayers(mapId, layers) {
        const key = `layers_${mapId}`;
        await layerStore.setItem(key, layers);
    }

    /**
     * Gets active layer ID for a map.
     * @param {string} mapId
     * @returns {Promise<string>}
     */
    async getActiveLayerId(mapId) {
        const key = `activeLayer_${mapId}`;
        const activeId = await layerStore.getItem(key);
        return activeId || 'default';
    }

    /**
     * Saves active layer ID for a map.
     * @param {string} mapId
     * @param {string} layerId
     * @returns {Promise<void>}
     */
    async saveActiveLayerId(mapId, layerId) {
        const key = `activeLayer_${mapId}`;
        await layerStore.setItem(key, layerId);
    }

    // ===== GROUP OPERATIONS =====

    /**
     * Gets groups for a map.
     * @param {string} mapId
     * @returns {Promise<Object>}
     */
    async getGroups(mapId) {
        return await groupStore.getItem(mapId) || {};
    }

    /**
     * Saves groups for a map.
     * @param {string} mapId
     * @param {Object} groups
     * @returns {Promise<void>}
     */
    async saveGroups(mapId, groups) {
        await groupStore.setItem(mapId, groups);
    }

    // ===== CESIUM 3D OPERATIONS =====

    /**
     * Gets Cesium 3D data for a map.
     * @param {string} mapId
     * @returns {Promise<Object>}
     */
    async getCesium3d(mapId) {
        const key = `cesium3d_${mapId}`;
        return await cesium3dStore.getItem(key) || getEmptyCesium3dData();
    }

    /**
     * Saves Cesium 3D data for a map.
     * @param {string} mapId
     * @param {Object} data
     * @returns {Promise<void>}
     */
    async saveCesium3d(mapId, data) {
        const key = `cesium3d_${mapId}`;
        await cesium3dStore.setItem(key, data);
    }

    // ===== STREET VIEW 360 OPERATIONS =====

    /**
     * Gets Street View 360 data for a map.
     * @param {string} mapId
     * @returns {Promise<Object>}
     */
    async getStreetview360(mapId) {
        const key = `streetview360_${mapId}`;
        return await streetview360Store.getItem(key) || getEmptyStreetview360Data();
    }

    /**
     * Saves Street View 360 data for a map.
     * @param {string} mapId
     * @param {Object} data
     * @returns {Promise<void>}
     */
    async saveStreetview360(mapId, data) {
        const key = `streetview360_${mapId}`;
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
    }
}

/**
 * Singleton instance of LocalRepository.
 */
export const localRepository = new LocalRepository();

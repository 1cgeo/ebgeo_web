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
import { mapResolver } from '../services/map-resolver.service.js';
import { isValidUUID } from '../../utilities/uuid.js';

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
    const now = Date.now();
    return {
        id: 'default',
        name: 'Padrão',
        visible: true,
        locked: false,
        order: 0,
        createdAt: now,
        updatedAt: now,
        version: 1
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
     * Resolves a map key by trying cache first, then direct lookup, then scanning.
     * O(1) when resolver cache is populated; falls back to O(N) scan on miss.
     * @private
     * @param {string} mapIdOrName - Map ID or name
     * @returns {Promise<string>} Resolved map key
     */
    async _resolveMapKey(mapIdOrName) {
        // Fast path: UUID goes straight to IndexedDB (most common in v2.0+)
        if (isValidUUID(mapIdOrName)) {
            return mapIdOrName;
        }

        // Fast path: use resolver cache for name → ID
        if (mapResolver.isInitialized) {
            const resolvedId = mapResolver.resolveToId(mapIdOrName);
            if (resolvedId !== mapIdOrName) {
                return resolvedId;
            }
        }

        // Direct lookup (handles legacy name-as-key data)
        const directMap = await mapStore.getItem(mapIdOrName);
        if (directMap) return mapIdOrName;

        // Slow path: full scan (populates resolver on hit for future O(1) lookups)
        const keys = await mapStore.keys();
        for (const key of keys) {
            const mapData = await mapStore.getItem(key);
            if (mapData && mapData.name === mapIdOrName) {
                mapResolver.registerMap(mapIdOrName, key);
                return key;
            }
        }

        return mapIdOrName;
    }

    // ===== MAP OPERATIONS =====

    /**
     * Gets a map by ID or name.
     * Uses resolver cache for O(1) name resolution; falls back to scan on miss.
     * @param {string} mapIdOrName - Map ID or name
     * @returns {Promise<Object|null>}
     */
    async getMap(mapIdOrName) {
        // Direct lookup (works for UUID keys and legacy name keys)
        const directResult = await mapStore.getItem(mapIdOrName);
        if (directResult) return directResult;

        // Fast path: resolve name → ID via cache
        if (mapResolver.isInitialized) {
            const resolvedId = mapResolver.resolveToId(mapIdOrName);
            if (resolvedId !== mapIdOrName) {
                const cachedResult = await mapStore.getItem(resolvedId);
                if (cachedResult) return cachedResult;
            }
        }

        // Slow path: full scan (populates resolver on hit)
        const keys = await mapStore.keys();
        for (const key of keys) {
            const mapData = await mapStore.getItem(key);
            if (mapData && (mapData.name === mapIdOrName || mapData.id === mapIdOrName)) {
                if (mapData.name) {
                    mapResolver.registerMap(mapData.name, key);
                }
                return mapData;
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

    /**
     * Renames a map by updating its name property.
     * The map UUID (key) remains unchanged.
     *
     * For v2.0+, maps are keyed by UUID and this method only updates the display name.
     * For legacy data (keyed by name), it transfers all associated data to maintain
     * backward compatibility during migration.
     *
     * @param {string} mapIdOrOldName - Map UUID or legacy name
     * @param {string} newName - New display name
     * @returns {Promise<void>}
     */
    async renameMap(mapIdOrOldName, newName) {
        // Try to resolve to the actual map key (could be UUID or legacy name)
        const resolvedKey = await this._resolveMapKey(mapIdOrOldName);
        const mapData = await mapStore.getItem(resolvedKey);
        if (!mapData) return;

        // Check if the map is using UUID-based storage (v2.0+)
        const isUuidBased = mapData.id && mapData.id === resolvedKey;

        if (isUuidBased) {
            // v2.0+: Simply update the name property, keep UUID as key
            mapData.name = newName;
            mapData.sync = touchSyncMetadata(mapData.sync);
            await mapStore.setItem(resolvedKey, mapData);
        } else {
            // Legacy: Transfer data from old name key to new name key
            // This path handles legacy data during migration
            mapData.name = newName;
            mapData.sync = touchSyncMetadata(mapData.sync);
            await mapStore.setItem(newName, mapData);
            await mapStore.removeItem(resolvedKey);

            // Transfer color usage
            const colorData = await appStore.getItem(`color_usage_${resolvedKey}`);
            if (colorData && Object.keys(colorData).length > 0) {
                await appStore.setItem(`color_usage_${newName}`, colorData);
                await appStore.removeItem(`color_usage_${resolvedKey}`);
            }

            // Transfer notes
            const notesData = await appStore.getItem(`map_notes_${resolvedKey}`);
            if (notesData && (notesData.title || notesData.description)) {
                await appStore.setItem(`map_notes_${newName}`, notesData);
                await appStore.removeItem(`map_notes_${resolvedKey}`);
            }

            // Transfer groups
            const groupsData = await groupStore.getItem(resolvedKey);
            if (groupsData && Object.keys(groupsData).length > 0) {
                await groupStore.setItem(newName, groupsData);
                await groupStore.removeItem(resolvedKey);
            }

            // Transfer layers
            const layersData = await layerStore.getItem(`layers_${resolvedKey}`);
            const activeLayerId = await layerStore.getItem(`activeLayer_${resolvedKey}`);
            if (layersData && layersData.length > 0) {
                await layerStore.setItem(`layers_${newName}`, layersData);
                await layerStore.setItem(`activeLayer_${newName}`, activeLayerId || 'default');
                await layerStore.removeItem(`layers_${resolvedKey}`);
                await layerStore.removeItem(`activeLayer_${resolvedKey}`);
            }

            // Transfer Cesium 3D data
            const cesium3dData = await cesium3dStore.getItem(`cesium3d_${resolvedKey}`);
            if (cesium3dData && (Object.keys(cesium3dData.cameraPositions || {}).length > 0 || (cesium3dData.markers || []).length > 0)) {
                await cesium3dStore.setItem(`cesium3d_${newName}`, cesium3dData);
                await cesium3dStore.removeItem(`cesium3d_${resolvedKey}`);
            }

            // Transfer Street View 360 data
            const streetview360Data = await streetview360Store.getItem(`streetview360_${resolvedKey}`);
            if (streetview360Data && (Object.keys(streetview360Data.orientations || {}).length > 0 || (streetview360Data.markers || []).length > 0)) {
                await streetview360Store.setItem(`streetview360_${newName}`, streetview360Data);
                await streetview360Store.removeItem(`streetview360_${resolvedKey}`);
            }

            // Transfer grid style
            const gridStyle = await appStore.getItem(`gridStyle_${resolvedKey}`);
            if (gridStyle) {
                await appStore.setItem(`gridStyle_${newName}`, gridStyle);
                await appStore.removeItem(`gridStyle_${resolvedKey}`);
            }
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

    // ===== MAP NOTES OPERATIONS =====

    /**
     * Gets map notes.
     * @param {string} mapIdOrName - Map ID or name
     * @returns {Promise<{title: string, description: string}>}
     */
    async getMapNotes(mapIdOrName) {
        const resolvedKey = await this._resolveMapKey(mapIdOrName);
        const key = `map_notes_${resolvedKey}`;
        let notes = await appStore.getItem(key);

        // Fallback: try with original key if resolved key didn't work
        if (!notes && resolvedKey !== mapIdOrName) {
            const fallbackKey = `map_notes_${mapIdOrName}`;
            notes = await appStore.getItem(fallbackKey);
        }

        return notes || { title: '', description: '' };
    }

    /**
     * Saves map notes.
     * @param {string} mapIdOrName - Map ID or name
     * @param {{title: string, description: string}} notes - Notes data
     * @returns {Promise<void>}
     */
    async saveMapNotes(mapIdOrName, notes) {
        const resolvedKey = await this._resolveMapKey(mapIdOrName);
        const key = `map_notes_${resolvedKey}`;
        await appStore.setItem(key, notes);
    }

    /**
     * Deletes map notes.
     * @param {string} mapIdOrName - Map ID or name
     * @returns {Promise<void>}
     */
    async deleteMapNotes(mapIdOrName) {
        const resolvedKey = await this._resolveMapKey(mapIdOrName);
        const key = `map_notes_${resolvedKey}`;
        await appStore.removeItem(key);

        // Also try to remove with original key if different (legacy cleanup)
        if (resolvedKey !== mapIdOrName) {
            const fallbackKey = `map_notes_${mapIdOrName}`;
            await appStore.removeItem(fallbackKey);
        }
    }

    // ===== GRID STYLE OPERATIONS =====

    /**
     * Gets grid style for a map.
     * @param {string} mapIdOrName - Map ID or name
     * @returns {Promise<Object|null>}
     */
    async getGridStyle(mapIdOrName) {
        const resolvedKey = await this._resolveMapKey(mapIdOrName);
        const key = `gridStyle_${resolvedKey}`;
        let gridStyle = await appStore.getItem(key);

        // Fallback: try with original key if resolved key didn't work
        if (!gridStyle && resolvedKey !== mapIdOrName) {
            const fallbackKey = `gridStyle_${mapIdOrName}`;
            gridStyle = await appStore.getItem(fallbackKey);
        }

        return gridStyle;
    }

    /**
     * Saves grid style for a map.
     * @param {string} mapIdOrName - Map ID or name
     * @param {Object} gridStyle - Grid style data
     * @returns {Promise<void>}
     */
    async saveGridStyle(mapIdOrName, gridStyle) {
        const resolvedKey = await this._resolveMapKey(mapIdOrName);
        const key = `gridStyle_${resolvedKey}`;
        await appStore.setItem(key, gridStyle);
    }

    // ===== BRIEFING OPERATIONS =====

    /**
     * Gets all briefings.
     * @returns {Promise<Array>} Array of briefings sorted by updatedAt desc
     */
    async getAllBriefings() {
        const briefings = [];
        await briefingStore.iterate((value) => {
            if (value) {
                briefings.push(value);
            }
        });
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
        const now = Date.now();
        const briefingData = {
            ...data,
            id: briefingId
        };
        if (!briefingData.updatedAt) {
            briefingData.updatedAt = now;
        }
        if (!briefingData.createdAt) {
            briefingData.createdAt = now;
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

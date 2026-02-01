// Path: js/store/repository.js

import localforage from 'localforage';
import _config from '../config.js';
import { detectMigrationNeeded, safelyMigrate } from './migration/migration.service.js';
import { ATLAS_SCHEMA_VERSION } from './atlas/atlas.entity.js';

const SCHEMA_VERSION = '1.7';
const MIN_SCHEMA_VERSION = '1.3';
const MAX_SCHEMA_VERSION = '1.7';

// Schema version for v2.0+ (Atlas-based)
const CURRENT_SCHEMA_VERSION = ATLAS_SCHEMA_VERSION;

const mapStore = localforage.createInstance({ name: 'ebgeo_maps' });
const imageStore = localforage.createInstance({ name: 'ebgeo_images' });
const appStore = localforage.createInstance({ name: 'ebgeo_app_settings' });
const groupStore = localforage.createInstance({ name: 'ebgeo_groups' });
const layerStore = localforage.createInstance({ name: 'ebgeo_layers' });
const cesium3dStore = localforage.createInstance({ name: 'ebgeo_cesium3d' });
const streetview360Store = localforage.createInstance({ name: 'ebgeo_streetview360' });

const memoryStore = {
    maps: {
        'Principal': {
            undoStack: [],
            redoStack: []
        }
    },
    currentMap: 'Principal',
    isUndoing: false,
    isRedoing: false,
    groups: {},
    // Layer system cache
    layers: {},
    activeLayerId: 'default',
    // Cesium 3D cache
    cesium3d: {
        cameraPositions: {},  // { tilesetId: TilesetCameraPosition }
        markers: [],          // Cesium3DMarker[]
        measurements: [],     // Cesium3DMeasurement[]
        viewsheds: []         // Cesium3DViewshed[]
    },
    // Street View 360 cache
    streetview360: {
        orientations: {},     // { photoName: PhotoOrientation }
        markers: [],          // Marker360[]
        _mapName: null        // Current map name for cache validation
    }
};

/**
 * Returns empty map data structure
 * @returns {Object} Empty map data
 */
const getEmptyMapData = () => ({
    baseLayer: 'carta-topografica',
    // hillshadeEnabled removed - hillshade is now managed via catalogLayers
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
});

/**
 * Removes internal Mapbox metadata and keeps only essential GeoJSON data
 * @param {Object} feature - Feature to clean
 * @returns {Object|null} Cleaned feature or null if invalid
 */
function cleanFeature(feature) {
    if (!feature || !feature.type) {
        console.warn('Invalid feature provided for cleaning:', feature);
        return null;
    }

    let geometry = feature.geometry;
    if (!geometry && feature._geometry) {
        geometry = feature._geometry;
    }

    const cleanedProperties = {};
    if (feature.properties) {
        Object.keys(feature.properties).forEach(key => {
            if (!isInternalProperty(key)) {
                cleanedProperties[key] = feature.properties[key];
            }
        });
    }

    return {
        type: feature.type,
        id: feature.id,
        properties: cleanedProperties,
        geometry: geometry
    };
}

/**
 * Checks if a property is internal Mapbox metadata
 * @param {string} key - Property key
 * @returns {boolean} True if internal property
 */
function isInternalProperty(key) {
    const internalProps = [
        '_vectorTileFeature', '_pbf', '_geometry', '_keys', '_values',
        '_z', '_x', '_y',
        'layer', 'state',
        'extent', 'type'
    ];

    return internalProps.includes(key) || key.startsWith('_');
}

/**
 * Compares two version strings (format X.Y)
 * @param {string} version1 - First version
 * @param {string} version2 - Second version
 * @returns {number} -1 if v1 < v2, 0 if equal, 1 if v1 > v2
 */
const compareVersions = (version1, version2) => {
    const v1Parts = version1.split('.').map(Number);
    const v2Parts = version2.split('.').map(Number);

    for (let i = 0; i < Math.max(v1Parts.length, v2Parts.length); i++) {
        const v1Part = v1Parts[i] || 0;
        const v2Part = v2Parts[i] || 0;

        if (v1Part < v2Part) return -1;
        if (v1Part > v2Part) return 1;
    }
    return 0;
};

/**
 * Checks and cleans incompatible legacy data
 */
const checkAndCleanLegacyData = async () => {
    try {
        const currentSchemaVersion = await appStore.getItem('schemaVersion');

        if (!currentSchemaVersion || compareVersions(currentSchemaVersion, MIN_SCHEMA_VERSION) < 0) {
            await mapStore.clear();
            await imageStore.clear();
            await appStore.clear();
            await groupStore.clear();
            await layerStore.clear();
            await appStore.setItem('schemaVersion', SCHEMA_VERSION);
        }
    } catch (error) {
        console.warn('Error checking schema version:', error);
        try {
            await mapStore.clear();
            await imageStore.clear();
            await appStore.clear();
            await groupStore.clear();
            await layerStore.clear();
            await appStore.setItem('schemaVersion', SCHEMA_VERSION);
        } catch (cleanupError) {
            console.error('Critical error cleaning data:', cleanupError);
        }
    }
};

/**
 * Resets memory store to initial state
 */
const resetMemoryStore = () => {
    memoryStore.maps = {
        'Principal': {
            undoStack: [],
            redoStack: []
        }
    };
    memoryStore.currentMap = 'Principal';
    memoryStore.isUndoing = false;
    memoryStore.isRedoing = false;
    memoryStore.groups = {};
    memoryStore.layers = {};
    memoryStore.activeLayerId = 'default';
    memoryStore.cesium3d = {
        cameraPositions: {},
        markers: []
    };
    memoryStore.streetview360 = {
        orientations: {},
        markers: [],
        _mapName: null
    };
};

// ===== MAP CRUD OPERATIONS =====

const createMapData = async (mapName, mapData = null) => {
    const newMapData = mapData || getEmptyMapData();
    await mapStore.setItem(mapName, newMapData);
    return newMapData;
};

const getMapData = async (mapName) => {
    return await mapStore.getItem(mapName) || getEmptyMapData();
};

const updateMapData = async (mapName, mapData) => {
    await mapStore.setItem(mapName, mapData);
};

const deleteMapData = async (mapName) => {
    await mapStore.removeItem(mapName);
    await removeColorUsage(mapName);
    await removeMapNotes(mapName);
    await removeMapGroups(mapName);
    await removeMapLayers(mapName);
    await removeCesium3dData(mapName);
    await removeStreetview360Data(mapName);
};

const getAllMapNames = async () => {
    return await mapStore.keys();
};

const renameMapData = async (oldName, newName) => {
    const mapData = await mapStore.getItem(oldName);
    if (mapData) {
        await mapStore.setItem(newName, mapData);
        await mapStore.removeItem(oldName);

        const colorData = await getColorUsage(oldName);
        if (colorData && Object.keys(colorData).length > 0) {
            await setColorUsage(newName, colorData);
            await removeColorUsage(oldName);
        }

        const notesData = await getMapNotes(oldName);
        if (notesData && (notesData.title || notesData.description)) {
            await setMapNotes(newName, notesData);
            await removeMapNotes(oldName);
        }

        const groupsData = await getMapGroups(oldName);
        if (groupsData && Object.keys(groupsData).length > 0) {
            await setMapGroups(newName, groupsData);
            await removeMapGroups(oldName);
        }

        const layersData = await getLayers(oldName);
        const activeLayerId = await getActiveLayerId(oldName);
        if (layersData && layersData.length > 0) {
            await setLayers(newName, layersData);
            await setActiveLayerId(newName, activeLayerId);
            await removeMapLayers(oldName);
        }

        const cesium3dData = await getCesium3dData(oldName);
        if (cesium3dData && (Object.keys(cesium3dData.cameraPositions).length > 0 || cesium3dData.markers.length > 0)) {
            await setCesium3dData(newName, cesium3dData);
            await removeCesium3dData(oldName);
        }

        const streetview360Data = await getStreetview360Data(oldName);
        if (streetview360Data && (Object.keys(streetview360Data.orientations).length > 0 || streetview360Data.markers.length > 0)) {
            await setStreetview360Data(newName, streetview360Data);
            await removeStreetview360Data(oldName);
        }
    }
};

// ===== GROUP OPERATIONS =====

/**
 * Saves groups for a map to IndexedDB
 * @param {string} mapName - Map name
 * @param {Object} groupsData - Groups data
 */
const setMapGroups = async (mapName, groupsData) => {
    await groupStore.setItem(mapName, groupsData);
};

/**
 * Loads groups for a map from IndexedDB
 * @param {string} mapName - Map name
 * @returns {Object} Groups data or empty object
 */
const getMapGroups = async (mapName) => {
    return await groupStore.getItem(mapName) || {};
};

/**
 * Removes all groups for a map
 * @param {string} mapName - Map name
 */
const removeMapGroups = async (mapName) => {
    await groupStore.removeItem(mapName);
};

/**
 * Lists all maps that have groups
 * @returns {Array} Array of map names
 */
const _getAllMapsWithGroups = async () => {
    return await groupStore.keys();
};

// ===== IMAGE OPERATIONS =====

const storeImageData = async (imageId, blob) => {
    await imageStore.setItem(imageId, blob);
};

const getImageData = async (imageId) => {
    return await imageStore.getItem(imageId);
};

const removeImageData = async (imageId) => {
    await imageStore.removeItem(imageId);
};

const hasImageData = async (imageId) => {
    try {
        const image = await imageStore.getItem(imageId);
        return image !== null;
    } catch (_error) {
        return false;
    }
};

const clearAllMapData = async () => {
    await mapStore.clear();
};

const clearAllImageData = async () => {
    await imageStore.clear();
};

const clearAllGroupData = async () => {
    await groupStore.clear();
};

const clearAllLayerData = async () => {
    await layerStore.clear();
};

// ===== APP SETTINGS OPERATIONS =====

const setAppSetting = async (key, value) => {
    await appStore.setItem(key, value);
};

const getAppSetting = async (key) => {
    return await appStore.getItem(key);
};

const clearAllAppSettings = async () => {
    const allMaps = await mapStore.keys();
    for (const mapName of allMaps) {
        try {
            await removeColorUsage(mapName);
            await removeMapNotes(mapName);
            await removeMapGroups(mapName);
            await removeMapLayers(mapName);
            await removeCesium3dData(mapName);
            await removeStreetview360Data(mapName);
        } catch (error) {
            console.warn(`Error clearing data for map ${mapName}:`, error);
        }
    }

    await appStore.clear();
};

// ===== MIGRATION FUNCTIONS =====

/**
 * Migrates a single map to v1.4 (adds coordination_measures if missing)
 * @param {string} mapName - Map name
 * @param {Object} mapData - Map data
 * @returns {boolean} True if migration was performed
 */
const migrateMapTo14 = async (mapName, mapData) => {
    if (!mapData.features.coordination_measures) {
        mapData.features.coordination_measures = [];
        await mapStore.setItem(mapName, mapData);
        return true;
    }
    return false;
};

/**
 * Migrates all maps to v1.4
 */
const migrateAllMapsTo14 = async () => {
    const mapNames = await getAllMapNames();
    let migratedCount = 0;

    for (const mapName of mapNames) {
        const mapData = await mapStore.getItem(mapName);
        if (mapData) {
            const wasMigrated = await migrateMapTo14(mapName, mapData);
            if (wasMigrated) migratedCount++;
        }
    }

    if (migratedCount > 0) {
        console.log(`Migrated ${migratedCount} map(s) to v1.4`);
    }
};

/**
 * Migrates a single map to v1.5 (adds layerId: 'default' to features without layerId)
 * @param {string} mapName - Map name
 * @param {Object} mapData - Map data
 * @returns {boolean} True if migration was performed
 */
const migrateMapTo15 = async (mapName, mapData) => {
    let modified = false;
    const featureTypes = Object.keys(mapData.features);

    for (const featureType of featureTypes) {
        const features = mapData.features[featureType];
        if (!Array.isArray(features)) continue;

        for (const feature of features) {
            if (feature.properties && !feature.properties.layerId) {
                feature.properties.layerId = 'default';
                modified = true;
            }
        }
    }

    if (modified) {
        await mapStore.setItem(mapName, mapData);
    }
    return modified;
};

/**
 * Migrates all maps to v1.5
 */
const migrateAllMapsTo15 = async () => {
    const mapNames = await getAllMapNames();
    let migratedCount = 0;

    for (const mapName of mapNames) {
        const mapData = await mapStore.getItem(mapName);
        if (mapData) {
            const wasMigrated = await migrateMapTo15(mapName, mapData);
            if (wasMigrated) migratedCount++;
        }
    }

    if (migratedCount > 0) {
        console.log(`Migrated ${migratedCount} map(s) to v1.5 (added layerId to features)`);
    }
};

/**
 * Migrates a single map to v1.6 (adds attributes:{} and images:[] to features)
 * @param {string} mapName - Map name
 * @param {Object} mapData - Map data
 * @returns {boolean} True if migration was performed
 */
const migrateMapTo16 = async (mapName, mapData) => {
    if (!mapData || !mapData.features) {
        return false;
    }

    let modified = false;
    const featureTypes = Object.keys(mapData.features);

    for (const featureType of featureTypes) {
        const features = mapData.features[featureType];
        if (!Array.isArray(features)) continue;

        for (const feature of features) {
            if (feature.properties) {
                if (feature.properties.attributes === undefined) {
                    feature.properties.attributes = {};
                    modified = true;
                }
                if (feature.properties.images === undefined) {
                    feature.properties.images = [];
                    modified = true;
                }
            }
        }
    }

    if (modified) {
        await mapStore.setItem(mapName, mapData);
    }
    return modified;
};

/**
 * Migrates all maps to v1.6
 */
const migrateAllMapsTo16 = async () => {
    const mapNames = await getAllMapNames();
    let migratedCount = 0;

    for (const mapName of mapNames) {
        const mapData = await mapStore.getItem(mapName);
        if (mapData) {
            const wasMigrated = await migrateMapTo16(mapName, mapData);
            if (wasMigrated) migratedCount++;
        }
    }

    if (migratedCount > 0) {
        console.log(`Migrated ${migratedCount} map(s) to v1.6 (added attributes and images to features)`);
    }
};

/**
 * Migrates a single map to v1.7 (ensures cesium3d data exists)
 * @param {string} mapName - Map name
 * @returns {Promise<boolean>} True if migration was performed
 */
const migrateMapTo17 = async (mapName) => {
    const existingData = await getCesium3dData(mapName);
    // If data doesn't exist or is missing required properties, initialize it
    if (!existingData || existingData.cameraPositions === undefined || existingData.markers === undefined) {
        await setCesium3dData(mapName, getEmptyCesium3dData());
        return true;
    }
    return false;
};

/**
 * Migrates all maps to v1.7
 */
const migrateAllMapsTo17 = async () => {
    const mapNames = await getAllMapNames();
    let migratedCount = 0;

    for (const mapName of mapNames) {
        const wasMigrated = await migrateMapTo17(mapName);
        if (wasMigrated) migratedCount++;
    }

    if (migratedCount > 0) {
        console.log(`Migrated ${migratedCount} map(s) to v1.7 (initialized cesium3d data)`);
    }
};

// ===== INITIALIZATION =====

const initializeRepository = async () => {
    try {
        await checkAndCleanLegacyData();

        const currentSchemaVersion = await appStore.getItem('schemaVersion');

        // First, run legacy migrations (v1.3 -> v1.7) if needed
        if (currentSchemaVersion === '1.3') {
            await migrateAllMapsTo14();
            await migrateAllMapsTo15();
            await migrateAllMapsTo16();
            await migrateAllMapsTo17();
            await appStore.setItem('schemaVersion', SCHEMA_VERSION);
        } else if (currentSchemaVersion === '1.4') {
            await migrateAllMapsTo15();
            await migrateAllMapsTo16();
            await migrateAllMapsTo17();
            await appStore.setItem('schemaVersion', SCHEMA_VERSION);
        } else if (currentSchemaVersion === '1.5') {
            await migrateAllMapsTo16();
            await migrateAllMapsTo17();
            await appStore.setItem('schemaVersion', SCHEMA_VERSION);
        } else if (currentSchemaVersion === '1.6') {
            await migrateAllMapsTo17();
            await appStore.setItem('schemaVersion', SCHEMA_VERSION);
        } else if (!currentSchemaVersion) {
            await appStore.setItem('schemaVersion', SCHEMA_VERSION);
        }

        // Then, run v2.0 migration if needed (adds Atlas, sync metadata, etc.)
        const { needed } = await detectMigrationNeeded();
        if (needed) {
            console.log('Running v2.0 migration...');
            const result = await safelyMigrate();
            if (!result.success) {
                console.error('v2.0 migration failed:', result.error);
                // Continue with existing data - migration is non-blocking
            } else {
                console.log('v2.0 migration completed successfully');
            }
        }

        const allMapNames = await getAllMapNames();
        if (allMapNames.length === 0) {
            await createMapData('Principal');
            memoryStore.currentMap = 'Principal';
            return 'Principal';
        }

        const lastActiveMap = await getAppSetting('lastActiveMap');
        if (lastActiveMap && allMapNames.includes(lastActiveMap)) {
            memoryStore.currentMap = lastActiveMap;
            return lastActiveMap;
        } else {
            const firstMap = allMapNames[0];
            memoryStore.currentMap = firstMap;
            return firstMap;
        }
    } catch (error) {
        console.error('Error initializing repository:', error);
        memoryStore.currentMap = 'Principal';
        return 'Principal';
    }
};

// ===== COLOR USAGE OPERATIONS =====

const setColorUsage = async (mapName, colorUsageData) => {
    const key = `color_usage_${mapName}`;
    await appStore.setItem(key, colorUsageData);
};

const getColorUsage = async (mapName) => {
    const key = `color_usage_${mapName}`;
    return await appStore.getItem(key) || {};
};

const removeColorUsage = async (mapName) => {
    const key = `color_usage_${mapName}`;
    await appStore.removeItem(key);
};

// ===== NOTES OPERATIONS =====

const setMapNotes = async (mapName, notes) => {
    const key = `map_notes_${mapName}`;
    await appStore.setItem(key, notes);
};

const getMapNotes = async (mapName) => {
    const key = `map_notes_${mapName}`;
    return await appStore.getItem(key) || { title: '', description: '' };
};

const removeMapNotes = async (mapName) => {
    const key = `map_notes_${mapName}`;
    await appStore.removeItem(key);
};

// ===== GRID STYLE OPERATIONS =====

const setGridStyle = async (mapName, gridStyle) => {
    const key = `gridStyle_${mapName}`;
    await appStore.setItem(key, gridStyle);
};

const getGridStyle = async (mapName) => {
    const key = `gridStyle_${mapName}`;
    return await appStore.getItem(key);
};

// ===== MAP ORDER OPERATIONS =====

const getMapOrder = async () => {
    return await appStore.getItem('mapOrder') || [];
};

const setMapOrder = async (orderArray) => {
    await appStore.setItem('mapOrder', orderArray);
};

// ===== LAYER OPERATIONS =====

/**
 * Returns default layer
 * @returns {Object} Default layer object
 */
const getDefaultLayer = () => ({
    id: 'default',
    name: 'Padrão',
    visible: true,
    locked: false,
    order: 0,
    createdAt: Date.now()
});

/**
 * Saves layers for a map to IndexedDB
 * @param {string} mapName - Map name
 * @param {Array} layers - Array of layers
 */
const setLayers = async (mapName, layers) => {
    const key = `layers_${mapName}`;
    await layerStore.setItem(key, layers);
};

/**
 * Loads layers for a map from IndexedDB
 * @param {string} mapName - Map name
 * @returns {Array} Array of layers
 */
const getLayers = async (mapName) => {
    const key = `layers_${mapName}`;
    const layers = await layerStore.getItem(key);

    if (!layers || layers.length === 0) {
        return [getDefaultLayer()];
    }

    return layers;
};

/**
 * Saves active layer ID for a map
 * @param {string} mapName - Map name
 * @param {string} layerId - Active layer ID
 */
const setActiveLayerId = async (mapName, layerId) => {
    const key = `activeLayer_${mapName}`;
    await layerStore.setItem(key, layerId);
};

/**
 * Returns active layer ID for a map
 * @param {string} mapName - Map name
 * @returns {string} Active layer ID
 */
const getActiveLayerId = async (mapName) => {
    const key = `activeLayer_${mapName}`;
    const activeId = await layerStore.getItem(key);
    return activeId || 'default';
};

/**
 * Removes all layers for a map
 * @param {string} mapName - Map name
 */
const removeMapLayers = async (mapName) => {
    const layersKey = `layers_${mapName}`;
    const activeKey = `activeLayer_${mapName}`;
    await layerStore.removeItem(layersKey);
    await layerStore.removeItem(activeKey);
};

// ===== CESIUM 3D OPERATIONS =====

/**
 * Returns empty Cesium 3D data structure
 * @returns {Object} Empty cesium3d data
 */
const getEmptyCesium3dData = () => ({
    cameraPositions: {},
    markers: [],
    measurements: [],
    viewsheds: []
});

/**
 * Saves Cesium 3D data for a map to IndexedDB
 * @param {string} mapName - Map name
 * @param {Object} cesium3dData - Cesium 3D data
 */
const setCesium3dData = async (mapName, cesium3dData) => {
    const key = `cesium3d_${mapName}`;
    await cesium3dStore.setItem(key, cesium3dData);
};

/**
 * Loads Cesium 3D data for a map from IndexedDB
 * @param {string} mapName - Map name
 * @returns {Object} Cesium 3D data or empty structure
 */
const getCesium3dData = async (mapName) => {
    const key = `cesium3d_${mapName}`;
    return await cesium3dStore.getItem(key) || getEmptyCesium3dData();
};

/**
 * Removes Cesium 3D data for a map
 * @param {string} mapName - Map name
 */
const removeCesium3dData = async (mapName) => {
    const key = `cesium3d_${mapName}`;
    await cesium3dStore.removeItem(key);
};

/**
 * Clears all Cesium 3D data
 */
const clearAllCesium3dData = async () => {
    await cesium3dStore.clear();
};

// ===== STREET VIEW 360 OPERATIONS =====

/**
 * Returns empty Street View 360 data structure
 * @returns {Object} Empty streetview360 data
 */
const getEmptyStreetview360Data = () => ({
    orientations: {},
    markers: []
});

/**
 * Saves Street View 360 data for a map to IndexedDB
 * @param {string} mapName - Map name
 * @param {Object} streetview360Data - Street View 360 data
 */
const setStreetview360Data = async (mapName, streetview360Data) => {
    const key = `streetview360_${mapName}`;
    await streetview360Store.setItem(key, streetview360Data);
};

/**
 * Loads Street View 360 data for a map from IndexedDB
 * @param {string} mapName - Map name
 * @returns {Object} Street View 360 data or empty structure
 */
const getStreetview360Data = async (mapName) => {
    const key = `streetview360_${mapName}`;
    return await streetview360Store.getItem(key) || getEmptyStreetview360Data();
};

/**
 * Removes Street View 360 data for a map
 * @param {string} mapName - Map name
 */
const removeStreetview360Data = async (mapName) => {
    const key = `streetview360_${mapName}`;
    await streetview360Store.removeItem(key);
};

/**
 * Clears all Street View 360 data
 */
const clearAllStreetview360Data = async () => {
    await streetview360Store.clear();
};

// ===== EXPORTS =====

export {
    SCHEMA_VERSION,
    MIN_SCHEMA_VERSION,
    MAX_SCHEMA_VERSION,
    CURRENT_SCHEMA_VERSION,
    cleanFeature,
    isInternalProperty,
    compareVersions,
    resetMemoryStore,
    memoryStore,
    createMapData,
    getMapData,
    updateMapData,
    deleteMapData,
    getAllMapNames,
    renameMapData,
    storeImageData,
    getImageData,
    removeImageData,
    hasImageData,
    clearAllImageData,
    clearAllMapData,
    clearAllGroupData,
    clearAllLayerData,
    setAppSetting,
    getAppSetting,
    clearAllAppSettings,
    initializeRepository,
    setColorUsage,
    getColorUsage,
    removeColorUsage,
    setMapNotes,
    getMapNotes,
    removeMapNotes,
    setGridStyle,
    getGridStyle,
    getMapOrder,
    setMapOrder,
    setMapGroups,
    getMapGroups,
    setLayers,
    getLayers,
    setActiveLayerId,
    getActiveLayerId,
    getDefaultLayer,
    // Cesium 3D
    getEmptyCesium3dData,
    setCesium3dData,
    getCesium3dData,
    removeCesium3dData,
    clearAllCesium3dData,
    // Street View 360
    getEmptyStreetview360Data,
    setStreetview360Data,
    getStreetview360Data,
    removeStreetview360Data,
    clearAllStreetview360Data
};

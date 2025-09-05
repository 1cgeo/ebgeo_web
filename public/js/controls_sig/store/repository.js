// Path: js\controls_sig\store\repository.js
import config from '../../config.js';

// Schema versioning
const SCHEMA_VERSION = '1.3';
const MIN_SCHEMA_VERSION = '1.3';
const MAX_SCHEMA_VERSION = '1.3';

// LocalForage instances - PRIVADAS, não exportadas
const mapStore = localforage.createInstance({ name: 'ebgeo_maps' });
const imageStore = localforage.createInstance({ name: 'ebgeo_images' });
const appStore = localforage.createInstance({ name: 'ebgeo_app_settings' });
const groupStore = localforage.createInstance({ name: 'ebgeo_groups' }); // NOVO: Store para grupos

// Memory store - gerenciado aqui mas acessado via map-manager
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
    groups: {} // NOVO: Cache de grupos por mapa - groups[mapName] = Map<groupId, groupData>
};

/**
 * Estrutura vazia para um mapa novo
 */
const getEmptyMapData = () => ({
    baseLayer: 'carta-topografica',
    hillshadeEnabled: true,
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
        coordenadas: []
    },
    zoom: null,
    center_lat: null,
    center_long: null
});

/**
 * Remove metadados internos do Mapbox e mantém apenas dados GeoJSON essenciais
 */
function cleanFeature(feature) {
    if (!feature || !feature.type) {
        console.warn('Feature inválida fornecida para limpeza:', feature);
        return null;
    }

    // Extrair geometria correta
    let geometry = feature.geometry;
    if (!geometry && feature._geometry) {
        geometry = feature._geometry;
    }

    // Limpar propriedades removendo metadados internos do Mapbox
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
 * Verifica se uma propriedade é metadado interno do Mapbox
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
 * Função auxiliar para comparar versões simples (formato X.Y)
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
 * Verificar e limpar dados incompatíveis
 */
const checkAndCleanLegacyData = async () => {
    try {
        const currentSchemaVersion = await appStore.getItem('schemaVersion');
        
        if (!currentSchemaVersion || compareVersions(currentSchemaVersion, MIN_SCHEMA_VERSION) < 0) {

            await mapStore.clear();
            await imageStore.clear();
            await appStore.clear();
            await groupStore.clear(); // NOVO: Limpar grupos também
            await appStore.setItem('schemaVersion', SCHEMA_VERSION);

        }
    } catch (error) {
        console.warn('⚠️ Erro ao verificar versão do schema:', error);
        try {
            await mapStore.clear();
            await imageStore.clear();
            await appStore.clear();
            await groupStore.clear(); // NOVO: Limpar grupos também
            await appStore.setItem('schemaVersion', SCHEMA_VERSION);
        } catch (cleanupError) {
            console.error('❌ Erro crítico na limpeza de dados:', cleanupError);
        }
    }
};

/**
 * Resetar o estado da memória
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
    memoryStore.groups = {}; // NOVO: Resetar cache de grupos
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
    await removeMapGroups(mapName); // NOVO: Remover grupos do mapa
};

const getAllMapNames = async () => {
    return await mapStore.keys();
};

const renameMapData = async (oldName, newName) => {
    const mapData = await mapStore.getItem(oldName);
    if (mapData) {
        await mapStore.setItem(newName, mapData);
        await mapStore.removeItem(oldName);
        
        // Transferir dados de cores
        const colorData = await getColorUsage(oldName);
        if (colorData && Object.keys(colorData).length > 0) {
            await setColorUsage(newName, colorData);
            await removeColorUsage(oldName);
        }
        
        // Transferir notas
        const notesData = await getMapNotes(oldName);
        if (notesData && (notesData.title || notesData.description)) {
            await setMapNotes(newName, notesData);
            await removeMapNotes(oldName);
        }

        // NOVO: Transferir grupos
        const groupsData = await getMapGroups(oldName);
        if (groupsData && Object.keys(groupsData).length > 0) {
            await setMapGroups(newName, groupsData);
            await removeMapGroups(oldName);
        }
    }
};

// ===== GROUP OPERATIONS (NOVO) =====

/**
 * Salva grupos de um mapa no IndexedDB
 */
const setMapGroups = async (mapName, groupsData) => {
    await groupStore.setItem(mapName, groupsData);
};

/**
 * Carrega grupos de um mapa do IndexedDB
 */
const getMapGroups = async (mapName) => {
    return await groupStore.getItem(mapName) || {};
};

/**
 * Remove todos os grupos de um mapa
 */
const removeMapGroups = async (mapName) => {
    await groupStore.removeItem(mapName);
};

/**
 * Lista todos os mapas que têm grupos
 */
const getAllMapsWithGroups = async () => {
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
    } catch (error) {
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

// ===== APP SETTINGS OPERATIONS =====

const setAppSetting = async (key, value) => {
    await appStore.setItem(key, value);
};

const getAppSetting = async (key) => {
    return await appStore.getItem(key);
};

const clearAllAppSettings = async () => {
    // Limpar cores primeiro
    const allMaps = await mapStore.keys();
    for (const mapName of allMaps) {
        try {
            await removeColorUsage(mapName);
            await removeMapNotes(mapName);
            await removeMapGroups(mapName); // NOVO: Limpar grupos
        } catch (error) {
            console.warn(`Erro ao limpar dados do mapa ${mapName}:`, error);
        }
    }
    
    // Limpar settings normais
    await appStore.clear();
};

// ===== INITIALIZATION =====

const initializeRepository = async () => {
    try {
        await checkAndCleanLegacyData();

        const currentSchemaVersion = await appStore.getItem('schemaVersion');
        if (!currentSchemaVersion) {
            await appStore.setItem('schemaVersion', SCHEMA_VERSION);
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
        console.error('Erro ao inicializar repository:', error);
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

// ===== EXPORTS =====

export {
    // Constants
    SCHEMA_VERSION,
    MIN_SCHEMA_VERSION,
    MAX_SCHEMA_VERSION,
    
    // Utilities
    getEmptyMapData,
    cleanFeature,
    isInternalProperty,
    compareVersions,
    resetMemoryStore,
    
    // Memory store access
    memoryStore,
    
    // Map operations
    createMapData,
    getMapData,
    updateMapData,
    deleteMapData,
    getAllMapNames,
    renameMapData,
    
    // Image operations
    storeImageData,
    getImageData,
    removeImageData,
    hasImageData,
    clearAllImageData,
    clearAllMapData,
    clearAllGroupData, // NOVO
    
    // App settings
    setAppSetting,
    getAppSetting,
    clearAllAppSettings,
    
    // Initialization
    initializeRepository,

    // Color operations
    setColorUsage,
    getColorUsage,
    removeColorUsage,

    // Notes operations
    setMapNotes,
    getMapNotes,
    removeMapNotes,

    // Group operations (NOVO)
    setMapGroups,
    getMapGroups,
    removeMapGroups,
    getAllMapsWithGroups
};
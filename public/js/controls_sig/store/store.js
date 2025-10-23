// Path: js\controls_sig\store\store.js
import {
    SCHEMA_VERSION,
    MIN_SCHEMA_VERSION,
    MAX_SCHEMA_VERSION,
    cleanFeature,
    isInternalProperty,
    compareVersions,
    resetMemoryStore,
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
    clearAllGroupData, // NOVO
    setAppSetting,
    getAppSetting,
    clearAllAppSettings,
    initializeRepository,
    getColorUsage,
    setMapNotes as setMapNotesRepo,
    getMapNotes as getMapNotesRepo,
    removeMapNotes as removeMapNotesRepo,
    setFrameStyle as setFrameStyleRepo,
    getFrameStyle as getFrameStyleRepo,
    setGridStyle as setGridStyleRepo,
    getGridStyle as getGridStyleRepo,
} from './repository.js';

import mapManager from './map-manager.js';
import config from '../../config.js';
import groupManager from '../tool_manager/group_manager.js'; // NOVO: Instância do GroupManager

// ===== CENTRALIZED FEATURE TYPE MAPPINGS =====

export const FEATURE_TYPE_ICONS = {
    'point': './images/icon_point_black.svg',
    'line': './images/icon_line_black.svg',
    'polygon': './images/icon_polygon_black.svg',
    'text': './images/icon_text_black.svg',
    'image': './images/icon_photo_black.svg',
    'circle': './images/icon_circle_black.svg',
    'rectangle': './images/icon_rectangle_black.svg',
    'ellipse': './images/icon_ellipse_black.svg',
    'brush': './images/icon_brush_black.svg',
    'arrow': './images/icon_arrow_black.svg',
    'boundary': './images/icon_boundary_black.svg',
    'occupied_front': './images/icon_occupied_front_black.svg',
    'military_symbol': './images/icon_military_black.svg',
    'los': './images/icon_los_black.svg',
    'visibility': './images/icon_visibility_black.svg'
};

export const FEATURE_TYPE_LAYERS = {
    'point': 'points-layer',
    'line': 'lines-layer',
    'polygon': 'polygons-layer',
    'text': 'texts-layer',
    'image': 'images-layer',
    'circle': 'circles-layer',
    'rectangle': 'rectangles-layer',
    'ellipse': 'ellipses-layer',
    'brush': 'brushes-layer',
    'arrow': 'arrows-layer',
    'boundary': 'boundarys-layer',
    'occupied_front': 'occupied-fronts-layer',
    'military_symbol': 'military-symbols-layer',
    'los': 'los-layer',
    'visibility': 'visibility-layer'
};

export const FEATURE_TYPE_MAPPINGS = {
    'point': 'points',
    'line': 'lines',
    'polygon': 'polygons',
    'text': 'texts',
    'image': 'images',
    'circle': 'circles',
    'rectangle': 'rectangles',
    'ellipse': 'ellipses',
    'brush': 'brushes',
    'arrow': 'arrows',
    'boundary': 'boundarys',
    'occupied_front': 'occupied_fronts',
    'military_symbol': 'military_symbols',
    'los': 'los',
    'visibility': 'visibility'
};

export const FEATURE_DISPLAY_NAMES = {
    'point': 'Ponto',
    'line': 'Linha',
    'polygon': 'Polígono',
    'text': 'Texto',
    'image': 'Imagem',
    'circle': 'Círculo',
    'rectangle': 'Retângulo',
    'ellipse': 'Elipse',
    'brush': 'Pincel',
    'arrow': 'Seta',
    'boundary': 'Limite',
    'occupied_front': 'Frente Ocupada',
    'military_symbol': 'Símbolo Militar',
    'los': 'Linha de Visada',
    'visibility': 'Visibilidade'
};

export const UNCOPYABLE_FEATURE_TYPES = ['los', 'visibility'];
export const IMAGE_RESOURCE_FEATURE_TYPES = ['image', 'military_symbol'];

// ===== CENTRALIZED UTILITY FUNCTIONS =====

export const getStorageTypeFromSource = (sourceType) => {
    return FEATURE_TYPE_MAPPINGS[sourceType] || `${sourceType}s`;
};

export const getSourceTypeFromStorage = (storageType) => {
    for (const [sourceType, storage] of Object.entries(FEATURE_TYPE_MAPPINGS)) {
        if (storage === storageType) {
            return sourceType;
        }
    }
    return storageType.endsWith('s') ? storageType.slice(0, -1) : storageType;
};

export const getFeatureIcon = (sourceType) => {
    return FEATURE_TYPE_ICONS[sourceType];
};

export const getFeatureLayer = (sourceType) => {
    return FEATURE_TYPE_LAYERS[sourceType] || `${sourceType}-layer`;
};

export const getFeatureDisplayNameFromStorage = (storageType) => {
    const sourceType = getSourceTypeFromStorage(storageType);
    return getFeatureDisplayName(sourceType);
};

export const getFeatureIconFromStorage = (storageType) => {
    const sourceType = getSourceTypeFromStorage(storageType);
    return getFeatureIcon(sourceType);
};

export const getSelectionControlConfig = () => {
    const config = {};
    for (const sourceType of getAllSourceTypes()) {
        const storageType = getStorageTypeFromSource(sourceType);
        config[sourceType] = {
            sourceNames: [storageType]
        };
    }
    return config;
};

export const getFeatureDisplayName = (sourceType) => {
    return FEATURE_DISPLAY_NAMES[sourceType] || 'Feição';
};

export const isUncopyableFeatureType = (sourceType) => {
    return UNCOPYABLE_FEATURE_TYPES.includes(sourceType);
};

export const hasImageResource = (sourceType) => {
    return IMAGE_RESOURCE_FEATURE_TYPES.includes(sourceType);
};

export const getAllSourceTypes = () => {
    return Object.keys(FEATURE_TYPE_MAPPINGS);
};

export const getAllStorageTypes = () => {
    return Object.values(FEATURE_TYPE_MAPPINGS);
};

export const isValidSourceType = (sourceType) => {
    return sourceType in FEATURE_TYPE_MAPPINGS;
};

export const isValidStorageType = (storageType) => {
    return Object.values(FEATURE_TYPE_MAPPINGS).includes(storageType);
};

// ===== COLOR TRACKING API =====

/**
 * NOVA API: Exportar função de cores frequentes
 */
export const getFrequentColors = (limit = 10, scope = 'current') => {
    return mapManager.getFrequentColors(limit, scope);
};

// ===== NOTES MANAGEMENT =====

export const getMapNotes = async (mapName = null) => {
    const targetMap = mapName || getCurrentMapNameSync();
    return await getMapNotesRepo(targetMap);
};

export const setMapNotes = async (mapName, notes) => {
    const targetMap = mapName || getCurrentMapNameSync();
    await setMapNotesRepo(targetMap, notes);
};

// ===== FRAME STYLE MANAGEMENT =====

export const setFrameStyle = async (mapName, frameStyle) => {
    await setFrameStyleRepo(mapName, frameStyle);
};

export const getFrameStyle = async (mapName) => {
    return await getFrameStyleRepo(mapName);
};

// ===== GRID STYLE MANAGEMENT =====

export const setGridStyle = async (mapName, gridStyle) => {
    await setGridStyleRepo(mapName, gridStyle);
};

export const getGridStyle = async (mapName) => {
    return await getGridStyleRepo(mapName);
};

// ===== GROUP MANAGEMENT (NOVO) =====

/**
 * Cria um novo grupo com as features especificadas
 * @param {Array} features - Features a serem agrupadas
 * @param {string} mapName - Nome do mapa (null = atual)
 * @returns {Object} Grupo criado
 */
export const createGroup = (features, mapName = null) => {
    return groupManager.createGroup(features, mapName);
};

/**
 * Combina grupos e/ou features em um novo grupo
 * @param {Array} groupIds - IDs dos grupos a combinar
 * @param {Array} selectedFeatures - Features adicionais
 * @param {string} mapName - Nome do mapa
 * @returns {Object} Grupo combinado
 */
export const combineGroups = (groupIds, selectedFeatures = [], mapName = null) => {
    return groupManager.combineGroups(groupIds, selectedFeatures, mapName);
};

/**
 * Desfaz um grupo, deixando features soltas
 * @param {string} groupId - ID do grupo
 * @param {string} mapName - Nome do mapa
 * @returns {Array} Features que estavam no grupo
 */
export const ungroupFeatures = (groupId, mapName = null) => {
    return groupManager.ungroupFeatures(groupId, mapName);
};

/**
 * Atualiza propriedade de um grupo
 * @param {string} groupId - ID do grupo
 * @param {string} property - Propriedade a atualizar
 * @param {*} value - Novo valor
 * @param {string} mapName - Nome do mapa
 * @returns {Object} Grupo atualizado
 */
export const updateGroupProperty = (groupId, property, value, mapName = null) => {
    return groupManager.updateGroupProperty(groupId, property, value, mapName);
};

/**
 * Busca o grupo que contém uma feature
 * @param {string} type - Tipo da feature (source)
 * @param {string} featureId - ID da feature
 * @param {string} mapName - Nome do mapa
 * @returns {Object|null} Grupo encontrado ou null
 */
export const getFeatureGroup = (type, featureId, mapName = null) => {
    return groupManager.getFeatureGroup(type, featureId, mapName);
};

/**
 * Verifica se uma feature está agrupada
 * @param {string} type - Tipo da feature
 * @param {string} featureId - ID da feature
 * @param {string} mapName - Nome do mapa
 * @returns {boolean} True se está agrupada
 */
export const isFeatureGrouped = (type, featureId, mapName = null) => {
    return groupManager.isFeatureGrouped(type, featureId, mapName);
};

/**
 * Retorna todos os grupos de um mapa
 * @param {string} mapName - Nome do mapa
 * @returns {Map} Map com grupos do mapa
 */
export const getMapGroups = (mapName = null) => {
    return groupManager.getMapGroups(mapName);
};

/**
 * Retorna um grupo específico por ID
 * @param {string} groupId - ID do grupo
 * @param {string} mapName - Nome do mapa
 * @returns {Object|null} Grupo encontrado
 */
export const getGroupById = (groupId, mapName = null) => {
    return groupManager.getGroupById(groupId, mapName);
};

/**
 * Retorna features de um grupo
 * @param {string} groupId - ID do grupo
 * @param {string} mapName - Nome do mapa
 * @returns {Array} Features do grupo
 */
export const getGroupFeatures = (groupId, mapName = null) => {
    return groupManager.getGroupFeatures(groupId, mapName);
};

/**
 * Remove feature de todos os grupos (quando deletada)
 * @param {string} type - Tipo da feature
 * @param {string} featureId - ID da feature
 * @param {string} mapName - Nome do mapa
 */
export const removeFeatureFromAllGroups = (type, featureId, mapName = null) => {
    return groupManager.removeFeatureFromAllGroups(type, featureId, mapName);
};

// ===== INITIALIZATION =====

export const initializeWithLastActiveMap = async () => {
    const lastActiveMap = await initializeRepository();
    await mapManager.setCurrentMap(lastActiveMap);

    // Inicializar cache de cores do projeto
    await mapManager.initializeProjectColorCache();

    // NOVO: Carregar grupos em memória
    await groupManager.loadGroupsToMemory(lastActiveMap);

    return lastActiveMap;
};

// ===== MAP MANAGEMENT =====

export const getAllMapNamesStore = async () => {
    return await getAllMapNames();
};

export const addMap = async (mapName, mapData = null, colorUsageData = null, notesData = null) => {
    const newMapData = await createMapData(mapName, mapData);
    mapManager.addMapToMemory(mapName);

    // Processar cores do mapa
    await mapManager.processMapColors(mapName, newMapData, colorUsageData);

    if (notesData && (notesData.title || notesData.description)) {
        await setMapNotes(mapName, notesData);
    }

    return newMapData;
};

export const removeMap = async (mapName) => {
    const mapData = await getMapData(mapName);
    if (!mapData || Object.keys(mapData).length === 0) {
        console.warn(`Tentativa de remover mapa inexistente: ${mapName}`);
        return { success: false, reason: 'MAP_NOT_FOUND' };
    }

    const currentMapName = getCurrentMapNameSync();
    const isCurrentMap = mapName === currentMapName;
    const allMaps = await getAllMapNames();
    const remainingMaps = allMaps.filter(name => name !== mapName);

    // removeMapFromMemory agora cuida das cores automaticamente
    await deleteMapData(mapName);
    await mapManager.removeMapFromMemory(mapName);

    // NOVO: Limpar grupos do mapa
    await groupManager.clearMapGroups(mapName);

    if (isCurrentMap) {
        if (remainingMaps.length > 0) {
            const newCurrentMap = remainingMaps[0];
            await setCurrentMap(newCurrentMap);
        } else {
            await addMap('Principal');
            await setCurrentMap('Principal');
        }
    }

    return {
        success: true,
        wasCurrentMap: isCurrentMap,
        remainingMapsCount: remainingMaps.length,
        newCurrentMap: isCurrentMap ? (remainingMaps.length > 0 ? remainingMaps[0] : 'Principal') : currentMapName
    };
};

export const renameMap = async (oldName, newName) => {
    await renameMapData(oldName, newName);
    mapManager.renameMapInMemory(oldName, newName);

    // NOVO: Atualizar cache de grupos se necessário
    if (mapManager.getCurrentMapName() === newName) {
        await groupManager.loadGroupsToMemory(newName);
    }
};

export const setCurrentMap = async (mapName) => {
    await mapManager.setCurrentMap(mapName);

    // NOVO: Carregar grupos do novo mapa
    await groupManager.loadGroupsToMemory(mapName);
};

export const getCurrentMapName = async () => {
    return await getAppSetting('lastActiveMap');
};

export const getCurrentMapNameSync = () => {
    return mapManager.getCurrentMapName();
};

export const setLastActiveMap = async (mapName) => {
    await setAppSetting('lastActiveMap', mapName);
};

export const setSchemaVersion = async (schemaVersion) => {
    await setAppSetting('schemaVersion', schemaVersion);
};

// ===== FEATURE MANAGEMENT =====

const getFeatureType = (feature) => {
    const source = feature.properties?.source;
    return FEATURE_TYPE_MAPPINGS[source];
};

const findRelatedProcessedFeatures = (type, featureId, mapData) => {
    if (type === 'los') {
        return mapData.features.processed_los.filter(pf =>
            pf.properties.id.startsWith(featureId + '-')
        );
    } else if (type === 'visibility') {
        return mapData.features.processed_visibility.filter(pf =>
            pf.properties.id.startsWith(featureId + '-')
        );
    }
    return [];
};

const removeProcessedFeaturesFromData = (processedType, processedFeatures, mapData) => {
    if (!processedType || !processedFeatures.length) return;

    const processedIds = new Set(processedFeatures.map(pf => pf.properties.id));
    mapData.features[processedType] = mapData.features[processedType]
        .filter(pf => !processedIds.has(pf.properties.id));
};

export const addFeature = async (type, feature, mapName = null) => {
    const cleanedFeature = cleanFeature(feature);
    if (!cleanedFeature) {
        console.warn('Feature ignorada após limpeza:', feature);
        return;
    }

    const targetMap = mapName || getCurrentMapNameSync();
    const currentMapData = await getMapData(targetMap);
    currentMapData.features[type].push(cleanedFeature);
    await updateMapData(targetMap, currentMapData);

    // Track cor da nova feature
    const color = mapManager.getFeatureColor(cleanedFeature);
    if (color) {
        mapManager.updateColorUsage(null, color, targetMap);
    }

    if (!mapName || mapName === getCurrentMapNameSync()) {
        mapManager.recordAction({
            type: 'add',
            featureType: type,
            feature: JSON.parse(JSON.stringify(cleanedFeature))
        });
    }
};

export const updateFeature = async (type, feature, mapName = null) => {
    const cleanedFeature = cleanFeature(feature);
    if (!cleanedFeature) {
        console.warn('Feature ignorada após limpeza:', feature);
        return;
    }

    const targetMap = mapName || getCurrentMapNameSync();
    const currentMapData = await getMapData(targetMap);
    const index = currentMapData.features[type].findIndex(f => f.properties.id === cleanedFeature.properties.id);

    if (index !== -1) {
        const oldFeature = currentMapData.features[type][index];

        // Track mudança de cor
        const oldColor = mapManager.getFeatureColor(oldFeature);
        const newColor = mapManager.getFeatureColor(cleanedFeature);
        if (oldColor !== newColor) {
            mapManager.updateColorUsage(oldColor, newColor, targetMap);
        }

        if (JSON.stringify(oldFeature) !== JSON.stringify(cleanedFeature)) {
            currentMapData.features[type][index] = cleanedFeature;
            await updateMapData(targetMap, currentMapData);

            if (!mapName || mapName === getCurrentMapNameSync()) {
                mapManager.recordAction({
                    type: 'update',
                    featureType: type,
                    oldFeature: JSON.parse(JSON.stringify(oldFeature)),
                    newFeature: JSON.parse(JSON.stringify(cleanedFeature))
                });
            }
        }
    }
};

export const removeFeature = async (type, id, mapName = null) => {
    const targetMap = mapName || getCurrentMapNameSync();
    const currentMapData = await getMapData(targetMap);
    const featureIndex = currentMapData.features[type].findIndex(f => f.properties.id == id);

    if (featureIndex === -1) return;

    const mainFeature = currentMapData.features[type].splice(featureIndex, 1)[0];

    // Track remoção de cor
    const color = mapManager.getFeatureColor(mainFeature);
    if (color) {
        mapManager.updateColorUsage(color, null, targetMap);
    }

    // NOVO: Remover feature dos grupos
    removeFeatureFromAllGroups(mainFeature.properties.source, id, targetMap);

    const processedFeatures = findRelatedProcessedFeatures(type, id, currentMapData);
    const processedType = type === 'los' ? 'processed_los' :
        type === 'visibility' ? 'processed_visibility' : null;

    if (processedType && processedFeatures.length > 0) {
        removeProcessedFeaturesFromData(processedType, processedFeatures, currentMapData);
    }

    await updateMapData(targetMap, currentMapData);

    if (!mapName || mapName === getCurrentMapNameSync()) {
        mapManager.recordAction({
            type: 'removeWithProcessed',
            mainFeatureType: type,
            mainFeature: JSON.parse(JSON.stringify(mainFeature)),
            processedFeatures: processedFeatures.length > 0 ? {
                type: processedType,
                features: JSON.parse(JSON.stringify(processedFeatures))
            } : null
        });
    }

    // ROBUST DELETION: Verify and retry if needed
    setTimeout(async () => {
        try {
            const verifyMapData = await getMapData(targetMap);
            const stillExists = verifyMapData.features[type].some(f => f.properties.id === id);

            if (stillExists) {
                const retryMapData = await getMapData(targetMap);
                const retryIndex = retryMapData.features[type].findIndex(f => f.properties.id === id);

                if (retryIndex !== -1) {
                    retryMapData.features[type].splice(retryIndex, 1);
                    await updateMapData(targetMap, retryMapData);
                }
            }
        } catch (error) {
            console.error(`Robust deletion verification failed for ${type} ${id}:`, error);
        }
    }, 500);
};

export const addFeatureToMap = async (type, feature, mapName) => {
    return await addFeature(type, feature, mapName);
};

export const removeFeatureFromMap = async (type, id, mapName) => {
    const mapData = await getMapData(mapName);
    const featureIndex = mapData.features[type].findIndex(f => f.properties.id === id);

    if (featureIndex === -1) return null;

    const mainFeature = mapData.features[type].splice(featureIndex, 1)[0];

    // Track remoção de cor (sempre atualizar projeto, mesmo que não seja mapa atual)
    const color = mapManager.getFeatureColor(mainFeature);
    if (color) {
        mapManager.updateColorUsage(color, null, mapName);
    }

    // NOVO: Remover dos grupos
    removeFeatureFromAllGroups(mainFeature.properties.source, id, mapName);

    const processedFeatures = findRelatedProcessedFeatures(type, id, mapData);
    const processedType = type === 'los' ? 'processed_los' :
        type === 'visibility' ? 'processed_visibility' : null;

    if (processedType && processedFeatures.length > 0) {
        removeProcessedFeaturesFromData(processedType, processedFeatures, mapData);
    }

    await updateMapData(mapName, mapData);

    return {
        mainFeature,
        processedFeatures: processedFeatures.length > 0 ? {
            type: processedType,
            features: processedFeatures
        } : null
    };
};

export const addFeatureSilent = async (type, feature, mapName = null) => {
    const cleanedFeature = cleanFeature(feature);
    if (!cleanedFeature) return;

    const targetMap = mapName || getCurrentMapNameSync();
    const currentMapData = await getMapData(targetMap);
    currentMapData.features[type].push(cleanedFeature);
    await updateMapData(targetMap, currentMapData);
    // SEM recordAction e SEM color tracking - totalmente silencioso
};

export const removeFeatureSilent = async (type, id, mapName = null) => {
    const targetMap = mapName || getCurrentMapNameSync();
    const currentMapData = await getMapData(targetMap);
    const featureIndex = currentMapData.features[type].findIndex(f => f.properties.id == id);

    if (featureIndex !== -1) {
        currentMapData.features[type].splice(featureIndex, 1);
        await updateMapData(targetMap, currentMapData);
    }
    // SEM recordAction e SEM color tracking - totalmente silencioso
};

export const addFeatures = async (featuresMap, mapName = null) => {
    const targetMap = mapName || getCurrentMapNameSync();
    const currentMapData = await getMapData(targetMap);

    const action = {
        type: 'addMultiple',
        features: {}
    };

    Object.keys(featuresMap).forEach(type => {
        const features = featuresMap[type] || [];
        if (features.length > 0) {
            const cleanedFeatures = features.map(cleanFeature).filter(Boolean);
            currentMapData.features[type].push(...cleanedFeatures);
            action.features[type] = JSON.parse(JSON.stringify(cleanedFeatures));

            // Track cores das novas features
            cleanedFeatures.forEach(feature => {
                const color = mapManager.getFeatureColor(feature);
                if (color) {
                    mapManager.updateColorUsage(null, color, targetMap);
                }
            });
        }
    });

    await updateMapData(targetMap, currentMapData);

    if (Object.keys(action.features).length > 0 && (!mapName || mapName === getCurrentMapNameSync())) {
        mapManager.recordAction(action);
    }
};

export const getCurrentMapFeatures = async (mapName = null) => {
    const targetMap = mapName || getCurrentMapNameSync();
    const currentMapData = await getMapData(targetMap);
    return JSON.parse(JSON.stringify(currentMapData.features));
};

export const getFeatureById = async (featureType, featureId, mapName = null) => {
    const targetMap = mapName || getCurrentMapNameSync();
    const currentMapData = await getMapData(targetMap);
    return currentMapData.features[featureType].find(f => f.properties.id === featureId);
};

export const updateFeatureProperty = async (featureType, featureId, property, value, mapName = null) => {
    const targetMap = mapName || getCurrentMapNameSync();
    const currentMapData = await getMapData(targetMap);
    const feature = currentMapData.features[featureType].find(f => f.properties.id === featureId);

    if (!feature) {
        console.warn(`Feature ${featureId} não encontrada em ${featureType}`);
        return false;
    }

    // Track mudança de cor se a propriedade afeta cor
    const isColorProperty = ['color', 'fillColor', 'lineColor', 'outlinecolor', 'backgroundColor'].includes(property);
    let oldColor, newColor;

    if (isColorProperty) {
        oldColor = mapManager.getFeatureColor(feature);
        feature.properties[property] = value;
        newColor = mapManager.getFeatureColor(feature);

        if (oldColor !== newColor) {
            mapManager.updateColorUsage(oldColor, newColor, targetMap);
        }
    } else {
        feature.properties[property] = value;
    }

    await updateMapData(targetMap, currentMapData);
    return true;
};

// ===== MOVE FEATURES BETWEEN MAPS =====

export const moveFeaturesToMap = async (features, targetMapName) => {
    if (!features || features.length === 0) {
        return;
    }

    const sourceMapName = getCurrentMapNameSync();

    if (sourceMapName === targetMapName) {
        console.warn('Tentativa de mover feições para o mesmo mapa');
        return;
    }

    const targetMapData = await getMapData(targetMapName);
    if (!targetMapData || Object.keys(targetMapData).length === 0) {
        throw new Error(`Mapa de destino "${targetMapName}" não encontrado`);
    }

    const featuresByType = features.reduce((acc, feature) => {
        const type = getFeatureType(feature);
        if (!acc[type]) acc[type] = [];
        acc[type].push(feature);
        return acc;
    }, {});

    const batchOperation = {
        type: 'moveBetweenMaps',
        sourceMapName,
        targetMapName,
        movedFeatures: {}
    };

    try {
        for (const [type, featuresOfType] of Object.entries(featuresByType)) {
            const typeOperations = {
                mainFeatures: [],
                processedFeatures: []
            };

            for (const feature of featuresOfType) {
                const removedData = await removeFeatureFromMap(type, feature.properties.id, sourceMapName);

                if (removedData) {
                    const addedFeature = await addFeatureToMap(type, feature, targetMapName);

                    if (addedFeature) {
                        typeOperations.mainFeatures.push({
                            feature: JSON.parse(JSON.stringify(addedFeature)),
                            removedData: {
                                mainFeature: JSON.parse(JSON.stringify(removedData.mainFeature)),
                                processedFeatures: removedData.processedFeatures ?
                                    JSON.parse(JSON.stringify(removedData.processedFeatures)) : null
                            }
                        });

                        if (removedData.processedFeatures) {
                            for (const pf of removedData.processedFeatures.features) {
                                await addFeatureToMap(removedData.processedFeatures.type, pf, targetMapName);
                            }
                        }
                    }
                }
            }

            if (typeOperations.mainFeatures.length > 0) {
                batchOperation.movedFeatures[type] = typeOperations;
            }
        }

        if (Object.keys(batchOperation.movedFeatures).length > 0) {
            mapManager.recordAction(batchOperation);
        }

    } catch (error) {
        console.error('Erro ao mover feições:', error);
        throw error;
    }
};

// ===== BATCH OPERATIONS FOR LOS/VISIBILITY =====

export const batchUpdateLOSFeatures = async (losFeature, processedFeatures, mapName = null) => {
    const targetMap = mapName || getCurrentMapNameSync();
    const currentMapData = await getMapData(targetMap);

    const losIndex = currentMapData.features.los.findIndex(f => f.properties.id === losFeature.properties.id);
    if (losIndex !== -1) {
        const oldFeature = currentMapData.features.los[losIndex];
        currentMapData.features.los[losIndex] = cleanFeature(losFeature);

        currentMapData.features.processed_los = currentMapData.features.processed_los.filter(f =>
            f.properties.id !== losFeature.properties.id + '-visible' &&
            f.properties.id !== losFeature.properties.id + '-obstructed'
        );

        const cleanedProcessed = processedFeatures.map(cleanFeature).filter(Boolean);
        currentMapData.features.processed_los.push(...cleanedProcessed);

        await updateMapData(targetMap, currentMapData);

        if (!mapName || mapName === getCurrentMapNameSync()) {
            mapManager.recordAction({
                type: 'update',
                featureType: 'los',
                oldFeature: JSON.parse(JSON.stringify(oldFeature)),
                newFeature: JSON.parse(JSON.stringify(cleanFeature(losFeature)))
            });
        }
    }
};

export const batchUpdateVisibilityFeatures = async (visibilityFeature, processedFeatures, mapName = null) => {
    const targetMap = mapName || getCurrentMapNameSync();
    const currentMapData = await getMapData(targetMap);

    const visIndex = currentMapData.features.visibility.findIndex(f => f.properties.id === visibilityFeature.properties.id);
    if (visIndex !== -1) {
        const oldFeature = currentMapData.features.visibility[visIndex];
        currentMapData.features.visibility[visIndex] = cleanFeature(visibilityFeature);

        currentMapData.features.processed_visibility = currentMapData.features.processed_visibility.filter(f =>
            !f.properties.id.startsWith(visibilityFeature.properties.id + '-')
        );

        const cleanedProcessed = processedFeatures.map(cleanFeature).filter(Boolean);
        currentMapData.features.processed_visibility.push(...cleanedProcessed);

        await updateMapData(targetMap, currentMapData);

        if (!mapName || mapName === getCurrentMapNameSync()) {
            mapManager.recordAction({
                type: 'update',
                featureType: 'visibility',
                oldFeature: JSON.parse(JSON.stringify(oldFeature)),
                newFeature: JSON.parse(JSON.stringify(cleanFeature(visibilityFeature)))
            });
        }
    }
};

// ===== MAP CONFIGURATION =====

export const getCurrentBaseLayer = async (mapName = null) => {
    const targetMap = mapName || getCurrentMapNameSync();
    const currentMapData = await getMapData(targetMap);
    return currentMapData.baseLayer;
};

export const setBaseLayer = async (layer, mapName = null) => {
    if (!config.basemaps[layer]?.enabled) {
        const fallback = config.getValidBasemapFallback();
        console.warn(`Base layer "${layer}" não habilitado. Usando "${fallback}".`);
        layer = fallback;
    }

    const targetMap = mapName || getCurrentMapNameSync();
    const currentMapData = await getMapData(targetMap);
    currentMapData.baseLayer = layer;
    await updateMapData(targetMap, currentMapData);
};

export const updateMapPosition = async (center_lat, center_long, zoom, mapName = null) => {
    const targetMap = mapName || getCurrentMapNameSync();
    const currentMapData = await getMapData(targetMap);
    currentMapData.center_lat = center_lat;
    currentMapData.center_long = center_long;
    currentMapData.zoom = zoom;
    await updateMapData(targetMap, currentMapData);
};

export const getMapPosition = async (mapName) => {
    const currentMapData = await getMapData(mapName);
    return {
        center_lat: currentMapData.center_lat,
        center_long: currentMapData.center_long,
        zoom: currentMapData.zoom
    };
};

export const hasMapSavedPosition = async (mapName = null) => {
    const position = await getMapPosition(mapName);
    return position.center_lat !== null &&
        position.center_long !== null &&
        position.zoom !== null;
};

export const clearMapPosition = async (mapName = null) => {
    const targetMapName = mapName || getCurrentMapNameSync();
    const currentMapData = await getMapData(targetMapName);

    currentMapData.center_lat = null;
    currentMapData.center_long = null;
    currentMapData.zoom = null;

    await updateMapData(targetMapName, currentMapData);
};

// ===== HILLSHADE MANAGEMENT =====

export const getMapHillshadeState = async (mapName = null) => {
    const targetMap = mapName || getCurrentMapNameSync();
    const mapData = await getMapData(targetMap);
    return mapData.hillshadeEnabled ?? true;
};

export const setMapHillshadeState = async (enabled, mapName = null) => {
    const targetMap = mapName || getCurrentMapNameSync();
    const mapData = await getMapData(targetMap);
    mapData.hillshadeEnabled = enabled;
    await updateMapData(targetMap, mapData);
};

// ===== ANALYSIS LAYERS MANAGEMENT =====

export const getMapAnalysisLayerState = async (layerId, mapName = null) => {
    const targetMap = mapName || getCurrentMapNameSync();
    const mapData = await getMapData(targetMap);

    if (!mapData.analysisLayers) {
        mapData.analysisLayers = {};
    }

    return mapData.analysisLayers[layerId] ?? false;
};

export const setMapAnalysisLayerState = async (layerId, enabled, mapName = null) => {
    const targetMap = mapName || getCurrentMapNameSync();
    const mapData = await getMapData(targetMap);

    if (!mapData.analysisLayers) {
        mapData.analysisLayers = {};
    }

    mapData.analysisLayers[layerId] = enabled;
    await updateMapData(targetMap, mapData);
};

export const getMapAnalysisLayersStates = async (mapName = null) => {
    const targetMap = mapName || getCurrentMapNameSync();
    const mapData = await getMapData(targetMap);

    return mapData.analysisLayers || {};
};

export const setMapAnalysisLayersStates = async (layersStates, mapName = null) => {
    const targetMap = mapName || getCurrentMapNameSync();
    const mapData = await getMapData(targetMap);

    if (!mapData.analysisLayers) {
        mapData.analysisLayers = {};
    }

    Object.assign(mapData.analysisLayers, layersStates);
    await updateMapData(targetMap, mapData);
};

// ===== IMAGE MANAGEMENT =====

export const storeImage = async (imageId, blob) => {
    await storeImageData(imageId, blob);
};

export const getImage = async (imageId) => {
    return await getImageData(imageId);
};

export const removeImage = async (imageId) => {
    await removeImageData(imageId);
};

export const hasImage = async (imageId) => {
    return await hasImageData(imageId);
};

export const getMapDataStore = async (mapName) => {
    return await getMapData(mapName);
};

// ===== UNDO/REDO SYSTEM =====

export const undoLastAction = async () => {
    const executeFunction = {
        addFeature,
        updateFeature,
        removeFeature,
        addFeatureToMap,
        removeFeatureFromMap
    };

    return await mapManager.undoLastAction(executeFunction);
};

export const redoLastAction = async () => {
    const executeFunction = {
        addFeature,
        updateFeature,
        removeFeature,
        addFeatureToMap,
        removeFeatureFromMap
    };

    return await mapManager.redoLastAction(executeFunction);
};

// ===== CLEANUP OPERATIONS =====

export const clearAllDataStore = async () => {
    resetMemoryStore();
    await clearAllMapData();
    await clearAllImageData();
    await clearAllAppSettings();
    await clearAllGroupData(); // NOVO: Limpar grupos

    // Limpar todos os caches de cor internamente
    await mapManager.clearAllColorCaches();

    await setAppSetting('schemaVersion', SCHEMA_VERSION);
};

// ===== LEGACY COMPATIBILITY EXPORTS =====

export { SCHEMA_VERSION, MIN_SCHEMA_VERSION, MAX_SCHEMA_VERSION };
export { compareVersions, cleanFeature, isInternalProperty, getColorUsage };
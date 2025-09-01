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
    setAppSetting,
    getAppSetting,
    clearAllAppSettings,
    initializeRepository
} from './repository.js';

import mapManager from './map-manager.js';
import config from '../../config.js';

// ===== CENTRALIZED FEATURE TYPE MAPPINGS =====

/**
 * Mapeamento principal: source type → storage type
 * FONTE ÚNICA DA VERDADE para todos os mapeamentos de tipos
 */

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
    // Formas básicas
    'point': 'points',
    'line': 'lines', 
    'polygon': 'polygons',
    
    // Ferramentas específicas
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
    
    // Análises especiais
    'los': 'los',
    'visibility': 'visibility'
};

/**
 * Nomes em português para display na interface
 */
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

/**
 * Features que não podem ser copiadas/coladas
 */
export const UNCOPYABLE_FEATURE_TYPES = ['los', 'visibility'];

/**
 * Features que possuem recursos de imagem associados
 */
export const IMAGE_RESOURCE_FEATURE_TYPES = ['image', 'military_symbol'];

// ===== CENTRALIZED UTILITY FUNCTIONS =====

/**
 * Converte source type para storage type
 * @param {string} sourceType - Tipo do source ('circle', 'arrow', etc.)
 * @returns {string} Tipo de storage ('circles', 'arrows', etc.)
 */
export const getStorageTypeFromSource = (sourceType) => {
    return FEATURE_TYPE_MAPPINGS[sourceType] || `${sourceType}s`;
};

/**
 * Converte storage type para source type (mapeamento reverso)
 * @param {string} storageType - Tipo do storage ('circles', 'arrows', etc.)
 * @returns {string} Tipo do source ('circle', 'arrow', etc.)
 */
export const getSourceTypeFromStorage = (storageType) => {
    // Busca reversa no mapeamento
    for (const [sourceType, storage] of Object.entries(FEATURE_TYPE_MAPPINGS)) {
        if (storage === storageType) {
            return sourceType;
        }
    }
    // Fallback: remover 's' do final
    return storageType.endsWith('s') ? storageType.slice(0, -1) : storageType;
};

// Obter ícone de um source type
export const getFeatureIcon = (sourceType) => {
    return FEATURE_TYPE_ICONS[sourceType];
};

// Obter layer name de um source type  
export const getFeatureLayer = (sourceType) => {
    return FEATURE_TYPE_LAYERS[sourceType] || `${sourceType}-layer`;
};

// Funções bidirecionais para features_tab.js
export const getFeatureDisplayNameFromStorage = (storageType) => {
    const sourceType = getSourceTypeFromStorage(storageType);
    return getFeatureDisplayName(sourceType);
};

export const getFeatureIconFromStorage = (storageType) => {
    const sourceType = getSourceTypeFromStorage(storageType);
    return getFeatureIcon(sourceType);
};

// Gerar config para rectangle selection (simplificado)
export const getSelectionControlConfig = () => {
    const config = {};
    for (const sourceType of getAllSourceTypes()) {
        const storageType = getStorageTypeFromSource(sourceType);
        config[sourceType] = {
            sourceNames: [storageType] // Array com um elemento só
        };
    }
    return config;
};

/**
 * Obtém nome para display de um tipo de feature
 * @param {string} sourceType - Tipo do source
 * @returns {string} Nome em português para display
 */
export const getFeatureDisplayName = (sourceType) => {
    return FEATURE_DISPLAY_NAMES[sourceType] || 'Feição';
};

/**
 * Verifica se um tipo de feature pode ser copiado
 * @param {string} sourceType - Tipo do source
 * @returns {boolean} True se pode ser copiado
 */
export const isUncopyableFeatureType = (sourceType) => {
    return UNCOPYABLE_FEATURE_TYPES.includes(sourceType);
};

/**
 * Verifica se um tipo de feature tem recursos de imagem
 * @param {string} sourceType - Tipo do source
 * @returns {boolean} True se tem recursos de imagem
 */
export const hasImageResource = (sourceType) => {
    return IMAGE_RESOURCE_FEATURE_TYPES.includes(sourceType);
};

/**
 * Obtém todos os source types válidos
 * @returns {string[]} Array de todos os source types
 */
export const getAllSourceTypes = () => {
    return Object.keys(FEATURE_TYPE_MAPPINGS);
};

/**
 * Obtém todos os storage types válidos
 * @returns {string[]} Array de todos os storage types
 */
export const getAllStorageTypes = () => {
    return Object.values(FEATURE_TYPE_MAPPINGS);
};

/**
 * Verifica se um source type é válido
 * @param {string} sourceType - Tipo do source
 * @returns {boolean} True se é válido
 */
export const isValidSourceType = (sourceType) => {
    return sourceType in FEATURE_TYPE_MAPPINGS;
};

/**
 * Verifica se um storage type é válido
 * @param {string} storageType - Tipo do storage
 * @returns {boolean} True se é válido
 */
export const isValidStorageType = (storageType) => {
    return Object.values(FEATURE_TYPE_MAPPINGS).includes(storageType);
};

// ===== INITIALIZATION =====

export const initializeWithLastActiveMap = async () => {
    const lastActiveMap = await initializeRepository();
    await mapManager.setCurrentMap(lastActiveMap);
    return lastActiveMap;
};

// ===== MAP MANAGEMENT =====

export const getAllMapNamesStore = async () => {
    return await getAllMapNames();
};

export const addMap = async (mapName, mapData = null) => {
    const newMapData = await createMapData(mapName, mapData);
    mapManager.addMapToMemory(mapName);
    return newMapData;
};

export const removeMap = async (mapName) => {
    // Validação: Verificar se o mapa existe
    const mapData = await getMapData(mapName);
    if (!mapData || Object.keys(mapData).length === 0) {
        console.warn(`Tentativa de remover mapa inexistente: ${mapName}`);
        return { success: false, reason: 'MAP_NOT_FOUND' };
    }

    // Verificar se é o mapa atual
    const currentMapName = getCurrentMapNameSync();
    const isCurrentMap = mapName === currentMapName;

    // Verificar quantos mapas restam
    const allMaps = await getAllMapNames();
    const remainingMaps = allMaps.filter(name => name !== mapName);

    // Remover do storage e memória
    await deleteMapData(mapName);
    mapManager.removeMapFromMemory(mapName);

    // Se era o mapa atual, atualizar referências
    if (isCurrentMap) {
        if (remainingMaps.length > 0) {
            const newCurrentMap = remainingMaps[0];
            await setCurrentMap(newCurrentMap);
        } else {
            // Último mapa removido - criar novo mapa Principal
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
};

export const setCurrentMap = async (mapName) => {
    await mapManager.setCurrentMap(mapName);
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

/**
 * Função legada refatorada para usar mapeamentos centralizados
 * Mantida para compatibilidade com código existente
 */
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

    // Apenas registrar undo em memória se é o mapa atual
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
        if (JSON.stringify(oldFeature) !== JSON.stringify(cleanedFeature)) {
            currentMapData.features[type][index] = cleanedFeature;
            await updateMapData(targetMap, currentMapData);

            // Apenas registrar undo em memória se é o mapa atual
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

    // Remover feature principal
    const mainFeature = currentMapData.features[type].splice(featureIndex, 1)[0];

    // Buscar e remover features processadas relacionadas
    const processedFeatures = findRelatedProcessedFeatures(type, id, currentMapData);
    const processedType = type === 'los' ? 'processed_los' :
        type === 'visibility' ? 'processed_visibility' : null;

    if (processedType && processedFeatures.length > 0) {
        removeProcessedFeaturesFromData(processedType, processedFeatures, currentMapData);
    }

    // Salvar alterações
    await updateMapData(targetMap, currentMapData);

    // Apenas registrar undo em memória se é o mapa atual
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

    // ROBUST DELETION: Verify and retry if needed (mantido para compatibilidade)
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

    // Remover feature principal
    const mainFeature = mapData.features[type].splice(featureIndex, 1)[0];

    // Buscar e remover features processadas relacionadas
    const processedFeatures = findRelatedProcessedFeatures(type, id, mapData);
    const processedType = type === 'los' ? 'processed_los' :
        type === 'visibility' ? 'processed_visibility' : null;

    if (processedType && processedFeatures.length > 0) {
        removeProcessedFeaturesFromData(processedType, processedFeatures, mapData);
    }

    // Salvar alterações
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
    // SEM recordAction - não vai para undo stack
};

export const removeFeatureSilent = async (type, id, mapName = null) => {
    const targetMap = mapName || getCurrentMapNameSync();
    const currentMapData = await getMapData(targetMap);
    const featureIndex = currentMapData.features[type].findIndex(f => f.properties.id == id);

    if (featureIndex !== -1) {
        currentMapData.features[type].splice(featureIndex, 1);
        await updateMapData(targetMap, currentMapData);
    }
    // SEM recordAction - não vai para undo stack
};

export const addFeatures = async (featuresMap, mapName = null) => {
    const targetMap = mapName || getCurrentMapNameSync();
    const currentMapData = await getMapData(targetMap);

    // Criar uma única ação para o histórico
    const action = {
        type: 'addMultiple',
        features: {}
    };

    // Adicionar cada tipo de feature
    Object.keys(featuresMap).forEach(type => {
        const features = featuresMap[type] || [];
        if (features.length > 0) {
            const cleanedFeatures = features.map(cleanFeature).filter(Boolean);
            currentMapData.features[type].push(...cleanedFeatures);
            action.features[type] = JSON.parse(JSON.stringify(cleanedFeatures));
        }
    });

    // Salvar no IndexedDB
    await updateMapData(targetMap, currentMapData);

    // Registrar ação no histórico apenas se houve alterações e é o mapa atual
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

    feature.properties[property] = value;
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

    // Verificar se o mapa de destino existe
    const targetMapData = await getMapData(targetMapName);
    if (!targetMapData || Object.keys(targetMapData).length === 0) {
        throw new Error(`Mapa de destino "${targetMapName}" não encontrado`);
    }

    // Agrupar feições por tipo
    const featuresByType = features.reduce((acc, feature) => {
        const type = getFeatureType(feature);
        if (!acc[type]) acc[type] = [];
        acc[type].push(feature);
        return acc;
    }, {});

    // Coletar todas as operações para batch de undo/redo
    const batchOperation = {
        type: 'moveBetweenMaps',
        sourceMapName,
        targetMapName,
        movedFeatures: {}
    };

    try {
        // Para cada tipo de feição
        for (const [type, featuresOfType] of Object.entries(featuresByType)) {
            const typeOperations = {
                mainFeatures: [],
                processedFeatures: []
            };

            for (const feature of featuresOfType) {
                // Remover do mapa origem (sem alterar currentMap)
                const removedData = await removeFeatureFromMap(type, feature.properties.id, sourceMapName);

                if (removedData) {
                    // Adicionar ao mapa destino (sem alterar currentMap)
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

                        // Se havia features processadas, também adicionar no destino
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

        // Registrar operação única para undo/redo (apenas no mapa atual)
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

    // 1. Atualizar LOS principal
    const losIndex = currentMapData.features.los.findIndex(f => f.properties.id === losFeature.properties.id);
    if (losIndex !== -1) {
        const oldFeature = currentMapData.features.los[losIndex];
        currentMapData.features.los[losIndex] = cleanFeature(losFeature);

        // 2. Remover processed antigas (fix do startsWith)
        currentMapData.features.processed_los = currentMapData.features.processed_los.filter(f =>
            f.properties.id !== losFeature.properties.id + '-visible' &&
            f.properties.id !== losFeature.properties.id + '-obstructed'
        );

        // 3. Adicionar processed novas
        const cleanedProcessed = processedFeatures.map(cleanFeature).filter(Boolean);
        currentMapData.features.processed_los.push(...cleanedProcessed);

        // 4. Salvar uma única vez
        await updateMapData(targetMap, currentMapData);

        // 5. Registrar no undo apenas a mudança principal (se é mapa atual)
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

    // 1. Atualizar Visibility principal
    const visIndex = currentMapData.features.visibility.findIndex(f => f.properties.id === visibilityFeature.properties.id);
    if (visIndex !== -1) {
        const oldFeature = currentMapData.features.visibility[visIndex];
        currentMapData.features.visibility[visIndex] = cleanFeature(visibilityFeature);

        // 2. Remover processed antigas (usando pattern matching seguro)
        currentMapData.features.processed_visibility = currentMapData.features.processed_visibility.filter(f =>
            !f.properties.id.startsWith(visibilityFeature.properties.id + '-')
        );

        // 3. Adicionar processed novas
        const cleanedProcessed = processedFeatures.map(cleanFeature).filter(Boolean);
        currentMapData.features.processed_visibility.push(...cleanedProcessed);

        // 4. Salvar uma única vez
        await updateMapData(targetMap, currentMapData);

        // 5. Registrar no undo apenas a mudança principal (se é mapa atual)
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
    // Validar se o basemap está habilitado na configuração
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

    // Limpar a posição salva definindo como null
    currentMapData.center_lat = null;
    currentMapData.center_long = null;
    currentMapData.zoom = null;

    await updateMapData(targetMapName, currentMapData);
};

// ===== HILLSHADE MANAGEMENT =====

export const getMapHillshadeState = async (mapName = null) => {
    const targetMap = mapName || getCurrentMapNameSync();
    const mapData = await getMapData(targetMap);
    return mapData.hillshadeEnabled ?? true; // Default true
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

    // Inicializar analysisLayers se não existir
    if (!mapData.analysisLayers) {
        mapData.analysisLayers = {};
    }

    // Retornar estado salvo ou defaultVisibility do config
    return mapData.analysisLayers[layerId] ?? false; // Default false se não especificado
};

export const setMapAnalysisLayerState = async (layerId, enabled, mapName = null) => {
    const targetMap = mapName || getCurrentMapNameSync();
    const mapData = await getMapData(targetMap);

    // Inicializar analysisLayers se não existir
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

    // Inicializar analysisLayers se não existir
    if (!mapData.analysisLayers) {
        mapData.analysisLayers = {};
    }

    // Merge dos estados
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
    await setAppSetting('schemaVersion', SCHEMA_VERSION);
};

// ===== LEGACY COMPATIBILITY EXPORTS =====

// Exportar constantes para compatibilidade
export { SCHEMA_VERSION, MIN_SCHEMA_VERSION, MAX_SCHEMA_VERSION };

// Exportar utilities para componentes que ainda precisam
export { compareVersions, cleanFeature, isInternalProperty };
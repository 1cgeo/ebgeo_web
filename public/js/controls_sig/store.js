// Path: js\controls_sig\store.js

const SCHEMA_VERSION = '1.2';
const MIN_SCHEMA_VERSION = '1.2';
const MAX_SCHEMA_VERSION = '1.2';

const mapStore = localforage.createInstance({ name: 'ebgeo_maps' });
const imageStore = localforage.createInstance({ name: 'ebgeo_images' });
const appStore = localforage.createInstance({ name: 'ebgeo_app_settings' });

// APENAS em memória - não persiste
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
};

// Função para estrutura vazia
const getEmptyMapData = () => ({
    baseLayer: 'carta-topografica',
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
        military_symbols: []
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
            // Manter apenas propriedades que não são metadados internos
            if (!isInternalProperty(key)) {
                cleanedProperties[key] = feature.properties[key];
            }
        });
    }

    // Retornar feature limpa no formato GeoJSON padrão
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
        // Metadados do vector tile
        '_vectorTileFeature',
        '_pbf',
        '_geometry',
        '_keys',
        '_values',
        
        // Coordenadas de tile
        '_z', '_x', '_y',
        
        // Informações de renderização
        'layer',
        'state',
        
        // Outros metadados internos
        'extent',
        'type' // quando é propriedade interna, não o type do GeoJSON
    ];

    // Verificar se é propriedade interna ou começa com underscore
    return internalProps.includes(key) || key.startsWith('_');
}

/**
 * Busca features processadas relacionadas a uma feature principal
 */
function findRelatedProcessedFeatures(type, featureId, mapData) {
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
}

/**
 * Remove features processadas do array de dados
 */
function removeProcessedFeaturesFromData(processedType, processedFeatures, mapData) {
    if (!processedType || !processedFeatures.length) return;
    
    const processedIds = new Set(processedFeatures.map(pf => pf.properties.id));
    mapData.features[processedType] = mapData.features[processedType]
        .filter(pf => !processedIds.has(pf.properties.id));
}

// Função auxiliar para comparar versões simples (formato X.Y)
export const compareVersions = (version1, version2) => {
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

// ✅ NOVA FUNÇÃO: Verificar e limpar dados incompatíveis
const checkAndCleanLegacyData = async () => {
    try {
        const currentSchemaVersion = await appStore.getItem('schemaVersion');
        // Se não há versão salva ou é menor que a mínima aceita, limpar tudo
        if (!currentSchemaVersion || compareVersions(currentSchemaVersion, MIN_SCHEMA_VERSION) < 0) {
            console.log('🧹 Detectados dados de versão incompatível, limpando...');
            
            // Limpar todos os stores
            await mapStore.clear();
            await imageStore.clear();
            await appStore.clear();
            
            // Definir nova versão
            await appStore.setItem('schemaVersion', SCHEMA_VERSION);
            
            console.log('✅ Dados legados limpos, nova versão definida:', SCHEMA_VERSION);
        }
    } catch (error) {
        console.warn('⚠️ Erro ao verificar versão do schema:', error);
        // Em caso de erro, limpar tudo para garantir estado limpo
        try {
            await mapStore.clear();
            await imageStore.clear();
            await appStore.clear();
            await appStore.setItem('schemaVersion', SCHEMA_VERSION);
        } catch (cleanupError) {
            console.error('❌ Erro crítico na limpeza de dados:', cleanupError);
        }
    }
};

// Função para resetar o estado da memória
export const resetMemoryStore = () => {
    memoryStore.maps = {
        'Principal': {
            undoStack: [],
            redoStack: []
        }
    };
    memoryStore.currentMap = 'Principal';
    memoryStore.isUndoing = false;
    memoryStore.isRedoing = false;
};

const recordAction = (action) => {
    const currentMap = memoryStore.maps[memoryStore.currentMap];
    if (!memoryStore.isUndoing && !memoryStore.isRedoing) {
        currentMap.undoStack.push(action);
        if (currentMap.undoStack.length > 20) {
            currentMap.undoStack.shift();
        }
        currentMap.redoStack = [];
    }
};

export const setLastActiveMap = async (mapName) => {
    try {
        await appStore.setItem('lastActiveMap', mapName);
    } catch (error) {
        console.warn('Erro ao salvar último mapa ativo:', error);
    }
};

export const getCurrentMapName = async () => {
    const currentMapName = await appStore.getItem('lastActiveMap');
    return currentMapName;
};

export const initializeWithLastActiveMap = async () => {
    try {
        // ✅ ADIÇÃO: Verificar e limpar dados legados
        await checkAndCleanLegacyData();
        
        // ✅ ADIÇÃO: Garantir que a versão do schema esteja salva
        const currentSchemaVersion = await appStore.getItem('schemaVersion');
        if (!currentSchemaVersion) {
            await appStore.setItem('schemaVersion', SCHEMA_VERSION);
        }
        
        // Verificar se há mapas salvos
        const allMapNames = await getAllMapNames();
        
        if (allMapNames.length === 0) {
            // Primeira execução - criar mapa Principal
            await addMap('Principal');
            await setCurrentMap('Principal');
            return 'Principal';
        }
        
        // Carregar último mapa ativo
        const lastActiveMap = await getCurrentMapName();
        
        if (lastActiveMap && allMapNames.includes(lastActiveMap)) {
            await setCurrentMap(lastActiveMap);
        } else {
            // Fallback para primeiro mapa disponível
            const firstMap = allMapNames[0];
            await setCurrentMap(firstMap);
        }
    } catch (error) {
        console.error('Erro ao inicializar com último mapa ativo:', error);
        // Fallback final
        await setCurrentMap('Principal');
    }
};

// Função auxiliar para determinar o tipo de feição
function getFeatureType(feature) {
    const source = feature.properties?.source;
    switch (source) {
        case 'point':
            return 'points';
        case 'line':
            return 'lines';
        case 'polygon':
            return 'polygons';
        case 'text':
            return 'texts';
        case 'image':
            return 'images';
        case 'los':
            return 'los';
        case 'visibility':
            return 'visibility';
        case 'circle':
            return 'circles';
        case 'rectangle':
            return 'rectangles';
        case 'ellipse':
            return 'ellipses';
        case 'brush':
            return 'brushes';
        case 'arrow':
            return 'arrows';
        case 'boundary':
            return 'boundarys';
        case 'occupied_front':
            return 'occupied_fronts';
        case 'military_symbol':
            return 'military_symbols';
        default:
            return feature.geometry.type.toLowerCase() + 's';
    }
}

/**
 * Adiciona uma feature a um mapa específico sem alterar currentMap
 */
export const addFeatureToMap = async (type, feature, mapName) => {
    const cleanedFeature = cleanFeature(feature);
    
    if (!cleanedFeature) {
        console.warn('Feature ignorada após limpeza:', feature);
        return null;
    }
    
    const mapData = await mapStore.getItem(mapName) || getEmptyMapData();
    mapData.features[type].push(cleanedFeature);
    await mapStore.setItem(mapName, mapData);
    
    return cleanedFeature;
};

/**
 * Remove uma feature de um mapa específico sem alterar currentMap
 */
export const removeFeatureFromMap = async (type, id, mapName) => {
    const mapData = await mapStore.getItem(mapName) || getEmptyMapData();
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
    await mapStore.setItem(mapName, mapData);
    
    return {
        mainFeature,
        processedFeatures: processedFeatures.length > 0 ? {
            type: processedType,
            features: processedFeatures
        } : null
    };
};

// Função para mover feições entre mapas
export const moveFeaturesToMap = async (features, targetMapName) => {
    if (!features || features.length === 0) {
        return;
    }

    const sourceMapName = await getCurrentMapName();
    
    if (sourceMapName === targetMapName) {
        console.warn('Tentativa de mover feições para o mesmo mapa');
        return;
    }

    // Verificar se o mapa de destino existe
    const targetMapData = await mapStore.getItem(targetMapName);
    if (!targetMapData) {
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
                // ✅ Remover do mapa origem (sem alterar currentMap)
                const removedData = await removeFeatureFromMap(type, feature.properties.id, sourceMapName);
                
                if (removedData) {
                    // ✅ Adicionar ao mapa destino (sem alterar currentMap)
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
        
        // ✅ Registrar operação única para undo/redo (apenas no mapa atual)
        if (Object.keys(batchOperation.movedFeatures).length > 0) {
            recordAction(batchOperation);
        }
        
    } catch (error) {
        console.error('Erro ao mover feições:', error);
        throw error;
    }
};

// Funções que trabalham direto com IndexedDB
export const addFeature = async (type, feature) => {
    const cleanedFeature = cleanFeature(feature);

    if (!cleanedFeature) {
        console.warn('Feature ignorada após limpeza:', feature);
        return;
    }
    const currentMapData = await mapStore.getItem(memoryStore.currentMap) || getEmptyMapData();
    currentMapData.features[type].push(cleanedFeature);
    await mapStore.setItem(memoryStore.currentMap, currentMapData);
    
    // Apenas undo em memória
    recordAction({
        type: 'add',
        featureType: type,
        feature: JSON.parse(JSON.stringify(cleanedFeature))
    });
};

export const updateFeature = async (type, feature) => {
    const cleanedFeature = cleanFeature(feature);
    
    if (!cleanedFeature) {
        console.warn('Feature ignorada após limpeza:', feature);
        return;
    }

    const currentMapData = await mapStore.getItem(memoryStore.currentMap) || getEmptyMapData();
    const index = currentMapData.features[type].findIndex(f => f.properties.id === cleanedFeature.properties.id);
    if (index !== -1) {
        const oldFeature = currentMapData.features[type][index];
        if (JSON.stringify(oldFeature) !== JSON.stringify(cleanedFeature)) {
            currentMapData.features[type][index] = cleanedFeature;
            await mapStore.setItem(memoryStore.currentMap, currentMapData);
            
            recordAction({
                type: 'update',
                featureType: type,
                oldFeature: JSON.parse(JSON.stringify(oldFeature)),
                newFeature: JSON.parse(JSON.stringify(cleanedFeature))
            });
        }
    }
};

export const removeFeature = async (type, id) => {
    const currentMapData = await mapStore.getItem(memoryStore.currentMap) || getEmptyMapData();
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
    await mapStore.setItem(memoryStore.currentMap, currentMapData);
    
    // Registrar ação para undo/redo
    recordAction({
        type: 'removeWithProcessed',
        mainFeatureType: type,
        mainFeature: JSON.parse(JSON.stringify(mainFeature)),
        processedFeatures: processedFeatures.length > 0 ? {
            type: processedType,
            features: JSON.parse(JSON.stringify(processedFeatures))
        } : null
    });
    
    // ROBUST DELETION: Verify and retry if needed (mantido para compatibilidade)
    setTimeout(async () => {
        try {                
            // Verify deletion
            const verifyMapData = await mapStore.getItem(memoryStore.currentMap) || getEmptyMapData();
            const stillExists = verifyMapData.features[type].some(f => f.properties.id === id);
            
            if (stillExists) {
                // Retry deletion
                const retryMapData = await mapStore.getItem(memoryStore.currentMap) || getEmptyMapData();
                const retryIndex = retryMapData.features[type].findIndex(f => f.properties.id === id);
                
                if (retryIndex !== -1) {
                    retryMapData.features[type].splice(retryIndex, 1);
                    await mapStore.setItem(memoryStore.currentMap, retryMapData);
                }
            }
        } catch (error) {
            console.error(`Robust deletion verification failed for ${type} ${id}:`, error);
        }
    }, 500);
};

export const addFeatureSilent = async (type, feature) => {
    const cleanedFeature = cleanFeature(feature);
    if (!cleanedFeature) return;
    
    const currentMapData = await mapStore.getItem(memoryStore.currentMap) || getEmptyMapData();
    currentMapData.features[type].push(cleanedFeature);
    await mapStore.setItem(memoryStore.currentMap, currentMapData);
    // SEM recordAction - não vai para undo stack
};

export const removeFeatureSilent = async (type, id) => {
    const currentMapData = await mapStore.getItem(memoryStore.currentMap) || getEmptyMapData();
    const featureIndex = currentMapData.features[type].findIndex(f => f.properties.id == id);
    
    if (featureIndex !== -1) {
        currentMapData.features[type].splice(featureIndex, 1);
        await mapStore.setItem(memoryStore.currentMap, currentMapData);
    }
    // SEM recordAction - não vai para undo stack
};

// Operação em lote para LOS
export const batchUpdateLOSFeatures = async (losFeature, processedFeatures) => {
    const currentMapData = await mapStore.getItem(memoryStore.currentMap) || getEmptyMapData();
    
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
        await mapStore.setItem(memoryStore.currentMap, currentMapData);
        
        // 5. Registrar no undo apenas a mudança principal
        recordAction({
            type: 'update',
            featureType: 'los',
            oldFeature: JSON.parse(JSON.stringify(oldFeature)),
            newFeature: JSON.parse(JSON.stringify(cleanFeature(losFeature)))
        });
    }
};

export const batchUpdateVisibilityFeatures = async (visibilityFeature, processedFeatures) => {
    const currentMapData = await mapStore.getItem(memoryStore.currentMap) || getEmptyMapData();
    
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
        await mapStore.setItem(memoryStore.currentMap, currentMapData);
        
        // 5. Registrar no undo apenas a mudança principal
        recordAction({
            type: 'update',
            featureType: 'visibility',
            oldFeature: JSON.parse(JSON.stringify(oldFeature)),
            newFeature: JSON.parse(JSON.stringify(cleanFeature(visibilityFeature)))
        });
    }
};

export const addMap = async (mapName, mapData = null) => {
    const newMapData = mapData || getEmptyMapData();
    await mapStore.setItem(mapName, newMapData);
    
    // Adicionar stack em memória
    memoryStore.maps[mapName] = {
        undoStack: [],
        redoStack: []
    };
};

export const removeMap = async (mapName) => {
    // Validação: Verificar se o mapa existe
    const mapData = await mapStore.getItem(mapName);
    if (!mapData) {
        console.warn(`Tentativa de remover mapa inexistente: ${mapName}`);
        return { success: false, reason: 'MAP_NOT_FOUND' };
    }

    // Verificar se é o mapa atual
    const currentMapName = await getCurrentMapName();
    const isCurrentMap = mapName === currentMapName;
    
    // Verificar quantos mapas restam
    const allMaps = await getAllMapNames();
    const remainingMaps = allMaps.filter(name => name !== mapName);
    
    // Remover do storage
    await mapStore.removeItem(mapName);
    delete memoryStore.maps[mapName];
    
    // Se era o mapa atual, atualizar referências
    if (isCurrentMap) {
        if (remainingMaps.length > 0) {
            // Trocar para outro mapa disponível
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
    const mapData = await mapStore.getItem(oldName);
    if (mapData) {
        await mapStore.setItem(newName, mapData);
        await mapStore.removeItem(oldName);
        
        // Atualizar memória
        memoryStore.maps[newName] = memoryStore.maps[oldName];
        delete memoryStore.maps[oldName];
        
        if (memoryStore.currentMap === oldName) {
            memoryStore.currentMap = newName;
        }
    }
};

export const setCurrentMap = async (mapName) => {
    memoryStore.currentMap = mapName;
    // Persistir último mapa ativo
    await setLastActiveMap(mapName);
    
    // Criar entrada no memoryStore se não existir
    if (!memoryStore.maps[mapName]) {
        memoryStore.maps[mapName] = {
            undoStack: [],
            redoStack: []
        };
    }
};

// Carregar dados do IndexedDB para as layers
export const getCurrentMapFeatures = async () => {
    const currentMapData = await mapStore.getItem(memoryStore.currentMap) || getEmptyMapData();
    return JSON.parse(JSON.stringify(currentMapData.features));
};

export const getCurrentBaseLayer = async () => {
    const currentMapData = await mapStore.getItem(memoryStore.currentMap) || getEmptyMapData();
    return currentMapData.baseLayer;
};

export const setBaseLayer = async (layer) => {
    const currentMapData = await mapStore.getItem(memoryStore.currentMap) || getEmptyMapData();
    currentMapData.baseLayer = layer;
    await mapStore.setItem(memoryStore.currentMap, currentMapData);
};

export const updateMapPosition = async (center_lat, center_long, zoom) => {
    const currentMapData = await mapStore.getItem(memoryStore.currentMap) || getEmptyMapData();
    currentMapData.center_lat = center_lat;
    currentMapData.center_long = center_long;
    currentMapData.zoom = zoom;
    await mapStore.setItem(memoryStore.currentMap, currentMapData);
};

export const getMapPosition = async (mapName) => {
    const currentMapData = await mapStore.getItem(mapName) || getEmptyMapData();
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

// Funções para listar mapas
export const getAllMapNames = async () => {
    return await mapStore.keys();
};

// Undo/Redo functions
export const undoLastAction = async () => {
    const currentMap = memoryStore.maps[memoryStore.currentMap];
    const lastAction = currentMap.undoStack.pop();
    if (!lastAction) return false;

    memoryStore.isUndoing = true;
    currentMap.redoStack.push(lastAction);
    try {
        switch (lastAction.type) {
            case 'add':
                await removeFeature(lastAction.featureType, lastAction.feature.properties.id);
                break;
            case 'update':
                await updateFeature(lastAction.featureType, lastAction.oldFeature);
                break;
            case 'remove':
                await addFeature(lastAction.featureType, lastAction.feature);
                break;
            case 'removeWithProcessed':
                // Restaurar feature principal
                await addFeature(lastAction.mainFeatureType, lastAction.mainFeature);
                // Restaurar features processadas se houver
                if (lastAction.processedFeatures) {
                    for (const pf of lastAction.processedFeatures.features) {
                        await addFeature(lastAction.processedFeatures.type, pf);
                    }
                }
                break;
            case 'addMultiple':
                for (const [type, features] of Object.entries(lastAction.features)) {
                    for (const feature of features) {
                        await removeFeature(type, feature.properties.id);
                    }
                }
                break;
            case 'moveBetweenMaps':
                // ✅ UNDO: Mover features de volta (destino → origem)
                for (const [type, typeOps] of Object.entries(lastAction.movedFeatures)) {
                    for (const featureOp of typeOps.mainFeatures) {
                        // Remover do destino
                        await removeFeatureFromMap(type, featureOp.feature.properties.id, lastAction.targetMapName);
                        
                        // Restaurar na origem
                        await addFeatureToMap(type, featureOp.removedData.mainFeature, lastAction.sourceMapName);
                        
                        // Restaurar processadas se houver
                        if (featureOp.removedData.processedFeatures) {
                            for (const pf of featureOp.removedData.processedFeatures.features) {
                                await addFeatureToMap(featureOp.removedData.processedFeatures.type, pf, lastAction.sourceMapName);
                            }
                        }
                    }
                }
                break;
            default:
                break;
        }
    } finally {
        memoryStore.isUndoing = false;
    }

    return true;
};

export const redoLastAction = async () => {
    const currentMap = memoryStore.maps[memoryStore.currentMap];
    const lastUndoneAction = currentMap.redoStack.pop();
    if (!lastUndoneAction) return false;

    memoryStore.isRedoing = true;
    currentMap.undoStack.push(lastUndoneAction);

    try {
        switch (lastUndoneAction.type) {
            case 'add':
                await addFeature(lastUndoneAction.featureType, lastUndoneAction.feature);
                break;
            case 'update':
                await updateFeature(lastUndoneAction.featureType, lastUndoneAction.newFeature);
                break;
            case 'remove':
                await removeFeature(lastUndoneAction.featureType, lastUndoneAction.feature.properties.id);
                break;
            case 'removeWithProcessed':
                // Remover feature principal (que automaticamente remove processadas)
                await removeFeature(lastUndoneAction.mainFeatureType, lastUndoneAction.mainFeature.properties.id);
                break;
            case 'addMultiple':
                for (const [type, features] of Object.entries(lastUndoneAction.features)) {
                    for (const feature of features) {
                        await addFeature(type, feature);
                    }
                }
                break;
            case 'moveBetweenMaps':
                // ✅ REDO: Refazer o movimento (origem → destino)
                for (const [type, typeOps] of Object.entries(lastUndoneAction.movedFeatures)) {
                    for (const featureOp of typeOps.mainFeatures) {
                        // Remover da origem
                        await removeFeatureFromMap(type, featureOp.removedData.mainFeature.properties.id, lastUndoneAction.sourceMapName);
                        
                        // Adicionar no destino
                        await addFeatureToMap(type, featureOp.feature, lastUndoneAction.targetMapName);
                        
                        // Adicionar processadas se houver
                        if (featureOp.removedData.processedFeatures) {
                            for (const pf of featureOp.removedData.processedFeatures.features) {
                                await addFeatureToMap(featureOp.removedData.processedFeatures.type, pf, lastUndoneAction.targetMapName);
                            }
                        }
                    }
                }
                break;
            default:
                break;
        }
    } finally {
        memoryStore.isRedoing = false;
    }

    return true;
};

export const addFeatures = async (featuresMap) => {
    const currentMapData = await mapStore.getItem(memoryStore.currentMap) || getEmptyMapData();
    
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
    await mapStore.setItem(memoryStore.currentMap, currentMapData);
    
    // Registrar ação no histórico apenas se houve alterações
    if (Object.keys(action.features).length > 0) {
        recordAction(action);
    }
};

export const clearMapPosition = async (mapName = null) => {
    const targetMapName = mapName || memoryStore.currentMap;
    const currentMapData = await mapStore.getItem(targetMapName) || getEmptyMapData();
    
    // Limpar a posição salva definindo como null
    currentMapData.center_lat = null;
    currentMapData.center_long = null;
    currentMapData.zoom = null;
    
    await mapStore.setItem(targetMapName, currentMapData);
};

export const updateFeatureProperty = async (featureType, featureId, property, value) => {
    const currentMapData = await mapStore.getItem(memoryStore.currentMap) || getEmptyMapData();
    const feature = currentMapData.features[featureType].find(f => f.properties.id === featureId);
    
    if (!feature) {
        console.warn(`Feature ${featureId} não encontrada em ${featureType}`);
        return false;
    }
    
    feature.properties[property] = value;
    
    await mapStore.setItem(memoryStore.currentMap, currentMapData);
    
    return true;
};

export const getFeatureById = async (featureType, featureId) => {
    const currentMapData = await mapStore.getItem(memoryStore.currentMap) || getEmptyMapData();
    return currentMapData.features[featureType].find(f => f.properties.id === featureId);
};

// Exportar stores para uso direto quando necessário
export { mapStore, imageStore, appStore, SCHEMA_VERSION, MIN_SCHEMA_VERSION, MAX_SCHEMA_VERSION  };

// Manter compatibilidade com código existente
const store = memoryStore;
export default store;
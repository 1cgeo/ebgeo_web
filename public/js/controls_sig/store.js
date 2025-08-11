// Path: js\controls_sig\store.js

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
    baseLayer: 'Carta',
    features: {
        polygons: [],
        linestrings: [],
        points: [],
        texts: [],
        images: [],
        los: [],
        visibility: [],
        processed_los: [],
        processed_visibility: [],
        circles: [],
        ellipses: [],
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
        case 'draw':
            return feature.geometry.type.toLowerCase() + 's';
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
        case 'ellipse':
            return 'ellipses';
        default:
            return feature.geometry.type.toLowerCase() + 's';
    }
}

// Função para mover feições entre mapas
export const moveFeaturesToMap = async (features, targetMapName) => {
    if (!features || features.length === 0) {
        return;
    }

    const currentMapName = await getCurrentMapName();
    
    if (currentMapName === targetMapName) {
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

    try {
        // Para cada tipo de feição
        for (const [type, featuresOfType] of Object.entries(featuresByType)) {
            for (const feature of featuresOfType) {
                // Remover do mapa atual
                await removeFeature(type, feature.id);
                
                if (type === 'los') {
                    await moveProcessedLOSFeatures(feature.id, targetMapName);
                } else if (type === 'visibility') {
                    await moveProcessedVisibilityFeatures(feature.id, targetMapName);
                }
                
                // Adicionar ao mapa de destino
                const oldCurrentMap = memoryStore.currentMap;
                setCurrentMap(targetMapName);
                await addFeature(type, feature);
                setCurrentMap(oldCurrentMap);
            }
        }
    } catch (error) {
        console.error('Erro ao mover feições:', error);
        throw error;
    }
};

const moveProcessedLOSFeatures = async (losFeatureId, targetMapName) => {
    try {
        // Buscar features processadas relacionadas
        const currentMapData = await mapStore.getItem(memoryStore.currentMap) || getEmptyMapData();
        const processedFeatures = currentMapData.features.processed_los.filter(
            pf => pf.id.startsWith(losFeatureId + '-')
        );

        if (processedFeatures.length === 0) return;

        // Remover do mapa atual
        for (const pf of processedFeatures) {
            await removeFeature('processed_los', pf.id);
        }

        // Adicionar ao mapa de destino
        const oldCurrentMap = memoryStore.currentMap;
        setCurrentMap(targetMapName);
        for (const pf of processedFeatures) {
            await addFeature('processed_los', pf);
        }
        setCurrentMap(oldCurrentMap);

    } catch (error) {
        console.error('Erro ao mover features processadas de LOS:', error);
    }
};

const moveProcessedVisibilityFeatures = async (visibilityFeatureId, targetMapName) => {
    try {
        // Buscar features processadas relacionadas  
        const currentMapData = await mapStore.getItem(memoryStore.currentMap) || getEmptyMapData();
        const processedFeatures = currentMapData.features.processed_visibility.filter(
            pf => pf.id.startsWith(visibilityFeatureId + '-')
        );

        if (processedFeatures.length === 0) return;

        // Remover do mapa atual
        for (const pf of processedFeatures) {
            await removeFeature('processed_visibility', pf.id);
        }

        // Adicionar ao mapa de destino
        const oldCurrentMap = memoryStore.currentMap;
        setCurrentMap(targetMapName);
        for (const pf of processedFeatures) {
            await addFeature('processed_visibility', pf);
        }
        setCurrentMap(oldCurrentMap);

    } catch (error) {
        console.error('Erro ao mover features processadas de Visibility:', error);
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
    const index = currentMapData.features[type].findIndex(f => f.id == cleanedFeature.id);
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
    const featureIndex = currentMapData.features[type].findIndex(f => f.id == id);
    if (featureIndex !== -1) {
        const feature = currentMapData.features[type].splice(featureIndex, 1)[0];
        await mapStore.setItem(memoryStore.currentMap, currentMapData);
        
        recordAction({
            type: 'remove',
            featureType: type,
            feature: JSON.parse(JSON.stringify(feature))
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
    await mapStore.removeItem(mapName);
    delete memoryStore.maps[mapName];
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
                await removeFeature(lastAction.featureType, lastAction.feature.id);
                break;
            case 'update':
                await updateFeature(lastAction.featureType, lastAction.oldFeature);
                break;
            case 'remove':
                await addFeature(lastAction.featureType, lastAction.feature);
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
                await removeFeature(lastUndoneAction.featureType, lastUndoneAction.feature.id);
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
            currentMapData.features[type].push(...features);
            action.features[type] = JSON.parse(JSON.stringify(features));
        }
    });
    
    // Salvar no IndexedDB
    await mapStore.setItem(memoryStore.currentMap, currentMapData);
    
    // Registrar ação no histórico apenas se houve alterações
    if (Object.keys(action.features).length > 0) {
        recordAction(action);
    }
};

// Exportar stores para uso direto quando necessário
export { mapStore, imageStore, appStore };

// Manter compatibilidade com código existente
const store = memoryStore;
export default store;
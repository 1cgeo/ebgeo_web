// Path: js\controls_sig\store.js

const mapStore = localforage.createInstance({ name: 'ebgeo_maps' });
const imageStore = localforage.createInstance({ name: 'ebgeo_images' });

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
        processed_visibility: []
    },
    zoom: null,
    center_lat: null,
    center_long: null
});

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

// Funções que trabalham direto com IndexedDB
export const addFeature = async (type, feature) => {
    const currentMapData = await mapStore.getItem(memoryStore.currentMap) || getEmptyMapData();
    currentMapData.features[type].push(feature);
    await mapStore.setItem(memoryStore.currentMap, currentMapData);
    
    // Apenas undo em memória
    recordAction({
        type: 'add',
        featureType: type,
        feature: JSON.parse(JSON.stringify(feature))
    });
};

export const updateFeature = async (type, feature) => {
    const currentMapData = await mapStore.getItem(memoryStore.currentMap) || getEmptyMapData();
    const index = currentMapData.features[type].findIndex(f => f.id == feature.id);
    if (index !== -1) {
        const oldFeature = currentMapData.features[type][index];
        if (JSON.stringify(oldFeature) !== JSON.stringify(feature)) {
            currentMapData.features[type][index] = feature;
            await mapStore.setItem(memoryStore.currentMap, currentMapData);
            
            recordAction({
                type: 'update',
                featureType: type,
                oldFeature: JSON.parse(JSON.stringify(oldFeature)),
                newFeature: JSON.parse(JSON.stringify(feature))
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

export const setCurrentMap = (mapName) => {
    memoryStore.currentMap = mapName;
    
    // Criar stack em memória se não existir
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

export const getMapPosition = async () => {
    const currentMapData = await mapStore.getItem(memoryStore.currentMap) || getEmptyMapData();
    return {
        center_lat: currentMapData.center_lat,
        center_long: currentMapData.center_long,
        zoom: currentMapData.zoom
    };
};

// Funções para listar mapas
export const getAllMapNames = async () => {
    return await mapStore.keys();
};

export const getCurrentMapName = () => {
    return memoryStore.currentMap;
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

export const hasUnsavedData = async () => {
    const allMapKeys = await mapStore.keys();
    for (const mapName of allMapKeys) {
        const mapData = await mapStore.getItem(mapName);
        if (mapData && mapData.features) {
            for (const featureType in mapData.features) {
                if (mapData.features[featureType].length > 0) {
                    return true;
                }
            }
        }
    }
    return false;
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
export { mapStore, imageStore };

// Manter compatibilidade com código existente
const store = memoryStore;
export default store;
// Path: js\controls_sig\store.js

// Constantes para tipos de features
const FEATURE_TYPES = {
    POLYGON: 'polygons',
    LINESTRING: 'linestrings',
    POINT: 'points',
    TEXT: 'texts',
    IMAGE: 'images',
    LOS: 'los',
    VISIBILITY: 'visibility',
    PROCESSED_LOS: 'processed_los',
    PROCESSED_VISIBILITY: 'processed_visibility'
};

// Limite para o histórico de ações
const MAX_HISTORY_SIZE = 20;

// Chaves para localStorage
const STORAGE_KEY = 'ebgeo_data';
const STORAGE_VERSION = '1.0'; // Para gerenciar versões de formato de dados
const AUTOSAVE_ENABLED_KEY = 'ebgeo_autosave_enabled';

// Store principal otimizado
const store = {
    maps: {
        'Principal': createDefaultMap()
    },
    currentMap: 'Principal',
    isUndoing: false,
    isRedoing: false,
    autoSaveEnabled: true,
    lastSaveTime: null,
};

// Criar mapa padrão
function createDefaultMap() {
    return {
        baseLayer: 'Carta',
        features: initializeFeatureContainers(),
        undoStack: [],
        redoStack: [],
        zoom: null,
        center_lat: null,
        center_long: null
    };
}

// Inicializar contêineres para cada tipo de feature
function initializeFeatureContainers() {
    const containers = {};
    Object.values(FEATURE_TYPES).forEach(type => {
        containers[type] = [];
    });
    return containers;
}

// Carregar dados do localStorage
function loadFromLocalStorage() {
    try {
        // Verificar se o localStorage está disponível
        if (!isLocalStorageAvailable()) {
            console.warn('localStorage não está disponível neste navegador');
            return false;
        }

        // Tentar carregar o estado do autosave
        const autoSaveEnabled = localStorage.getItem(AUTOSAVE_ENABLED_KEY);
        if (autoSaveEnabled !== null) {
            store.autoSaveEnabled = autoSaveEnabled === 'true';
        }

        // Se autosave estiver desativado, não carregamos os dados
        if (!store.autoSaveEnabled) {
            return false;
        }

        const savedDataString = localStorage.getItem(STORAGE_KEY);
        if (!savedDataString) {
            return false;
        }

        const savedData = JSON.parse(savedDataString);
        
        // Verificar versão dos dados
        if (savedData.version !== STORAGE_VERSION) {
            console.warn(`Versão de dados incompatível: ${savedData.version}. Esperado: ${STORAGE_VERSION}`);
            return false;
        }

        // Reconstruir o estado completo
        if (savedData.maps && Object.keys(savedData.maps).length > 0) {
            // Garantir que todas as features tenham as propriedades necessárias
            Object.keys(savedData.maps).forEach(mapName => {
                const mapData = savedData.maps[mapName];
                // Adicionar undoStack e redoStack (não são salvos no localStorage)
                mapData.undoStack = [];
                mapData.redoStack = [];
                
                // Processar features para garantir propriedades necessárias
                if (mapData.features) {
                    Object.keys(mapData.features).forEach(featureType => {
                        if (Array.isArray(mapData.features[featureType])) {
                            mapData.features[featureType].forEach(feature => {
                                if (feature.properties) {
                                    if (!feature.properties.customAttributes) {
                                        feature.properties.customAttributes = {};
                                    }
                                    if (feature.properties.name === undefined) {
                                        feature.properties.name = '';
                                    }
                                    if (!feature.properties.images) {
                                        feature.properties.images = [];
                                    }
                                }
                            });
                        }
                    });
                }
            });

            store.maps = savedData.maps;
            store.currentMap = savedData.currentMap || 'Principal';
            
            // Se o mapa atual não existe, selecionar o primeiro disponível
            if (!store.maps[store.currentMap]) {
                store.currentMap = Object.keys(store.maps)[0];
            }

            store.lastSaveTime = savedData.saveTime;
            
            console.log('Dados carregados do localStorage:', 
                `${Object.keys(store.maps).length} mapas, ` +
                `último salvamento: ${new Date(store.lastSaveTime).toLocaleString()}`);
            
            return true;
        }
        
        return false;
    } catch (error) {
        console.error('Erro ao carregar dados do localStorage:', error);
        return false;
    }
}

// Salvar dados para localStorage
function saveToLocalStorage() {
    try {
        // Verificar se o localStorage está disponível
        if (!isLocalStorageAvailable()) {
            console.warn('localStorage não está disponível neste navegador');
            return false;
        }

        // Se autosave estiver desativado, não salvamos os dados
        if (!store.autoSaveEnabled) {
            return false;
        }

        // Preparar uma versão limpa do estado para salvar
        const dataToSave = {
            version: STORAGE_VERSION,
            saveTime: Date.now(),
            currentMap: store.currentMap,
            maps: {}
        };

        // Copiar mapas sem undoStack e redoStack (que são grandes e não necessários para restauração)
        Object.keys(store.maps).forEach(key => {
            const { undoStack, redoStack, ...mapData } = store.maps[key];
            
            // Garantir que todas as features tenham propriedades necessárias
            if (mapData.features) {
                Object.keys(mapData.features).forEach(featureType => {
                    mapData.features[featureType].forEach(feature => {
                        if (feature.properties) {
                            if (!feature.properties.customAttributes) {
                                feature.properties.customAttributes = {};
                            }
                            if (feature.properties.name === undefined) {
                                feature.properties.name = '';
                            }
                            if (!feature.properties.images) {
                                feature.properties.images = [];
                            }
                        }
                    });
                });
            }
            
            dataToSave.maps[key] = mapData;
        });

        // Verificar o tamanho dos dados
        const dataString = JSON.stringify(dataToSave);
        const dataSize = new Blob([dataString]).size;
        const maxSize = 5 * 1024 * 1024; // 5MB
        
        if (dataSize > maxSize) {
            console.error(`Dados excedem o limite de tamanho do localStorage (${(dataSize / 1024 / 1024).toFixed(2)}MB / 5MB)`);
            return false;
        }

        // Salvar no localStorage
        localStorage.setItem(STORAGE_KEY, dataString);
        localStorage.setItem(AUTOSAVE_ENABLED_KEY, store.autoSaveEnabled.toString());
        
        store.lastSaveTime = dataToSave.saveTime;
        
        console.log(`Dados salvos no localStorage (${(dataSize / 1024).toFixed(2)}KB)`);
        return true;
    } catch (error) {
        console.error('Erro ao salvar dados no localStorage:', error);
        return false;
    }
}

// Limpar dados do localStorage
function clearLocalStorage() {
    try {
        if (!isLocalStorageAvailable()) {
            console.warn('localStorage não está disponível neste navegador');
            return false;
        }
        
        localStorage.removeItem(STORAGE_KEY);
        console.log('Dados removidos do localStorage');
        return true;
    } catch (error) {
        console.error('Erro ao limpar dados do localStorage:', error);
        return false;
    }
}

// Verificar se localStorage está disponível
function isLocalStorageAvailable() {
    try {
        const test = '__storage_test__';
        localStorage.setItem(test, test);
        localStorage.removeItem(test);
        return true;
    } catch (e) {
        return false;
    }
}

// Autosalvar após alterações (com debounce)
let autoSaveTimeout = null;
function scheduleAutoSave() {
    if (!store.autoSaveEnabled) return;
    
    if (autoSaveTimeout) {
        clearTimeout(autoSaveTimeout);
    }
    
    autoSaveTimeout = setTimeout(() => {
        saveToLocalStorage();
        autoSaveTimeout = null;
    }, 2000); // Debounce de 2 segundos
}

// API Pública
export const toggleAutoSave = (enabled) => {
    if (enabled !== undefined) {
        store.autoSaveEnabled = enabled;
    } else {
        store.autoSaveEnabled = !store.autoSaveEnabled;
    }
    
    localStorage.setItem(AUTOSAVE_ENABLED_KEY, store.autoSaveEnabled.toString());
    
    if (store.autoSaveEnabled) {
        scheduleAutoSave();
    }
    
    return store.autoSaveEnabled;
};

export const getAutoSaveStatus = () => ({
    enabled: store.autoSaveEnabled,
    lastSave: store.lastSaveTime ? new Date(store.lastSaveTime) : null
});

export const updateMapPosition = (center_lat, center_long, zoom) => {
    const currentMap = store.maps[store.currentMap];
    currentMap.center_lat = center_lat;
    currentMap.center_long = center_long;
    currentMap.zoom = zoom;
    scheduleAutoSave();
};

export const getMapPosition = () => {
    const currentMap = store.maps[store.currentMap];
    return {
        center_lat: currentMap.center_lat, 
        center_long: currentMap.center_long, 
        zoom: currentMap.zoom
    };
};

// Registrar ação no histórico com limite de tamanho
const recordAction = (action) => {
    const currentMap = store.maps[store.currentMap];
    
    if (!store.isUndoing && !store.isRedoing) {
        currentMap.undoStack.push(action);
        
        // Limitar tamanho do histórico
        if (currentMap.undoStack.length > MAX_HISTORY_SIZE) {
            currentMap.undoStack.shift();
        }
        
        // Limpar pilha de refazer
        currentMap.redoStack = [];
    }
    
    // Agendar autosave após qualquer ação
    scheduleAutoSave();
};

// Garantir que features tenham customAttributes
const ensureCustomAttributes = (feature) => {
    if (feature.properties) {
        if (!feature.properties.customAttributes) {
            feature.properties.customAttributes = {};
        }
    }
    return feature;
};

// Adição de feature com validação
export const addFeature = (type, feature) => {
    feature = ensureCustomAttributes(feature);
    
    const features = store.maps[store.currentMap].features[type];
    features.push(feature);
    
    recordAction({
        type: 'add',
        featureType: type,
        feature: structuredClone(feature) // Usar structuredClone para cópia profunda
    });
};

// Adição de múltiplas features em batch
export const addFeatures = (featuresByType) => {
    const recordData = {};
    
    Object.entries(featuresByType).forEach(([type, features]) => {
        if (!features || features.length === 0) return;
        
        // Garantir customAttributes em todas as features
        features.forEach(ensureCustomAttributes);
        
        // Adicionar ao store
        store.maps[store.currentMap].features[type].push(...features);
        
        // Clonar para histórico
        recordData[type] = structuredClone(features);
    });
    
    // Registrar ação única para todas as features
    if (Object.keys(recordData).length > 0) {
        recordAction({
            type: 'addMultiple',
            features: recordData
        });
    }
};

// Atualização de feature com comparação de igualdade
export const updateFeature = (type, feature) => {
    const features = store.maps[store.currentMap].features[type];
    const index = features.findIndex(f => f.id == feature.id);
    
    if (index === -1) return;
    
    const oldFeature = features[index];
    
    // Garantir customAttributes
    feature = ensureCustomAttributes(feature);
    
    // Verificar se houve mudança real
    if (JSON.stringify(oldFeature) !== JSON.stringify(feature)) {
        // Armazenar cópia do estado antigo e novo
        const oldFeatureCopy = structuredClone(oldFeature);
        const newFeatureCopy = structuredClone(feature);
        
        // Atualizar feature
        features[index] = feature;
        
        // Registrar ação
        recordAction({
            type: 'update',
            featureType: type,
            oldFeature: oldFeatureCopy,
            newFeature: newFeatureCopy
        });
    }
};

// Remoção de feature
export const removeFeature = (type, id) => {
    const features = store.maps[store.currentMap].features[type];
    const index = features.findIndex(f => f.id == id);
    
    if (index === -1) return;
    
    // Armazenar cópia da feature removida
    const feature = structuredClone(features[index]);
    
    // Remover feature
    features.splice(index, 1);
    
    // Registrar ação
    recordAction({
        type: 'remove',
        featureType: type,
        feature: feature
    });
};

// Remoção de múltiplas features em batch
export const removeFeatures = (featureIds) => {
    const removedFeatures = {};
    
    Object.entries(featureIds).forEach(([type, ids]) => {
        if (!ids || ids.length === 0) return;
        
        const features = store.maps[store.currentMap].features[type];
        removedFeatures[type] = [];
        
        ids.forEach(id => {
            const index = features.findIndex(f => f.id == id);
            if (index !== -1) {
                const feature = structuredClone(features[index]);
                features.splice(index, 1);
                removedFeatures[type].push(feature);
            }
        });
    });
    
    // Registrar ação única para todas as remoções
    if (Object.values(removedFeatures).some(arr => arr.length > 0)) {
        recordAction({
            type: 'removeMultiple',
            features: removedFeatures
        });
    }
};

// Gerenciamento de mapas
export const addMap = (mapName, mapData = null) => {
    store.maps[mapName] = mapData || createDefaultMap();
    scheduleAutoSave();
};

export const removeMap = (mapName) => {
    delete store.maps[mapName];
    scheduleAutoSave();
};

export const renameMap = (oldName, newName) => {
    if (store.maps[oldName]) {
        store.maps[newName] = store.maps[oldName];
        delete store.maps[oldName];
        if (store.currentMap === oldName) {
            store.currentMap = newName;
        }
        scheduleAutoSave();
    }
};

export const setCurrentMap = (mapName) => {
    store.currentMap = mapName;
    scheduleAutoSave();
};

// Memoizar o resultado para evitar cópias desnecessárias
let cachedMapFeatures = null;
let cachedMapName = null;

export const getCurrentMapFeatures = () => {
    // Verificar se já existe um cache válido
    if (cachedMapName === store.currentMap && cachedMapFeatures) {
        return cachedMapFeatures;
    }
    
    // Criar uma cópia profunda das features
    cachedMapFeatures = structuredClone(store.maps[store.currentMap].features);
    cachedMapName = store.currentMap;
    
    return cachedMapFeatures;
};

export const getCurrentBaseLayer = () => {
    return store.maps[store.currentMap].baseLayer;
};

export const setBaseLayer = (layer) => {
    store.maps[store.currentMap].baseLayer = layer;
    scheduleAutoSave();
};

// Desfazer ação
export const undoLastAction = () => {
    const currentMap = store.maps[store.currentMap];
    const lastAction = currentMap.undoStack.pop();
    if (!lastAction) return false;

    store.isUndoing = true;
    currentMap.redoStack.push(lastAction);

    switch (lastAction.type) {
        case 'add':
            removeFeature(lastAction.featureType, lastAction.feature.id);
            break;
        case 'update':
            updateFeature(lastAction.featureType, lastAction.oldFeature);
            break;
        case 'remove':
            addFeature(lastAction.featureType, lastAction.feature);
            break;
        case 'addMultiple':
            // Desfazer adição múltipla
            const featureIdsToRemove = {};
            Object.entries(lastAction.features).forEach(([type, features]) => {
                featureIdsToRemove[type] = features.map(f => f.id);
            });
            
            // Remover sem registrar histórico
            Object.entries(featureIdsToRemove).forEach(([type, ids]) => {
                const features = currentMap.features[type];
                for (let i = features.length - 1; i >= 0; i--) {
                    if (ids.includes(features[i].id)) {
                        features.splice(i, 1);
                    }
                }
            });
            break;
        case 'removeMultiple':
            // Desfazer remoção múltipla
            Object.entries(lastAction.features).forEach(([type, features]) => {
                currentMap.features[type].push(...features);
            });
            break;
    }

    // Limpar cache para forçar recriação
    cachedMapName = null;
    cachedMapFeatures = null;

    store.isUndoing = false;
    scheduleAutoSave();
    return true;
};

// Refazer ação
export const redoLastAction = () => {
    const currentMap = store.maps[store.currentMap];
    const lastUndoneAction = currentMap.redoStack.pop();
    if (!lastUndoneAction) return false;

    store.isRedoing = true;
    currentMap.undoStack.push(lastUndoneAction);

    switch (lastUndoneAction.type) {
        case 'add':
            addFeature(lastUndoneAction.featureType, lastUndoneAction.feature);
            break;
        case 'update':
            updateFeature(lastUndoneAction.featureType, lastUndoneAction.newFeature);
            break;
        case 'remove':
            removeFeature(lastUndoneAction.featureType, lastUndoneAction.feature.id);
            break;
        case 'addMultiple':
            // Refazer adição múltipla
            Object.entries(lastUndoneAction.features).forEach(([type, features]) => {
                currentMap.features[type].push(...features);
            });
            break;
        case 'removeMultiple':
            // Refazer remoção múltipla
            Object.entries(lastUndoneAction.features).forEach(([type, features]) => {
                features.forEach(feature => {
                    const index = currentMap.features[type].findIndex(f => f.id == feature.id);
                    if (index !== -1) {
                        currentMap.features[type].splice(index, 1);
                    }
                });
            });
            break;
    }

    // Limpar cache para forçar recriação
    cachedMapName = null;
    cachedMapFeatures = null;

    store.isRedoing = false;
    scheduleAutoSave();
    return true;
};

export const hasUnsavedData = () => {
    for (const mapName in store.maps) {
        const features = store.maps[mapName].features;
        
        // Verificar se há features em qualquer contêiner
        const hasFeatures = Object.values(features).some(
            container => container.length > 0
        );
        
        if (hasFeatures) return true;
    }
    
    return false;
};

// Operações de localStorage como parte da API pública
export const saveToLocalStorageManually = () => {
    return saveToLocalStorage();
};

export const loadFromLocalStorageManually = () => {
    return loadFromLocalStorage();
};

export const clearLocalStorageManually = () => {
    return clearLocalStorage();
};

// Inicialização: tentar carregar do localStorage ao iniciar
(function initialize() {
    loadFromLocalStorage();
})();

export default store;
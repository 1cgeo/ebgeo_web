const store = {
    maps: {
        'Principal': {
            baseLayer: 'Carta',
            features: {
                polygons: [],
                linestrings: [],
                points: [],
                texts: [],
                images: [],
            }
        }
    },
    currentMap: 'Principal',
};

export const addFeature = (type, feature) => {
    store.maps[store.currentMap].features[type].push(feature);
};

export const updateFeature = (type, feature) => {
    const index = store.maps[store.currentMap].features[type].findIndex(f => f.id == feature.id);
    if (index !== -1) {
        store.maps[store.currentMap].features[type][index] = feature;
    }
};

export const removeFeature = (type, id) => {
    store.maps[store.currentMap].features[type] = store.maps[store.currentMap].features[type].filter(feature => feature.id != id);
};

export const addMap = (mapName) => {
    store.maps[mapName] = {
        baseLayer: 'Carta',
        features: {
            polygons: [],
            linestrings: [],
            points: [],
            texts: [],
            images: [],
        }
    };
};

export const removeMap = (mapName) => {
    delete store.maps[mapName];
};

export const setCurrentMap = (mapName) => {
    store.currentMap = mapName;
};

export const getCurrentMapFeatures = () => {
    return JSON.parse(JSON.stringify(store.maps[store.currentMap].features));
};

export const getCurrentBaseLayer = () => {
    return store.maps[store.currentMap].baseLayer;
};

export const setBaseLayer = (layer) => {
    store.maps[store.currentMap].baseLayer = layer;
};

export default store;
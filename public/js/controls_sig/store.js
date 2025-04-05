// Path: js\controls_sig\store.js
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
                los: [],
                visibility: [],
                processed_los: [],
                processed_visibility: []
            },
            undoStack: [],
            redoStack: [],
            zoom: null,
            center_lat: null,
            center_long: null
        }
    },
    currentMap: 'Principal',
    isUndoing: false,
    isRedoing: false,
};

export const updateMapPosition = (center_lat, center_long, zoom) => {
    const currentMap = store.maps[store.currentMap];
    currentMap.center_lat = center_lat
    currentMap.center_long = center_long
    currentMap.zoom = zoom
}

export const getMapPosition = () => {
    const currentMap = store.maps[store.currentMap];
    return {center_lat: currentMap.center_lat, center_long: currentMap.center_long, zoom: currentMap.zoom}
}

const recordAction = (action) => {
    const currentMap = store.maps[store.currentMap];
    if (!store.isUndoing && !store.isRedoing) {
        currentMap.undoStack.push(action);
        if (currentMap.undoStack.length > 20) {
            currentMap.undoStack.shift(); // Remove the oldest action if stack exceeds 20
        }
        currentMap.redoStack = []; // Clear the redo stack when a new action is performed
    }
};

export const addFeature = (type, feature) => {
    store.maps[store.currentMap].features[type].push(feature);
    recordAction({
        type: 'add',
        featureType: type,
        feature: JSON.parse(JSON.stringify(feature))
    });
};

export const updateFeature = (type, feature) => {
    const index = store.maps[store.currentMap].features[type].findIndex(f => f.id == feature.id);
    if (index !== -1) {
        const oldFeature = store.maps[store.currentMap].features[type][index];
        if (JSON.stringify(oldFeature) !== JSON.stringify(feature)) {
            store.maps[store.currentMap].features[type][index] = feature;
            recordAction({
                type: 'update',
                featureType: type,
                oldFeature: JSON.parse(JSON.stringify(oldFeature)),
                newFeature: JSON.parse(JSON.stringify(feature))
            });
        }
    }
};

export const removeFeature = (type, id) => {
    const featureIndex = store.maps[store.currentMap].features[type].findIndex(f => f.id == id);
    if (featureIndex !== -1) {
        const feature = store.maps[store.currentMap].features[type].splice(featureIndex, 1)[0];
        recordAction({
            type: 'remove',
            featureType: type,
            feature: JSON.parse(JSON.stringify(feature))
        });
    }
};

export const addMap = (mapName, mapData = null) => {
    store.maps[mapName] = mapData || {
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
        undoStack: [],
        redoStack: [],
        zoom: null,
        center_lat: null,
        center_long: null
    };
};

export const removeMap = (mapName) => {
    delete store.maps[mapName];
};

export const renameMap = (oldName, newName) => {
    if (store.maps[oldName]) {
        store.maps[newName] = store.maps[oldName];
        delete store.maps[oldName];
        if (store.currentMap === oldName) {
            store.currentMap = newName;
        }
    }
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
        default:
            break;
    }

    store.isUndoing = false;
    return true;

};

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
        default:
            break;
    }

    store.isRedoing = false;
    return true;

};

export const hasUnsavedData = () => {
    const maps = store.maps;
    for (const mapName in maps) {
        const features = maps[mapName].features;
        for (const featureType in features) {
            if (features[featureType].length > 0) {
                return true;
            }
        }
    }
    return false;
};

export default store;
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
    undoStack: [],
    redoStack: [],
    isUndoing: false,
    isRedoing: false,
};

const recordAction = (action) => {
    if (!store.isUndoing && !store.isRedoing) {
        store.undoStack.push(action);
        store.redoStack = []; // Clear the redo stack when a new action is performed
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
        const oldFeature = JSON.parse(JSON.stringify(store.maps[store.currentMap].features[type][index]));
        store.maps[store.currentMap].features[type][index] = feature;
        recordAction({
            type: 'update',
            featureType: type,
            oldFeature,
            newFeature: JSON.parse(JSON.stringify(feature))
        });
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

export const undoLastAction = () => {
    const lastAction = store.undoStack.pop();
    if (!lastAction) return;

    store.isUndoing = true;

    store.redoStack.push(lastAction);

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
};

export const redoLastAction = () => {
    const lastUndoneAction = store.redoStack.pop();
    if (!lastUndoneAction) return;

    store.isRedoing = true;

    store.undoStack.push(lastUndoneAction);

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
};

export default store;
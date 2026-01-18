// Path: js/store/index.js

/**
 * @fileoverview Public API for the store module.
 */

// Re-export everything from the store facade
export * from './store.js';

// Named exports for specific modules (for direct imports if needed)
export * as featureOps from './feature.operations.js';
export * as mapOps from './map.operations.js';
export * as layerOps from './layer.operations.js';
export * as groupOps from './group.operations.js';
export * as settingsOps from './settings.operations.js';
export * as storeConstants from './store.constants.js';

// Services (dependency injection container)
export {
    initServices,
    getServices,
    getEventBus,
    getStateManager
} from './services.js';

// Repository exports (for internal module usage)
export {
    memoryStore,
    setMapGroups,
    getMapGroups as getMapGroupsFromDB,
    getMapData,
    updateMapData,
    setLayers as setLayersRepo,
    getLayers as getLayersRepo,
    setActiveLayerId as setActiveLayerIdRepo,
    getActiveLayerId as getActiveLayerIdRepo,
    getDefaultLayer
} from './repository.js';

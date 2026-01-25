// Path: js/store/index.js

/**
 * @fileoverview Public API for the store module.
 */

// Re-export everything from the store facade
export * from './store.js';

// Services (dependency injection container)
export {
    initServices,
    getServices,
    getEventBus,
    getStateManager
} from './services.js';

// Control Registry (centralized access to tool controls)
export {
    registerControl,
    getControl
} from './control.registry.js';

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

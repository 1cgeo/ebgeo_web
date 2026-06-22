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
    getStateManager,
    getLayerManager,
    getGroupManager,
    getMapResolver
} from './services.js';

// Control Registry (centralized access to tool controls)
export {
    registerControl,
    getControl
} from './control.registry.js';

// Repository exports (for internal module usage)
// NOTE: These are from the new modular structure
export { memoryStore } from './memory-store.js';
export { getDefaultLayer, getEmptyCesium3dData } from './repository.utils.js';
export {
    getMapDataCompat as getMapData,
    updateMapDataCompat as updateMapData,
    setGroupsCompat as setMapGroups,
    getGroupsCompat as getMapGroupsFromDB,
    setLayersCompat as setLayersRepo,
    getLayersCompat as getLayersRepo,
    setActiveLayerIdCompat as setActiveLayerIdRepo,
    getActiveLayerIdCompat as getActiveLayerIdRepo,
    getCesium3dCompat as getCesium3dData,
    setCesium3dCompat as setCesium3dData
} from './repositories/index.js';

// Store error conventions and emit helper
export { StoreErrorEvents, emitStoreError } from './store-errors.js';

// Briefing operations
export {
    DEFAULT_BRIEFING_SETTINGS,
    SlideMode,
    createEmptySlide,
    createEmptyBriefing,
    getAllBriefings,
    getBriefingById,
    createBriefing,
    updateBriefing,
    deleteBriefing,
    generateUniqueBriefingName,
    addSlide,
    updateSlide,
    removeSlide,
    reorderSlides,
    getBriefingsForExport,
    importBriefings
} from './briefing.operations.js';

// Spatial comment operations
export {
    addComment,
    addReply,
    updateComment,
    resolveComment,
    removeComment,
    getComments,
    setMapComments
} from './comment.operations.js';

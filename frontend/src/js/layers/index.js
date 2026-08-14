// Path: js/layers/index.js

/**
 * @fileoverview Public API for layers module.
 */

export {
    setupMapFeatures,
    updateAllLayerFilters,
    invalidateFilterCache,
    applyLayerOpacities,
    invalidateOpacityCache
} from './layer_setup.js';

export {
    FEATURE_LAYER_IDS,
    HATCH_PATTERN_LAYERS,
    FEATURE_SOURCES
} from './layer.constants.js';

export {
    createLayerVisibilityFilter,
    createHatchLayerFilter
} from './visibility-filter.js';

export {
    LayerManager,
    createLayerManager,
    layerManagerHolder
} from './layer.manager.js';

// Prefer the direct import `@layers/geojson-dispatcher.js` at call sites: this barrel also pulls
// `layer_setup.js`, and with it the store.
export {
    GeoJsonDispatcher,
    getGeoJsonDispatcher,
    peekGeoJsonDispatcher,
    writeWholeCollection,
    destroyGeoJsonDispatcher,
    destroyGeoJsonDispatchers,
    coalesceOps,
    createEmptyPending,
    isPendingEmpty,
    pendingToDiff,
    applyPendingToFeatures,
    defaultKeyOf
} from './geojson-dispatcher.js';

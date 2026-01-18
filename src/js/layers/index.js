// Path: js/layers/index.js

/**
 * @fileoverview Public API for layers module.
 */

export {
    setupMapFeatures,
    updateAllLayerFilters,
    invalidateFilterCache
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
    default as LayerManager,
    LayerManager as LayerManagerClass,
    createLayerManager,
    layerManagerHolder
} from './layer.manager.js';

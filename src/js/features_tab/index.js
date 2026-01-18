// Path: js/features_tab/index.js

/**
 * @fileoverview Public API for features_tab module.
 */

// Main class
export { FeaturesTab } from './features_tab.js';

// Constants
export {
    FEATURES_TAB_ICONS,
} from './features_tab.icons.js';
export {
    FEATURE_SOURCES,
    REFRESH_DEBOUNCE_MS,
    FEATURE_DISPLAY_NAMES,
    getFeatureDisplayName,
} from './features_tab.constants.js';

// Styles
export { injectAllFeaturesTabStyles } from './features_tab.styles.js';

// Services and managers
export {
    CollapseStateManager,
    getCollapseStateManager,
} from './collapse-state.manager.js';
export {
    getFeaturesFromMapSources,
    organizeFeaturesByLayers,
    flattenAndSortFeatures,
    countTotalFeatures,
} from './feature-organizer.service.js';
export {
    initLayerSortable,
    destroySortable,
} from './sortable.handler.js';

// Builders
export {
    createLayerContainer,
    applyLayerCollapseState,
    applyGroupCollapseState,
} from './layer-container.builder.js';

// Components (re-exports for convenience)
export {
    createLayerHeader,
    handleSetActiveLayer,
    handleAddLayer,
    updateActiveLayerIndicators,
    updateLayerVisibilityIndicator,
    updateLayerLockIndicator,
} from './layer-list.component.js';
export {
    createFeatureItem,
    handleFeatureClick,
    toggleFeatureVisibility,
    toggleFeatureLock,
    updateVisibilityButton,
    updateLockButton,
    updateItemVisualState,
} from './feature-item.component.js';
export {
    createGroupItem,
    createGroupItemInLayer,
    handleGroupFeatureClick,
    toggleGroupExpansion,
    toggleGroupVisibility,
    toggleGroupLock,
    updateGroupVisualState,
    updateGroupLockState,
} from './group-item.component.js';
export {
    createHillshadeControl,
    loadHillshadeState,
} from './hillshade.component.js';
export {
    createAnalysisLayersContainer,
    renderAnalysisLayersControl,
} from './analysis-layers.component.js';

// Path: js/events/event_types.js

/**
 * @fileoverview Centralized event type definitions for EBGeo.
 * All event names follow the pattern: domain:action
 *
 * Design principle: Only define events that have both emitters AND subscribers.
 * Dead code events have been removed to maintain clarity.
 */

/**
 * Application-wide event type constants.
 * Use these instead of hardcoded strings to ensure consistency and enable refactoring.
 * @readonly
 * @enum {string}
 */
export const EventTypes = Object.freeze({
    // ===== LAYERS =====
    /**
     * Emitted when layer list changes (create, delete, reorder, visibility, locked).
     * Subscribers: features_tab.js, layer_setup.js
     * Emitters: store.js, layer_manager.js, context_menu_control.js, features_tab.js, add_import_control.js
     */
    LAYERS_CHANGED: 'layers:changed',

    // ===== GROUPS =====
    /**
     * Emitted when group list changes (create, delete, combine, feature assignment).
     * Subscribers: features_tab.js
     * Emitters: group_manager.js
     */
    GROUPS_CHANGED: 'groups:changed',

    // ===== FEATURES =====
    /**
     * Emitted when a feature's user data changes (attributes or images).
     * Subscribers: user_data_panel.js
     * Emitters: user_data_manager.js
     */
    FEATURE_UPDATED: 'feature:updated',

    // =========================================================================
    // UI REDESIGN EVENTS
    // =========================================================================

    // ===== SIDEBAR =====
    /**
     * Emitted when sidebar panel expands.
     * Payload: { tab: string }
     * Subscribers: SearchBar, Chips, BaseLayerSelector, UIManager
     * Emitters: StateManager.expandSidebar()
     */
    SIDEBAR_EXPANDED: 'sidebar:expanded',

    /**
     * Emitted when sidebar panel collapses.
     * Payload: {}
     * Subscribers: SearchBar, Chips, BaseLayerSelector, UIManager
     * Emitters: StateManager.collapseSidebar()
     */
    SIDEBAR_COLLAPSED: 'sidebar:collapsed',

    /**
     * Emitted when active sidebar tab changes.
     * Payload: { previousTab: string|null, currentTab: string }
     * Subscribers: Sidebar components
     * Emitters: StateManager.expandSidebar(), StateManager.collapseSidebar()
     */
    SIDEBAR_TAB_CHANGED: 'sidebar:tabChanged',

    // ===== FEATURE PANEL =====
    /**
     * Emitted when feature attributes panel opens.
     * Payload: { featureId: string, featureType: string }
     * Subscribers: Sidebar, UIManager
     * Emitters: StateManager.openFeaturePanel()
     */
    FEATURE_PANEL_OPENED: 'featurePanel:opened',

    /**
     * Emitted when feature attributes panel closes.
     * Payload: {}
     * Subscribers: Sidebar, UIManager
     * Emitters: StateManager.closeFeaturePanel()
     */
    FEATURE_PANEL_CLOSED: 'featurePanel:closed',

    // ===== VECTOR TILE INFO PANEL =====
    /**
     * Emitted when vector tile info panel should open.
     * Payload: { feature: Object, title: string }
     * Subscribers: Sidebar
     * Emitters: UIManager.showVectorTileInfoPanel()
     */
    VECTOR_INFO_PANEL_OPENED: 'vectorInfoPanel:opened',

    // ===== TOOLBAR =====
    /**
     * Emitted when a toolbar group popup opens.
     * Payload: { group: 'draw' | 'military' | 'analysis' }
     * Subscribers: Toolbar, other popups
     * Emitters: StateManager.openToolbarGroup()
     */
    TOOLBAR_GROUP_OPENED: 'toolbar:groupOpened',

    /**
     * Emitted when a toolbar group popup closes.
     * Payload: { group: string }
     * Subscribers: Toolbar
     * Emitters: StateManager.closeToolbarGroup()
     */
    TOOLBAR_GROUP_CLOSED: 'toolbar:groupClosed',

    // ===== BASE LAYER SELECTOR =====
    /**
     * Emitted when base layer selector expands.
     * Payload: {}
     * Subscribers: BaseLayerSelector
     * Emitters: BaseLayerSelector
     */
    BASE_LAYER_SELECTOR_OPENED: 'baseLayerSelector:opened',

    /**
     * Emitted when base layer selector collapses.
     * Payload: {}
     * Subscribers: BaseLayerSelector
     * Emitters: BaseLayerSelector
     */
    BASE_LAYER_SELECTOR_CLOSED: 'baseLayerSelector:closed',

    // ===== UI LAYOUT =====
    /**
     * Emitted when UI layout changes (sidebar/panel state affects positioning).
     * Payload: { sidebarExpanded: boolean, featurePanelOpen: boolean, contentLeftOffset: number }
     * Subscribers: SearchBar, Chips, any positioned elements
     * Emitters: StateManager._emitLayoutChanged()
     */
    UI_LAYOUT_CHANGED: 'ui:layoutChanged',

    /**
     * Emitted to close all popups and panels.
     * Payload: {}
     * Subscribers: All popup/panel components
     * Emitters: StateManager.closeAllPopups(), Escape key handler
     */
    UI_CLOSE_ALL_POPUPS: 'ui:closeAllPopups',

    // ===== MAP NOTES =====
    /**
     * Emitted when map notes are requested to be shown.
     * Payload: { mapName: string }
     * Subscribers: SidebarControl
     * Emitters: MapsTab
     */
    MAP_NOTES_REQUESTED: 'mapNotes:requested',

    // ===== SEARCH =====
    /**
     * Emitted when a search result should be shown in the feature panel.
     * Payload: { result: Object, content: HTMLElement }
     * Subscribers: SidebarControl
     * Emitters: SearchBarComponent
     */
    SEARCH_RESULT_PANEL_REQUESTED: 'search:resultPanelRequested',

    // ===== CATALOG =====
    /**
     * Emitted when a catalog layer should be added to the map.
     * Payload: { type: string, item: CatalogItem }
     * Subscribers: catalog-layers.component.js
     * Emitters: CatalogModal
     * NOTE: Uses hardcoded string 'CATALOG_ADD_LAYER' in code, not this constant.
     */
    CATALOG_ADD_LAYER: 'CATALOG_ADD_LAYER',
});

/**
 * Property types for FEATURE_UPDATED event.
 * Identifies which aspect of the feature was modified.
 * @readonly
 * @enum {string}
 */
export const FeatureUpdateProperty = Object.freeze({
    ATTRIBUTES: 'attributes',
    IMAGES: 'images',
});

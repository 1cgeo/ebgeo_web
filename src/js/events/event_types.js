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

    /**
     * Emitted when a layer is created.
     * Payload: { layerId: string, mapId: string, layer: Object }
     * Subscribers: Sync system, real-time UI updates
     * Emitters: layer.operations.js
     */
    LAYER_CREATED: 'layer:created',

    /**
     * Emitted when a layer is modified (name, visibility, locked).
     * Payload: { layerId: string, mapId: string, layer: Object, previousLayer: Object }
     * Subscribers: Sync system, real-time UI updates
     * Emitters: layer.operations.js
     */
    LAYER_MODIFIED: 'layer:modified',

    /**
     * Emitted when a layer is deleted.
     * Payload: { layerId: string, mapId: string }
     * Subscribers: Sync system, real-time UI updates
     * Emitters: layer.operations.js
     */
    LAYER_DELETED: 'layer:deleted',

    // ===== GROUPS =====
    /**
     * Emitted when group list changes (create, delete, combine, feature assignment).
     * Subscribers: features_tab.js
     * Emitters: group_manager.js
     */
    GROUPS_CHANGED: 'groups:changed',

    /**
     * Emitted when a group is created.
     * Payload: { groupId: string, mapId: string, group: Object }
     * Subscribers: Sync system, real-time UI updates
     * Emitters: group_manager.js
     */
    GROUP_CREATED: 'group:created',

    /**
     * Emitted when a group is modified (name, features, visibility, locked).
     * Payload: { groupId: string, mapId: string, group: Object, previousGroup: Object }
     * Subscribers: Sync system, real-time UI updates
     * Emitters: group_manager.js
     */
    GROUP_MODIFIED: 'group:modified',

    /**
     * Emitted when a group is deleted.
     * Payload: { groupId: string, mapId: string }
     * Subscribers: Sync system, real-time UI updates
     * Emitters: group_manager.js
     */
    GROUP_DELETED: 'group:deleted',

    // ===== FEATURES =====
    /**
     * Emitted when a feature's user data changes (attributes or images).
     * Subscribers: user_data_panel.js
     * Emitters: user_data_manager.js
     */
    FEATURE_UPDATED: 'feature:updated',

    /**
     * Emitted when a feature is created.
     * Payload: { featureId: string, featureType: string, mapId: string, feature: Object }
     * Subscribers: Sync system, real-time UI updates
     * Emitters: feature.operations.js
     */
    FEATURE_CREATED: 'feature:created',

    /**
     * Emitted when a feature is modified (geometry or properties).
     * Payload: { featureId: string, featureType: string, mapId: string, feature: Object, previousFeature: Object }
     * Subscribers: Sync system, real-time UI updates
     * Emitters: feature.operations.js
     */
    FEATURE_MODIFIED: 'feature:modified',

    /**
     * Emitted when a feature is deleted.
     * Payload: { featureId: string, featureType: string, mapId: string }
     * Subscribers: Sync system, real-time UI updates
     * Emitters: feature.operations.js
     */
    FEATURE_DELETED: 'feature:deleted',

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

    // ===== BASE LAYER =====
    /**
     * Emitted when base layer (basemap) changes.
     * Payload: { layer: string }
     * Subscribers: Add3DModelsViewerControl, AddStreetViewControl, BaseLayerSelectorControl
     * Emitters: BaseLayerControl.switchMap()
     */
    BASE_LAYER_CHANGED: 'baseLayer:changed',

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

    // ===== 3D VIEWER =====
    /**
     * Emitted when 3D viewer opens with a tileset.
     * Payload: { tilesetId: string }
     * Subscribers: Sidebar, UI components
     * Emitters: map_3d.js
     */
    VIEWER_3D_OPENED: 'viewer3d:opened',

    /**
     * Emitted when 3D viewer closes.
     * Payload: {}
     * Subscribers: Sidebar, UI components
     * Emitters: map_3d.js
     */
    VIEWER_3D_CLOSED: 'viewer3d:closed',

    /**
     * Emitted when a 3D marker is clicked.
     * Payload: { marker: Cesium3DMarker, tilesetId: string }
     * Subscribers: Sidebar (to open marker panel)
     * Emitters: marker_tool_3d.js
     */
    MARKER_3D_CLICKED: 'marker3d:clicked',

    /**
     * Emitted when a 3D marker is deselected (clicking empty area).
     * Payload: { tilesetId: string }
     * Subscribers: Sidebar (to close marker panel)
     * Emitters: marker_tool_3d.js
     */
    MARKER_3D_DESELECTED: 'marker3d:deselected',

    /**
     * Emitted when 3D markers change (add/update/delete).
     * Payload: { mapName: string }
     * Subscribers: Sidebar markers section
     * Emitters: cesium3d.operations.js
     */
    MARKERS_3D_CHANGED: 'markers3d:changed',

    /**
     * Emitted when camera position is saved for a tileset.
     * Payload: { tilesetId: string, mapName: string }
     * Subscribers: 3D toolbar buttons
     * Emitters: cesium3d.operations.js
     */
    CAMERA_3D_SAVED: 'camera3d:saved',

    // ===== 3D MEASUREMENTS =====

    /**
     * Emitted when a 3D measurement is clicked.
     * Payload: { measurement: Cesium3DMeasurement, tilesetId: string }
     * Subscribers: Sidebar (to open measurement panel)
     * Emitters: measurement_tool_3d.js
     */
    MEASUREMENT_3D_CLICKED: 'measurement3d:clicked',

    /**
     * Emitted when a 3D measurement is deselected (clicking empty area).
     * Payload: { tilesetId: string }
     * Subscribers: Sidebar (to close measurement panel)
     * Emitters: measurement_tool_3d.js
     */
    MEASUREMENT_3D_DESELECTED: 'measurement3d:deselected',

    /**
     * Emitted when 3D measurements change (add/update/delete).
     * Payload: { mapName: string }
     * Subscribers: Sidebar measurements section
     * Emitters: cesium3d.operations.js
     */
    MEASUREMENTS_3D_CHANGED: 'measurements3d:changed',

    // ===== 3D VIEWSHEDS =====

    /**
     * Emitted when a 3D viewshed is clicked.
     * Payload: { viewshed: Cesium3DViewshed, tilesetId: string }
     * Subscribers: Sidebar (to open viewshed panel)
     * Emitters: viewshed_tool_3d.js
     */
    VIEWSHED_3D_CLICKED: 'viewshed3d:clicked',

    /**
     * Emitted when a 3D viewshed is deselected (clicking empty area).
     * Payload: { tilesetId: string }
     * Subscribers: Sidebar (to close viewshed panel)
     * Emitters: viewshed_tool_3d.js
     */
    VIEWSHED_3D_DESELECTED: 'viewshed3d:deselected',

    /**
     * Emitted when 3D viewsheds change (add/update/delete).
     * Payload: { mapName: string }
     * Subscribers: Sidebar viewsheds section
     * Emitters: cesium3d.operations.js
     */
    VIEWSHEDS_3D_CHANGED: 'viewsheds3d:changed',

    // ===== STREET VIEW 360 EVENTS =====

    /**
     * Emitted when 360 viewer opens.
     * Payload: { photoName: string }
     * Subscribers: Sidebar, UI components
     * Emitters: street_view_viewer.js
     */
    STREETVIEW_360_OPENED: 'streetview360:opened',

    /**
     * Emitted when 360 viewer closes.
     * Payload: {}
     * Subscribers: Sidebar, UI components
     * Emitters: street_view_viewer.js
     */
    STREETVIEW_360_CLOSED: 'streetview360:closed',

    /**
     * Emitted when photo changes in 360 viewer.
     * Payload: { previousPhoto: string, currentPhoto: string }
     * Subscribers: UI components
     * Emitters: street_view_viewer.js
     */
    STREETVIEW_360_PHOTO_CHANGED: 'streetview360:photoChanged',

    // ===== ORIENTATION 360 EVENTS =====

    /**
     * Emitted when orientation is saved for a photo.
     * Payload: { photoName: string, mapName: string }
     * Subscribers: 360 toolbar buttons, features tab
     * Emitters: streetview360_operations.js
     */
    ORIENTATION_360_SAVED: 'orientation360:saved',

    /**
     * Emitted when orientation is cleared for a photo.
     * Payload: { photoName: string, mapName: string }
     * Subscribers: 360 toolbar buttons, features tab
     * Emitters: streetview360_operations.js
     */
    ORIENTATION_360_CLEARED: 'orientation360:cleared',

    // ===== MARKER 360 EVENTS =====

    /**
     * Emitted when a 360 marker is clicked.
     * Payload: { marker: Marker360, photoName: string }
     * Subscribers: Sidebar (to open marker panel)
     * Emitters: navigator.js
     */
    MARKER_360_CLICKED: 'marker360:clicked',

    /**
     * Emitted when a 360 marker is deselected.
     * Payload: { photoName: string }
     * Subscribers: Sidebar (to close marker panel)
     * Emitters: navigator.js
     */
    MARKER_360_DESELECTED: 'marker360:deselected',

    /**
     * Emitted when 360 markers change (add/update/delete).
     * Payload: { mapName: string }
     * Subscribers: Sidebar markers section, map badges
     * Emitters: streetview360_operations.js
     */
    MARKERS_360_CHANGED: 'markers360:changed',

    /**
     * Emitted when user clicks to place a new 360 marker.
     * Payload: { position: { heading: number, pitch: number, distance: number }, photoName: string }
     * Subscribers: marker_tool_360.js
     * Emitters: navigator.js
     */
    MARKER_360_POSITION_CLICKED: 'marker360:positionClicked',

    // ===== MAP LIFECYCLE =====
    /**
     * Emitted when a map is created.
     * Payload: { mapId: string, map: Object }
     * Subscribers: Sync system, real-time UI updates
     * Emitters: map.operations.js
     */
    MAP_CREATED: 'map:created',

    /**
     * Emitted when a map is modified (name, notes, metadata).
     * Payload: { mapId: string, map: Object, previousMap: Object }
     * Subscribers: Sync system, real-time UI updates
     * Emitters: map.operations.js
     */
    MAP_MODIFIED: 'map:modified',

    /**
     * Emitted when a map is deleted.
     * Payload: { mapId: string }
     * Subscribers: Sync system, real-time UI updates
     * Emitters: map.operations.js
     */
    MAP_DELETED: 'map:deleted',

    // ===== MAP LOCK =====
    /**
     * Emitted when a map's lock (read-only) state changes.
     * Payload: { mapName: string, locked: boolean }
     * Subscribers: toolbar, sidebar, features_tab, catalog, import, attribute_table, search, context-menu, keyboard, bottom-controls, base-layer-selector
     * Emitters: map.operations.js (toggleMapLock), store-state-manager.js (setCurrentMap)
     */
    MAP_LOCK_CHANGED: 'map:lockChanged',

    // ===== STORE =====
    /**
     * Emitted when all data is cleared from storage.
     * Payload: {}
     * Subscribers: color-picker.helpers.js
     * Emitters: store.js (clearAllDataStore)
     */
    ALL_DATA_CLEARED: 'store:allDataCleared',

    // ===== STORE ERRORS =====
    /**
     * Emitted on IndexedDB persistence failure.
     * Payload: { operation: string, error: string, timestamp: number }
     * Subscribers: store-error-listener.js (toast)
     * Emitters: store-transaction.js (runTransaction catch)
     */
    STORE_PERSIST_ERROR: 'store:persistError',

    /**
     * Emitted on sync queue write failure.
     * Payload: { operation: string, entityId: string, error: string, consecutiveFailures: number }
     * Subscribers: store-error-listener.js (toast after 3 consecutive failures)
     * Emitters: operation-dispatcher.js (logOperation, logBatchOperations)
     */
    STORE_SYNC_ERROR: 'store:syncError',

    /**
     * Emitted when an operation is blocked by a locked map.
     * Payload: { operation: string, mapName: string }
     * Subscribers: store-error-listener.js (debounced toast)
     * Emitters: store operations (future: locked-map guards)
     */
    STORE_OPERATION_BLOCKED: 'store:operationBlocked',

    // ===== BRIEFING EVENTS =====

    /**
     * Emitted when a briefing is created.
     * Payload: { briefingId: string, briefing: Object }
     * Subscribers: BriefingsTab
     * Emitters: briefing.operations.js
     */
    BRIEFING_CREATED: 'briefing:created',

    /**
     * Emitted when a briefing is updated.
     * Payload: { briefingId: string, briefing: Object }
     * Subscribers: BriefingsTab
     * Emitters: briefing.operations.js
     */
    BRIEFING_UPDATED: 'briefing:updated',

    /**
     * Emitted when a briefing is deleted.
     * Payload: { briefingId: string }
     * Subscribers: BriefingsTab
     * Emitters: briefing.operations.js
     */
    BRIEFING_DELETED: 'briefing:deleted',

    /**
     * Emitted when briefing edit mode starts.
     * Payload: { briefingId: string }
     * Subscribers: UI components
     * Emitters: BriefingEditorControl
     */
    BRIEFING_EDIT_STARTED: 'briefing:editStarted',

    /**
     * Emitted when briefing edit mode ends.
     * Payload: { briefingId: string }
     * Subscribers: UI components
     * Emitters: BriefingEditorControl
     */
    BRIEFING_EDIT_ENDED: 'briefing:editEnded',

    /**
     * Emitted when briefing presentation starts.
     * Payload: { briefingId: string }
     * Subscribers: UI components
     * Emitters: BriefingPresenter
     */
    BRIEFING_PRESENT_STARTED: 'briefing:presentStarted',

    /**
     * Emitted when briefing presentation ends.
     * Payload: { briefingId: string }
     * Subscribers: UI components
     * Emitters: BriefingPresenter
     */
    BRIEFING_PRESENT_ENDED: 'briefing:presentEnded',

    /**
     * Emitted when slide changes during presentation.
     * Payload: { briefingId: string, slideIndex: number, slide: Object }
     * Subscribers: UI components, presentation controls
     * Emitters: BriefingPresenter
     */
    BRIEFING_SLIDE_CHANGED: 'briefing:slideChanged',
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

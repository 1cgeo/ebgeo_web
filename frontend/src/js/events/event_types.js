// Path: js/events/event_types.js

/**
 * @fileoverview Centralized event type definitions for EBGeo.
 * All event names follow the pattern: domain:action
 *
 * Design principle: Only define events that have both emitters AND subscribers.
 * Store error events live in store-errors.js (StoreErrorEvents).
 */

/**
 * Application-wide event type constants.
 * Use these instead of hardcoded strings to ensure consistency and enable refactoring.
 * @readonly
 * @enum {string}
 */
export const EventTypes = Object.freeze({
    // ===== LAYERS =====
    /** Layer list changes (create, delete, reorder, visibility, locked). */
    LAYERS_CHANGED: 'layers:changed',
    /** Payload: { layerId, mapId, layer } */
    LAYER_CREATED: 'layer:created',
    /** Payload: { layerId, mapId, layer, previousLayer } */
    LAYER_MODIFIED: 'layer:modified',
    /** Payload: { layerId, mapId } */
    LAYER_DELETED: 'layer:deleted',

    // ===== GROUPS =====
    /** Group list changes (create, delete, combine, feature assignment). */
    GROUPS_CHANGED: 'groups:changed',
    /** Payload: { groupId, mapId, group } */
    GROUP_CREATED: 'group:created',
    /** Payload: { groupId, mapId, group, previousGroup } */
    GROUP_MODIFIED: 'group:modified',
    /** Payload: { groupId, mapId } */
    GROUP_DELETED: 'group:deleted',

    // ===== FEATURES =====
    /** Feature user data changes (attributes or images). */
    FEATURE_UPDATED: 'feature:updated',
    /** Payload: { featureId, featureType, mapId, feature } */
    FEATURE_CREATED: 'feature:created',
    /** Payload: { featureId, featureType, mapId, feature, previousFeature } */
    FEATURE_MODIFIED: 'feature:modified',
    /** Payload: { featureId, featureType, mapId } */
    FEATURE_DELETED: 'feature:deleted',

    // ===== SIDEBAR =====
    /** Payload: { tab } */
    SIDEBAR_EXPANDED: 'sidebar:expanded',
    SIDEBAR_COLLAPSED: 'sidebar:collapsed',
    /** Payload: { previousTab, currentTab } */
    SIDEBAR_TAB_CHANGED: 'sidebar:tabChanged',

    // ===== FEATURE PANEL =====
    /** Payload: { featureId, featureType } */
    FEATURE_PANEL_OPENED: 'featurePanel:opened',
    FEATURE_PANEL_CLOSED: 'featurePanel:closed',

    // ===== VECTOR TILE INFO PANEL =====
    /** Payload: { feature, title } */
    VECTOR_INFO_PANEL_OPENED: 'vectorInfoPanel:opened',

    // ===== TOOLBAR =====
    /** Payload: { group: 'draw' | 'military' | 'analysis' } */
    TOOLBAR_GROUP_OPENED: 'toolbar:groupOpened',
    /** Payload: { group } */
    TOOLBAR_GROUP_CLOSED: 'toolbar:groupClosed',

    // ===== BASE LAYER =====
    /** Payload: { layer } */
    BASE_LAYER_CHANGED: 'baseLayer:changed',
    BASE_LAYER_SELECTOR_OPENED: 'baseLayerSelector:opened',
    BASE_LAYER_SELECTOR_CLOSED: 'baseLayerSelector:closed',

    // ===== UI LAYOUT =====
    /** Payload: { sidebarExpanded, featurePanelOpen, contentLeftOffset } */
    UI_LAYOUT_CHANGED: 'ui:layoutChanged',
    /** Closes all popups and panels. */
    UI_CLOSE_ALL_POPUPS: 'ui:closeAllPopups',

    // ===== MAP NOTES =====
    /** Payload: { mapName } */
    MAP_NOTES_REQUESTED: 'mapNotes:requested',

    // ===== SEARCH =====
    /** Payload: { result, content: HTMLElement } */
    SEARCH_RESULT_PANEL_REQUESTED: 'search:resultPanelRequested',

    // ===== CATALOG =====
    /** Payload: { type, item: CatalogItem } */
    CATALOG_ADD_LAYER: 'catalog:addLayer',

    // ===== 3D VIEWER =====
    /** Payload: { tilesetId } */
    VIEWER_3D_OPENED: 'viewer3d:opened',
    VIEWER_3D_CLOSED: 'viewer3d:closed',
    /** Payload: { marker: Cesium3DMarker, tilesetId } */
    MARKER_3D_CLICKED: 'marker3d:clicked',
    /** Payload: { tilesetId } */
    MARKER_3D_DESELECTED: 'marker3d:deselected',
    /** Payload: { mapName } */
    MARKERS_3D_CHANGED: 'markers3d:changed',
    /** Payload: { tilesetId, mapName } */
    CAMERA_3D_SAVED: 'camera3d:saved',

    // ===== 3D MEASUREMENTS =====
    /** Payload: { measurement: Cesium3DMeasurement, tilesetId } */
    MEASUREMENT_3D_CLICKED: 'measurement3d:clicked',
    /** Payload: { tilesetId } */
    MEASUREMENT_3D_DESELECTED: 'measurement3d:deselected',
    /** Payload: { mapName } */
    MEASUREMENTS_3D_CHANGED: 'measurements3d:changed',

    // ===== 3D VIEWSHEDS =====
    /** Payload: { viewshed: Cesium3DViewshed, tilesetId } */
    VIEWSHED_3D_CLICKED: 'viewshed3d:clicked',
    /** Payload: { tilesetId } */
    VIEWSHED_3D_DESELECTED: 'viewshed3d:deselected',
    /** Payload: { mapName } */
    VIEWSHEDS_3D_CHANGED: 'viewsheds3d:changed',

    // ===== STREET VIEW 360 =====
    /** Payload: { photoName } */
    STREETVIEW_360_OPENED: 'streetview360:opened',
    STREETVIEW_360_CLOSED: 'streetview360:closed',
    /** Payload: { previousPhoto, currentPhoto } */
    STREETVIEW_360_PHOTO_CHANGED: 'streetview360:photoChanged',
    /**
     * O andar em exibicao mudou, por clique no seletor ou por o usuario ter
     * atravessado uma escada. Payload: { level, plan, hasFloors }
     * `level` e null e `hasFloors` false em projeto sem andares, o que manda os
     * mapas voltarem a mostrar tudo.
     */
    STREETVIEW_360_FLOOR_CHANGED: 'streetview360:floorChanged',

    // ===== ORIENTATION 360 =====
    /** Payload: { photoName, mapName } */
    ORIENTATION_360_SAVED: 'orientation360:saved',
    /** Payload: { photoName, mapName } */
    ORIENTATION_360_CLEARED: 'orientation360:cleared',

    // ===== MARKER 360 =====
    /** Payload: { marker: Marker360, photoName } */
    MARKER_360_CLICKED: 'marker360:clicked',
    /** Payload: { photoName } */
    MARKER_360_DESELECTED: 'marker360:deselected',
    /** Payload: { mapName } */
    MARKERS_360_CHANGED: 'markers360:changed',
    /** Payload: { position: { heading, pitch, distance }, photoName } */
    MARKER_360_POSITION_CLICKED: 'marker360:positionClicked',

    // ===== FIRST PERSON 3D (GAUSSIAN SPLATTING) =====
    /** Payload: { sceneId } */
    FIRST_PERSON_OPENED: 'firstPerson:opened',
    FIRST_PERSON_CLOSED: 'firstPerson:closed',
    /** Payload: { marker: FpMarker, sceneId, sceneName, photoUrl } */
    MARKER_FP_CLICKED: 'markerFp:clicked',
    /** Payload: { sceneId } */
    MARKER_FP_DESELECTED: 'markerFp:deselected',

    // ===== MAP LIFECYCLE =====
    /** Payload: { mapId, map } */
    MAP_CREATED: 'map:created',
    /** Payload: { mapId, map, previousMap } */
    MAP_MODIFIED: 'map:modified',
    /** Payload: { mapId } */
    MAP_DELETED: 'map:deleted',

    // ===== MAP LOCK =====
    /** Payload: { mapName, locked } */
    MAP_LOCK_CHANGED: 'map:lockChanged',

    // ===== TEMPORAL =====
    /** Per-map temporal control toggled. Payload: { mapName, enabled } */
    MAP_TEMPORAL_CHANGED: 'temporal:mapChanged',
    /** Per-map temporal config (unit/inicio/fim) changed. Payload: { mapName, config } */
    TEMPORAL_CONFIG_CHANGED: 'temporal:configChanged',
    /** Timeline cursor moved. Payload: { cursor } (epoch ms) */
    TEMPORAL_CURSOR_CHANGED: 'temporal:cursorChanged',

    // ===== STORE =====
    /** All data cleared from storage. */
    ALL_DATA_CLEARED: 'store:allDataCleared',

    // ===== BRIEFING =====
    /** Payload: { briefingId, briefing } */
    BRIEFING_CREATED: 'briefing:created',
    /** Payload: { briefingId, briefing } */
    BRIEFING_UPDATED: 'briefing:updated',
    /** Payload: { briefingId } */
    BRIEFING_DELETED: 'briefing:deleted',
    /** Payload: { briefingId } */
    BRIEFING_EDIT_STARTED: 'briefing:editStarted',
    /** Payload: { briefingId } */
    BRIEFING_EDIT_ENDED: 'briefing:editEnded',
    /** Payload: { briefingId } */
    BRIEFING_PRESENT_STARTED: 'briefing:presentStarted',
    /** Payload: { briefingId } */
    BRIEFING_PRESENT_ENDED: 'briefing:presentEnded',
    /** Payload: { briefingId, slideIndex, slide } */
    BRIEFING_SLIDE_CHANGED: 'briefing:slideChanged',

    // ===== PROCESSING =====
    /** Payload: { algorithmId, sourceLayerId } */
    PROCESSING_STARTED: 'processing:started',
    /** Payload: { algorithmId, layerId, featureCount } */
    PROCESSING_COMPLETED: 'processing:completed',
    /** Payload: { algorithmId, error } */
    PROCESSING_ERROR: 'processing:error',

    // ===== SESSION & CONNECTION =====
    /** Payload: { mode, userId, role } */
    SESSION_CHANGED: 'session:changed',
    /** Payload: { previousState, currentState } */
    CONNECTION_STATE_CHANGED: 'connection:stateChanged',

    // ===== SYNC =====
    /** Payload: { operation } */
    REMOTE_OPERATION_APPLIED: 'sync:remoteOperationApplied',
    /** Payload: { atlasId } — the connected atlas was deleted server-side; tear down + redirect. */
    ATLAS_DELETED_REMOTE: 'sync:atlasDeletedRemote',
    /** Payload: { atlasId, newOwnerId } — atlas ownership changed; re-gate UI / role. */
    ATLAS_OWNER_CHANGED: 'sync:atlasOwnerChanged',
    /** Payload: { settings } — the connected atlas's settings changed (Gestor edited 3D/360/basemap). */
    ATLAS_SETTINGS_CHANGED: 'sync:atlasSettingsChanged',

    // ===== SPATIAL COMMENTS =====
    /** Payload: { comment } — a spatial comment (root or reply) was created. */
    COMMENT_CREATED: 'comment:created',
    /** Payload: { comment } — a spatial comment was edited / resolved / reopened. */
    COMMENT_UPDATED: 'comment:updated',
    /** Payload: { commentId } — a spatial comment was deleted. */
    COMMENT_DELETED: 'comment:deleted',

    // ===== PRESENCE / AWARENESS =====
    /** Online users set changed (join/left/away/back/initial). Payload: { users } */
    PRESENCE_CHANGED: 'presence:changed',
    /** A user's cursor moved (live cursors). Payload: { mapId } */
    PRESENCE_CURSORS_CHANGED: 'presence:cursorsChanged',
    /** A peer's feature/marker selection changed (2D/3D/360). Payload: { surface } */
    PRESENCE_SELECTIONS_CHANGED: 'presence:selectionsChanged',
});

/**
 * Property types for FEATURE_UPDATED event.
 * @readonly
 * @enum {string}
 */
export const FeatureUpdateProperty = Object.freeze({
    ATTRIBUTES: 'attributes',
    IMAGES: 'images',
});

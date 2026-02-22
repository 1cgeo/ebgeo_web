// Path: js/store/sync/operation-types.js

/**
 * @fileoverview Entity and operation type constants for sync operations.
 * Defines the types used by the operation logging infrastructure.
 */

/**
 * Entity types for sync operations.
 * Each entity type corresponds to a persistable data structure.
 * @enum {string}
 */
export const EntityType = Object.freeze({
    // Core entities
    ATLAS: 'atlas',
    MAP: 'map',
    FEATURE: 'feature',
    LAYER: 'layer',
    GROUP: 'group',

    // Cesium 3D entities
    MARKER_3D: 'marker3d',
    MEASUREMENT_3D: 'measurement3d',
    VIEWSHED_3D: 'viewshed3d',
    CAMERA_POSITION_3D: 'cameraPosition3d',

    // StreetView 360 entities
    ORIENTATION_360: 'orientation360',
    MARKER_360: 'marker360',

    // Map position
    MAP_POSITION: 'mapPosition',

    // Map settings
    BASE_LAYER: 'baseLayer',
    MAP_NOTES: 'mapNotes',
    GRID_STYLE: 'gridStyle',
    CATALOG_LAYER: 'catalogLayer',

    // Briefing entities
    BRIEFING: 'briefing',
    SLIDE: 'slide',

    // Settings
    SETTING: 'setting'
});

/**
 * Operation types for sync operations.
 * @enum {string}
 */
export const OperationType = Object.freeze({
    CREATE: 'create',
    UPDATE: 'update',
    DELETE: 'delete'
});

/**
 * Validates an entity type.
 * @param {string} entityType - Entity type to validate
 * @returns {boolean} True if valid
 */
export function isValidEntityType(entityType) {
    return Object.values(EntityType).includes(entityType);
}

/**
 * Validates an operation type.
 * @param {string} opType - Operation type to validate
 * @returns {boolean} True if valid
 */
export function isValidOperationType(opType) {
    return Object.values(OperationType).includes(opType);
}

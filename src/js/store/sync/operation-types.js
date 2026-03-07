// Path: js/store/sync/operation-types.js

/**
 * @fileoverview Entity and operation type constants for sync operations.
 */

/** @enum {string} */
export const EntityType = Object.freeze({
    ATLAS: 'atlas',
    MAP: 'map',
    FEATURE: 'feature',
    LAYER: 'layer',
    GROUP: 'group',

    MARKER_3D: 'marker3d',
    MEASUREMENT_3D: 'measurement3d',
    VIEWSHED_3D: 'viewshed3d',
    CAMERA_POSITION_3D: 'cameraPosition3d',

    ORIENTATION_360: 'orientation360',
    MARKER_360: 'marker360',

    MAP_POSITION: 'mapPosition',

    BASE_LAYER: 'baseLayer',
    MAP_NOTES: 'mapNotes',
    GRID_STYLE: 'gridStyle',
    CATALOG_LAYER: 'catalogLayer',

    BRIEFING: 'briefing',
    SLIDE: 'slide',

    SETTING: 'setting'
});

/** @enum {string} */
export const OperationType = Object.freeze({
    CREATE: 'create',
    UPDATE: 'update',
    DELETE: 'delete'
});

const ENTITY_TYPE_VALUES = new Set(Object.values(EntityType));
const OPERATION_TYPE_VALUES = new Set(Object.values(OperationType));

/**
 * @param {string} entityType - Entity type to validate
 * @returns {boolean} True if valid
 */
export function isValidEntityType(entityType) {
    return ENTITY_TYPE_VALUES.has(entityType);
}

/**
 * @param {string} opType - Operation type to validate
 * @returns {boolean} True if valid
 */
export function isValidOperationType(opType) {
    return OPERATION_TYPE_VALUES.has(opType);
}

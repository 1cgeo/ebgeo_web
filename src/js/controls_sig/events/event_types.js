// Path: js/controls_sig/events/event_types.js

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
    VISUAL: 'visual',
    GEOMETRY: 'geometry',
});

/**
 * Event payload type definitions for documentation.
 * @readonly
 */
export const EventPayloads = Object.freeze({
    /**
     * LAYERS_CHANGED payload.
     * @typedef {Object} LayersChangedPayload
     * @property {string|null} mapName - Map name where change occurred, null for current map
     */
    [EventTypes.LAYERS_CHANGED]: {
        mapName: '',
    },

    /**
     * GROUPS_CHANGED payload.
     * @typedef {Object} GroupsChangedPayload
     * @property {string|null} mapName - Map name where change occurred, null for current map
     */
    [EventTypes.GROUPS_CHANGED]: {
        mapName: '',
    },

    /**
     * FEATURE_UPDATED payload.
     * @typedef {Object} FeatureUpdatedPayload
     * @property {string} featureType - Feature type in singular form ('polygon', 'point', etc.)
     * @property {string} featureId - Unique feature identifier
     * @property {string} property - FeatureUpdateProperty value indicating what changed
     * @property {string} [key] - Attribute key (for attributes updates)
     * @property {*} [value] - New value (for attributes updates)
     * @property {string} [action] - Action type for images: 'added' | 'removed' | 'updated'
     * @property {string} [imageId] - Image identifier (for images updates)
     */
    [EventTypes.FEATURE_UPDATED]: {
        featureType: '',
        featureId: '',
        property: '',
        key: '',
        value: null,
        action: '',
        imageId: '',
    },
});

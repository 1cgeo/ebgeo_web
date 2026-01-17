// Path: js/controls_sig/events/event_types.js

/**
 * @fileoverview Centralized event type definitions for EBGeo.
 * All event names follow the pattern: domain:action
 *
 * This module provides type-safe event constants to replace hardcoded strings
 * throughout the application.
 */

/**
 * Application-wide event type constants.
 * Use these instead of hardcoded strings to ensure consistency and enable refactoring.
 * @readonly
 * @enum {string}
 */
export const EventTypes = {
    // ===== LAYERS =====
    /** Emitted when layer list changes (create, delete, reorder) */
    LAYERS_CHANGED: 'layers:changed',
    /** Emitted when layer property changes (visibility, locked, name) */
    LAYER_UPDATED: 'layer:updated',
    /** Emitted when active layer changes */
    LAYER_ACTIVATED: 'layer:activated',

    // ===== GROUPS =====
    /** Emitted when group list changes (create, delete, combine) */
    GROUPS_CHANGED: 'groups:changed',
    /** Emitted when group property changes */
    GROUP_UPDATED: 'group:updated',

    // ===== FEATURES =====
    /** Emitted when feature is created */
    FEATURE_CREATED: 'feature:created',
    /** Emitted when feature is deleted */
    FEATURE_DELETED: 'feature:deleted',
    /** Emitted when feature is updated (properties, attributes, images, geometry) */
    FEATURE_UPDATED: 'feature:updated',
    /** Emitted in batch after multiple operations */
    FEATURES_CHANGED: 'features:changed',

    // ===== BASE LAYER =====
    /** Emitted when base layer changes */
    BASELAYER_CHANGED: 'baselayer:changed',

    // ===== MAP =====
    /** Emitted when map is loaded */
    MAP_LOADED: 'map:loaded',
    /** Emitted when map is switched */
    MAP_SWITCHED: 'map:switched',
    /** Emitted when map is saved */
    MAP_SAVED: 'map:saved',

    // ===== IMPORT/EXPORT =====
    /** Emitted when import starts */
    IMPORT_STARTED: 'import:started',
    /** Emitted when import completes */
    IMPORT_COMPLETED: 'import:completed',
    /** Emitted when import fails */
    IMPORT_FAILED: 'import:failed',
    /** Emitted when export completes */
    EXPORT_COMPLETED: 'export:completed',

    // ===== ANALYSIS =====
    /** Emitted when analysis layer changes */
    ANALYSIS_LAYER_CHANGED: 'analysis:layerchanged',
};

/**
 * Valid values for FEATURE_UPDATED property field.
 * Indicates what aspect of the feature was modified.
 * @readonly
 * @enum {string}
 */
export const FeatureUpdateProperty = {
    /** Visual properties (color, opacity, size, etc) */
    VISUAL: 'visual',
    /** User-defined attributes (key-value pairs) */
    ATTRIBUTES: 'attributes',
    /** Image gallery */
    IMAGES: 'images',
    /** Geometry coordinates */
    GEOMETRY: 'geometry',
    /** Feature name */
    NAME: 'name',
    /** Layer assignment */
    LAYER: 'layer',
    /** Group assignment */
    GROUP: 'group',
    /** Lock state */
    LOCKED: 'locked',
    /** Visibility state */
    VISIBLE: 'visible',
};

/**
 * Event payload schemas for documentation and reference.
 * These define the expected structure of payloads for each event type.
 * @readonly
 */
export const EventPayloads = {
    [EventTypes.LAYERS_CHANGED]: {
        /** @type {string|null} Map name */
        mapName: '',
    },

    [EventTypes.LAYER_UPDATED]: {
        /** @type {string} Layer ID */
        layerId: '',
        /** @type {string} Property that changed */
        property: '',
        /** @type {*} New value */
        value: null,
    },

    [EventTypes.FEATURE_CREATED]: {
        /** @type {string} Feature type (singular: 'point', 'polygon', etc) */
        featureType: '',
        /** @type {string} Feature ID */
        featureId: '',
        /** @type {string} Layer ID */
        layerId: '',
    },

    [EventTypes.FEATURE_DELETED]: {
        /** @type {string} Feature type (singular) */
        featureType: '',
        /** @type {string} Feature ID */
        featureId: '',
    },

    /**
     * FEATURE_UPDATED payload structure.
     * The property field uses FeatureUpdateProperty enum values.
     */
    [EventTypes.FEATURE_UPDATED]: {
        /** @type {string} Feature type (singular: 'point', 'polygon', etc) */
        featureType: '',
        /** @type {string} Feature ID */
        featureId: '',
        /** @type {FeatureUpdateProperty} What changed */
        property: '',
        /** @type {*} New value (optional, depends on property type) */
        value: null,
        /** @type {string|undefined} Specific key for attributes (optional) */
        key: undefined,
        /** @type {string|undefined} Action for images: 'added' | 'removed' | 'updated' */
        action: undefined,
        /** @type {string|undefined} Image ID when property is 'images' */
        imageId: undefined,
    },

    [EventTypes.FEATURES_CHANGED]: {
        /** @type {string} Operation type: 'create' | 'delete' | 'update' | 'batch' */
        operation: '',
        /** @type {number} Count of affected features */
        count: 0,
        /** @type {string|undefined} Map name */
        mapName: undefined,
        /** @type {string|undefined} Layer ID */
        layerId: undefined,
    },

    [EventTypes.GROUPS_CHANGED]: {
        /** @type {string|null} Map name */
        mapName: '',
    },

    [EventTypes.BASELAYER_CHANGED]: {
        /** @type {string} Previous layer ID */
        previousLayer: '',
        /** @type {string} New layer ID */
        newLayer: '',
    },

    [EventTypes.MAP_SWITCHED]: {
        /** @type {string} Previous map name */
        previousMap: '',
        /** @type {string} New map name */
        newMap: '',
    },
};

// Freeze objects to prevent accidental modification
Object.freeze(EventTypes);
Object.freeze(FeatureUpdateProperty);
Object.freeze(EventPayloads);

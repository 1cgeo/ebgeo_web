// Path: js/store/memory-store.js

/**
 * @fileoverview In-memory store for runtime state.
 *
 * This module contains the in-memory state that persists during a session
 * but is not saved to IndexedDB. It includes:
 * - Undo/redo stacks per map
 * - Current map tracking
 * - Layer caches
 * - 3D/360 caches
 *
 * NOTE: This is separate from IndexedDB persistence. Data here is lost
 * on page refresh.
 */

// ===== MEMORY STORE =====

/**
 * In-memory store for runtime state.
 * @type {Object}
 */
export const memoryStore = {
    /**
     * Maps state (undo/redo stacks per map).
     * @type {Object.<string, {undoStack: Array, redoStack: Array}>}
     */
    maps: {
        'Principal': {
            undoStack: [],
            redoStack: []
        }
    },

    /**
     * Current active map name.
     * @type {string}
     */
    currentMap: 'Principal',

    /**
     * Flag indicating if an undo operation is in progress.
     * @type {boolean}
     */
    isUndoing: false,

    /**
     * Flag indicating if a redo operation is in progress.
     * @type {boolean}
     */
    isRedoing: false,

    /**
     * Groups cache per map.
     * @type {Object.<string, Object>}
     */
    groups: {},

    /**
     * Layer system cache per map.
     * @type {Object.<string, Array>}
     */
    layers: {},

    /**
     * Active layer ID.
     * @type {string}
     */
    activeLayerId: 'default',

    /**
     * Color usage cache for current map.
     * @type {Map<string, number>}
     */
    colorUsageCache: new Map(),

    /**
     * Cesium 3D cache.
     * @type {Object}
     */
    cesium3d: {
        cameraPositions: {},  // { tilesetId: TilesetCameraPosition }
        markers: [],          // Cesium3DMarker[]
        measurements: [],     // Cesium3DMeasurement[]
        viewsheds: []         // Cesium3DViewshed[]
    },

    /**
     * Street View 360 cache.
     * @type {Object}
     */
    streetview360: {
        orientations: {},     // { photoName: PhotoOrientation }
        markers: [],          // Marker360[]
        _mapName: null        // Current map name for cache validation
    },

    /**
     * Set of locked (read-only) map names.
     * Loaded from IndexedDB on map switch for synchronous access.
     * @type {Set<string>}
     */
    lockedMaps: new Set()
};

// ===== MEMORY STORE OPERATIONS =====

/**
 * Resets memory store to initial state.
 * Called when clearing all data or reinitializing.
 */
export function resetMemoryStore() {
    memoryStore.maps = {
        'Principal': {
            undoStack: [],
            redoStack: []
        }
    };
    memoryStore.currentMap = 'Principal';
    memoryStore.isUndoing = false;
    memoryStore.isRedoing = false;
    memoryStore.groups = {};
    memoryStore.layers = {};
    memoryStore.activeLayerId = 'default';
    memoryStore.colorUsageCache = new Map();
    memoryStore.cesium3d = {
        cameraPositions: {},
        markers: [],
        measurements: [],
        viewsheds: []
    };
    memoryStore.streetview360 = {
        orientations: {},
        markers: [],
        _mapName: null
    };
    memoryStore.lockedMaps = new Set();
}

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

import { DEFAULT_MAP_NAME } from './store.constants.js';

// ===== MEMORY STORE =====

/**
 * In-memory store for runtime state.
 * @type {Object}
 */
export const memoryStore = {
    /**
     * Maps state (undo/redo stacks per map, per user).
     * Each map has undoStacks and redoStacks keyed by userId.
     * In offline mode, the single userId is the clientId.
     * @type {Object.<string, {undoStacks: Object.<string, Array>, redoStacks: Object.<string, Array>}>}
     */
    maps: {
        [DEFAULT_MAP_NAME]: {
            undoStacks: {},
            redoStacks: {}
        }
    },

    /**
     * Current active map name.
     * @type {string}
     */
    currentMap: DEFAULT_MAP_NAME,

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
     * Batch collector for grouping multiple undo entries into one.
     * null = not collecting, [] = collecting actions for batch.
     * @type {Array|null}
     */
    batchCollector: null,

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
        [DEFAULT_MAP_NAME]: {
            undoStacks: {},
            redoStacks: {}
        }
    };
    memoryStore.currentMap = DEFAULT_MAP_NAME;
    memoryStore.isUndoing = false;
    memoryStore.isRedoing = false;
    memoryStore.batchCollector = null;
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

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
import { getEmptyCesium3dData, getEmptyStreetview360Data } from './repository.utils.js';

/**
 * Creates a fresh initial state object for the memory store.
 *
 * Used both for the initial memoryStore declaration and for resetMemoryStore(),
 * ensuring the initial shape is defined in exactly one place.
 *
 * @returns {Object} Initial memory store state (plain-object fields only)
 */
function createInitialState() {
    return {
        maps: {
            [DEFAULT_MAP_NAME]: {
                undoStacks: {},
                redoStacks: {}
            }
        },
        currentMap: DEFAULT_MAP_NAME,
        isUndoing: false,
        isRedoing: false,
        batchCollector: null,
        groups: {},
        layers: {},
        activeLayerId: 'default',
        colorUsageCache: new Map(),
        cesium3d: getEmptyCesium3dData(),
        streetview360: { ...getEmptyStreetview360Data(), _mapName: null },
        lockedMaps: new Set(),
        temporalConfigs: new Map()
    };
}

/**
 * In-memory store for runtime state.
 *
 * @property {Object.<string, {undoStacks: Object.<string, Array>, redoStacks: Object.<string, Array>}>} maps
 *   Undo/redo stacks per map, per user. In offline mode the single userId is the clientId.
 * @property {string} currentMap - Current active map name.
 * @property {boolean} isUndoing - Whether an undo operation is in progress.
 * @property {boolean} isRedoing - Whether a redo operation is in progress.
 * @property {Array|null} batchCollector - null = not collecting, [] = collecting actions for batch.
 * @property {Object.<string, Object>} groups - Groups cache per map.
 * @property {Object.<string, Array>} layers - Layer system cache per map.
 * @property {string} activeLayerId - Active layer ID.
 * @property {Map<string, number>} colorUsageCache - Color usage cache for current map.
 * @property {Object} cesium3d - Cesium 3D cache (camera positions, markers, measurements, viewsheds).
 * @property {Object} streetview360 - Street View 360 cache (orientations, markers, _mapName for validation).
 * @property {Set<string>} lockedMaps - Locked (read-only) map names, loaded from IndexedDB for synchronous access.
 * @property {Map<string, {ativo: boolean, unidade: string, inicio: (number|null), fim: (number|null)}>} temporalConfigs
 *   Per-map temporal configuration cache, loaded from IndexedDB for synchronous access.
 */
export const memoryStore = createInitialState();

/**
 * Resets memory store to initial state.
 * Called when clearing all data or reinitializing.
 */
export function resetMemoryStore() {
    Object.assign(memoryStore, createInitialState());
}

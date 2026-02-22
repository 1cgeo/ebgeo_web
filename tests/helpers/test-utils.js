/**
 * @fileoverview Shared test utilities for EBGeo test suite.
 * Provides mock factories, feature builders, and async helpers.
 */

import { vi } from 'vitest';

// ============================================================================
// MOCK LOCALFORAGE FACTORY
// ============================================================================

/**
 * Creates a mock localforage instance backed by a Map.
 * Mirrors the localforage API used by EBGeo stores.
 * @returns {{ store: Map, instance: Object }}
 */
export function createMockLocalforage() {
    const store = new Map();
    const instance = {
        setItem: vi.fn(async (key, value) => { store.set(key, value); }),
        getItem: vi.fn(async (key) => store.get(key) ?? null),
        removeItem: vi.fn(async (key) => { store.delete(key); }),
        keys: vi.fn(async () => [...store.keys()]),
        clear: vi.fn(async () => { store.clear(); }),
        createInstance: vi.fn(() => {
            const instanceStore = new Map();
            return {
                setItem: vi.fn(async (key, value) => { instanceStore.set(key, value); }),
                getItem: vi.fn(async (key) => instanceStore.get(key) ?? null),
                removeItem: vi.fn(async (key) => { instanceStore.delete(key); }),
                keys: vi.fn(async () => [...instanceStore.keys()]),
                clear: vi.fn(async () => { instanceStore.clear(); }),
            };
        })
    };
    return { store, instance };
}

// ============================================================================
// MOCK LOCALSTORAGE FACTORY
// ============================================================================

/**
 * Creates a mock localStorage backed by a plain object.
 * @returns {Object} localStorage-compatible mock
 */
export function createMockLocalStorage() {
    let store = {};
    return {
        getItem: (key) => store[key] ?? null,
        setItem: (key, value) => { store[key] = String(value); },
        removeItem: (key) => { delete store[key]; },
        clear: () => { store = {}; }
    };
}

/**
 * Installs mock localStorage on globalThis if not present.
 * @returns {Object} The mock localStorage
 */
export function ensureMockLocalStorage() {
    const mock = createMockLocalStorage();
    if (typeof globalThis.localStorage === 'undefined') {
        Object.defineProperty(globalThis, 'localStorage', { value: mock, writable: true });
    }
    return globalThis.localStorage;
}

// ============================================================================
// FEATURE FACTORY
// ============================================================================

/**
 * Creates a mock GeoJSON feature for testing.
 * @param {string} id - Feature ID
 * @param {string} [source='point'] - Feature source type
 * @param {Object} [extra={}] - Extra properties to merge
 * @returns {Object} GeoJSON feature
 */
export function makeFeature(id, source = 'point', extra = {}) {
    return {
        type: 'Feature',
        geometry: {
            type: 'Point',
            coordinates: [-43.1729, -22.9068] // Rio de Janeiro
        },
        properties: {
            id,
            source,
            nome: `Feature ${id}`,
            color: '#ff0000',
            visivel: true,
            bloqueado: false,
            layerId: 'default',
            ...extra
        }
    };
}

/**
 * Creates a mock GeoJSON line feature.
 * @param {string} id - Feature ID
 * @param {Object} [extra={}] - Extra properties
 * @returns {Object} GeoJSON line feature
 */
export function makeLineFeature(id, extra = {}) {
    return {
        type: 'Feature',
        geometry: {
            type: 'LineString',
            coordinates: [[-43.17, -22.90], [-43.18, -22.91]]
        },
        properties: {
            id,
            source: 'line',
            nome: `Line ${id}`,
            color: '#0000ff',
            visivel: true,
            bloqueado: false,
            layerId: 'default',
            ...extra
        }
    };
}

/**
 * Creates a mock GeoJSON polygon feature.
 * @param {string} id - Feature ID
 * @param {Object} [extra={}] - Extra properties
 * @returns {Object} GeoJSON polygon feature
 */
export function makePolygonFeature(id, extra = {}) {
    return {
        type: 'Feature',
        geometry: {
            type: 'Polygon',
            coordinates: [[[-43.17, -22.90], [-43.18, -22.91], [-43.16, -22.91], [-43.17, -22.90]]]
        },
        properties: {
            id,
            source: 'polygon',
            nome: `Polygon ${id}`,
            fillColor: '#00ff00',
            color: '#00ff00',
            visivel: true,
            bloqueado: false,
            layerId: 'default',
            ...extra
        }
    };
}

// ============================================================================
// OPERATION FACTORY
// ============================================================================

/**
 * Creates a mock sync operation for testing.
 * @param {string} id - Operation ID
 * @param {string} [entityType='feature'] - Entity type
 * @param {string} [operationType='create'] - Operation type
 * @param {Object|null} [data=null] - Operation data
 * @param {Object} [extra={}] - Extra fields
 * @returns {Object} Mock operation
 */
export function makeOperation(id, entityType = 'feature', operationType = 'create', data = null, extra = {}) {
    return {
        id,
        entityType,
        operationType,
        entityId: extra.entityId || `entity-${id}`,
        mapId: extra.mapId || 'map-1',
        data,
        previousData: extra.previousData || null,
        timestamp: extra.timestamp || Date.now(),
        lamportTimestamp: extra.lamportTimestamp || 0,
        clientId: extra.clientId || 'test-client',
        ...extra
    };
}

// ============================================================================
// ASYNC HELPERS
// ============================================================================

/**
 * Flushes the microtask queue.
 * Useful for waiting on fire-and-forget async side effects.
 * @returns {Promise<void>}
 */
export function flushPromises() {
    return new Promise(resolve => setTimeout(resolve, 0));
}

/**
 * Waits for a specified number of milliseconds.
 * @param {number} ms - Milliseconds to wait
 * @returns {Promise<void>}
 */
export function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Path: tests/store/streetview360-operations.test.js
//
// Store operations for Street View 360 (sv360). sv360 BLOBs live OUTSIDE the
// CRDT/sync of the atlas, but these store operations DO emit sync ops for
// camera orientations and annotation markers. The orientation/marker entity
// shape is a FROZEN frontend contract (flat camera fields, marker structure),
// so this suite asserts the EXACT op entity shape — shape bugs were found here
// before.
//
// Strategy: mock only the boundaries (repository persistence, sync logging,
// state manager, events, image processing, uuid). The real sync-metadata and
// deep-utils helpers run so we exercise genuine isActive()/soft-delete behavior.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// localStorage stub (node env has none; addMarker360 reads default style)
// ============================================================================

const localStorageMock = (() => {
    let store = {};
    return {
        getItem: (key) => (key in store ? store[key] : null),
        setItem: (key, value) => { store[key] = String(value); },
        removeItem: (key) => { delete store[key]; },
        _reset: () => { store = {}; }
    };
})();
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, configurable: true });

// ============================================================================
// Hoisted shared state (available to vi.mock factories)
// ============================================================================

const h = vi.hoisted(() => ({
    // In-memory backing store for the sv360 repository, keyed by map name.
    store: new Map(),
    currentMapName: 'TestMap',
    currentMapId: 'map-uuid-123',
    uuidCounter: 0
}));

// ============================================================================
// Mock dependencies
// ============================================================================

vi.mock('../../src/js/store/repositories/index.js', () => ({
    getStreetview360Compat: vi.fn(async (mapName) => {
        // Mirror the repository contract: always return a fresh object with the
        // canonical empty shape when nothing is stored yet.
        const existing = h.store.get(mapName);
        if (!existing) {
            return { orientations: {}, markers: [] };
        }
        return existing;
    }),
    setStreetview360Compat: vi.fn(async (mapName, data) => {
        h.store.set(mapName, data);
    })
}));

vi.mock('../../src/js/store/store-state-manager.js', () => ({
    default: {
        getCurrentMapName: vi.fn(() => h.currentMapName),
        getCurrentMapId: vi.fn(() => h.currentMapId)
    }
}));

vi.mock('../../src/js/events', () => ({
    EventTypes: {
        ORIENTATION_360_SAVED: 'orientation360:saved',
        ORIENTATION_360_CLEARED: 'orientation360:cleared',
        MARKERS_360_CHANGED: 'markers360:changed'
    }
}));

vi.mock('../../src/js/utilities/image_utils.js', () => ({
    validateImageFile: vi.fn(() => ({ valid: true })),
    processImageFile: vi.fn(async () => ({ data: 'base64-data', thumbnail: 'base64-thumb' }))
}));

vi.mock('../../src/js/utilities/uuid.js', () => ({
    generateUUID: vi.fn(() => `uuid-${++h.uuidCounter}`)
}));

vi.mock('../../src/js/store/sync/index.js', () => ({
    logOrientation360Operation: vi.fn().mockResolvedValue(undefined),
    logMarker360Operation: vi.fn().mockResolvedValue(undefined),
    OperationType: { CREATE: 'create', UPDATE: 'update', DELETE: 'delete' }
}));

// ============================================================================
// Imports (after mocks)
// ============================================================================

import {
    saveOrientation,
    getOrientation,
    hasOrientation,
    clearOrientation,
    getAllOrientations,
    addMarker360,
    getMarkers360,
    getAllMarkers360,
    getMarker360ById,
    updateMarker360,
    removeMarker360,
    removeMarkers360ByPhoto,
    addMarker360Image,
    getMarker360Images,
    removeMarker360Image,
    getStreetview360DataForExport,
    setStreetview360DataForImport,
    loadStreetview360DataToMemory,
    clearStreetview360Cache,
    setStreetview360Dependencies,
    DEFAULT_MARKER_360_STYLE
} from '../../src/js/store/streetview360.operations.js';

import { setStreetview360Compat } from '../../src/js/store/repositories/index.js';
import { validateImageFile } from '../../src/js/utilities/image_utils.js';
import { logOrientation360Operation, logMarker360Operation, OperationType } from '../../src/js/store/sync/index.js';
import { memoryStore } from '../../src/js/store/memory-store.js';

// ============================================================================
// Helpers
// ============================================================================

const eventBus = { emit: vi.fn() };

/** Seed the backing store for a map directly (bypassing the operations). */
function seedMap(mapName, data) {
    h.store.set(mapName, data);
}

function makeOrientation({ lon = 10, lat = 20, fov = 75 } = {}) {
    return { lon, lat, fov };
}

function makeMarkerData(overrides = {}) {
    return {
        position: { heading: 45, pitch: -10, distance: 7 },
        properties: { nome: 'Ponto A', descricao: 'desc' },
        style: { markerColor: '#abcdef' },
        ...overrides
    };
}

// ============================================================================
// Setup
// ============================================================================

beforeEach(() => {
    vi.clearAllMocks();
    h.store.clear();
    h.currentMapName = 'TestMap';
    h.currentMapId = 'map-uuid-123';
    h.uuidCounter = 0;
    localStorageMock._reset();

    // Reset the shared memory cache to "no map cached" between tests.
    memoryStore.streetview360 = { orientations: {}, markers: [], _mapName: null };

    setStreetview360Dependencies({ eventBus });
});

// ============================================================================
// saveOrientation
// ============================================================================

describe('saveOrientation', () => {
    it('CREATEs a new orientation with the frozen flat-camera shape', async () => {
        await saveOrientation('photo-1.jpg', makeOrientation({ lon: 12.5, lat: -3.25, fov: 90 }));

        const data = h.store.get('TestMap');
        const saved = data.orientations['photo-1.jpg'];
        expect(saved).toMatchObject({
            id: 'uuid-1',
            photoName: 'photo-1.jpg',
            lon: 12.5,
            lat: -3.25,
            fov: 90
        });
        // Flat camera contract: lon/lat/fov are top-level numbers, NOT nested.
        expect(typeof saved.lon).toBe('number');
        expect(saved.position).toBeUndefined();
        expect(typeof saved.savedAt).toBe('number');
        expect(saved.sync).toBeDefined();
        expect(saved.sync.deleted).toBe(false);
    });

    it('emits logOrientation360Operation CREATE with the saved entity (no oldOrientation)', async () => {
        await saveOrientation('photo-1.jpg', makeOrientation({ lon: 5, lat: 6, fov: 70 }));

        expect(logOrientation360Operation).toHaveBeenCalledTimes(1);
        expect(logOrientation360Operation).toHaveBeenCalledWith(
            OperationType.CREATE,
            'uuid-1',
            'map-uuid-123',
            expect.objectContaining({
                id: 'uuid-1',
                photoName: 'photo-1.jpg',
                lon: 5,
                lat: 6,
                fov: 70
            })
        );
        // CREATE form: exactly 4 args (no previous-data arg).
        expect(logOrientation360Operation.mock.calls[0]).toHaveLength(4);
    });

    it('UPDATEs in place when one already exists (same id, emits UPDATE with saved + old)', async () => {
        await saveOrientation('photo-1.jpg', makeOrientation({ lon: 1, lat: 2, fov: 60 }));
        logOrientation360Operation.mockClear();

        await saveOrientation('photo-1.jpg', makeOrientation({ lon: 9, lat: 8, fov: 110 }));

        const saved = h.store.get('TestMap').orientations['photo-1.jpg'];
        // id is preserved across update (keyed by photoName).
        expect(saved.id).toBe('uuid-1');
        expect(saved.lon).toBe(9);
        expect(saved.fov).toBe(110);

        expect(logOrientation360Operation).toHaveBeenCalledTimes(1);
        const [op, id, mapId, newOrient, oldOrient] = logOrientation360Operation.mock.calls[0];
        expect(op).toBe(OperationType.UPDATE);
        expect(id).toBe('uuid-1');
        expect(mapId).toBe('map-uuid-123');
        expect(newOrient.lon).toBe(9);
        expect(oldOrient.lon).toBe(1); // previous state captured before mutation
    });

    it('bumps sync version on update (touchSyncMetadata)', async () => {
        await saveOrientation('photo-1.jpg', makeOrientation());
        const v1 = h.store.get('TestMap').orientations['photo-1.jpg'].sync.version;

        await saveOrientation('photo-1.jpg', makeOrientation({ lon: 99 }));
        const v2 = h.store.get('TestMap').orientations['photo-1.jpg'].sync.version;

        expect(v1).toBe(1);
        expect(v2).toBe(2);
    });

    it('keys orientations by photoName (distinct photos coexist)', async () => {
        await saveOrientation('a.jpg', makeOrientation({ lon: 1 }));
        await saveOrientation('b.jpg', makeOrientation({ lon: 2 }));

        const orientations = h.store.get('TestMap').orientations;
        expect(Object.keys(orientations).sort()).toEqual(['a.jpg', 'b.jpg']);
        expect(orientations['a.jpg'].lon).toBe(1);
        expect(orientations['b.jpg'].lon).toBe(2);
    });

    it('emits ORIENTATION_360_SAVED event', async () => {
        await saveOrientation('photo-1.jpg', makeOrientation());
        expect(eventBus.emit).toHaveBeenCalledWith(
            'orientation360:saved',
            { photoName: 'photo-1.jpg', mapName: 'TestMap' }
        );
    });

    it('persistence failure prevents sync logging (atomicity)', async () => {
        setStreetview360Compat.mockRejectedValueOnce(new Error('IDB write failed'));

        await expect(saveOrientation('photo-1.jpg', makeOrientation())).rejects.toThrow('IDB write failed');

        expect(logOrientation360Operation).not.toHaveBeenCalled();
    });

    it('re-CREATEs (not UPDATE) when prior orientation has no sync metadata', async () => {
        // Legacy/imported orientation missing sync → treated as a fresh create.
        seedMap('TestMap', { orientations: { 'photo-1.jpg': { lon: 0, lat: 0, fov: 1 } }, markers: [] });

        await saveOrientation('photo-1.jpg', makeOrientation({ lon: 7 }));

        expect(logOrientation360Operation).toHaveBeenCalledWith(
            OperationType.CREATE,
            expect.any(String),
            'map-uuid-123',
            expect.objectContaining({ lon: 7 })
        );
    });
});

// ============================================================================
// getOrientation / hasOrientation
// ============================================================================

describe('getOrientation / hasOrientation', () => {
    it('returns the stored active orientation', async () => {
        await saveOrientation('photo-1.jpg', makeOrientation({ lon: 33 }));

        const result = await getOrientation('photo-1.jpg');
        expect(result).not.toBeNull();
        expect(result.lon).toBe(33);
        expect(await hasOrientation('photo-1.jpg')).toBe(true);
    });

    it('returns null / false for a missing orientation', async () => {
        expect(await getOrientation('nope.jpg')).toBeNull();
        expect(await hasOrientation('nope.jpg')).toBe(false);
    });

    it('returns null / false for a soft-deleted orientation', async () => {
        await saveOrientation('photo-1.jpg', makeOrientation());
        await clearOrientation('photo-1.jpg');

        expect(await getOrientation('photo-1.jpg')).toBeNull();
        expect(await hasOrientation('photo-1.jpg')).toBe(false);
    });

    it('reads from the memory cache when the map is cached', async () => {
        await saveOrientation('photo-1.jpg', makeOrientation({ lon: 50 }));
        // Prime the cache for this map; cached path should be used.
        await loadStreetview360DataToMemory('TestMap');

        const result = await getOrientation('photo-1.jpg');
        expect(result.lon).toBe(50);
    });
});

// ============================================================================
// clearOrientation
// ============================================================================

describe('clearOrientation', () => {
    it('soft-deletes and emits DELETE (null new + oldOrientation)', async () => {
        await saveOrientation('photo-1.jpg', makeOrientation({ lon: 4 }));
        logOrientation360Operation.mockClear();

        const result = await clearOrientation('photo-1.jpg');
        expect(result).toBe(true);

        const stored = h.store.get('TestMap').orientations['photo-1.jpg'];
        expect(stored.sync.deleted).toBe(true);

        expect(logOrientation360Operation).toHaveBeenCalledTimes(1);
        const [op, id, mapId, newArg, oldArg] = logOrientation360Operation.mock.calls[0];
        expect(op).toBe(OperationType.DELETE);
        expect(id).toBe('uuid-1');
        expect(mapId).toBe('map-uuid-123');
        expect(newArg).toBeNull();
        expect(oldArg.lon).toBe(4);
        expect(oldArg.sync.deleted).toBe(false); // snapshot taken before deletion
    });

    it('emits ORIENTATION_360_CLEARED event', async () => {
        await saveOrientation('photo-1.jpg', makeOrientation());
        eventBus.emit.mockClear();

        await clearOrientation('photo-1.jpg');
        expect(eventBus.emit).toHaveBeenCalledWith(
            'orientation360:cleared',
            { photoName: 'photo-1.jpg', mapName: 'TestMap' }
        );
    });

    it('no-ops (false, no op) when no orientation exists', async () => {
        const result = await clearOrientation('ghost.jpg');
        expect(result).toBe(false);
        expect(logOrientation360Operation).not.toHaveBeenCalled();
        expect(setStreetview360Compat).not.toHaveBeenCalled();
    });

    it('no-ops when orientation already soft-deleted', async () => {
        await saveOrientation('photo-1.jpg', makeOrientation());
        await clearOrientation('photo-1.jpg');
        logOrientation360Operation.mockClear();
        setStreetview360Compat.mockClear();

        const result = await clearOrientation('photo-1.jpg');
        expect(result).toBe(false);
        expect(logOrientation360Operation).not.toHaveBeenCalled();
        expect(setStreetview360Compat).not.toHaveBeenCalled();
    });
});

// ============================================================================
// getAllOrientations
// ============================================================================

describe('getAllOrientations', () => {
    it('returns only active orientations keyed by photoName', async () => {
        await saveOrientation('a.jpg', makeOrientation({ lon: 1 }));
        await saveOrientation('b.jpg', makeOrientation({ lon: 2 }));
        await saveOrientation('c.jpg', makeOrientation({ lon: 3 }));
        await clearOrientation('b.jpg');

        const all = await getAllOrientations();
        expect(Object.keys(all).sort()).toEqual(['a.jpg', 'c.jpg']);
        expect(all['a.jpg'].lon).toBe(1);
        expect(all['c.jpg'].lon).toBe(3);
    });

    it('returns an empty object when there are no orientations', async () => {
        expect(await getAllOrientations()).toEqual({});
    });
});

// ============================================================================
// addMarker360
// ============================================================================

describe('addMarker360', () => {
    it('appends a marker with the frozen marker shape and assigned id', async () => {
        const marker = await addMarker360('photo-1.jpg', makeMarkerData());

        expect(marker).toMatchObject({
            id: 'uuid-1',
            photoName: 'photo-1.jpg',
            position: { heading: 45, pitch: -10, distance: 7 },
            properties: { nome: 'Ponto A', descricao: 'desc' },
            images: []
        });
        expect(marker.style).toMatchObject({ markerColor: '#abcdef' });
        expect(typeof marker.createdAt).toBe('number');
        expect(typeof marker.updatedAt).toBe('number');
        expect(marker.sync.deleted).toBe(false);

        // Persisted into the map's markers array.
        const stored = h.store.get('TestMap').markers;
        expect(stored).toHaveLength(1);
        expect(stored[0].id).toBe('uuid-1');
    });

    it('defaults distance to 5 and auto-numbers the name when missing', async () => {
        const marker = await addMarker360('photo-1.jpg', {
            position: { heading: 0, pitch: 0 },
            properties: {}
        });
        expect(marker.position.distance).toBe(5);
        expect(marker.properties.nome).toBe('Ponto #1');
        expect(marker.properties.descricao).toBe('');
    });

    it('auto-numbers based on the count of active markers for that photo', async () => {
        await addMarker360('photo-1.jpg', { position: { heading: 0, pitch: 0 }, properties: {} });
        const second = await addMarker360('photo-1.jpg', { position: { heading: 0, pitch: 0 }, properties: {} });
        expect(second.properties.nome).toBe('Ponto #2');
    });

    it('merges the default style with caller overrides', async () => {
        const marker = await addMarker360('photo-1.jpg', makeMarkerData({ style: { markerSize: 99 } }));
        expect(marker.style.markerSize).toBe(99);
        // Untouched default keys survive the merge.
        expect(marker.style.markerColor).toBe(DEFAULT_MARKER_360_STYLE.markerColor);
        expect(marker.style.showLabel).toBe(DEFAULT_MARKER_360_STYLE.showLabel);
    });

    it('uses the persisted default_marker_360_style from localStorage when present', async () => {
        localStorage.setItem('default_marker_360_style', JSON.stringify({ markerColor: '#000000', markerSize: 3 }));
        const marker = await addMarker360('photo-1.jpg', { position: { heading: 0, pitch: 0 }, properties: {} });
        expect(marker.style.markerColor).toBe('#000000');
        expect(marker.style.markerSize).toBe(3);
    });

    it('preserves optional temporal validity fields on the marker', async () => {
        const marker = await addMarker360('photo-1.jpg', {
            position: { heading: 0, pitch: 0 },
            properties: { temporalInicio: 1000, temporalFim: 5000 }
        });
        expect(marker.properties.temporalInicio).toBe(1000);
        expect(marker.properties.temporalFim).toBe(5000);
    });

    it('emits logMarker360Operation CREATE with the marker entity', async () => {
        const marker = await addMarker360('photo-1.jpg', makeMarkerData());

        expect(logMarker360Operation).toHaveBeenCalledTimes(1);
        expect(logMarker360Operation).toHaveBeenCalledWith(
            OperationType.CREATE,
            'uuid-1',
            'map-uuid-123',
            marker
        );
    });

    it('emits MARKERS_360_CHANGED event', async () => {
        await addMarker360('photo-1.jpg', makeMarkerData());
        expect(eventBus.emit).toHaveBeenCalledWith('markers360:changed', { mapName: 'TestMap' });
    });

    it('persistence failure prevents sync logging (atomicity)', async () => {
        setStreetview360Compat.mockRejectedValueOnce(new Error('IDB write failed'));
        await expect(addMarker360('photo-1.jpg', makeMarkerData())).rejects.toThrow('IDB write failed');
        expect(logMarker360Operation).not.toHaveBeenCalled();
    });
});

// ============================================================================
// getMarkers360 / getAllMarkers360 / getMarker360ById
// ============================================================================

describe('marker read paths', () => {
    it('getMarkers360 returns only active markers tied to the photo', async () => {
        await addMarker360('photo-1.jpg', makeMarkerData());
        await addMarker360('photo-1.jpg', makeMarkerData());
        await addMarker360('photo-2.jpg', makeMarkerData());

        const m1 = await getMarkers360('photo-1.jpg');
        expect(m1).toHaveLength(2);
        expect(m1.every(m => m.photoName === 'photo-1.jpg')).toBe(true);

        const m2 = await getMarkers360('photo-2.jpg');
        expect(m2).toHaveLength(1);
    });

    it('getMarkers360 excludes soft-deleted markers', async () => {
        const a = await addMarker360('photo-1.jpg', makeMarkerData());
        await addMarker360('photo-1.jpg', makeMarkerData());
        await removeMarker360(a.id);

        const result = await getMarkers360('photo-1.jpg');
        expect(result).toHaveLength(1);
        expect(result[0].id).not.toBe(a.id);
    });

    it('getMarkers360 returns [] for a photo with no markers', async () => {
        expect(await getMarkers360('empty.jpg')).toEqual([]);
    });

    it('getAllMarkers360 returns all active markers across photos', async () => {
        await addMarker360('photo-1.jpg', makeMarkerData());
        await addMarker360('photo-2.jpg', makeMarkerData());
        const removed = await addMarker360('photo-2.jpg', makeMarkerData());
        await removeMarker360(removed.id);

        const all = await getAllMarkers360();
        expect(all).toHaveLength(2);
    });

    it('getMarker360ById returns the marker / null for missing / null for deleted', async () => {
        const marker = await addMarker360('photo-1.jpg', makeMarkerData());

        const found = await getMarker360ById(marker.id);
        expect(found.id).toBe(marker.id);

        expect(await getMarker360ById('does-not-exist')).toBeNull();

        await removeMarker360(marker.id);
        expect(await getMarker360ById(marker.id)).toBeNull();
    });
});

// ============================================================================
// updateMarker360
// ============================================================================

describe('updateMarker360', () => {
    it('merges properties/style/position and bumps updatedAt + sync version', async () => {
        const marker = await addMarker360('photo-1.jpg', makeMarkerData());
        const beforeVersion = marker.sync.version;

        const updated = await updateMarker360(marker.id, {
            properties: { nome: 'Renamed' },
            style: { markerSize: 30 },
            position: { heading: 180 }
        });

        expect(updated.properties.nome).toBe('Renamed');
        expect(updated.properties.descricao).toBe('desc'); // merged, not replaced
        expect(updated.style.markerSize).toBe(30);
        expect(updated.style.markerColor).toBe('#abcdef'); // preserved
        expect(updated.position.heading).toBe(180);
        expect(updated.position.pitch).toBe(-10); // preserved
        expect(updated.sync.version).toBe(beforeVersion + 1);
    });

    it('emits logMarker360Operation UPDATE with (marker, previousData)', async () => {
        const marker = await addMarker360('photo-1.jpg', makeMarkerData());
        logMarker360Operation.mockClear();

        await updateMarker360(marker.id, { properties: { nome: 'Renamed' } });

        expect(logMarker360Operation).toHaveBeenCalledTimes(1);
        const [op, id, mapName, current, previous] = logMarker360Operation.mock.calls[0];
        expect(op).toBe(OperationType.UPDATE);
        expect(id).toBe(marker.id);
        expect(mapName).toBe('TestMap'); // NOTE: marker ops use mapName, orientation ops use mapId
        expect(current.properties.nome).toBe('Renamed');
        expect(previous.properties.nome).toBe('Ponto A'); // deep-cloned pre-update snapshot
    });

    it('returns null and emits no op when the marker is missing', async () => {
        const result = await updateMarker360('ghost', { properties: { nome: 'x' } });
        expect(result).toBeNull();
        expect(logMarker360Operation).not.toHaveBeenCalled();
        expect(setStreetview360Compat).not.toHaveBeenCalled();
    });

    it('returns null when the marker is soft-deleted', async () => {
        const marker = await addMarker360('photo-1.jpg', makeMarkerData());
        await removeMarker360(marker.id);
        logMarker360Operation.mockClear();

        const result = await updateMarker360(marker.id, { properties: { nome: 'x' } });
        expect(result).toBeNull();
        expect(logMarker360Operation).not.toHaveBeenCalled();
    });
});

// ============================================================================
// removeMarker360
// ============================================================================

describe('removeMarker360', () => {
    it('soft-deletes and emits DELETE (null new + previousData)', async () => {
        const marker = await addMarker360('photo-1.jpg', makeMarkerData());
        logMarker360Operation.mockClear();

        const result = await removeMarker360(marker.id);
        expect(result).toBe(true);

        const stored = h.store.get('TestMap').markers[0];
        expect(stored.sync.deleted).toBe(true);

        const [op, id, mapName, newArg, previous] = logMarker360Operation.mock.calls[0];
        expect(op).toBe(OperationType.DELETE);
        expect(id).toBe(marker.id);
        expect(mapName).toBe('TestMap');
        expect(newArg).toBeNull();
        expect(previous.sync.deleted).toBe(false); // snapshot before deletion
    });

    it('no-ops (false, no op) when marker missing', async () => {
        const result = await removeMarker360('ghost');
        expect(result).toBe(false);
        expect(logMarker360Operation).not.toHaveBeenCalled();
        expect(setStreetview360Compat).not.toHaveBeenCalled();
    });

    it('no-ops when marker already soft-deleted', async () => {
        const marker = await addMarker360('photo-1.jpg', makeMarkerData());
        await removeMarker360(marker.id);
        logMarker360Operation.mockClear();
        setStreetview360Compat.mockClear();

        const result = await removeMarker360(marker.id);
        expect(result).toBe(false);
        expect(logMarker360Operation).not.toHaveBeenCalled();
        expect(setStreetview360Compat).not.toHaveBeenCalled();
    });
});

// ============================================================================
// removeMarkers360ByPhoto
// ============================================================================

describe('removeMarkers360ByPhoto', () => {
    it('soft-deletes all active markers for a photo and returns the count', async () => {
        await addMarker360('photo-1.jpg', makeMarkerData());
        await addMarker360('photo-1.jpg', makeMarkerData());
        await addMarker360('photo-2.jpg', makeMarkerData());

        const removed = await removeMarkers360ByPhoto('photo-1.jpg');
        expect(removed).toBe(2);

        expect(await getMarkers360('photo-1.jpg')).toHaveLength(0);
        expect(await getMarkers360('photo-2.jpg')).toHaveLength(1);
    });

    it('returns 0 and does not persist when nothing matches', async () => {
        await addMarker360('photo-1.jpg', makeMarkerData());
        setStreetview360Compat.mockClear();

        const removed = await removeMarkers360ByPhoto('photo-X.jpg');
        expect(removed).toBe(0);
        expect(setStreetview360Compat).not.toHaveBeenCalled();
    });

    it('does NOT re-count or re-delete already-deleted markers', async () => {
        await addMarker360('photo-1.jpg', makeMarkerData());
        await addMarker360('photo-1.jpg', makeMarkerData());
        await removeMarkers360ByPhoto('photo-1.jpg');

        const removedAgain = await removeMarkers360ByPhoto('photo-1.jpg');
        expect(removedAgain).toBe(0);
    });
});

// ============================================================================
// Marker image operations (attach/detach — verify NO sync op is emitted)
// ============================================================================

describe('marker image operations', () => {
    const fakeFile = () => ({ name: 'shot.png', type: 'image/png', size: 1234 });

    it('addMarker360Image appends the image, bumps sync version, and logs an UPDATE sync op', async () => {
        const marker = await addMarker360('photo-1.jpg', makeMarkerData());
        logMarker360Operation.mockClear();

        const image = await addMarker360Image(marker.id, fakeFile());

        expect(image).toMatchObject({
            id: 'uuid-2', // uuid-1 was the marker
            name: 'shot.png',
            type: 'image/png',
            size: 1234,
            data: 'base64-data',
            thumbnail: 'base64-thumb'
        });
        expect(typeof image.addedAt).toBe('number');

        const stored = h.store.get('TestMap').markers[0];
        expect(stored.images).toHaveLength(1);
        expect(stored.images[0].id).toBe('uuid-2');
        expect(stored.sync.version).toBe(2);

        // The image is inline in the marker's data → attaching it is a marker UPDATE that must sync
        // to peers (regression: it used to stay local — no op).
        expect(logMarker360Operation).toHaveBeenCalledTimes(1);
        const [op, id, , newData] = logMarker360Operation.mock.calls[0];
        expect(op).toBe(OperationType.UPDATE);
        expect(id).toBe(marker.id);
        expect(newData.images.some(i => i.id === image.id)).toBe(true);
    });

    it('addMarker360Image returns null for an invalid file (no persist)', async () => {
        const marker = await addMarker360('photo-1.jpg', makeMarkerData());
        validateImageFile.mockReturnValueOnce({ valid: false, error: 'too big' });
        setStreetview360Compat.mockClear();

        const result = await addMarker360Image(marker.id, fakeFile());
        expect(result).toBeNull();
        expect(setStreetview360Compat).not.toHaveBeenCalled();
    });

    it('addMarker360Image returns null when the marker is missing', async () => {
        const result = await addMarker360Image('ghost', fakeFile());
        expect(result).toBeNull();
    });

    it('getMarker360Images returns the attached images / [] when none', async () => {
        const marker = await addMarker360('photo-1.jpg', makeMarkerData());
        expect(await getMarker360Images(marker.id)).toEqual([]);

        await addMarker360Image(marker.id, fakeFile());
        const images = await getMarker360Images(marker.id);
        expect(images).toHaveLength(1);
        expect(images[0].name).toBe('shot.png');
    });

    it('getMarker360Images returns [] for a missing marker', async () => {
        expect(await getMarker360Images('ghost')).toEqual([]);
    });

    it('removeMarker360Image detaches the image, persists, and logs an UPDATE sync op', async () => {
        const marker = await addMarker360('photo-1.jpg', makeMarkerData());
        const image = await addMarker360Image(marker.id, fakeFile());
        logMarker360Operation.mockClear();

        const result = await removeMarker360Image(marker.id, image.id);
        expect(result).toBe(true);

        const stored = h.store.get('TestMap').markers[0];
        expect(stored.images).toHaveLength(0);
        // a successful detach is a marker UPDATE that must sync to peers
        expect(logMarker360Operation).toHaveBeenCalledTimes(1);
        expect(logMarker360Operation.mock.calls[0][0]).toBe(OperationType.UPDATE);
    });

    it('removeMarker360Image returns false for a missing image', async () => {
        const marker = await addMarker360('photo-1.jpg', makeMarkerData());
        expect(await removeMarker360Image(marker.id, 'no-such-image')).toBe(false);
    });

    it('removeMarker360Image returns false for a missing marker', async () => {
        expect(await removeMarker360Image('ghost', 'img')).toBe(false);
    });
});

// ============================================================================
// Export / Import round-trip
// ============================================================================

describe('getStreetview360DataForExport / setStreetview360DataForImport', () => {
    it('export returns null when there is no active data', async () => {
        expect(await getStreetview360DataForExport('TestMap')).toBeNull();
    });

    it('export returns active orientations + markers only', async () => {
        await saveOrientation('a.jpg', makeOrientation({ lon: 1 }));
        await saveOrientation('b.jpg', makeOrientation({ lon: 2 }));
        await clearOrientation('b.jpg');
        const keep = await addMarker360('a.jpg', makeMarkerData());
        const drop = await addMarker360('a.jpg', makeMarkerData());
        await removeMarker360(drop.id);

        const exported = await getStreetview360DataForExport('TestMap');
        expect(Object.keys(exported.orientations)).toEqual(['a.jpg']);
        expect(exported.markers).toHaveLength(1);
        expect(exported.markers[0].id).toBe(keep.id);
    });

    it('import merges orientations (overwrite) and regenerates marker ids', async () => {
        // Pre-existing data in the target map.
        await saveOrientation('existing.jpg', makeOrientation({ lon: 100 }));
        const existingMarker = await addMarker360('existing.jpg', makeMarkerData());

        const importData = {
            orientations: {
                'imported.jpg': { lon: 7, lat: 8, fov: 50 } // no id/sync → both get generated
            },
            markers: [
                { photoName: 'imported.jpg', id: 'OLD-ID', position: { heading: 1, pitch: 2, distance: 3 }, properties: { nome: 'I' }, images: [], style: {} }
            ]
        };

        await setStreetview360DataForImport('TestMap', importData);

        const data = h.store.get('TestMap');

        // Orientations merged: existing kept, imported added with generated id + sync.
        expect(data.orientations['existing.jpg'].lon).toBe(100);
        expect(data.orientations['imported.jpg'].lon).toBe(7);
        expect(data.orientations['imported.jpg'].id).toBeTruthy();
        expect(data.orientations['imported.jpg'].sync.deleted).toBe(false);

        // Markers: existing active marker retained + imported marker with a NEW id.
        const ids = data.markers.map(m => m.id);
        expect(ids).toContain(existingMarker.id);
        expect(ids).not.toContain('OLD-ID'); // regenerated to avoid conflicts
        const importedMarker = data.markers.find(m => m.properties.nome === 'I');
        expect(importedMarker.sync.deleted).toBe(false);
    });

    it('round-trips an export back through import preserving the shape', async () => {
        await saveOrientation('a.jpg', makeOrientation({ lon: 11, lat: 22, fov: 33 }));
        await addMarker360('a.jpg', makeMarkerData());

        const exported = await getStreetview360DataForExport('TestMap');

        // Import into a fresh map.
        await setStreetview360DataForImport('FreshMap', exported);

        const fresh = await getStreetview360DataForExport('FreshMap');
        expect(fresh.orientations['a.jpg']).toMatchObject({ lon: 11, lat: 22, fov: 33 });
        expect(fresh.markers).toHaveLength(1);
        expect(fresh.markers[0].properties.nome).toBe('Ponto A');
    });

    it('import emits MARKERS_360_CHANGED', async () => {
        eventBus.emit.mockClear();
        await setStreetview360DataForImport('TestMap', { orientations: {}, markers: [] });
        expect(eventBus.emit).toHaveBeenCalledWith('markers360:changed', { mapName: 'TestMap' });
    });
});

// ============================================================================
// Memory cache behavior
// ============================================================================

describe('loadStreetview360DataToMemory / clearStreetview360Cache', () => {
    it('loads persisted data into the memory cache and tags _mapName', async () => {
        await saveOrientation('a.jpg', makeOrientation({ lon: 5 }));
        await addMarker360('a.jpg', makeMarkerData());

        await loadStreetview360DataToMemory('TestMap');

        expect(memoryStore.streetview360._mapName).toBe('TestMap');
        expect(memoryStore.streetview360.orientations['a.jpg'].lon).toBe(5);
        expect(memoryStore.streetview360.markers).toHaveLength(1);
    });

    it('falls back to empty shape when nothing is persisted', async () => {
        await loadStreetview360DataToMemory('EmptyMap');
        expect(memoryStore.streetview360.orientations).toEqual({});
        expect(memoryStore.streetview360.markers).toEqual([]);
        expect(memoryStore.streetview360._mapName).toBe('EmptyMap');
    });

    it('clearStreetview360Cache resets the cache and detaches _mapName', async () => {
        await loadStreetview360DataToMemory('TestMap');
        clearStreetview360Cache();
        expect(memoryStore.streetview360).toEqual({ orientations: {}, markers: [], _mapName: null });
    });

    it('cached reads stay live with saveOrientation updates', async () => {
        await loadStreetview360DataToMemory('TestMap'); // cache empty TestMap
        await saveOrientation('a.jpg', makeOrientation({ lon: 88 }));

        // saveOrientation writes through to the cache when cached.
        expect(memoryStore.streetview360.orientations['a.jpg'].lon).toBe(88);
        // And getOrientation reads the cached value.
        expect((await getOrientation('a.jpg')).lon).toBe(88);
    });
});

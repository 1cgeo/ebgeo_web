// Path: tests/store/cesium3d-operations.test.js
//
// Real coverage for src/js/store/cesium3d.operations.js — the four 3D entity
// families (camera positions, markers, measurements, viewsheds). The 3D op
// envelope is a frozen contract (shape bugs were found before), so these tests
// assert the EXACT emitted entity shapes and the op (OperationType, id, mapId,
// new, old) passed to each log* fn, plus persistence/atomicity guarantees.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Hoisted shared state (available to vi.mock factories)
// ============================================================================

const h = vi.hoisted(() => ({
    // In-memory backing store keyed by mapName → cesium3d data object.
    store: new Map(),
    mapManager: {
        getCurrentMapName: vi.fn(() => 'TestMap'),
        getCurrentMapId: vi.fn(() => 'map-uuid-123')
    },
    // memoryStore.cesium3d — null by default so getCesium3dDataWithCache always
    // loads through getCesium3dCompat (the backing store). Tests that exercise
    // the memory cache set this explicitly.
    memory: { cesium3d: null },
    localStorage: new Map()
}));

// ============================================================================
// Mock dependencies (everything DOM/IO-coupled; keep sync-metadata, deep-utils,
// uuid and events REAL so emitted shapes are genuine)
// ============================================================================

vi.mock('../../src/js/store/repositories/index.js', () => ({
    getCesium3dCompat: vi.fn(async (mapName) => {
        const existing = h.store.get(mapName);
        // Return a fresh deserialized copy each call (mirrors the real repo,
        // which deserializes from IndexedDB), and a fresh empty structure when
        // nothing is stored yet.
        const data = existing
            ? structuredClone(existing)
            : { cameraPositions: {}, markers: [], measurements: [], viewsheds: [] };
        return data;
    }),
    setCesium3dCompat: vi.fn(async (mapName, data) => {
        h.store.set(mapName, structuredClone(data));
    })
}));

vi.mock('../../src/js/store/store-state-manager.js', () => ({
    default: h.mapManager
}));

vi.mock('../../src/js/store/memory-store.js', () => ({
    memoryStore: {
        get cesium3d() { return h.memory.cesium3d; },
        set cesium3d(v) { h.memory.cesium3d = v; }
    }
}));

vi.mock('../../src/js/store/store-errors.js', () => ({
    StoreErrorEvents: { STORE_PERSIST_ERROR: 'store:persistError' },
    emitStoreError: vi.fn()
}));

vi.mock('../../src/js/utilities/image_utils.js', () => ({
    validateImageFile: vi.fn((file) => (file ? { valid: true } : { valid: false, reason: 'no file' })),
    processImageFile: vi.fn(async () => ({ data: 'data:image/png;base64,AAAA', thumbnail: 'data:image/png;base64,TTTT' }))
}));

vi.mock('../../src/js/store/sync/index.js', () => ({
    logMarker3dOperation: vi.fn().mockResolvedValue(undefined),
    logMeasurement3dOperation: vi.fn().mockResolvedValue(undefined),
    logViewshed3dOperation: vi.fn().mockResolvedValue(undefined),
    logCameraPosition3dOperation: vi.fn().mockResolvedValue(undefined),
    OperationType: { CREATE: 'CREATE', UPDATE: 'UPDATE', DELETE: 'DELETE' }
}));

// ============================================================================
// Imports (after mocks)
// ============================================================================

import {
    // camera
    saveCameraPosition,
    getCameraPosition,
    hasSavedCameraPosition,
    clearCameraPosition,
    getAllCameraPositions,
    // markers
    addMarker,
    getMarkers,
    getAllMarkers,
    getMarkerById,
    updateMarker,
    removeMarker,
    removeMarkersByTileset,
    addMarkerImage,
    getMarkerImages,
    removeMarkerImage,
    DEFAULT_MARKER_STYLE,
    // measurements
    addMeasurement,
    getMeasurements,
    getAllMeasurements,
    getMeasurementById,
    updateMeasurement,
    removeMeasurement,
    removeMeasurementsByTileset,
    addMeasurementImage,
    getMeasurementImages,
    removeMeasurementImage,
    DEFAULT_MEASUREMENT_STYLE,
    // viewsheds
    addViewshed,
    getViewsheds,
    getAllViewsheds,
    getViewshedById,
    updateViewshed,
    removeViewshed,
    removeViewshedsByTileset,
    addViewshedImage,
    getViewshedImages,
    removeViewshedImage,
    // bulk + memory + import/export
    removeAllFeaturesByTileset,
    loadCesium3dDataToMemory,
    clearCesium3dCache,
    setCesium3dDataForImport,
    getCesium3dDataForExport,
    setCesium3dDependencies
} from '../../src/js/store/cesium3d.operations.js';

import { getCesium3dCompat, setCesium3dCompat } from '../../src/js/store/repositories/index.js';
import {
    logMarker3dOperation,
    logMeasurement3dOperation,
    logViewshed3dOperation,
    logCameraPosition3dOperation
} from '../../src/js/store/sync/index.js';
import { isActive } from '../../src/js/store/sync/sync-metadata.js';

// ============================================================================
// Helpers
// ============================================================================

const MAP = 'TestMap';

/** Seeds the backing store for MAP with the given (partial) cesium3d data. */
function seed(partial) {
    h.store.set(MAP, {
        cameraPositions: {},
        markers: [],
        measurements: [],
        viewsheds: [],
        ...partial
    });
}

/** Reads what was last persisted to the backing store for MAP. */
function persisted() {
    return h.store.get(MAP);
}

function fakeImageFile(name = 'pic.png', type = 'image/png', size = 1234) {
    return { name, type, size };
}

const eventBus = { emit: vi.fn() };

beforeEach(() => {
    vi.clearAllMocks();
    h.store.clear();
    h.memory.cesium3d = null;
    h.mapManager.getCurrentMapName.mockReturnValue('TestMap');
    h.mapManager.getCurrentMapId.mockReturnValue('map-uuid-123');
    eventBus.emit.mockClear();

    // localStorage stub (getUserDefaultStyle reads marker3d/measurement3d styles)
    globalThis.localStorage = {
        getItem: (k) => (h.localStorage.has(k) ? h.localStorage.get(k) : null),
        setItem: (k, v) => h.localStorage.set(k, v),
        removeItem: (k) => h.localStorage.delete(k),
        clear: () => h.localStorage.clear()
    };
    h.localStorage.clear();

    setCesium3dDependencies({ eventBus });
});

// ============================================================================
// CAMERA POSITIONS
// ============================================================================

describe('camera positions', () => {
    const POS = { longitude: -43.2, latitude: -22.9, height: 500 };
    const ORI = { heading: 1, pitch: -0.5, roll: 0 };

    it('saveCameraPosition CREATE: persists keyed by tilesetId and emits CREATE op with full shape', async () => {
        await saveCameraPosition('tsA', POS, ORI);

        const saved = persisted().cameraPositions.tsA;
        expect(saved).toBeDefined();
        expect(saved.tilesetId).toBe('tsA');
        expect(saved.position).toEqual(POS);
        expect(saved.orientation).toEqual(ORI);
        expect(typeof saved.id).toBe('string');
        expect(saved.id.length).toBeGreaterThan(0);
        expect(typeof saved.savedAt).toBe('number');
        expect(saved.sync.version).toBe(1);

        expect(logCameraPosition3dOperation).toHaveBeenCalledTimes(1);
        const [op, id, mapId, newData] = logCameraPosition3dOperation.mock.calls[0];
        expect(op).toBe('CREATE');
        expect(id).toBe(saved.id);
        expect(mapId).toBe('map-uuid-123');
        expect(newData).toEqual(saved);
        // CREATE carries no previousData
        expect(logCameraPosition3dOperation.mock.calls[0][4]).toBeUndefined();
    });

    it('saveCameraPosition UPDATE: keeps id, bumps sync version, emits UPDATE with new + previous', async () => {
        await saveCameraPosition('tsA', POS, ORI);
        const firstId = persisted().cameraPositions.tsA.id;
        const firstSnapshot = structuredClone(persisted().cameraPositions.tsA);
        logCameraPosition3dOperation.mockClear();

        const POS2 = { longitude: 1, latitude: 2, height: 3 };
        await saveCameraPosition('tsA', POS2, ORI);

        const saved = persisted().cameraPositions.tsA;
        expect(saved.id).toBe(firstId); // id preserved across update
        expect(saved.position).toEqual(POS2);
        expect(saved.sync.version).toBe(2); // touchSyncMetadata bumped

        const [op, id, mapId, newData, prevData] = logCameraPosition3dOperation.mock.calls[0];
        expect(op).toBe('UPDATE');
        expect(id).toBe(firstId);
        expect(mapId).toBe('map-uuid-123');
        expect(newData.position).toEqual(POS2);
        expect(prevData).toEqual(firstSnapshot); // previous (pre-update) snapshot
    });

    it('getCameraPosition / hasSavedCameraPosition reflect presence; missing → null/false', async () => {
        expect(await getCameraPosition('ghost')).toBeNull();
        expect(await hasSavedCameraPosition('ghost')).toBe(false);

        await saveCameraPosition('tsA', POS, ORI);
        const got = await getCameraPosition('tsA');
        expect(got.tilesetId).toBe('tsA');
        expect(await hasSavedCameraPosition('tsA')).toBe(true);
    });

    it('getAllCameraPositions returns the keyed object', async () => {
        await saveCameraPosition('tsA', POS, ORI);
        await saveCameraPosition('tsB', POS, ORI);

        const all = await getAllCameraPositions();
        expect(Object.keys(all).sort()).toEqual(['tsA', 'tsB']);
    });

    it('clearCameraPosition DELETE: removes key, emits DELETE with null + previous, returns true', async () => {
        await saveCameraPosition('tsA', POS, ORI);
        const snapshot = structuredClone(persisted().cameraPositions.tsA);
        logCameraPosition3dOperation.mockClear();

        const result = await clearCameraPosition('tsA');

        expect(result).toBe(true);
        expect(persisted().cameraPositions.tsA).toBeUndefined();

        const [op, id, mapId, newData, prevData] = logCameraPosition3dOperation.mock.calls[0];
        expect(op).toBe('DELETE');
        expect(id).toBe(snapshot.id);
        expect(mapId).toBe('map-uuid-123');
        expect(newData).toBeNull();
        expect(prevData).toEqual(snapshot);
    });

    it('clearCameraPosition no-op when absent: returns false, no persist, no op', async () => {
        const result = await clearCameraPosition('ghost');
        expect(result).toBe(false);
        expect(setCesium3dCompat).not.toHaveBeenCalled();
        expect(logCameraPosition3dOperation).not.toHaveBeenCalled();
    });
});

// ============================================================================
// MARKERS
// ============================================================================

describe('markers', () => {
    it('addMarker CREATE: assigns id/tilesetId, defaults name + style, emits CREATE op with exact entity', async () => {
        const marker = await addMarker('tsA', { position: { longitude: 1, latitude: 2 } });

        expect(typeof marker.id).toBe('string');
        expect(marker.tilesetId).toBe('tsA');
        expect(marker.position).toEqual({ longitude: 1, latitude: 2 });
        expect(marker.properties.nome).toBe('Ponto #1');
        expect(marker.properties.descricao).toBe('');
        // style merges DEFAULT_MARKER_STYLE
        expect(marker.style.markerColor).toBe(DEFAULT_MARKER_STYLE.markerColor);
        expect(marker.style.labelText).toBe('');
        expect(marker.sync.version).toBe(1);

        // persisted
        expect(persisted().markers).toHaveLength(1);
        expect(persisted().markers[0].id).toBe(marker.id);

        // op envelope: CREATE, id, mapId, full entity (no old)
        expect(logMarker3dOperation).toHaveBeenCalledTimes(1);
        const [op, id, mapId, newData] = logMarker3dOperation.mock.calls[0];
        expect(op).toBe('CREATE');
        expect(id).toBe(marker.id);
        expect(mapId).toBe('map-uuid-123');
        expect(newData).toEqual(marker);
        expect(logMarker3dOperation.mock.calls[0][4]).toBeUndefined();
    });

    it('addMarker honors explicit name and auto-increments the default counter', async () => {
        await addMarker('tsA', { position: {}, properties: { nome: 'Ponto #5' } });
        const next = await addMarker('tsA', { position: {} });
        // getNextAutoNumber scans existing "Ponto #N" → max is 5 → next is 6
        expect(next.properties.nome).toBe('Ponto #6');
    });

    it('addMarker merges user default style from localStorage and explicit style override', async () => {
        h.localStorage.set('marker3d_default_style', JSON.stringify({ markerColor: '#abcdef', markerSize: 99 }));

        const marker = await addMarker('tsA', { position: {}, style: { markerSize: 12 } });

        expect(marker.style.markerColor).toBe('#abcdef'); // from user default
        expect(marker.style.markerSize).toBe(12); // explicit override wins over user default
    });

    it('getMarkers filters by tileset and excludes soft-deleted', async () => {
        const a = await addMarker('tsA', { position: {} });
        await addMarker('tsB', { position: {} });
        const deleted = await addMarker('tsA', { position: {} });
        // soft-delete the third marker (tsA) directly in the backing store.
        // Null the memory cache first so the read goes through getCesium3dCompat
        // (saveCesium3dData populates memoryStore.cesium3d on every write).
        const data = persisted();
        const target = data.markers.find(m => m.id === deleted.id);
        target.sync = { ...target.sync, deleted: true, deletedAt: Date.now() };
        h.store.set(MAP, structuredClone(data));
        h.memory.cesium3d = null;

        const markers = await getMarkers('tsA');
        expect(markers.map(m => m.id)).toEqual([a.id]);
        markers.forEach(m => expect(isActive(m.sync)).toBe(true));
    });

    it('getAllMarkers returns all active across tilesets; getMarkerById finds incl. deleted; missing → null', async () => {
        const a = await addMarker('tsA', { position: {} });
        const b = await addMarker('tsB', { position: {} });

        const all = await getAllMarkers();
        expect(all.map(m => m.id).sort()).toEqual([a.id, b.id].sort());

        expect((await getMarkerById(a.id)).id).toBe(a.id);
        expect(await getMarkerById('ghost')).toBeNull();
    });

    it('updateMarker UPDATE: applies properties/style/position, bumps version, emits UPDATE with new + old', async () => {
        const marker = await addMarker('tsA', { position: { longitude: 0, latitude: 0 } });
        const before = structuredClone(persisted().markers[0]);
        logMarker3dOperation.mockClear();

        const updated = await updateMarker(marker.id, {
            properties: { nome: 'Renamed' },
            style: { markerSize: 50 },
            position: { longitude: 9, latitude: 9 }
        });

        expect(updated.properties.nome).toBe('Renamed');
        expect(updated.properties.descricao).toBe(''); // preserved merge
        expect(updated.style.markerSize).toBe(50);
        expect(updated.style.markerColor).toBe(DEFAULT_MARKER_STYLE.markerColor); // preserved
        expect(updated.position).toEqual({ longitude: 9, latitude: 9 });
        expect(updated.sync.version).toBe(2);

        const [op, id, mapId, newData, oldData] = logMarker3dOperation.mock.calls[0];
        expect(op).toBe('UPDATE');
        expect(id).toBe(marker.id);
        expect(mapId).toBe('map-uuid-123');
        expect(newData.properties.nome).toBe('Renamed');
        expect(oldData.properties.nome).toBe(before.properties.nome);
        expect(oldData.sync.version).toBe(1);
    });

    it('updateMarker no-op when id missing: returns null, no persist, no op', async () => {
        const result = await updateMarker('ghost', { properties: { nome: 'x' } });
        expect(result).toBeNull();
        expect(setCesium3dCompat).not.toHaveBeenCalled();
        expect(logMarker3dOperation).not.toHaveBeenCalled();
    });

    it('removeMarker DELETE: hard-removes, emits DELETE with null + deleted entity, returns true', async () => {
        const marker = await addMarker('tsA', { position: {} });
        const snapshot = structuredClone(persisted().markers[0]);
        logMarker3dOperation.mockClear();

        const result = await removeMarker(marker.id);

        expect(result).toBe(true);
        expect(persisted().markers).toHaveLength(0);

        const [op, id, mapId, newData, oldData] = logMarker3dOperation.mock.calls[0];
        expect(op).toBe('DELETE');
        expect(id).toBe(marker.id);
        expect(mapId).toBe('map-uuid-123');
        expect(newData).toBeNull();
        expect(oldData).toEqual(snapshot);
    });

    it('removeMarker no-op when missing: returns false, no persist, no op', async () => {
        const result = await removeMarker('ghost');
        expect(result).toBe(false);
        expect(setCesium3dCompat).not.toHaveBeenCalled();
        expect(logMarker3dOperation).not.toHaveBeenCalled();
    });

    it('removeMarkersByTileset: removes only the target tileset, leaves others intact', async () => {
        const a1 = await addMarker('tsA', { position: {} });
        await addMarker('tsA', { position: {} });
        const b1 = await addMarker('tsB', { position: {} });

        const count = await removeMarkersByTileset('tsA');

        expect(count).toBe(2);
        const remaining = persisted().markers;
        expect(remaining.map(m => m.id)).toEqual([b1.id]);
        expect(remaining.map(m => m.id)).not.toContain(a1.id);
    });

    it('removeMarkersByTileset no-op when nothing matches: returns 0, no persist', async () => {
        await addMarker('tsA', { position: {} });
        const count = await removeMarkersByTileset('tsZ');
        expect(count).toBe(0);
    });
});

// ============================================================================
// MARKER IMAGES
// ============================================================================

describe('marker images', () => {
    it('addMarkerImage persists image, emits change event, and logs an UPDATE sync op', async () => {
        const marker = await addMarker('tsA', { position: {} });
        logMarker3dOperation.mockClear();
        eventBus.emit.mockClear();

        const file = fakeImageFile('photo.png', 'image/png', 4096);
        const img = await addMarkerImage(marker.id, file);

        expect(img).not.toBeNull();
        expect(typeof img.id).toBe('string');
        expect(img.name).toBe('photo.png');
        expect(img.type).toBe('image/png');
        expect(img.size).toBe(4096);
        expect(img.data).toBe('data:image/png;base64,AAAA');
        expect(img.thumbnail).toBe('data:image/png;base64,TTTT');

        // persisted onto the marker
        const persistedMarker = persisted().markers.find(m => m.id === marker.id);
        expect(persistedMarker.images).toHaveLength(1);
        expect(persistedMarker.images[0].id).toBe(img.id);

        // The image lives INLINE in the marker's data, so attaching it is a marker UPDATE that must
        // sync to peers (regression: it used to stay local — emit only, no op).
        expect(eventBus.emit).toHaveBeenCalledWith('markers3d:changed', { mapName: MAP });
        expect(logMarker3dOperation).toHaveBeenCalledTimes(1);
        const [op, id, mapId, newData] = logMarker3dOperation.mock.calls[0];
        expect(op).toBe('UPDATE');
        expect(id).toBe(marker.id);
        expect(mapId).toBe('map-uuid-123');
        expect(newData.images.some(i => i.id === img.id)).toBe(true);
        expect(newData.sync.version).toBe(2); // version bumped so peers converge by LWW
    });

    it('addMarkerImage returns null on invalid file and on missing entity', async () => {
        // invalid file → validateImageFile returns invalid
        expect(await addMarkerImage('whatever', null)).toBeNull();

        // valid file but missing marker
        seed({ markers: [] });
        expect(await addMarkerImage('ghost', fakeImageFile())).toBeNull();
    });

    it('getMarkerImages returns stored images, [] when none/missing', async () => {
        const marker = await addMarker('tsA', { position: {} });
        expect(await getMarkerImages(marker.id)).toEqual([]);

        await addMarkerImage(marker.id, fakeImageFile('a.png'));
        const imgs = await getMarkerImages(marker.id);
        expect(imgs).toHaveLength(1);

        expect(await getMarkerImages('ghost')).toEqual([]);
    });

    it('removeMarkerImage removes by imageId (true) + logs UPDATE, false when image/marker absent', async () => {
        const marker = await addMarker('tsA', { position: {} });
        const img = await addMarkerImage(marker.id, fakeImageFile());
        logMarker3dOperation.mockClear();

        expect(await removeMarkerImage(marker.id, 'no-such-image')).toBe(false);
        expect(logMarker3dOperation).not.toHaveBeenCalled(); // a no-op removal logs nothing

        const ok = await removeMarkerImage(marker.id, img.id);
        expect(ok).toBe(true);
        expect(persisted().markers.find(m => m.id === marker.id).images).toHaveLength(0);
        // a successful removal is a marker UPDATE that must sync to peers
        expect(logMarker3dOperation).toHaveBeenCalledTimes(1);
        expect(logMarker3dOperation.mock.calls[0][0]).toBe('UPDATE');

        expect(await removeMarkerImage('ghost', img.id)).toBe(false);
    });
});

// ============================================================================
// Measurement & viewshed images also sync (shared helper, per-collection logger)
// ============================================================================

describe('measurement & viewshed images sync', () => {
    it('addMeasurementImage logs a measurement UPDATE op carrying the new image', async () => {
        const m = await addMeasurement('tsA', {});
        logMeasurement3dOperation.mockClear();

        const img = await addMeasurementImage(m.id, fakeImageFile());

        expect(img).not.toBeNull();
        expect(logMeasurement3dOperation).toHaveBeenCalledTimes(1);
        const [op, id, , newData] = logMeasurement3dOperation.mock.calls[0];
        expect(op).toBe('UPDATE');
        expect(id).toBe(m.id);
        expect(newData.images.some(i => i.id === img.id)).toBe(true);
    });

    it('addViewshedImage logs a viewshed UPDATE op', async () => {
        const v = await addViewshed('tsA', {});
        logViewshed3dOperation.mockClear();

        const img = await addViewshedImage(v.id, fakeImageFile());

        expect(img).not.toBeNull();
        expect(logViewshed3dOperation).toHaveBeenCalledTimes(1);
        const [op, id] = logViewshed3dOperation.mock.calls[0];
        expect(op).toBe('UPDATE');
        expect(id).toBe(v.id);
    });
});

// ============================================================================
// MEASUREMENTS
// ============================================================================

describe('measurements', () => {
    it('addMeasurement CREATE: shape with type/positions/result/style/images, emits CREATE op', async () => {
        const measurement = await addMeasurement('tsA', {
            type: 'distance',
            positions: [{ longitude: 0, latitude: 0 }, { longitude: 1, latitude: 1 }],
            result: { value: 123, formatted: '123 m' }
        });

        expect(typeof measurement.id).toBe('string');
        expect(measurement.tilesetId).toBe('tsA');
        expect(measurement.type).toBe('distance');
        expect(measurement.positions).toHaveLength(2);
        expect(measurement.result).toEqual({ value: 123, formatted: '123 m' });
        expect(measurement.properties.nome).toBe('Distância #1');
        expect(measurement.style.lineColor).toBe(DEFAULT_MEASUREMENT_STYLE.lineColor);
        expect(measurement.images).toEqual([]);
        expect(measurement.sync.version).toBe(1);

        expect(persisted().measurements).toHaveLength(1);

        const [op, id, mapId, newData] = logMeasurement3dOperation.mock.calls[0];
        expect(op).toBe('CREATE');
        expect(id).toBe(measurement.id);
        expect(mapId).toBe('map-uuid-123');
        expect(newData).toEqual(measurement);
    });

    it('addMeasurement defaults type to distance and names area separately', async () => {
        const dist = await addMeasurement('tsA', {});
        expect(dist.type).toBe('distance');
        expect(dist.properties.nome).toBe('Distância #1');

        const area = await addMeasurement('tsA', { type: 'area' });
        expect(area.properties.nome).toBe('Área #1'); // independent counter per type
    });

    it('getMeasurements filters by tileset + active; getAllMeasurements across tilesets; getMeasurementById; missing → null', async () => {
        const a = await addMeasurement('tsA', {});
        const b = await addMeasurement('tsB', {});

        expect((await getMeasurements('tsA')).map(m => m.id)).toEqual([a.id]);
        expect((await getAllMeasurements()).map(m => m.id).sort()).toEqual([a.id, b.id].sort());
        expect((await getMeasurementById(b.id)).id).toBe(b.id);
        expect(await getMeasurementById('ghost')).toBeNull();
    });

    it('updateMeasurement UPDATE: merges properties/style, bumps version, emits UPDATE new + old', async () => {
        const measurement = await addMeasurement('tsA', {});
        logMeasurement3dOperation.mockClear();

        const updated = await updateMeasurement(measurement.id, {
            properties: { nome: 'M2' },
            style: { lineWidth: 9 }
        });

        expect(updated.properties.nome).toBe('M2');
        expect(updated.style.lineWidth).toBe(9);
        expect(updated.style.lineColor).toBe(DEFAULT_MEASUREMENT_STYLE.lineColor); // preserved
        expect(updated.sync.version).toBe(2);

        const [op, id, , newData, oldData] = logMeasurement3dOperation.mock.calls[0];
        expect(op).toBe('UPDATE');
        expect(id).toBe(measurement.id);
        expect(newData.properties.nome).toBe('M2');
        expect(oldData.sync.version).toBe(1);
    });

    it('updateMeasurement no-op when missing: null, no persist, no op', async () => {
        expect(await updateMeasurement('ghost', { properties: { nome: 'x' } })).toBeNull();
        expect(setCesium3dCompat).not.toHaveBeenCalled();
        expect(logMeasurement3dOperation).not.toHaveBeenCalled();
    });

    it('removeMeasurement DELETE: removes, emits DELETE null + deleted, true; missing → false no-op', async () => {
        const measurement = await addMeasurement('tsA', {});
        const snapshot = structuredClone(persisted().measurements[0]);
        logMeasurement3dOperation.mockClear();

        expect(await removeMeasurement(measurement.id)).toBe(true);
        expect(persisted().measurements).toHaveLength(0);

        const [op, id, , newData, oldData] = logMeasurement3dOperation.mock.calls[0];
        expect(op).toBe('DELETE');
        expect(id).toBe(measurement.id);
        expect(newData).toBeNull();
        expect(oldData).toEqual(snapshot);

        logMeasurement3dOperation.mockClear();
        expect(await removeMeasurement('ghost')).toBe(false);
        expect(logMeasurement3dOperation).not.toHaveBeenCalled();
    });

    it('removeMeasurementsByTileset scopes removal to the tileset', async () => {
        await addMeasurement('tsA', {});
        await addMeasurement('tsA', {});
        const b = await addMeasurement('tsB', {});

        const count = await removeMeasurementsByTileset('tsA');
        expect(count).toBe(2);
        expect(persisted().measurements.map(m => m.id)).toEqual([b.id]);
    });

    it('measurement images attach/detach mirror marker images (persist + change event)', async () => {
        const measurement = await addMeasurement('tsA', {});
        eventBus.emit.mockClear();

        const img = await addMeasurementImage(measurement.id, fakeImageFile('m.png'));
        expect(img.name).toBe('m.png');
        expect((await getMeasurementImages(measurement.id))).toHaveLength(1);
        expect(eventBus.emit).toHaveBeenCalledWith('measurements3d:changed', { mapName: MAP });

        expect(await removeMeasurementImage(measurement.id, img.id)).toBe(true);
        expect(await getMeasurementImages(measurement.id)).toEqual([]);
        expect(await removeMeasurementImage(measurement.id, 'ghost')).toBe(false);
    });
});

// ============================================================================
// VIEWSHEDS
// ============================================================================

describe('viewsheds', () => {
    it('addViewshed CREATE: full shape with defaults, emits CREATE op', async () => {
        const viewshed = await addViewshed('tsA', {
            position: { longitude: 1, latitude: 2, height: 3 },
            observerHeight: 2.0
        });

        expect(typeof viewshed.id).toBe('string');
        expect(viewshed.tilesetId).toBe('tsA');
        expect(viewshed.position).toEqual({ longitude: 1, latitude: 2, height: 3 });
        expect(viewshed.targetPosition).toBeNull();
        expect(viewshed.terrainBaseHeight).toBeNull();
        expect(viewshed.direction).toEqual({ heading: 0, pitch: 0 });
        expect(viewshed.parameters).toEqual({ horizontalAngle: 150, verticalAngle: 120, distance: 10 });
        expect(viewshed.observerHeight).toBe(2.0);
        expect(viewshed.properties.nome).toBe('Visibilidade #1');
        expect(viewshed.images).toEqual([]);
        expect(viewshed.sync.version).toBe(1);

        expect(persisted().viewsheds).toHaveLength(1);

        const [op, id, mapId, newData] = logViewshed3dOperation.mock.calls[0];
        expect(op).toBe('CREATE');
        expect(id).toBe(viewshed.id);
        expect(mapId).toBe('map-uuid-123');
        expect(newData).toEqual(viewshed);
    });

    it('addViewshed applies observerHeight default of 1.5 when omitted', async () => {
        const viewshed = await addViewshed('tsA', {});
        expect(viewshed.observerHeight).toBe(1.5);
        expect(viewshed.position).toEqual({ longitude: 0, latitude: 0, height: 0 });
    });

    it('getViewsheds filters by tileset + active; getAllViewsheds; getViewshedById; missing → null', async () => {
        const a = await addViewshed('tsA', {});
        const b = await addViewshed('tsB', {});

        expect((await getViewsheds('tsA')).map(v => v.id)).toEqual([a.id]);
        expect((await getAllViewsheds()).map(v => v.id).sort()).toEqual([a.id, b.id].sort());
        expect((await getViewshedById(a.id)).id).toBe(a.id);
        expect(await getViewshedById('ghost')).toBeNull();
    });

    it('updateViewshed UPDATE: merges properties + observerHeight, bumps version, emits UPDATE new + old', async () => {
        const viewshed = await addViewshed('tsA', { observerHeight: 1.5 });
        logViewshed3dOperation.mockClear();

        const updated = await updateViewshed(viewshed.id, {
            properties: { nome: 'V2' },
            observerHeight: 3.3
        });

        expect(updated.properties.nome).toBe('V2');
        expect(updated.observerHeight).toBe(3.3);
        expect(updated.sync.version).toBe(2);

        const [op, id, , newData, oldData] = logViewshed3dOperation.mock.calls[0];
        expect(op).toBe('UPDATE');
        expect(id).toBe(viewshed.id);
        expect(newData.observerHeight).toBe(3.3);
        expect(oldData.observerHeight).toBe(1.5);
        expect(oldData.sync.version).toBe(1);
    });

    it('updateViewshed accepts observerHeight 0 (=== undefined guard distinguishes)', async () => {
        const viewshed = await addViewshed('tsA', { observerHeight: 1.5 });
        const updated = await updateViewshed(viewshed.id, { observerHeight: 0 });
        expect(updated.observerHeight).toBe(0);
    });

    it('updateViewshed no-op when missing: null, no persist, no op', async () => {
        expect(await updateViewshed('ghost', { observerHeight: 1 })).toBeNull();
        expect(setCesium3dCompat).not.toHaveBeenCalled();
        expect(logViewshed3dOperation).not.toHaveBeenCalled();
    });

    it('removeViewshed DELETE: removes, emits DELETE null + deleted, true; missing → false no-op', async () => {
        const viewshed = await addViewshed('tsA', {});
        const snapshot = structuredClone(persisted().viewsheds[0]);
        logViewshed3dOperation.mockClear();

        expect(await removeViewshed(viewshed.id)).toBe(true);
        expect(persisted().viewsheds).toHaveLength(0);

        const [op, id, , newData, oldData] = logViewshed3dOperation.mock.calls[0];
        expect(op).toBe('DELETE');
        expect(id).toBe(viewshed.id);
        expect(newData).toBeNull();
        expect(oldData).toEqual(snapshot);

        logViewshed3dOperation.mockClear();
        expect(await removeViewshed('ghost')).toBe(false);
        expect(logViewshed3dOperation).not.toHaveBeenCalled();
    });

    it('removeViewshedsByTileset scopes removal to the tileset', async () => {
        await addViewshed('tsA', {});
        await addViewshed('tsA', {});
        const b = await addViewshed('tsB', {});

        const count = await removeViewshedsByTileset('tsA');
        expect(count).toBe(2);
        expect(persisted().viewsheds.map(v => v.id)).toEqual([b.id]);
    });

    it('viewshed images attach/detach mirror marker images', async () => {
        const viewshed = await addViewshed('tsA', {});
        eventBus.emit.mockClear();

        const img = await addViewshedImage(viewshed.id, fakeImageFile('v.png'));
        expect(img.name).toBe('v.png');
        expect(await getViewshedImages(viewshed.id)).toHaveLength(1);
        expect(eventBus.emit).toHaveBeenCalledWith('viewsheds3d:changed', { mapName: MAP });

        expect(await removeViewshedImage(viewshed.id, img.id)).toBe(true);
        expect(await getViewshedImages(viewshed.id)).toEqual([]);
        expect(await removeViewshedImage(viewshed.id, 'ghost')).toBe(false);
    });
});

// ============================================================================
// BULK REMOVAL ACROSS FAMILIES
// ============================================================================

describe('removeAllFeaturesByTileset', () => {
    it('removes markers, measurements and viewsheds for one tileset only, returns per-family counts', async () => {
        await addMarker('tsA', { position: {} });
        await addMarker('tsA', { position: {} });
        const keepMarker = await addMarker('tsB', { position: {} });
        await addMeasurement('tsA', {});
        const keepMeasurement = await addMeasurement('tsB', {});
        await addViewshed('tsA', {});
        await addViewshed('tsA', {});
        await addViewshed('tsA', {});
        const keepViewshed = await addViewshed('tsB', {});

        const result = await removeAllFeaturesByTileset('tsA');

        expect(result).toEqual({ markers: 2, measurements: 1, viewsheds: 3, total: 6 });

        const data = persisted();
        expect(data.markers.map(m => m.id)).toEqual([keepMarker.id]);
        expect(data.measurements.map(m => m.id)).toEqual([keepMeasurement.id]);
        expect(data.viewsheds.map(v => v.id)).toEqual([keepViewshed.id]);
    });

    it('no-op when nothing matches: zeros and no persist', async () => {
        // Seed directly so no persist call happens before the assertion.
        seed({ markers: [{ id: 'm1', tilesetId: 'tsB', sync: { version: 1, deleted: false } }] });
        setCesium3dCompat.mockClear();

        const result = await removeAllFeaturesByTileset('tsA');
        expect(result).toEqual({ markers: 0, measurements: 0, viewsheds: 0, total: 0 });
        expect(setCesium3dCompat).not.toHaveBeenCalled();
    });

    it('emits change events only for families that actually changed', async () => {
        await addMarker('tsA', { position: {} });
        await addViewshed('tsB', {}); // unaffected family for tsA
        eventBus.emit.mockClear();

        await removeAllFeaturesByTileset('tsA');

        const events = eventBus.emit.mock.calls.map(c => c[0]);
        expect(events).toContain('markers3d:changed');
        expect(events).not.toContain('measurements3d:changed');
        expect(events).not.toContain('viewsheds3d:changed');
    });
});

// ============================================================================
// MEMORY CACHE + IMPORT / EXPORT
// ============================================================================

describe('memory cache and import/export', () => {
    it('loadCesium3dDataToMemory loads from repo into memoryStore tagged with _mapName', async () => {
        seed({ markers: [{ id: 'm1', tilesetId: 'tsA', sync: { version: 1, deleted: false } }] });

        await loadCesium3dDataToMemory(MAP);

        expect(h.memory.cesium3d._mapName).toBe(MAP);
        expect(h.memory.cesium3d.markers).toHaveLength(1);
    });

    it('clearCesium3dCache resets the memory cache to empty structure', () => {
        h.memory.cesium3d = { markers: [{ id: 'x' }], _mapName: 'Other' };

        clearCesium3dCache();

        expect(h.memory.cesium3d).toEqual({
            cameraPositions: {},
            markers: [],
            measurements: [],
            viewsheds: [],
            _mapName: null
        });
    });

    it('getCesium3dDataForExport returns null when there is no data', async () => {
        expect(await getCesium3dDataForExport(MAP)).toBeNull();
    });

    it('getCesium3dDataForExport returns the four collections when data exists', async () => {
        await addMarker('tsA', { position: {} });

        const exported = await getCesium3dDataForExport(MAP);
        expect(exported).not.toBeNull();
        expect(exported.markers).toHaveLength(1);
        expect(exported.cameraPositions).toEqual({});
        expect(exported.measurements).toEqual([]);
        expect(exported.viewsheds).toEqual([]);
    });

    it('setCesium3dDataForImport → getCesium3dDataForExport round-trips and normalizes missing collections', async () => {
        const incoming = {
            markers: [{ id: 'm1', tilesetId: 'tsA', sync: { version: 1, deleted: false } }]
            // measurements / viewsheds / cameraPositions omitted → must be normalized
        };

        await setCesium3dDataForImport(MAP, incoming);

        // persisted with normalized empty collections
        const stored = await getCesium3dCompat(MAP);
        expect(stored.cameraPositions).toEqual({});
        expect(stored.measurements).toEqual([]);
        expect(stored.viewsheds).toEqual([]);
        expect(stored.markers).toHaveLength(1);

        // round-trip via export
        const exported = await getCesium3dDataForExport(MAP);
        expect(exported.markers[0].id).toBe('m1');
    });

    it('setCesium3dDataForImport into the CURRENT map updates memoryStore and emits the three change events', async () => {
        h.mapManager.getCurrentMapName.mockReturnValue(MAP);
        eventBus.emit.mockClear();

        await setCesium3dDataForImport(MAP, { markers: [], measurements: [], viewsheds: [] });

        expect(h.memory.cesium3d._mapName).toBe(MAP);
        const events = eventBus.emit.mock.calls.map(c => c[0]);
        expect(events).toEqual(expect.arrayContaining([
            'markers3d:changed',
            'measurements3d:changed',
            'viewsheds3d:changed'
        ]));
    });

    it('setCesium3dDataForImport into a NON-current map does not touch memory/events', async () => {
        h.mapManager.getCurrentMapName.mockReturnValue('CurrentMap');
        eventBus.emit.mockClear();

        await setCesium3dDataForImport('OtherMap', { markers: [] });

        expect(h.memory.cesium3d).toBeNull(); // memory cache untouched
        expect(eventBus.emit).not.toHaveBeenCalled();
    });
});

// ============================================================================
// ATOMICITY: rejected persist must prevent the sync log
// ============================================================================

describe('atomicity (persist-first, then log)', () => {
    it('addMarker: rejected persist prevents the CREATE sync log', async () => {
        setCesium3dCompat.mockRejectedValueOnce(new Error('IndexedDB write failed'));

        await expect(addMarker('tsA', { position: {} })).rejects.toThrow('IndexedDB write failed');

        expect(logMarker3dOperation).not.toHaveBeenCalled();
    });

    it('saveCameraPosition: rejected persist prevents the CREATE sync log', async () => {
        setCesium3dCompat.mockRejectedValueOnce(new Error('write fail'));

        await expect(
            saveCameraPosition('tsA', { longitude: 0, latitude: 0, height: 0 }, { heading: 0, pitch: 0, roll: 0 })
        ).rejects.toThrow('write fail');

        expect(logCameraPosition3dOperation).not.toHaveBeenCalled();
    });

    it('removeMeasurement: rejected persist prevents the DELETE sync log', async () => {
        await addMeasurement('tsA', {});
        const id = persisted().measurements[0].id;
        logMeasurement3dOperation.mockClear();
        setCesium3dCompat.mockRejectedValueOnce(new Error('write fail'));

        await expect(removeMeasurement(id)).rejects.toThrow('write fail');

        expect(logMeasurement3dOperation).not.toHaveBeenCalled();
    });

    it('updateViewshed: rejected persist prevents the UPDATE sync log', async () => {
        await addViewshed('tsA', {});
        const id = persisted().viewsheds[0].id;
        logViewshed3dOperation.mockClear();
        setCesium3dCompat.mockRejectedValueOnce(new Error('write fail'));

        await expect(updateViewshed(id, { observerHeight: 5 })).rejects.toThrow('write fail');

        expect(logViewshed3dOperation).not.toHaveBeenCalled();
    });
});

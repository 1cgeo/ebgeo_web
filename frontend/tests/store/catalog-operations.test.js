import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Hoisted shared state (available to vi.mock factories)
// ============================================================================

const h = vi.hoisted(() => {
    let uuidCounter = 0;
    return {
        mockMapData: { value: null },
        mockMapManager: {
            getCurrentMapName: vi.fn(() => 'TestMap'),
            getCurrentMapId: vi.fn(() => 'map-uuid-123')
        },
        // config object the source reads for validateCatalogLayerAvailability
        config: {
            map2d: { hillshade: { enabled: false } },
            analysisLayers: { enabled: false, layers: [] },
            dataLayers: { enabled: false, layers: [] },
            tilesets: []
        },
        // deterministic UUID generator
        generateUUID: vi.fn(() => `generated-uuid-${++uuidCounter}`),
        resetUuid: () => { uuidCounter = 0; },
        // Permission gate toggle (checkPermission is allow-all offline / local-only).
        permissionAllowed: true,
        permissionReason: 'Permissão insuficiente (teste)',
        // Map-lock toggle (isCurrentMapLockedSync).
        mapLocked: false,
        // sync metadata stubs (simple, deterministic)
        createSyncMetadata: vi.fn(() => ({ version: 1, dirty: true, stub: 'created' })),
        touchSyncMetadata: vi.fn((sync) => ({
            ...(sync || {}),
            version: (sync?.version ?? 0) + 1,
            dirty: true,
            stub: 'touched'
        }))
    };
});

// ============================================================================
// Mock dependencies (the source's import block tells us exactly what to mock)
// ============================================================================

vi.mock('../../src/js/store/repositories/index.js', () => ({
    getMapDataCompat: vi.fn(async () => h.mockMapData.value),
    updateMapDataCompat: vi.fn(async (mapName, data) => {
        h.mockMapData.value = data;
    })
}));

vi.mock('../../src/js/store/store-state-manager.js', () => ({
    default: h.mockMapManager
}));

vi.mock('../../src/js/store/sync/index.js', () => ({
    logCatalogLayerOperation: vi.fn(),
    OperationType: { CREATE: 'create', UPDATE: 'update', DELETE: 'delete' }
}));

vi.mock('../../src/js/store/sync/sync-metadata.js', () => ({
    createSyncMetadata: (...a) => h.createSyncMetadata(...a),
    touchSyncMetadata: (...a) => h.touchSyncMetadata(...a)
}));

vi.mock('../../src/js/utilities/uuid.js', () => ({
    generateUUID: (...a) => h.generateUUID(...a)
}));

vi.mock('../../src/js/config.js', () => ({
    default: h.config
}));

// Permission guard: drive allow/deny from hoisted state.
vi.mock('../../src/js/store/sync/permission-guard.js', () => ({
    checkPermission: vi.fn(() => (
        h.permissionAllowed
            ? { allowed: true }
            : { allowed: false, reason: h.permissionReason }
    )),
    GuardAction: {
        CREATE_LAYER: 'CREATE_LAYER',
        UPDATE_LAYER: 'UPDATE_LAYER',
        DELETE_LAYER: 'DELETE_LAYER'
    }
}));

// Map lock: only isCurrentMapLockedSync is consumed here.
vi.mock('../../src/js/store/map.operations.js', () => ({
    isCurrentMapLockedSync: vi.fn(() => h.mapLocked)
}));

// Store error emitter: just a spy.
vi.mock('../../src/js/store/store-errors.js', () => ({
    emitStoreError: vi.fn(),
    StoreErrorEvents: { STORE_OPERATION_BLOCKED: 'store:operationBlocked' }
}));

// ============================================================================
// Imports (after mocks)
// ============================================================================

import {
    getCatalogLayers,
    addCatalogLayer,
    removeCatalogLayer,
    updateCatalogLayer,
    toggleCatalogLayerVisibility,
    getCatalogLayerById,
    hasCatalogLayer,
    validateCatalogLayerAvailability,
    processCatalogLayersOnImport,
    updateCatalogLayerStatus,
    revalidateCatalogLayers
} from '../../src/js/store/catalog.operations.js';

import { CATALOG_ITEM_TYPES } from '../../src/js/catalog/catalog.constants.js';
import { getMapDataCompat, updateMapDataCompat } from '../../src/js/store/repositories/index.js';
import { logCatalogLayerOperation, OperationType } from '../../src/js/store/sync/index.js';
import { checkPermission } from '../../src/js/store/sync/permission-guard.js';
import { emitStoreError } from '../../src/js/store/store-errors.js';

// ============================================================================
// Helpers
// ============================================================================

function emptyMapData(catalogLayers) {
    const data = { features: {}, layers: [] };
    if (catalogLayers !== undefined) data.catalogLayers = catalogLayers;
    return data;
}

function makeLayer(id, type = CATALOG_ITEM_TYPES.HILLSHADE, extra = {}) {
    return {
        id,
        type,
        name: `Layer ${id}`,
        visible: true,
        opacity: 1,
        config: { id },
        ...extra
    };
}

// ============================================================================
// Setup
// ============================================================================

beforeEach(() => {
    vi.clearAllMocks();
    h.resetUuid();
    h.mockMapData.value = emptyMapData();
    h.mockMapManager.getCurrentMapName.mockReturnValue('TestMap');
    h.mockMapManager.getCurrentMapId.mockReturnValue('map-uuid-123');
    h.permissionAllowed = true;
    h.mapLocked = false;

    // reset config to "everything disabled / empty" defaults each test
    h.config.map2d = { hillshade: { enabled: false } };
    h.config.analysisLayers = { enabled: false, layers: [] };
    h.config.dataLayers = { enabled: false, layers: [] };
    h.config.tilesets = [];
});

// ============================================================================
// addCatalogLayer
// ============================================================================

describe('addCatalogLayer', () => {
    it('persists the layer and emits a CREATE op with the layer entity (incl. sync metadata)', async () => {
        const layer = makeLayer('cl-1');

        await addCatalogLayer(layer);

        expect(updateMapDataCompat).toHaveBeenCalledOnce();
        const [mapName, savedData] = updateMapDataCompat.mock.calls[0];
        expect(mapName).toBe('TestMap');
        expect(savedData.catalogLayers).toHaveLength(1);

        const stored = savedData.catalogLayers[0];
        expect(stored.id).toBe('cl-1');
        expect(stored.name).toBe('Layer cl-1');
        // sync metadata is stamped by createSyncMetadata
        expect(h.createSyncMetadata).toHaveBeenCalledWith(null);
        expect(stored.sync).toEqual({ version: 1, dirty: true, stub: 'created' });

        // CREATE op carries the full entity (with sync) as the new value
        expect(logCatalogLayerOperation).toHaveBeenCalledOnce();
        expect(logCatalogLayerOperation).toHaveBeenCalledWith(
            OperationType.CREATE,
            'cl-1',
            'map-uuid-123',
            expect.objectContaining({ id: 'cl-1', sync: expect.objectContaining({ stub: 'created' }) })
        );
    });

    it('initializes catalogLayers array when absent on the map', async () => {
        h.mockMapData.value = emptyMapData(); // no catalogLayers key

        await addCatalogLayer(makeLayer('cl-1'));

        const savedData = updateMapDataCompat.mock.calls[0][1];
        expect(Array.isArray(savedData.catalogLayers)).toBe(true);
        expect(savedData.catalogLayers).toHaveLength(1);
    });

    it('generates a UUID when the layer has no id', async () => {
        const layer = makeLayer('cl-1');
        delete layer.id;

        await addCatalogLayer(layer);

        const stored = updateMapDataCompat.mock.calls[0][1].catalogLayers[0];
        expect(stored.id).toBe('generated-uuid-1');
        expect(logCatalogLayerOperation).toHaveBeenCalledWith(
            OperationType.CREATE,
            'generated-uuid-1',
            'map-uuid-123',
            expect.any(Object)
        );
    });

    it('is idempotent: a duplicate id is not persisted again and emits no second op', async () => {
        h.mockMapData.value = emptyMapData([makeLayer('cl-1')]);

        await addCatalogLayer(makeLayer('cl-1'));

        expect(updateMapDataCompat).not.toHaveBeenCalled();
        expect(logCatalogLayerOperation).not.toHaveBeenCalled();
        // the existing layer is left untouched (no sync metadata stamped on it)
        expect(h.mockMapData.value.catalogLayers).toHaveLength(1);
    });

    it('targets an explicit map name when provided', async () => {
        await addCatalogLayer(makeLayer('cl-1'), 'OtherMap');

        expect(getMapDataCompat).toHaveBeenCalledWith('OtherMap');
        expect(updateMapDataCompat.mock.calls[0][0]).toBe('OtherMap');
        // current-map resolution is not consulted
        expect(h.mockMapManager.getCurrentMapName).not.toHaveBeenCalled();
    });
});

// ============================================================================
// removeCatalogLayer
// ============================================================================

describe('removeCatalogLayer', () => {
    it('removes the layer and emits DELETE carrying the removed layer as the "before"', async () => {
        const layer = makeLayer('cl-1');
        h.mockMapData.value = emptyMapData([layer, makeLayer('cl-2')]);

        await removeCatalogLayer('cl-1');

        expect(updateMapDataCompat).toHaveBeenCalledOnce();
        const savedData = updateMapDataCompat.mock.calls[0][1];
        expect(savedData.catalogLayers.map(l => l.id)).toEqual(['cl-2']);

        expect(logCatalogLayerOperation).toHaveBeenCalledWith(
            OperationType.DELETE,
            'cl-1',
            'map-uuid-123',
            null,
            expect.objectContaining({ id: 'cl-1' })
        );
    });

    it('no-ops (no persist, no op) when catalogLayers is absent', async () => {
        h.mockMapData.value = emptyMapData(); // no catalogLayers

        await removeCatalogLayer('cl-1');

        expect(updateMapDataCompat).not.toHaveBeenCalled();
        expect(logCatalogLayerOperation).not.toHaveBeenCalled();
    });

    it('persists but emits no op when the id is not present (nothing removed)', async () => {
        h.mockMapData.value = emptyMapData([makeLayer('cl-1')]);

        await removeCatalogLayer('does-not-exist');

        // The filter still runs and persists the (unchanged) array...
        expect(updateMapDataCompat).toHaveBeenCalledOnce();
        const savedData = updateMapDataCompat.mock.calls[0][1];
        expect(savedData.catalogLayers).toHaveLength(1);
        // ...but no DELETE op is emitted because no layer matched.
        expect(logCatalogLayerOperation).not.toHaveBeenCalled();
    });
});

// ============================================================================
// updateCatalogLayer
// ============================================================================

describe('updateCatalogLayer', () => {
    it('applies updates in place and emits UPDATE with new + old snapshots', async () => {
        const layer = makeLayer('cl-1', CATALOG_ITEM_TYPES.HILLSHADE, {
            opacity: 1,
            sync: { version: 5 }
        });
        h.mockMapData.value = emptyMapData([layer]);

        await updateCatalogLayer('cl-1', { opacity: 0.3, name: 'Renamed' });

        expect(updateMapDataCompat).toHaveBeenCalledOnce();
        const stored = updateMapDataCompat.mock.calls[0][1].catalogLayers[0];
        expect(stored.opacity).toBe(0.3);
        expect(stored.name).toBe('Renamed');

        expect(logCatalogLayerOperation).toHaveBeenCalledOnce();
        const [op, id, mapId, newVal, oldVal] = logCatalogLayerOperation.mock.calls[0];
        expect(op).toBe(OperationType.UPDATE);
        expect(id).toBe('cl-1');
        expect(mapId).toBe('map-uuid-123');
        // new value reflects the applied changes
        expect(newVal).toMatchObject({ id: 'cl-1', opacity: 0.3, name: 'Renamed' });
        // old value is the pre-update snapshot
        expect(oldVal).toMatchObject({ id: 'cl-1', opacity: 1, name: 'Layer cl-1' });
    });

    it('touches sync metadata when the layer carries it', async () => {
        const layer = makeLayer('cl-1', CATALOG_ITEM_TYPES.HILLSHADE, {
            sync: { version: 5, dirty: false }
        });
        h.mockMapData.value = emptyMapData([layer]);

        await updateCatalogLayer('cl-1', { opacity: 0.5 });

        expect(h.touchSyncMetadata).toHaveBeenCalledWith({ version: 5, dirty: false });
        const stored = updateMapDataCompat.mock.calls[0][1].catalogLayers[0];
        expect(stored.sync).toEqual({ version: 6, dirty: true, stub: 'touched' });
    });

    it('does not touch sync metadata when the layer has none', async () => {
        const layer = makeLayer('cl-1');
        delete layer.sync;
        h.mockMapData.value = emptyMapData([layer]);

        await updateCatalogLayer('cl-1', { opacity: 0.5 });

        expect(h.touchSyncMetadata).not.toHaveBeenCalled();
        expect(updateMapDataCompat.mock.calls[0][1].catalogLayers[0].sync).toBeUndefined();
    });

    it('no-ops (no persist, no op) when catalogLayers is absent', async () => {
        h.mockMapData.value = emptyMapData();

        await updateCatalogLayer('cl-1', { opacity: 0.5 });

        expect(updateMapDataCompat).not.toHaveBeenCalled();
        expect(logCatalogLayerOperation).not.toHaveBeenCalled();
    });

    it('no-ops (no persist, no op) when the target layer is absent', async () => {
        h.mockMapData.value = emptyMapData([makeLayer('cl-1')]);

        await updateCatalogLayer('cl-other', { opacity: 0.5 });

        expect(updateMapDataCompat).not.toHaveBeenCalled();
        expect(logCatalogLayerOperation).not.toHaveBeenCalled();
    });
});

// ============================================================================
// toggleCatalogLayerVisibility (delegates to updateCatalogLayer)
// ============================================================================

describe('toggleCatalogLayerVisibility', () => {
    it('delegates to updateCatalogLayer with { visible } and persists the new flag', async () => {
        const layer = makeLayer('cl-1', CATALOG_ITEM_TYPES.HILLSHADE, { visible: true, sync: { version: 1 } });
        h.mockMapData.value = emptyMapData([layer]);

        await toggleCatalogLayerVisibility('cl-1', false);

        const stored = updateMapDataCompat.mock.calls[0][1].catalogLayers[0];
        expect(stored.visible).toBe(false);
        // routed through the UPDATE path
        expect(logCatalogLayerOperation).toHaveBeenCalledWith(
            OperationType.UPDATE,
            'cl-1',
            'map-uuid-123',
            expect.objectContaining({ visible: false }),
            expect.objectContaining({ visible: true })
        );
    });

    it('passes the explicit map name through to updateCatalogLayer', async () => {
        const layer = makeLayer('cl-1');
        h.mockMapData.value = emptyMapData([layer]);

        await toggleCatalogLayerVisibility('cl-1', false, 'OtherMap');

        expect(getMapDataCompat).toHaveBeenCalledWith('OtherMap');
        expect(updateMapDataCompat.mock.calls[0][0]).toBe('OtherMap');
    });
});

// ============================================================================
// Read operations
// ============================================================================

describe('getCatalogLayers', () => {
    it('returns the catalog layers of the resolved map', async () => {
        h.mockMapData.value = emptyMapData([makeLayer('cl-1'), makeLayer('cl-2')]);

        const layers = await getCatalogLayers();

        expect(getMapDataCompat).toHaveBeenCalledWith('TestMap');
        expect(layers.map(l => l.id)).toEqual(['cl-1', 'cl-2']);
    });

    it('returns an empty array when the map has no catalogLayers', async () => {
        h.mockMapData.value = emptyMapData();

        expect(await getCatalogLayers()).toEqual([]);
    });
});

describe('getCatalogLayerById', () => {
    it('finds a layer by id', async () => {
        h.mockMapData.value = emptyMapData([makeLayer('cl-1'), makeLayer('cl-2')]);

        const found = await getCatalogLayerById('cl-2');
        expect(found).toMatchObject({ id: 'cl-2' });
    });

    it('returns null for a missing id', async () => {
        h.mockMapData.value = emptyMapData([makeLayer('cl-1')]);

        expect(await getCatalogLayerById('nope')).toBeNull();
    });
});

describe('hasCatalogLayer', () => {
    it('returns true when present and false when absent', async () => {
        h.mockMapData.value = emptyMapData([makeLayer('cl-1')]);

        expect(await hasCatalogLayer('cl-1')).toBe(true);
        expect(await hasCatalogLayer('cl-2')).toBe(false);
    });
});

// ============================================================================
// validateCatalogLayerAvailability — one assertion per branch
// ============================================================================

describe('validateCatalogLayerAvailability', () => {
    it('HILLSHADE → active only when config.map2d.hillshade.enabled === true', () => {
        const layer = makeLayer('hs', CATALOG_ITEM_TYPES.HILLSHADE);

        h.config.map2d.hillshade.enabled = false;
        expect(validateCatalogLayerAvailability(layer)).toBe('unavailable');

        h.config.map2d.hillshade.enabled = true;
        expect(validateCatalogLayerAvailability(layer)).toBe('active');
    });

    it('HILLSHADE → unavailable when map2d/hillshade config is missing', () => {
        h.config.map2d = undefined;
        expect(validateCatalogLayerAvailability(makeLayer('hs', CATALOG_ITEM_TYPES.HILLSHADE)))
            .toBe('unavailable');
    });

    it('ANALYSIS_LAYER → active when enabled and the layer id exists in config', () => {
        const layer = makeLayer('a1', CATALOG_ITEM_TYPES.ANALYSIS_LAYER);

        h.config.analysisLayers = { enabled: false, layers: [{ id: 'a1' }] };
        expect(validateCatalogLayerAvailability(layer)).toBe('unavailable'); // disabled

        h.config.analysisLayers = { enabled: true, layers: [{ id: 'other' }] };
        expect(validateCatalogLayerAvailability(layer)).toBe('unavailable'); // id absent

        h.config.analysisLayers = { enabled: true, layers: [{ id: 'a1' }] };
        expect(validateCatalogLayerAvailability(layer)).toBe('active');
    });

    it('ANALYSIS_LAYER → matches via originalId in preference to config.id', () => {
        const layer = makeLayer('local-id', CATALOG_ITEM_TYPES.ANALYSIS_LAYER, {
            originalId: 'real-id',
            config: { id: 'local-id' }
        });
        h.config.analysisLayers = { enabled: true, layers: [{ id: 'real-id' }] };

        expect(validateCatalogLayerAvailability(layer)).toBe('active');
    });

    it('DATA_LAYER → active when enabled and present in config.dataLayers', () => {
        const layer = makeLayer('d1', CATALOG_ITEM_TYPES.DATA_LAYER);

        h.config.dataLayers = { enabled: true, layers: [{ id: 'd1' }] };
        expect(validateCatalogLayerAvailability(layer)).toBe('active');

        h.config.dataLayers = { enabled: false, layers: [{ id: 'd1' }] };
        expect(validateCatalogLayerAvailability(layer)).toBe('unavailable');
    });

    it('MODEL_3D → unavailable when there are no tilesets', () => {
        h.config.tilesets = [];
        expect(validateCatalogLayerAvailability(makeLayer('m1', CATALOG_ITEM_TYPES.MODEL_3D)))
            .toBe('unavailable');

        h.config.tilesets = undefined;
        expect(validateCatalogLayerAvailability(makeLayer('m1', CATALOG_ITEM_TYPES.MODEL_3D)))
            .toBe('unavailable');
    });

    it('MODEL_3D → active when a matching tileset id exists', () => {
        const layer = makeLayer('m1', CATALOG_ITEM_TYPES.MODEL_3D);

        h.config.tilesets = [{ id: 'm1' }];
        expect(validateCatalogLayerAvailability(layer)).toBe('active');

        h.config.tilesets = [{ id: 'other' }];
        expect(validateCatalogLayerAvailability(layer)).toBe('unavailable');
    });

    it('MODEL_3D → matches via originalId', () => {
        const layer = makeLayer('local', CATALOG_ITEM_TYPES.MODEL_3D, {
            originalId: 'tileset-x',
            config: { id: 'local' }
        });
        h.config.tilesets = [{ id: 'tileset-x' }];

        expect(validateCatalogLayerAvailability(layer)).toBe('active');
    });

    it('unknown type → unavailable (default branch)', () => {
        expect(validateCatalogLayerAvailability(makeLayer('p', CATALOG_ITEM_TYPES.PANORAMIC_360)))
            .toBe('unavailable');
        expect(validateCatalogLayerAvailability(makeLayer('z', 'totally_unknown')))
            .toBe('unavailable');
    });
});

// ============================================================================
// processCatalogLayersOnImport
// ============================================================================

describe('processCatalogLayersOnImport', () => {
    it('stamps a status on each layer and counts the unavailable ones', () => {
        h.config.map2d.hillshade.enabled = true; // hillshade available
        h.config.tilesets = [];                  // model_3d unavailable

        const layers = [
            makeLayer('hs', CATALOG_ITEM_TYPES.HILLSHADE),
            makeLayer('m1', CATALOG_ITEM_TYPES.MODEL_3D)
        ];

        const { processed, unavailableCount } = processCatalogLayersOnImport(layers);

        expect(unavailableCount).toBe(1);
        expect(processed).toHaveLength(2);
        expect(processed.find(l => l.id === 'hs').status).toBe('active');
        expect(processed.find(l => l.id === 'm1').status).toBe('unavailable');
        // original objects are not mutated (spread copy)
        expect(layers[0].status).toBeUndefined();
    });

    it('returns the empty result for null / non-array input', () => {
        expect(processCatalogLayersOnImport(null)).toEqual({ processed: [], unavailableCount: 0 });
        expect(processCatalogLayersOnImport(undefined)).toEqual({ processed: [], unavailableCount: 0 });
        expect(processCatalogLayersOnImport('nope')).toEqual({ processed: [], unavailableCount: 0 });
    });

    it('counts every layer as unavailable when nothing is configured', () => {
        const { processed, unavailableCount } = processCatalogLayersOnImport([
            makeLayer('hs', CATALOG_ITEM_TYPES.HILLSHADE),
            makeLayer('a1', CATALOG_ITEM_TYPES.ANALYSIS_LAYER)
        ]);

        expect(unavailableCount).toBe(2);
        expect(processed.every(l => l.status === 'unavailable')).toBe(true);
    });
});

// ============================================================================
// updateCatalogLayerStatus (thin wrapper over updateCatalogLayer)
// ============================================================================

describe('updateCatalogLayerStatus', () => {
    it('routes a status change through updateCatalogLayer', async () => {
        const layer = makeLayer('cl-1', CATALOG_ITEM_TYPES.HILLSHADE, { status: 'unavailable', sync: { version: 1 } });
        h.mockMapData.value = emptyMapData([layer]);

        await updateCatalogLayerStatus('cl-1', 'active');

        const stored = updateMapDataCompat.mock.calls[0][1].catalogLayers[0];
        expect(stored.status).toBe('active');
        expect(logCatalogLayerOperation).toHaveBeenCalledWith(
            OperationType.UPDATE,
            'cl-1',
            'map-uuid-123',
            expect.objectContaining({ status: 'active' }),
            expect.objectContaining({ status: 'unavailable' })
        );
    });
});

// ============================================================================
// revalidateCatalogLayers
// ============================================================================

describe('revalidateCatalogLayers', () => {
    it('buckets reactivated vs stillUnavailable and writes once when statuses changed', async () => {
        // reactivated: was unavailable, now available (hillshade enabled)
        // stillUnavailable: model_3d with no tileset
        h.config.map2d.hillshade.enabled = true;
        h.config.tilesets = [];

        const reactivatable = makeLayer('hs', CATALOG_ITEM_TYPES.HILLSHADE, {
            status: 'unavailable',
            sync: { version: 2 }
        });
        const stuck = makeLayer('m1', CATALOG_ITEM_TYPES.MODEL_3D, { status: 'unavailable' });
        h.mockMapData.value = emptyMapData([reactivatable, stuck]);

        const result = await revalidateCatalogLayers();

        expect(result.reactivated).toEqual(['hs']);
        expect(result.stillUnavailable).toEqual(['m1']);

        // single write because at least one status changed
        expect(updateMapDataCompat).toHaveBeenCalledOnce();
        const saved = updateMapDataCompat.mock.calls[0][1].catalogLayers;
        expect(saved.find(l => l.id === 'hs').status).toBe('active');
        expect(saved.find(l => l.id === 'm1').status).toBe('unavailable');

        // sync metadata touched only for the changed layer
        expect(h.touchSyncMetadata).toHaveBeenCalledTimes(1);
        expect(saved.find(l => l.id === 'hs').sync).toEqual({ version: 3, dirty: true, stub: 'touched' });
    });

    it('does not write when no status changed', async () => {
        // hillshade already active and config keeps it active → no change
        h.config.map2d.hillshade.enabled = true;
        const layer = makeLayer('hs', CATALOG_ITEM_TYPES.HILLSHADE, { status: 'active', sync: { version: 1 } });
        h.mockMapData.value = emptyMapData([layer]);

        const result = await revalidateCatalogLayers();

        expect(updateMapDataCompat).not.toHaveBeenCalled();
        expect(h.touchSyncMetadata).not.toHaveBeenCalled();
        // reactivated stays empty (it was already active, not flipping from unavailable)
        expect(result.reactivated).toEqual([]);
        expect(result.stillUnavailable).toEqual([]);
    });

    it('reports a newly-unavailable layer under stillUnavailable and persists the flip', async () => {
        // was active, config now reports it unavailable → status flips, write happens
        h.config.map2d.hillshade.enabled = false;
        const layer = makeLayer('hs', CATALOG_ITEM_TYPES.HILLSHADE, { status: 'active', sync: { version: 4 } });
        h.mockMapData.value = emptyMapData([layer]);

        const result = await revalidateCatalogLayers();

        expect(result.reactivated).toEqual([]);
        expect(result.stillUnavailable).toEqual(['hs']);
        expect(updateMapDataCompat).toHaveBeenCalledOnce();
        expect(updateMapDataCompat.mock.calls[0][1].catalogLayers[0].status).toBe('unavailable');
    });

    it('handles an empty / absent catalogLayers list gracefully', async () => {
        h.mockMapData.value = emptyMapData();

        const result = await revalidateCatalogLayers();

        expect(result).toEqual({ reactivated: [], stillUnavailable: [] });
        expect(updateMapDataCompat).not.toHaveBeenCalled();
    });
});

// ============================================================================
// PERMISSION / MAP-LOCK GATE — a denied write must never persist NOR enqueue an op
// ============================================================================

describe('permission and map-lock gate on catalog writes', () => {
    /** Drives every write entry once (the two toggles delegate to updateCatalogLayer). */
    async function runAllWrites() {
        await addCatalogLayer(makeLayer('cl-new'));
        await updateCatalogLayer('cl-1', { opacity: 0.5 });
        await removeCatalogLayer('cl-1');
        await toggleCatalogLayerVisibility('cl-1', false);
        await updateCatalogLayerStatus('cl-1', 'unavailable');
    }

    it('permission denied: no persistence, no sync op, STORE_OPERATION_BLOCKED emitted', async () => {
        h.mockMapData.value = emptyMapData([makeLayer('cl-1')]);
        h.permissionAllowed = false;

        await runAllWrites();

        expect(updateMapDataCompat).not.toHaveBeenCalled();
        expect(logCatalogLayerOperation).not.toHaveBeenCalled();
        expect(emitStoreError).toHaveBeenCalledTimes(5);
        expect(emitStoreError.mock.calls.every(([type, payload]) => (
            type === 'store:operationBlocked' && payload.reason === h.permissionReason
        ))).toBe(true);
    });

    it('map locked: same blocking, with reason "map_locked"', async () => {
        h.mockMapData.value = emptyMapData([makeLayer('cl-1')]);
        h.permissionAllowed = true;
        h.mapLocked = true;

        await runAllWrites();

        expect(updateMapDataCompat).not.toHaveBeenCalled();
        expect(logCatalogLayerOperation).not.toHaveBeenCalled();
        expect(emitStoreError).toHaveBeenCalledTimes(5);
        expect(emitStoreError.mock.calls.every(([, payload]) => payload.reason === 'map_locked')).toBe(true);
    });

    it('gates through checkPermission (hierarchical), never a closed role list', async () => {
        h.mockMapData.value = emptyMapData([makeLayer('cl-1')]);
        h.permissionAllowed = false;

        await runAllWrites();

        const actions = [...new Set(checkPermission.mock.calls.map(([action]) => action))].sort();
        // CREATE/UPDATE/DELETE_LAYER resolve to canEdit/canDelete, so a co-Gestor
        // (manage) passes — which a closed `perm === 'write' || 'owner'` list would break.
        expect(actions).toEqual(['CREATE_LAYER', 'DELETE_LAYER', 'UPDATE_LAYER']);
        expect(checkPermission).toHaveBeenCalledTimes(5);
    });

    it('allowed + unlocked: the existing behavior is preserved (no false blocking)', async () => {
        h.mockMapData.value = emptyMapData([makeLayer('cl-1')]);

        await toggleCatalogLayerVisibility('cl-1', false);

        expect(updateMapDataCompat).toHaveBeenCalledTimes(1);
        expect(logCatalogLayerOperation).toHaveBeenCalledTimes(1);
        expect(logCatalogLayerOperation.mock.calls[0][0]).toBe(OperationType.UPDATE);
        expect(emitStoreError).not.toHaveBeenCalled();
    });

    it('revalidateCatalogLayers stays UNGATED (availability must refresh for everyone)', async () => {
        // Read-only users still need the "unavailable" badge to be accurate; this path
        // recomputes status and logs no op, so gating it would break the UI for them.
        h.mockMapData.value = emptyMapData([makeLayer('cl-1', CATALOG_ITEM_TYPES.HILLSHADE, { status: 'active' })]);
        h.permissionAllowed = false;
        h.mapLocked = true;

        const result = await revalidateCatalogLayers();

        expect(result.stillUnavailable).toEqual(['cl-1']);
        expect(updateMapDataCompat).toHaveBeenCalledTimes(1);
        expect(logCatalogLayerOperation).not.toHaveBeenCalled();
    });
});

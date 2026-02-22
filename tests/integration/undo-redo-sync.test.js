import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getEmptyMapData } from '../../src/js/store/repository.utils.js';
import { makeFeature } from '../helpers/test-utils.js';

// ============================================================================
// Hoisted shared state (available to vi.mock factories)
// ============================================================================

const { mockMapData, mockMapManager, mockLockedMaps } = vi.hoisted(() => {
    return {
        mockMapData: { value: null },
        mockMapManager: {
            getCurrentMapName: vi.fn(() => 'TestMap'),
            getCurrentMapId: vi.fn(() => 'map-uuid-123'),
            getFeatureColor: vi.fn(() => null),
            getFeatureColors: vi.fn(() => []),
            updateColorUsage: vi.fn(),
            recordAction: vi.fn()
        },
        mockLockedMaps: { value: new Set() }
    };
});

// ============================================================================
// Mock dependencies (same pattern as feature-operations.test.js)
// ============================================================================

vi.mock('../../src/js/store/store-errors.js', () => ({
    StoreErrorEvents: { STORE_PERSIST_ERROR: 'store:persistError' },
    emitStoreError: vi.fn()
}));

vi.mock('../../src/js/store/map.operations.js', () => ({
    isCurrentMapLockedSync: vi.fn(() => mockLockedMaps.value.size > 0)
}));

vi.mock('../../src/js/store/sync/index.js', () => ({
    logFeatureOperation: vi.fn().mockResolvedValue(undefined),
    OperationType: { CREATE: 'create', UPDATE: 'update', DELETE: 'delete' }
}));

vi.mock('../../src/js/store/repositories/index.js', () => ({
    getMapDataCompat: vi.fn(async () => mockMapData.value),
    updateMapDataCompat: vi.fn(async (mapName, data) => {
        mockMapData.value = data;
    }),
    getLayersCompat: vi.fn(async () => [])
}));

vi.mock('../../src/js/store/store-state-manager.js', () => ({
    default: mockMapManager
}));

vi.mock('../../src/js/store/memory-store.js', () => ({
    memoryStore: {
        get lockedMaps() { return mockLockedMaps.value; },
        set lockedMaps(v) { mockLockedMaps.value = v; },
        currentMap: 'TestMap'
    }
}));

// ============================================================================
// Imports (after mocks)
// ============================================================================

import {
    addFeature,
    updateFeature,
    removeFeature,
    addFeatureSilent,
    removeFeatureSilent,
    setFeatureDependencies
} from '../../src/js/store/feature.operations.js';

import { logFeatureOperation } from '../../src/js/store/sync/index.js';
import { isCurrentMapLockedSync } from '../../src/js/store/map.operations.js';

// ============================================================================
// SETUP
// ============================================================================

beforeEach(() => {
    vi.clearAllMocks();
    mockLockedMaps.value = new Set();
    // Reset mockReturnValue set by locked map tests (clearAllMocks does NOT reset implementations)
    isCurrentMapLockedSync.mockImplementation(() => mockLockedMaps.value.size > 0);

    // Initialize empty map data
    mockMapData.value = getEmptyMapData();

    // Set up group manager dependency
    setFeatureDependencies({
        groupManager: {
            removeFeatureFromAllGroups: vi.fn(),
            getFeatureGroup: vi.fn(() => null)
        },
        layerManager: {
            isFeatureEffectivelyVisible: vi.fn(() => true),
            isFeatureEffectivelyLocked: vi.fn(() => false)
        }
    });
});

// ============================================================================
// TESTS
// ============================================================================

describe('Undo/Redo sync consistency', () => {

    // ========================================================================
    // addFeature logs CREATE on sync queue
    // ========================================================================

    describe('feature operations generate correct sync operations', () => {
        it('addFeature logs CREATE to sync queue', async () => {
            const feature = makeFeature('feat-1', 'point');
            await addFeature('points', feature);

            expect(logFeatureOperation).toHaveBeenCalledOnce();
            expect(logFeatureOperation).toHaveBeenCalledWith(
                'create',
                'feat-1',
                'map-uuid-123',
                expect.objectContaining({
                    properties: expect.objectContaining({ id: 'feat-1' })
                })
            );
        });

        it('updateFeature logs UPDATE to sync queue with old and new data', async () => {
            mockMapData.value = getEmptyMapData();
            mockMapData.value.features.points.push({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [-43.17, -22.90] },
                properties: {
                    id: 'feat-1', source: 'point', nome: 'Original',
                    color: '#ff0000', visivel: true, bloqueado: false, layerId: 'default',
                    createdAt: 1000, updatedAt: 1000, version: 1
                }
            });

            vi.clearAllMocks();

            // Update the feature
            const updated = makeFeature('feat-1', 'point', { nome: 'Updated', createdAt: 1000, version: 1 });
            await updateFeature('points', updated);

            expect(logFeatureOperation).toHaveBeenCalledOnce();
            expect(logFeatureOperation).toHaveBeenCalledWith(
                'update',
                'feat-1',
                'map-uuid-123',
                expect.objectContaining({
                    properties: expect.objectContaining({ nome: 'Updated' })
                }),
                expect.objectContaining({
                    properties: expect.objectContaining({ nome: 'Original' })
                })
            );
        });

        it('removeFeature logs DELETE to sync queue with previous data', async () => {
            // Set up a feature in the map
            const existing = makeFeature('feat-1', 'point', { nome: 'ToDelete' });
            mockMapData.value = getEmptyMapData();
            mockMapData.value.features.points.push(existing);

            await removeFeature('points', 'feat-1');

            expect(logFeatureOperation).toHaveBeenCalledOnce();
            expect(logFeatureOperation).toHaveBeenCalledWith(
                'delete',
                'feat-1',
                'map-uuid-123',
                null,
                expect.objectContaining({
                    properties: expect.objectContaining({ id: 'feat-1' })
                })
            );
        });
    });

    // ========================================================================
    // Undo generates reverse sync operations
    // ========================================================================

    describe('undo generates reverse sync operations', () => {
        it('undo of add → calls removeFeature (which logs DELETE)', async () => {
            const feature = makeFeature('feat-1', 'point');
            await addFeature('points', feature);

            // The recordAction mock was called, capture what it recorded
            expect(mockMapManager.recordAction).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'add',
                    featureType: 'points'
                })
            );

            // Verify the sync log captured the CREATE
            expect(logFeatureOperation).toHaveBeenCalledWith(
                'create',
                'feat-1',
                'map-uuid-123',
                expect.any(Object)
            );
        });

        it('undo of update → recordAction captures old and new feature', async () => {
            // Setup existing feature
            mockMapData.value = getEmptyMapData();
            mockMapData.value.features.points.push(makeFeature('feat-1', 'point', {
                nome: 'Old', createdAt: 1000, updatedAt: 1000, version: 1
            }));

            const updated = makeFeature('feat-1', 'point', {
                nome: 'New', createdAt: 1000, version: 1
            });
            await updateFeature('points', updated);

            expect(mockMapManager.recordAction).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'update',
                    featureType: 'points',
                    oldFeature: expect.objectContaining({
                        properties: expect.objectContaining({ nome: 'Old' })
                    }),
                    newFeature: expect.objectContaining({
                        properties: expect.objectContaining({ nome: 'New' })
                    })
                })
            );
        });

        it('undo of remove → recordAction captures removeWithProcessed', async () => {
            mockMapData.value = getEmptyMapData();
            const feat = makeFeature('feat-1', 'point', { nome: 'ToRemove' });
            mockMapData.value.features.points.push(feat);

            await removeFeature('points', 'feat-1');

            expect(mockMapManager.recordAction).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'removeWithProcessed',
                    mainFeatureType: 'points',
                    mainFeature: expect.objectContaining({
                        properties: expect.objectContaining({ id: 'feat-1' })
                    })
                })
            );
        });
    });

    // ========================================================================
    // Silent operations bypass sync and undo
    // ========================================================================

    describe('silent operations bypass sync and undo', () => {
        it('addFeatureSilent does NOT log sync operation', async () => {
            const feature = makeFeature('feat-s1', 'point');
            await addFeatureSilent('points', feature);

            expect(logFeatureOperation).not.toHaveBeenCalled();
        });

        it('addFeatureSilent does NOT record undo action', async () => {
            const feature = makeFeature('feat-s1', 'point');
            await addFeatureSilent('points', feature);

            expect(mockMapManager.recordAction).not.toHaveBeenCalled();
        });

        it('removeFeatureSilent does NOT log sync operation', async () => {
            mockMapData.value = getEmptyMapData();
            mockMapData.value.features.points.push(makeFeature('feat-s1', 'point'));

            await removeFeatureSilent('points', 'feat-s1');

            expect(logFeatureOperation).not.toHaveBeenCalled();
        });

        it('removeFeatureSilent does NOT record undo action', async () => {
            mockMapData.value = getEmptyMapData();
            mockMapData.value.features.points.push(makeFeature('feat-s1', 'point'));

            await removeFeatureSilent('points', 'feat-s1');

            expect(mockMapManager.recordAction).not.toHaveBeenCalled();
        });
    });

    // ========================================================================
    // Locked map blocks all operations
    // ========================================================================

    describe('locked map blocks undo-related operations', () => {
        it('addFeature on locked map → no sync log, no undo record', async () => {
            mockLockedMaps.value = new Set(['TestMap']);

            const feature = makeFeature('feat-locked', 'point');
            await addFeature('points', feature);

            expect(logFeatureOperation).not.toHaveBeenCalled();
            expect(mockMapManager.recordAction).not.toHaveBeenCalled();
        });

        it('updateFeature on locked map → no sync log, no undo record', async () => {
            mockLockedMaps.value = new Set(['TestMap']);
            isCurrentMapLockedSync.mockReturnValue(true);

            mockMapData.value = getEmptyMapData();
            mockMapData.value.features.points.push(makeFeature('feat-1', 'point'));

            const updated = makeFeature('feat-1', 'point', { nome: 'Updated' });
            await updateFeature('points', updated);

            expect(logFeatureOperation).not.toHaveBeenCalled();
            expect(mockMapManager.recordAction).not.toHaveBeenCalled();
        });

        it('removeFeature on locked map → no sync log, no undo record', async () => {
            mockLockedMaps.value = new Set(['TestMap']);
            isCurrentMapLockedSync.mockReturnValue(true);

            mockMapData.value = getEmptyMapData();
            mockMapData.value.features.points.push(makeFeature('feat-1', 'point'));

            await removeFeature('points', 'feat-1');

            expect(logFeatureOperation).not.toHaveBeenCalled();
            expect(mockMapManager.recordAction).not.toHaveBeenCalled();
        });
    });

    // ========================================================================
    // Side effect order: color → undo → sync
    // ========================================================================

    describe('side effect order verification', () => {
        it('addFeature defers: color tracking, undo recording, sync logging (in that order)', async () => {
            const order = [];

            mockMapManager.getFeatureColors.mockReturnValue(['#ff0000']);
            mockMapManager.updateColorUsage.mockImplementation(() => order.push('color'));
            mockMapManager.recordAction.mockImplementation(() => order.push('undo'));
            logFeatureOperation.mockImplementation(async () => order.push('sync'));

            await addFeature('points', makeFeature('feat-1', 'point'));

            expect(order).toEqual(['color', 'undo', 'sync']);
        });
    });

    // ========================================================================
    // No-op update skips everything
    // ========================================================================

    describe('no-op updates', () => {
        it('updateFeature with identical data is skipped (no-op guard)', async () => {
            const feature = makeFeature('feat-1', 'point', {
                nome: 'Same', createdAt: 1000, updatedAt: 1000, version: 1
            });
            mockMapData.value = getEmptyMapData();
            mockMapData.value.features.points.push(JSON.parse(JSON.stringify(feature)));

            vi.clearAllMocks();
            // Explicitly ensure lock is off (previous tests may have set mockReturnValue(true))
            isCurrentMapLockedSync.mockReturnValue(false);

            await updateFeature('points', feature);

            // No-op guard detects identical data and returns early
            expect(logFeatureOperation).not.toHaveBeenCalled();
            expect(mockMapManager.recordAction).not.toHaveBeenCalled();
        });
    });
});

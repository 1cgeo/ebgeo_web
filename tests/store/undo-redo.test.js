import { describe, it, expect, beforeEach, vi } from 'vitest';
import { memoryStore, resetMemoryStore } from '../../src/js/store/memory-store.js';

// Mock heavy dependencies that MapManager imports
vi.mock('../../src/js/store/repositories/index.js', () => ({
    setSettingCompat: vi.fn(),
    getSettingCompat: vi.fn().mockResolvedValue(null),
    getColorUsageCompat: vi.fn().mockResolvedValue({}),
    setColorUsageCompat: vi.fn(),
    removeColorUsageCompat: vi.fn(),
    getAllMapKeysCompat: vi.fn().mockResolvedValue([]),
    getMapDataCompat: vi.fn().mockResolvedValue({ features: {} })
}));

vi.mock('../../src/js/store/services.js', () => ({
    getGroupManager: () => ({
        loadGroupsToMemory: vi.fn().mockResolvedValue(undefined),
        clearMapGroups: vi.fn().mockResolvedValue(undefined)
    })
}));

vi.mock('../../src/js/store/sync/index.js', () => ({
    logOperation: vi.fn(),
    EntityType: { SETTING: 'setting' },
    OperationType: { UPDATE: 'update' },
    sessionContext: {
        getUserId: vi.fn(() => 'test-user-id'),
        _reset: vi.fn()
    }
}));

// Import after mocks
const { default: mapManager } = await import('../../src/js/store/store-state-manager.js');
const { sessionContext } = await import('../../src/js/store/sync/index.js');

// Helper to get the undo/redo stacks for the test user
const TEST_USER = 'test-user-id';
function getUndoStack(mapName = 'Principal') {
    return memoryStore.maps[mapName]?.undoStacks?.[TEST_USER] || [];
}
function getRedoStack(mapName = 'Principal') {
    return memoryStore.maps[mapName]?.redoStacks?.[TEST_USER] || [];
}

beforeEach(() => {
    resetMemoryStore();
    // Ensure current map has stacks
    memoryStore.maps['Principal'] = { undoStacks: {}, redoStacks: {} };
    memoryStore.currentMap = 'Principal';
    memoryStore.isUndoing = false;
    memoryStore.isRedoing = false;
    memoryStore.batchCollector = null;
    // Reset sessionContext mock
    sessionContext.getUserId.mockReturnValue(TEST_USER);
});

// ============================================================================
// Helper: mock executeFunction
// ============================================================================

function createMockExecuteFn() {
    return {
        addFeature: vi.fn().mockResolvedValue(undefined),
        updateFeature: vi.fn().mockResolvedValue(undefined),
        removeFeature: vi.fn().mockResolvedValue(undefined),
        addFeatureToMap: vi.fn().mockResolvedValue(undefined),
        removeFeatureFromMap: vi.fn().mockResolvedValue(undefined)
    };
}

function mockFeature(id, name = 'Test') {
    return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
        properties: { id, nome: name, source: 'point', color: '#ff0000' }
    };
}

// ============================================================================
// recordAction
// ============================================================================

describe('recordAction', () => {
    it('pushes action to undoStack for current user', () => {
        const action = { type: 'add', featureType: 'points', feature: mockFeature('f1') };
        mapManager.recordAction(action);
        expect(getUndoStack()).toHaveLength(1);
        expect(getUndoStack()[0]).toBe(action);
    });

    it('clears redoStack on new action', () => {
        // Manually add to redo
        memoryStore.maps['Principal'].redoStacks[TEST_USER] = [{ type: 'add' }];
        mapManager.recordAction({ type: 'add', featureType: 'points', feature: mockFeature('f1') });
        expect(getRedoStack()).toHaveLength(0);
    });

    it('does NOT record during undo', () => {
        memoryStore.isUndoing = true;
        mapManager.recordAction({ type: 'add', featureType: 'points', feature: mockFeature('f1') });
        expect(getUndoStack()).toHaveLength(0);
    });

    it('does NOT record during redo', () => {
        memoryStore.isRedoing = true;
        mapManager.recordAction({ type: 'add', featureType: 'points', feature: mockFeature('f1') });
        expect(getUndoStack()).toHaveLength(0);
    });

    it('enforces MAX_UNDO_HISTORY (20 actions)', () => {
        for (let i = 0; i < 25; i++) {
            mapManager.recordAction({ type: 'add', featureType: 'points', feature: mockFeature(`f${i}`) });
        }
        expect(getUndoStack()).toHaveLength(20);
        // First 5 should have been evicted, oldest remaining should be f5
        expect(getUndoStack()[0].feature.properties.id).toBe('f5');
    });

    it('collects into batchCollector when active', () => {
        mapManager.startBatchCollection();
        const action = { type: 'add', featureType: 'points', feature: mockFeature('f1') };
        mapManager.recordAction(action);
        // Not in undoStack
        expect(getUndoStack()).toHaveLength(0);
        // In batchCollector
        expect(memoryStore.batchCollector).toHaveLength(1);
    });
});

// ============================================================================
// Undo
// ============================================================================

describe('undoLastAction', () => {
    it('calls removeFeature for undo of add', async () => {
        const executeFn = createMockExecuteFn();
        const feature = mockFeature('f1');
        mapManager.recordAction({ type: 'add', featureType: 'points', feature });

        const result = await mapManager.undoLastAction(executeFn);

        expect(executeFn.removeFeature).toHaveBeenCalledWith('points', 'f1');
        expect(result.type).toBe('add');
    });

    it('calls addFeature for undo of remove', async () => {
        const executeFn = createMockExecuteFn();
        const feature = mockFeature('f1');
        mapManager.recordAction({ type: 'remove', featureType: 'points', feature });

        await mapManager.undoLastAction(executeFn);

        expect(executeFn.addFeature).toHaveBeenCalledWith('points', feature);
    });

    it('calls updateFeature with oldFeature for undo of update', async () => {
        const executeFn = createMockExecuteFn();
        const oldFeature = mockFeature('f1', 'Old');
        const newFeature = mockFeature('f1', 'New');
        mapManager.recordAction({
            type: 'update', featureType: 'points',
            oldFeature, newFeature
        });

        await mapManager.undoLastAction(executeFn);

        expect(executeFn.updateFeature).toHaveBeenCalledWith('points', oldFeature);
    });

    it('moves action to redoStack on success', async () => {
        const executeFn = createMockExecuteFn();
        mapManager.recordAction({ type: 'add', featureType: 'points', feature: mockFeature('f1') });

        await mapManager.undoLastAction(executeFn);

        expect(getUndoStack()).toHaveLength(0);
        expect(getRedoStack()).toHaveLength(1);
    });

    it('returns false when undoStack is empty', async () => {
        const executeFn = createMockExecuteFn();
        const result = await mapManager.undoLastAction(executeFn);
        expect(result).toBe(false);
    });

    it('restores action to undoStack on failure', async () => {
        const executeFn = createMockExecuteFn();
        executeFn.removeFeature.mockRejectedValue(new Error('DB failure'));
        mapManager.recordAction({ type: 'add', featureType: 'points', feature: mockFeature('f1') });

        await expect(mapManager.undoLastAction(executeFn)).rejects.toThrow('DB failure');

        // Action should be back on undoStack
        expect(getUndoStack()).toHaveLength(1);
        expect(getRedoStack()).toHaveLength(0);
    });

    it('sets isUndoing during execution and resets after', async () => {
        const executeFn = createMockExecuteFn();
        let wasUndoingDuringCall = false;
        executeFn.removeFeature.mockImplementation(async () => {
            wasUndoingDuringCall = memoryStore.isUndoing;
        });
        mapManager.recordAction({ type: 'add', featureType: 'points', feature: mockFeature('f1') });

        await mapManager.undoLastAction(executeFn);

        expect(wasUndoingDuringCall).toBe(true);
        expect(memoryStore.isUndoing).toBe(false);
    });

    it('resets isUndoing even on failure', async () => {
        const executeFn = createMockExecuteFn();
        executeFn.removeFeature.mockRejectedValue(new Error('fail'));
        mapManager.recordAction({ type: 'add', featureType: 'points', feature: mockFeature('f1') });

        try { await mapManager.undoLastAction(executeFn); } catch (_) {}

        expect(memoryStore.isUndoing).toBe(false);
    });
});

// ============================================================================
// Redo
// ============================================================================

describe('redoLastAction', () => {
    it('calls addFeature for redo of add', async () => {
        const executeFn = createMockExecuteFn();
        const feature = mockFeature('f1');
        mapManager.recordAction({ type: 'add', featureType: 'points', feature });
        await mapManager.undoLastAction(executeFn);

        vi.clearAllMocks();
        sessionContext.getUserId.mockReturnValue(TEST_USER);
        await mapManager.redoLastAction(executeFn);

        expect(executeFn.addFeature).toHaveBeenCalledWith('points', feature);
    });

    it('calls removeFeature for redo of remove', async () => {
        const executeFn = createMockExecuteFn();
        const feature = mockFeature('f1');
        mapManager.recordAction({ type: 'remove', featureType: 'points', feature });
        await mapManager.undoLastAction(executeFn);

        vi.clearAllMocks();
        sessionContext.getUserId.mockReturnValue(TEST_USER);
        await mapManager.redoLastAction(executeFn);

        expect(executeFn.removeFeature).toHaveBeenCalledWith('points', 'f1');
    });

    it('calls updateFeature with newFeature for redo of update', async () => {
        const executeFn = createMockExecuteFn();
        const oldFeature = mockFeature('f1', 'Old');
        const newFeature = mockFeature('f1', 'New');
        mapManager.recordAction({
            type: 'update', featureType: 'points',
            oldFeature, newFeature
        });
        await mapManager.undoLastAction(executeFn);

        vi.clearAllMocks();
        sessionContext.getUserId.mockReturnValue(TEST_USER);
        await mapManager.redoLastAction(executeFn);

        expect(executeFn.updateFeature).toHaveBeenCalledWith('points', newFeature);
    });

    it('moves action back to undoStack on success', async () => {
        const executeFn = createMockExecuteFn();
        mapManager.recordAction({ type: 'add', featureType: 'points', feature: mockFeature('f1') });
        await mapManager.undoLastAction(executeFn);

        await mapManager.redoLastAction(executeFn);

        expect(getUndoStack()).toHaveLength(1);
        expect(getRedoStack()).toHaveLength(0);
    });

    it('returns false when redoStack is empty', async () => {
        const executeFn = createMockExecuteFn();
        const result = await mapManager.redoLastAction(executeFn);
        expect(result).toBe(false);
    });

    it('restores action to redoStack on failure', async () => {
        const executeFn = createMockExecuteFn();
        mapManager.recordAction({ type: 'add', featureType: 'points', feature: mockFeature('f1') });
        await mapManager.undoLastAction(executeFn);

        executeFn.addFeature.mockRejectedValue(new Error('DB failure'));
        await expect(mapManager.redoLastAction(executeFn)).rejects.toThrow('DB failure');

        // Action should be back on redoStack
        expect(getRedoStack()).toHaveLength(1);
        expect(getUndoStack()).toHaveLength(0);
    });
});

// ============================================================================
// Undo/Redo cycle integrity
// ============================================================================

describe('Undo/Redo cycle integrity', () => {
    it('undo → redo → undo works correctly', async () => {
        const executeFn = createMockExecuteFn();
        mapManager.recordAction({ type: 'add', featureType: 'points', feature: mockFeature('f1') });

        await mapManager.undoLastAction(executeFn);
        expect(getUndoStack()).toHaveLength(0);
        expect(getRedoStack()).toHaveLength(1);

        await mapManager.redoLastAction(executeFn);
        expect(getUndoStack()).toHaveLength(1);
        expect(getRedoStack()).toHaveLength(0);

        await mapManager.undoLastAction(executeFn);
        expect(getUndoStack()).toHaveLength(0);
        expect(getRedoStack()).toHaveLength(1);
    });

    it('new action after undo clears redo stack (fork)', async () => {
        const executeFn = createMockExecuteFn();
        mapManager.recordAction({ type: 'add', featureType: 'points', feature: mockFeature('f1') });
        mapManager.recordAction({ type: 'add', featureType: 'points', feature: mockFeature('f2') });

        // Undo last
        await mapManager.undoLastAction(executeFn);
        expect(getRedoStack()).toHaveLength(1);

        // New action — should fork
        mapManager.recordAction({ type: 'add', featureType: 'points', feature: mockFeature('f3') });
        expect(getRedoStack()).toHaveLength(0);
        expect(getUndoStack()).toHaveLength(2);
    });

    it('multiple undo then multiple redo', async () => {
        const executeFn = createMockExecuteFn();
        mapManager.recordAction({ type: 'add', featureType: 'points', feature: mockFeature('f1') });
        mapManager.recordAction({ type: 'add', featureType: 'points', feature: mockFeature('f2') });
        mapManager.recordAction({ type: 'add', featureType: 'points', feature: mockFeature('f3') });

        // Undo all 3
        await mapManager.undoLastAction(executeFn);
        await mapManager.undoLastAction(executeFn);
        await mapManager.undoLastAction(executeFn);
        expect(getUndoStack()).toHaveLength(0);
        expect(getRedoStack()).toHaveLength(3);

        // Redo all 3
        await mapManager.redoLastAction(executeFn);
        await mapManager.redoLastAction(executeFn);
        await mapManager.redoLastAction(executeFn);
        expect(getUndoStack()).toHaveLength(3);
        expect(getRedoStack()).toHaveLength(0);
    });
});

// ============================================================================
// Batch operations
// ============================================================================

describe('Batch undo/redo', () => {
    it('startBatchCollection + commitBatchCollection creates single undo entry', () => {
        mapManager.startBatchCollection();
        mapManager.recordAction({ type: 'add', featureType: 'points', feature: mockFeature('f1') });
        mapManager.recordAction({ type: 'add', featureType: 'points', feature: mockFeature('f2') });
        mapManager.recordAction({ type: 'add', featureType: 'points', feature: mockFeature('f3') });
        mapManager.commitBatchCollection();

        // Should be 1 batch entry, not 3
        expect(getUndoStack()).toHaveLength(1);
        expect(getUndoStack()[0].type).toBe('batch');
        expect(getUndoStack()[0].operations).toHaveLength(3);
    });

    it('single action batch commits directly (no wrapper)', () => {
        mapManager.startBatchCollection();
        mapManager.recordAction({ type: 'add', featureType: 'points', feature: mockFeature('f1') });
        mapManager.commitBatchCollection();

        expect(getUndoStack()).toHaveLength(1);
        expect(getUndoStack()[0].type).toBe('add'); // No batch wrapper
    });

    it('discardBatchCollection drops collected actions', () => {
        mapManager.startBatchCollection();
        mapManager.recordAction({ type: 'add', featureType: 'points', feature: mockFeature('f1') });
        mapManager.recordAction({ type: 'add', featureType: 'points', feature: mockFeature('f2') });
        mapManager.discardBatchCollection();

        expect(getUndoStack()).toHaveLength(0);
        expect(memoryStore.batchCollector).toBeNull();
    });

    it('undo of batch calls operations in reverse order', async () => {
        const executeFn = createMockExecuteFn();
        const order = [];
        executeFn.removeFeature.mockImplementation(async (type, id) => {
            order.push(id);
        });

        mapManager.startBatchCollection();
        mapManager.recordAction({ type: 'add', featureType: 'points', feature: mockFeature('f1') });
        mapManager.recordAction({ type: 'add', featureType: 'points', feature: mockFeature('f2') });
        mapManager.recordAction({ type: 'add', featureType: 'points', feature: mockFeature('f3') });
        mapManager.commitBatchCollection();

        await mapManager.undoLastAction(executeFn);

        // Batch undo executes in reverse: f3, f2, f1
        expect(order).toEqual(['f3', 'f2', 'f1']);
    });

    it('redo of batch calls operations in original order', async () => {
        const executeFn = createMockExecuteFn();
        mapManager.startBatchCollection();
        mapManager.recordAction({ type: 'add', featureType: 'points', feature: mockFeature('f1') });
        mapManager.recordAction({ type: 'add', featureType: 'points', feature: mockFeature('f2') });
        mapManager.commitBatchCollection();

        await mapManager.undoLastAction(executeFn);

        const order = [];
        executeFn.addFeature.mockImplementation(async (type, feature) => {
            order.push(feature.properties.id);
        });

        await mapManager.redoLastAction(executeFn);

        // Batch redo executes in original order: f1, f2
        expect(order).toEqual(['f1', 'f2']);
    });
});

// ============================================================================
// canUndo / canRedo
// ============================================================================

describe('canUndo / canRedo', () => {
    it('canUndo returns false on empty stack', () => {
        expect(mapManager.canUndo()).toBe(false);
    });

    it('canUndo returns true with actions', () => {
        mapManager.recordAction({ type: 'add', featureType: 'points', feature: mockFeature('f1') });
        expect(mapManager.canUndo()).toBe(true);
    });

    it('canRedo returns false on empty stack', () => {
        expect(mapManager.canRedo()).toBe(false);
    });

    it('canRedo returns true after undo', async () => {
        const executeFn = createMockExecuteFn();
        mapManager.recordAction({ type: 'add', featureType: 'points', feature: mockFeature('f1') });
        await mapManager.undoLastAction(executeFn);
        expect(mapManager.canRedo()).toBe(true);
    });
});

// ============================================================================
// clearHistory
// ============================================================================

describe('clearHistory', () => {
    it('clears all user stacks for current map', () => {
        mapManager.recordAction({ type: 'add', featureType: 'points', feature: mockFeature('f1') });
        mapManager.clearHistory();
        expect(getUndoStack()).toHaveLength(0);
        expect(getRedoStack()).toHaveLength(0);
    });

    it('clears stacks for specific map', () => {
        memoryStore.maps['MapB'] = { undoStacks: { [TEST_USER]: [{ type: 'add' }] }, redoStacks: {} };
        mapManager.clearHistory('MapB');
        expect(memoryStore.maps['MapB'].undoStacks).toEqual({});
    });
});

// ============================================================================
// Map memory management
// ============================================================================

describe('Map memory management', () => {
    it('addMapToMemory creates undo/redo stacks', () => {
        mapManager.addMapToMemory('NewMap');
        expect(memoryStore.maps['NewMap']).toEqual({
            undoStacks: {},
            redoStacks: {}
        });
    });

    it('renameMapInMemory transfers stacks', () => {
        mapManager.recordAction({ type: 'add', featureType: 'points', feature: mockFeature('f1') });
        mapManager.renameMapInMemory('Principal', 'Renamed');

        expect(getUndoStack('Renamed')).toHaveLength(1);
        expect(memoryStore.maps['Principal']).toBeUndefined();
        expect(memoryStore.currentMap).toBe('Renamed');
    });

    it('renameMapInMemory transfers locked state', () => {
        memoryStore.lockedMaps.add('Principal');
        mapManager.renameMapInMemory('Principal', 'Renamed');

        expect(memoryStore.lockedMaps.has('Renamed')).toBe(true);
        expect(memoryStore.lockedMaps.has('Principal')).toBe(false);
    });
});

// ============================================================================
// Color tracking (pure logic)
// ============================================================================

describe('Color tracking', () => {
    it('getFeatureColor extracts primary color', () => {
        expect(mapManager.getFeatureColor(mockFeature('f1'))).toBe('#ff0000');
    });

    it('getFeatureColor returns null for no properties', () => {
        expect(mapManager.getFeatureColor({})).toBeNull();
    });

    it('getFeatureColor checks color properties in order', () => {
        const feature = { properties: { fillColor: '#00ff00' } };
        expect(mapManager.getFeatureColor(feature)).toBe('#00ff00');
    });

    it('getFeatureColors returns all color properties', () => {
        const feature = {
            properties: {
                color: '#ff0000',
                fillColor: '#00ff00',
                lineColor: '#0000ff'
            }
        };
        const colors = mapManager.getFeatureColors(feature);
        expect(colors).toContain('#ff0000');
        expect(colors).toContain('#00ff00');
        expect(colors).toContain('#0000ff');
        expect(colors).toHaveLength(3);
    });

    it('getFeatureColors returns empty array for no properties', () => {
        expect(mapManager.getFeatureColors({})).toEqual([]);
    });

    it('updateColorUsage increments new color and decrements old', () => {
        memoryStore.colorUsageCache = new Map([['#ff0000', 3]]);
        mapManager.updateColorUsage('#ff0000', '#00ff00');

        expect(memoryStore.colorUsageCache.get('#ff0000')).toBe(2);
        expect(memoryStore.colorUsageCache.get('#00ff00')).toBe(1);
    });

    it('updateColorUsage removes color when count reaches 0', () => {
        memoryStore.colorUsageCache = new Map([['#ff0000', 1]]);
        mapManager.updateColorUsage('#ff0000', null);

        expect(memoryStore.colorUsageCache.has('#ff0000')).toBe(false);
    });

    it('updateColorUsage treats "none" as null', () => {
        memoryStore.colorUsageCache = new Map([['#ff0000', 1]]);
        mapManager.updateColorUsage('#ff0000', 'none');

        expect(memoryStore.colorUsageCache.has('#ff0000')).toBe(false);
    });

    it('getFrequentColors returns sorted by count', () => {
        memoryStore.colorUsageCache = new Map([
            ['#ff0000', 5],
            ['#00ff00', 10],
            ['#0000ff', 3]
        ]);

        const frequent = mapManager.getFrequentColors(3, 'current');
        expect(frequent[0].color).toBe('#00ff00');
        expect(frequent[1].color).toBe('#ff0000');
        expect(frequent[2].color).toBe('#0000ff');
    });

    it('getFrequentColors respects limit', () => {
        memoryStore.colorUsageCache = new Map([
            ['#ff0000', 5], ['#00ff00', 10], ['#0000ff', 3]
        ]);

        const frequent = mapManager.getFrequentColors(2);
        expect(frequent).toHaveLength(2);
    });
});

// ============================================================================
// removeWithProcessed undo/redo (LOS/Visibility)
// ============================================================================

describe('removeWithProcessed undo/redo', () => {
    it('undo of removeWithProcessed restores main + processed features', async () => {
        const executeFn = createMockExecuteFn();
        const mainFeature = mockFeature('los-1');
        const processedFeatures = [
            mockFeature('los-1-visible'),
            mockFeature('los-1-obstructed')
        ];

        mapManager.recordAction({
            type: 'removeWithProcessed',
            mainFeatureType: 'los',
            mainFeature,
            processedFeatures: {
                type: 'processed_los',
                features: processedFeatures
            }
        });

        await mapManager.undoLastAction(executeFn);

        // Should restore main feature
        expect(executeFn.addFeature).toHaveBeenCalledWith('los', mainFeature);
        // Should restore processed features
        expect(executeFn.addFeature).toHaveBeenCalledWith('processed_los', processedFeatures[0]);
        expect(executeFn.addFeature).toHaveBeenCalledWith('processed_los', processedFeatures[1]);
        expect(executeFn.addFeature).toHaveBeenCalledTimes(3);
    });

    it('redo of removeWithProcessed removes main feature', async () => {
        const executeFn = createMockExecuteFn();
        mapManager.recordAction({
            type: 'removeWithProcessed',
            mainFeatureType: 'los',
            mainFeature: mockFeature('los-1'),
            processedFeatures: null
        });

        await mapManager.undoLastAction(executeFn);
        vi.clearAllMocks();
        sessionContext.getUserId.mockReturnValue(TEST_USER);
        await mapManager.redoLastAction(executeFn);

        expect(executeFn.removeFeature).toHaveBeenCalledWith('los', 'los-1');
    });
});

// ============================================================================
// addMultiple undo/redo
// ============================================================================

describe('addMultiple undo/redo', () => {
    it('undo of addMultiple removes all features', async () => {
        const executeFn = createMockExecuteFn();
        mapManager.recordAction({
            type: 'addMultiple',
            features: {
                points: [mockFeature('p1'), mockFeature('p2')],
                lines: [mockFeature('l1')]
            }
        });

        await mapManager.undoLastAction(executeFn);

        expect(executeFn.removeFeature).toHaveBeenCalledTimes(3);
        expect(executeFn.removeFeature).toHaveBeenCalledWith('points', 'p1');
        expect(executeFn.removeFeature).toHaveBeenCalledWith('points', 'p2');
        expect(executeFn.removeFeature).toHaveBeenCalledWith('lines', 'l1');
    });

    it('redo of addMultiple re-adds all features', async () => {
        const executeFn = createMockExecuteFn();
        const features = {
            points: [mockFeature('p1')],
            lines: [mockFeature('l1')]
        };
        mapManager.recordAction({ type: 'addMultiple', features });

        await mapManager.undoLastAction(executeFn);
        vi.clearAllMocks();
        sessionContext.getUserId.mockReturnValue(TEST_USER);
        await mapManager.redoLastAction(executeFn);

        expect(executeFn.addFeature).toHaveBeenCalledTimes(2);
    });
});

// ============================================================================
// Per-map isolation
// ============================================================================

describe('Per-map undo isolation', () => {
    it('each map has independent undo stacks', () => {
        mapManager.addMapToMemory('MapA');
        mapManager.addMapToMemory('MapB');

        memoryStore.currentMap = 'MapA';
        mapManager.recordAction({ type: 'add', featureType: 'points', feature: mockFeature('a1') });

        memoryStore.currentMap = 'MapB';
        mapManager.recordAction({ type: 'add', featureType: 'points', feature: mockFeature('b1') });
        mapManager.recordAction({ type: 'add', featureType: 'points', feature: mockFeature('b2') });

        expect(getUndoStack('MapA')).toHaveLength(1);
        expect(getUndoStack('MapB')).toHaveLength(2);
    });
});

// ============================================================================
// Per-user isolation
// ============================================================================

describe('Per-user undo isolation', () => {
    it('different users have independent undo stacks on the same map', () => {
        // User A records actions
        sessionContext.getUserId.mockReturnValue('user-a');
        mapManager.recordAction({ type: 'add', featureType: 'points', feature: mockFeature('a1') });
        mapManager.recordAction({ type: 'add', featureType: 'points', feature: mockFeature('a2') });

        // User B records actions
        sessionContext.getUserId.mockReturnValue('user-b');
        mapManager.recordAction({ type: 'add', featureType: 'points', feature: mockFeature('b1') });

        // Verify isolation
        expect(memoryStore.maps['Principal'].undoStacks['user-a']).toHaveLength(2);
        expect(memoryStore.maps['Principal'].undoStacks['user-b']).toHaveLength(1);
    });

    it('undo only affects current user stack', async () => {
        const executeFn = createMockExecuteFn();

        // User A records 2 actions
        sessionContext.getUserId.mockReturnValue('user-a');
        mapManager.recordAction({ type: 'add', featureType: 'points', feature: mockFeature('a1') });
        mapManager.recordAction({ type: 'add', featureType: 'points', feature: mockFeature('a2') });

        // User B records 1 action
        sessionContext.getUserId.mockReturnValue('user-b');
        mapManager.recordAction({ type: 'add', featureType: 'points', feature: mockFeature('b1') });

        // User A undoes
        sessionContext.getUserId.mockReturnValue('user-a');
        await mapManager.undoLastAction(executeFn);

        // User A has 1 left in undo, 1 in redo
        expect(memoryStore.maps['Principal'].undoStacks['user-a']).toHaveLength(1);
        expect(memoryStore.maps['Principal'].redoStacks['user-a']).toHaveLength(1);

        // User B's stack is untouched
        expect(memoryStore.maps['Principal'].undoStacks['user-b']).toHaveLength(1);
    });

    it('canUndo / canRedo are user-specific', () => {
        // User A records an action
        sessionContext.getUserId.mockReturnValue('user-a');
        mapManager.recordAction({ type: 'add', featureType: 'points', feature: mockFeature('a1') });

        // User A can undo
        expect(mapManager.canUndo()).toBe(true);

        // User B cannot undo (empty stack)
        sessionContext.getUserId.mockReturnValue('user-b');
        expect(mapManager.canUndo()).toBe(false);
    });
});

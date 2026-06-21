import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Mock dependencies (group.operations.js import block)
// ============================================================================

vi.mock('../../src/js/store/map.operations.js', () => ({
    isCurrentMapLockedSync: vi.fn(() => false)
}));

vi.mock('../../src/js/store/sync/permission-guard.js', () => ({
    checkPermission: vi.fn(() => ({ allowed: true })),
    GuardAction: {
        CREATE_GROUP: 'CREATE_GROUP',
        UPDATE_GROUP: 'UPDATE_GROUP',
        DELETE_GROUP: 'DELETE_GROUP'
    }
}));

vi.mock('../../src/js/store/store-errors.js', () => ({
    emitStoreError: vi.fn(),
    StoreErrorEvents: { STORE_OPERATION_BLOCKED: 'store:operationBlocked' }
}));

// ============================================================================
// Imports (after mocks)
// ============================================================================

import {
    setGroupDependencies,
    createGroup,
    combineGroups,
    getMapGroups,
    getGroupById,
    getFeatureGroup,
    getGroupFeatures,
    isFeatureGrouped,
    updateGroupProperty,
    ungroupFeatures,
    removeFeatureFromAllGroups
} from '../../src/js/store/group.operations.js';

import { isCurrentMapLockedSync } from '../../src/js/store/map.operations.js';
import { checkPermission, GuardAction } from '../../src/js/store/sync/permission-guard.js';
import { emitStoreError, StoreErrorEvents } from '../../src/js/store/store-errors.js';

// ============================================================================
// vi.fn-backed groupManager (injected via setGroupDependencies)
// ============================================================================

let groupManager;

beforeEach(() => {
    vi.clearAllMocks();
    isCurrentMapLockedSync.mockReturnValue(false);
    checkPermission.mockReturnValue({ allowed: true });

    groupManager = {
        createGroup: vi.fn(() => ({ id: 'grp-new' })),
        combineGroups: vi.fn(() => ({ id: 'grp-combined' })),
        getMapGroups: vi.fn(() => [{ id: 'g1' }, { id: 'g2' }]),
        getGroupById: vi.fn(() => ({ id: 'g1' })),
        getFeatureGroup: vi.fn(() => ({ id: 'g1' })),
        getGroupFeatures: vi.fn(() => [{ type: 'points', id: 'f1' }]),
        isFeatureGrouped: vi.fn(() => true),
        updateGroupProperty: vi.fn(() => true),
        ungroupFeatures: vi.fn(() => true),
        removeFeatureFromAllGroups: vi.fn(() => true)
    };

    setGroupDependencies({ groupManager });
});

// ============================================================================
// Shared guard-contract assertions for the 4 mutating fns
// ============================================================================

const MUTATIONS = [
    {
        name: 'createGroup',
        guardAction: 'CREATE_GROUP',
        operation: 'createGroup',
        managerFn: 'createGroup',
        blockedReturn: null,
        run: () => createGroup([{ type: 'points', id: 'f1' }], 'TestMap'),
        expectArgs: [[{ type: 'points', id: 'f1' }], 'TestMap'],
        managerReturn: { id: 'grp-new' }
    },
    {
        name: 'combineGroups',
        guardAction: 'UPDATE_GROUP',
        operation: 'combineGroups',
        managerFn: 'combineGroups',
        blockedReturn: null,
        run: () => combineGroups(['g1', 'g2'], [{ id: 'f9' }], 'TestMap'),
        expectArgs: [['g1', 'g2'], [{ id: 'f9' }], 'TestMap'],
        managerReturn: { id: 'grp-combined' }
    },
    {
        name: 'updateGroupProperty',
        guardAction: 'UPDATE_GROUP',
        operation: 'updateGroupProperty',
        managerFn: 'updateGroupProperty',
        blockedReturn: false,
        run: () => updateGroupProperty('g1', 'cor', '#fff', 'TestMap'),
        expectArgs: ['g1', 'cor', '#fff', 'TestMap'],
        managerReturn: true
    },
    {
        name: 'ungroupFeatures',
        guardAction: 'DELETE_GROUP',
        operation: 'ungroupFeatures',
        managerFn: 'ungroupFeatures',
        blockedReturn: false,
        run: () => ungroupFeatures('g1', 'TestMap'),
        expectArgs: ['g1', 'TestMap'],
        managerReturn: true
    }
];

describe.each(MUTATIONS)('$name (guarded mutation)', (m) => {
    it('happy path: delegates with exact args and returns the manager value', () => {
        const result = m.run();

        expect(groupManager[m.managerFn]).toHaveBeenCalledOnce();
        expect(groupManager[m.managerFn]).toHaveBeenCalledWith(...m.expectArgs);
        expect(result).toEqual(m.managerReturn);
    });

    it('checks the correct permission action', () => {
        m.run();
        expect(checkPermission).toHaveBeenCalledWith(GuardAction[m.guardAction]);
    });

    it('blocked by permission: returns blocked sentinel, emits STORE_OPERATION_BLOCKED, no manager call', () => {
        checkPermission.mockReturnValue({ allowed: false, reason: 'no perms' });

        const result = m.run();

        expect(result).toBe(m.blockedReturn);
        expect(emitStoreError).toHaveBeenCalledWith(
            StoreErrorEvents.STORE_OPERATION_BLOCKED,
            { operation: m.operation, reason: 'no perms' }
        );
        expect(groupManager[m.managerFn]).not.toHaveBeenCalled();
        // permission failing short-circuits before the lock check
        expect(isCurrentMapLockedSync).not.toHaveBeenCalled();
    });

    it('blocked by locked map: returns blocked sentinel, no manager call, no block-error event', () => {
        isCurrentMapLockedSync.mockReturnValue(true);

        const result = m.run();

        expect(result).toBe(m.blockedReturn);
        expect(groupManager[m.managerFn]).not.toHaveBeenCalled();
        // lock path warns/returns; it does NOT emit STORE_OPERATION_BLOCKED
        expect(emitStoreError).not.toHaveBeenCalled();
    });
});

// ============================================================================
// createGroup — default-arg behavior
// ============================================================================

describe('createGroup defaults', () => {
    it('forwards a null mapName when omitted', () => {
        createGroup([{ id: 'f1' }]);
        expect(groupManager.createGroup).toHaveBeenCalledWith([{ id: 'f1' }], null);
    });
});

describe('combineGroups defaults', () => {
    it('defaults selectedFeatures to [] and mapName to null', () => {
        combineGroups(['g1']);
        expect(groupManager.combineGroups).toHaveBeenCalledWith(['g1'], [], null);
    });
});

// ============================================================================
// Read operations — pass through WITHOUT a guard
// ============================================================================

describe('read operations (no guard)', () => {
    const READS = [
        { name: 'getMapGroups', run: () => getMapGroups('TestMap'), fn: 'getMapGroups', args: ['TestMap'], ret: [{ id: 'g1' }, { id: 'g2' }] },
        { name: 'getGroupById', run: () => getGroupById('g1', 'TestMap'), fn: 'getGroupById', args: ['g1', 'TestMap'], ret: { id: 'g1' } },
        { name: 'getFeatureGroup', run: () => getFeatureGroup('points', 'f1', 'TestMap'), fn: 'getFeatureGroup', args: ['points', 'f1', 'TestMap'], ret: { id: 'g1' } },
        { name: 'getGroupFeatures', run: () => getGroupFeatures('g1', 'TestMap'), fn: 'getGroupFeatures', args: ['g1', 'TestMap'], ret: [{ type: 'points', id: 'f1' }] },
        { name: 'isFeatureGrouped', run: () => isFeatureGrouped('points', 'f1', 'TestMap'), fn: 'isFeatureGrouped', args: ['points', 'f1', 'TestMap'], ret: true }
    ];

    describe.each(READS)('$name', (r) => {
        it('delegates with exact args and returns the manager value', () => {
            const result = r.run();
            expect(groupManager[r.fn]).toHaveBeenCalledWith(...r.args);
            expect(result).toEqual(r.ret);
        });

        it('passes through even when the map is locked (read is not guarded)', () => {
            isCurrentMapLockedSync.mockReturnValue(true);
            const result = r.run();
            expect(groupManager[r.fn]).toHaveBeenCalledWith(...r.args);
            expect(result).toEqual(r.ret);
            expect(emitStoreError).not.toHaveBeenCalled();
        });

        it('passes through even when permission is denied (read is not guarded)', () => {
            checkPermission.mockReturnValue({ allowed: false, reason: 'denied' });
            const result = r.run();
            expect(groupManager[r.fn]).toHaveBeenCalledWith(...r.args);
            expect(result).toEqual(r.ret);
            expect(emitStoreError).not.toHaveBeenCalled();
            expect(checkPermission).not.toHaveBeenCalled();
        });
    });
});

// ============================================================================
// removeFeatureFromAllGroups — delete-shaped, but NOT guarded
// ============================================================================

describe('removeFeatureFromAllGroups (unguarded delete)', () => {
    it('delegates with exact args and returns the manager value', () => {
        const result = removeFeatureFromAllGroups('points', 'f1', 'TestMap');

        expect(groupManager.removeFeatureFromAllGroups).toHaveBeenCalledWith('points', 'f1', 'TestMap');
        expect(result).toBe(true);
    });

    it('forwards a null mapName when omitted', () => {
        removeFeatureFromAllGroups('points', 'f1');
        expect(groupManager.removeFeatureFromAllGroups).toHaveBeenCalledWith('points', 'f1', null);
    });

    it('still delegates on a locked map (no guard)', () => {
        isCurrentMapLockedSync.mockReturnValue(true);

        const result = removeFeatureFromAllGroups('points', 'f1', 'TestMap');

        expect(groupManager.removeFeatureFromAllGroups).toHaveBeenCalledOnce();
        expect(result).toBe(true);
        expect(emitStoreError).not.toHaveBeenCalled();
    });

    it('still delegates when permission would be denied (no guard)', () => {
        checkPermission.mockReturnValue({ allowed: false, reason: 'denied' });

        const result = removeFeatureFromAllGroups('points', 'f1', 'TestMap');

        expect(groupManager.removeFeatureFromAllGroups).toHaveBeenCalledOnce();
        expect(result).toBe(true);
        expect(checkPermission).not.toHaveBeenCalled();
    });
});

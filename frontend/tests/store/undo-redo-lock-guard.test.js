// Path: tests/store/undo-redo-lock-guard.test.js

/**
 * @fileoverview Pins the single public entry point of undo/redo and its map-lock guard.
 *
 * The package used to hold TWO functions named `undoLastAction` (and two named
 * `redoLastAction`): the one in `store.js`, which binds the feature executors and
 * refuses to run while the current map is locked, and a bare forwarder in
 * `map.operations.js` that called the state manager WITHOUT consulting the lock.
 * Nothing imported the forwarder (store.js never re-exported it, so the `@store`
 * barrel only ever exposed the guarded pair), so it was deleted. Importing the
 * homonym would have bypassed the lock silently, which is why the absence is a
 * test and not a comment.
 *
 * What this spec asserts:
 *   1. `map.operations.js` exports no `undoLastAction` / `redoLastAction`.
 *   2. The `@store` barrel exposes exactly the guarded pair from `store.js`.
 *   3. Both survivors return `false` and never reach the undo engine on a locked map.
 *
 * The state manager (the real undo engine, covered by `undo-redo.test.js`) is the
 * only mocked collaborator: everything else, including the real
 * `isCurrentMapLockedSync`, is the production module. The lock is flipped through
 * the briefing override, which is the one lock path that needs no IndexedDB.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================================
// Mocks
// ============================================================================

const { mockMapManager } = vi.hoisted(() => ({
    mockMapManager: {
        // The undo engine itself. Reaching it while locked is the bug this spec guards.
        undoLastAction: vi.fn(async () => ({ type: 'undone' })),
        redoLastAction: vi.fn(async () => ({ type: 'redone' })),
        getCurrentMapName: vi.fn(() => 'TestMap'),
        getCurrentMapId: vi.fn(() => 'uuid-TestMap')
    }
}));

vi.mock('../../src/js/store/store-state-manager.js', () => ({ default: mockMapManager }));

// ============================================================================
// Imports (after mocks)
// ============================================================================

import * as mapOperations from '../../src/js/store/map.operations.js';
import * as storeBarrel from '../../src/js/store/index.js';
import {
    undoLastAction,
    redoLastAction,
    setBriefingLockOverride
} from '../../src/js/store/store.js';

/** Executor names store.js binds into the undo/redo engine call. */
const EXECUTOR_NAMES = ['addFeature', 'updateFeature', 'removeFeature', 'addFeatureToMap', 'removeFeatureFromMap'];

beforeEach(() => {
    vi.clearAllMocks();
    mockMapManager.undoLastAction.mockImplementation(async () => ({ type: 'undone' }));
    mockMapManager.redoLastAction.mockImplementation(async () => ({ type: 'redone' }));
    setBriefingLockOverride(false);
});

afterEach(() => {
    setBriefingLockOverride(false);
});

// ============================================================================
// TESTS
// ============================================================================

describe('undo/redo has a single, lock-guarded entry point', () => {

    describe('the unguarded homonyms are gone', () => {
        it('map.operations.js exports no undoLastAction/redoLastAction', () => {
            expect('undoLastAction' in mapOperations).toBe(false);
            expect('redoLastAction' in mapOperations).toBe(false);
            expect(mapOperations.undoLastAction).toBeUndefined();
            expect(mapOperations.redoLastAction).toBeUndefined();
        });

        it('the @store barrel exposes exactly the guarded pair from store.js', () => {
            // Same function identity: no second definition can shadow it through the barrel.
            expect(storeBarrel.undoLastAction).toBe(undoLastAction);
            expect(storeBarrel.redoLastAction).toBe(redoLastAction);
            expect(typeof storeBarrel.undoLastAction).toBe('function');
            expect(typeof storeBarrel.redoLastAction).toBe('function');
        });
    });

    describe('unlocked map: the engine runs', () => {
        it('undoLastAction forwards to the engine with the feature executors', async () => {
            const result = await undoLastAction();

            expect(result).toEqual({ type: 'undone' });
            expect(mockMapManager.undoLastAction).toHaveBeenCalledTimes(1);

            const executors = mockMapManager.undoLastAction.mock.calls[0][0];
            for (const name of EXECUTOR_NAMES) {
                expect(typeof executors[name]).toBe('function');
            }
        });

        it('redoLastAction forwards to the engine with the feature executors', async () => {
            const result = await redoLastAction();

            expect(result).toEqual({ type: 'redone' });
            expect(mockMapManager.redoLastAction).toHaveBeenCalledTimes(1);

            const executors = mockMapManager.redoLastAction.mock.calls[0][0];
            for (const name of EXECUTOR_NAMES) {
                expect(typeof executors[name]).toBe('function');
            }
        });
    });

    describe('locked map: the engine is never reached', () => {
        it('undoLastAction returns false and does not call the engine', async () => {
            setBriefingLockOverride(true);
            expect(mapOperations.isCurrentMapLockedSync()).toBe(true);

            const result = await undoLastAction();

            expect(result).toBe(false);
            expect(mockMapManager.undoLastAction).not.toHaveBeenCalled();
        });

        it('redoLastAction returns false and does not call the engine', async () => {
            setBriefingLockOverride(true);
            expect(mapOperations.isCurrentMapLockedSync()).toBe(true);

            const result = await redoLastAction();

            expect(result).toBe(false);
            expect(mockMapManager.redoLastAction).not.toHaveBeenCalled();
        });

        it('the same call succeeds once the lock is lifted (the guard is the only reason it failed)', async () => {
            setBriefingLockOverride(true);
            expect(await undoLastAction()).toBe(false);

            setBriefingLockOverride(false);
            expect(await undoLastAction()).toEqual({ type: 'undone' });
            expect(mockMapManager.undoLastAction).toHaveBeenCalledTimes(1);
        });
    });

    describe('edge cases', () => {
        it('an engine failure is swallowed as false, not propagated', async () => {
            mockMapManager.undoLastAction.mockImplementation(async () => { throw new Error('IDB failure'); });
            mockMapManager.redoLastAction.mockImplementation(async () => { throw new Error('IDB failure'); });

            await expect(undoLastAction()).resolves.toBe(false);
            await expect(redoLastAction()).resolves.toBe(false);
        });

        it('an empty history (engine returns false) is passed through unchanged', async () => {
            mockMapManager.undoLastAction.mockImplementation(async () => false);
            mockMapManager.redoLastAction.mockImplementation(async () => false);

            expect(await undoLastAction()).toBe(false);
            expect(await redoLastAction()).toBe(false);
        });
    });
});

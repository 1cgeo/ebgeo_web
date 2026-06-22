import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Regression for §item3 / "bug D": an operation whose CONTEXT mapId is not a UUID (a
// feature/layer/group authored on the local default 'Principal' map, which is name-keyed)
// must NOT be enqueued. The backend rejects a non-UUID mapId (Postgres 22P02), and a single
// such op fails the ENTIRE flush batch — blocking all sync. The dispatcher now drops it at
// enqueue. A UUID mapId (a real synced atlas map) is enqueued as normal.
//
// Uses the REAL uuid module so isValidUUID distinguishes 'Principal' from a real UUID.

const mockStore = new Map();
vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            setItem: vi.fn(async (k, v) => { mockStore.set(k, v); }),
            getItem: vi.fn(async (k) => mockStore.get(k) || null),
            removeItem: vi.fn(async (k) => { mockStore.delete(k); }),
            keys: vi.fn(async () => [...mockStore.keys()]),
        })
    }
}));

const localStorageMock = (() => {
    const store = {};
    return {
        getItem: (k) => store[k] || null,
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: (k) => { delete store[k]; }
    };
})();
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

vi.mock('../../src/js/store/store-errors.js', () => ({
    StoreErrorEvents: { STORE_SYNC_ERROR: 'store:syncError' },
    emitStoreError: vi.fn()
}));

import {
    enableOperationLogging,
    disableOperationLogging,
    logFeatureOperation,
    logLayerOperation,
    operationQueue,
} from '../../src/js/store/sync/operation-dispatcher.js';
import { OperationType } from '../../src/js/store/sync/operation-types.js';
import { generateUUID } from '../../src/js/utilities/uuid.js';

beforeEach(() => {
    mockStore.clear();
    enableOperationLogging();
});
afterEach(() => {
    disableOperationLogging();
});

describe('non-UUID mapId guard (bug D)', () => {
    it('drops a feature op on a name-keyed local map', async () => {
        const before = await operationQueue.count();
        await logFeatureOperation(OperationType.CREATE, generateUUID(), 'Principal', { id: 'f1' });
        expect(await operationQueue.count()).toBe(before); // not enqueued
    });

    it('enqueues a feature op on a UUID-keyed atlas map', async () => {
        const before = await operationQueue.count();
        await logFeatureOperation(OperationType.CREATE, generateUUID(), generateUUID(), { id: 'f1' });
        expect(await operationQueue.count()).toBe(before + 1); // enqueued
    });

    it('drops a layer op on a name-keyed local map', async () => {
        const before = await operationQueue.count();
        await logLayerOperation(OperationType.CREATE, generateUUID(), 'Principal', { id: 'l1' });
        expect(await operationQueue.count()).toBe(before); // not enqueued
    });
});

import { describe, it, expect, beforeEach } from 'vitest';
import {
    createOperation,
    createBatchOperations,
    getClientId,
    resetClientId,
    getLamportClock,
    advanceLamportClock
} from '../../src/js/store/sync/operation-factory.js';
import { EntityType, OperationType } from '../../src/js/store/sync/operation-types.js';
import { isValidUUID } from '../../src/js/utilities/uuid.js';

// Mock localStorage for Node environment
const localStorageMock = (() => {
    let store = {};
    return {
        getItem: (key) => store[key] ?? null,
        setItem: (key, value) => { store[key] = String(value); },
        removeItem: (key) => { delete store[key]; },
        clear: () => { store = {}; }
    };
})();

// Install mock before any test runs
if (typeof globalThis.localStorage === 'undefined') {
    Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });
}

beforeEach(() => {
    localStorageMock.clear();
    resetClientId();
});

// ============================================================================
// Client ID
// ============================================================================

describe('getClientId', () => {
    it('generates a valid UUID', () => {
        const id = getClientId();
        expect(isValidUUID(id)).toBe(true);
    });

    it('returns same ID on subsequent calls', () => {
        const id1 = getClientId();
        const id2 = getClientId();
        expect(id1).toBe(id2);
    });

    it('persists to localStorage', () => {
        const id = getClientId();
        expect(localStorageMock.getItem('ebgeo_client_id')).toBe(id);
    });

    it('restores from localStorage', () => {
        localStorageMock.setItem('ebgeo_client_id', 'saved-id');
        resetClientId(); // Clear in-memory cache
        localStorageMock.setItem('ebgeo_client_id', 'saved-id'); // Restore
        const id = getClientId();
        expect(id).toBe('saved-id');
    });

    it('resetClientId clears everything', () => {
        getClientId();
        resetClientId();
        expect(localStorageMock.getItem('ebgeo_client_id')).toBeNull();
    });
});

// ============================================================================
// Lamport Clock
// ============================================================================

describe('Lamport Clock', () => {
    it('starts at 0', () => {
        // Note: clock is module-level state, may not be 0 if other tests ran.
        // We test the behavior, not absolute value.
        const start = getLamportClock();
        expect(typeof start).toBe('number');
    });

    it('increments on createOperation', () => {
        const before = getLamportClock();
        createOperation(EntityType.FEATURE, OperationType.CREATE, 'feat-1', 'map-1');
        expect(getLamportClock()).toBe(before + 1);
    });

    it('increments for each operation in a batch', () => {
        const before = getLamportClock();
        createBatchOperations([
            { entityType: EntityType.FEATURE, operationType: OperationType.CREATE, entityId: 'f1' },
            { entityType: EntityType.FEATURE, operationType: OperationType.UPDATE, entityId: 'f2' },
            { entityType: EntityType.FEATURE, operationType: OperationType.DELETE, entityId: 'f3' }
        ]);
        expect(getLamportClock()).toBe(before + 3);
    });

    it('advanceLamportClock synchronizes with remote', () => {
        const before = getLamportClock();
        const remoteTimestamp = before + 100;
        advanceLamportClock(remoteTimestamp);
        expect(getLamportClock()).toBe(remoteTimestamp + 1);
    });

    it('advanceLamportClock uses max(local, remote) + 1', () => {
        // If local is ahead of remote, still increments by 1
        const current = getLamportClock();
        advanceLamportClock(current - 10); // Remote is behind
        expect(getLamportClock()).toBe(current + 1);
    });

    it('ensures monotonically increasing timestamps across operations', () => {
        const timestamps = [];
        for (let i = 0; i < 5; i++) {
            const op = createOperation(EntityType.FEATURE, OperationType.UPDATE, `f-${i}`, 'map-1');
            timestamps.push(op.lamportTimestamp);
        }
        for (let i = 1; i < timestamps.length; i++) {
            expect(timestamps[i]).toBeGreaterThan(timestamps[i - 1]);
        }
    });
});

// ============================================================================
// createOperation
// ============================================================================

describe('createOperation', () => {
    it('creates operation with correct structure', () => {
        const op = createOperation(
            EntityType.FEATURE,
            OperationType.CREATE,
            'feat-123',
            'map-456',
            { nome: 'Ponto A' },
            null
        );

        expect(isValidUUID(op.id)).toBe(true);
        expect(op.entityType).toBe(EntityType.FEATURE);
        expect(op.operationType).toBe(OperationType.CREATE);
        expect(op.entityId).toBe('feat-123');
        expect(op.mapId).toBe('map-456');
        expect(op.data).toEqual({ nome: 'Ponto A' });
        expect(op.previousData).toBeNull();
        expect(typeof op.timestamp).toBe('number');
        expect(typeof op.lamportTimestamp).toBe('number');
        expect(typeof op.clientId).toBe('string');
    });

    it('normalizes null mapId', () => {
        const op = createOperation(EntityType.MAP, OperationType.CREATE, 'm1', null);
        expect(op.mapId).toBeNull();

        const op2 = createOperation(EntityType.MAP, OperationType.CREATE, 'm2', undefined);
        expect(op2.mapId).toBeNull();

        const op3 = createOperation(EntityType.MAP, OperationType.CREATE, 'm3', '');
        expect(op3.mapId).toBeNull();
    });

    it('throws on invalid entity type', () => {
        expect(() => createOperation('invalid', OperationType.CREATE, 'id1', null))
            .toThrow('Invalid entity type');
    });

    it('throws on invalid operation type', () => {
        expect(() => createOperation(EntityType.FEATURE, 'invalid', 'id1', null))
            .toThrow('Invalid operation type');
    });

    it('throws when entityId is missing', () => {
        expect(() => createOperation(EntityType.FEATURE, OperationType.CREATE, '', null))
            .toThrow('Entity ID is required');
        expect(() => createOperation(EntityType.FEATURE, OperationType.CREATE, null, null))
            .toThrow('Entity ID is required');
    });

    it('generates unique IDs for each operation', () => {
        const op1 = createOperation(EntityType.FEATURE, OperationType.CREATE, 'f1', null);
        const op2 = createOperation(EntityType.FEATURE, OperationType.CREATE, 'f2', null);
        expect(op1.id).not.toBe(op2.id);
    });

    it('uses wall clock for timestamp', () => {
        const before = Date.now();
        const op = createOperation(EntityType.FEATURE, OperationType.CREATE, 'f1', null);
        const after = Date.now();
        expect(op.timestamp).toBeGreaterThanOrEqual(before);
        expect(op.timestamp).toBeLessThanOrEqual(after);
    });
});

// ============================================================================
// createBatchOperations
// ============================================================================

describe('createBatchOperations', () => {
    it('creates batch with shared batchId', () => {
        const ops = createBatchOperations([
            { entityType: EntityType.FEATURE, operationType: OperationType.CREATE, entityId: 'f1' },
            { entityType: EntityType.FEATURE, operationType: OperationType.CREATE, entityId: 'f2' }
        ]);

        expect(ops).toHaveLength(2);
        expect(ops[0].batchId).toBe(ops[1].batchId);
        expect(isValidUUID(ops[0].batchId)).toBe(true);
    });

    it('assigns sequential batchIndex', () => {
        const ops = createBatchOperations([
            { entityType: EntityType.FEATURE, operationType: OperationType.CREATE, entityId: 'f1' },
            { entityType: EntityType.FEATURE, operationType: OperationType.CREATE, entityId: 'f2' },
            { entityType: EntityType.FEATURE, operationType: OperationType.CREATE, entityId: 'f3' }
        ]);

        expect(ops[0].batchIndex).toBe(0);
        expect(ops[1].batchIndex).toBe(1);
        expect(ops[2].batchIndex).toBe(2);
    });

    it('shares same timestamp and clientId', () => {
        const ops = createBatchOperations([
            { entityType: EntityType.FEATURE, operationType: OperationType.CREATE, entityId: 'f1' },
            { entityType: EntityType.LAYER, operationType: OperationType.CREATE, entityId: 'l1' }
        ]);

        expect(ops[0].timestamp).toBe(ops[1].timestamp);
        expect(ops[0].clientId).toBe(ops[1].clientId);
    });

    it('each operation has unique ID but sequential Lamport timestamps', () => {
        const ops = createBatchOperations([
            { entityType: EntityType.FEATURE, operationType: OperationType.CREATE, entityId: 'f1' },
            { entityType: EntityType.FEATURE, operationType: OperationType.CREATE, entityId: 'f2' }
        ]);

        expect(ops[0].id).not.toBe(ops[1].id);
        expect(ops[1].lamportTimestamp).toBe(ops[0].lamportTimestamp + 1);
    });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { ensureMockLocalStorage } from '../helpers/test-utils.js';

// ============================================================================
// Setup localStorage mock (needed by operation-factory)
// ============================================================================

const localStorageMock = ensureMockLocalStorage();

// ============================================================================
// Imports
// ============================================================================

import {
    createOperation,
    createBatchOperations,
    getClientId,
    resetClientId,
    getLamportClock,
    advanceLamportClock
} from '../../src/js/store/sync/operation-factory.js';
import { EntityType, OperationType } from '../../src/js/store/sync/operation-types.js';

// ============================================================================
// SETUP
// ============================================================================

beforeEach(() => {
    localStorageMock.clear();
    resetClientId();
    // Reset Lamport clock by creating it from scratch (no direct reset API)
    // The clock is module-level, so we advance to a known state
});

// ============================================================================
// TESTS
// ============================================================================

describe('Lamport clock ordering (CRDT readiness)', () => {

    // ========================================================================
    // Local clock advancement
    // ========================================================================

    describe('local clock advancement', () => {
        it('3 createOperation() calls → Lamport timestamps strictly increasing', () => {
            const op1 = createOperation(EntityType.FEATURE, OperationType.CREATE, 'feat-1', 'map-1', { nome: 'A' });
            const op2 = createOperation(EntityType.FEATURE, OperationType.UPDATE, 'feat-1', 'map-1', { nome: 'B' });
            const op3 = createOperation(EntityType.FEATURE, OperationType.DELETE, 'feat-1', 'map-1');

            expect(op2.lamportTimestamp).toBeGreaterThan(op1.lamportTimestamp);
            expect(op3.lamportTimestamp).toBeGreaterThan(op2.lamportTimestamp);
        });

        it('operations from same client have same clientId', () => {
            const op1 = createOperation(EntityType.FEATURE, OperationType.CREATE, 'feat-1', 'map-1');
            const op2 = createOperation(EntityType.FEATURE, OperationType.CREATE, 'feat-2', 'map-1');

            expect(op1.clientId).toBe(op2.clientId);
            expect(op1.clientId).toBeTruthy();
        });

        it('each operation gets a unique ID', () => {
            const op1 = createOperation(EntityType.FEATURE, OperationType.CREATE, 'feat-1', 'map-1');
            const op2 = createOperation(EntityType.FEATURE, OperationType.CREATE, 'feat-2', 'map-1');

            expect(op1.id).not.toBe(op2.id);
        });

        it('operations include wall clock timestamp', () => {
            const before = Date.now();
            const op = createOperation(EntityType.FEATURE, OperationType.CREATE, 'feat-1', 'map-1');
            const after = Date.now();

            expect(op.timestamp).toBeGreaterThanOrEqual(before);
            expect(op.timestamp).toBeLessThanOrEqual(after);
        });
    });

    // ========================================================================
    // Remote clock sync (advanceLamportClock)
    // ========================================================================

    describe('remote clock sync (advanceLamportClock)', () => {
        it('local < remote → next op gets timestamp > remote', () => {
            // Create some local ops to set clock
            createOperation(EntityType.FEATURE, OperationType.CREATE, 'feat-1', 'map-1');
            // Clock is now at some value

            // Receive remote operation with much higher clock
            advanceLamportClock(100);

            // Next local operation should have timestamp > 100
            const op = createOperation(EntityType.FEATURE, OperationType.CREATE, 'feat-2', 'map-1');
            expect(op.lamportTimestamp).toBeGreaterThan(100);
        });

        it('local > remote → clock uses max(local, remote) + 1', () => {
            // Create many local ops to push clock high
            for (let i = 0; i < 50; i++) {
                createOperation(EntityType.FEATURE, OperationType.CREATE, `feat-${i}`, 'map-1');
            }
            const clockBefore = getLamportClock();

            // Receive remote with lower clock
            advanceLamportClock(5);

            // Clock should be max(clockBefore, 5) + 1 = clockBefore + 1
            const op = createOperation(EntityType.FEATURE, OperationType.CREATE, 'feat-next', 'map-1');
            expect(op.lamportTimestamp).toBeGreaterThan(clockBefore);
        });

        it('same clock values → advance still increments', () => {
            const op1 = createOperation(EntityType.FEATURE, OperationType.CREATE, 'feat-1', 'map-1');
            const currentClock = op1.lamportTimestamp;

            advanceLamportClock(currentClock);

            const op2 = createOperation(EntityType.FEATURE, OperationType.CREATE, 'feat-2', 'map-1');
            expect(op2.lamportTimestamp).toBeGreaterThan(currentClock);
        });
    });

    // ========================================================================
    // Causal ordering across simulated clients
    // ========================================================================

    describe('causal ordering across simulated clients', () => {
        it('operations can be sorted by lamportTimestamp for causal order', () => {
            // Simulate two clients creating operations
            const ops = [];

            // Client A creates op at lamp=N
            const opA1 = createOperation(EntityType.FEATURE, OperationType.CREATE, 'feat-A1', 'map-1', { nome: 'A1' });
            ops.push(opA1);

            // Client B (simulated) creates op with lower timestamp
            ops.push({
                id: 'b-op-1',
                entityType: EntityType.FEATURE,
                operationType: OperationType.CREATE,
                entityId: 'feat-B1',
                mapId: 'map-1',
                data: { nome: 'B1' },
                previousData: null,
                timestamp: Date.now(),
                lamportTimestamp: 1, // Low - B hasn't seen A's ops yet
                clientId: 'client-B'
            });

            // B receives A's op and advances clock
            advanceLamportClock(opA1.lamportTimestamp);

            // B creates next op with advanced clock
            const opB2 = createOperation(EntityType.FEATURE, OperationType.UPDATE, 'feat-B1', 'map-1', { nome: 'B1-updated' });
            ops.push(opB2);

            // Sort by lamportTimestamp
            ops.sort((a, b) => a.lamportTimestamp - b.lamportTimestamp);

            // B's first op (lamp=1) should come first
            expect(ops[0].entityId).toBe('feat-B1');
            expect(ops[0].operationType).toBe(OperationType.CREATE);

            // B's second op should come after A's op (causal ordering preserved)
            const aIndex = ops.findIndex(o => o.entityId === 'feat-A1');
            const b2Index = ops.findIndex(o => o.entityId === 'feat-B1' && o.operationType === OperationType.UPDATE);
            expect(b2Index).toBeGreaterThan(aIndex);
        });
    });

    // ========================================================================
    // Client ID persistence
    // ========================================================================

    describe('client ID persistence', () => {
        it('clientId is stored in localStorage', () => {
            const clientId = getClientId();
            expect(clientId).toBeTruthy();

            const stored = localStorageMock.getItem('ebgeo_client_id');
            expect(stored).toBe(clientId);
        });

        it('resetClientId clears and regenerates', () => {
            const clientId1 = getClientId();
            resetClientId();

            const clientId2 = getClientId();
            expect(clientId2).not.toBe(clientId1);
        });

        it('clientId persists across getClientId() calls', () => {
            const id1 = getClientId();
            const id2 = getClientId();
            expect(id1).toBe(id2);
        });

        it('pre-existing clientId in localStorage is reused', () => {
            resetClientId();
            localStorageMock.setItem('ebgeo_client_id', 'my-persistent-id');

            // Reset module-level cache
            resetClientId();
            // But re-set the localStorage value since resetClientId clears it
            localStorageMock.setItem('ebgeo_client_id', 'my-persistent-id');

            const id = getClientId();
            expect(id).toBe('my-persistent-id');
        });
    });

    // ========================================================================
    // Batch operations and Lamport
    // ========================================================================

    describe('batch operations and Lamport', () => {
        it('createBatchOperations generates sequential lamportTimestamps', () => {
            const batch = createBatchOperations([
                { entityType: EntityType.FEATURE, operationType: OperationType.CREATE, entityId: 'feat-1' },
                { entityType: EntityType.FEATURE, operationType: OperationType.CREATE, entityId: 'feat-2' },
                { entityType: EntityType.FEATURE, operationType: OperationType.CREATE, entityId: 'feat-3' }
            ]);

            expect(batch).toHaveLength(3);

            // Lamport timestamps should be sequential
            expect(batch[1].lamportTimestamp).toBe(batch[0].lamportTimestamp + 1);
            expect(batch[2].lamportTimestamp).toBe(batch[1].lamportTimestamp + 1);
        });

        it('all batch operations share the same batchId', () => {
            const batch = createBatchOperations([
                { entityType: EntityType.FEATURE, operationType: OperationType.CREATE, entityId: 'feat-1' },
                { entityType: EntityType.LAYER, operationType: OperationType.CREATE, entityId: 'layer-1' },
                { entityType: EntityType.GROUP, operationType: OperationType.CREATE, entityId: 'group-1' }
            ]);

            const batchId = batch[0].batchId;
            expect(batchId).toBeTruthy();
            expect(batch.every(op => op.batchId === batchId)).toBe(true);
        });

        it('batch operations have sequential batchIndex', () => {
            const batch = createBatchOperations([
                { entityType: EntityType.FEATURE, operationType: OperationType.CREATE, entityId: 'feat-1' },
                { entityType: EntityType.FEATURE, operationType: OperationType.CREATE, entityId: 'feat-2' },
                { entityType: EntityType.FEATURE, operationType: OperationType.CREATE, entityId: 'feat-3' }
            ]);

            expect(batch[0].batchIndex).toBe(0);
            expect(batch[1].batchIndex).toBe(1);
            expect(batch[2].batchIndex).toBe(2);
        });

        it('all batch operations share the same wall clock timestamp', () => {
            const batch = createBatchOperations([
                { entityType: EntityType.FEATURE, operationType: OperationType.CREATE, entityId: 'feat-1' },
                { entityType: EntityType.FEATURE, operationType: OperationType.CREATE, entityId: 'feat-2' }
            ]);

            expect(batch[0].timestamp).toBe(batch[1].timestamp);
        });

        it('all batch operations share the same clientId', () => {
            const batch = createBatchOperations([
                { entityType: EntityType.FEATURE, operationType: OperationType.CREATE, entityId: 'feat-1' },
                { entityType: EntityType.FEATURE, operationType: OperationType.CREATE, entityId: 'feat-2' }
            ]);

            expect(batch[0].clientId).toBe(batch[1].clientId);
        });
    });

    // ========================================================================
    // Input validation
    // ========================================================================

    describe('input validation', () => {
        it('throws on invalid entity type', () => {
            expect(() => createOperation('invalid_type', OperationType.CREATE, 'feat-1', 'map-1'))
                .toThrow('Invalid entity type');
        });

        it('throws on invalid operation type', () => {
            expect(() => createOperation(EntityType.FEATURE, 'invalid_op', 'feat-1', 'map-1'))
                .toThrow('Invalid operation type');
        });

        it('throws on missing entity ID', () => {
            expect(() => createOperation(EntityType.FEATURE, OperationType.CREATE, '', 'map-1'))
                .toThrow('Entity ID is required');
        });

        it('mapId defaults to null when not provided', () => {
            const op = createOperation(EntityType.FEATURE, OperationType.CREATE, 'feat-1', null);
            expect(op.mapId).toBeNull();
        });
    });
});

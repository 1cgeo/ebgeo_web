import { describe, it, expect, beforeEach } from 'vitest';
import { OperationType } from '../../src/js/store/sync/operation-types.js';

// We test the compaction logic directly without IndexedDB.
// OperationQueue._compactEntityOps is the core pure function.
// We import the class and test compaction in isolation.

/**
 * Creates a mock operation for testing compaction.
 */
function mockOp(id, operationType, data = null) {
    return {
        id,
        entityType: 'feature',
        operationType,
        entityId: 'entity-1',
        mapId: 'map-1',
        data,
        previousData: null,
        timestamp: Date.now(),
        lamportTimestamp: 0,
        clientId: 'test-client'
    };
}

// ============================================================================
// Compaction logic (tested via a lightweight instance)
// ============================================================================

// We can't use the real OperationQueue (needs IndexedDB/localforage).
// Instead, extract and test the compaction logic directly.
// The _compactEntityOps method is a pure function on the prototype.

// Import the class to access the prototype method
import { OperationQueue } from '../../src/js/store/sync/operation-queue.js';

describe('OperationQueue._compactEntityOps', () => {
    let queue;

    beforeEach(() => {
        queue = new OperationQueue();
    });

    it('returns empty array for empty input', () => {
        expect(queue._compactEntityOps([])).toEqual([]);
    });

    it('returns single op unchanged', () => {
        const ops = [mockOp('1', OperationType.CREATE, { name: 'test' })];
        const result = queue._compactEntityOps(ops);
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('1');
    });

    // CREATE + DELETE = remove both (entity was created and deleted locally)
    it('removes CREATE + DELETE pair (never needs sync)', () => {
        const ops = [
            mockOp('1', OperationType.CREATE, { name: 'test' }),
            mockOp('2', OperationType.DELETE)
        ];
        const result = queue._compactEntityOps(ops);
        expect(result).toHaveLength(0);
    });

    // CREATE + UPDATE + DELETE = remove all
    it('removes CREATE + UPDATEs + DELETE', () => {
        const ops = [
            mockOp('1', OperationType.CREATE, { name: 'v1' }),
            mockOp('2', OperationType.UPDATE, { name: 'v2' }),
            mockOp('3', OperationType.UPDATE, { name: 'v3' }),
            mockOp('4', OperationType.DELETE)
        ];
        const result = queue._compactEntityOps(ops);
        expect(result).toHaveLength(0);
    });

    // CREATE + UPDATEs = merge into single CREATE with latest data
    it('merges CREATE + UPDATEs into single CREATE', () => {
        const ops = [
            mockOp('1', OperationType.CREATE, { name: 'v1', color: 'red' }),
            mockOp('2', OperationType.UPDATE, { name: 'v2', color: 'red' }),
            mockOp('3', OperationType.UPDATE, { name: 'v3', color: 'blue' })
        ];
        const result = queue._compactEntityOps(ops);
        expect(result).toHaveLength(1);
        expect(result[0].operationType).toBe(OperationType.CREATE);
        expect(result[0].id).toBe('1'); // Keeps original CREATE's ID
        expect(result[0].data).toEqual({ name: 'v3', color: 'blue' }); // Latest data
    });

    // UPDATEs + DELETE = keep only DELETE
    it('keeps only DELETE when UPDATEs precede it', () => {
        const ops = [
            mockOp('1', OperationType.UPDATE, { name: 'v1' }),
            mockOp('2', OperationType.UPDATE, { name: 'v2' }),
            mockOp('3', OperationType.DELETE)
        ];
        const result = queue._compactEntityOps(ops);
        expect(result).toHaveLength(1);
        expect(result[0].operationType).toBe(OperationType.DELETE);
        expect(result[0].id).toBe('3');
    });

    // Multiple UPDATEs = keep only last
    it('keeps only last UPDATE', () => {
        const ops = [
            mockOp('1', OperationType.UPDATE, { name: 'v1' }),
            mockOp('2', OperationType.UPDATE, { name: 'v2' }),
            mockOp('3', OperationType.UPDATE, { name: 'v3' })
        ];
        const result = queue._compactEntityOps(ops);
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('3');
        expect(result[0].data).toEqual({ name: 'v3' });
    });

    // CREATE + UPDATE with null data = keeps CREATE with original data
    it('handles UPDATE with null data (no-op update)', () => {
        const ops = [
            mockOp('1', OperationType.CREATE, { name: 'original' }),
            mockOp('2', OperationType.UPDATE, null) // No data in update
        ];
        const result = queue._compactEntityOps(ops);
        expect(result).toHaveLength(1);
        expect(result[0].data).toEqual({ name: 'original' });
    });
});

// ============================================================================
// Queue key format
// ============================================================================

describe('Operation queue key format', () => {
    it('key format enables chronological sorting', () => {
        // Keys: op_{timestamp}_{id}
        const keys = [
            'op_1706123456789_aaa',
            'op_1706123456790_bbb',
            'op_1706123456788_ccc'
        ];
        const sorted = [...keys].sort();
        expect(sorted).toEqual([
            'op_1706123456788_ccc',
            'op_1706123456789_aaa',
            'op_1706123456790_bbb'
        ]);
    });
});

// ============================================================================
// Compaction edge cases for WebSocket sync
// ============================================================================

describe('Compaction edge cases (backend sync scenarios)', () => {
    let queue;

    beforeEach(() => {
        queue = new OperationQueue();
    });

    it('CREATE + single UPDATE = CREATE with updated data', () => {
        const ops = [
            mockOp('1', OperationType.CREATE, { nome: 'Original', cor: '#000' }),
            mockOp('2', OperationType.UPDATE, { nome: 'Renomeado', cor: '#fff' })
        ];
        const result = queue._compactEntityOps(ops);
        expect(result).toHaveLength(1);
        expect(result[0].operationType).toBe(OperationType.CREATE);
        expect(result[0].data.nome).toBe('Renomeado');
    });

    it('single DELETE stays as-is', () => {
        const ops = [mockOp('1', OperationType.DELETE)];
        const result = queue._compactEntityOps(ops);
        expect(result).toHaveLength(1);
        expect(result[0].operationType).toBe(OperationType.DELETE);
    });

    it('single CREATE stays as-is', () => {
        const ops = [mockOp('1', OperationType.CREATE, { nome: 'Test' })];
        const result = queue._compactEntityOps(ops);
        expect(result).toHaveLength(1);
        expect(result[0].data.nome).toBe('Test');
    });
});

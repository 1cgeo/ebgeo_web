// Path: tests/unit/compactacao-id-nao-unico.test.js
import { describe, it, expect } from 'vitest';
import { OperationQueue } from '../../src/js/store/sync/operation-queue.js';
import { EntityType, OperationType } from '../../src/js/store/sync/operation-types.js';

describe('Maintenance preserves all entity types, including partial settings', () => {
    it.each(Object.values(EntityType))('preserves independent patches for %s', entityType => {
        const queue = new OperationQueue();
        const ops = [
            { id: 'a', entityType, operationType: OperationType.UPDATE, entityId: 'shared', data: { name: 'one' } },
            { id: 'b', entityType, operationType: OperationType.UPDATE, entityId: 'shared', data: { visible: false } },
        ];
        expect(queue._compactEntityOps(ops)).toEqual(ops);
        expect(ops[0].data).toEqual({ name: 'one' });
    });
});

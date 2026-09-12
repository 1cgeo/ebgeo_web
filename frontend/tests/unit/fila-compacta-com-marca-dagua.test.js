// Path: tests/unit/fila-compacta-com-marca-dagua.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { queueMap, leituras } = vi.hoisted(() => ({
    queueMap: new Map(),
    leituras: { keys: 0, getItem: 0 },
}));

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            setItem: async (k, v) => { queueMap.set(k, v); },
            getItem: async (k) => { leituras.getItem++; return queueMap.get(k) ?? null; },
            removeItem: async (k) => { queueMap.delete(k); },
            keys: async () => { leituras.keys++; return [...queueMap.keys()]; },
            clear: async () => { queueMap.clear(); },
        }),
    },
}));

import { OperationQueue } from '../../src/js/store/sync/operation-queue.js';
import { OperationType, EntityType } from '../../src/js/store/sync/operation-types.js';

/**
 * @param {number} i - Sequence number, also the fixed-width timestamp offset.
 * @param {string} tipo - Operation type.
 * @param {number} [entidade=i] - Entity the operation describes.
 * @returns {Object} A queue envelope.
 */
function op(i, tipo, entidade = i) {
    return {
        id: `op-${String(i).padStart(6, '0')}`,
        entityType: EntityType.FEATURE,
        operationType: tipo,
        entityId: `feat-${entidade}`,
        mapId: 'map-1',
        data: { nome: `v${i}` },
        previousData: null,
        // 13-digit fixed width: the key sort is lexicographic and has to match chronology.
        timestamp: 1700000000000 + i,
        lamportTimestamp: 0,
        clientId: 'test-client',
    };
}

let queue;

beforeEach(() => {
    queueMap.clear();
    leituras.keys = 0;
    leituras.getItem = 0;
    queue = new OperationQueue();
});

describe('Unconfirmed operations are immutable even above 10000 entries', () => {
    it('does no full-queue maintenance during a 12000-operation burst', async () => {
        const compact = vi.spyOn(queue, '_compact');
        for (let i = 0; i < 12000; i++) await queue.enqueue(op(i, OperationType.CREATE));
        expect(compact).not.toHaveBeenCalled();
        expect(leituras.keys).toBe(0);
        expect(leituras.getItem).toBeLessThanOrEqual(36000);
        expect(await queue.count()).toBe(12000);
    });

    it('keeps CREATE, every UPDATE and DELETE unchanged across explicit maintenance', async () => {
        const operations = Array.from({ length: 10002 }, (_, i) => op(i, i === 0
            ? OperationType.CREATE : i === 10001 ? OperationType.DELETE : OperationType.UPDATE, 1));
        await queue.enqueueAll(operations);
        await queue._compact();
        expect(await queue.getAll()).toEqual(operations);
        expect(await queue.purgeOldOperations(0)).toBe(0);
        expect(await queue.getAll()).toEqual(operations);
    });
});

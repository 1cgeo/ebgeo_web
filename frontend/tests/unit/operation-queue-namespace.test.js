import { describe, it, expect, vi } from 'vitest';

// The outbound queue is one of the two GLOBAL databases of the namespace layout: the
// operation envelope carries no atlas id, so a queue per atlas would record the atlas
// where nobody reads it, and a queue keyed by remote atlas id would be persistent,
// editable server residue. These tests pin the two properties that follow from that:
// the queue resolves to `ebgeo`/`operation_queue` with NO scope active (it is touched at
// boot, before initLocalAtlases picks one), and a switch of atlas does not re-point it.

const { dbs, createdWith, makeStore, resetFake } = vi.hoisted(() => {
    const dbs = new Map();
    const createdWith = [];

    function keyOf(name, storeName) {
        return `${name}::${storeName || 'keyvaluepairs'}`;
    }

    function makeStore({ name, storeName = null }) {
        createdWith.push({ name, storeName });
        const key = keyOf(name, storeName);
        const backing = dbs.get(key) ?? new Map();
        dbs.set(key, backing);
        return {
            setItem: async (k, v) => { backing.set(k, v); return v; },
            getItem: async (k) => (backing.has(k) ? backing.get(k) : null),
            removeItem: async (k) => { backing.delete(k); },
            keys: async () => [...backing.keys()],
            clear: async () => { backing.clear(); }
        };
    }

    function resetFake() {
        dbs.clear();
        createdWith.length = 0;
    }

    return { dbs, createdWith, makeStore, resetFake };
});

vi.mock('localforage', () => ({
    default: {
        createInstance: vi.fn(makeStore),
        dropInstance: vi.fn(async () => {})
    }
}));

const QUEUE_DB_KEY = 'ebgeo::operation_queue';

/** Both modules keep module-level state (the instance cache). */
async function loadFresh() {
    vi.resetModules();
    resetFake();
    const namespace = await import('../../src/js/store/atlas-namespace.js');
    const queue = await import('../../src/js/store/sync/operation-queue.js');
    return { namespace, queue: new queue.OperationQueue() };
}

/**
 * @param {string} id
 * @returns {Object} A minimal operation envelope.
 */
function createOp(id) {
    return {
        id,
        entityType: 'feature',
        operationType: 'create',
        entityId: `entity-${id}`,
        mapId: 'map-1',
        data: { nome: 'Ponto' },
        previousData: null,
        timestamp: 1700000000000,
        lamportTimestamp: 1,
        clientId: 'client-1'
    };
}

describe('operation queue under the namespace factory', () => {
    it('writes to ebgeo/operation_queue with NO active scope (boot path)', async () => {
        const { namespace, queue } = await loadFresh();
        expect(namespace.getActiveScope()).toBeNull();

        await queue.enqueue(createOp('op-1'));

        expect(createdWith).toEqual([{ name: 'ebgeo', storeName: 'operation_queue' }]);
        expect([...dbs.get(QUEUE_DB_KEY).keys()]).toEqual(['op_1700000000000_op-1']);
    });

    it('is NOT re-pointed by a switch of local atlas', async () => {
        const { namespace, queue } = await loadFresh();
        namespace.activateScope(namespace.localScope('atlas-a', 'aaa'));
        await queue.enqueue(createOp('op-1'));

        namespace.activateScope(namespace.localScope('atlas-b', 'bbb'));
        await queue.enqueue(createOp('op-2'));

        // One database, two operations: no `ebgeo__aaa` / `ebgeo__bbb` anywhere.
        expect([...dbs.keys()]).toEqual([QUEUE_DB_KEY]);
        const all = await queue.getAll();
        expect(all.map(op => op.id)).toEqual(['op-1', 'op-2']);
    });

    it('is NOT re-pointed by the remote scratch scope either', async () => {
        const { namespace, queue } = await loadFresh();
        namespace.activateScope(namespace.remoteScope('server-atlas-1'));

        await queue.enqueue(createOp('op-1'));

        expect([...dbs.keys()]).toEqual([QUEUE_DB_KEY]);
        expect(await queue.count()).toBe(1);
    });

    it('clear() empties the queue for every scope, because there is only one', async () => {
        const { namespace, queue } = await loadFresh();
        namespace.activateScope(namespace.localScope('atlas-a', 'aaa'));
        await queue.enqueueAll([createOp('op-1'), createOp('op-2')]);
        expect(await queue.count()).toBe(2);

        namespace.activateScope(namespace.localScope('atlas-b', 'bbb'));
        await queue.clear();

        namespace.activateScope(namespace.localScope('atlas-a', 'aaa'));
        expect(await queue.count()).toBe(0);
        expect(dbs.get(QUEUE_DB_KEY).size).toBe(0);
    });
});

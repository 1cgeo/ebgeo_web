import 'fake-indexeddb/auto';
import { afterEach, it, expect, vi } from 'vitest';
import { activateScope, getStoreFor, remoteScope, StoreName } from '../../src/js/store/atlas-namespace.js';
import { OperationQueue } from '../../src/js/store/sync/operation-queue.js';
import { enableOperationLogging, disableOperationLogging, logOperation, logBatchOperations } from '../../src/js/store/sync/operation-dispatcher.js';
import { discardRemoteWrites, reopenRemoteWrites } from '../../src/js/store/remote-write-fence.js';

afterEach(() => { disableOperationLogging(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each(['single', 'batch'])('keeps the original identity, payload and destination on a delayed %s retry', async mode => {
    const a = remoteScope('aaaa1111-1111-4111-8111-111111111111');
    const b = remoteScope('bbbb2222-2222-4222-8222-222222222222');
    const rawA = getStoreFor(StoreName.OPERATION_QUEUE, a);
    const rawB = getStoreFor(StoreName.OPERATION_QUEUE, b);
    await rawA.clear();
    await rawB.clear();
    activateScope(a);
    const payload = { name: 'original' };
    const method = mode === 'single' ? 'enqueue' : 'enqueueAll';
    const enqueue = vi.spyOn(OperationQueue.prototype, method).mockRejectedValueOnce(new Error('quota'));
    let retry;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(fn => { retry = fn; return 1; });
    enableOperationLogging();
    if (mode === 'single') await logOperation('map', 'create', 'map-id', null, payload);
    else await logBatchOperations([{ entityType: 'map', operationType: 'create', entityId: 'map-id', data: payload }]);
    expect(enqueue).toHaveBeenCalledTimes(1);
    const original = mode === 'single' ? enqueue.mock.calls[0][0] : enqueue.mock.calls[0][0][0];
    expect(retry).toBeTypeOf('function');
    payload.name = 'changed after failure';
    activateScope(b);
    await retry();
    const result = await new OperationQueue(a).getAll();
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(original);
    expect(result[0].data.name).toBe('original');
    expect(result[0].scopeSuffix).toBe(a.dbSuffix);
    expect(await new OperationQueue(b).getAll()).toEqual([]);
});

it('does not revive a discarded operation when its retry runs after a new login', async () => {
    const values = new Map();
    vi.stubGlobal('localStorage', {
        getItem: key => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, String(value)),
    });
    const a = remoteScope('cccc3333-3333-4333-8333-333333333333');
    const raw = getStoreFor(StoreName.OPERATION_QUEUE, a);
    await raw.clear();
    activateScope(a);
    vi.spyOn(OperationQueue.prototype, 'enqueue').mockRejectedValueOnce(new Error('quota'));
    let retry;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(fn => { retry = fn; return 1; });
    enableOperationLogging();
    await logOperation('map', 'create', 'abandoned-map', null, { name: 'abandoned' });
    expect(retry).toBeTypeOf('function');
    discardRemoteWrites(a);
    await raw.clear();
    const fresh = remoteScope(a.atlasId);
    reopenRemoteWrites(fresh);
    activateScope(fresh);
    await new OperationQueue(fresh).enqueue({ id: 'new-session', data: { fresh: true } });
    await retry();
    expect(await new OperationQueue(fresh).getAll()).toEqual([{ id: 'new-session', data: { fresh: true } }]);
});

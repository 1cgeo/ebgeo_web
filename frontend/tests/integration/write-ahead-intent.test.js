import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { activateScope, remoteScope } from '../../src/js/store/atlas-namespace.js';
import { runTransaction } from '../../src/js/store/store-transaction.js';
import { operationQueue } from '../../src/js/store/sync/operation-queue.js';
import { enableOperationLogging, disableOperationLogging } from '../../src/js/store/sync/operation-dispatcher.js';

const atlasId = '11111111-1111-4111-8111-111111111111';
const mapId = '22222222-2222-4222-8222-222222222222';
const entityId = '33333333-3333-4333-8333-333333333333';

beforeEach(async () => {
    vi.restoreAllMocks();
    activateScope(remoteScope(atlasId));
    await operationQueue.clear();
    enableOperationLogging();
});

describe('Write-ahead edit intention', () => {
    it('intention is durable but not flushable before entity materialization', async () => {
        await runTransaction(async tx => {
            tx.recordOperation('feature', 'create', entityId, mapId, { properties: { id: entityId } });
            return async () => {
                expect(await operationQueue.count()).toBe(1);
                expect(await operationQueue.peek()).toEqual([]);
            };
        });
        expect(await operationQueue.peek()).toHaveLength(1);
    });

    it('a failed entity write preserves the intention for idempotent recovery', async () => {
        const effect = vi.fn();
        await expect(runTransaction(async tx => {
            tx.recordOperation('feature', 'create', entityId, mapId, { properties: { id: entityId } });
            tx.deferSync(effect);
            return async () => { throw new Error('cut after journal'); };
        })).rejects.toThrow('cut after journal');
        expect(effect).not.toHaveBeenCalled();
        const pending = await operationQueue.getAll();
        expect(pending).toHaveLength(1);
        expect(await operationQueue.peek()).toEqual([]);
        await operationQueue.markMaterialized(pending);
        expect((await operationQueue.peek())[0].id).toBe(pending[0].id);
    });

    it('a failed journal batch prevents entity and UI writes', async () => {
        const persist = vi.fn();
        const effect = vi.fn();
        await expect(runTransaction(async tx => {
            tx.recordOperation('feature', 'create', entityId, mapId, { invalid: () => {} });
            tx.deferSync(effect);
            return persist;
        })).rejects.toThrow();
        expect(persist).not.toHaveBeenCalled();
        expect(effect).not.toHaveBeenCalled();
        expect(await operationQueue.count()).toBe(0);
    });

    it('local editing without logging does not create a remote intention', async () => {
        disableOperationLogging();
        const persist = vi.fn();
        await runTransaction(async tx => {
            tx.recordOperation('feature', 'create', entityId, mapId, {});
            return persist;
        });
        expect(persist).toHaveBeenCalledOnce();
        expect(await operationQueue.count()).toBe(0);
    });
});

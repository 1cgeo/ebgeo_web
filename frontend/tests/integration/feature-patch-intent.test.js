import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { featureMutationContract } from '../../src/js/store/sync/feature-patch.js';
import { activateScope, getStoreFor, remoteScope, StoreName } from '../../src/js/store/atlas-namespace.js';
import { persistOperationIntents, enableOperationLogging, disableOperationLogging } from '../../src/js/store/sync/operation-dispatcher.js';
import { OperationQueue } from '../../src/js/store/sync/operation-queue.js';

afterEach(() => disableOperationLogging());
const feature = (name, extra = {}) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [1, 2] },
    properties: { id: '55555555-5555-4555-8555-555555555555', source: 'point', name, ...extra } });

describe('Feature intent contract', () => {
    it('sends changed units and ignores local timestamp/version bookkeeping', () => {
        const before = feature('Original', { confirmedVersion: 7, version: 9, updatedAt: 10, color: 'blue' });
        const after = feature('Novo', { confirmedVersion: 7, version: 10, updatedAt: 20 });
        expect(featureMutationContract('update', after, before)).toEqual({
            protocolVersion: 2, baseVersion: 7,
            patch: [
                { op: 'set', path: ['properties', 'name'], value: 'Novo' },
                { op: 'remove', path: ['properties', 'color'] },
            ],
        });
        expect(featureMutationContract('update', after, feature('Antigo', { version: 99 })).baseVersion).toBeNull();
    });

    it('links subsequent offline edits to the durable predecessor across queue handles', async () => {
        const scope = remoteScope('66666666-6666-4666-8666-666666666666');
        activateScope(scope);
        await getStoreFor(StoreName.OPERATION_QUEUE, scope).clear();
        enableOperationLogging();
        const first = feature('Primeira');
        const second = feature('Segunda');
        const descriptor = (type, data, previousData = null) => ({ entityType: 'feature', operationType: type,
            entityId: first.properties.id, mapId: '77777777-7777-4777-8777-777777777777', data, previousData });
        const finishCreate = await persistOperationIntents([descriptor('create', first)], { scope });
        await finishCreate();
        const prior = (await new OperationQueue(scope).getAll())[0];
        const finishUpdate = await persistOperationIntents([descriptor('update', second, first)], { scope });
        await finishUpdate();
        const pending = await new OperationQueue(scope).peek();
        expect(pending).toHaveLength(2);
        expect(pending[1].baseVersion).toBeNull();
        expect(pending[1].baseOperationId).toBe(prior.id);
        expect(pending[1].dependsOn).toEqual([prior.id]);
    });
});

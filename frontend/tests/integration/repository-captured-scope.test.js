import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { activateScope, getStoreFor, remoteScope, StoreName } from '../../src/js/store/atlas-namespace.js';
import { localRepository } from '../../src/js/store/repositories/local.repository.js';

afterEach(() => vi.restoreAllMocks());

describe('Repository destination across asynchronous work', () => {
    it('keeps a write in its original atlas when scope changes during name resolution', async () => {
        const a = remoteScope('11111111-1111-4111-8111-111111111111');
        const b = remoteScope('22222222-2222-4222-8222-222222222222');
        const mapsA = getStoreFor(StoreName.MAPS, a);
        const settingsA = getStoreFor(StoreName.SETTINGS, a);
        const settingsB = getStoreFor(StoreName.SETTINGS, b);
        await Promise.all([mapsA.clear(), settingsA.clear(), settingsB.clear()]);
        activateScope(a);
        let release;
        let reached;
        const waiting = new Promise(resolve => { reached = resolve; });
        const barrier = new Promise(resolve => { release = resolve; });
        vi.spyOn(mapsA, 'getItem').mockImplementationOnce(async () => {
            reached();
            await barrier;
            return { id: 'original', name: 'Principal' };
        });
        const write = localRepository.saveGridStyle('Principal', { format: 'UTM' });
        await waiting;
        activateScope(b);
        release();
        await write;
        expect(await settingsA.getItem('gridStyle_Principal')).toEqual({ format: 'UTM' });
        expect(await settingsB.keys()).toEqual([]);
        await localRepository.saveGridStyle('Novo', { format: 'MGRS' });
        expect(await settingsB.getItem('gridStyle_Novo')).toEqual({ format: 'MGRS' });
    });
});

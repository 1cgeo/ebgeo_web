import 'fake-indexeddb/auto';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { activateScope, getStoreFor, getGlobalStore, remoteScope, localScope, StoreName } from '../../src/js/store/atlas-namespace.js';
import { registerRemoteAtlas, requestRemoteAtlasDiscard } from '../../src/js/store/remote-atlas.api.js';
import { LocalRepository, getScopedStore } from '../../src/js/store/repositories/local.repository.js';
import { OperationQueue } from '../../src/js/store/sync/operation-queue.js';
import { captureRemoteWriteFence, discardRemoteWrites, reopenRemoteWrites } from '../../src/js/store/remote-write-fence.js';

const atlasId = 'aaaa1111-1111-4111-8111-111111111111';

beforeEach(async () => {
    const values = new Map();
    vi.stubGlobal('localStorage', {
        getItem: key => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, String(value)),
        removeItem: key => values.delete(key),
    });
    await getGlobalStore().clear();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('blocks a repository write delayed across discard and a fresh mount, preserving the new content', async () => {
    const oldScope = remoteScope(atlasId);
    activateScope(oldScope);
    const repo = new LocalRepository(oldScope);
    const legacyHandle = getScopedStore(StoreName.SETTINGS);
    const maps = getStoreFor(StoreName.MAPS, oldScope);
    const settings = getStoreFor(StoreName.SETTINGS, oldScope);
    await maps.clear();
    await settings.clear();
    let release;
    let reached;
    const waiting = new Promise(resolve => { reached = resolve; });
    const barrier = new Promise(resolve => { release = resolve; });
    vi.spyOn(maps, 'getItem').mockImplementationOnce(async () => {
        reached();
        await barrier;
        return { id: 'map', name: 'Principal' };
    });
    const late = repo.saveGridStyle('Principal', { old: true });
    const rejected = expect(late).rejects.toMatchObject({ name: 'AbortError' });
    await waiting;
    discardRemoteWrites(oldScope);
    await settings.clear();
    const freshScope = remoteScope(atlasId);
    reopenRemoteWrites(freshScope);
    activateScope(freshScope);
    await new LocalRepository(freshScope).saveGridStyle('Principal', { fresh: true });
    release();
    await rejected;
    expect(await settings.getItem('gridStyle_Principal')).toEqual({ fresh: true });
    await expect(repo.saveSetting('late', true)).rejects.toMatchObject({ name: 'AbortError' });
    await expect(repo.clearAll()).rejects.toMatchObject({ name: 'AbortError' });
    await expect(legacyHandle.removeItem('gridStyle_Principal')).rejects.toMatchObject({ name: 'AbortError' });
    expect(await settings.getItem('gridStyle_Principal')).toEqual({ fresh: true });
});

it('rejects a queued journal callback after discard even when a new queue already holds the same id', async () => {
    const oldScope = remoteScope(atlasId);
    activateScope(oldScope);
    const queue = new OperationQueue(oldScope);
    const raw = getStoreFor(StoreName.OPERATION_QUEUE, oldScope);
    await raw.clear();
    const originalOpen = indexedDB.open;
    let release;
    let reached;
    const barrier = new Promise(resolve => { release = resolve; });
    const opened = new Promise(resolve => { reached = resolve; });
    vi.spyOn(indexedDB, 'open').mockImplementation(function (...args) {
        const request = originalOpen.apply(this, args);
        return new Proxy(request, {
            get: (target, key) => Reflect.get(target, key, target),
            set(target, key, value) {
                if (key === 'onsuccess') {
                    target.onsuccess = event => { reached(); barrier.then(() => value.call(target, event)); };
                    return true;
                }
                return Reflect.set(target, key, value, target);
            },
        });
    });
    const late = queue.enqueue({ id: 'same-id', data: { old: true } });
    const rejected = expect(late).rejects.toMatchObject({ name: 'AbortError' });
    try {
        await opened;
        vi.restoreAllMocks();
        discardRemoteWrites(oldScope);
        await raw.clear();
        const freshScope = remoteScope(atlasId);
        reopenRemoteWrites(freshScope);
        activateScope(freshScope);
        const fresh = new OperationQueue(freshScope);
        await fresh.enqueue({ id: 'same-id', data: { fresh: true } });
        release();
        await rejected;
        await expect(queue.dequeue(['same-id'])).rejects.toMatchObject({ name: 'AbortError' });
        expect(await fresh.getAll()).toEqual([{ id: 'same-id', data: { fresh: true } }]);
        expect(await raw.getItem('__journal_sequence__')).toBe(1);
    } finally {
        vi.restoreAllMocks();
        release();
    }
});

it('recovers a persisted discard even if writing the asynchronous registry failed', async () => {
    const { scope } = await registerRemoteAtlas(atlasId);
    activateScope(scope);
    const oldWriter = captureRemoteWriteFence(scope);
    const queue = getStoreFor(StoreName.OPERATION_QUEUE, scope);
    await queue.setItem('op_pending', { old: true });
    vi.spyOn(getGlobalStore(), 'setItem').mockRejectedValueOnce(new Error('registry quota'));
    await expect(requestRemoteAtlasDiscard()).rejects.toThrow('registry quota');
    expect(oldWriter).toThrow();
    const fresh = await registerRemoteAtlas(atlasId);
    activateScope(fresh.scope);
    expect(await queue.keys()).toEqual([]);
    expect(oldWriter).toThrow();
    expect(captureRemoteWriteFence(fresh.scope)).not.toThrow();
});

it('keeps ordinary local, adopted local and other remote repositories writable', async () => {
    const adopted = new LocalRepository(localScope('adopted', 'remote-' + atlasId));
    const ordinary = new LocalRepository(localScope('ordinary', 'ordinary-fence'));
    const other = new LocalRepository(remoteScope('bbbb2222-2222-4222-8222-222222222222'));
    discardRemoteWrites(remoteScope(atlasId));
    await adopted.saveSetting('proof', 'adopted');
    await ordinary.saveSetting('proof', 'ordinary');
    await other.saveSetting('proof', 'other');
    expect(await adopted.getSetting('proof')).toBe('adopted');
    expect(await ordinary.getSetting('proof')).toBe('ordinary');
    expect(await other.getSetting('proof')).toBe('other');
});

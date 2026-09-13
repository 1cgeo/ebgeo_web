import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { activateScope, getActiveScope, remoteScope } from '../../src/js/store/atlas-namespace.js';
import { LocalRepository, localRepository } from '../../src/js/store/repositories/local.repository.js';
import { setRepository } from '../../src/js/store/repositories/index.js';
import { operationQueue } from '../../src/js/store/sync/operation-queue.js';
import { enableOperationLogging } from '../../src/js/store/sync/operation-dispatcher.js';
import { memoryStore } from '../../src/js/store/memory-store.js';
import { mapResolver } from '../../src/js/store/services/map-resolver.service.js';
import { addCatalogLayer, updateCatalogLayer, removeCatalogLayer } from '../../src/js/store/catalog.operations.js';
import { applyRemoteOperation, applyRemoteSnapshot, setRemoteHandlerEventBus } from '../../src/js/store/sync/remote-operation-handler.js';
import { createAtlas } from '../../src/js/store/atlas/atlas.entity.js';

vi.mock('../../src/js/store/sync/permission-guard.js', async importOriginal => ({
    ...await importOriginal(), checkPermission: () => ({ allowed: true })
}));

let mapA;
let mapB;
beforeEach(async () => {
    vi.restoreAllMocks();
    const storage = new Map();
    vi.stubGlobal('localStorage', {
        getItem: key => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, String(value)),
        removeItem: key => storage.delete(key)
    });
    activateScope(remoteScope(crypto.randomUUID()));
    // A bound repository keeps the fault injection on the method actually used by the producer.
    setRepository(new LocalRepository(getActiveScope()));
    enableOperationLogging();
    setRemoteHandlerEventBus({ emit: vi.fn() });
    mapA = { id: crypto.randomUUID(), name: 'Ativo', features: {}, catalogLayers: [] };
    mapB = { id: crypto.randomUUID(), name: 'Destino', features: {}, catalogLayers: [] };
    await localRepository.saveMap(mapA.id, mapA);
    await localRepository.saveMap(mapB.id, mapB);
    mapResolver.registerMap(mapA.name, mapA.id);
    mapResolver.registerMap(mapB.name, mapB.id);
    memoryStore.currentMap = mapA.name;
    memoryStore.lockedMaps.clear();
});

describe('Catalog write-ahead persistence', () => {
    it('inbound identity comes from the envelope, including payload-free deletion', async () => {
        const apply = (operationType, data) => applyRemoteOperation({
            id: crypto.randomUUID(), entityType: 'catalogLayer', entityId: 'hillshade',
            mapId: mapB.id, operationType, data
        });
        await apply('create', { type: 'hillshade', opacity: 0.8 });
        await apply('update', { id: 'wrong', type: 'hillshade', opacity: 0.3 });
        expect((await localRepository.getMap(mapB.id)).catalogLayers).toEqual([
            { id: 'hillshade', type: 'hillshade', opacity: 0.3 }
        ]);
        await apply('delete', null);
        expect((await localRepository.getMap(mapB.id)).catalogLayers).toEqual([]);
    });

    it('create, update and delete journal the target map before its document is saved', async () => {
        const originalSave = LocalRepository.prototype.saveMap;
        const seen = new Set();
        vi.spyOn(LocalRepository.prototype, 'saveMap').mockImplementation(async function (id, value) {
            const fresh = (await operationQueue.getAll()).filter(op => !seen.has(op.id));
            expect(fresh).toHaveLength(1);
            expect(fresh[0].mapId).toBe(mapB.id);
            expect(fresh[0].entityType).toBe('catalogLayer');
            expect((await operationQueue.peek()).some(op => op.id === fresh[0].id)).toBe(false);
            seen.add(fresh[0].id);
            return originalSave.call(this, id, value);
        });
        await addCatalogLayer({ id: 'hillshade', type: 'hillshade', visible: true }, mapB.name);
        await updateCatalogLayer('hillshade', { opacity: 0.4 }, mapB.name);
        await removeCatalogLayer('hillshade', mapB.name);
        expect(seen.size).toBe(3);
        expect((await operationQueue.getAll()).map(op => op.operationType)).toEqual(['create', 'update', 'delete']);
        expect((await localRepository.getMap(mapA.id)).catalogLayers).toEqual([]);
        expect((await localRepository.getMap(mapB.id)).catalogLayers).toEqual([]);
    });

    it('journal failure never changes the map or the caller layer', async () => {
        const layer = { id: 'hillshade', type: 'hillshade', styleOverrides: { invalid: () => {} } };
        const persist = vi.spyOn(LocalRepository.prototype, 'saveMap');
        await expect(addCatalogLayer(layer, mapB.name)).rejects.toThrow();
        expect(persist).not.toHaveBeenCalled();
        expect(await operationQueue.count()).toBe(0);
        expect(layer.styleOverrides.invalid).toBeTypeOf('function');
    });

    it('a missing remote map is not synthesized from the compatibility fallback', async () => {
        const missingId = crypto.randomUUID();
        await expect(addCatalogLayer({ id: 'hillshade', type: 'hillshade' }, missingId)).rejects.toThrow('identidade remota');
        expect(await localRepository.getMap(missingId)).toBeNull();
        expect(await operationQueue.count()).toBe(0);
    });

    it('quota after the journal keeps the original intent and snapshot recovers it once', async () => {
        vi.spyOn(LocalRepository.prototype, 'saveMap').mockRejectedValueOnce(new DOMException('quota', 'QuotaExceededError'));
        await expect(addCatalogLayer({ id: 'hillshade', type: 'hillshade', opacity: 0.7 }, mapB.name)).rejects.toThrow('quota');
        const pending = await operationQueue.getAll();
        expect(pending).toHaveLength(1);
        expect(await operationQueue.peek()).toEqual([]);
        expect((await localRepository.getMap(mapB.id)).catalogLayers).toEqual([]);
        vi.restoreAllMocks();
        const snapshot = { atlas: { ...createAtlas('Atlas'), id: getActiveScope().atlasId },
            maps: [mapA, mapB], briefings: [], currentVersion: 1 };
        await applyRemoteSnapshot(snapshot);
        const recovered = await localRepository.getMap(mapB.id);
        expect(recovered.catalogLayers).toHaveLength(1);
        expect(recovered.catalogLayers[0].opacity).toBe(0.7);
        expect((await operationQueue.peek()).map(op => op.id)).toEqual(pending.map(op => op.id));
        await applyRemoteSnapshot(snapshot);
        expect((await localRepository.getMap(mapB.id)).catalogLayers).toHaveLength(1);
        expect(await operationQueue.getAll()).toEqual(pending);
    });

    it('concurrent additions preserve every catalog reference in the map', async () => {
        const ids = Array.from({ length: 8 }, () => 'data-' + crypto.randomUUID());
        await Promise.all(ids.map(id => addCatalogLayer({ id, type: 'data_layer', visible: true }, mapB.name)));
        expect(new Set((await localRepository.getMap(mapB.id)).catalogLayers.map(layer => layer.id))).toEqual(new Set(ids));
        expect((await operationQueue.getAll()).map(op => op.mapId)).toEqual(ids.map(() => mapB.id));
    });

    it('a scope change during the read cannot write either atlas', async () => {
        const source = getActiveScope();
        let release;
        let entered;
        const reading = new Promise(resolve => { entered = resolve; });
        const gate = new Promise(resolve => { release = resolve; });
        vi.spyOn(LocalRepository.prototype, 'getMap').mockImplementationOnce(async () => {
            entered(); await gate; return structuredClone(mapB);
        });
        const write = addCatalogLayer({ id: 'hillshade', type: 'hillshade' }, mapB.name);
        const rejected = expect(write).rejects.toThrow('atlas mudou');
        await reading;
        activateScope(remoteScope(crypto.randomUUID()));
        release();
        await rejected;
        expect(await operationQueue.forScope(source).getAll()).toEqual([]);
        expect(await operationQueue.count()).toBe(0);
        expect((await localRepository.forScope(source).getMap(mapB.id)).catalogLayers).toEqual([]);
    });
});

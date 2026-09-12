// Path: tests/integration/snapshot-generation.test.js
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activateScope, getActiveScope, remoteScope, StoreName, getStoreFor, clearAtlasDatabases } from '../../src/js/store/atlas-namespace.js';
import { localRepository, LocalRepository, getEmptyMapData } from '../../src/js/store/repositories/local.repository.js';
import { readGeneration } from '../../src/js/store/namespace-generation.js';
import { createAtlas } from '../../src/js/store/atlas/atlas.entity.js';
import { applyRemoteSnapshot, applyRemoteOperation, markLocalEditPending, setRemoteHandlerEventBus } from '../../src/js/store/sync/remote-operation-handler.js';
import { operationQueue } from '../../src/js/store/sync/operation-queue.js';
import { beginStoreWrite } from '../../src/js/store/write-coordinator.js';

const atlasId = '51000000-0000-4000-8000-000000000001';
const mapId = '51000000-0000-4000-8000-000000000002';
const featureId = '51000000-0000-4000-8000-000000000003';
let scope;
let bus;
const storage = new Map();
const map = name => ({ ...getEmptyMapData(), id: mapId, name });
const snapshot = () => ({ atlas: { ...createAtlas('Remoto'), id: atlasId }, maps: [map('Servidor')], briefings: [], currentVersion: 19 });

beforeEach(async () => {
    vi.restoreAllMocks();
    vi.stubGlobal('localStorage', {
        getItem: key => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, String(value)),
        removeItem: key => storage.delete(key),
    });
    scope = remoteScope(atlasId);
    activateScope(scope);
    await clearAtlasDatabases(scope);
    const atlas = { ...createAtlas('Anterior'), id: atlasId };
    await localRepository.saveAtlas(atlas);
    await localRepository.saveMap(mapId, map('Anterior'));
    bus = { emit: vi.fn() };
    setRemoteHandlerEventBus(bus);
});
afterEach(() => vi.restoreAllMocks());

describe('Snapshot generation commit with native IndexedDB', () => {
    it('leaves the complete previous generation and cursor visible after a mid-write failure', async () => {
        const previous = readGeneration(scope);
        const save = LocalRepository.prototype.saveMap;
        vi.spyOn(LocalRepository.prototype, 'saveMap').mockImplementation(async function (...args) {
            await save.apply(this, args);
            if (this.scope.dataGeneration !== previous.active) throw new Error('cut after staged map');
        });
        await expect(applyRemoteSnapshot(snapshot())).rejects.toThrow('cut after staged map');
        expect((await localRepository.getMap(mapId)).name).toBe('Anterior');
        expect(readGeneration(scope).active).toBe(previous.active);
        expect(readGeneration(scope).cursor).toBe(previous.cursor);
        expect(bus.emit).not.toHaveBeenCalled();
    });

    it('activates complete data and cursor together and recovers a prepared intention with its original ID', async () => {
        const previous = localRepository.forScope(scope);
        const op = { id: 'prepared-survives', entityType: 'feature', operationType: 'create', entityId: featureId, mapId,
            data: { type: 'Feature', geometry: { type: 'Point', coordinates: [1, 2] }, properties: { id: featureId, source: 'point' } } };
        await operationQueue.enqueueAll([op], { prepared: true });
        expect(await operationQueue.peek()).toEqual([]);
        await applyRemoteSnapshot(snapshot());
        expect(readGeneration(scope).cursor).toBe(19);
        expect((await previous.getMap(mapId)).name).toBe('Anterior');
        // A new repository handle represents re-opening the browser against the durable pointer.
        const reopened = new LocalRepository(scope);
        const activeMap = await reopened.getMap(mapId);
        expect(activeMap.name).toBe('Servidor');
        expect(activeMap.features.points.map(f => f.properties.id)).toEqual([featureId]);
        expect((await operationQueue.peek()).map(item => item.id)).toEqual([op.id]);
        expect(bus.emit).toHaveBeenCalled();
    });

    it('does not activate prepared data if the mounted atlas changes during preparation', async () => {
        const previous = readGeneration(scope);
        const save = LocalRepository.prototype.saveMap;
        vi.spyOn(LocalRepository.prototype, 'saveMap').mockImplementation(async function (...args) {
            await save.apply(this, args);
            if (this.scope.dataGeneration !== previous.active) activateScope(remoteScope('another-atlas'));
        });
        await expect(applyRemoteSnapshot(snapshot())).rejects.toMatchObject({ name: 'AbortError' });
        expect(readGeneration(scope).active).toBe(previous.active);
        expect(await getStoreFor(StoreName.MAPS, getActiveScope()).keys()).toEqual([]);
        expect(bus.emit).not.toHaveBeenCalled();
    });

    it('rejects an incomplete response before registering a preparation', async () => {
        const previous = readGeneration(scope);
        await expect(applyRemoteSnapshot({ ...snapshot(), briefings: undefined })).rejects.toThrow('incompleto');
        expect(readGeneration(scope)).toEqual(previous);
        expect((await localRepository.getMap(mapId)).name).toBe('Anterior');
    });

    it('keeps the previous generation when the atomic pointer write fails', async () => {
        const previous = readGeneration(scope);
        const set = globalThis.localStorage.setItem;
        vi.spyOn(globalThis.localStorage, 'setItem').mockImplementation((key, value) => {
            if (key.startsWith('ebgeo_atlas_generation:') && JSON.parse(value).active !== previous.active) {
                throw new DOMException('quota at activation', 'QuotaExceededError');
            }
            return set(key, value);
        });
        await expect(applyRemoteSnapshot(snapshot())).rejects.toThrow('quota at activation');
        expect(readGeneration(scope).active).toBe(previous.active);
        expect((await localRepository.getMap(mapId)).name).toBe('Anterior');
        expect(bus.emit).not.toHaveBeenCalled();
    });

    it('does not share pending guards or entity versions with another mounted atlas', async () => {
        const operation = { id: 'same-entity', entityType: 'feature', operationType: 'create', entityId: featureId, mapId,
            serverVersion: 99,
            data: { type: 'Feature', geometry: { type: 'Point', coordinates: [1, 2] }, properties: { id: featureId, source: 'point' } } };
        await applyRemoteOperation(operation);
        markLocalEditPending(featureId);
        const other = remoteScope('independent-guards');
        activateScope(other);
        await clearAtlasDatabases(other);
        await localRepository.saveMap(mapId, map('Outro atlas'));
        expect(await applyRemoteOperation({ ...operation, id: 'other-operation', serverVersion: 2 })).toBe(true);
        expect((await localRepository.getMap(mapId)).features.points).toHaveLength(1);
    });

    it('waits for an existing writer and rejects new edits without holding document locks', async () => {
        const finish = beginStoreWrite(scope);
        const original = readGeneration(scope);
        let finished = false;
        const applying = applyRemoteSnapshot(snapshot()).then(() => { finished = true; });
        // Snapshot registration is synchronous inside the serialized apply microtask.
        await Promise.resolve();
        await Promise.resolve();
        expect(() => beginStoreWrite(scope)).toThrow('recuperando');
        expect(finished).toBe(false);
        expect(readGeneration(scope)).toEqual(original);
        finish();
        await applying;
        beginStoreWrite(scope)();
    });
});

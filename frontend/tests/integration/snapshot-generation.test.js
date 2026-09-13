// Path: tests/integration/snapshot-generation.test.js
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    activateScope, atlasGenerationLockName, clearAtlasDatabases, dropAtlasDatabases,
    durableMirrorSettled, generationMirrorKey, getActiveScope, getGlobalStore, getStoreFor,
    reconcileDurablePointers, remoteScope, resolveDbName, StoreName, writeEpochMirrorKey,
} from '../../src/js/store/atlas-namespace.js';
import { discardRemoteWrites } from '../../src/js/store/remote-write-fence.js';
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
// A VERSÃO É PARÂMETRO, e não uma constante, porque `applyRemoteSnapshot` recusa encenar um
// retrato cujo `currentVersion` já É o cursor da geração ATIVA (é a segunda resposta de toda
// abertura, e encená-la de novo custava uma geração inteira). O `storage` deste arquivo é
// compartilhado por todos os casos, então quem roda depois de uma ativação NESTE escopo tem de
// pedir uma versão que o disco ainda não tem, senão mede o atalho de idempotência em vez do
// caminho que quer medir.
const snapshot = (currentVersion = 19) => ({ atlas: { ...createAtlas('Remoto'), id: atlasId }, maps: [map('Servidor')], briefings: [], currentVersion });

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
        const op = { protocolVersion: 2, id: 'prepared-survives', entityType: 'feature', operationType: 'create', entityId: featureId, mapId,
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
        await expect(applyRemoteSnapshot(snapshot(20))).rejects.toMatchObject({ name: 'AbortError' });
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
        await expect(applyRemoteSnapshot(snapshot(21))).rejects.toThrow('quota at activation');
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

    // ========================================================================================
    // PRUNING (D3 de 2026-09-13: a ativa mais UMA anterior; preparação que falhou sai na hora)
    //
    // Cada caso monta um namespace PRÓPRIO, porque o ponteiro de geração vive num
    // `localStorage` compartilhado por todo o arquivo: medir poda sobre o `known` que o caso
    // anterior deixou seria medir a soma dos dois.
    // ========================================================================================
    const mountIsolated = async id => {
        const isolated = remoteScope(id);
        activateScope(isolated);
        await clearAtlasDatabases(isolated);
        return isolated;
    };
    const snapshotFor = (id, version) => ({
        atlas: { ...createAtlas('Remoto'), id }, maps: [map('Servidor')], briefings: [], currentVersion: version,
    });
    const atlasDbOf = (isolated, generation) => resolveDbName(StoreName.ATLAS, { ...isolated, dataGeneration: generation });
    const onDisk = async () => (await indexedDB.databases()).map(entry => entry.name);

    it('deixa a geração ativa e UMA anterior depois de dois retratos', async () => {
        const isolated = await mountIsolated('poda-duas');
        await applyRemoteSnapshot(snapshotFor('poda-duas', 11));
        const first = readGeneration(isolated).active;
        await applyRemoteSnapshot(snapshotFor('poda-duas', 12));
        const second = readGeneration(isolated).active;

        expect(second).not.toBe(first);
        expect([...readGeneration(isolated).known].sort()).toEqual([first, second].sort());
        // A reserva continua LEGÍVEL: é ela que um handle capturado antes da troca ainda usa.
        expect(await onDisk()).toContain(atlasDbOf(isolated, first));
        expect(await onDisk()).toContain(atlasDbOf(isolated, second));
    });

    it('poda a geração que deixou de ser reserva, e o `known` não nomeia banco que saiu do disco', async () => {
        const isolated = await mountIsolated('poda-tres');
        await applyRemoteSnapshot(snapshotFor('poda-tres', 21));
        const first = readGeneration(isolated).active;
        await applyRemoteSnapshot(snapshotFor('poda-tres', 22));
        const second = readGeneration(isolated).active;
        await applyRemoteSnapshot(snapshotFor('poda-tres', 23));
        const third = readGeneration(isolated).active;

        const record = readGeneration(isolated);
        expect([...record.known].sort()).toEqual([second, third].sort());
        expect(record.known).not.toContain(first);
        const names = await onDisk();
        expect(names).not.toContain(atlasDbOf(isolated, first));
        expect(names).toContain(atlasDbOf(isolated, second));
        expect(names).toContain(atlasDbOf(isolated, third));
        // O acervo ativo continua o que o servidor mandou, e não uma casca vazia.
        expect((await new LocalRepository(isolated).getMap(mapId)).name).toBe('Servidor');
    });

    it('apaga a preparação que falhou por quota na ativação e devolve o registro ao que era', async () => {
        const isolated = await mountIsolated('poda-quota');
        await applyRemoteSnapshot(snapshotFor('poda-quota', 31));
        const previous = readGeneration(isolated);
        let prepared = null;
        const set = globalThis.localStorage.setItem;
        vi.spyOn(globalThis.localStorage, 'setItem').mockImplementation((key, value) => {
            if (key.startsWith('ebgeo_atlas_generation:')) {
                const parsed = JSON.parse(value);
                if (parsed.active !== previous.active) throw new DOMException('quota at activation', 'QuotaExceededError');
                prepared = parsed.known.find(generation => !previous.known.includes(generation)) ?? prepared;
            }
            return set(key, value);
        });

        await expect(applyRemoteSnapshot(snapshotFor('poda-quota', 32))).rejects.toThrow('quota at activation');

        expect(prepared).toBeTruthy();
        expect(readGeneration(isolated)).toEqual(previous);
        expect(await onDisk()).not.toContain(atlasDbOf(isolated, prepared));
        // E a ativa continua servindo o acervo, com o cursor da recuperação confirmada.
        expect(readGeneration(isolated).cursor).toBe(31);
        expect((await new LocalRepository(isolated).getMap(mapId)).name).toBe('Servidor');
    });

    it('poupa a geração que outra aba ainda lê, e a mantém no `known`', async () => {
        const isolated = await mountIsolated('poda-irma');
        await applyRemoteSnapshot(snapshotFor('poda-irma', 41));
        const first = readGeneration(isolated).active;

        // A aba irmã: um leitor compartilhado do MESMO nome de trava que a ativação publica.
        let release;
        const unmounted = new Promise(resolve => { release = resolve; });
        await new Promise(resolve => {
            navigator.locks.request(atlasGenerationLockName(isolated.dbSuffix, first), { mode: 'shared' }, () => {
                resolve();
                return unmounted;
            });
        });

        try {
            await applyRemoteSnapshot(snapshotFor('poda-irma', 42));
            await applyRemoteSnapshot(snapshotFor('poda-irma', 43));
            const record = readGeneration(isolated);
            expect(record.known).toContain(first);
            expect(record.known).toHaveLength(3);
            expect(await onDisk()).toContain(atlasDbOf(isolated, first));
        } finally {
            release();
        }
    });

    // ========================================================================================
    // O ESPELHO DURÁVEL (F12): o ponteiro mora em localStorage e o dado em IndexedDB.
    // ========================================================================================
    it('perda do ponteiro com o espelho íntegro: a reconciliação reconstrói e o acervo volta', async () => {
        const isolated = await mountIsolated('espelho');
        await applyRemoteSnapshot(snapshotFor('espelho', 51));
        const active = readGeneration(isolated).active;
        await durableMirrorSettled();

        // A perda: some a chave autoritativa, ficam os nove bancos cheios.
        storage.delete(`ebgeo_atlas_generation:${isolated.dbSuffix}`);
        expect(readGeneration(isolated).active).toBeNull();
        expect(await new LocalRepository(isolated).getMap(mapId)).toBeNull();

        expect(await reconcileDurablePointers(isolated)).toMatchObject({ generation: 'restored' });
        expect(readGeneration(isolated)).toEqual({ active, known: [active], cursor: 51 });
        expect((await new LocalRepository(isolated).getMap(mapId)).name).toBe('Servidor');
    });

    it('destruir o namespace apaga o ponteiro e a época, nas DUAS cópias', async () => {
        const isolated = await mountIsolated('destroi');
        await applyRemoteSnapshot(snapshotFor('destroi', 61));
        discardRemoteWrites(isolated);
        await durableMirrorSettled();
        expect(await getGlobalStore().getItem(generationMirrorKey(isolated.dbSuffix))).toBeTruthy();
        expect(await getGlobalStore().getItem(writeEpochMirrorKey(isolated.dbSuffix))).toBeTruthy();

        const { blocked } = await dropAtlasDatabases(isolated);
        await durableMirrorSettled();

        expect(blocked).toEqual([]);
        expect(storage.get(`ebgeo_atlas_generation:${isolated.dbSuffix}`)).toBeUndefined();
        expect(storage.get(`ebgeo_remote_write_epoch:${isolated.dbSuffix}`)).toBeUndefined();
        expect(await getGlobalStore().getItem(generationMirrorKey(isolated.dbSuffix))).toBeNull();
        expect(await getGlobalStore().getItem(writeEpochMirrorKey(isolated.dbSuffix))).toBeNull();
    });

    it('waits for an existing writer and rejects new edits without holding document locks', async () => {
        const finish = beginStoreWrite(scope);
        const original = readGeneration(scope);
        let finished = false;
        const applying = applyRemoteSnapshot(snapshot(22)).then(() => { finished = true; });
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

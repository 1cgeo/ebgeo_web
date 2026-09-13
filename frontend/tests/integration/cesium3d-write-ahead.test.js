// Path: tests/integration/cesium3d-write-ahead.test.js
//
// O diário das entradas 3D (marcador, medição, viewshed, posição de câmera), contra o
// despachante REAL e o IndexedDB REAL. Molde: tests/integration/catalog-write-ahead.test.js.
//
// A amostra é por FAMÍLIA, não pelas dezesseis entradas: elas compartilham uma moldura só
// (`editCesium3d`), então o que distingue uma família da outra é o alvo da op e o documento
// que ela mexe, e é isso que este arquivo mede. A varredura entrada por entrada, com piso de
// contagem, vive em tests/store/cesium3d-operations.test.js.

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { activateScope, getActiveScope, remoteScope } from '../../src/js/store/atlas-namespace.js';
import { LocalRepository, localRepository } from '../../src/js/store/repositories/local.repository.js';
import { setRepository } from '../../src/js/store/repositories/index.js';
import { operationQueue } from '../../src/js/store/sync/operation-queue.js';
import { enableOperationLogging } from '../../src/js/store/sync/operation-dispatcher.js';
import { memoryStore } from '../../src/js/store/memory-store.js';
import { mapResolver } from '../../src/js/store/services/map-resolver.service.js';
import {
    addMarker,
    addMeasurement,
    addViewshed,
    clearCesium3dCache,
    removeAllFeaturesByTileset,
    removeMarker,
    saveCameraPosition,
    setCesium3dDependencies,
    updateMarker
} from '../../src/js/store/cesium3d.operations.js';
import { applyRemoteSnapshot, setRemoteHandlerEventBus } from '../../src/js/store/sync/remote-operation-handler.js';
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
    setCesium3dDependencies({ eventBus: { emit: vi.fn() } });
    mapA = { id: crypto.randomUUID(), name: 'Ativo', features: {} };
    mapB = { id: crypto.randomUUID(), name: 'Destino', features: {} };
    await localRepository.saveMap(mapA.id, mapA);
    await localRepository.saveMap(mapB.id, mapB);
    mapResolver.registerMap(mapA.name, mapA.id);
    mapResolver.registerMap(mapB.name, mapB.id);
    memoryStore.currentMap = mapA.name;
    clearCesium3dCache();
});

describe('Cesium3d write-ahead persistence', () => {
    it('uma entrada por família registra a intenção no mapa ALVO antes do documento cesium3d', async () => {
        const original = LocalRepository.prototype.saveCesium3d;
        const seen = new Set();
        vi.spyOn(LocalRepository.prototype, 'saveCesium3d').mockImplementation(async function (key, value) {
            const fresh = (await operationQueue.getAll()).filter(op => !seen.has(op.id));
            expect(fresh).toHaveLength(1);
            expect(fresh[0].mapId).toBe(mapB.id);
            // Enfileirada, porém NÃO enviável: a marca de materialização só cai depois da
            // gravação da entidade, e é ela que `peek` respeita.
            expect((await operationQueue.peek()).some(op => op.id === fresh[0].id)).toBe(false);
            seen.add(fresh[0].id);
            return original.call(this, key, value);
        });

        await saveCameraPosition('tsA', { longitude: 1, latitude: 2, height: 3 }, { heading: 0, pitch: 0, roll: 0 }, mapB.name);
        const marker = await addMarker('tsA', { position: { x: 1 } }, mapB.name);
        await updateMarker(marker.id, { properties: { nome: 'B' } }, mapB.name);
        await removeMarker(marker.id, mapB.name);
        await addMeasurement('tsA', { type: 'distance' }, mapB.name);
        await addViewshed('tsA', { observerHeight: 2 }, mapB.name);

        expect(seen.size).toBe(6);
        expect((await operationQueue.getAll()).map(op => `${op.entityType}:${op.operationType}`)).toEqual([
            'cameraPosition3d:create',
            'marker3d:create', 'marker3d:update', 'marker3d:delete',
            'measurement3d:create', 'viewshed3d:create'
        ]);
        expect(await operationQueue.peek(10)).toHaveLength(6);
        // Nada foi para o mapa que estava ativo.
        const ativo = await localRepository.getCesium3d(mapA.id);
        expect(ativo.markers).toEqual([]);
        expect(ativo.cameraPositions).toEqual({});
    });

    it('o expurgo por tileset registra as TRÊS famílias numa escrita de diário só', async () => {
        const m1 = await addMarker('tsA', { position: {} }, mapB.name);
        const m2 = await addMarker('tsA', { position: {} }, mapB.name);
        const guardado = await addMarker('tsB', { position: {} }, mapB.name);
        const me1 = await addMeasurement('tsA', {}, mapB.name);
        const v1 = await addViewshed('tsA', {}, mapB.name);
        const antes = (await operationQueue.getAll()).length;
        expect(antes).toBe(5);

        let noMomentoDaGravacao = null;
        const original = LocalRepository.prototype.saveCesium3d;
        vi.spyOn(LocalRepository.prototype, 'saveCesium3d').mockImplementation(async function (key, value) {
            noMomentoDaGravacao = (await operationQueue.getAll()).length;
            return original.call(this, key, value);
        });

        expect(await removeAllFeaturesByTileset('tsA', mapB.name))
            .toEqual({ markers: 2, measurements: 1, viewsheds: 1, total: 4 });

        // As quatro exclusões já estavam no diário quando a gravação começou.
        expect(noMomentoDaGravacao).toBe(antes + 4);
        const deletes = (await operationQueue.getAll()).filter(op => op.operationType === 'delete');
        expect(deletes.map(op => op.entityId).sort()).toEqual([m1.id, m2.id, me1.id, v1.id].sort());
        expect(new Set(deletes.map(op => op.entityType)))
            .toEqual(new Set(['marker3d', 'measurement3d', 'viewshed3d']));
        const stored = await localRepository.getCesium3d(mapB.id);
        expect(stored.markers.map(m => m.id)).toEqual([guardado.id]);
    });

    it('falha do diário não muda o documento lateral nem a entrada do chamador', async () => {
        // Um valor não clonável reprova a escrita na fila, que é a PRIMEIRA das duas.
        const markerData = { position: { ao: () => {} }, properties: { nome: 'X' } };
        const persist = vi.spyOn(LocalRepository.prototype, 'saveCesium3d');

        await expect(addMarker('tsA', markerData, mapB.name)).rejects.toThrow();

        expect(persist).not.toHaveBeenCalled();
        expect(await operationQueue.count()).toBe(0);
        expect((await localRepository.getCesium3d(mapB.id)).markers).toEqual([]);
        expect(markerData.position.ao).toBeTypeOf('function');
    });

    it('quota depois do diário preserva a intenção original e o snapshot a recupera uma vez', async () => {
        vi.spyOn(LocalRepository.prototype, 'saveCesium3d')
            .mockRejectedValueOnce(new DOMException('quota', 'QuotaExceededError'));

        await expect(addMeasurement('tsA', { type: 'distance', result: { value: 42, formatted: '42 m' } }, mapB.name))
            .rejects.toThrow('quota');

        const pending = await operationQueue.getAll();
        expect(pending).toHaveLength(1);
        expect(pending[0].entityType).toBe('measurement3d');
        expect(pending[0].data.result.value).toBe(42);
        // Preparada e não materializada: o envio não a alcança.
        expect(await operationQueue.peek()).toEqual([]);
        expect((await localRepository.getCesium3d(mapB.id)).measurements).toEqual([]);

        vi.restoreAllMocks();
        const snapshot = {
            atlas: { ...createAtlas('Atlas'), id: getActiveScope().atlasId },
            maps: [mapA, {
                ...mapB,
                cesium3d: { cameraPositions: {}, markers: [], measurements: [pending[0].data], viewsheds: [] }
            }],
            briefings: [], currentVersion: 1
        };
        await applyRemoteSnapshot(snapshot);
        expect((await localRepository.getCesium3d(mapB.id)).measurements[0].result.value).toBe(42);
        // O snapshot não consome nem duplica a fila; a op preparada continua lá, intacta.
        expect(await operationQueue.getAll()).toEqual(pending);
        await applyRemoteSnapshot(snapshot);
        expect((await localRepository.getCesium3d(mapB.id)).measurements).toHaveLength(1);
        expect(await operationQueue.getAll()).toEqual(pending);
    });

    it('escritas concorrentes no mesmo tileset preservam todos os marcadores', async () => {
        const criados = await Promise.all(Array.from({ length: 8 }, (_, i) => addMarker(
            'tsA', { position: { x: i }, properties: { nome: `P${i}` } }, mapB.name
        )));
        const stored = await localRepository.getCesium3d(mapB.id);
        expect(new Set(stored.markers.map(m => m.id))).toEqual(new Set(criados.map(m => m.id)));
        expect((await operationQueue.getAll()).map(op => op.mapId)).toEqual(criados.map(() => mapB.id));
    });

    it('troca de escopo durante a leitura não escreve em nenhum dos dois atlas', async () => {
        const source = getActiveScope();
        let release;
        let entered;
        const reading = new Promise(resolve => { entered = resolve; });
        const gate = new Promise(resolve => { release = resolve; });
        vi.spyOn(LocalRepository.prototype, 'getCesium3d').mockImplementationOnce(async () => {
            entered();
            await gate;
            return { cameraPositions: {}, markers: [], measurements: [], viewsheds: [] };
        });

        const write = addViewshed('tsA', { observerHeight: 3 }, mapB.name);
        const rejected = expect(write).rejects.toThrow('atlas mudou');
        await reading;
        activateScope(remoteScope(crypto.randomUUID()));
        release();
        await rejected;

        expect(await operationQueue.forScope(source).getAll()).toEqual([]);
        expect(await operationQueue.count()).toBe(0);
        expect((await localRepository.forScope(source).getCesium3d(mapB.id)).viewsheds).toEqual([]);
    });
});

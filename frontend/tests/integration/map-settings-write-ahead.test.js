// Path: tests/integration/map-settings-write-ahead.test.js
//
// O DIÁRIO ANTES DO DOCUMENTO, para as três configurações de mapa que moram no documento do
// mapa: mapa-base, salvar posição e limpar posição. Molde: `catalog-write-ahead.test.js`.
//
// O QUE ESTE ARQUIVO MEDE, e por que não serve mock de logging: o sujeito é a ORDEM entre duas
// gravações reais (a fila durável em IndexedDB e o documento do mapa), então o diário aqui é o
// `operationQueue` de verdade e o repositório é um `LocalRepository` ligado ao escopo. Um duplo
// de `logBaseLayerOperation` responderia "fui chamado" sem dizer QUANDO, que é a única coisa
// que importa: até 2026-09-13 estas três gravavam o documento e só depois logavam, de modo que
// uma falha de disco entre as duas perdia a intenção sem deixar rastro.
//
// `peek()` é a fila PRONTA PARA ENVIO e para no primeiro registro `prepared` (a intenção cuja
// projeção local ainda não foi materializada), enquanto `getAll()` mostra o diário inteiro. A
// distinção é o instrumento deste arquivo: intenção registrada e ainda não materializada tem de
// estar em `getAll()` e FORA de `peek()`.

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
    setBaseLayer,
    updateMapPosition,
    clearMapPosition,
    setMapDependencies
} from '../../src/js/store/map.operations.js';
import { applyRemoteSnapshot, setRemoteHandlerEventBus } from '../../src/js/store/sync/remote-operation-handler.js';
import { createAtlas } from '../../src/js/store/atlas/atlas.entity.js';

vi.mock('../../src/js/store/sync/permission-guard.js', async importOriginal => ({
    ...await importOriginal(), checkPermission: () => ({ allowed: true })
}));

// `map.operations.js` alcança o config do deploy para validar o mapa-base pedido.
vi.mock('../../src/js/config.js', () => ({
    default: {
        basemaps: { 'carta-topografica': { enabled: true }, osm: { enabled: true } },
        getValidBasemapFallback: () => 'carta-topografica'
    }
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
    setRepository(new LocalRepository(getActiveScope()));
    enableOperationLogging();
    setRemoteHandlerEventBus({ emit: vi.fn() });
    setMapDependencies({
        eventBus: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
        groupManager: { loadGroupsToMemory: vi.fn(async () => {}), clearMapGroups: vi.fn(async () => {}) },
        layerManager: { loadLayersToMemory: vi.fn(async () => {}), clearLayersCache: vi.fn() }
    });
    mapA = { id: crypto.randomUUID(), name: 'Ativo', features: {}, baseLayer: 'carta-topografica' };
    mapB = { id: crypto.randomUUID(), name: 'Destino', features: {}, baseLayer: 'carta-topografica' };
    await localRepository.saveMap(mapA.id, mapA);
    await localRepository.saveMap(mapB.id, mapB);
    mapResolver.registerMap(mapA.name, mapA.id);
    mapResolver.registerMap(mapB.name, mapB.id);
    memoryStore.currentMap = mapA.name;
    memoryStore.lockedMaps.clear();
});

/** O documento do mapa, relido do disco. */
const reread = id => localRepository.getMap(id);

describe('Map settings write-ahead persistence', () => {
    it('mapa-base e as duas posições registram a intenção antes de gravar o documento', async () => {
        const originalSave = LocalRepository.prototype.saveMap;
        const seen = new Set();
        vi.spyOn(LocalRepository.prototype, 'saveMap').mockImplementation(async function (id, value) {
            const fresh = (await operationQueue.getAll()).filter(op => !seen.has(op.id));
            expect(fresh).toHaveLength(1);
            // O alvo é o mapa PEDIDO, não o corrente, e entityId é o próprio mapa (é uma
            // configuração DO mapa, e o servidor a despacha pelo subtipo).
            expect(fresh[0].mapId).toBe(mapB.id);
            expect(fresh[0].entityId).toBe(mapB.id);
            // A intenção ainda não pode ser enviada: a projeção local é a linha de baixo.
            expect((await operationQueue.peek()).some(op => op.id === fresh[0].id)).toBe(false);
            seen.add(fresh[0].id);
            return originalSave.call(this, id, value);
        });

        await setBaseLayer('osm', mapB.name);
        await updateMapPosition(-22.9, -43.17, 12, 30, 45, mapB.name);
        await clearMapPosition(mapB.name);

        expect(seen.size).toBe(3);
        const journal = await operationQueue.getAll();
        expect(journal.map(op => op.entityType)).toEqual(['baseLayer', 'mapPosition', 'mapPosition']);
        // Salvar posição pela primeira vez é CREATE; limpar é UPDATE com os cinco campos nulos.
        expect(journal.map(op => op.operationType)).toEqual(['update', 'create', 'update']);
        expect(journal[2].data).toEqual({
            center_lat: null, center_long: null, zoom: null, bearing: null, pitch: null
        });
        // Materializadas: as três estão prontas para envio.
        expect((await operationQueue.peek()).map(op => op.id)).toEqual(journal.map(op => op.id));

        const written = await reread(mapB.id);
        expect(written.baseLayer).toBe('osm');
        expect(written.savedPosition).toBeUndefined();
        expect(written.center_lat).toBeNull();
        // O mapa que não foi alvo não foi tocado por nenhuma das três.
        expect((await reread(mapA.id)).baseLayer).toBe('carta-topografica');
    });

    it('falha do diário não muda o documento nem deixa op na fila', async () => {
        // A intenção não é serializável (`structuredClone` recusa uma função), e é o diário que
        // tenta cloná-la: a recusa acontece ANTES de a persistência do documento rodar.
        const persist = vi.spyOn(LocalRepository.prototype, 'saveMap');
        await expect(updateMapPosition(-22.9, -43.17, () => 12, 0, 0, mapB.name)).rejects.toThrow();
        expect(persist).not.toHaveBeenCalled();
        expect(await operationQueue.count()).toBe(0);
        expect((await reread(mapB.id)).savedPosition).toBeUndefined();
    });

    it('um mapa remoto inexistente não é sintetizado pelo fallback de compatibilidade', async () => {
        // `getMapDataCompat` responde um documento VAZIO para mapa ausente; gravá-lo de volta
        // criaria o mapa, e a op carregaria um id que o servidor nunca emitiu.
        const missing = crypto.randomUUID();
        await expect(setBaseLayer('osm', missing)).rejects.toThrow('identidade remota');
        expect(await localRepository.getMap(missing)).toBeNull();
        expect(await operationQueue.count()).toBe(0);
    });

    it('quota depois do diário preserva a intenção e o snapshot a recupera uma vez', async () => {
        vi.spyOn(LocalRepository.prototype, 'saveMap')
            .mockRejectedValueOnce(new DOMException('quota', 'QuotaExceededError'));
        await expect(setBaseLayer('osm', mapB.name)).rejects.toThrow('quota');

        const pending = await operationQueue.getAll();
        expect(pending).toHaveLength(1);
        expect(pending[0].data).toEqual({ baseLayer: 'osm' });
        // Preparada e não materializada: nada disso é enviável ainda.
        expect(await operationQueue.peek()).toEqual([]);
        expect((await reread(mapB.id)).baseLayer).toBe('carta-topografica');

        vi.restoreAllMocks();
        const snapshot = {
            atlas: { ...createAtlas('Atlas'), id: getActiveScope().atlasId },
            maps: [mapA, mapB], briefings: [], currentVersion: 1
        };
        await applyRemoteSnapshot(snapshot);
        // A intenção pendente foi REPROJETADA sobre o estado do servidor e liberada para envio.
        expect((await reread(mapB.id)).baseLayer).toBe('osm');
        expect((await operationQueue.peek()).map(op => op.id)).toEqual(pending.map(op => op.id));

        // Idempotente: o segundo snapshot não duplica op nem reescreve o documento de outro jeito.
        await applyRemoteSnapshot(snapshot);
        expect((await reread(mapB.id)).baseLayer).toBe('osm');
        expect(await operationQueue.getAll()).toEqual(pending);
    });

    it('mapa ALVO travado recusa sem diário e sem gravação, com o corrente destravado', async () => {
        // O conjunto em memória fica VAZIO de propósito: em atlas local ele é isso mesmo para
        // todo mapa que não é o corrente, então a recusa tem de vir do disco (`isMapLocked`).
        await localRepository.saveSetting(`mapLocked_${mapB.name}`, true);
        const persist = vi.spyOn(LocalRepository.prototype, 'saveMap');

        await setBaseLayer('osm', mapB.name);
        await updateMapPosition(-22.9, -43.17, 12, 0, 0, mapB.name);
        await clearMapPosition(mapB.name);

        expect(persist).not.toHaveBeenCalled();
        expect(await operationQueue.count()).toBe(0);
        expect((await reread(mapB.id)).baseLayer).toBe('carta-topografica');
    });

    it('troca de escopo durante a leitura não escreve em nenhum dos dois atlas', async () => {
        const source = getActiveScope();
        let release;
        let entered;
        const reading = new Promise(resolve => { entered = resolve; });
        const gate = new Promise(resolve => { release = resolve; });
        vi.spyOn(LocalRepository.prototype, 'getMap').mockImplementationOnce(async () => {
            entered(); await gate; return structuredClone(mapB);
        });

        const write = updateMapPosition(-22.9, -43.17, 12, 0, 0, mapB.name);
        const rejected = expect(write).rejects.toThrow('atlas mudou');
        await reading;
        activateScope(remoteScope(crypto.randomUUID()));
        release();
        await rejected;

        expect(await operationQueue.forScope(source).getAll()).toEqual([]);
        expect(await operationQueue.count()).toBe(0);
        expect((await localRepository.forScope(source).getMap(mapB.id)).savedPosition).toBeUndefined();
    });

    it('escritas concorrentes no mesmo documento não perdem nenhuma das duas intenções', async () => {
        // A trava do documento é FIFO: as duas leem e gravam em série, então o mapa-base da
        // segunda sobrevive e as duas intenções ficam no diário.
        await Promise.all([
            setBaseLayer('osm', mapB.name),
            updateMapPosition(-22.9, -43.17, 12, 0, 0, mapB.name)
        ]);
        const written = await reread(mapB.id);
        expect(written.baseLayer).toBe('osm');
        expect(written.savedPosition.zoom).toBe(12);
        expect((await operationQueue.getAll()).map(op => op.entityType).sort())
            .toEqual(['baseLayer', 'mapPosition']);
    });
});

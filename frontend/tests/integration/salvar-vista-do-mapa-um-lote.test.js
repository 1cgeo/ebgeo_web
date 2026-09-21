// Path: tests/integration/salvar-vista-do-mapa-um-lote.test.js
//
// SALVAR A VISTA DO MAPA É UM GESTO E UM LOTE: câmera, mapa base e interruptor temporal.
//
// POR QUE EXISTE (decisão do dono, 2026-09-20). A base e o interruptor temporal deixaram de ser
// config sincronizada a cada clique e viraram estado de vista da pessoa. O que sobrou para
// compartilhar é o que o mapa mostra a quem CHEGA, e isso é o antigo "salvar posição" levando as
// três coisas. `saveMapView` (`store/map-view.operations.js`) é COMPOSTA: a câmera e a base moram
// no documento do mapa, o interruptor mora num documento lateral com trava própria, então uma
// transação só não as alcança e o que as une é `withGestureBatch`.
//
// O QUE ESTE ARQUIVO MEDE, com a fila e o repositório DE VERDADE (molde:
// `map-settings-write-ahead.test.js`): que as folhas saem com o MESMO `batchId`, que é a unidade
// que o servidor aplica ou recusa inteira; que folha cujo valor não mudou NÃO vira operação; e
// que a recusa é decidida uma vez, antes de qualquer folha escrever.
//
// O QUE NÃO ALCANÇA: o servidor aceitar três ops do mesmo mapa observando a mesma revisão. Isso é
// do e2e de contrato.

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { activateScope, getActiveScope, remoteScope } from '../../src/js/store/atlas-namespace.js';
import { LocalRepository, localRepository } from '../../src/js/store/repositories/local.repository.js';
import { setRepository } from '../../src/js/store/repositories/index.js';
import { operationQueue } from '../../src/js/store/sync/operation-queue.js';
import { enableOperationLogging } from '../../src/js/store/sync/operation-dispatcher.js';
import { memoryStore } from '../../src/js/store/memory-store.js';
import { mapResolver } from '../../src/js/store/services/map-resolver.service.js';
import { setMapDependencies, toggleMapLock } from '../../src/js/store/map.operations.js';
import { saveMapView, clearMapView, birthBaseLayer } from '../../src/js/store/map-view.operations.js';
import { getMapTemporalConfig, isMapTemporalEnabledSync, setMapTemporalView } from '../../src/js/store/temporal.operations.js';
import { setStoreErrorEventBus, StoreErrorEvents } from '../../src/js/store/store-errors.js';
import { checkPermission } from '../../src/js/store/sync/permission-guard.js';

vi.mock('../../src/js/store/sync/permission-guard.js', async importOriginal => ({
    ...await importOriginal(), checkPermission: vi.fn(() => ({ allowed: true }))
}));

// `temporal.operations.js` anuncia pelo barramento dos serviços, que em node não foi iniciado.
// Mock INTEIRO e não parcial: `importOriginal` aqui reentra no grafo da store por import circular,
// e quem importa `services.js` durante a fábrica recebe o módulo REAL (medido: o mock parcial
// deixava `getEventBus` lançando "Services not initialized").
vi.mock('../../src/js/store/services.js', () => ({
    getEventBus: () => ({ emit: () => {}, on: () => {}, off: () => {} })
}));

vi.mock('../../src/js/config.js', () => ({
    default: {
        basemaps: { 'carta-topografica': { enabled: true }, osm: { enabled: true }, imagens: { enabled: true } },
        getValidBasemapFallback: () => 'carta-topografica'
    }
}));

const CAMERA = { center_lat: -22.9, center_long: -43.17, zoom: 12, bearing: 30, pitch: 45 };

let mapa;
let recusas;

beforeEach(async () => {
    const storage = new Map();
    vi.stubGlobal('localStorage', {
        getItem: key => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, String(value)),
        removeItem: key => storage.delete(key)
    });
    activateScope(remoteScope(crypto.randomUUID()));
    setRepository(new LocalRepository(getActiveScope()));
    enableOperationLogging();
    checkPermission.mockReturnValue({ allowed: true });
    recusas = [];
    setStoreErrorEventBus({
        emit: (type, payload) => { if (type === StoreErrorEvents.STORE_OPERATION_BLOCKED) recusas.push(payload); }
    });
    setMapDependencies({
        eventBus: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
        groupManager: { loadGroupsToMemory: vi.fn(async () => {}), clearMapGroups: vi.fn(async () => {}) },
        layerManager: { loadLayersToMemory: vi.fn(async () => {}), clearLayersCache: vi.fn() }
    });
    mapa = { id: crypto.randomUUID(), name: 'Operação', features: {}, baseLayer: 'carta-topografica' };
    await localRepository.saveMap(mapa.id, mapa);
    mapResolver.registerMap(mapa.name, mapa.id);
    memoryStore.currentMap = mapa.name;
    memoryStore.lockedMaps.clear();
    memoryStore.temporalConfigs.clear();
    memoryStore.temporalView.clear();
});

const tiposNaFila = async () => (await operationQueue.getAll()).map(op => op.entityType);

describe('saveMapView', () => {
    it('as três folhas saem no MESMO lote, na ordem em que o servidor as aplica', async () => {
        await expect(saveMapView({ ...CAMERA, baseLayer: 'osm', temporalEnabled: true }, mapa.name))
            .resolves.toBe(true);

        const fila = await operationQueue.getAll();
        expect(fila.map(op => op.entityType)).toEqual(['mapPosition', 'baseLayer', 'mapTemporal']);
        // A UNIDADE DE APLICAÇÃO do servidor: um `batchId` só, com o índice continuando de uma
        // transação para a outra. Três lotes aqui seriam uma vista que chega pela metade.
        const lotes = new Set(fila.map(op => op.batchId));
        expect(lotes.size).toBe(1);
        expect([...lotes][0]).toBeTruthy();
        expect(fila.map(op => op.batchIndex)).toEqual([0, 1, 2]);
        // Todas endereçam o MAPA: são colunas dele, não entidades.
        expect(new Set(fila.map(op => op.entityId))).toEqual(new Set([mapa.id]));

        const documento = await localRepository.getMap(mapa.id);
        expect(documento.baseLayer).toBe('osm');
        expect(documento.savedPosition).toMatchObject(CAMERA);
        expect((await getMapTemporalConfig(mapa.name)).ativo).toBe(true);
    });

    it('folha cujo valor não mudou NÃO vira operação: salvar só a câmera é uma op', async () => {
        // A base pedida é a que já está salva, e o interruptor também.
        await saveMapView({ ...CAMERA, baseLayer: 'carta-topografica', temporalEnabled: false }, mapa.name);

        expect(await tiposNaFila()).toEqual(['mapPosition']);
    });

    it('base nula e interruptor ausente deixam o salvo como está', async () => {
        await saveMapView({ ...CAMERA, baseLayer: null }, mapa.name);

        expect(await tiposNaFila()).toEqual(['mapPosition']);
        expect((await localRepository.getMap(mapa.id)).baseLayer).toBe('carta-topografica');
    });

    it('salvar NÃO mexe na tela de quem salvou: o interruptor de vista fica onde estava', async () => {
        setMapTemporalView(mapa.name, true);

        await saveMapView({ ...CAMERA, temporalEnabled: true }, mapa.name);

        expect(isMapTemporalEnabledSync(mapa.name)).toBe(true);
        expect((await getMapTemporalConfig(mapa.name)).ativo).toBe(true);
    });

    it('o LEITOR é recusado UMA vez, antes de qualquer folha, e nada é gravado', async () => {
        checkPermission.mockReturnValue({ allowed: false, reason: 'somente leitura', required: 'write' });

        await expect(saveMapView({ ...CAMERA, baseLayer: 'osm', temporalEnabled: true }, mapa.name))
            .resolves.toBe(false);

        expect(recusas).toHaveLength(1);
        expect(recusas[0]).toMatchObject({ operation: 'saveMapView', required: 'write' });
        expect(await operationQueue.count()).toBe(0);
        expect((await localRepository.getMap(mapa.id)).baseLayer).toBe('carta-topografica');
    });

    it('mapa TRAVADO recusa o gesto inteiro', async () => {
        await toggleMapLock(mapa.name);
        const antes = await operationQueue.count();

        await expect(saveMapView({ ...CAMERA, baseLayer: 'osm' }, mapa.name)).resolves.toBe(false);

        expect(await operationQueue.count()).toBe(antes);
        expect(recusas.at(-1)).toMatchObject({ operation: 'saveMapView', reason: 'map_locked' });
        expect((await localRepository.getMap(mapa.id)).savedPosition).toBeUndefined();
    });

    it.each([
        ['câmera ausente', {}],
        ['latitude NaN', { ...CAMERA, center_lat: NaN }],
        ['zoom Infinity', { ...CAMERA, zoom: Infinity }],
        ['vista nula', null],
    ])('argumento inválido (%s) é defeito do chamador: lança e não grava', async (_nome, vista) => {
        await expect(saveMapView(vista, mapa.name)).rejects.toThrow(/finite camera/);
        expect(await operationQueue.count()).toBe(0);
    });
});

// LIMPAR A VISTA SALVA É O ESPELHO DE SALVÁ-LA (dono, 2026-09-21). "Limpar posição salva" limpava só
// a câmera, e o mapa ficava sem posição mas com o mapa base e o interruptor temporal que alguém
// tinha salvo com ela, que nada na tela mostrava e nenhum gesto removia.
describe('clearMapView', () => {
    const salvarTudo = async () => {
        await saveMapView({ ...CAMERA, baseLayer: 'osm', temporalEnabled: true }, mapa.name);
        const antes = await operationQueue.count();
        expect(antes).toBe(3);
        return antes;
    };

    it('as três folhas saem no MESMO lote: câmera vazia, base de nascimento e temporal desligado', async () => {
        const antes = await salvarTudo();

        await expect(clearMapView(mapa.name)).resolves.toBe(true);

        const fila = (await operationQueue.getAll()).slice(antes);
        expect(fila.map(op => op.entityType)).toEqual(['mapPosition', 'baseLayer', 'mapTemporal']);
        const lotes = new Set(fila.map(op => op.batchId));
        expect(lotes.size).toBe(1);
        expect([...lotes][0]).toBeTruthy();
        expect(fila.map(op => op.batchIndex)).toEqual([0, 1, 2]);
        // UPDATE, nunca DELETE: um delete de `mapPosition` no servidor é um ato sobre o MAPA.
        expect(fila.every(op => op.type === 'update' || op.operationType === 'update')).toBe(true);

        const documento = await localRepository.getMap(mapa.id);
        expect(documento.savedPosition).toBeUndefined();
        expect(documento.center_lat).toBeNull();
        expect(documento.baseLayer).toBe(birthBaseLayer());
        expect((await getMapTemporalConfig(mapa.name)).ativo).toBe(false);
    });

    it('a base de nascimento vem de UM lugar só, o mesmo de onde o mapa nasce', () => {
        expect(birthBaseLayer()).toBe('carta-topografica');
    });

    it('folha que já está limpa NÃO vira operação: só a câmera tinha o que limpar', async () => {
        await saveMapView({ ...CAMERA }, mapa.name);
        const antes = await operationQueue.count();

        await clearMapView(mapa.name);

        expect((await operationQueue.getAll()).slice(antes).map(op => op.entityType)).toEqual(['mapPosition']);
    });

    it('limpar NÃO mexe na tela de quem limpou: o interruptor de vista fica onde estava', async () => {
        await salvarTudo();
        setMapTemporalView(mapa.name, true);

        await clearMapView(mapa.name);

        expect(isMapTemporalEnabledSync(mapa.name)).toBe(true);
        expect((await getMapTemporalConfig(mapa.name)).ativo).toBe(false);
    });

    it('o LEITOR é recusado UMA vez, antes de qualquer folha, e a vista salva fica inteira', async () => {
        const antes = await salvarTudo();
        recusas.length = 0;
        checkPermission.mockReturnValue({ allowed: false, reason: 'somente leitura', required: 'write' });

        await expect(clearMapView(mapa.name)).resolves.toBe(false);

        expect(recusas).toHaveLength(1);
        expect(recusas[0]).toMatchObject({ operation: 'clearMapView', required: 'write' });
        expect(await operationQueue.count()).toBe(antes);
        expect((await localRepository.getMap(mapa.id)).baseLayer).toBe('osm');
    });

    it('mapa TRAVADO recusa o gesto inteiro', async () => {
        await salvarTudo();
        await toggleMapLock(mapa.name);
        const antes = await operationQueue.count();

        await expect(clearMapView(mapa.name)).resolves.toBe(false);

        expect(await operationQueue.count()).toBe(antes);
        expect(recusas.at(-1)).toMatchObject({ operation: 'clearMapView', reason: 'map_locked' });
        expect((await localRepository.getMap(mapa.id)).savedPosition).toMatchObject(CAMERA);
    });
});

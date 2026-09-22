// Path: tests/integration/recibo-3d-base-confirmada.repro.test.js
//
// A REVISÃO QUE O RECIBO CONFIRMA, NO 3D E NO 360 (2026-09-22), achada ao ler o item 6.
//
// O QUE O MECANISMO PROMETE. O recibo de uma op que declarou base traz o `entityVersion` que o
// servidor gravou, e `confirmEntityVersion` o carimba no documento local como `confirmedVersion`,
// para que a SEGUNDA edição seguida da mesma entidade declare uma base que o servidor ainda
// reconhece (`confirmed-version.js`). No 3D e no 360 o carimbo chegava ao disco e morria por DOIS
// caminhos, cada um suficiente sozinho:
//
//  1. o ESPELHO em memória: o editor 3D lê o espelho antes do disco (`getCesium3dDataWithCache`), e
//     `confirmEntityVersion` gravava só o disco. A edição seguinte declarava a base de ANTES do
//     carimbo e depois regravava o espelho por cima dele;
//  2. o REPARO do recibo: logo depois do carimbo, `resolveLocalEdit` reaplica a própria op do autor
//     pelo caminho de entrada, e o tratador 3D/360 gravava o payload da op POR CIMA da entrada,
//     jogando fora o carimbo que acabara de ser escrito. O payload é o documento do autor, e o
//     `confirmedVersion` dentro dele é a base anterior à edição.
//
// E o terceiro caso é o espelho do segundo no PAR: uma op do colega trazia a base velha do autor,
// que o servidor já tinha passado, e ela era gravada como se fosse a revisão confirmada daqui.
//
// A sequência de `confirmEntityVersion` seguida de `resolveLocalEdit` é a ordem REAL do recibo
// (`sync-engine.js`, no laço dos acks). O que se afere é o `baseVersion` que a PRÓXIMA op do autor
// leva na fila, que é o que o servidor julga.
//
// CONTROLE NEGATIVO: sem o `present(invalidateCesium3dCache)` de `confirmEntityVersion` o primeiro
// caso fica vermelho; sem `inboundSideEntity` no tratador, o segundo, o terceiro e o quarto.
//
// Harness de `cesium3d-write-ahead.test.js`: IndexedDB falso, repositório, fila e tratador REAIS.

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { activateScope, remoteScope } from '../../src/js/store/atlas-namespace.js';
import { localRepository } from '../../src/js/store/repositories/local.repository.js';
import { setRepository } from '../../src/js/store/repositories/index.js';
import { operationQueue } from '../../src/js/store/sync/operation-queue.js';
import { enableOperationLogging } from '../../src/js/store/sync/operation-dispatcher.js';
import { memoryStore } from '../../src/js/store/memory-store.js';
import { mapResolver } from '../../src/js/store/services/map-resolver.service.js';
import {
    addMarker,
    clearCesium3dCache,
    loadCesium3dDataToMemory,
    setCesium3dDependencies,
    updateMarker
} from '../../src/js/store/cesium3d.operations.js';
import {
    addMarker360,
    clearStreetview360Cache,
    updateMarker360
} from '../../src/js/store/streetview360.operations.js';
import {
    applyRemoteOperation,
    confirmEntityVersion,
    resolveLocalEdit,
    setRemoteHandlerEventBus
} from '../../src/js/store/sync/remote-operation-handler.js';
import { EntityType, OperationType } from '../../src/js/store/sync/operation-types.js';

vi.mock('../../src/js/store/sync/permission-guard.js', async importOriginal => ({
    ...await importOriginal(), checkPermission: () => ({ allowed: true })
}));

let mapa;

/** A op mais recente da fila para aquela entidade e aquele tipo de operação. */
async function opNaFila(entityId, operationType) {
    const ops = (await operationQueue.getAll())
        .filter(op => op.entityId === entityId && op.operationType === operationType);
    return ops.at(-1);
}

/** O recibo de uma op, na ordem em que `sync-engine.js` o processa. */
async function recibo(op, entityVersion, serverVersion) {
    expect(await confirmEntityVersion(op, entityVersion)).toBe(true);
    await resolveLocalEdit(op.entityId, serverVersion, op);
}

beforeEach(async () => {
    vi.restoreAllMocks();
    const storage = new Map();
    vi.stubGlobal('localStorage', {
        getItem: key => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, String(value)),
        removeItem: key => storage.delete(key)
    });
    activateScope(remoteScope(crypto.randomUUID()));
    setRepository(localRepository);
    enableOperationLogging();
    setRemoteHandlerEventBus({ emit: vi.fn() });
    setCesium3dDependencies({ eventBus: { emit: vi.fn() } });
    mapa = { id: crypto.randomUUID(), name: 'Ativo', features: {} };
    await localRepository.saveMap(mapa.id, mapa);
    mapResolver.registerMap(mapa.name, mapa.id);
    memoryStore.currentMap = mapa.name;
    clearCesium3dCache();
    clearStreetview360Cache();
});

describe('a base que o recibo confirma sobrevive até a próxima edição 3D/360 do autor', () => {
    it('o carimbo alcança a próxima edição 3D mesmo sem o reparo (o espelho cai com a gravação)', async () => {
        const marker = await addMarker('tsA', { position: { longitude: 1, latitude: 2, height: 3 } }, mapa.name);
        const criacao = await opNaFila(marker.id, OperationType.CREATE);
        // O espelho em memória é o que o editor lê primeiro, e ele está carregado com o marcador.
        expect(memoryStore.cesium3d._mapName).toBe(mapa.name);

        // Só o carimbo: o reparo não roda quando uma op mais nova de um colega já foi aplicada.
        expect(await confirmEntityVersion(criacao, 7)).toBe(true);

        await updateMarker(marker.id, { properties: { nome: 'Segunda edição' } }, mapa.name);
        const edicao = await opNaFila(marker.id, OperationType.UPDATE);
        expect(edicao.baseVersion).toBe(7);
    });

    it('o REPARO do recibo não apaga o carimbo que acabou de ser escrito', async () => {
        const marker = await addMarker('tsA', { position: { longitude: 1, latitude: 2, height: 3 } }, mapa.name);
        const criacao = await opNaFila(marker.id, OperationType.CREATE);

        await recibo(criacao, 7, 42);

        const noDisco = (await localRepository.getCesium3d(mapa.id)).markers.find(m => m.id === marker.id);
        expect(noDisco.confirmedVersion).toBe(7);

        await updateMarker(marker.id, { properties: { nome: 'Segunda edição' } }, mapa.name);
        expect((await opNaFila(marker.id, OperationType.UPDATE)).baseVersion).toBe(7);
    });

    it('a base VELHA que viaja dentro da op de um colega não vira a revisão confirmada daqui', async () => {
        const id = crypto.randomUUID();
        const guardado = {
            id, tilesetId: 'tsA', position: { longitude: 1, latitude: 2, height: 3 },
            properties: { nome: 'Antes', descricao: '' }, style: {},
            sync: { createdAt: 1, updatedAt: 1, version: 1, ownerId: null, dirty: false, deleted: false },
            confirmedVersion: 5,
        };
        await localRepository.saveCesium3d(mapa.id, { cameraPositions: {}, markers: [guardado], measurements: [], viewsheds: [] });
        await loadCesium3dDataToMemory(mapa.name);

        // O colega editou a partir da base 3; o servidor aplicou e passou das duas.
        await applyRemoteOperation({
            id: crypto.randomUUID(), entityType: EntityType.MARKER_3D, operationType: OperationType.UPDATE,
            entityId: id, mapId: mapa.id, serverVersion: 50,
            data: { ...guardado, properties: { nome: 'Do colega', descricao: '' }, confirmedVersion: 3 },
        });

        const noDisco = (await localRepository.getCesium3d(mapa.id)).markers.find(m => m.id === id);
        expect(noDisco.properties.nome).toBe('Do colega');
        expect('confirmedVersion' in noDisco).toBe(false);

        // Sem base, a edição seguinte vai pela ordem de chegada; com a 3 ou a 5, o servidor a
        // recusaria por uma mudança que esta pessoa já está vendo.
        await updateMarker(id, { properties: { nome: 'Minha' } }, mapa.name);
        expect((await opNaFila(id, OperationType.UPDATE)).baseVersion ?? null).toBeNull();
    });

    it('o 360 tem o mesmo reparo e a mesma regra', async () => {
        const marker = await addMarker360('foto-1', {
            position: { heading: 45, pitch: 0, distance: 5 },
            properties: { nome: 'Ponto 360' },
        }, mapa.name);
        const criacao = await opNaFila(marker.id, OperationType.CREATE);

        await recibo(criacao, 9, 43);

        await updateMarker360(marker.id, { properties: { nome: 'Segunda edição' } }, mapa.name);
        expect((await opNaFila(marker.id, OperationType.UPDATE)).baseVersion).toBe(9);
    });
});

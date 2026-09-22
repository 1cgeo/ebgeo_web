// Path: tests/integration/retrato-invalida-espelho-3d.repro.test.js
//
// O RETRATO DO SERVIDOR E O ESPELHO EM MEMÓRIA DO 3D (2026-09-22), a metade de "o snapshot traz a
// entidade 3D para quem já está dentro" do item 6 (feições do 3D não propagam).
//
// A CAUSA RAIZ. Todo leitor do documento cesium3d do mapa corrente pergunta primeiro ao ESPELHO em
// memória (`getCesium3dDataWithCache`, em `store/cesium3d.operations.js`), que `setCurrentMap`
// carrega ao entrar no mapa. A op AO VIVO derruba o espelho depois de gravar
// (`applyRemoteCesium3dEntityOp`); o RETRATO gravava o documento lateral e deixava o espelho como
// estava. Quem recebe um retrato com a sessão já aberta (o `resync` de um marcador estrutural, a
// recuperação) tinha então o marcador do colega no disco e fora da tela, e o pior vinha depois: a
// próxima edição 3D local lia o espelho velho, acrescentava a dela e REGRAVAVA o documento por cima
// do retrato, apagando deste cliente o que o colega tinha feito, sem erro nenhum.
//
// CONTROLE NEGATIVO: sem as duas linhas `present(invalidate...)` em `applyRemoteSnapshotInner`, os
// três primeiros casos ficam vermelhos; sem os três avisos no fim dele, o quarto fica.
//
// Harness de `cesium3d-write-ahead.test.js`: IndexedDB falso, repositório e tratador REAIS.

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { activateScope, getActiveScope, remoteScope } from '../../src/js/store/atlas-namespace.js';
import { localRepository } from '../../src/js/store/repositories/local.repository.js';
import { setRepository } from '../../src/js/store/repositories/index.js';
import { enableOperationLogging } from '../../src/js/store/sync/operation-dispatcher.js';
import { memoryStore } from '../../src/js/store/memory-store.js';
import { mapResolver } from '../../src/js/store/services/map-resolver.service.js';
import {
    addMarker,
    clearCesium3dCache,
    getMarkers,
    loadCesium3dDataToMemory,
    setCesium3dDependencies
} from '../../src/js/store/cesium3d.operations.js';
import {
    clearStreetview360Cache,
    getMarkers360,
    loadStreetview360DataToMemory
} from '../../src/js/store/streetview360.operations.js';
import { applyRemoteSnapshot, setRemoteHandlerEventBus } from '../../src/js/store/sync/remote-operation-handler.js';
import { createAtlas } from '../../src/js/store/atlas/atlas.entity.js';
import { EventTypes } from '../../src/js/events/event_types.js';

vi.mock('../../src/js/store/sync/permission-guard.js', async importOriginal => ({
    ...await importOriginal(), checkPermission: () => ({ allowed: true })
}));

const SYNC = { createdAt: 1, updatedAt: 1, version: 1, ownerId: null, dirty: false, deleted: false };

/** Um marcador 3D na forma que o snapshot entrega. */
function marcador(nome) {
    return {
        id: crypto.randomUUID(),
        tilesetId: 'tsA',
        position: { longitude: -43.2, latitude: -22.9, height: 10 },
        properties: { nome, descricao: '' },
        style: {},
        sync: { ...SYNC },
    };
}

/** Um marcador 360 na forma que o snapshot entrega. */
function marcador360(nome) {
    return {
        id: crypto.randomUUID(),
        photoName: 'foto-1',
        position: { heading: 45, pitch: 0, distance: 5 },
        properties: { nome },
        sync: { ...SYNC },
    };
}

function documento3d(markers) {
    return { cameraPositions: {}, markers, measurements: [], viewsheds: [] };
}

let mapa;
let bus;

/**
 * O retrato de um atlas com um mapa só, com os documentos laterais que o caso pede.
 *
 * A VERSÃO TEM DE ANDAR entre dois retratos do mesmo caso: um retrato na MESMA versão da geração
 * ativa é descartado como repetido antes de gravar qualquer coisa (`activeGenerationHolds`).
 */
function retrato(extra = {}, currentVersion = 2) {
    return {
        atlas: { ...createAtlas('Atlas'), id: getActiveScope().atlasId },
        maps: [{ ...mapa, ...extra }],
        briefings: [],
        currentVersion,
    };
}

const emitidos = (tipo) => bus.emit.mock.calls.filter(([nome]) => nome === tipo).length;

beforeEach(async () => {
    vi.restoreAllMocks();
    const storage = new Map();
    vi.stubGlobal('localStorage', {
        getItem: key => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, String(value)),
        removeItem: key => storage.delete(key)
    });
    activateScope(remoteScope(crypto.randomUUID()));
    // A FACHADA, e não um repositório preso a um escopo: o preso captura a GERAÇÃO de dados na
    // construção (`captureDataScope`) e continuaria lendo a anterior depois de o retrato ativar a
    // nova, que é justamente o que este arquivo mede.
    setRepository(localRepository);
    enableOperationLogging();
    bus = { emit: vi.fn() };
    setRemoteHandlerEventBus(bus);
    setCesium3dDependencies({ eventBus: { emit: vi.fn() } });
    mapa = { id: crypto.randomUUID(), name: 'Ativo', features: {} };
    await localRepository.saveMap(mapa.id, mapa);
    mapResolver.registerMap(mapa.name, mapa.id);
    memoryStore.currentMap = mapa.name;
    clearCesium3dCache();
    clearStreetview360Cache();
});

describe('retrato do servidor numa sessão já aberta: o espelho 3D/360 em memória', () => {
    it('o marcador 3D que o colega criou enquanto este cliente estava fora APARECE depois do retrato', async () => {
        const meu = marcador('Meu');
        await localRepository.saveCesium3d(mapa.id, documento3d([meu]));
        // O que `setCurrentMap` faz ao entrar no mapa.
        await loadCesium3dDataToMemory(mapa.name);
        expect(memoryStore.cesium3d._mapName).toBe(mapa.name);

        const doColega = marcador('Do colega');
        await applyRemoteSnapshot(retrato({ cesium3d: documento3d([meu, doColega]) }));

        // A pré-condição do sintoma: o disco já tinha os dois ANTES do conserto também.
        expect((await localRepository.getCesium3d(mapa.id)).markers).toHaveLength(2);
        const vistos = (await getMarkers('tsA', mapa.name)).map(m => m.id);
        expect(vistos.sort()).toEqual([meu.id, doColega.id].sort());
    });

    it('a edição 3D local SEGUINTE ao retrato não apaga do disco o que o retrato trouxe', async () => {
        const meu = marcador('Meu');
        await localRepository.saveCesium3d(mapa.id, documento3d([meu]));
        await loadCesium3dDataToMemory(mapa.name);

        const doColega = marcador('Do colega');
        await applyRemoteSnapshot(retrato({ cesium3d: documento3d([meu, doColega]) }));

        const novo = await addMarker('tsA', {
            position: { longitude: -43.3, latitude: -22.8, height: 5 },
            properties: { nome: 'Depois do retrato' },
        }, mapa.name);
        expect(novo).toBeTruthy();

        const noDisco = (await localRepository.getCesium3d(mapa.id)).markers.map(m => m.id);
        expect(noDisco.sort()).toEqual([meu.id, doColega.id, novo.id].sort());
    });

    it('o 360 tem o mesmo espelho e a mesma regra', async () => {
        const meu = marcador360('Meu');
        await localRepository.saveStreetview360(mapa.id, { orientations: {}, markers: [meu] });
        await loadStreetview360DataToMemory(mapa.name);
        expect(memoryStore.streetview360._mapName).toBe(mapa.name);

        const doColega = marcador360('Do colega');
        await applyRemoteSnapshot(retrato({ streetview360: { orientations: {}, markers: [meu, doColega] } }));

        const vistos = (await getMarkers360('foto-1', mapa.name)).map(m => m.id);
        expect(vistos.sort()).toEqual([meu.id, doColega.id].sort());
    });

    it('avisa a cena 3D e os selos UMA vez por retrato, e só quando o retrato trouxe 3D', async () => {
        await applyRemoteSnapshot(retrato());
        expect(emitidos(EventTypes.MARKERS_3D_CHANGED)).toBe(0);
        expect(emitidos(EventTypes.MEASUREMENTS_3D_CHANGED)).toBe(0);
        expect(emitidos(EventTypes.VIEWSHEDS_3D_CHANGED)).toBe(0);

        const segundo = { id: crypto.randomUUID(), name: 'Outro', features: {} };
        await applyRemoteSnapshot({
            ...retrato({}, 3),
            maps: [
                { ...mapa, cesium3d: documento3d([marcador('A')]) },
                { ...segundo, cesium3d: documento3d([marcador('B')]) },
            ],
        });
        expect(emitidos(EventTypes.MARKERS_3D_CHANGED)).toBe(1);
        expect(emitidos(EventTypes.MEASUREMENTS_3D_CHANGED)).toBe(1);
        expect(emitidos(EventTypes.VIEWSHEDS_3D_CHANGED)).toBe(1);
    });
});

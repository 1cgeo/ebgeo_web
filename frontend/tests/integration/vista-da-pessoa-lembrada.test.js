// Path: tests/integration/vista-da-pessoa-lembrada.test.js
//
// A VISTA DA PESSOA É LEMBRADA NESTE COMPUTADOR, POR MAPA, E CONTINUA NÃO VIAJANDO (pedido do dono,
// 2026-09-22: "apesar do basemap e controle temporal não sincronizarem, ele tem que salvar a
// preferência do usuário naquele mapa localmente").
//
// O QUE ERA. Desde 2026-09-20 o interruptor temporal e o mapa base na tela eram estado de vista em
// MEMÓRIA, e um F5 devolvia a pessoa à vista salva do mapa: quem ligou a linha do tempo, recarregou
// e voltou encontrava desligado. O conserto não pode desfazer a decisão daquele dia, e por isso os
// casos abaixo prendem as DUAS metades juntas: a escolha volta na próxima entrada (troca de mapa,
// F5, reabrir o atlas), e ela continua fora da fila de saída, fora do banco de ajustes do atlas e
// longe de outra conta.
//
// ELE DIRIGE O CÓDIGO DE VERDADE: namespace, repositório, fila, `setCurrentMap` do gerente de
// estado (onde o interruptor é FIXADO na entrada), as operações temporais e `saveMapView`. O mapa
// base entra pela metade de store (o registro lembrado); o controle que o lê e o escreve é dirigido
// em `tests/integration/mapa-base-e-vista-da-pessoa.repro.test.js`. O QUE NÃO ALCANÇA: um F5 de
// verdade, o MapLibre e a barra da linha do tempo; isso é do Playwright.
//
// O "F5" AQUI É A MEMÓRIA ZERADA SEGUIDA DE UMA ENTRADA NO MAPA, que é o que o boot faz: o
// `localStorage` fica, o `memoryStore.temporalView` começa vazio, e `setCurrentMap` fixa o
// interruptor lendo o disco.

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    activateScope, clearAtlasDatabases, dropAtlasDatabases, getActiveScope, getStore, localScope, remoteScope, StoreName,
} from '../../src/js/store/atlas-namespace.js';
import { LocalRepository, localRepository } from '../../src/js/store/repositories/local.repository.js';
import { setColorUsageCompat, setRepository, setSettingCompat } from '../../src/js/store/repositories/index.js';
import { clearAllAtlasStores } from '../../src/js/store/repository.js';
import { operationQueue } from '../../src/js/store/sync/operation-queue.js';
import { disableOperationLogging, enableOperationLogging } from '../../src/js/store/sync/operation-dispatcher.js';
import { sessionContext } from '../../src/js/store/sync/session-context.js';
import { memoryStore } from '../../src/js/store/memory-store.js';
import { mapResolver } from '../../src/js/store/services/map-resolver.service.js';
import mapManager from '../../src/js/store/store-state-manager.js';
import { setCurrentMap, setMapDependencies, toggleMapLock } from '../../src/js/store/map.operations.js';
import { saveMapView } from '../../src/js/store/map-view.operations.js';
import {
    applyMapEntryTemporalView,
    isMapTemporalEnabledSync,
    isMapTemporalSavedEnabled,
    setMapTemporalView,
    toggleMapTemporal,
} from '../../src/js/store/temporal.operations.js';
import { personViewTarget, rememberMapView, rememberedMapView } from '../../src/js/store/vista-da-pessoa.js';
import { forgetPersonViews, personViewStorageKey } from '../../src/js/store/vista-da-pessoa-disco.js';
import { EventTypes } from '../../src/js/events/event_types.js';

vi.mock('../../src/js/store/sync/permission-guard.js', async importOriginal => ({
    ...await importOriginal(), checkPermission: vi.fn(() => ({ allowed: true }))
}));

// Mock INTEIRO, como em `salvar-vista-do-mapa-um-lote.test.js` e pelo mesmo motivo (o parcial
// reentra no grafo da store). `getGroupManager` é o que `setCurrentMap` do gerente de estado pede.
const barramento = vi.hoisted(() => ({ emit: vi.fn(), on: vi.fn(), off: vi.fn() }));
vi.mock('../../src/js/store/services.js', () => ({
    getEventBus: () => barramento,
    getGroupManager: () => ({ loadGroupsToMemory: async () => {} }),
}));

vi.mock('../../src/js/config.js', () => ({
    default: {
        basemaps: { 'carta-topografica': { enabled: true }, osm: { enabled: true }, imagens: { enabled: true } },
        getValidBasemapFallback: () => 'carta-topografica'
    }
}));

const CAMERA = { center_lat: -22.9, center_long: -43.17, zoom: 12, bearing: 0, pitch: 0 };

let disco;
let mapa;

/** O registro lembrado do namespace ATIVO, cru, ou null. */
function registro() {
    const bruto = disco.get(personViewStorageKey(getActiveScope().dbSuffix));
    return bruto ? JSON.parse(bruto) : null;
}

/** O que o boot faz: a memória da sessão começa vazia e a entrada no mapa fixa o interruptor. */
async function depoisDeUmF5(nome = mapa.name) {
    memoryStore.temporalView.clear();
    await mapManager.setCurrentMap(nome);
}

async function montar(escopo) {
    activateScope(escopo);
    setRepository(new LocalRepository(getActiveScope()));
    mapa = { id: crypto.randomUUID(), name: 'Operação', features: {}, baseLayer: 'carta-topografica' };
    await localRepository.saveMap(mapa.id, mapa);
    mapResolver.clear();
    mapResolver.registerMap(mapa.name, mapa.id);
    // Uma contagem de cores já no disco, para a entrada não disparar a análise inicial atrasada.
    await setColorUsageCompat(mapa.name, { '#ffffff': 1 });
    memoryStore.currentMap = mapa.name;
    memoryStore.lockedMaps.clear();
    memoryStore.temporalConfigs.clear();
    memoryStore.temporalView.clear();
}

beforeEach(() => {
    disco = new Map();
    vi.stubGlobal('localStorage', {
        getItem: key => (disco.has(key) ? disco.get(key) : null),
        setItem: (key, value) => disco.set(key, String(value)),
        removeItem: key => disco.delete(key)
    });
    barramento.emit.mockClear();
    sessionContext.clearSession();
    disableOperationLogging();
    setMapDependencies({
        eventBus: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
        groupManager: { loadGroupsToMemory: vi.fn(async () => {}), clearMapGroups: vi.fn(async () => {}) },
        layerManager: { loadLayersToMemory: vi.fn(async () => {}), clearLayersCache: vi.fn() }
    });
});

afterEach(() => {
    sessionContext.clearSession();
    vi.unstubAllGlobals();
});

describe('atlas LOCAL: o gesto é lembrado e volta depois de um F5', () => {
    beforeEach(async () => {
        await montar(localScope(crypto.randomUUID(), `local-${crypto.randomUUID()}`));
    });

    it('ligar a linha do tempo é lembrado pelo ID do mapa, e a entrada depois do F5 o encontra', async () => {
        await expect(toggleMapTemporal(mapa.name)).resolves.toBe(true);

        // O dono é o COMPUTADOR (nulo) num atlas local, e a chave é o id, nunca o nome.
        expect(registro()).toEqual({ v: 1, owner: null, maps: [{ key: mapa.id, temporalEnabled: true }] });

        await depoisDeUmF5();

        expect(isMapTemporalEnabledSync(mapa.name)).toBe(true);
        // A vista salva do mapa continua como estava: lembrar não é salvar.
        await expect(isMapTemporalSavedEnabled(mapa.name)).resolves.toBe(false);
    });

    it('o lembrado VENCE o salvo, e sem ele o salvo volta a decidir (controle negativo)', async () => {
        await setSettingCompat(`temporal_${mapa.name}`, { ativo: true });
        setMapTemporalView(mapa.name, false);

        await depoisDeUmF5();
        expect(isMapTemporalEnabledSync(mapa.name)).toBe(false);

        // Entrar num mapa COM vista salva também respeita o lembrado, e a troca sai automática.
        barramento.emit.mockClear();
        memoryStore.temporalView.set(mapa.name, true);
        await expect(applyMapEntryTemporalView(mapa.name)).resolves.toBe(false);
        expect(barramento.emit).toHaveBeenCalledWith(EventTypes.MAP_TEMPORAL_CHANGED,
            { mapName: mapa.name, enabled: false, automatico: true });

        // SEM a lembrança, a MESMA entrada responde o salvo: é a lembrança que muda o desfecho.
        forgetPersonViews(getActiveScope().dbSuffix);
        await depoisDeUmF5();
        expect(isMapTemporalEnabledSync(mapa.name)).toBe(true);
        await expect(applyMapEntryTemporalView(mapa.name)).resolves.toBe(true);
    });

    it('uma troca AUTOMÁTICA (vista salva aplicada, slide) nunca é lembrada', async () => {
        setMapTemporalView(mapa.name, true, { automatico: true });

        expect(registro()).toBeNull();
        await depoisDeUmF5();
        expect(isMapTemporalEnabledSync(mapa.name)).toBe(false);
    });

    it('a entrada anuncia o interruptor RESOLVIDO pela lembrança, que é o que a barra lê', async () => {
        const anuncios = [];
        setMapDependencies({
            eventBus: { emit: (evento, dados) => anuncios.push({ evento, dados }), on: vi.fn(), off: vi.fn() },
            groupManager: { loadGroupsToMemory: vi.fn(async () => {}), clearMapGroups: vi.fn(async () => {}) },
            layerManager: { loadLayersToMemory: vi.fn(async () => {}), clearLayersCache: vi.fn() }
        });
        setMapTemporalView(mapa.name, true);
        memoryStore.temporalView.clear();

        await setCurrentMap(mapa.name);

        expect(anuncios.filter(a => a.evento === EventTypes.MAP_TEMPORAL_CHANGED).map(a => a.dados))
            .toEqual([{ mapName: mapa.name, enabled: true, automatico: true }]);
    });

    it('um mapa legado chaveado por NOME leva a lembrança no rename; um mapa com id não precisa', async () => {
        memoryStore.currentMap = 'Legado';
        setMapTemporalView('Legado', true);
        setMapTemporalView(mapa.name, true);

        mapManager.renameMapInMemory('Legado', 'Renomeado');
        mapManager.renameMapInMemory(mapa.name, 'Operação renomeada');

        expect(rememberedMapView('Renomeado')).toEqual({ temporalEnabled: true });
        expect(rememberedMapView('Legado')).toEqual({});
        // O mapa com id continua sob o id: o nome novo nem precisa ser conhecido.
        expect(registro().maps.map(m => m.key).sort()).toEqual([mapa.id, 'Renomeado'].sort());
    });
});

describe('atlas de SERVIDOR: por conta, e nada viaja', () => {
    beforeEach(async () => {
        await montar(remoteScope(crypto.randomUUID()));
        enableOperationLogging();
    });

    it('sem sessão, e para o visitante de link público, nada é lembrado', async () => {
        await toggleMapTemporal(mapa.name);
        expect(registro()).toBeNull();

        sessionContext.setVisitorSession();
        await toggleMapTemporal(mapa.name);
        expect(registro()).toBeNull();
        expect(personViewTarget(mapa.name)).toBeNull();
    });

    it('quem entrou tem a escolha lembrada sob o id da conta, e a fila e o banco de ajustes não recebem nada', async () => {
        // UM LEITOR, de propósito: a vista da pessoa não pergunta por papel.
        sessionContext.setSession({ userId: 'conta-1', role: 'viewer' });
        const ajustes = getStore(StoreName.SETTINGS);
        const chavesAntes = (await ajustes.keys()).sort();

        await expect(toggleMapTemporal(mapa.name)).resolves.toBe(true);
        rememberMapView(personViewTarget(mapa.name), { baseLayer: 'osm' });

        expect(registro()).toEqual({
            v: 1, owner: 'conta-1', maps: [{ key: mapa.id, temporalEnabled: true, baseLayer: 'osm' }],
        });
        // AS DUAS METADES DA DECISÃO DE 2026-09-20 CONTINUAM DE PÉ: nenhuma operação na fila de
        // saída, nenhuma chave nova no banco de ajustes do atlas (que o retrato regrava e que
        // "Salvar como local" copia).
        expect(await operationQueue.count()).toBe(0);
        expect((await ajustes.keys()).sort()).toEqual(chavesAntes);
        await expect(isMapTemporalSavedEnabled(mapa.name)).resolves.toBe(false);
    });

    it('outra conta no mesmo atlas não herda a vista, e a entrada dela cai no salvo', async () => {
        sessionContext.setSession({ userId: 'conta-1', role: 'editor' });
        await toggleMapTemporal(mapa.name);

        sessionContext.clearSession();
        sessionContext.setSession({ userId: 'conta-2', role: 'editor' });
        await depoisDeUmF5();

        expect(rememberedMapView(mapa.name)).toEqual({});
        expect(isMapTemporalEnabledSync(mapa.name)).toBe(false);
    });
});

describe('a vista lembrada morre com o atlas', () => {
    beforeEach(async () => {
        await montar(localScope(crypto.randomUUID(), `local-${crypto.randomUUID()}`));
        setMapTemporalView(mapa.name, true);
        expect(registro()).not.toBeNull();
    });

    it('esvaziar o namespace (o passo que carrega o invariante do logout) a esquece', async () => {
        const escopo = getActiveScope();
        await clearAtlasDatabases(escopo);
        expect(disco.has(personViewStorageKey(escopo.dbSuffix))).toBe(false);
    });

    it('destruir o namespace (excluir o atlas local) a esquece', async () => {
        const escopo = getActiveScope();
        await dropAtlasDatabases(escopo);
        expect(disco.has(personViewStorageKey(escopo.dbSuffix))).toBe(false);
    });

    it('o wipe do conteúdo ("Limpar Tudo", import não aditivo) a esquece, e só a do atlas ativo', async () => {
        const outro = personViewStorageKey('local-outro-atlas');
        disco.set(outro, JSON.stringify({ v: 1, owner: null, maps: [{ key: 'x', baseLayer: 'osm' }] }));

        await clearAllAtlasStores();

        expect(registro()).toBeNull();
        expect(disco.has(outro)).toBe(true);
    });
});

describe('salvar a vista alinha quem salvou', () => {
    beforeEach(async () => {
        await montar(localScope(crypto.randomUUID(), `local-${crypto.randomUUID()}`));
        rememberMapView(personViewTarget(mapa.name), { baseLayer: 'osm', temporalEnabled: true });
    });

    it('a lembrança de quem salvou é esquecida campo por campo: o que a vista não levou fica', async () => {
        await expect(saveMapView({ ...CAMERA, baseLayer: 'osm' }, mapa.name)).resolves.toBe(true);
        expect(rememberedMapView(mapa.name)).toEqual({ temporalEnabled: true });

        await expect(saveMapView({ ...CAMERA, baseLayer: 'osm', temporalEnabled: true }, mapa.name))
            .resolves.toBe(true);
        expect(rememberedMapView(mapa.name)).toEqual({});
        // E a próxima entrada encontra exatamente o que foi salvo, agora pela vista salva.
        await depoisDeUmF5();
        expect(isMapTemporalEnabledSync(mapa.name)).toBe(true);
    });

    it('um salvamento RECUSADO (mapa travado) não esquece nada', async () => {
        await toggleMapLock(mapa.name);

        await expect(saveMapView({ ...CAMERA, baseLayer: 'imagens', temporalEnabled: false }, mapa.name))
            .resolves.toBe(false);

        expect(rememberedMapView(mapa.name)).toEqual({ baseLayer: 'osm', temporalEnabled: true });
    });
});

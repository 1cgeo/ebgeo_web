// Path: tests/integration/mapa-inicial-segue-a-ordem-do-atlas.repro.test.js
//
// EM QUAL MAPA A ABERTURA DE UM ATLAS DE SERVIDOR ATERRISSA, quando o link não nomeia um.
//
// O DEFEITO, medido em 2026-09-13 com o navegador real (`browser-atlas-url.spec.js`, o caso do
// link profundo com login no meio, seis rodadas em série): o mapa em que a aba aterrissava era
// SORTEADO. `activateAtlasInitialMap` resolvia o último degrau da cadeia por
// `uuidMaps.find(m => m.name)`, e `uuidMaps` vem de `repo.getAllMaps()`, cuja ordem é a ordem de
// CHAVE do IndexedDB, isto é, o UUID do mapa em ordem lexicográfica. Com dois mapas no atlas o
// resultado é cara ou coroa: nas seis rodadas, quatro caíram num mapa e duas no outro, sempre no
// de menor UUID. Dois colaboradores abrindo o MESMO atlas aterrissavam em mapas diferentes, e a
// mesma aba mudava de resposta entre dois boots.
//
// POR QUE ISSO SÓ APARECEU AGORA: até 2026-09-12 um atlas recém-criado pela API nascia SEM mapa
// nenhum, então o degrau tinha um candidato só e o sorteio não tinha o que sortear. `e70ccf3c`
// ("Protege dados remotos e corrige contratos e camadas padrão") passou a semear um mapa padrão
// ("Mapa 1", com as camadas padrão) dentro de `createAtlas`, e a partir daí todo atlas tem pelo
// menos dois candidatos assim que ganha o segundo mapa. O commit `bc797944`, apontado pelo
// bisect, não tem parte nisto: um caso que reprova por sorteio derruba qualquer bisect curto.
//
// O CONTRATO QUE ESTE ARQUIVO PRENDE: a escolha é a ORDEM DO ATLAS (`atlas.mapOrder`, que o
// retrato do servidor preenche na ordem de criação), e não a ordem em que o IndexedDB devolve as
// chaves. A ordem do atlas é a mesma que a aba Mapas mostra, é igual em todo cliente e é estável
// entre boots. O que não estiver listado nela vem depois, na ordem do repositório, que é o
// comportamento anterior para esse resto.

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { activateScope, getActiveScope, remoteScope } from '../../src/js/store/atlas-namespace.js';
import { LocalRepository, localRepository } from '../../src/js/store/repositories/local.repository.js';
import { setRepository } from '../../src/js/store/repositories/index.js';
import { memoryStore } from '../../src/js/store/memory-store.js';
import { mapResolver } from '../../src/js/store/services/map-resolver.service.js';
import { activateAtlasInitialMap, setMapDependencies } from '../../src/js/store/map.operations.js';
import { createAtlas } from '../../src/js/store/atlas/atlas.entity.js';

vi.mock('../../src/js/store/sync/permission-guard.js', async importOriginal => ({
    ...await importOriginal(), checkPermission: () => ({ allowed: true })
}));

vi.mock('../../src/js/config.js', () => ({
    default: {
        basemaps: { 'carta-topografica': { enabled: true } },
        getValidBasemapFallback: () => 'carta-topografica'
    }
}));

// O ÚNICO DUPLO, e ele é de AMBIENTE, não do sujeito: `mapManager.setCurrentMap` alcança o
// container de DI (`getGroupManager`), que só existe depois de `initServices()`, e este arquivo
// mede a ESCOLHA do mapa, não o container. Os mapas, o registro de atlas e a ordem de chave são
// todos reais, em IndexedDB.
const estado = vi.hoisted(() => ({ atual: null }));
vi.mock('../../src/js/store/store-state-manager.js', () => ({
    default: {
        setCurrentMap: async (name) => { estado.atual = name; },
        getCurrentMapName: () => estado.atual,
        getCurrentMapId: () => estado.atual,
        getCurrentMapInfo: () => ({ name: estado.atual, id: estado.atual })
    }
}));

// OS UUIDs SÃO FIXOS E A ORDEM DELES É O SUJEITO. `padrao` é o mapa que o servidor semeia ao
// criar o atlas, logo o PRIMEIRO de `mapOrder`; o UUID dele começa por `f`, então em ordem de
// chave ele vem por ÚLTIMO. `trabalho` é o mapa criado depois, e o UUID dele começa por `0`.
// Sem o conserto, a ordem de chave entrega `trabalho` e a ordem do atlas é ignorada.
const PADRAO = 'ffffffff-0000-4000-8000-000000000001';
const TRABALHO = '00000000-0000-4000-8000-000000000002';

let eventBus;

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

    eventBus = { emit: vi.fn(), on: vi.fn(), off: vi.fn() };
    setMapDependencies({
        eventBus,
        groupManager: { loadGroupsToMemory: vi.fn(async () => {}), clearMapGroups: vi.fn(async () => {}) },
        layerManager: { loadLayersToMemory: vi.fn(async () => {}), clearLayersCache: vi.fn() }
    });

    mapResolver.clear();
    memoryStore.lockedMaps.clear();
    estado.atual = null;
});

/** Grava os dois mapas do atlas e o registro de atlas com a ordem do servidor. */
async function semearAtlas({ mapOrder }) {
    await localRepository.saveMap(PADRAO, { id: PADRAO, name: 'Mapa 1', features: {} });
    await localRepository.saveMap(TRABALHO, { id: TRABALHO, name: 'Operações', features: {} });
    await localRepository.saveAtlas({
        ...createAtlas('Atlas do servidor'),
        id: getActiveScope().atlasId,
        mapOrder
    });
}

describe('activateAtlasInitialMap sem mapa pedido', () => {
    it('aterrissa no PRIMEIRO mapa do atlas, mesmo quando a ordem de chave diz outro', async () => {
        // A premissa que faz o caso medir alguma coisa: a ordem de CHAVE contradiz a do atlas.
        await semearAtlas({ mapOrder: [PADRAO, TRABALHO] });
        expect(await localRepository.getAllMapIds()).toEqual([TRABALHO, PADRAO]);

        expect(await activateAtlasInitialMap()).toBe('Mapa 1');
    });

    it('a ordem do atlas manda nos dois sentidos', async () => {
        // O CONTROLE do caso acima: invertida a ordem do atlas, a resposta inverte junto. Sem
        // ele, "acertou o Mapa 1" seria indistinguível de "prefere o de maior UUID".
        await semearAtlas({ mapOrder: [TRABALHO, PADRAO] });

        expect(await activateAtlasInitialMap()).toBe('Operações');
    });

    it('mapa fora da ordem do atlas vem depois dos listados', async () => {
        await semearAtlas({ mapOrder: [PADRAO] });

        expect(await activateAtlasInitialMap()).toBe('Mapa 1');
    });

    it('sem registro de atlas legível, a escolha continua sendo feita (ordem do repositório)', async () => {
        // Nenhum atlas gravado: o degrau degrada para o que sempre fez, em vez de recusar o boot.
        await localRepository.saveMap(PADRAO, { id: PADRAO, name: 'Mapa 1', features: {} });

        expect(await activateAtlasInitialMap()).toBe('Mapa 1');
    });

    it('o mapa pedido pelo link continua ganhando da ordem do atlas', async () => {
        await semearAtlas({ mapOrder: [PADRAO, TRABALHO] });

        expect(await activateAtlasInitialMap(TRABALHO)).toBe('Operações');
    });
});

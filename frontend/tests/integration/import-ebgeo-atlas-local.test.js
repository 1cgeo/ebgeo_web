// Path: tests/integration/import-ebgeo-atlas-local.test.js

/**
 * @fileoverview O import de `.ebgeo` com um projeto do SERVIDOR aberto: ele cria um atlas LOCAL
 * novo e troca para ele (P4).
 *
 * O QUE ESTAVA EM JOGO. O import escreve no escopo que estiver MONTADO. Com um namespace por
 * atlas esse escopo pode ser `ebgeo_*__remote-<id>`, e o projeto importado nascia lá dentro: o
 * usuário via os mapas aparecerem e os perdia no logout seguinte, junto com o namespace, sem
 * erro nenhum. E3 recortou o problema recusando o import; agora ele muda de atlas.
 *
 * A FÁBRICA DE NAMESPACE É REAL AQUI, como em `namespace-remoto-fiacao.test.js`, e pela mesma
 * razão: a pergunta deste arquivo é EM QUAL BANCO cada coisa caiu, e ela só tem resposta se o
 * disco falso distinguir bancos por NOME. Toda asserção abaixo nomeia o banco por extenso.
 *
 * O `clearAllDataStore` é dublê, e o dublê reproduz a propriedade que importa: o wipe de verdade
 * esvazia os bancos do escopo ATIVO (`unmountCurrentAtlas` → `clearAllAtlasStores`). O resto
 * dele (rebuild do repositório, caches, eventos) precisaria do boot inteiro e não muda em qual
 * banco a limpeza cai. `addMap` também é dublê, e escreve pelo `getStore` DE VERDADE: é ele que
 * carrega a pergunta "onde o projeto importado foi parar".
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import JSZip from 'jszip';

// ============================================================================
// Disco falso, chaveado por (nome do banco, object store).
// ============================================================================

const { databases, dropFromFake, makeStore, resetFake } = vi.hoisted(() => {
    const databases = new Map();

    function makeStore({ name, storeName = null }) {
        const key = `${name}::${storeName || 'keyvaluepairs'}`;
        const backing = databases.get(key) ?? new Map();
        databases.set(key, backing);
        return {
            __dbName: name,
            setItem: vi.fn(async (k, v) => { backing.set(k, v); return v; }),
            getItem: vi.fn(async (k) => (backing.has(k) ? backing.get(k) : null)),
            removeItem: vi.fn(async (k) => { backing.delete(k); }),
            keys: vi.fn(async () => [...backing.keys()]),
            length: vi.fn(async () => backing.size),
            clear: vi.fn(async () => { backing.clear(); }),
            iterate: vi.fn(async (callback) => {
                for (const [k, v] of backing.entries()) callback(v, k);
            })
        };
    }

    async function dropFromFake({ name }) {
        for (const key of [...databases.keys()]) {
            if (key.startsWith(`${name}::`)) databases.delete(key);
        }
    }

    return { databases, dropFromFake, makeStore, resetFake: () => databases.clear() };
});

vi.mock('localforage', () => ({
    default: {
        createInstance: vi.fn(makeStore),
        dropInstance: vi.fn(dropFromFake)
    }
}));

// ------------------------------------------------------------------ dublês do resto do mundo

const fixture = vi.hoisted(() => ({
    calls: [],
    toasts: { error: [], info: [], success: [] },
    syncEngine: { atlasId: null, connect: null, disconnect: null }
}));

const { calls, toasts } = fixture;
fixture.syncEngine.connect = vi.fn(async (atlasId) => { fixture.syncEngine.atlasId = atlasId; });
fixture.syncEngine.disconnect = vi.fn(() => {
    calls.push('disconnect');
    fixture.syncEngine.atlasId = null;
});

vi.mock('@store/sync/sync-engine.js', () => ({ syncEngine: fixture.syncEngine }));
vi.mock('@store/sync/api-client.js', () => ({ apiClient: {} }));
vi.mock('@store/sync/sync-flush.js', () => ({
    startAutoFlush: vi.fn(),
    stopAutoFlush: vi.fn(() => { calls.push('stopAutoFlush'); })
}));
vi.mock('@modals/confirm.modal.js', () => ({ showChoice: vi.fn(async () => 'discard') }));
vi.mock('@modals/prompt.modal.js', () => ({ showPrompt: vi.fn(async () => 'nome') }));
vi.mock('@modals/export.modal.js', () => ({ showExportModal: vi.fn() }));
vi.mock('@js/import_export/save-local-atlas.service.js', () => ({
    saveLocalAtlasToServer: vi.fn(async () => ({ stats: {}, imageStats: {} })),
}));
vi.mock('@utils/toast_service.js', () => ({
    showToast: vi.fn((m, tipo) => { (toasts[tipo] ?? (toasts[tipo] = [])).push(m); }),
    showSuccess: vi.fn((m) => { toasts.success.push(m); }),
    showError: vi.fn((m) => { toasts.error.push(m); }),
    showWarning: vi.fn(),
    showInChannel: vi.fn(),
}));
vi.mock('@js/config.js', () => ({
    default: { getValidBasemapFallback: (v) => v || 'osm', app: {} }
}));
// A arbitragem entre abas é medida em `tab-lock-atlas-integration.test.js`. Aqui interessa que a
// reivindicação MUDE de atlas junto com o escopo, então `setTabLockKey` é observado, não simulado.
vi.mock('@utils/tab-lock.js', async (importOriginal) => ({
    ...await importOriginal(),
    acquireTabLock: vi.fn(async () => ({ granted: true })),
    getTabLock: vi.fn(() => ({ key: { kind: 'none', atlasId: null }, blocked: false })),
    setTabLockKey: vi.fn((key) => { fixture.lockKey = key; }),
    releaseTabLock: vi.fn(),
}));

// HOISTED, como todo dublê citado dentro de uma fábrica de `vi.mock`: as fábricas sobem para o
// topo do arquivo e uma `const` comum ainda não existe quando elas rodam.
const { wipeDoEscopoAtivo, addMapNoEscopoAtivo } = vi.hoisted(() => ({
    /** Esvazia os bancos do escopo ATIVO: é a metade do wipe que decide onde ele cai. */
    wipeDoEscopoAtivo: vi.fn(async () => {
        const ns = await import('@store/atlas-namespace.js');
        for (const { store } of ns.listAtlasStores()) await store.clear();
    }),
    /** `addMap` de verdade grava no `getStore(MAPS)` do escopo ativo; o dublê faz só isso. */
    addMapNoEscopoAtivo: vi.fn(async (name, data) => {
        const ns = await import('@store/atlas-namespace.js');
        await ns.getStore(ns.StoreName.MAPS).setItem(name, data);
    }),
}));

vi.mock('@store/store.js', async (importOriginal) => {
    const real = await importOriginal();
    return {
        ...real,
        clearAllDataStore: wipeDoEscopoAtivo,
        activateAtlasInitialMap: vi.fn(async () => {}),
        hasAnyMapFeatures: vi.fn(async () => false),
    };
});

// O barril inteiro: `export-import.service.js` importa ~40 símbolos dele, e um import nomeado
// ausente é erro de módulo, não de teste. Os três que carregam significado são
// `isRemoteStoreSync` (o de VERDADE, senão o ramo sob teste nunca dispara), `clearAllDataStore`
// e `addMap`; o resto é inerte de propósito.
vi.mock('@store', async () => {
    const origem = await import('@store/store-origin.js');
    const utils = await import('@store/repository.utils.js');
    const inerte = () => vi.fn(async () => {});
    return {
        isRemoteStoreSync: origem.isRemoteStoreSync,
        clearAllDataStore: wipeDoEscopoAtivo,
        addMap: addMapNoEscopoAtivo,
        MIN_SCHEMA_VERSION: utils.MIN_SCHEMA_VERSION,
        compareVersions: utils.compareVersions,
        getControl: vi.fn(() => null),
        getAllMapNamesStore: vi.fn(async () => []),
        getCurrentMapName: vi.fn(async () => 'Mapa Importado'),
        getCurrentMapFeatures: vi.fn(async () => null),
        getCurrentBaseLayer: vi.fn(async () => 'osm'),
        setBaseLayer: inerte(),
        setCurrentMap: inerte(),
        getImage: vi.fn(async () => null),
        storeImage: inerte(),
        setSchemaVersion: inerte(),
        getColorUsage: vi.fn(async () => ({})),
        getMapNotes: vi.fn(async () => null),
        getGridStyle: vi.fn(async () => null),
        setGridStyle: inerte(),
        getMapGroups: vi.fn(() => ({})),
        getLayers: vi.fn(async () => []),
        setMapLayers: inerte(),
        getMapPosition: vi.fn(async () => ({})),
        getMapOrder: vi.fn(async () => []),
        setMapOrder: inerte(),
        processCatalogLayersOnImport: vi.fn((layers) => ({ processed: layers, unavailableCount: 0 })),
        getCatalogLayers: vi.fn(async () => []),
        getCesium3dDataForExport: vi.fn(async () => null),
        setCesium3dDataForImport: inerte(),
        getStreetview360DataForExport: vi.fn(async () => null),
        setStreetview360DataForImport: inerte(),
        getMapTemporalConfig: vi.fn(async () => null),
        setMapTemporalConfig: inerte(),
        getComments: vi.fn(async () => ({})),
        setMapComments: inerte(),
        getBriefingsForExport: vi.fn(async () => []),
        importBriefings: vi.fn(async () => ({ imported: 0, skipped: 0 })),
        getCustomIconsForExport: vi.fn(async () => []),
        restoreCustomIconsFromImport: inerte(),
        getGroupManager: vi.fn(() => ({ importMapGroups: vi.fn(async () => {}) })),
    };
});

// ESTÁTICO, e SEM `vi.resetModules()`: um reset daria ao teste uma segunda instância de
// `atlas-namespace.js`, e as asserções passariam a ler o escopo ativo de um módulo que o import
// não usa. O isolamento é feito à mão no `beforeEach`, sobre o estado que os módulos guardam.
import * as ns from '@store/atlas-namespace.js';
import * as remoteApi from '@store/remote-atlas.api.js';
import * as localApi from '@store/local-atlas.api.js';
import * as origem from '@store/store-origin.js';
import { ExportImportService } from '@js/import_export/export-import.service.js';
import { localSlotsOnDisk } from '../helpers/atlas-registry-disk.js';

// Quantos bancos um atlas possui é decisão de `atlas-namespace.js` e já mudou de 10 para 11 no
// meio desta fase. Uma lista copiada aqui só espera a próxima mudança para medir um subconjunto e
// chamá-lo de conjunto, então os nomes são DERIVADOS. O piso abaixo é o controle de cobertura
// vazia: uma derivação quebrada devolveria [] e todo `toEqual` sobre ela passaria dizendo nada.
const MIN_BANCOS_POR_ATLAS = 10;

// O ambiente é `node`, e `_showButtonSuccess` procura o botão no DOM. Sem isto o caminho de
// sucesso morre num `ReferenceError` capturado pelo `catch` do import, e TUDO que vem depois dele
// (inclusive a frase que explica a troca de atlas) deixa de rodar sem que nenhuma asserção veja.
globalThis.document = { querySelector: () => null };

const ATLAS_SERVIDOR = '11111111-1111-4111-8111-111111111111';
const SENTINELA = '__sentinela_do_teste__';
const MAPA = 'Mapa Importado';

beforeEach(async () => {
    resetFake();
    calls.length = 0;
    toasts.error.length = 0;
    toasts.info = [];
    toasts.success.length = 0;
    fixture.syncEngine.atlasId = null;
    fixture.lockKey = null;
    vi.clearAllMocks();

    ns.clearStoreCache();
    ns.clearActiveScope();
    await origem.loadStoreOrigin();
    await localApi.initLocalAtlases();
});

// ---------------------------------------------------------------------------------- utilidades

/** @returns {ExportImportService} O serviço com os colaboradores de UI dublados. */
function servico() {
    return new ExportImportService(
        { switchMap: vi.fn(async () => {}) },
        { deactivateCurrentTool: vi.fn() },
        {},
        { emit: vi.fn() }
    );
}

/**
 * Um `.ebgeo` de verdade: ZIP com `data.json`. Sem a máscara XOR de propósito — `handleImport`
 * aceita as duas formas, e o ZIP cru mantém a fixture legível.
 * @param {string} nome - Nome do arquivo, de onde sai o nome do atlas.
 * @returns {Promise<{name: string, arrayBuffer: () => Promise<ArrayBuffer>}>}
 */
async function arquivoEbgeo(nome) {
    const { ATLAS_SCHEMA_VERSION } = await import('@store/atlas/atlas.entity.js');
    const zip = new JSZip();
    zip.file('data.json', JSON.stringify({
        version: ATLAS_SCHEMA_VERSION,
        currentMap: MAPA,
        mapOrder: [MAPA],
        maps: { [MAPA]: { baseLayer: 'osm', features: { points: [] } } },
        colorUsage: {}, mapNotes: {}, groups: {}, layers: {},
        cesium3d: {}, streetview360: {}, temporal: {}, gridStyle: {}, comments: {}, briefings: [],
    }));
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    return { name: nome, arrayBuffer: async () => buffer };
}

/** Dispara o import como o `input[type=file]` faz. */
async function importar(file, { aditivo = false } = {}) {
    const evento = { target: { files: [file], value: 'x' } };
    await servico().handleImport(evento, aditivo);
}

/** Põe a aba dentro de um atlas de servidor, pelo caminho legal (registra e só então aponta). */
async function abrirAtlasDeServidor(atlasId) {
    await remoteApi.activateRemoteAtlas(atlasId);
    await origem.markStoreRemote(atlasId);
    fixture.syncEngine.atlasId = atlasId;
    for (const { store } of ns.listAtlasStores()) await store.setItem(SENTINELA, 1);
}

/** @param {object} scope @returns {string[]} Os bancos daquele escopo, por nome ABSOLUTO. */
function bancosDoEscopo(scope) {
    const nomes = ns.listAtlasStores(scope).map(({ store }) => store.__dbName);
    expect(nomes.length).toBeGreaterThanOrEqual(MIN_BANCOS_POR_ATLAS);
    return nomes;
}

/** @param {string} atlasId @returns {string[]} Os bancos de um atlas de servidor, absolutos. */
function bancosRemotos(atlasId) {
    return bancosDoEscopo(ns.remoteScope(atlasId));
}

/** @param {string[]} nomes @returns {string[]} Os que ainda guardam a sentinela. */
function aindaComSentinela(nomes) {
    return nomes.filter(nome => databases.get(`${nome}::keyvaluepairs`)?.has(SENTINELA));
}

/** @returns {Array<object>} Os slots locais lidos das CHAVES CRUAS do banco global. */
function slotsNoDisco() {
    return localSlotsOnDisk(databases.get('ebgeo_global::keyvaluepairs'));
}

/** @param {string} dbName @returns {boolean} Se aquele banco de mapas guarda o mapa importado. */
function temOMapa(dbName) {
    return Boolean(databases.get(`${dbName}::keyvaluepairs`)?.has(MAPA));
}

// ============================================================================================
describe('import de .ebgeo com atlas de SERVIDOR montado', () => {
    it('cria um atlas local NOVO, monta, e o projeto cai nos bancos DELE', async () => {
        await abrirAtlasDeServidor(ATLAS_SERVIDOR);
        const slotsAntes = slotsNoDisco();
        expect(slotsAntes).toHaveLength(1);
        expect(origem.isRemoteStoreSync()).toBe(true);

        await importar(await arquivoEbgeo('Operação Alfa.ebgeo'));

        // 1. O registro local ganhou EXATAMENTE uma entrada, e ela leva o nome do arquivo.
        const slotsDepois = slotsNoDisco();
        expect(slotsDepois).toHaveLength(2);
        const novo = slotsDepois.find(s => !slotsAntes.some(a => a.id === s.id));
        expect(novo.name).toBe('Operação Alfa');

        // 2. O escopo montado é o do slot novo, pelo NOME ABSOLUTO do banco.
        expect(ns.getActiveScope()).toEqual(ns.localScope(novo.id, novo.dbSuffix));
        expect(ns.getStore(ns.StoreName.MAPS).__dbName).toBe(`ebgeo_maps__${novo.dbSuffix}`);

        // 3. O projeto importado está NAQUELE banco.
        expect(temOMapa(`ebgeo_maps__${novo.dbSuffix}`)).toBe(true);

        // 4. CONTROLES, e são eles que separam "caiu no lugar certo" de "caiu em algum lugar":
        //    o namespace do servidor não recebeu o mapa E continua com o que tinha (um wipe
        //    disparado antes da montagem levaria a sentinela junto), e o slot local #1, que é
        //    onde a ponte do repositório cai quando ninguém monta nada, também está intocado.
        expect(temOMapa(`ebgeo_maps__remote-${ATLAS_SERVIDOR}`)).toBe(false);
        expect(aindaComSentinela(bancosRemotos(ATLAS_SERVIDOR))).toEqual(bancosRemotos(ATLAS_SERVIDOR));
        expect(temOMapa('ebgeo_maps')).toBe(false);

        // 5. A origem ficou LOCAL, e apontando para o slot novo no próximo boot.
        expect(origem.isRemoteStoreSync()).toBe(false);
        expect(localApi.getCurrentLocalAtlasId()).toBe(novo.id);

        // 6. E o usuário foi avisado da troca. Um import que muda de atlas em silêncio deixa a
        //    pessoa procurando o projeto do servidor que "sumiu".
        expect(toasts.error).toEqual([]);
        expect(toasts.info.join(' ')).toContain('Operação Alfa');
    });

    it('a sessão do servidor é encerrada e a reivindicação da aba muda de atlas', async () => {
        await abrirAtlasDeServidor(ATLAS_SERVIDOR);

        await importar(await arquivoEbgeo('Operação Alfa.ebgeo'));

        // Um socket por atlas: sair sem fechar deixaria a aba recebendo op de um projeto que ela
        // não tem mais montado, e o auto-flush empurrando trabalho para dentro dele.
        expect(calls).toContain('stopAutoFlush');
        expect(calls).toContain('disconnect');
        expect(fixture.syncEngine.atlasId).toBeNull();

        // E a chave do tab-lock deixa de nomear o atlas de servidor, senão esta aba seguiria
        // bloqueando as outras em nome de um projeto que ela fechou.
        expect(fixture.lockKey).toEqual({ kind: 'local', atlasId: localApi.getCurrentLocalAtlasId() });
    });

    it('ORDEM: a montagem vem ANTES do wipe (senão o wipe cai no atlas do servidor)', async () => {
        await abrirAtlasDeServidor(ATLAS_SERVIDOR);

        await importar(await arquivoEbgeo('Operação Alfa.ebgeo'));

        // O escopo em que o wipe rodou é medido pelo efeito, não pela ordem das chamadas: os dez
        // bancos do servidor continuam cheios, e é isso que prova onde a limpeza caiu.
        expect(wipeDoEscopoAtivo).toHaveBeenCalledTimes(1);
        expect(aindaComSentinela(bancosRemotos(ATLAS_SERVIDOR)))
            .toEqual(bancosRemotos(ATLAS_SERVIDOR));
    });

    it('o import ADITIVO é RECUSADO, com a saída escrita na mensagem', async () => {
        await abrirAtlasDeServidor(ATLAS_SERVIDOR);

        await importar(await arquivoEbgeo('Operação Alfa.ebgeo'), { aditivo: true });

        expect(toasts.error).toHaveLength(1);
        expect(toasts.error[0]).toContain('Importar projeto');
        // Nada aconteceu: nem slot novo, nem desconexão, nem escrita em lugar nenhum.
        expect(slotsNoDisco()).toHaveLength(1);
        expect(calls).toEqual([]);
        expect(wipeDoEscopoAtivo).not.toHaveBeenCalled();
        expect(ns.getActiveScope()).toEqual(ns.remoteScope(ATLAS_SERVIDOR));
        expect(origem.isRemoteStoreSync()).toBe(true);
    });
});

// ============================================================================================
describe('o teto de 10 atlas locais degrada para RECUSA, nunca para exceção nem para wipe', () => {
    it('com o registro cheio, o import recusa em pt-BR e não toca em nada', async () => {
        for (let i = 2; i <= localApi.MAX_LOCAL_ATLASES; i++) {
            const criado = await localApi.createLocalAtlas(`Atlas ${i}`);
            // Controle da borda de baixo: um teto que disparasse cedo deixaria isto vermelho e o
            // caso passaria a medir outra coisa.
            expect(criado.ok).toBe(true);
        }
        await abrirAtlasDeServidor(ATLAS_SERVIDOR);
        expect(slotsNoDisco()).toHaveLength(10);

        await importar(await arquivoEbgeo('Operação Alfa.ebgeo'));

        expect(toasts.error).toHaveLength(1);
        expect(toasts.error[0]).toContain('Limite de 10 atlas locais atingido');
        expect(toasts.error[0]).toContain('continua aberto');

        // O preço da recusa é zero: nenhum slot novo, nenhuma desconexão, nenhum wipe, e o
        // projeto do servidor segue montado com o que tinha.
        expect(slotsNoDisco()).toHaveLength(10);
        expect(calls).toEqual([]);
        expect(wipeDoEscopoAtivo).not.toHaveBeenCalled();
        expect(ns.getActiveScope()).toEqual(ns.remoteScope(ATLAS_SERVIDOR));
        expect(origem.isRemoteStoreSync()).toBe(true);
        expect(fixture.syncEngine.atlasId).toBe(ATLAS_SERVIDOR);
        expect(aindaComSentinela(bancosRemotos(ATLAS_SERVIDOR)))
            .toEqual(bancosRemotos(ATLAS_SERVIDOR));
    });

    it('CONTROLE: com uma vaga livre o MESMO import passa', async () => {
        // Sem este par, o caso acima passaria também contra um import que recusasse sempre.
        for (let i = 2; i < localApi.MAX_LOCAL_ATLASES; i++) {
            await localApi.createLocalAtlas(`Atlas ${i}`);
        }
        await abrirAtlasDeServidor(ATLAS_SERVIDOR);
        expect(slotsNoDisco()).toHaveLength(9);

        await importar(await arquivoEbgeo('Operação Alfa.ebgeo'));

        expect(toasts.error).toEqual([]);
        expect(slotsNoDisco()).toHaveLength(10);
        expect(origem.isRemoteStoreSync()).toBe(false);
    });
});

// ============================================================================================
describe('CONTROLE NEGATIVO: sem atlas de servidor o import não gasta um slot', () => {
    it('num atlas LOCAL o import continua substituindo no lugar', async () => {
        const slot = localApi.listLocalAtlases()[0];
        ns.activateScope(localApi.scopeOfLocalAtlas(slot));
        expect(origem.isRemoteStoreSync()).toBe(false);

        await importar(await arquivoEbgeo('Operação Alfa.ebgeo'));

        // Nenhum slot novo: dez importações não podem consumir o teto de 10 do usuário.
        expect(slotsNoDisco()).toHaveLength(1);
        expect(ns.getActiveScope()).toEqual(localApi.scopeOfLocalAtlas(slot));
        // E o projeto entrou no banco do slot que já estava montado (o legado, sem sufixo).
        expect(temOMapa('ebgeo_maps')).toBe(true);
        expect(wipeDoEscopoAtivo).toHaveBeenCalledTimes(1);
        expect(calls).toEqual([]);
        // A frase sobre "atlas local novo" não aparece quando não houve troca.
        expect((toasts.info ?? []).join(' ')).not.toContain('atlas local novo');
    });
});

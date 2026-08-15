// Path: tests/integration/namespace-remoto-fiacao.test.js

/**
 * @fileoverview A abertura de um atlas de servidor montando o NAMESPACE daquele atlas.
 *
 * A maquinaria (`activateRemoteAtlas`, o registro remoto, a varredura derivada) existia sem
 * chamador de produção: `openRemoteAtlas` nunca ativava escopo, então todo atlas de servidor
 * resolvia para o mesmo `ebgeo_maps`. Este arquivo prende a fiação e o que ela vale.
 *
 * A FÁBRICA DE NAMESPACE É REAL AQUI, e é isso que distingue este arquivo de
 * `tab-lock-atlas-integration.test.js`, que mede a ORDEM das chamadas contra dublês. Lá se
 * prova que a ativação vem antes do wipe; aqui se prova EM QUAL BANCO cada coisa caiu.
 *
 * O wipe é o único dublê que importa, e ele reproduz a propriedade que interessa: o
 * `clearAllDataStore` de verdade esvazia os dez bancos do ESCOPO ATIVO (`unmountCurrentAtlas`
 * → `clearAllAtlasStores`), e é isso que o dobro faz. O resto do `clearAllDataStore` real
 * (rebuild do repositório, caches de mapa, eventos) precisaria do boot inteiro e não muda em
 * qual banco a limpeza cai, que é a pergunta deste arquivo.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
    syncEngine: { atlasId: null, connect: null, disconnect: null }
}));

const { calls } = fixture;
fixture.syncEngine.connect = vi.fn(async (atlasId) => {
    calls.push('connect');
    fixture.syncEngine.atlasId = atlasId;
});
fixture.syncEngine.disconnect = vi.fn(() => { fixture.syncEngine.atlasId = null; });

vi.mock('@store/sync/sync-engine.js', () => ({ syncEngine: fixture.syncEngine }));
vi.mock('@store/sync/api-client.js', () => ({ apiClient: {} }));
vi.mock('@store', () => ({ getControl: vi.fn(() => null) }));
vi.mock('@store/sync/sync-flush.js', () => ({ startAutoFlush: vi.fn(), stopAutoFlush: vi.fn() }));
vi.mock('@modals/confirm.modal.js', () => ({ showChoice: vi.fn(async () => 'discard') }));
vi.mock('@modals/prompt.modal.js', () => ({ showPrompt: vi.fn(async () => 'nome') }));
vi.mock('@js/import_export/save-local-atlas.service.js', () => ({
    saveLocalAtlasToServer: vi.fn(async () => ({ stats: {}, imageStats: {} })),
}));
vi.mock('@utils/toast_service.js', () => ({
    showToast: vi.fn(), showSuccess: vi.fn(), showError: vi.fn(), showWarning: vi.fn(),
    showInChannel: vi.fn(),
}));
// A arbitragem entre abas é medida em `tab-lock-atlas-integration.test.js`; aqui ela é sempre
// concedida, para que o que falhe seja o namespace e nunca o lock.
//
// AS FUNÇÕES PURAS DO LOCK SÃO AS DE VERDADE (só a instância e as reivindicações são dublês),
// porque o último teste deste arquivo pergunta se a CHAVE derivada de um escopo real colide com
// o atlas de servidor de origem. Um `keysCollide` de mentira responderia o que o teste quisesse.
vi.mock('@utils/tab-lock.js', async (importOriginal) => ({
    ...await importOriginal(),
    acquireTabLock: vi.fn(async () => ({ granted: true })),
    getTabLock: vi.fn(() => null),
    setTabLockKey: vi.fn(),
    releaseTabLock: vi.fn(),
}));

/**
 * O `@store/store.js` REAL, com apenas o que precisa de boot completo substituído. O
 * `activateRemoteAtlas` reexportado por ele é o de verdade: é ele que está sob teste.
 */
vi.mock('@store/store.js', async (importOriginal) => {
    const real = await importOriginal();
    const ns = await import('@store/atlas-namespace.js');
    return {
        ...real,
        // Reproduz o essencial do wipe: esvaziar os dez bancos do escopo ATIVO.
        clearAllDataStore: vi.fn(async () => {
            calls.push('clearAllDataStore');
            for (const { store } of ns.listAtlasStores()) await store.clear();
        }),
        activateAtlasInitialMap: vi.fn(async () => { calls.push('activateAtlasInitialMap'); }),
        hasAnyMapFeatures: vi.fn(async () => false),
    };
});

// ESTÁTICO, e NÃO há `vi.resetModules()` neste arquivo. O dublê acima captura o grafo de
// módulos em que a fábrica rodou; um reset daria ao teste uma SEGUNDA instância de
// `atlas-namespace.js`, e as asserções passariam a ler o escopo ativo de um módulo que a
// abertura não usa. O isolamento entre testes é feito à mão no `beforeEach`, sobre o estado
// que os módulos de fato guardam (escopo ativo, cache de instâncias, registro, marcador).
import * as ns from '@store/atlas-namespace.js';
import * as remoteApi from '@store/remote-atlas.api.js';
import * as localApi from '@store/local-atlas.api.js';
import * as origem from '@store/store-origin.js';
import * as abrir from '@js/account/open-atlas.service.js';
import { keysCollide, remoteAtlasKey } from '@utils/tab-lock.js';

const PER_ATLAS_BASE_NAMES = [
    'ebgeo_atlas',
    'ebgeo_maps',
    'ebgeo_images',
    'ebgeo_app_settings',
    'ebgeo_groups',
    'ebgeo_layers',
    'ebgeo_cesium3d',
    'ebgeo_streetview360',
    'ebgeo_briefings',
    'ebgeo_comments'
];

const SENTINELA = '__sentinela_do_teste__';
const ATLAS_A = '11111111-1111-4111-8111-111111111111';
const ATLAS_B = '22222222-2222-4222-8222-222222222222';

beforeEach(async () => {
    resetFake();
    calls.length = 0;
    fixture.syncEngine.atlasId = null;
    vi.clearAllMocks();

    // Estado de módulo, devolvido ao zero: o disco falso foi apagado, então as instâncias em
    // cache apontam para tabelas que não existem mais.
    ns.clearStoreCache();
    ns.clearActiveScope();
    await origem.loadStoreOrigin();

    // Um boot local já aconteceu: existe um slot local montado, como em qualquer aba real.
    await localApi.initLocalAtlases();
});

/** @returns {string[]} Os dez bancos de um atlas remoto, absolutos. */
function bancosRemotos(atlasId) {
    return PER_ATLAS_BASE_NAMES.map(base => `${base}__remote-${atlasId}`);
}

/** @param {string[]} nomes @returns {string[]} Os que ainda guardam a sentinela. */
function aindaComSentinela(nomes) {
    return nomes.filter(nome => databases.get(`${nome}::keyvaluepairs`)?.has(SENTINELA));
}

/** Semeia a sentinela nos dez bancos de um escopo. */
async function semear(scope) {
    for (const { store } of ns.listAtlasStores(scope)) await store.setItem(SENTINELA, 1);
}

describe('openRemoteAtlas :: monta o namespace do atlas aberto', () => {
    it('REGISTRA e ativa o namespace daquele atlas, antes de qualquer escrita', async () => {
        expect(await abrir.openRemoteAtlas(ATLAS_A)).toBe(true);

        expect(ns.getActiveScope()).toEqual(ns.remoteScope(ATLAS_A));
        expect((await remoteApi.listRemoteAtlases()).map(e => e.atlasId)).toEqual([ATLAS_A]);
        expect(ns.getStore(ns.StoreName.MAPS).__dbName).toBe(`ebgeo_maps__remote-${ATLAS_A}`);
        expect(calls).toEqual(['clearAllDataStore', 'connect', 'activateAtlasInitialMap']);
    });

    it('o wipe cai no namespace ABERTO, não no atlas local que a aba tinha montado', async () => {
        const slotLocal = localApi.scopeOfLocalAtlas(localApi.listLocalAtlases()[0]);
        await semear(slotLocal);
        await semear(ns.remoteScope(ATLAS_A));

        await abrir.openRemoteAtlas(ATLAS_A);

        // O bloco que a abertura veio limpar: vazio.
        expect(aindaComSentinela(bancosRemotos(ATLAS_A))).toEqual([]);
        // CONTROLE: o trabalho local segue no disco. Antes da fiação os dois eram os MESMOS
        // dez bancos, e esta linha lia uma lista vazia.
        expect(aindaComSentinela(PER_ATLAS_BASE_NAMES)).toEqual(PER_ATLAS_BASE_NAMES);
    });

    it('dois atlas de servidor, dois blocos de bancos: abrir o segundo não toca no primeiro', async () => {
        await abrir.openRemoteAtlas(ATLAS_A);
        await semear(ns.remoteScope(ATLAS_A));

        await abrir.openRemoteAtlas(ATLAS_B);

        expect(ns.getActiveScope()).toEqual(ns.remoteScope(ATLAS_B));
        expect(aindaComSentinela(bancosRemotos(ATLAS_A))).toEqual(bancosRemotos(ATLAS_A));
        expect((await remoteApi.listRemoteAtlases()).map(e => e.atlasId).sort())
            .toEqual([ATLAS_A, ATLAS_B].sort());
    });

    it('o namespace fica ALCANÇÁVEL pela varredura do logout, que é o motivo do registro', async () => {
        await abrir.openRemoteAtlas(ATLAS_A);
        await semear(ns.remoteScope(ATLAS_A));

        const relatorio = await remoteApi.purgeAllRemoteAtlases();

        expect(relatorio.atlases).toEqual([ATLAS_A]);
        expect(aindaComSentinela(bancosRemotos(ATLAS_A))).toEqual([]);
    });

    it('CONTROLE NEGATIVO: escopo ativado SEM registro é dado que a varredura não acha', async () => {
        // É por isto que `activateRemoteAtlas` é o único caminho legal: `activateScope` sozinho
        // pula o registro, e um namespace fora do registro sobrevive ao logout em silêncio.
        ns.activateScope(ns.remoteScope(ATLAS_B));
        await semear(ns.remoteScope(ATLAS_B));

        const relatorio = await remoteApi.purgeAllRemoteAtlases();

        expect(relatorio.atlases).toEqual([]);
        expect(aindaComSentinela(bancosRemotos(ATLAS_B))).toEqual(bancosRemotos(ATLAS_B));
    });

    it('registro que falha: nada é ativado, nada é apagado e a abertura propaga o erro', async () => {
        const globalStore = ns.getGlobalStore();
        const escopoAntes = ns.getActiveScope();
        globalStore.setItem.mockRejectedValueOnce(new Error('QuotaExceeded'));
        await semear(escopoAntes);

        await expect(abrir.openRemoteAtlas(ATLAS_A)).rejects.toThrow(/QuotaExceeded/);

        expect(ns.getActiveScope()).toEqual(escopoAntes);
        expect(calls).not.toContain('clearAllDataStore');
        expect(calls).not.toContain('connect');
        expect(aindaComSentinela(PER_ATLAS_BASE_NAMES)).toEqual(PER_ATLAS_BASE_NAMES);
    });

    it('connect que falha reverte a origem e deixa o registro de pé para a varredura', async () => {
        fixture.syncEngine.connect.mockRejectedValueOnce(
            Object.assign(new Error('403'), { status: 403 })
        );

        await expect(abrir.openRemoteAtlas(ATLAS_A)).rejects.toThrow('403');

        expect(origem.isRemoteStoreSync()).toBe(false);
        // O namespace foi criado e tem de continuar alcançável: a origem local não é inventário.
        expect((await remoteApi.listRemoteAtlases()).map(e => e.atlasId)).toEqual([ATLAS_A]);
    });
});

// ============================================================================
// O SLOT ADOTADO: o único par em que uma chave LOCAL e uma chave REMOTA nomeiam os mesmos
// bancos, medido com a adoção de verdade em cima do namespace de verdade.
// ============================================================================

describe('resgate adotado :: a chave do lock nomeia o ENDEREÇO, não o tipo', () => {
    it('depois da adoção, a chave derivada do escopo colide com o atlas de servidor de origem', async () => {
        await abrir.openRemoteAtlas(ATLAS_A);
        await semear(ns.remoteScope(ATLAS_A));

        // O resgate do logout, com zero cópia: o slot local fica com os MESMOS dez bancos.
        const adocao = await localApi.adoptRemoteAtlasAsLocal(ATLAS_A, 'Trabalho recuperado');
        expect(adocao.ok).toBe(true);
        expect(ns.getActiveScope().kind).toBe(ns.StoreScopeKind.LOCAL);
        expect(ns.getActiveScope().dbSuffix).toBe(`remote-${ATLAS_A}`);
        expect(ns.getStore(ns.StoreName.MAPS).__dbName).toBe(`ebgeo_maps__remote-${ATLAS_A}`);
        expect(aindaComSentinela(bancosRemotos(ATLAS_A))).toEqual(bancosRemotos(ATLAS_A));

        // Como no logout de verdade, a conexão já caiu quando a chave é reanunciada.
        fixture.syncEngine.atlasId = null;
        const chave = abrir.currentAtlasLockKey();

        expect(chave).toEqual({ kind: 'local', atlasId: adocao.atlas.id, adoptedFrom: ATLAS_A });
        // O que isto compra: uma aba que abrir AQUELE atlas de servidor apaga estes bancos na
        // entrada, e é recusada, embora as duas chaves tenham `kind` diferente.
        expect(keysCollide(chave, remoteAtlasKey(ATLAS_A))).toBe(true);
        expect(keysCollide(chave, remoteAtlasKey(ATLAS_B))).toBe(false);
    });

    it('CONTROLE NEGATIVO: um slot local comum não colide com atlas de servidor nenhum', async () => {
        // O mesmo caminho, sobre um slot cujo sufixo não é `remote-...`: sem isto, o caso acima
        // passaria também contra uma derivação que carimbasse `adoptedFrom` em todo slot local.
        const slot = localApi.listLocalAtlases()[0];
        ns.activateScope(localApi.scopeOfLocalAtlas(slot));
        fixture.syncEngine.atlasId = null;

        const chave = abrir.currentAtlasLockKey();

        expect(chave).toEqual({ kind: 'local', atlasId: slot.id });
        expect(keysCollide(chave, remoteAtlasKey(ATLAS_A))).toBe(false);
    });
});

// ============================================================================
// O caminho do LINK PÚBLICO, que mora no boot e não pode ser executado aqui
//
// `index.js` dispara `initApp()` no import: carregá-lo num teste de node é subir o app. O
// que resta é ler a fonte, e este teste sabe o que isso vale: ele prende a ORDEM das duas
// linhas e nada mais. Não prova que a ativação funciona (isso são os testes acima, com a
// fábrica real), prova que ninguém a apagou nem a moveu para depois do wipe.
// ============================================================================

describe('ESTRUTURAL :: o link público ativa o namespace antes de apagar', () => {
    /** @returns {string} Corpo de `openPublicAtlasFromUrl`, de `index.js`. */
    function corpoDoLinkPublico() {
        const aqui = dirname(fileURLToPath(import.meta.url));
        const fonte = readFileSync(resolve(aqui, '../../src/js/index.js'), 'utf8');
        const inicio = fonte.indexOf('async function openPublicAtlasFromUrl');
        expect(inicio).toBeGreaterThan(-1);
        const fim = fonte.indexOf('\n}', inicio);
        expect(fim).toBeGreaterThan(inicio);
        return fonte.slice(inicio, fim);
    }

    it('chama activateRemoteAtlas, e ANTES do clearAllDataStore', () => {
        const corpo = corpoDoLinkPublico();
        const ativa = corpo.indexOf('activateRemoteAtlas(atlas.id)');
        const limpa = corpo.indexOf('clearAllDataStore(');

        expect(ativa).toBeGreaterThan(-1);
        expect(limpa).toBeGreaterThan(-1);
        expect(ativa).toBeLessThan(limpa);
    });

    it('e a ativação vem DEPOIS de resolver o token em UUID, que é o único id honesto', () => {
        // `?atlasPublico=` carrega um token de link; o UUID só existe depois da resposta do
        // servidor, e `remoteScope` recusa qualquer coisa que não seja um id opaco.
        const corpo = corpoDoLinkPublico();
        expect(corpo.indexOf('getPublicAtlas(link)'))
            .toBeLessThan(corpo.indexOf('activateRemoteAtlas(atlas.id)'));
    });
});

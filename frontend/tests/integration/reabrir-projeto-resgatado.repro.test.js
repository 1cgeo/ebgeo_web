// Path: tests/integration/reabrir-projeto-resgatado.repro.test.js

/**
 * @fileoverview REABRIR DO SERVIDOR O PROJETO DE ONDE VEIO UM RESGATE, que era a sequência de
 * gestos comuns que apagava trabalho e quebrava um invariante para sempre.
 *
 * A CAUSA RAIZ, em uma frase: `adoptRemoteAtlasAsLocal` move a REIVINDICAÇÃO e zero bytes, então o
 * slot local resgatado É, literalmente, os dez bancos `remote-<atlasId>` do atlas de servidor. A
 * abertura daquele mesmo atlas ativa esse namespace e o esvazia na entrada, sem perguntar nada.
 *
 * OS DOIS DANOS, e o segundo é o pior porque não se desfaz:
 *
 *   1. o trabalho resgatado some, depois de o app ter dito ao usuário que ele "foi mantido neste
 *      computador";
 *   2. o namespace passa a ser reivindicado pelos DOIS registros (o slot local continua listado,
 *      agora vazio, e a abertura registra a reivindicação remota). Daí em diante toda varredura de
 *      logout relata `adopted: [X]` e POUPA aquele namespace, isto é, dado de servidor continua
 *      legível depois do logout — o invariante que `remote-atlas.api.js` carrega, violado de forma
 *      permanente por um gesto de usuário.
 *
 * O QUE ESTES VERDES PROVARIAM SE O CÓDIGO ESTIVESSE ERRADO. A sentinela é semeada nos DEZ bancos
 * pelo nome ABSOLUTO (não derivado do módulo sob teste); as reivindicações são lidas do disco falso
 * pelo helper compartilhado, não pelos leitores de produção; e o último caso roda a varredura do
 * logout de verdade por cima, que é onde o dano permanente aparece. Cada caso positivo tem controle
 * negativo ao lado: abrir OUTRO atlas de servidor não pergunta nada e não toca no resgate, o que
 * separa "o guarda funciona" de "o guarda pergunta sempre".
 *
 * ESTRUTURA COPIADA DE `namespace-remoto-fiacao.test.js`, e a razão está lá: imports ESTÁTICOS e
 * NENHUM `vi.resetModules()`. Um reset daria ao teste uma segunda instância de
 * `atlas-namespace.js`, e as asserções passariam a ler o escopo/registro de um módulo que a
 * abertura não usa (medido: com `resetModules` o dublê de `@store/store.js` reaproveita a instância
 * antiga e `initServices` estoura). O isolamento é feito à mão no `beforeEach`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { localSlotsOnDisk, remoteAtlasesOnDisk } from '../helpers/atlas-registry-disk.js';

// ============================================================================
// Disco falso, chaveado por (nome do banco, object store): o ponto é EM QUAL banco cada escrita
// caiu, então o dobro precisa distinguir bancos por nome.
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
    syncEngine: { atlasId: null, connect: null, disconnect: null },
    /** A ESCOLHA DO USUÁRIO: é o sujeito da medição, porque o defeito era não haver pergunta. */
    escolha: vi.fn(async () => null)
}));

const { calls, escolha } = fixture;
fixture.syncEngine.connect = vi.fn(async (atlasId) => {
    calls.push('connect');
    fixture.syncEngine.atlasId = atlasId;
});
fixture.syncEngine.disconnect = vi.fn(() => { fixture.syncEngine.atlasId = null; });

vi.mock('@store/sync/sync-engine.js', () => ({ syncEngine: fixture.syncEngine }));
vi.mock('@store/sync/api-client.js', () => ({ apiClient: {} }));
vi.mock('@store', () => ({ getControl: vi.fn(() => null) }));
vi.mock('@store/sync/sync-flush.js', () => ({ startAutoFlush: vi.fn(), stopAutoFlush: vi.fn() }));
vi.mock('@modals/confirm.modal.js', () => ({ showChoice: fixture.escolha }));
vi.mock('@modals/prompt.modal.js', () => ({ showPrompt: vi.fn(async () => 'nome') }));
vi.mock('@js/import_export/save-local-atlas.service.js', () => ({
    saveLocalAtlasToServer: vi.fn(async () => ({ stats: {}, imageStats: {} })),
}));
vi.mock('@utils/toast_service.js', () => ({
    showToast: vi.fn(), showSuccess: vi.fn(), showError: vi.fn(), showWarning: vi.fn(),
    showInChannel: vi.fn(),
}));
// A arbitragem entre abas é medida em `tab-lock-atlas-integration.test.js`; aqui ela é sempre
// concedida, para que o que falhe seja o resgate e nunca o lock.
vi.mock('@utils/tab-lock.js', async (importOriginal) => ({
    ...await importOriginal(),
    acquireTabLock: vi.fn(async () => ({ granted: true })),
    getTabLock: vi.fn(() => null),
    setTabLockKey: vi.fn(),
    releaseTabLock: vi.fn(),
}));

/**
 * O `@store/store.js` REAL, com só o que precisa do app inteiro substituído.
 *
 * `clearAllDataStore` é o dublê que IMPORTA, e ele reproduz a propriedade que decide este arquivo:
 * o wipe de verdade esvazia os dez bancos do ESCOPO ATIVO. `activateAtlasInitialMap` viria depois
 * do `connect` (que aqui não puxa snapshot nenhum) e criaria mapa pela metade da store real.
 * `hasAnyMapFeatures` responde `false` de propósito: é a pergunta GENÉRICA de trabalho local, e
 * mantê-la calada é o que garante que toda pergunta observada abaixo seja a do RESGATE.
 */
vi.mock('@store/store.js', async (importOriginal) => {
    const real = await importOriginal();
    const ns = await import('@store/atlas-namespace.js');
    return {
        ...real,
        clearAllDataStore: vi.fn(async () => {
            calls.push('clearAllDataStore');
            for (const { store } of ns.listAtlasStores()) await store.clear();
        }),
        activateAtlasInitialMap: vi.fn(async () => { calls.push('activateAtlasInitialMap'); }),
        hasAnyMapFeatures: vi.fn(async () => false),
    };
});

import * as ns from '@store/atlas-namespace.js';
import * as remoteApi from '@store/remote-atlas.api.js';
import * as localApi from '@store/local-atlas.api.js';
import * as origem from '@store/store-origin.js';
import * as abrir from '@js/account/open-atlas.service.js';

/** Os dez bancos por atlas, escritos à mão em vez de derivados do módulo sob teste. */
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

const SENTINELA = '__trabalho_resgatado__';
const ATLAS = '11111111-1111-4111-8111-111111111111';
const VIZINHO = '22222222-2222-4222-8222-222222222222';
const NOME_DO_RESGATE = 'Operação Alfa (recuperado)';

beforeEach(async () => {
    resetFake();
    calls.length = 0;
    fixture.syncEngine.atlasId = null;
    vi.clearAllMocks();
    escolha.mockResolvedValue(null);

    // Estado de módulo, devolvido ao zero: o disco falso foi apagado, então as instâncias em
    // cache apontam para tabelas que não existem mais.
    ns.clearStoreCache();
    ns.clearActiveScope();
    await origem.loadStoreOrigin();

    await localApi.initLocalAtlases();
});

/** @returns {string[]} Os dez bancos de um atlas remoto, absolutos. */
function bancosRemotos(atlasId) {
    return PER_ATLAS_BASE_NAMES.map(base => `${base}__remote-${atlasId}`);
}

/** @param {string} atlasId @returns {string[]} Bancos daquele namespace que AINDA têm a sentinela. */
function aindaComTrabalho(atlasId) {
    return bancosRemotos(atlasId)
        .filter(nome => databases.get(`${nome}::keyvaluepairs`)?.has(SENTINELA));
}

/** Semeia a sentinela nos dez bancos de um namespace remoto. */
async function semear(atlasId) {
    for (const { store } of ns.listAtlasStores(ns.remoteScope(atlasId))) {
        await store.setItem(SENTINELA, { atlasId });
    }
}

/** @returns {Map<string, *>|undefined} O banco global do disco falso. */
function globalDisk() {
    return databases.get('ebgeo_global::keyvaluepairs');
}

/** @returns {string[]} Sufixos que o registro LOCAL reivindica, lidos do disco. */
function sufixosLocaisNoDisco() {
    return localSlotsOnDisk(globalDisk()).map(e => e.dbSuffix);
}

/** @returns {string[]} Atlas que o registro REMOTO reivindica, lidos do disco. */
function remotosNoDisco() {
    return remoteAtlasesOnDisk(globalDisk()).map(e => e.atlasId);
}

/**
 * Põe a instalação no estado de DEPOIS do resgate: a sessão caiu com trabalho pendente, o
 * namespace do atlas virou um slot LOCAL (zero cópia) e a origem voltou a ser local.
 * @returns {Promise<void>}
 */
async function comResgateNoDisco() {
    await remoteApi.activateRemoteAtlas(ATLAS);
    await origem.markStoreRemote(ATLAS);
    await semear(ATLAS);

    const adocao = await localApi.adoptRemoteAtlasAsLocal(ATLAS, NOME_DO_RESGATE);
    await origem.markStoreLocal();

    // Premissas positivas: sem elas, "o trabalho sobreviveu" seria indistinguível de "nunca
    // houve resgate nenhum", e todo caso abaixo passaria contra um estado vazio.
    expect(adocao.ok).toBe(true);
    expect(adocao.atlas.dbSuffix).toBe(`remote-${ATLAS}`);
    expect(aindaComTrabalho(ATLAS)).toEqual(bancosRemotos(ATLAS));
    expect(sufixosLocaisNoDisco()).toContain(`remote-${ATLAS}`);
    expect(remotosNoDisco()).toEqual([]);
}

// =================================================================================================
// 1. A pergunta existe, e Cancelar não custa um byte
// =================================================================================================

describe('openRemoteAtlas :: o projeto de onde veio o resgate', () => {
    it('PERGUNTA antes de qualquer coisa, e Cancelar deixa tudo exatamente como estava', async () => {
        await comResgateNoDisco();
        escolha.mockResolvedValue('cancel');

        expect(await abrir.openRemoteAtlas(ATLAS)).toBe(false);

        expect(escolha).toHaveBeenCalledTimes(1);
        // O trabalho inteiro de pé: esta é a linha que ficava vermelha antes do guarda.
        expect(aindaComTrabalho(ATLAS)).toEqual(bancosRemotos(ATLAS));
        expect(sufixosLocaisNoDisco()).toContain(`remote-${ATLAS}`);
        // E nada foi ativado nem registrado: a recusa acontece ANTES da ativação, então o
        // namespace continua com um dono só.
        expect(remotosNoDisco()).toEqual([]);
        expect(calls).toEqual([]);
        expect(origem.isRemoteStoreSync()).toBe(false);
    });

    it('descartar (Esc/backdrop) é tratado como Cancelar, nunca como consentimento', async () => {
        await comResgateNoDisco();
        escolha.mockResolvedValue(null);

        expect(await abrir.openRemoteAtlas(ATLAS)).toBe(false);

        expect(aindaComTrabalho(ATLAS)).toEqual(bancosRemotos(ATLAS));
        expect(calls).toEqual([]);
    });

    // A PERGUNTA SAI DO REGISTRO, NÃO DO ESCOPO MONTADO, e é aqui que se vê a diferença: o
    // usuário resgatou numa aba, seguiu trabalhando noutro atlas local, e reabre o projeto. Um
    // guarda que olhasse o escopo montado (ou `hasAnyMapFeatures`, que responde pelo mapa aberto)
    // não veria resgate nenhum e apagaria o trabalho na entrada.
    it('pergunta mesmo com OUTRO atlas local montado, porque o registro é quem sabe', async () => {
        await comResgateNoDisco();
        const outro = await localApi.createLocalAtlas('Outro trabalho');
        await localApi.mountLocalAtlas(outro.atlas.id);
        expect(ns.getActiveScope().dbSuffix).toBe(outro.atlas.dbSuffix);
        escolha.mockResolvedValue('cancel');

        expect(await abrir.openRemoteAtlas(ATLAS)).toBe(false);

        expect(escolha).toHaveBeenCalledTimes(1);
        expect(aindaComTrabalho(ATLAS)).toEqual(bancosRemotos(ATLAS));
    });

    // CONTROLE NEGATIVO do bloco inteiro, e o que ele impede é um guarda que pergunte sempre (ou
    // que solte a posse local sempre): abrir um atlas de servidor QUALQUER OUTRO é o caminho
    // comum, não pode ganhar diálogo nenhum e não pode encostar no resgate.
    it('CONTROLE: abrir OUTRO atlas de servidor não pergunta nada e não toca no resgate', async () => {
        await comResgateNoDisco();
        // Se perguntasse, esta resposta cancelaria a abertura e o `true` abaixo ficaria vermelho.
        escolha.mockResolvedValue('cancel');

        expect(await abrir.openRemoteAtlas(VIZINHO)).toBe(true);

        expect(escolha).not.toHaveBeenCalled();
        expect(aindaComTrabalho(ATLAS)).toEqual(bancosRemotos(ATLAS));
        expect(sufixosLocaisNoDisco()).toContain(`remote-${ATLAS}`);
        expect(remotosNoDisco()).toEqual([VIZINHO]);
    });
});

// =================================================================================================
// 2. Descartar: o dado morre por decisão do usuário, e o namespace volta a ter UM dono
// =================================================================================================

describe('openRemoteAtlas :: descartar o resgate devolve o namespace ao registro remoto', () => {
    it('a posse local sai, a remota entra, e a abertura segue normal', async () => {
        await comResgateNoDisco();
        escolha.mockResolvedValue('discard');

        expect(await abrir.openRemoteAtlas(ATLAS)).toBe(true);

        // O usuário pediu: o dado do resgate foi embora com o wipe de entrada.
        expect(aindaComTrabalho(ATLAS)).toEqual([]);
        // E o essencial: UM dono só. O slot resgatado saiu do registro local...
        expect(sufixosLocaisNoDisco()).not.toContain(`remote-${ATLAS}`);
        // ...e quem reivindica o namespace agora é o registro remoto, que é quem o destrói no
        // logout. Antes do conserto as duas reivindicações ficavam de pé para sempre.
        expect(remotosNoDisco()).toEqual([ATLAS]);
        expect(calls).toEqual(['clearAllDataStore', 'connect', 'activateAtlasInitialMap']);
        expect(origem.isRemoteStoreSync()).toBe(true);
    });

    // O DANO PERMANENTE, medido onde ele aparece: na varredura do logout. Com as duas
    // reivindicações de pé, o expurgo vê `adopted` e POUPA o namespace, então dado de servidor
    // continua legível depois do logout, em toda sessão futura.
    it('e por isso o LOGOUT volta a destruir o namespace, em vez de poupá-lo como adotado', async () => {
        await comResgateNoDisco();
        escolha.mockResolvedValue('discard');
        await abrir.openRemoteAtlas(ATLAS);
        // Dado de servidor chegando pelo sync depois da abertura: é ele que o logout tem de levar.
        await semear(ATLAS);
        expect(aindaComTrabalho(ATLAS)).toEqual(bancosRemotos(ATLAS));

        const relatorio = await remoteApi.purgeAllRemoteAtlases();

        expect(relatorio.adopted).toEqual([]);
        expect(relatorio.atlases).toEqual([ATLAS]);
        expect(aindaComTrabalho(ATLAS)).toEqual([]);
    });

    // CONTROLE NEGATIVO do caso acima, e sem ele o verde ali seria indistinguível de um expurgo
    // que ignorou a adoção: com o resgate INTACTO (o usuário cancelou), a MESMA varredura tem de
    // respeitar a posse local e não apagar nada.
    it('CONTROLE: com o resgate intacto, a mesma varredura POUPA os dez bancos', async () => {
        await comResgateNoDisco();
        escolha.mockResolvedValue('cancel');
        await abrir.openRemoteAtlas(ATLAS);

        const relatorio = await remoteApi.purgeAllRemoteAtlases();

        expect(relatorio.atlases).toEqual([]);
        expect(aindaComTrabalho(ATLAS)).toEqual(bancosRemotos(ATLAS));
    });

    // A ORDEM DAS DUAS REIVINDICAÇÕES, que é a única coisa que um crash no meio pode ver. O
    // registro REMOTO entra antes de a posse local sair, então a janela de crash é "reivindicado
    // pelos dois" (o estado do resgate, que se cura sozinho na varredura seguinte) e nunca
    // "reivindicado por ninguém", que é dado que nenhum expurgo acha.
    it('ORDEM: a reivindicação remota é gravada ANTES de a local ser removida', async () => {
        await comResgateNoDisco();
        escolha.mockResolvedValue('discard');
        const globalStore = ns.getGlobalStore();
        const eventos = [];
        globalStore.setItem.mockImplementation(async (k, v) => {
            if (k.startsWith('remote_atlas:')) eventos.push(`grava ${k}`);
            return v;
        });
        globalStore.removeItem.mockImplementation(async (k) => {
            if (k.startsWith('local_atlas:')) eventos.push(`remove ${k}`);
        });

        await abrir.openRemoteAtlas(ATLAS);

        // Os dois marcos são asseridos como ENCONTRADOS antes de comparar posições: `-1` compara
        // como "mais cedo", então uma escrita que sumisse passaria a ordem sem existir.
        const iRemota = eventos.findIndex(e => e.startsWith('grava remote_atlas:'));
        const iLocal = eventos.findIndex(e => e.startsWith('remove local_atlas:'));
        expect(iRemota, 'a reivindicação remota não foi gravada').toBeGreaterThan(-1);
        expect(iLocal, 'a posse local não foi removida').toBeGreaterThan(-1);
        expect(iRemota).toBeLessThan(iLocal);
    });
});

// Path: tests/unit/resgate-trabalho-nao-sincronizado.repro.test.js

/**
 * @fileoverview O resgate do trabalho não sincronizado, agora que cada atlas remoto tem os
 * seus próprios bancos.
 *
 * A MINA QUE ESTE ARQUIVO DESARMA. `_handleLogout` preserva o trabalho de uma sessão que
 * morreu sozinha (rede caindo, refresh que falhou) em vez de apagá-lo. Isso funcionava
 * porque local e remoto dividiam os mesmos dez bancos: virar o marcador de origem para
 * LOCAL bastava. Com um namespace por atlas remoto, o trabalho preservado fica em
 * `ebgeo_*__remote-<atlasId>`, que é exatamente o que `purgeAllRemoteAtlases` APAGA sempre
 * que ninguém está autenticado. Marcar LOCAL sozinho passou a ser um aviso mentiroso: o
 * toast promete que o trabalho ficou, e a próxima carga o apaga.
 *
 * O QUE ESTE VERDE PROVARIA SE O CÓDIGO ESTIVESSE ERRADO. Cada teste semeia uma sentinela
 * nos DEZ bancos do namespace remoto (nomes escritos absolutamente, não derivados do módulo
 * sob teste) e roda a varredura do logout por cima. O caso positivo exige a sentinela
 * INTEIRA de pé; o controle negativo faz o que o código fazia antes (só `markStoreLocal`) e
 * exige que ela tenha sumido dos dez. Sem o controle negativo, um verde aqui seria
 * indistinguível de uma varredura que não varre nada.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Disco falso, chaveado por (nome do banco, object store): o ponto é EM QUAL banco cada
// escrita caiu, então o dobro precisa distinguir bancos por nome.
// ============================================================================

const { databases, dropFromFake, makeStore, resetFake } = vi.hoisted(() => {
    const databases = new Map();

    function keyOf(name, storeName) {
        return `${name}::${storeName || 'keyvaluepairs'}`;
    }

    function makeStore({ name, storeName = null }) {
        const key = keyOf(name, storeName);
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

// O toast é DOM puro; o ambiente é node.
vi.mock('@utils/toast_service.js', () => ({
    showToast: vi.fn(), showSuccess: vi.fn(), showError: vi.fn(), showWarning: vi.fn(),
    showInChannel: vi.fn(),
}));

// A sessão e a fila, os dois únicos dados de entrada do logout. A fila responde 3 para que o
// caminho sob teste seja o do trabalho pendente; o resto do `syncEngine` não é exercitado aqui.
const engine = vi.hoisted(() => ({ atlasId: null, logoutAndDisconnect: null }));
engine.logoutAndDisconnect = vi.fn(async () => { engine.atlasId = null; });
vi.mock('@store/sync/sync-engine.js', () => ({ syncEngine: engine }));
vi.mock('@store/sync/sync-flush.js', () => ({ startAutoFlush: vi.fn(), stopAutoFlush: vi.fn() }));
vi.mock('@store/sync/operation-queue.js', () => ({
    operationQueue: {
        count: vi.fn(async () => 3),
        clear: vi.fn(async () => {}),
        startAutoPurge: vi.fn(),
        stopAutoPurge: vi.fn(),
    },
}));

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

const SENTINELA = '__trabalho_nao_sincronizado__';
const ATLAS = '11111111-1111-4111-8111-111111111111';

let ns;
let remoteApi;
let localApi;
let origem;
let conta;

beforeEach(async () => {
    vi.resetModules();
    resetFake();
    const localforage = (await import('localforage')).default;
    localforage.dropInstance.mockReset();
    localforage.dropInstance.mockImplementation(dropFromFake);

    ns = await import('@store/atlas-namespace.js');
    remoteApi = await import('@store/remote-atlas.api.js');
    localApi = await import('@store/local-atlas.api.js');
    origem = await import('@store/store-origin.js');
    conta = await import('@js/account/account.control.js');
});

/** @returns {string[]} Os dez bancos de um atlas remoto, absolutos. */
function bancosRemotos(atlasId) {
    return PER_ATLAS_BASE_NAMES.map(base => `${base}__remote-${atlasId}`);
}

/** Semeia a sentinela nos dez bancos do namespace remoto. */
async function semearTrabalho(atlasId) {
    for (const { store } of ns.listAtlasStores(ns.remoteScope(atlasId))) {
        await store.setItem(SENTINELA, { atlasId });
    }
}

/** @returns {string[]} Bancos que AINDA guardam a sentinela. */
function aindaComTrabalho(atlasId) {
    return bancosRemotos(atlasId)
        .filter(nome => databases.get(`${nome}::keyvaluepairs`)?.has(SENTINELA));
}

/** Põe a instalação no estado exato do logout involuntário: um atlas remoto montado. */
async function sessaoRemotaViva() {
    await localApi.initLocalAtlases();
    await remoteApi.activateRemoteAtlas(ATLAS);
    await origem.markStoreRemote(ATLAS);
    await semearTrabalho(ATLAS);
}

// ============================================================================
// 1. O resgate
// ============================================================================

describe('resgate do trabalho não sincronizado no logout involuntário', () => {
    it('o trabalho SOBREVIVE à varredura que o logout dispara', async () => {
        await sessaoRemotaViva();

        await conta.preserveUnsyncedWorkAsLocal(ATLAS, 'Operação Alfa');
        // O que a próxima carga sem sessão faz (e o que o logout ativo faz na hora).
        const relatorio = await remoteApi.purgeAllRemoteAtlases();

        expect(aindaComTrabalho(ATLAS)).toEqual(bancosRemotos(ATLAS));
        expect(relatorio.atlases).toEqual([]);
        expect(relatorio.adopted).toEqual([]); // a adoção já recolheu a chave remota
    });

    it('CONTROLE NEGATIVO: sem a adoção, o mesmo logout APAGA os dez bancos', async () => {
        await sessaoRemotaViva();

        // Exatamente o que o código fazia antes do namespace: só virar o marcador.
        await origem.markStoreLocal();
        await remoteApi.purgeAllRemoteAtlases();

        expect(aindaComTrabalho(ATLAS)).toEqual([]);
    });

    it('o trabalho vira um atlas LOCAL de verdade: registro, nome e escopo ativo', async () => {
        await sessaoRemotaViva();

        await conta.preserveUnsyncedWorkAsLocal(ATLAS, 'Operação Alfa');

        const resgatado = localApi.listLocalAtlases().find(a => a.name === 'Operação Alfa');
        expect(resgatado).toBeDefined();
        // Zero cópia: o slot local FICA com os bancos do atlas remoto.
        expect(resgatado.dbSuffix).toBe(`remote-${ATLAS}`);
        expect(localApi.getCurrentLocalAtlasId()).toBe(resgatado.id);
        expect(ns.getActiveScope().kind).toBe(ns.StoreScopeKind.LOCAL);
        expect(ns.getStore(ns.StoreName.MAPS).__dbName).toBe(`ebgeo_maps__remote-${ATLAS}`);
    });

    it('a reivindicação REMOTA sai, e a origem termina LOCAL', async () => {
        await sessaoRemotaViva();

        await conta.preserveUnsyncedWorkAsLocal(ATLAS, 'Operação Alfa');

        expect(await ns.getGlobalStore().getItem(`remote_atlas:${ATLAS}`)).toBeNull();
        expect(origem.isRemoteStoreSync()).toBe(false);
    });

    it('ORDEM: a posse local é gravada ANTES de o marcador virar LOCAL', async () => {
        // A janela de crash entre as duas escritas decide quem perde. Com esta ordem, um crash
        // no meio deixa um namespace reivindicado pelo registro local e um marcador ainda
        // REMOTE, e a varredura respeita a posse local. Na ordem inversa o marcador diria LOCAL
        // sobre um namespace que nenhum atlas local reivindica, e a varredura o apagaria.
        await sessaoRemotaViva();
        const globalStore = ns.getGlobalStore();
        globalStore.setItem.mockClear();

        await conta.preserveUnsyncedWorkAsLocal(ATLAS, 'Operação Alfa');

        const chaves = globalStore.setItem.mock.calls.map(([k]) => k);
        // O registro local virou UMA CHAVE POR SLOT em E4 (`local_atlas:<id>`), então a posse
        // é procurada pelo PREFIXO. A chave antiga `local_atlases` era um array reescrito
        // inteiro a cada mudança, e duas abas resgatando ao mesmo tempo perdiam um resgate.
        const iPosse = chaves.findIndex(k => k.startsWith('local_atlas:'));
        const iMarcador = chaves.indexOf('__store_origin__');

        // Os dois marcos são asseridos como ENCONTRADOS antes de comparar posições: `-1`
        // compara como "mais cedo", então uma escrita que sumisse passaria a ordem sem existir.
        expect(iPosse, 'nenhuma chave de posse local foi gravada').toBeGreaterThan(-1);
        expect(iMarcador, 'o marcador de origem não foi gravado').toBeGreaterThan(-1);
        expect(iPosse).toBeLessThan(iMarcador);
    });

    it('crash entre as duas escritas: a varredura respeita a posse local', async () => {
        await sessaoRemotaViva();
        await localApi.adoptRemoteAtlasAsLocal(ATLAS, 'Operação Alfa');
        // O marcador ficou REMOTE (o crash aconteceu antes do markStoreLocal) e a chave remota
        // pode ter ficado de pé: é o pior dos dois mundos, e nenhum byte pode se perder nele.
        await ns.getGlobalStore().setItem(`remote_atlas:${ATLAS}`, {
            atlasId: ATLAS, dbSuffix: `remote-${ATLAS}`, createdAt: 1, updatedAt: 1
        });

        const relatorio = await remoteApi.purgeAllRemoteAtlases();

        expect(relatorio.adopted).toEqual([ATLAS]);
        expect(aindaComTrabalho(ATLAS)).toEqual(bancosRemotos(ATLAS));
    });

    it('sem atlas montado (id nulo) não inventa slot nenhum, só marca LOCAL', async () => {
        await localApi.initLocalAtlases();
        const antes = localApi.listLocalAtlases().length;

        await conta.preserveUnsyncedWorkAsLocal(null, 'Irrelevante');

        expect(localApi.listLocalAtlases()).toHaveLength(antes);
        expect(origem.isRemoteStoreSync()).toBe(false);
    });

    // REESCRITO EM E6 (2026-08-15). A versão anterior exigia `isRemoteStoreSync() === false`
    // depois de uma adoção que FALHOU, isto é, ela cimentava o defeito: o marcador virava
    // LOCAL sobre um namespace que nenhum atlas local reivindicava, e a varredura do próximo
    // boot destruía o trabalho. O usuário, enquanto isso, tinha lido "suas alterações foram
    // mantidas neste computador", porque o toast de sucesso era incondicional.
    //
    // O comportamento correto é o oposto: falhou, então NÃO declare. Deixando o marcador em
    // REMOTE, o namespace continua reivindicado pelo registro remoto e o próximo boot ainda
    // pode tentar. Perder trabalho é irreversível; deixar dado remoto um boot a mais no disco
    // não é, e essa é a troca que a decisão faz explicitamente.
    it('a adoção que falha NÃO marca LOCAL, e diz que falhou', async () => {
        await sessaoRemotaViva();
        // Premissa positiva: antes da falha, o store realmente está marcado REMOTE.
        expect(origem.isRemoteStoreSync()).toBe(true);
        ns.getGlobalStore().setItem.mockRejectedValueOnce(new Error('QuotaExceeded'));

        const resgatado = await conta.preserveUnsyncedWorkAsLocal(ATLAS, 'Operação Alfa');

        expect(resgatado).toBe(false);
        // O marcador NÃO foi mexido: é isto que impede a varredura de tratar o namespace
        // como resíduo órfão no boot seguinte.
        expect(origem.isRemoteStoreSync()).toBe(true);
        // E o trabalho continua no disco, que é a propriedade que importa de verdade.
        expect(aindaComTrabalho(ATLAS)).toEqual(bancosRemotos(ATLAS));
    });

    it('CONTROLE: a adoção que dá certo marca LOCAL e devolve true', async () => {
        await sessaoRemotaViva();
        expect(origem.isRemoteStoreSync()).toBe(true);

        const resgatado = await conta.preserveUnsyncedWorkAsLocal(ATLAS, 'Operação Alfa');

        // Sem este par, "não marcou LOCAL" acima seria satisfeito por uma função que nunca
        // marca nada, e o teste da falha passaria contra código quebrado.
        expect(resgatado).toBe(true);
        expect(origem.isRemoteStoreSync()).toBe(false);
    });

    it('o teto de 10 atlas locais NÃO se aplica ao resgate', async () => {
        // Recusar aqui apagaria trabalho insubstituível para defender um teto de bancos.
        await localApi.initLocalAtlases();
        for (let i = localApi.listLocalAtlases().length; i < localApi.MAX_LOCAL_ATLASES; i++) {
            await localApi.createLocalAtlas(`Atlas ${i}`);
        }
        expect(localApi.listLocalAtlases()).toHaveLength(localApi.MAX_LOCAL_ATLASES);
        await remoteApi.activateRemoteAtlas(ATLAS);
        await semearTrabalho(ATLAS);

        await conta.preserveUnsyncedWorkAsLocal(ATLAS, 'Operação Alfa');
        await remoteApi.purgeAllRemoteAtlases();

        expect(localApi.listLocalAtlases()).toHaveLength(localApi.MAX_LOCAL_ATLASES + 1);
        expect(aindaComTrabalho(ATLAS)).toEqual(bancosRemotos(ATLAS));
    });
});

// ============================================================================
// 2. A fiação: o logout de verdade chamando o resgate
//
// Os testes acima provam que a função salva o trabalho. Este prova que ALGUÉM a chama, que é
// a outra metade e a que costuma faltar: uma função de resgate correta e não ligada tem
// exatamente o mesmo verde.
// ============================================================================

describe('_handleLogout :: o resgate está ligado', () => {
    /**
     * Um AccountControl sem DOM. `onAdd` nunca roda, então `_render`/`_closeMenu` saem cedo por
     * conta própria, e o que resta do método é exatamente o caminho de dados sob teste.
     * @returns {Object}
     */
    async function controleSemDOM() {
        const { initServices } = await import('@store/services.js');
        initServices();
        const control = new conta.AccountControl();
        control._atlasCache = { id: ATLAS, name: 'Operação Alfa' };
        engine.atlasId = ATLAS;
        return control;
    }

    it('sessão perdida COM fila pendente: o trabalho vira atlas local e sobrevive à varredura', async () => {
        await sessaoRemotaViva();
        const { showError } = await import('@utils/toast_service.js');
        const control = await controleSemDOM();

        await control._handleLogout({ involuntary: true });
        await remoteApi.purgeAllRemoteAtlases();

        // Um throw engolido pelo try/catch do logout não pode passar por verde.
        expect(showError).not.toHaveBeenCalled();
        expect(aindaComTrabalho(ATLAS)).toEqual(bancosRemotos(ATLAS));
        expect(localApi.listLocalAtlases().map(a => a.name)).toContain('Operação Alfa');
    });

    it('CONTROLE NEGATIVO: logout CLICADO apaga tudo, porque a decisão foi do usuário', async () => {
        await sessaoRemotaViva();
        const control = await controleSemDOM();

        await control._handleLogout({ involuntary: false });

        expect(aindaComTrabalho(ATLAS)).toEqual([]);
        expect(localApi.listLocalAtlases().map(a => a.name)).not.toContain('Operação Alfa');
    });

    // AINDA ABERTO, E O CONSERTO FOI TENTADO E REVERTIDO em 2026-08-16.
    //
    // O PROBLEMA É REAL: `clearAllDataStore` esvazia o atlas que ESTA aba montou, e depois do
    // namespace por atlas esse atlas pode ser LOCAL (um `.ebgeo` importado nasce num slot
    // próprio, e "Mapa local" é um slot). Nesse estado, sair da conta apaga um projeto que
    // nunca teve relação com a sessão que terminou.
    //
    // POR QUE A CORREÇÃO ÓBVIA NÃO SERVE: condicionar o wipe a `isRemoteStoreSync()` faz este
    // caso passar e quebra `tests/e2e-ui/browser-logout-clears-map.repro.spec.js`, que é um
    // repro de bug relatado por USUÁRIO ("após Sair, as feições do mapa antigo continuam
    // desenhadas no canvas") e que exige o workspace limpo depois do logout. Medido: com a
    // guarda, aquele spec reprova com `storeFeatures` 1 onde espera 0.
    //
    // As duas expectativas são legítimas e se contradizem no mesmo gesto, então a saída é de
    // PRODUTO e tem dono: provavelmente fazer o projeto importado viver num slot que o logout
    // não tem por que tocar, em vez de desligar o wipe. Enquanto isso este caso fica `it.fails`
    // para não sumir, e o spec de navegador segue verde.
    it.fails('logout com um atlas LOCAL montado NÃO apaga o projeto local', async () => {
        await localApi.initLocalAtlases();
        const { atlas } = await localApi.createLocalAtlas('Projeto Importado');
        await localApi.setCurrentLocalAtlas(atlas.id);
        ns.activateScope(localApi.scopeOfLocalAtlas(atlas));
        await origem.markStoreLocal();

        const bancoLocal = ns.resolveDbName(ns.StoreName.MAPS);
        await ns.getStore(ns.StoreName.MAPS).setItem('__trabalho_local__', { do: 'usuário' });
        // ANTES (positivo): sem isto, "o trabalho sobreviveu" não se distingue de "nunca existiu".
        expect(await ns.getStore(ns.StoreName.MAPS).getItem('__trabalho_local__')).toBeTruthy();

        const control = await controleSemDOM();
        engine.atlasId = null;   // a aba não tem atlas de servidor montado
        await control._handleLogout({ involuntary: false });

        expect(
            await ns.getStoreFor(ns.StoreName.MAPS, localApi.scopeOfLocalAtlas(atlas))
                .getItem('__trabalho_local__'),
            `sair da conta esvaziou o projeto LOCAL do usuário (${bancoLocal})`,
        ).toEqual({ do: 'usuário' });
        expect(localApi.listLocalAtlases().map(a => a.name)).toContain('Projeto Importado');
    });
});

// ============================================================================
// 3. O nome do resgate
// ============================================================================

describe('rescuedAtlasName', () => {
    it('prefere o nome do projeto, aparado', async () => {
        expect(conta.rescuedAtlasName('  Operação Alfa  ')).toBe('Operação Alfa');
    });

    it('borda: nome ausente/vazio/não-string cai num rótulo datado, nunca vazio', async () => {
        for (const ruim of [null, undefined, '', '   ', 42, {}]) {
            const nome = conta.rescuedAtlasName(ruim);
            expect(nome.startsWith('Trabalho recuperado')).toBe(true);
            expect(nome.trim().length).toBeGreaterThan(0);
        }
    });
});

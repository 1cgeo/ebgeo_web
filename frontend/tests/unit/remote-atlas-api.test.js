// Path: tests/unit/remote-atlas-api.test.js

/**
 * @fileoverview O registro dos atlas REMOTOS e o wipe derivado dele.
 *
 * O QUE ESTE VERDE PROVARIA SE O CÓDIGO ESTIVESSE ERRADO. Cada teste de wipe semeia uma
 * sentinela em TODOS os dez bancos de cada namespace remoto registrado e exige que ela
 * tenha sumido; um banco de fora da derivação guarda a sentinela e falha pelo nome. A lista
 * dos dez nomes está escrita ABSOLUTAMENTE aqui (derivar a expectativa da mesma lista de
 * onde o código deriva passaria verde com lista vazia), e é conferida contra os descritores.
 *
 * O invariante sob teste é um só: NENHUM dado de atlas remoto sobrevive ao logout. Antes ele
 * era garantido por um alvo fixo e nomeável (um rascunho `__remote` único); agora, com um
 * namespace por atlas remoto, é garantido por um registro, e é o registro que estes testes
 * cercam: registrar antes de escrever, uma chave por atlas, e a varredura lendo do disco.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Disco falso, chaveado por (nome do banco, object store): o ponto dos testes é EM QUAL
// banco cada escrita caiu, então o dobro precisa distinguir bancos por nome.
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
            clear: vi.fn(async () => { backing.clear(); })
        };
    }

    /** Delete que COMPLETA. O caso interessante (delete pendente) sobrescreve isto. */
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

const SENTINELA = '__sentinela_do_teste__';

const ATLAS_A = '11111111-1111-4111-8111-111111111111';
const ATLAS_B = '22222222-2222-4222-8222-222222222222';

let ns;
let api;
let local;
let localforage;

beforeEach(async () => {
    vi.resetModules();
    resetFake();
    localforage = (await import('localforage')).default;
    // O dobro sobrevive ao resetModules, então a implementação volta explicitamente: sem
    // isto, um teste que faz o delete travar deixa todos os seguintes rodando contra um
    // disco que nunca apaga.
    localforage.dropInstance.mockReset();
    localforage.dropInstance.mockImplementation(dropFromFake);

    ns = await import('@store/atlas-namespace.js');
    api = await import('@store/remote-atlas.api.js');
    local = await import('@store/local-atlas.api.js');
});

/** Nomes de banco de um atlas remoto, derivados do sufixo mas com os dez nomes absolutos. */
function dbNamesOfRemote(atlasId) {
    return PER_ATLAS_BASE_NAMES.map(base => `${base}__remote-${atlasId}`);
}

/** Semeia a sentinela nos dez bancos de um namespace remoto. */
async function seedRemote(atlasId) {
    for (const { store } of ns.listAtlasStores(ns.remoteScope(atlasId))) {
        await store.setItem(SENTINELA, { atlasId });
    }
}

/** @returns {string[]} Bancos que AINDA guardam a sentinela. */
function stillHoldingSentinel(names) {
    return names.filter(name => databases.get(`${name}::keyvaluepairs`)?.has(SENTINELA));
}

// ============================================================================
// 1. Dois atlas remotos, dois endereços
// ============================================================================

describe('remote-atlas.api :: um namespace por atlas remoto', () => {
    it('dois atlas remotos distintos escrevem em bancos distintos', async () => {
        await api.activateRemoteAtlas(ATLAS_A);
        await ns.getStore(ns.StoreName.MAPS).setItem('Principal', { dono: 'A' });

        await api.activateRemoteAtlas(ATLAS_B);
        await ns.getStore(ns.StoreName.MAPS).setItem('Principal', { dono: 'B' });

        expect(await ns.getStoreFor(ns.StoreName.MAPS, ns.remoteScope(ATLAS_A)).getItem('Principal'))
            .toEqual({ dono: 'A' });
        expect(await ns.getStoreFor(ns.StoreName.MAPS, ns.remoteScope(ATLAS_B)).getItem('Principal'))
            .toEqual({ dono: 'B' });
        // controle negativo: se compartilhassem o rascunho, o segundo teria sobrescrito o
        // primeiro e os dois nomes de banco seriam o mesmo.
        expect(ns.resolveDbName(ns.StoreName.MAPS, ns.remoteScope(ATLAS_A)))
            .not.toBe(ns.resolveDbName(ns.StoreName.MAPS, ns.remoteScope(ATLAS_B)));
    });

    it('o registro e UMA CHAVE POR ATLAS, nao um array sob uma chave', async () => {
        await api.registerRemoteAtlas(ATLAS_A);
        await api.registerRemoteAtlas(ATLAS_B);

        const chaves = await ns.getGlobalStore().keys();
        expect(chaves.filter(k => ns.isRemoteAtlasKey(k)).sort())
            .toEqual([`remote_atlas:${ATLAS_A}`, `remote_atlas:${ATLAS_B}`].sort());
        expect((await api.listRemoteAtlases()).map(e => e.atlasId).sort())
            .toEqual([ATLAS_A, ATLAS_B].sort());
    });

    it('registrar duas vezes e idempotente: preserva createdAt e nao duplica entrada', async () => {
        const primeiro = await api.registerRemoteAtlas(ATLAS_A);
        const segundo = await api.registerRemoteAtlas(ATLAS_A);

        expect(segundo.entry.createdAt).toBe(primeiro.entry.createdAt);
        expect(await api.listRemoteAtlases()).toHaveLength(1);
    });

    it('ORDEM: registra ANTES de ativar, entao um registro que falha nao deixa escrever', async () => {
        const globalStore = ns.getGlobalStore();
        globalStore.setItem.mockRejectedValueOnce(new Error('QuotaExceeded'));

        await expect(api.activateRemoteAtlas(ATLAS_A)).rejects.toThrow(/QuotaExceeded/);

        // nada ativado: o próximo acesso não tem para onde escrever, em vez de escrever num
        // namespace que nenhum wipe encontraria.
        expect(ns.getActiveScope()).toBeNull();
        expect(await api.listRemoteAtlases()).toEqual([]);
    });

    it('CONTROLE NEGATIVO da ordem: com o registro OK, o escopo fica ativo e registrado', async () => {
        await api.activateRemoteAtlas(ATLAS_A);

        expect(ns.getActiveScope()).toEqual(ns.remoteScope(ATLAS_A));
        expect((await api.listRemoteAtlases()).map(e => e.atlasId)).toEqual([ATLAS_A]);
    });
});

// ============================================================================
// 2. O wipe do logout, derivado do registro
// ============================================================================

describe('remote-atlas.api :: purgeAllRemoteAtlases', () => {
    it('esvazia e apaga os dez bancos de TODOS os atlas registrados', async () => {
        await api.activateRemoteAtlas(ATLAS_A);
        await seedRemote(ATLAS_A);
        await api.activateRemoteAtlas(ATLAS_B);
        await seedRemote(ATLAS_B);

        const relatorio = await api.purgeAllRemoteAtlases();

        expect(relatorio.atlases.sort()).toEqual([ATLAS_A, ATLAS_B].sort());
        expect(stillHoldingSentinel([...dbNamesOfRemote(ATLAS_A), ...dbNamesOfRemote(ATLAS_B)]))
            .toEqual([]);
        expect(relatorio.dropped.sort())
            .toEqual([...dbNamesOfRemote(ATLAS_A), ...dbNamesOfRemote(ATLAS_B)].sort());
        expect(relatorio.blocked).toEqual([]);
        expect(await api.listRemoteAtlases()).toEqual([]);
    });

    it('ESTRUTURAL: a varredura cobre todo store marcado por atlas, e sao exatamente dez', async () => {
        // Metade absoluta: se um descritor sumir da lista, isto falha.
        const perAtlas = ns.STORE_DESCRIPTORS.filter(d => d.perAtlas).map(d => d.dbName);
        expect(perAtlas).toEqual(PER_ATLAS_BASE_NAMES);

        // Metade derivada: a sentinela vai para todo banco que a FÁBRICA considera por
        // atlas, então um store novo que a varredura deixasse de fora reprovaria aqui pelo
        // nome, sem ninguém lembrar de atualizar este teste.
        await api.activateRemoteAtlas(ATLAS_A);
        const derivados = ns.listAtlasStores(ns.remoteScope(ATLAS_A));
        expect(derivados).toHaveLength(10);
        for (const { store } of derivados) await store.setItem(SENTINELA, 1);

        const relatorio = await api.purgeAllRemoteAtlases();

        expect(relatorio.cleared.sort()).toEqual(dbNamesOfRemote(ATLAS_A).sort());
        expect(stillHoldingSentinel(dbNamesOfRemote(ATLAS_A))).toEqual([]);
    });

    it('NAO toca em atlas LOCAL nem nos dois bancos globais', async () => {
        await local.initLocalAtlases();
        const localAtlas = (await local.createLocalAtlas('Operação Alfa')).atlas;
        await ns.getStoreFor(ns.StoreName.MAPS, local.scopeOfLocalAtlas(localAtlas))
            .setItem('Principal', { dono: 'local' });
        await ns.getStoreFor(ns.StoreName.OPERATION_QUEUE).setItem('op_1', { id: 'op_1' });

        await api.activateRemoteAtlas(ATLAS_A);
        await seedRemote(ATLAS_A);
        await api.purgeAllRemoteAtlases();

        expect(await ns.getStoreFor(ns.StoreName.MAPS, local.scopeOfLocalAtlas(localAtlas))
            .getItem('Principal')).toEqual({ dono: 'local' });
        expect(await ns.getStoreFor(ns.StoreName.OPERATION_QUEUE).getItem('op_1'))
            .toEqual({ id: 'op_1' });
        expect(databases.has('ebgeo_global::keyvaluepairs')).toBe(true);
        expect(local.listLocalAtlases()).toHaveLength(2);
    });

    it('registro vazio: varre nada e nao mexe no escopo ativo', async () => {
        await local.initLocalAtlases();
        const antes = ns.getActiveScope();

        const relatorio = await api.purgeAllRemoteAtlases();

        expect(relatorio.atlases).toEqual([]);
        expect(relatorio.deactivated).toBe(false);
        expect(ns.getActiveScope()).toBe(antes);
    });

    it('o escopo remoto ATIVO e desativado, para nao renascer na proxima escrita', async () => {
        await api.activateRemoteAtlas(ATLAS_A);
        await seedRemote(ATLAS_A);

        const relatorio = await api.purgeAllRemoteAtlases();

        expect(relatorio.deactivated).toBe(true);
        expect(ns.getActiveScope()).toBeNull();
        expect(() => ns.getStore(ns.StoreName.MAPS)).toThrow(/no active atlas scope/);
    });
});

// ============================================================================
// 3. Órfão: a entrada que sobrou de uma aba que morreu
// ============================================================================

describe('remote-atlas.api :: orfaos', () => {
    it('entrada orfa de outra aba (ou de um crash) e varrida sem sessao nenhuma', async () => {
        // Simula o que a OUTRA aba deixou: registro no banco global e dados no namespace,
        // sem que ESTA execução tenha aberto nada.
        await ns.getGlobalStore().setItem(`remote_atlas:${ATLAS_A}`, {
            atlasId: ATLAS_A,
            dbSuffix: `remote-${ATLAS_A}`,
            createdAt: 1,
            updatedAt: 1
        });
        await seedRemote(ATLAS_A);

        const relatorio = await api.purgeAllRemoteAtlases();

        expect(relatorio.atlases).toEqual([ATLAS_A]);
        expect(stillHoldingSentinel(dbNamesOfRemote(ATLAS_A))).toEqual([]);
        expect(await ns.getGlobalStore().getItem(`remote_atlas:${ATLAS_A}`)).toBeNull();
    });

    it('valor corrompido nao esconde o namespace: a identidade esta na CHAVE', async () => {
        await ns.getGlobalStore().setItem(`remote_atlas:${ATLAS_A}`, 'lixo');
        await seedRemote(ATLAS_A);

        const relatorio = await api.purgeAllRemoteAtlases();

        expect(relatorio.atlases).toEqual([ATLAS_A]);
        expect(stillHoldingSentinel(dbNamesOfRemote(ATLAS_A))).toEqual([]);
    });

    it('CONTROLE NEGATIVO: dado remoto SEM entrada no registro nao e alcancado', async () => {
        // É a razão de `activateRemoteAtlas` registrar ANTES de ativar: um namespace escrito
        // sem registro é dado que nenhum wipe encontra. O teste fixa a consequência para que
        // ninguém "simplifique" a ordem.
        await seedRemote(ATLAS_A);

        const relatorio = await api.purgeAllRemoteAtlases();

        expect(relatorio.atlases).toEqual([]);
        expect(stillHoldingSentinel(dbNamesOfRemote(ATLAS_A))).toEqual(dbNamesOfRemote(ATLAS_A));
    });
});

// ============================================================================
// 4. Decisão 4: delete bloqueado por outra aba
// ============================================================================

describe('remote-atlas.api :: delete bloqueado', () => {
    it('bloqueado: o DADO some mesmo assim, e a entrada fica para a proxima tentativa', async () => {
        await api.activateRemoteAtlas(ATLAS_A);
        await seedRemote(ATLAS_A);
        // Outra aba segura a conexão: o deleteDatabase fica pendente para sempre.
        localforage.dropInstance.mockImplementation(() => new Promise(() => {}));

        const relatorio = await api.purgeAllRemoteAtlases({ dropTimeoutMs: 5 });

        // o invariante (nenhum byte legível) foi cumprido pelo clear, que não depende de ninguém
        expect(stillHoldingSentinel(dbNamesOfRemote(ATLAS_A))).toEqual([]);
        expect(relatorio.blocked.sort()).toEqual(dbNamesOfRemote(ATLAS_A).sort());
        expect(relatorio.dropped).toEqual([]);
        // e a entrada SOBREVIVE: é ela que faz a próxima carga sem sessão tentar de novo
        expect((await api.listRemoteAtlases()).map(e => e.atlasId)).toEqual([ATLAS_A]);
    });

    it('a tentativa seguinte, com a aba vizinha fechada, termina o serviço', async () => {
        await api.activateRemoteAtlas(ATLAS_A);
        await seedRemote(ATLAS_A);
        localforage.dropInstance.mockImplementation(() => new Promise(() => {}));
        await api.purgeAllRemoteAtlases({ dropTimeoutMs: 5 });

        localforage.dropInstance.mockImplementation(dropFromFake);
        const relatorio = await api.purgeAllRemoteAtlases({ dropTimeoutMs: 5 });

        expect(relatorio.dropped.sort()).toEqual(dbNamesOfRemote(ATLAS_A).sort());
        expect(relatorio.blocked).toEqual([]);
        expect(await api.listRemoteAtlases()).toEqual([]);
    });
});

// ============================================================================
// 5. Adoção: o único caminho em que o dado remoto FICA
// ============================================================================

describe('remote-atlas.api :: namespace adotado pelo registro local', () => {
    it('adotado NAO e varrido, e a chave remota obsoleta e recolhida', async () => {
        await local.initLocalAtlases();
        await api.activateRemoteAtlas(ATLAS_A);
        await seedRemote(ATLAS_A);

        const resultado = await local.adoptRemoteAtlasAsLocal(ATLAS_A, 'Trabalho resgatado');
        const relatorio = await api.purgeAllRemoteAtlases();

        expect(resultado.ok).toBe(true);
        expect(resultado.atlas.dbSuffix).toBe(`remote-${ATLAS_A}`);
        // a adoção já tira a chave remota; a varredura confirma que nada foi apagado
        expect(relatorio.atlases).toEqual([]);
        expect(stillHoldingSentinel(dbNamesOfRemote(ATLAS_A))).toEqual(dbNamesOfRemote(ATLAS_A));
        expect(local.listLocalAtlases().map(a => a.name)).toContain('Trabalho resgatado');
    });

    it('adocao interrompida (as duas chaves de pe): a varredura respeita a posse local', async () => {
        await local.initLocalAtlases();
        await api.activateRemoteAtlas(ATLAS_A);
        await seedRemote(ATLAS_A);
        await local.adoptRemoteAtlasAsLocal(ATLAS_A, 'Trabalho resgatado');
        // Simula o crash entre escrever o registro local e remover a chave remota.
        await ns.getGlobalStore().setItem(`remote_atlas:${ATLAS_A}`, {
            atlasId: ATLAS_A,
            dbSuffix: `remote-${ATLAS_A}`,
            createdAt: 1,
            updatedAt: 1
        });

        const relatorio = await api.purgeAllRemoteAtlases();

        expect(relatorio.adopted).toEqual([ATLAS_A]);
        expect(relatorio.atlases).toEqual([]);
        expect(stillHoldingSentinel(dbNamesOfRemote(ATLAS_A))).toEqual(dbNamesOfRemote(ATLAS_A));
        expect(await ns.getGlobalStore().getItem(`remote_atlas:${ATLAS_A}`)).toBeNull();
    });

    it('adotar duas vezes nao gasta um segundo slot nos mesmos bancos', async () => {
        await local.initLocalAtlases();
        await api.activateRemoteAtlas(ATLAS_A);

        const primeiro = await local.adoptRemoteAtlasAsLocal(ATLAS_A, 'Resgate');
        const segundo = await local.adoptRemoteAtlasAsLocal(ATLAS_A, 'Resgate');

        expect(segundo.atlas.id).toBe(primeiro.atlas.id);
        expect(local.listLocalAtlases()).toHaveLength(2);
    });

    it('a adocao vira o escopo ativo de REMOTE para LOCAL, sem trocar de banco', async () => {
        await local.initLocalAtlases();
        await api.activateRemoteAtlas(ATLAS_A);
        const bancoAntes = ns.getStore(ns.StoreName.MAPS).__dbName;

        await local.adoptRemoteAtlasAsLocal(ATLAS_A, 'Resgate');

        expect(ns.getActiveScope().kind).toBe(ns.StoreScopeKind.LOCAL);
        expect(ns.getStore(ns.StoreName.MAPS).__dbName).toBe(bancoAntes);
    });
});

// ============================================================================
// 6. Sair de UM atlas remoto
// ============================================================================

describe('remote-atlas.api :: forgetRemoteAtlas', () => {
    it('destroi so o atlas pedido e deixa o outro intacto', async () => {
        await api.activateRemoteAtlas(ATLAS_A);
        await seedRemote(ATLAS_A);
        await api.activateRemoteAtlas(ATLAS_B);
        await seedRemote(ATLAS_B);

        await api.forgetRemoteAtlas(ATLAS_A);

        expect(stillHoldingSentinel(dbNamesOfRemote(ATLAS_A))).toEqual([]);
        expect(stillHoldingSentinel(dbNamesOfRemote(ATLAS_B))).toEqual(dbNamesOfRemote(ATLAS_B));
        expect((await api.listRemoteAtlases()).map(e => e.atlasId)).toEqual([ATLAS_B]);
    });
});

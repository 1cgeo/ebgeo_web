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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    remoteAtlasDiskKey,
    remoteAtlasesOnDisk,
    localSlotsOnDisk
} from '../helpers/atlas-registry-disk.js';

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

/** Os dez bancos de DADO do atlas, escritos à mão em vez de derivados do módulo sob teste. */
const ATLAS_DATA_BASE_NAMES = [
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

/**
 * Os ONZE bancos que MORREM com o atlas. A fila de saída é o décimo primeiro e é a única
 * linha em que os dois eixos divergem: ela é `perAtlas` (morre na destruição) sem ser
 * `atlasData` (o wipe de ENTRADA não a leva junto). Escrever só uma das listas faria
 * "destruído" e "esvaziado" parecerem sinônimos, que é justamente o que eles não são.
 */
const PER_ATLAS_BASE_NAMES = [...ATLAS_DATA_BASE_NAMES, 'ebgeo'];

/**
 * `localStorage`, que o node não tem.
 *
 * O veto do resgate mora FORA do IndexedDB DE PROPÓSITO (o que falha no resgate é uma escrita
 * no `ebgeo_global`, e um veto guardado ali teria o modo de falha que ele existe para cobrir).
 * Sem este dobro, `retainRemoteAtlasForRescue` devolve false e vira no-op: todo caso de veto
 * abaixo ficaria verde por AUSÊNCIA de veto, que é o mesmo verde de um expurgo quebrado.
 * `naoRetemSemArmazenamento` é o caso que prova que este dobro está sendo usado.
 */
const memoriaLocal = (() => {
    let dados = new Map();
    return {
        getItem: k => (dados.has(k) ? dados.get(k) : null),
        setItem: (k, v) => { dados.set(k, String(v)); },
        removeItem: k => { dados.delete(k); },
        clear: () => { dados = new Map(); }
    };
})();
if (typeof globalThis.localStorage === 'undefined') {
    Object.defineProperty(globalThis, 'localStorage', { value: memoriaLocal, writable: true });
}

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
    // O veto sobrevive ao `resetModules` porque não mora em módulo nenhum: sem esta linha um
    // veto de ATLAS_A vazaria para todo caso seguinte, e os dois ids são os mesmos em todos.
    globalThis.localStorage.clear();
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

afterEach(() => {
    // Os casos de prazo espionam `Date.now`, que é um global de verdade e não volta com o
    // `resetModules`: sem isto, um relógio adiantado um dia vazaria para o resto do arquivo.
    vi.restoreAllMocks();
});

/**
 * Bancos de DADO de um atlas remoto (os dez), derivados do sufixo mas com nomes absolutos.
 * É a lista que casa com `seedRemote`, então serve às conferências de sentinela.
 */
function dbNamesOfRemote(atlasId) {
    return ATLAS_DATA_BASE_NAMES.map(base => `${base}__remote-${atlasId}`);
}

/**
 * TODOS os bancos que a destruição alcança (os onze, fila de saída incluída). É a lista que
 * casa com `cleared`/`dropped`/`blocked` do relatório, que derivam de `perAtlas`, não de
 * `atlasData`.
 */
function allDbNamesOfRemote(atlasId) {
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

/** @returns {Map<string, *>|undefined} O banco global do disco falso. */
function globalDisk() {
    return databases.get('ebgeo_global::keyvaluepairs');
}

/**
 * Segura a montagem de um namespace como faria OUTRA ABA, com o `navigator.locks` de verdade
 * (existe no node que roda a suíte, medido em `atlas-namespace.test.js`). O lock desta função
 * NÃO passa pelo módulo sob teste, então é indistinguível, para ele, de um lock de outro
 * cliente: é o mais perto de "duas abas" que um processo alcança.
 *
 * O nome é montado com o sufixo ESCRITO À MÃO, não derivado do escopo, pela mesma razão de os
 * dez bancos estarem escritos aqui: derivar da mesma fonte que o código passaria verde com a
 * derivação errada.
 *
 * @param {string} atlasId - Atlas de servidor cujo namespace fica montado.
 * @returns {Promise<() => Promise<void>>} Função que solta o lock (e espera a soltura).
 */
async function outraAbaMonta(atlasId) {
    const nome = ns.atlasMountLockName(`remote-${atlasId}`);
    let release;
    let granted;
    const ateSoltar = new Promise(resolve => { release = resolve; });
    const concedido = new Promise(resolve => { granted = resolve; });

    const settled = navigator.locks.request(nome, { mode: 'shared' }, () => {
        granted();
        return ateSoltar;
    });
    settled.catch(() => undefined);
    await concedido;

    return async () => {
        release();
        await settled;
    };
}

/** Escreve `sparedAt` na entrada do registro, como um expurgo anterior teria feito. */
async function carimbarPoupadoEm(atlasId, sparedAt) {
    const globalStore = ns.getGlobalStore();
    const key = remoteAtlasDiskKey(atlasId);
    const atual = await globalStore.getItem(key);
    await globalStore.setItem(key, { ...atual, sparedAt });
}

/**
 * Os atlas remotos registrados NO DISCO, pela leitura compartilhada
 * (`tests/helpers/atlas-registry-disk.js`), não pela `listRemoteAtlases` sob teste.
 * @returns {string[]} Ids, ordenados.
 */
function remotosNoDisco() {
    return remoteAtlasesOnDisk(globalDisk()).map(e => e.atlasId);
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

    // LAYOUT DE DISCO, DE PROPÓSITO: os nomes de chave estão escritos LITERALMENTE aqui, e
    // este é o único teste do arquivo que os conhece. É contrato de disco, então algum dia
    // alguém vai precisar migrá-lo de novo, e nesse dia a mudança tem que aparecer em UM
    // vermelho nomeado em vez de espalhada por vinte casos. O par local está em
    // `tests/unit/atlas-namespace.test.js`.
    it('o registro e UMA CHAVE POR ATLAS, nao um array sob uma chave', async () => {
        await api.registerRemoteAtlas(ATLAS_A);
        await api.registerRemoteAtlas(ATLAS_B);

        const chaves = await ns.getGlobalStore().keys();
        expect(chaves.filter(k => ns.isRemoteAtlasRegistryKey(k)).sort())
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
    // TROCADO EM E2 (2026-08-15), nunca somado. A versão anterior se chamava "esvazia e apaga
    // os dez bancos de TODOS os atlas registrados" e não mencionava montagem nenhuma: era a
    // descrição fiel de um expurgo CEGO, que apagava o namespace vivo da aba vizinha e a
    // deixava escrevendo em bancos que nenhum registro nomeava. Um caso que continuasse
    // exigindo aquilo faria a correção parecer regressão.
    //
    // O que ficou é a mesma afirmação com a CONDIÇÃO escrita: sem ninguém montado, destrói
    // tudo. É o controle positivo dos casos de "poupa" logo abaixo.
    it('SEM NINGUÉM MONTADO: esvazia e apaga os dez bancos de todos os registrados', async () => {
        await api.activateRemoteAtlas(ATLAS_A);
        await seedRemote(ATLAS_A);
        await api.activateRemoteAtlas(ATLAS_B);
        await seedRemote(ATLAS_B);
        // ANTES (positivo): sem isto, "foi destruído" e "nunca existiu" são o mesmo verde.
        expect(stillHoldingSentinel(dbNamesOfRemote(ATLAS_A))).toEqual(dbNamesOfRemote(ATLAS_A));
        expect(stillHoldingSentinel(dbNamesOfRemote(ATLAS_B))).toEqual(dbNamesOfRemote(ATLAS_B));

        const relatorio = await api.purgeAllRemoteAtlases();

        expect(relatorio.atlases.sort()).toEqual([ATLAS_A, ATLAS_B].sort());
        expect(relatorio.spared).toEqual([]);
        expect(stillHoldingSentinel([...dbNamesOfRemote(ATLAS_A), ...dbNamesOfRemote(ATLAS_B)]))
            .toEqual([]);
        // A destruição alcança os ONZE, não os dez: a fila de saída daquele atlas morre com
        // ele. Antes de E2B ela era um banco global e o payload das entidades do atlas
        // remoto sobrevivia ao logout.
        expect(relatorio.dropped.sort())
            .toEqual([...allDbNamesOfRemote(ATLAS_A), ...allDbNamesOfRemote(ATLAS_B)].sort());
        expect(relatorio.blocked).toEqual([]);
        expect(await api.listRemoteAtlases()).toEqual([]);
    });

    // O atlas que a PRÓPRIA aba tem montado é o que ela acabou de estar olhando, e é o
    // primeiro que o logout precisa destruir. Sem soltar o lock antes de varrer, o cliente
    // pouparia a si mesmo e o único namespace a sobreviver ao logout seria justamente esse.
    it('o namespace que ESTA aba tem montado é destruído: ela solta o próprio lock', async () => {
        await api.activateRemoteAtlas(ATLAS_A);
        await seedRemote(ATLAS_A);
        expect(stillHoldingSentinel(dbNamesOfRemote(ATLAS_A))).toEqual(dbNamesOfRemote(ATLAS_A));

        const relatorio = await api.purgeAllRemoteAtlases();

        expect(relatorio.atlases).toEqual([ATLAS_A]);
        expect(relatorio.spared).toEqual([]);
        expect(stillHoldingSentinel(dbNamesOfRemote(ATLAS_A))).toEqual([]);
    });

    it('ESTRUTURAL: a varredura cobre todo store marcado por atlas, e os dois eixos divergem numa linha só', async () => {
        // Metade absoluta: se um descritor sumir de qualquer um dos dois eixos, isto falha.
        const perAtlas = ns.STORE_DESCRIPTORS.filter(d => d.perAtlas).map(d => d.dbName);
        const atlasData = ns.STORE_DESCRIPTORS.filter(d => d.perAtlas && d.atlasData).map(d => d.dbName);
        expect(perAtlas).toEqual(PER_ATLAS_BASE_NAMES);
        expect(atlasData).toEqual(ATLAS_DATA_BASE_NAMES);
        // E a divergência é EXATAMENTE a fila de saída. Sem esta linha, um descritor novo que
        // errasse o eixo passaria despercebido enquanto as duas listas acima crescessem juntas.
        expect(ns.STORE_DESCRIPTORS.filter(d => d.perAtlas !== d.atlasData).map(d => d.dbName))
            .toEqual(['ebgeo']);

        // Metade derivada: a sentinela vai para todo banco que a FÁBRICA considera dado de
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

    // TROCADO NA AUDITORIA DE E2B (2026-08-15). O título dizia "nem nos dois bancos globais"
    // e a fila era um deles; agora ela é POR ATLAS, então o que precisa ser afirmado mudou de
    // natureza: não é mais "a fila global sobreviveu", é "a fila DAQUELE atlas local
    // sobreviveu ao expurgo dos remotos". Escrever o acessor sem escopo aqui (como antes)
    // passou a ESTOURAR, porque o expurgo desativa o escopo remoto e não sobra escopo ativo,
    // e um teste que só corrigisse o estouro estaria medindo outra coisa.
    it('NAO toca no atlas LOCAL, nem na FILA dele, nem no banco da instalação', async () => {
        await local.initLocalAtlases();
        const localAtlas = (await local.createLocalAtlas('Operação Alfa')).atlas;
        const escopoLocal = local.scopeOfLocalAtlas(localAtlas);
        await ns.getStoreFor(ns.StoreName.MAPS, escopoLocal)
            .setItem('Principal', { dono: 'local' });
        await ns.getStoreFor(ns.StoreName.OPERATION_QUEUE, escopoLocal)
            .setItem('op_1', { id: 'op_1' });

        await api.activateRemoteAtlas(ATLAS_A);
        await seedRemote(ATLAS_A);
        await api.purgeAllRemoteAtlases();

        expect(await ns.getStoreFor(ns.StoreName.MAPS, escopoLocal)
            .getItem('Principal')).toEqual({ dono: 'local' });
        expect(await ns.getStoreFor(ns.StoreName.OPERATION_QUEUE, escopoLocal)
            .getItem('op_1')).toEqual({ id: 'op_1' });
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
// 2b. E2: o expurgo POUPA o que uma aba viva tem montado, e só até o prazo
//
// Os três casos são um portão só, e nenhum deles vale sozinho: (1) prova que poupar existe,
// (2) prova que o expurgo continua destruindo (sem ele, um expurgo virado no-op passaria em
// (1) com louvor), e (3) prova que poupar tem fim, que é o que separa "adiar o resíduo" de
// "torná-lo permanente". Todos leem a sentinela pelos dez nomes ABSOLUTOS, e todos afirmam o
// estado ANTES da destruição.
// ============================================================================

describe('remote-atlas.api :: expurgo que poupa a montagem viva', () => {
    it('(1) LOCK SEGURADO por outra aba: sentinela viva, entrada intacta, spared traz o id', async () => {
        await api.activateRemoteAtlas(ATLAS_A);
        await seedRemote(ATLAS_A);
        // esta aba sai de A, e a vizinha continua nele
        await api.activateRemoteAtlas(ATLAS_B);
        await seedRemote(ATLAS_B);
        const soltar = await outraAbaMonta(ATLAS_A);
        expect(stillHoldingSentinel(dbNamesOfRemote(ATLAS_A))).toEqual(dbNamesOfRemote(ATLAS_A));

        const relatorio = await api.purgeAllRemoteAtlases();
        await soltar();

        expect(relatorio.spared).toEqual([ATLAS_A]);
        expect(relatorio.atlases).toEqual([ATLAS_B]);
        expect(stillHoldingSentinel(dbNamesOfRemote(ATLAS_A))).toEqual(dbNamesOfRemote(ATLAS_A));
        expect(relatorio.cleared).not.toContain(`ebgeo_maps__remote-${ATLAS_A}`);
        // a entrada SOBREVIVE: é ela que faz a próxima varredura enxergar o namespace
        expect((await api.listRemoteAtlases()).map(e => e.atlasId)).toEqual([ATLAS_A]);
    });

    it('(2) CONTROLE: com o mesmo cenário e o lock SOLTO, sentinela morta e entrada removida', async () => {
        await api.activateRemoteAtlas(ATLAS_A);
        await seedRemote(ATLAS_A);
        await api.activateRemoteAtlas(ATLAS_B);
        await seedRemote(ATLAS_B);
        const soltar = await outraAbaMonta(ATLAS_A);
        await soltar();
        expect(stillHoldingSentinel(dbNamesOfRemote(ATLAS_A))).toEqual(dbNamesOfRemote(ATLAS_A));

        const relatorio = await api.purgeAllRemoteAtlases();

        expect(relatorio.spared).toEqual([]);
        expect(relatorio.atlases.sort()).toEqual([ATLAS_A, ATLAS_B].sort());
        expect(stillHoldingSentinel(dbNamesOfRemote(ATLAS_A))).toEqual([]);
        expect(await api.listRemoteAtlases()).toEqual([]);
    });

    it('poupar CARIMBA a data, e é a primeira que fica: o prazo não se renova', async () => {
        await api.activateRemoteAtlas(ATLAS_A);
        await seedRemote(ATLAS_A);
        await api.activateRemoteAtlas(ATLAS_B);
        await seedRemote(ATLAS_B);
        const soltar = await outraAbaMonta(ATLAS_A);

        await api.purgeAllRemoteAtlases();
        const primeiro = (await api.listRemoteAtlases())[0].sparedAt;
        // uma reconexão da aba vizinha não pode zerar o relógio
        await api.registerRemoteAtlas(ATLAS_A);
        await api.purgeAllRemoteAtlases();
        const depois = (await api.listRemoteAtlases())[0].sparedAt;
        await soltar();

        expect(primeiro).toBeGreaterThan(0);
        expect(depois).toBe(primeiro);
    });

    it('(3) PRAZO VENCIDO com o lock ainda segurado: a sentinela morre assim mesmo', async () => {
        await api.activateRemoteAtlas(ATLAS_A);
        await seedRemote(ATLAS_A);
        await api.activateRemoteAtlas(ATLAS_B);
        await seedRemote(ATLAS_B);
        const soltar = await outraAbaMonta(ATLAS_A);
        await carimbarPoupadoEm(ATLAS_A, Date.now() - api.SPARE_GRACE_MS - 1);
        expect(stillHoldingSentinel(dbNamesOfRemote(ATLAS_A))).toEqual(dbNamesOfRemote(ATLAS_A));

        const relatorio = await api.purgeAllRemoteAtlases();
        await soltar();

        expect(relatorio.forced).toEqual([ATLAS_A]);
        expect(relatorio.spared).toEqual([]);
        expect(relatorio.atlases).toContain(ATLAS_A);
        expect(stillHoldingSentinel(dbNamesOfRemote(ATLAS_A))).toEqual([]);
        expect((await api.listRemoteAtlases()).map(e => e.atlasId)).toEqual([]);
    });

    // `forced` é relatório de exceção: se ele acusasse todo prazo vencido, o caso ordinário
    // (a aba vizinha morreu faz tempo) apareceria como tomada à força toda vez, e o aviso
    // deixaria de significar alguma coisa.
    it('prazo vencido e NINGUÉM montado: destrói pelo caminho normal, forced fica vazio', async () => {
        await api.activateRemoteAtlas(ATLAS_A);
        await seedRemote(ATLAS_A);
        await api.activateRemoteAtlas(ATLAS_B);
        await seedRemote(ATLAS_B);
        await carimbarPoupadoEm(ATLAS_A, Date.now() - api.SPARE_GRACE_MS - 1);

        const relatorio = await api.purgeAllRemoteAtlases();

        expect(relatorio.forced).toEqual([]);
        expect(relatorio.atlases.sort()).toEqual([ATLAS_A, ATLAS_B].sort());
        expect(stillHoldingSentinel(dbNamesOfRemote(ATLAS_A))).toEqual([]);
    });

    it('CONTROLE do prazo: um dia DENTRO do prazo com o mesmo lock ainda poupa', async () => {
        await api.activateRemoteAtlas(ATLAS_A);
        await seedRemote(ATLAS_A);
        await api.activateRemoteAtlas(ATLAS_B);
        await seedRemote(ATLAS_B);
        const soltar = await outraAbaMonta(ATLAS_A);
        await carimbarPoupadoEm(ATLAS_A, Date.now() - api.SPARE_GRACE_MS + 60_000);

        const relatorio = await api.purgeAllRemoteAtlases();
        await soltar();

        expect(relatorio.forced).toEqual([]);
        expect(relatorio.spared).toEqual([ATLAS_A]);
        expect(stillHoldingSentinel(dbNamesOfRemote(ATLAS_A))).toEqual(dbNamesOfRemote(ATLAS_A));
    });

    // Sem esta linha, E2 CRIA uma perda nova: um namespace poupado não entra em `atlases` nem
    // em `adopted`, o predicado responde false, e o guarda de boot esvazia o slot local #1 do
    // usuário sobre a ponte legada, no boot, sem erro.
    it('poupado CONTA como alcançado pelo predicado do guarda de boot', async () => {
        await api.activateRemoteAtlas(ATLAS_A);
        await seedRemote(ATLAS_A);
        await api.activateRemoteAtlas(ATLAS_B);
        await seedRemote(ATLAS_B);
        const soltar = await outraAbaMonta(ATLAS_A);

        const relatorio = await api.purgeAllRemoteAtlases();
        await soltar();

        expect(api.purgeReachedAtlas(relatorio, ATLAS_A)).toBe(true);
        expect(api.purgeReachedAtlas(relatorio, ATLAS_B)).toBe(true);
        // controle negativo: um atlas que a varredura não viu continua não alcançado
        expect(api.purgeReachedAtlas(relatorio, 'atlas-que-ninguem-registrou')).toBe(false);
    });
});

// ============================================================================
// 2b-bis. O VETO DO RESGATE QUE FALHOU (E6, segunda metade)
//
// O resgate parou de MENTIR quando passou a confirmar a adoção por leitura de disco, e não
// parou de PERDER: ninguém reivindicava o namespace e a varredura seguinte destruía a única
// cópia de trabalho que o servidor nunca recebeu. O veto é a retenção com prazo que fecha isso.
//
// O QUE ESTES VERDES PROVARIAM SE O CÓDIGO ESTIVESSE ERRADO. Cada caso de retenção anda em par
// com um controle que roda a MESMA varredura sem o veto (ou com o prazo vencido) e exige a
// sentinela MORTA. Sem esse par, "o veto poupou" e "a varredura não varreu" são a mesma
// resposta, que foi exatamente a forma de cobertura vazia que o par `spared` acima já pagou.
// ============================================================================

describe('remote-atlas.api :: o veto do resgate que falhou', () => {
    it('vetado: a sentinela sobrevive, a entrada fica, e o NÃO vetado morre na mesma varredura', async () => {
        await api.activateRemoteAtlas(ATLAS_A);
        await seedRemote(ATLAS_A);
        await api.activateRemoteAtlas(ATLAS_B);
        await seedRemote(ATLAS_B);

        expect(await api.retainRemoteAtlasForRescue(ATLAS_A)).toBe(true);
        const relatorio = await api.purgeAllRemoteAtlases();

        expect(relatorio.retained).toEqual([ATLAS_A]);
        expect(stillHoldingSentinel(dbNamesOfRemote(ATLAS_A))).toEqual(dbNamesOfRemote(ATLAS_A));
        expect(relatorio.cleared).not.toContain(`ebgeo_maps__remote-${ATLAS_A}`);
        // A entrada REMOTA sobrevive: é ela que faz a próxima varredura enxergar o namespace,
        // e é o que distingue "retido" de "esquecido no disco".
        expect(remotosNoDisco()).toEqual([ATLAS_A]);
        // ...e o que ninguém vetou morre na mesma passada.
        expect(relatorio.atlases).toEqual([ATLAS_B]);
        expect(stillHoldingSentinel(dbNamesOfRemote(ATLAS_B))).toEqual([]);
    });

    // O CONTROLE QUE ISOLA A CAUSA: cenário idêntico, veto ausente, e A morre. Sem ele, o caso
    // acima ficaria verde com o expurgo inteiro comentado.
    it('CONTROLE: o MESMO cenário sem veto destrói os dois', async () => {
        await api.activateRemoteAtlas(ATLAS_A);
        await seedRemote(ATLAS_A);
        await api.activateRemoteAtlas(ATLAS_B);
        await seedRemote(ATLAS_B);

        const relatorio = await api.purgeAllRemoteAtlases();

        expect(relatorio.retained).toEqual([]);
        expect(relatorio.atlases.sort()).toEqual([ATLAS_A, ATLAS_B].sort());
        expect(stillHoldingSentinel(dbNamesOfRemote(ATLAS_A))).toEqual([]);
        expect(stillHoldingSentinel(dbNamesOfRemote(ATLAS_B))).toEqual([]);
    });

    it('o relógio é o da PRIMEIRA falha: vetar de novo não compra outro dia', async () => {
        await api.retainRemoteAtlasForRescue(ATLAS_A);
        const primeiro = api.remoteAtlasRescueVetoSince(ATLAS_A);

        vi.spyOn(Date, 'now').mockReturnValue(primeiro + 60_000);
        expect(await api.retainRemoteAtlasForRescue(ATLAS_A)).toBe(true);

        expect(primeiro).toBeGreaterThan(0);
        expect(api.remoteAtlasRescueVetoSince(ATLAS_A)).toBe(primeiro);
    });

    // O INVARIANTE DURO: dado de servidor não fica legível para sempre no disco de um deslogado.
    // O prazo lido aqui é a CONSTANTE EXPORTADA, não um número injetado no expurgo: um teste que
    // passasse `rescueGraceMs: 0` provaria que a opção funciona e nada sobre o padrão que embarca.
    it('PRAZO VENCIDO: o namespace é destruído e o veto sai do disco', async () => {
        await api.activateRemoteAtlas(ATLAS_A);
        await seedRemote(ATLAS_A);
        await api.retainRemoteAtlasForRescue(ATLAS_A);
        const vetadoEm = api.remoteAtlasRescueVetoSince(ATLAS_A);

        vi.spyOn(Date, 'now').mockReturnValue(vetadoEm + api.RESCUE_VETO_GRACE_MS + 1);
        const relatorio = await api.purgeAllRemoteAtlases();

        expect(relatorio.retained).toEqual([]);
        expect(relatorio.atlases).toEqual([ATLAS_A]);
        expect(stillHoldingSentinel(dbNamesOfRemote(ATLAS_A))).toEqual([]);
        expect(remotosNoDisco()).toEqual([]);
        // O veto vencido não fica pendurado: uma remontagem futura herdaria uma retenção que
        // já não protege nada.
        expect(api.remoteAtlasRescueVetoSince(ATLAS_A)).toBe(0);
    });

    it('CONTROLE do prazo: um minuto ANTES de vencer, o mesmo cenário ainda retém', async () => {
        await api.activateRemoteAtlas(ATLAS_A);
        await seedRemote(ATLAS_A);
        await api.retainRemoteAtlasForRescue(ATLAS_A);
        const vetadoEm = api.remoteAtlasRescueVetoSince(ATLAS_A);

        vi.spyOn(Date, 'now').mockReturnValue(vetadoEm + api.RESCUE_VETO_GRACE_MS - 60_000);
        const relatorio = await api.purgeAllRemoteAtlases();

        expect(relatorio.retained).toEqual([ATLAS_A]);
        expect(stillHoldingSentinel(dbNamesOfRemote(ATLAS_A))).toEqual(dbNamesOfRemote(ATLAS_A));
    });

    // A OUTRA METADE DO INVARIANTE, e sem ela a retenção romperia o que veio proteger: montar o
    // atlas de novo (login, reabertura) significa que o trabalho deixou de estar encalhado, então
    // o SAIR seguinte, o que o usuário clicou, tem que levar o dado como sempre levou. Um veto
    // que sobrevivesse à remontagem deixaria dado de servidor um dia inteiro depois de um logout
    // deliberado, que é o invariante duro deste módulo.
    it('remontar o atlas derruba o veto, e o logout seguinte destrói de novo', async () => {
        await api.activateRemoteAtlas(ATLAS_A);
        await seedRemote(ATLAS_A);
        await api.retainRemoteAtlasForRescue(ATLAS_A);
        expect(api.remoteAtlasRescueVetoSince(ATLAS_A)).toBeGreaterThan(0);

        // O usuário entra de novo e reabre o mesmo atlas.
        await api.activateRemoteAtlas(ATLAS_A);
        expect(api.remoteAtlasRescueVetoSince(ATLAS_A)).toBe(0);

        const relatorio = await api.purgeAllRemoteAtlases();

        expect(relatorio.retained).toEqual([]);
        expect(relatorio.atlases).toEqual([ATLAS_A]);
        expect(stillHoldingSentinel(dbNamesOfRemote(ATLAS_A))).toEqual([]);
    });

    // Se o retido NÃO contasse como alcançado, a retenção criaria uma perda nova pela porta de
    // `spared`: o guarda de boot esvaziaria o slot local #1 do usuário sobre a ponte legada.
    //
    // MEDIDO, E VALE ESTAR ESCRITO: no relatório de verdade quem responde é `registered`, que é
    // capturado antes de a varredura tocar em nada, então apagar `retained` do ramo de soma NÃO
    // deixa este caso vermelho. É por isso que a SEGUNDA metade existe: ela chama o predicado com
    // um relatório SEM `registered`, que é o formato antigo (relatório em cache, dobro de teste)
    // para o qual aquele ramo é o único leitor. Sem ela, a linha seria redundante e o teste
    // afirmaria policiar algo que não policia.
    it('retido CONTA como alcançado pelo predicado do guarda de boot', async () => {
        await api.activateRemoteAtlas(ATLAS_A);
        await seedRemote(ATLAS_A);
        await api.retainRemoteAtlasForRescue(ATLAS_A);

        const relatorio = await api.purgeAllRemoteAtlases();

        expect(relatorio.retained).toEqual([ATLAS_A]);
        expect(api.purgeReachedAtlas(relatorio, ATLAS_A)).toBe(true);
        // controle negativo no MESMO relatório: quem não foi registrado segue não alcançado.
        expect(api.purgeReachedAtlas(relatorio, ATLAS_B)).toBe(false);

        // O ramo de compatibilidade, o único que lê `retained`.
        expect(api.purgeReachedAtlas({ retained: [ATLAS_A] }, ATLAS_A)).toBe(true);
        expect(api.purgeReachedAtlas({ retained: [ATLAS_A] }, ATLAS_B)).toBe(false);
    });

    // ACHADO PELO CONTROLE NEGATIVO, e é pior que a perda que a retenção veio impedir. O resgate
    // tem DOIS jeitos de falhar, e o segundo (a adoção RESOLVE e o read-back não acha o slot no
    // disco) roda DEPOIS de `adoptRemoteAtlasAsLocal` já ter removido a chave remota: sem a
    // entrada, a varredura nem visita o atlas, o veto nunca é consultado, o prazo nunca vence, e
    // o dado de servidor fica no disco PARA SEMPRE. Reter tem que devolver o namespace ao
    // registro, não só vetá-lo.
    it('retido sem entrada no registro: a entrada volta, e o prazo volta a correr sobre ela', async () => {
        await api.activateRemoteAtlas(ATLAS_A);
        await seedRemote(ATLAS_A);
        // Como fica o disco depois de uma adoção que resolveu sem gravar o slot local.
        await ns.getGlobalStore().removeItem(remoteAtlasDiskKey(ATLAS_A));
        expect(remotosNoDisco()).toEqual([]);

        expect(await api.retainRemoteAtlasForRescue(ATLAS_A)).toBe(true);

        // A varredura ENXERGA o atlas de novo, e o retém enquanto o prazo vale...
        expect(remotosNoDisco()).toEqual([ATLAS_A]);
        expect((await api.purgeAllRemoteAtlases()).retained).toEqual([ATLAS_A]);
        expect(stillHoldingSentinel(dbNamesOfRemote(ATLAS_A))).toEqual(dbNamesOfRemote(ATLAS_A));

        // ...e o destrói quando vence, que é o que "para sempre" deixou de ser.
        const vetadoEm = api.remoteAtlasRescueVetoSince(ATLAS_A);
        vi.spyOn(Date, 'now').mockReturnValue(vetadoEm + api.RESCUE_VETO_GRACE_MS + 1);
        const relatorio = await api.purgeAllRemoteAtlases();

        expect(relatorio.atlases).toEqual([ATLAS_A]);
        expect(stillHoldingSentinel(dbNamesOfRemote(ATLAS_A))).toEqual([]);
    });

    // CONTROLE do caso acima: no caminho ORDINÁRIO (a adoção lançou, a chave remota nunca saiu)
    // reter não escreve nada no registro. Importa porque o chamador está aqui justamente por causa
    // de um disco que recusou escrita: uma escrita a mais neste ponto falharia junto.
    it('CONTROLE: com a entrada no lugar, reter NÃO reescreve o registro', async () => {
        await api.activateRemoteAtlas(ATLAS_A);
        const antes = (await api.listRemoteAtlases())[0];
        const globalStore = ns.getGlobalStore();
        globalStore.setItem.mockClear();

        expect(await api.retainRemoteAtlasForRescue(ATLAS_A)).toBe(true);

        expect(globalStore.setItem).not.toHaveBeenCalled();
        expect((await api.listRemoteAtlases())[0]).toEqual(antes);
    });

    // O veto DIZ quando não conseguiu. Um guarda que falha calado é a classe que este caminho
    // inteiro existe para remover, e é também o que prova que o dobro de `localStorage` no topo
    // deste arquivo é o que faz os casos acima passarem.
    it('naoRetemSemArmazenamento: sem localStorage o veto devolve false, e a varredura destrói', async () => {
        await api.activateRemoteAtlas(ATLAS_A);
        await seedRemote(ATLAS_A);

        const guardado = globalThis.localStorage;
        Object.defineProperty(globalThis, 'localStorage', { value: undefined, writable: true });
        try {
            expect(await api.retainRemoteAtlasForRescue(ATLAS_A)).toBe(false);
            expect(api.remoteAtlasRescueVetoSince(ATLAS_A)).toBe(0);
            const relatorio = await api.purgeAllRemoteAtlases();
            expect(relatorio.retained).toEqual([]);
            expect(stillHoldingSentinel(dbNamesOfRemote(ATLAS_A))).toEqual([]);
        } finally {
            Object.defineProperty(globalThis, 'localStorage', { value: guardado, writable: true });
        }
    });
});

// ============================================================================
// 2c. P3: o expurgo não pode relatar como destruído o namespace que nunca foi escrito
//
// O RELATÓRIO E O PREDICADO SÃO DUAS PERGUNTAS DIFERENTES, e confundi-las custou uma perda de
// dado (P13). O relatório responde "o que a destruição encontrou": `empty` é um namespace que
// não tinha um byte, e ele NÃO pode aparecer em `cleared`/`atlases`, senão a varredura volta a
// alegar destruição de banco que ela mesma abriu para ler. O predicado responde outra coisa,
// "este atlas possuía namespace", e para essa `empty` vale tanto quanto `atlases`: quem não
// possuía namespace não aparece no relatório de jeito nenhum, porque o relatório é DERIVADO do
// registro.
// ============================================================================

describe('remote-atlas.api :: namespace registrado e NUNCA escrito', () => {
    // TROCADO EM 2026-08-15 (P13), nunca somado. Este caso exigia
    // `purgeReachedAtlas(...) === false` para o namespace vazio: era a descrição fiel do código
    // e o código perdia dado, então mantê-lo faria a correção parecer regressão. O que ele
    // continua exigindo (`empty` fora de `cleared` e de `atlases`) é a metade de P3 que estava
    // certa e que segue valendo.
    it('não entra em cleared nem em atlases, e mesmo assim CONTA como alcançado', async () => {
        // Registrar acontece ANTES da primeira escrita, então este estado é alcançável por um
        // crash entre as duas: a entrada existe e os dez bancos, não.
        await api.registerRemoteAtlas(ATLAS_A);

        const relatorio = await api.purgeAllRemoteAtlases();

        expect(relatorio.cleared).toEqual([]);
        expect(relatorio.atlases).toEqual([]);
        expect(relatorio.empty).toEqual([ATLAS_A]);
        // Estar no REGISTRO é a prova de que este atlas possuía namespace, e é isso que o
        // guarda de boot pergunta: o dado dele nunca esteve nos bancos sem sufixo, então o
        // segundo wipe não tem nada para terminar lá e só alcançaria o slot local #1.
        expect(api.purgeReachedAtlas(relatorio, ATLAS_A)).toBe(true);
        // a entrada some assim mesmo: não há o que guardar
        expect(await api.listRemoteAtlases()).toEqual([]);
    });

    // CONTROLE NEGATIVO do caso acima, e ele é o que impede a correção de virar "responde true
    // para tudo": um atlas que a varredura nunca viu continua NÃO alcançado, no MESMO relatório
    // em que o vazio é alcançado. É esse par que separa "o predicado passou a contar `empty`" de
    // "o predicado parou de olhar".
    it('CONTROLE: no mesmo relatório, quem nunca foi registrado NÃO é alcançado', async () => {
        await api.registerRemoteAtlas(ATLAS_A);

        const relatorio = await api.purgeAllRemoteAtlases();

        expect(relatorio.empty).toEqual([ATLAS_A]);
        expect(api.purgeReachedAtlas(relatorio, ATLAS_B)).toBe(false);
        expect(api.purgeReachedAtlas(relatorio, 'atlas-pre-namespace')).toBe(false);
    });

    it('CONTROLE: o MESMO atlas com um byte dentro conta como alcançado', async () => {
        await api.registerRemoteAtlas(ATLAS_A);
        await ns.getStoreFor(ns.StoreName.MAPS, ns.remoteScope(ATLAS_A))
            .setItem('Principal', { dono: 'servidor' });

        const relatorio = await api.purgeAllRemoteAtlases();

        expect(relatorio.cleared).toEqual([`ebgeo_maps__remote-${ATLAS_A}`]);
        expect(relatorio.atlases).toEqual([ATLAS_A]);
        expect(relatorio.empty).toEqual([]);
        expect(api.purgeReachedAtlas(relatorio, ATLAS_A)).toBe(true);
    });
});

// ============================================================================
// 3. Órfão: a entrada que sobrou de uma aba que morreu
// ============================================================================

describe('remote-atlas.api :: uma entrada corrompida não derruba a varredura', () => {
    // P13, segunda metade (a opção que o dono escolheu): o guarda de boot pergunta "este atlas
    // estava REGISTRADO", não "o expurgo o pôs em alguma lista de resultado". As duas concordam
    // no caminho feliz e divergem exatamente aqui.
    //
    // Antes, o laço não tinha `try` por entrada: um atlas cuja destruição lançasse derrubava a
    // varredura INTEIRA, e todo OUTRO atlas de servidor da máquina sobrevivia ao logout, que é
    // o invariante que esta função existe para carregar. E o atlas que falhou não aparecia em
    // lista nenhuma, então um predicado somado por resultados responderia "não alcançado" e o
    // guarda aponta o segundo wipe para o slot local #1 do usuário.

    it('a chave inutilizável é pulada e os atlas REAIS são varridos assim mesmo', async () => {
        await api.activateRemoteAtlas(ATLAS_A);
        await seedRemote(ATLAS_A);
        await api.activateRemoteAtlas(ATLAS_B);
        await seedRemote(ATLAS_B);
        // ANTES (positivo): sem isto, "foi destruído" e "nunca existiu" seriam o mesmo verde.
        expect(stillHoldingSentinel(dbNamesOfRemote(ATLAS_A))).toEqual(dbNamesOfRemote(ATLAS_A));
        expect(stillHoldingSentinel(dbNamesOfRemote(ATLAS_B))).toEqual(dbNamesOfRemote(ATLAS_B));

        // A destruição de A lança; a de B segue o caminho normal. A injeção é uma entrada
        // CORROMPIDA no registro (sufixo com caractere que `remoteScope` recusa), que é uma
        // falha realista e, ao contrário de um spy em `navigator.locks`, não é global e não
        // vaza para os outros casos deste arquivo.
        // A entrada corrompida: o id vem da CHAVE, e um id que `remoteScope` recusa faz a
        // destruição daquela entrada lançar. É falha realista (um registro escrito por uma
        // versão futura, um valor truncado) e, ao contrário de um spy em `navigator.locks`,
        // não é global e não vaza para os outros casos deste arquivo.
        await ns.getGlobalStore().setItem('remote_atlas:id invalido!', {
            atlasId: 'id invalido!', dbSuffix: 'remote-id invalido!', createdAt: 1, updatedAt: 1
        });

        const relatorio = await api.purgeAllRemoteAtlases();

        // O vizinho morreu: a varredura NÃO foi abortada pela exceção do primeiro. Esta é a
        // asserção central, e antes do `try` por entrada ela ficava vermelha.
        expect(stillHoldingSentinel(dbNamesOfRemote(ATLAS_B))).toEqual([]);
        expect(relatorio.failed).toEqual([]);

        // Os dois atlas REAIS contam como alcançados, que é o que impede o guarda de apontar
        // o segundo wipe para o slot local #1 do usuário.
        expect(api.purgeReachedAtlas(relatorio, ATLAS_A)).toBe(true);
        expect(api.purgeReachedAtlas(relatorio, ATLAS_B)).toBe(true);
        // O que NUNCA esteve no registro segue respondendo false, senão o predicado viraria
        // sempre-verdadeiro e o segundo wipe nunca rodaria (o caso pré-namespace precisa dele).
        expect(api.purgeReachedAtlas(relatorio, 'atlas-que-nunca-existiu')).toBe(false);
    });

    it('a chave inutilizável fica no disco, e o atlas real ao lado dela morre', async () => {
        await api.activateRemoteAtlas(ATLAS_A);
        await seedRemote(ATLAS_A);
        // A entrada corrompida: o id vem da CHAVE, e um id que `remoteScope` recusa faz a
        // destruição daquela entrada lançar. É falha realista (um registro escrito por uma
        // versão futura, um valor truncado) e, ao contrário de um spy em `navigator.locks`,
        // não é global e não vaza para os outros casos deste arquivo.
        await ns.getGlobalStore().setItem('remote_atlas:id invalido!', {
            atlasId: 'id invalido!', dbSuffix: 'remote-id invalido!', createdAt: 1, updatedAt: 1
        });

        await api.purgeAllRemoteAtlases();

        // A chave inutilizável FICA no disco: apagá-la seria o módulo escondendo a própria
        // corrupção, e ela é inerte de qualquer forma (não nomeia namespace alcançável).
        expect(remotosNoDisco()).toContain('id invalido!');
        // E o atlas REAL foi destruído, que é a prova de que a corrupção não derrubou nada.
        expect(stillHoldingSentinel(dbNamesOfRemote(ATLAS_A))).toEqual([]);
    });
});

describe('remote-atlas.api :: orfaos', () => {
    it('entrada orfa de outra aba (ou de um crash) e varrida sem sessao nenhuma', async () => {
        // Simula o que a OUTRA aba deixou: registro no banco global e dados no namespace,
        // sem que ESTA execução tenha aberto nada.
        await ns.getGlobalStore().setItem(remoteAtlasDiskKey(ATLAS_A), {
            atlasId: ATLAS_A,
            dbSuffix: `remote-${ATLAS_A}`,
            createdAt: 1,
            updatedAt: 1
        });
        await seedRemote(ATLAS_A);

        const relatorio = await api.purgeAllRemoteAtlases();

        expect(relatorio.atlases).toEqual([ATLAS_A]);
        expect(stillHoldingSentinel(dbNamesOfRemote(ATLAS_A))).toEqual([]);
        expect(remotosNoDisco()).toEqual([]);
    });

    it('valor corrompido nao esconde o namespace: a identidade esta na CHAVE', async () => {
        await ns.getGlobalStore().setItem(remoteAtlasDiskKey(ATLAS_A), 'lixo');
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
        expect(relatorio.blocked.sort()).toEqual(allDbNamesOfRemote(ATLAS_A).sort());
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

        expect(relatorio.dropped.sort()).toEqual(allDbNamesOfRemote(ATLAS_A).sort());
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
        await ns.getGlobalStore().setItem(remoteAtlasDiskKey(ATLAS_A), {
            atlasId: ATLAS_A,
            dbSuffix: `remote-${ATLAS_A}`,
            createdAt: 1,
            updatedAt: 1
        });

        const relatorio = await api.purgeAllRemoteAtlases();

        expect(relatorio.adopted).toEqual([ATLAS_A]);
        expect(relatorio.atlases).toEqual([]);
        expect(stillHoldingSentinel(dbNamesOfRemote(ATLAS_A))).toEqual(dbNamesOfRemote(ATLAS_A));
        expect(remotosNoDisco()).toEqual([]);
        // A posse ficou com o registro LOCAL, no disco: sem esta linha, "a chave remota sumiu"
        // seria indistinguível de as duas terem sumido, que é a perda que o resgate evita.
        expect(localSlotsOnDisk(globalDisk()).map(e => e.dbSuffix)).toContain(`remote-${ATLAS_A}`);
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

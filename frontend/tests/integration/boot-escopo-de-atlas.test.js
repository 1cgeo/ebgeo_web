// Path: tests/integration/boot-escopo-de-atlas.test.js

/**
 * @fileoverview O boot escolhendo em QUAL namespace de atlas a aba vai trabalhar.
 *
 * `initLocalAtlases` existia com um chamador só, a migração de esquema, que passa
 * `isAuthenticated: false` fixo no código. Fora dela ninguém ativava escopo, então o
 * repositório caía na ponte legada (`ensureAtlasScope`) e todo atlas, local ou remoto,
 * resolvia para os bancos sem sufixo. Este arquivo prende o outro chamador: o boot, com
 * origem e sessão REAIS.
 *
 * O QUE ESTE VERDE PROVARIA SE O CÓDIGO ESTIVESSE ERRADO. As asserções são sobre o disco
 * (quais bancos existem, quais guardam a sentinela) e sobre o escopo ativo, nunca sobre "a
 * função foi chamada". Sem a fiação, o registro `local_atlases` nem existiria depois de um
 * boot que pula a migração, e o escopo ativo seria a ponte legada.
 *
 * O SEGUNDO GUARDA É O CARO. Com o namespace ligado, o antigo "origem REMOTE e ninguém
 * autenticado => esvazie o atlas montado" passou a ter dois significados, e o errado apaga o
 * atlas LOCAL do usuário. Os dois braços do predicado (`purgeReachedAtlas`) estão medidos
 * aqui, um contra o outro.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    localSlotsOnDisk,
    currentLocalAtlasOnDisk,
    remoteAtlasDiskKey
} from '../helpers/atlas-registry-disk.js';

// ============================================================================
// Disco falso, chaveado por (nome do banco, object store). Sobrevive ao `vi.resetModules()`
// de propósito: é o que o faz se comportar como disco entre "recargas".
// ============================================================================

const { databases, dropped, storeOf, seed, readKey, resetDisk } = vi.hoisted(() => {
    const databases = new Map();
    const dropped = [];

    function backingOf(name, storeName = null) {
        const key = `${name}::${storeName || 'keyvaluepairs'}`;
        if (!databases.has(key)) databases.set(key, new Map());
        return databases.get(key);
    }

    function storeOf({ name, storeName = null }) {
        const backing = backingOf(name, storeName);
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

    return {
        databases,
        dropped,
        storeOf,
        seed: (name, key, value, storeName = null) => backingOf(name, storeName).set(key, value),
        readKey: (name, key, storeName = null) => backingOf(name, storeName).get(key) ?? null,
        resetDisk: () => { databases.clear(); dropped.length = 0; }
    };
});

vi.mock('localforage', () => ({
    default: {
        createInstance: vi.fn(storeOf),
        dropInstance: vi.fn(async ({ name }) => {
            dropped.push(name);
            for (const key of [...databases.keys()]) {
                if (key.startsWith(`${name}::`)) databases.delete(key);
            }
        })
    }
}));

/** Os dez bancos por atlas, escritos à mão em vez de derivados do módulo sob teste. */
const ATLAS_DATABASES = [
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

const GLOBAL_DATABASE = 'ebgeo_global';
const SENTINELA = '__sentinela_do_teste__';
const ATLAS_A = '11111111-1111-4111-8111-111111111111';

/** @returns {string[]} Os dez bancos de um atlas remoto, absolutos. */
function bancosRemotos(atlasId) {
    return ATLAS_DATABASES.map(nome => `${nome}__remote-${atlasId}`);
}

/** Semeia a sentinela nos dez bancos sem sufixo (o slot local #1). */
function semearSlotLocal() {
    for (const nome of ATLAS_DATABASES) seed(nome, SENTINELA, { alvo: nome });
}

/** Registra um atlas remoto e semeia a sentinela nos seus dez bancos. */
function semearAtlasRemoto(atlasId) {
    seed(GLOBAL_DATABASE, remoteAtlasDiskKey(atlasId), {
        atlasId, dbSuffix: `remote-${atlasId}`, createdAt: 1, updatedAt: 1
    });
    for (const nome of bancosRemotos(atlasId)) seed(nome, SENTINELA, { alvo: nome });
}

/** @param {string[]} nomes @returns {string[]} Os que ainda guardam a sentinela. */
function aindaComSentinela(nomes) {
    return nomes.filter(nome => readKey(nome, SENTINELA) !== null);
}

/**
 * Finge uma sessão viva no grafo de módulos recém-carregado.
 * @param {boolean} authenticated
 * @returns {Promise<void>}
 */
async function setSession(authenticated) {
    const { sessionContext } = await import('@store/sync/session-context.js');
    vi.spyOn(sessionContext, 'isAuthenticated').mockReturnValue(authenticated);
}

/**
 * A fachada da store num grafo de módulos novo, com os serviços reais.
 * @returns {Promise<{ store: Object, ns: Object }>}
 */
async function loadStoreFacade() {
    vi.resetModules();
    const { initServices } = await import('@store/services.js');
    initServices();
    const store = await import('@store/store.js');
    const ns = await import('@store/atlas-namespace.js');
    return { store, ns };
}

/** Marca o esquema como atual, o que faz a migração NÃO rodar (ela é o outro chamador). */
async function esquemaAtual() {
    const { ATLAS_SCHEMA_VERSION } = await import('@store/atlas/atlas.entity.js');
    seed('ebgeo_app_settings', 'schemaVersion', ATLAS_SCHEMA_VERSION);
}

beforeEach(() => {
    resetDisk();
    vi.clearAllMocks();
});

// ============================================================================
// 1. O boot local
// ============================================================================


/**
 * Os slots locais que existem no disco falso.
 *
 * A leitura mora em `tests/helpers/atlas-registry-disk.js`, e o `@fileoverview` de lá explica
 * as duas escolhas: ela lê as CHAVES CRUAS (nunca `readLocalAtlasRegistry`, senão instrumento e
 * sujeito concordariam por construção) e não funde a forma legada com a atual. Este arquivo
 * conhecia o layout à mão e quebrou inteiro na última mudança dele, sem que houvesse bug algum.
 * @returns {Array<object>} Do mais antigo para o mais novo; vazio quando não há slot.
 */
function slotsLocais() {
    return localSlotsOnDisk(databases.get(`${GLOBAL_DATABASE}::keyvaluepairs`));
}

/** @returns {string|null} O ponteiro de slot corrente, direto do disco falso. */
function slotCorrente() {
    return currentLocalAtlasOnDisk(databases.get(`${GLOBAL_DATABASE}::keyvaluepairs`));
}

describe('boot: o escopo do atlas sai do registro, não da ponte legada', () => {
    it('registra e ativa o slot local, mesmo quando a migração não roda', async () => {
        // Se a migração rodasse, ela também escreveria o registro, e este verde não diria de
        // quem foi o mérito. Com o esquema já atual, o boot é o único candidato.
        const { store, ns } = await loadStoreFacade();
        await setSession(false);
        await esquemaAtual();

        await store.initializeWithLastActiveMap();

        const slots = slotsLocais();
        expect(slots).toHaveLength(1);
        const slot = slots[0];
        // Zero cópia: o slot #1 fica com os bancos sem sufixo que a instalação já usava.
        expect(slot.dbSuffix).toBe('');
        expect(slotCorrente()).toBe(slot.id);
        expect(ns.getActiveScope()).toEqual({ kind: 'local', atlasId: slot.id, dbSuffix: '' });
    });

    it('o dado do usuário offline não é tocado por ter ganhado um registro', async () => {
        const { store } = await loadStoreFacade();
        await setSession(false);
        await esquemaAtual();
        semearSlotLocal();

        await store.initializeWithLastActiveMap();

        expect(aindaComSentinela(ATLAS_DATABASES)).toEqual(ATLAS_DATABASES);
    });

    it('um segundo boot reaproveita o slot: o registro não cresce a cada carga', async () => {
        const primeiro = await loadStoreFacade();
        await setSession(false);
        await esquemaAtual();
        await primeiro.store.initializeWithLastActiveMap();
        const idPrimeiro = slotCorrente();

        const segundo = await loadStoreFacade();
        await setSession(false);
        await segundo.store.initializeWithLastActiveMap();

        expect(slotsLocais()).toHaveLength(1);
        expect(slotCorrente()).toBe(idPrimeiro);
    });
});

// ============================================================================
// 2. O boot com sessão viva sobre um atlas de servidor
// ============================================================================

describe('boot com origem REMOTE e sessão viva', () => {
    it('monta o namespace DAQUELE atlas, e o registro remoto é reparado', async () => {
        const { store, ns } = await loadStoreFacade();
        await setSession(true);
        await esquemaAtual();
        seed(GLOBAL_DATABASE, '__store_origin__', { kind: 'remote', atlasId: ATLAS_A });

        await store.initializeWithLastActiveMap();

        expect(ns.getActiveScope()).toEqual(ns.remoteScope(ATLAS_A));
        // Reparo: a entrada volta ao registro, senão o wipe do logout não acha o namespace.
        expect(readKey(GLOBAL_DATABASE, remoteAtlasDiskKey(ATLAS_A))).not.toBeNull();
        expect(ns.getStore(ns.StoreName.MAPS).__dbName).toBe(`ebgeo_maps__remote-${ATLAS_A}`);
    });

    it('a migração de esquema NÃO rouba o escopo que o boot montou', async () => {
        // Sem `schemaVersion`, a cadeia de migração roda, e a v2.2→v2.3 chama `initLocalAtlases`
        // com origem LOCAL fixa. Sem a devolução do escopo, a aba terminaria escrevendo no slot
        // local acreditando estar no atlas do servidor.
        const { store, ns } = await loadStoreFacade();
        await setSession(true);
        seed(GLOBAL_DATABASE, '__store_origin__', { kind: 'remote', atlasId: ATLAS_A });

        await store.initializeWithLastActiveMap();

        expect(ns.getActiveScope()).toEqual(ns.remoteScope(ATLAS_A));
    });

    it('CONTROLE NEGATIVO: sem sessão, a mesma origem NÃO monta o namespace remoto', async () => {
        const { store, ns } = await loadStoreFacade();
        await setSession(false);
        await esquemaAtual();
        seed(GLOBAL_DATABASE, '__store_origin__', { kind: 'remote', atlasId: ATLAS_A });

        await store.initializeWithLastActiveMap();

        expect(ns.getActiveScope().kind).toBe('local');
    });
});

// ============================================================================
// 3. O segundo guarda do boot deslogado, e o atlas local que ele não pode apagar
// ============================================================================

describe('boot sem sessão com origem REMOTE: o que é esvaziado', () => {
    it('o atlas remoto tem namespace: só ele é esvaziado, e o slot local fica', async () => {
        const { store } = await loadStoreFacade();
        await setSession(false);
        await esquemaAtual();
        semearSlotLocal();
        semearAtlasRemoto(ATLAS_A);
        seed(GLOBAL_DATABASE, '__store_origin__', { kind: 'remote', atlasId: ATLAS_A });

        await store.initializeWithLastActiveMap();

        expect(aindaComSentinela(bancosRemotos(ATLAS_A))).toEqual([]);
        // O QUE ESTA LINHA DEFENDE: sem o predicado, o segundo wipe cairia aqui, e o usuário
        // perderia o atlas local por ter deslogado.
        expect(aindaComSentinela(ATLAS_DATABASES)).toEqual(ATLAS_DATABASES);
    });

    it('CONTROLE NEGATIVO (caso pré-namespace): sem namespace registrado, os bancos sem sufixo SÃO esvaziados', async () => {
        // É o dado de servidor que ficou nos bancos sem sufixo, escrito por uma versão que não
        // ativava escopo nenhum. Ninguém o alcança pelo registro, então o segundo wipe é a
        // única coisa que o remove, e ele tem de continuar existindo.
        const { store } = await loadStoreFacade();
        await setSession(false);
        await esquemaAtual();
        semearSlotLocal();
        seed(GLOBAL_DATABASE, '__store_origin__', { kind: 'remote', atlasId: ATLAS_A });

        await store.initializeWithLastActiveMap();

        expect(aindaComSentinela(ATLAS_DATABASES)).toEqual([]);
    });

    it('a origem termina LOCAL nos dois braços, que é o que o próximo boot lê', async () => {
        const { store } = await loadStoreFacade();
        await setSession(false);
        await esquemaAtual();
        semearAtlasRemoto(ATLAS_A);
        seed(GLOBAL_DATABASE, '__store_origin__', { kind: 'remote', atlasId: ATLAS_A });

        await store.initializeWithLastActiveMap();

        expect(readKey(GLOBAL_DATABASE, '__store_origin__')).toEqual({ kind: 'local', atlasId: null });
    });
});

// ============================================================================
// 4. O predicado que separa os dois braços
// ============================================================================

describe('purgeReachedAtlas', () => {
    /** @returns {Promise<Function>} */
    async function predicado() {
        vi.resetModules();
        const api = await import('@store/remote-atlas.api.js');
        return api.purgeReachedAtlas;
    }

    it('verdadeiro quando a varredura destruiu aquele namespace', async () => {
        const purgeReachedAtlas = await predicado();
        expect(purgeReachedAtlas({ atlases: [ATLAS_A], adopted: [] }, ATLAS_A)).toBe(true);
    });

    it('verdadeiro quando um atlas local o adotou (o resgate do trabalho não sincronizado)', async () => {
        const purgeReachedAtlas = await predicado();
        expect(purgeReachedAtlas({ atlases: [], adopted: [ATLAS_A] }, ATLAS_A)).toBe(true);
    });

    it('falso para outro atlas, que é o caso pré-namespace e precisa do segundo wipe', async () => {
        const purgeReachedAtlas = await predicado();
        expect(purgeReachedAtlas({ atlases: ['outro'], adopted: [] }, ATLAS_A)).toBe(false);
        expect(purgeReachedAtlas({ atlases: [], adopted: [] }, ATLAS_A)).toBe(false);
    });

    it('borda: relatório ausente ou id ausente/vazio é FALSO, o lado conservador', async () => {
        const purgeReachedAtlas = await predicado();
        expect(purgeReachedAtlas(null, ATLAS_A)).toBe(false);
        expect(purgeReachedAtlas({ atlases: [ATLAS_A], adopted: [] }, null)).toBe(false);
        expect(purgeReachedAtlas({ atlases: [ATLAS_A], adopted: [] }, '')).toBe(false);
        expect(purgeReachedAtlas({ atlases: [ATLAS_A], adopted: [] }, undefined)).toBe(false);
    });
});

// ============================================================================
// 5. DUAS ABAS, DOIS ATLAS: O PORTÃO DA MONTAGEM POR ABA (P6)
//
// Todo ponteiro de montagem era global à instalação, e com um namespace por atlas uma
// resposta global responde a aba errada: a aba A dá F5 e monta o atlas da aba B, porque a
// última escrita no ponteiro compartilhado foi a de B. Aqui as duas abas são dois grafos de
// módulos sobre o MESMO disco falso, cada um com o seu `sessionStorage`, que é exatamente a
// única coisa que o navegador dá por aba e que sobrevive ao F5.
//
// O QUE ESTES VERDES PROVARIAM SE O CÓDIGO ESTIVESSE ERRADO. Toda asserção é o NOME ABSOLUTO
// do banco que o boot terminou montando, nunca "a função foi chamada", e cada caso vem com o
// seu controle: a MESMA situação de disco, com o armazenamento da aba vazio, tem de montar o
// atlas da vizinha. Sem esse par, "montou X" seria indistinguível de um boot que ignora todos
// os ponteiros e sempre cai no mesmo lugar.
// ============================================================================

const ATLAS_B = '22222222-2222-4222-8222-222222222222';

/** Armazenamentos por aba, para que uma "recarga" da aba A não veja o da aba B. */
const armazenamentos = new Map();

/**
 * Passa a valer o `sessionStorage` DAQUELA aba. Chamar de novo com o mesmo nome é um F5;
 * com outro nome, é outra aba.
 * @param {string} nome - Identidade da aba no teste.
 * @returns {{ getItem: Function, setItem: Function, removeItem: Function }}
 */
function naAba(nome) {
    if (!armazenamentos.has(nome)) armazenamentos.set(nome, new Map());
    const backing = armazenamentos.get(nome);
    const storage = {
        __backing: backing,
        getItem: (k) => (backing.has(k) ? backing.get(k) : null),
        setItem: (k, v) => { backing.set(k, String(v)); },
        removeItem: (k) => { backing.delete(k); }
    };
    vi.stubGlobal('sessionStorage', storage);
    return storage;
}

describe('duas abas em dois atlas: cada uma volta ao seu', () => {
    beforeEach(() => {
        armazenamentos.clear();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('LOCAL: a aba A volta ao slot #1 mesmo com a instalação apontando para o #2', async () => {
        // Aba A: o boot de uma instalação virgem nasce no slot #1, que herda os bancos sem sufixo.
        naAba('A');
        const abaA = await loadStoreFacade();
        await setSession(false);
        await esquemaAtual();
        await abaA.store.initializeWithLastActiveMap();
        const slotUm = slotCorrente();

        // Aba B: cria um segundo atlas local e o monta. Isso move o ponteiro da INSTALAÇÃO.
        naAba('B');
        const abaB = await loadStoreFacade();
        await setSession(false);
        await abaB.store.initializeWithLastActiveMap();
        const local = await import('@store/local-atlas.api.js');
        const criado = await local.createLocalAtlas('Segundo');
        await local.mountLocalAtlas(criado.atlas.id);
        expect(slotCorrente()).toBe(criado.atlas.id);
        expect(slotCorrente()).not.toBe(slotUm);

        // F5 na aba A.
        naAba('A');
        const recarregada = await loadStoreFacade();
        await setSession(false);
        await recarregada.store.initializeWithLastActiveMap();

        expect(recarregada.ns.getStore(recarregada.ns.StoreName.MAPS).__dbName).toBe('ebgeo_maps');
        expect(recarregada.ns.getActiveScope().atlasId).toBe(slotUm);
        // E a aba B continua com o padrão dela: o F5 da vizinha não mexeu na instalação.
        expect(slotCorrente()).toBe(criado.atlas.id);
    });

    it('CONTROLE NEGATIVO (LOCAL): aba SEM ponteiro monta o slot da instalação', async () => {
        naAba('A');
        const abaA = await loadStoreFacade();
        await setSession(false);
        await esquemaAtual();
        await abaA.store.initializeWithLastActiveMap();

        naAba('B');
        const abaB = await loadStoreFacade();
        await setSession(false);
        await abaB.store.initializeWithLastActiveMap();
        const local = await import('@store/local-atlas.api.js');
        const criado = await local.createLocalAtlas('Segundo');
        await local.mountLocalAtlas(criado.atlas.id);

        // Aba C, nova em folha: sem memória própria, o ponteiro da instalação é a resposta certa.
        naAba('C');
        const abaC = await loadStoreFacade();
        await setSession(false);
        await abaC.store.initializeWithLastActiveMap();

        expect(abaC.ns.getStore(abaC.ns.StoreName.MAPS).__dbName)
            .toBe(`ebgeo_maps__${criado.atlas.dbSuffix}`);
    });

    it('REMOTO: a aba A volta ao atlas X enquanto o marcador global já diz Y', async () => {
        // Aba A abre o atlas X. O marcador é GLOBAL, então isto é o que a instalação passa a dizer.
        naAba('A');
        const abaA = await loadStoreFacade();
        await setSession(true);
        await esquemaAtual();
        seed(GLOBAL_DATABASE, '__store_origin__', { kind: 'remote', atlasId: ATLAS_A });
        await abaA.store.initializeWithLastActiveMap();
        expect(abaA.ns.getActiveScope()).toEqual(abaA.ns.remoteScope(ATLAS_A));

        // Aba B abre o atlas Y: registra o namespace e reescreve o marcador global.
        naAba('B');
        const abaB = await loadStoreFacade();
        await setSession(true);
        await abaB.store.activateRemoteAtlas(ATLAS_B);
        await abaB.store.markStoreRemote(ATLAS_B);
        expect(readKey(GLOBAL_DATABASE, '__store_origin__')).toEqual({ kind: 'remote', atlasId: ATLAS_B });

        // F5 na aba A. O marcador global diz Y; o que esta aba montou foi X.
        naAba('A');
        const recarregada = await loadStoreFacade();
        await setSession(true);
        await recarregada.store.initializeWithLastActiveMap();

        expect(recarregada.ns.getStore(recarregada.ns.StoreName.MAPS).__dbName)
            .toBe(`ebgeo_maps__remote-${ATLAS_A}`);
        // Registrar ANTES da primeira escrita continua valendo neste caminho: sem a entrada, o
        // wipe do logout não encontraria o namespace que este boot acabou de montar.
        expect(readKey(GLOBAL_DATABASE, remoteAtlasDiskKey(ATLAS_A))).not.toBeNull();
        // E o marcador global segue dizendo Y: quem manda nesta aba é o que ela montou.
        expect(readKey(GLOBAL_DATABASE, '__store_origin__')).toEqual({ kind: 'remote', atlasId: ATLAS_B });
    });

    it('CONTROLE NEGATIVO (REMOTO): aba SEM ponteiro segue o marcador global e monta Y', async () => {
        naAba('A');
        const abaA = await loadStoreFacade();
        await setSession(true);
        await esquemaAtual();
        seed(GLOBAL_DATABASE, '__store_origin__', { kind: 'remote', atlasId: ATLAS_A });
        await abaA.store.initializeWithLastActiveMap();

        naAba('B');
        const abaB = await loadStoreFacade();
        await setSession(true);
        await abaB.store.activateRemoteAtlas(ATLAS_B);
        await abaB.store.markStoreRemote(ATLAS_B);

        naAba('C');
        const abaC = await loadStoreFacade();
        await setSession(true);
        await abaC.store.initializeWithLastActiveMap();

        expect(abaC.ns.getStore(abaC.ns.StoreName.MAPS).__dbName)
            .toBe(`ebgeo_maps__remote-${ATLAS_B}`);
    });
});

// ============================================================================
// 6. O PONTEIRO DA ABA E O MARCADOR NAO PODEM DISCORDAR ATRAVES DE UM F5
//
// `markStoreLocal()` e dito por quem esta DESISTINDO de um atlas de servidor com a sessao
// ainda viva: um connect que falhou (403/404), um atlas excluido no servidor. Se o ponteiro
// desta aba continuasse apontando para aquele namespace, o F5 seguinte remontaria justamente
// o atlas que o chamador acabou de abandonar, e no caminho do connect falho isso e a
// repeticao eterna de um atlas morto que a marcacao existia para impedir.
//
// A PRIMEIRA VERSAO DESTE CASO ERA VERDE-COMO-DEFEITO, e foi a mutacao que a pegou: ela
// desistia do atlas com a sessao ja MORTA, e ali o boot seguinte cai no slot local por outro
// motivo (origem REMOTE sem sessao nao monta namespace de servidor), entao remover o
// esquecimento nao mudava nada. A sessao viva e o que faz o ponteiro decidir sozinho.
// ============================================================================

describe('marcar LOCAL desfaz o ponteiro remoto desta aba', () => {
    beforeEach(() => {
        armazenamentos.clear();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('um connect que falhou nao deixa esta aba voltando ao atlas morto no F5', async () => {
        naAba('A');
        const abaA = await loadStoreFacade();
        await setSession(true);
        await esquemaAtual();
        await abaA.store.initializeWithLastActiveMap();

        // A aba abre o atlas X: registra o namespace, monta, e declara a intencao duravel.
        await abaA.store.activateRemoteAtlas(ATLAS_A);
        await abaA.store.markStoreRemote(ATLAS_A);
        // Assercao POSITIVA antes: sem ela, "esqueceu" e "nunca lembrou" sao o mesmo verde.
        expect(abaA.ns.readTabMountPointer()).toEqual(abaA.ns.remoteScope(ATLAS_A));

        // O connect falha. `openRemoteAtlas` reverte a origem para LOCAL, com a sessao viva.
        await abaA.store.markStoreLocal();
        expect(readKey(GLOBAL_DATABASE, '__store_origin__')).toEqual({ kind: 'local', atlasId: null });

        // F5, com a sessao ainda viva: e aqui que o ponteiro decidiria sozinho.
        naAba('A');
        const recarregada = await loadStoreFacade();
        await setSession(true);
        await recarregada.store.initializeWithLastActiveMap();

        expect(recarregada.ns.getActiveScope().kind).toBe('local');
        expect(recarregada.ns.getStore(recarregada.ns.StoreName.MAPS).__dbName).not.toContain('remote-');
    });

    it('CONTROLE: sem a desistencia, o MESMO F5 volta ao atlas X', async () => {
        // O mesmo roteiro sem o `markStoreLocal`, para que o verde acima nao possa ser lido
        // como "este boot nunca monta atlas remoto".
        naAba('A');
        const abaA = await loadStoreFacade();
        await setSession(true);
        await esquemaAtual();
        await abaA.store.initializeWithLastActiveMap();
        await abaA.store.activateRemoteAtlas(ATLAS_A);
        await abaA.store.markStoreRemote(ATLAS_A);

        naAba('A');
        const recarregada = await loadStoreFacade();
        await setSession(true);
        await recarregada.store.initializeWithLastActiveMap();

        expect(recarregada.ns.getStore(recarregada.ns.StoreName.MAPS).__dbName)
            .toBe(`ebgeo_maps__remote-${ATLAS_A}`);
    });

    it('o slot LOCAL adotado pelo resgate NAO e esquecido por marcar LOCAL', async () => {
        // O resgate move a reivindicacao e zero bytes, entao o slot local carrega o sufixo
        // `remote-<id>`. Esquece-lo aqui mandaria o proximo boot para outro slot enquanto o
        // trabalho resgatado fica fechado, que e a perda que o resgate existe para evitar.
        naAba('A');
        const abaA = await loadStoreFacade();
        await setSession(false);
        await esquemaAtual();
        await abaA.store.initializeWithLastActiveMap();

        const adotado = abaA.ns.localScope('slot-resgatado', `remote-${ATLAS_A}`);
        abaA.ns.activateScope(adotado);
        await abaA.store.markStoreLocal();

        expect(abaA.ns.readTabMountPointer()).toEqual(adotado);
    });
});

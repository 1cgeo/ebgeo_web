// Path: tests/integration/marcador-remote-orfao-no-boot-deslogado.test.js

/**
 * @fileoverview O marcador REMOTE ORFAO sobre os bancos SEM SUFIXO, e o que o boot deslogado
 * faz com ele.
 *
 * O DEFEITO, MEDIDO NO NAVEGADOR EM 2026-09-07 (achado D4 da bancada escalada, cenario C9). Com
 * `{kind:'remote', atlasId:X}` gravado no banco global e X fora do registro remoto,
 * `enforceLocalStoreWhenLoggedOut` (`src/js/store/store.js`) faz o segundo expurgo cair sobre o
 * escopo ativo, que nesse instante do boot e a PONTE LEGADA, ou seja os bancos sem sufixo, ou
 * seja o slot local #1 do usuario: 639 de 647 registros apagados, 805 feicoes viram 0, zero
 * linha de console e nada na tela. O estado de disco e o que um logout interrompido deixa
 * (a aba morre entre a varredura e o `markStoreLocal`, uma linha depois), e tambem o que um
 * marcador gravado por engano deixa.
 *
 * O QUE ESTE ARQUIVO PRENDE. O segundo expurgo NAO roda quando o sufixo vazio esta REIVINDICADO
 * por uma entrada LOCAL do registro global (`readLocalAtlasRegistry()` com `dbSuffix === ''`).
 * A razao e de construcao, e esta conferida na fonte:
 *
 *   - `initLocalAtlases` (`local-atlas.api.js`) so adota os bancos sem sufixo com
 *     `adoptLegacy = !isRemoteOrigin`, isto e, num boot de origem LOCAL;
 *   - o unico outro caller que passa `adoptLegacyDatabases: true` e o degrau 3.0
 *     (`v2.x-to-v3.0.migration.js`), e nele a adocao vem DEPOIS de `discardRemoteResidue`;
 *   - `createLocalAtlas` e `adoptRemoteAtlasAsLocal` nunca escrevem sufixo vazio (um usa o id,
 *     o outro o `remote-<id>`);
 *   - `markStoreRemote` (`store-origin.js`) EXIGE que a aba tenha montado o namespace daquele
 *     atlas, entao nenhum caminho vivo declara REMOTE com os bancos sem sufixo montados.
 *
 * Logo o sufixo vazio reivindicado e dado LOCAL, e o residuo de servidor so pode viver em
 * namespace COM sufixo, que a varredura de `discardRemoteAtlasNamespaces` ja tratou.
 *
 * POR QUE A PERGUNTA E FEITA AQUI E NAO NO MARCADOR. `store-origin.js` (linhas do
 * `reconcileWithRegistry`) registra que a variante "existe algum registro local" foi TENTADA e
 * reprovou dois casos da fixture 2.2, porque o boot bootstrapa um slot antes de a migracao
 * reler a origem, e a mesma instalacao respondia diferente nas duas leituras. Aqui a leitura e
 * unica e acontece ANTES de `activateBootAtlasScope`, que e quem cria a entrada de sufixo
 * vazio; o controle (a) abaixo e quem prova isso, porque uma pergunta feita uma linha depois
 * responderia "reivindicado" tambem para a instalacao pre-namespace e o expurgo que importa
 * nunca mais rodaria.
 *
 * A SEQUENCIA E A REAL, com `enforceLocalStoreWhenLoggedOut` DENTRO dela. O irmao
 * `migracao-22-para-23-fixture-real.test.js` deixa a guarda de fora de proposito (la o sujeito
 * e a migracao, e a guarda pede `sessionContext`); aqui ela e o sujeito, entao o boot chamado e
 * `initializeWithLastActiveMap()` inteiro, com a sessao fingida DESLOGADA.
 *
 * AS CONTAGENS SAO CRUAS, por nome ABSOLUTO de banco (`tests/helpers/idb-helpers.js`), e o
 * insumo e a fixture de producao da outra linha (`03-completo-2.4.ebgeo`, 14 mapas, 805
 * feicoes, 149 PNG), nunca um mock do que um disco 2.4 pareceria.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    countKeys,
    readDatabase,
    readKey,
    resetIndexedDB,
    seedDatabase
} from '../helpers/idb-helpers.js';
import {
    buildLegacyEntries,
    countFixture,
    LEGACY_STORE_IDS,
    loadEbgeoFixture
} from '../helpers/ebgeo-fixture.js';

/** O que a fixture 2.4 declara, escrito em vez de derivado (o README dela e a fonte). */
const DECLARADO_2_4 = Object.freeze({ maps: 14, features: 805, images: 149, briefings: 2 });

/** Nome do slot que o degrau 3.0 deixa no registro: o do usuario, nunca "Meu Atlas". */
const NOME_DO_SLOT = 'Atlas do Chefe';

/** Id do slot no registro global, fixo para o nome absoluto dos bancos ser conhecido. */
const SLOT_DESTA_LINHA = 'slot-desta-linha';

/** O atlas que o marcador nomeia e que NAO esta em registro nenhum. */
const ATLAS_ORFAO = 'cccccccc-3333-4444-8555-666666666666';

/** Um atlas de servidor que ESTA registrado, para o controle (b). */
const ATLAS_REGISTRADO = 'dddddddd-4444-4555-8666-777777777777';

/**
 * Os nomes absolutos dos bancos SEM SUFIXO, construidos pelo `resolveDbName` do app e
 * conferidos aqui, para que a premissa de cada caso ("estes sao os bancos pre-namespace")
 * seja checada em cada caso e nao suposta.
 * @param {Object} ns - O modulo `atlas-namespace.js` ja carregado.
 * @returns {Object<string, string>} Nomes por valor de `StoreName`.
 */
function nomesLegados(ns) {
    const escopo = ns.localScope('legacy-workspace', ns.LEGACY_DB_SUFFIX);
    const nomes = {};
    for (const id of Object.values(ns.StoreName)) {
        if (id === ns.StoreName.GLOBAL || id === ns.StoreName.OPERATION_QUEUE) continue;
        nomes[id] = ns.resolveDbName(id, escopo);
    }
    expect(nomes.maps).toBe('ebgeo_maps');
    expect(nomes.settings).toBe('ebgeo_app_settings');
    expect(nomes.images).toBe('ebgeo_images');
    return nomes;
}

/**
 * Semeia o disco do cenario: a fixture 2.4 nos bancos sem sufixo, mais o que o caso pedir no
 * banco global.
 *
 * @param {Object} [options]
 * @param {boolean} [options.comRegistroGlobal=true] - Se o registro global reivindica o sufixo
 *   vazio, que e como o degrau 3.0 deixa a instalacao.
 * @param {{kind: string, atlasId: string|null}|null} [options.marcador] - Marcador de origem.
 * @param {string|null} [options.remotoRegistrado=null] - Atlas de servidor a registrar, com os
 *   dez bancos do namespace dele semeados.
 * @returns {Promise<{nomes: Object<string, string>, ns: Object}>}
 */
async function semear({
    comRegistroGlobal = true,
    marcador = { kind: 'remote', atlasId: ATLAS_ORFAO },
    remotoRegistrado = null
} = {}) {
    const ns = await import('@store/atlas-namespace.js');
    const nomes = nomesLegados(ns);

    const entradas = buildLegacyEntries(await loadEbgeoFixture('03-completo-2.4.ebgeo'), {
        schemaVersion: '2.4',
        atlasName: NOME_DO_SLOT
    });
    for (const id of LEGACY_STORE_IDS) await seedDatabase(nomes[id], entradas[id]);

    const global = {};
    if (comRegistroGlobal) {
        global[ns.localAtlasRegistryKey(SLOT_DESTA_LINHA)] = {
            name: NOME_DO_SLOT, dbSuffix: ns.LEGACY_DB_SUFFIX, createdAt: 1, updatedAt: 1
        };
        global[ns.GlobalKey.CURRENT_LOCAL_ATLAS] = SLOT_DESTA_LINHA;
    }
    if (marcador) global[ns.GlobalKey.STORE_ORIGIN] = marcador;
    if (remotoRegistrado) {
        global[ns.remoteAtlasRegistryKey(remotoRegistrado)] = {
            atlasId: remotoRegistrado,
            dbSuffix: ns.remoteScope(remotoRegistrado).dbSuffix,
            createdAt: 1,
            updatedAt: 1
        };
    }
    await seedDatabase('ebgeo_global', global);

    if (remotoRegistrado) {
        const escopo = ns.remoteScope(remotoRegistrado);
        await seedDatabase(ns.resolveDbName(ns.StoreName.MAPS, escopo), {
            'mapa-do-servidor': { id: 'mapa-do-servidor', features: {} }
        });
    }

    return { nomes, ns };
}

/**
 * O boot REAL, deslogado, com o grafo de modulos novo.
 *
 * `initializeWithLastActiveMap` e a sequencia inteira, e e ela que este arquivo mede:
 * `enforceLocalStoreWhenLoggedOut` -> `activateBootAtlasScope` -> `initializeRepository`.
 * Reimportar tudo antes nao e decoracao: `atlas-namespace.js` guarda o escopo ativo,
 * `local-atlas.api.js` o espelho do registro e `store-origin.js` o espelho da origem, todos
 * como estado de modulo.
 *
 * @param {Object} [options]
 * @param {boolean} [options.isAuthenticated=false] - Se ha sessao viva.
 * @returns {Promise<{ns: Object, linhas: string[]}>}
 */
async function bootar({ isAuthenticated = false } = {}) {
    vi.resetModules();
    const { initServices } = await import('@store/services.js');
    initServices();
    const { sessionContext } = await import('@store/sync/session-context.js');
    vi.spyOn(sessionContext, 'isAuthenticated').mockReturnValue(isAuthenticated);
    const store = await import('@store/store.js');
    const ns = await import('@store/atlas-namespace.js');

    const linhas = [];
    const registra = (...args) => { if (typeof args[0] === 'string') linhas.push(args[0]); };
    const spyLog = vi.spyOn(console, 'log').mockImplementation(registra);
    const spyInfo = vi.spyOn(console, 'info').mockImplementation(registra);
    const spyWarn = vi.spyOn(console, 'warn').mockImplementation(registra);
    try {
        await store.initializeWithLastActiveMap();
    } finally {
        spyLog.mockRestore();
        spyInfo.mockRestore();
        spyWarn.mockRestore();
    }
    return { ns, linhas };
}

/**
 * O que sobrou nos bancos sem sufixo, contado CRU por nome absoluto.
 *
 * Os NOMES DOS MAPAS entram no inventario de proposito: depois de um expurgo o boot semeia um
 * mapa em branco, entao `mapas: 1` e "apagado e recomecado", nao "nada aconteceu". Contar so
 * chaves faria os dois desfechos parecerem parecidos demais.
 *
 * @param {Object<string, string>} nomes - Nomes absolutos.
 * @returns {Promise<Object>}
 */
async function inventario(nomes) {
    const mapas = (await readDatabase(nomes.maps)) ?? {};
    let feicoes = 0;
    for (const registro of Object.values(mapas)) {
        for (const lista of Object.values(registro?.features ?? {})) {
            if (Array.isArray(lista)) feicoes += lista.length;
        }
    }
    const registroDeAtlas = await readKey(nomes.atlas, 'current_atlas');
    return {
        mapas: Object.keys(mapas).length,
        nomesDeMapa: Object.keys(mapas).sort(),
        feicoes,
        imagens: (await countKeys(nomes.images)) ?? 0,
        briefings: (await countKeys(nomes.briefings)) ?? 0,
        nomeDoAtlas: registroDeAtlas?.name ?? null
    };
}

/**
 * As CHAVES de cada um dos nove bancos sem sufixo, por nome ABSOLUTO de banco.
 *
 * O inventario acima conta o que a interface mostra; este e o denominador cru, e e ele que
 * responde "PERDIDOS = 0". A comparacao correta e de INCLUSAO e nao de igualdade: o boot ACRE-
 * SCENTA chaves de proposito (`lastActiveMap`, o carimbo de esquema), e exigir contagem igual
 * transformaria uma escrita legitima em vermelho enquanto uma perda compensada por uma escrita
 * passaria despercebida.
 *
 * @param {Object<string, string>} nomes - Nomes absolutos.
 * @returns {Promise<Object<string, string[]>>} Chaves por nome de banco.
 */
async function chavesPorBanco(nomes) {
    const saida = {};
    for (const storeId of LEGACY_STORE_IDS) {
        const banco = nomes[storeId];
        saida[banco] = Object.keys((await readDatabase(banco)) ?? {}).sort();
    }
    return saida;
}

/**
 * As chaves que existiam antes e sumiram, por banco. Vazio e o que a regua exige.
 * @param {Object<string, string[]>} antes
 * @param {Object<string, string[]>} depois
 * @returns {Object<string, string[]>} So os bancos que perderam alguma coisa.
 */
function perdidasPorBanco(antes, depois) {
    const perdas = {};
    for (const [banco, chaves] of Object.entries(antes)) {
        const sobreviventes = new Set(depois[banco] ?? []);
        const sumiram = chaves.filter(chave => !sobreviventes.has(chave));
        if (sumiram.length > 0) perdas[banco] = sumiram;
    }
    return perdas;
}

/** @param {string[]} linhas @returns {string[]} As que anunciam o marcador orfao ignorado. */
function linhasDoOrfao(linhas) {
    return linhas.filter(l => l.includes('marcador REMOTE orfao'));
}

beforeEach(async () => {
    vi.resetModules();
    await resetIndexedDB();
});

afterEach(async () => {
    vi.restoreAllMocks();
    await resetIndexedDB();
});

describe('a fixture 2.4 declara o que este arquivo assume', () => {
    it('14 mapas, 805 feicoes, 149 PNG e 2 briefings', async () => {
        const contado = countFixture(await loadEbgeoFixture('03-completo-2.4.ebgeo'));
        expect(contado).toMatchObject(DECLARADO_2_4);
    });
});

describe('marcador REMOTE orfao sobre bancos sem sufixo REIVINDICADOS pelo registro', () => {
    it('o acervo estava mesmo la antes do boot (assercao positiva do "antes")', async () => {
        const { nomes } = await semear();
        expect(await inventario(nomes)).toMatchObject({
            mapas: DECLARADO_2_4.maps,
            feicoes: DECLARADO_2_4.features,
            imagens: DECLARADO_2_4.images,
            briefings: DECLARADO_2_4.briefings,
            nomeDoAtlas: NOME_DO_SLOT
        });
    });

    it('PERDIDOS = 0: o boot deslogado nao apaga um registro sequer', async () => {
        const { nomes } = await semear();
        const antes = await inventario(nomes);
        const chavesAntes = await chavesPorBanco(nomes);

        await bootar();

        // A regua principal, crua e por nome absoluto de banco, nos NOVE.
        expect(perdidasPorBanco(chavesAntes, await chavesPorBanco(nomes))).toEqual({});
        // E o que a interface mostra, que e o que o usuario veria sumir.
        const depois = await inventario(nomes);
        expect(depois.mapas).toBe(antes.mapas);
        expect(depois.nomesDeMapa).toEqual(antes.nomesDeMapa);
        expect(depois.feicoes).toBe(antes.feicoes);
        expect(depois.imagens).toBe(antes.imagens);
        expect(depois.briefings).toBe(antes.briefings);
    });

    // CONTROLE DO INSTRUMENTO, e ele nao mede o boot: mede o comparador. Sem isto,
    // `perdidasPorBanco` devolvendo `{}` sempre daria o mesmo verde acima.
    it('INSTRUMENTO: o comparador de perdas REPROVA quando uma chave some', async () => {
        const { nomes } = await semear();
        const chavesAntes = await chavesPorBanco(nomes);
        const degenerado = { ...chavesAntes };
        degenerado[nomes.maps] = chavesAntes[nomes.maps].slice(1);

        const perdas = perdidasPorBanco(chavesAntes, degenerado);

        expect(Object.keys(perdas)).toEqual([nomes.maps]);
        expect(perdas[nomes.maps]).toEqual([chavesAntes[nomes.maps][0]]);
        // e a inclusao nao e igualdade: um banco que GANHOU chave nao conta como perda
        expect(perdidasPorBanco(chavesAntes, {
            ...chavesAntes,
            [nomes.settings]: [...chavesAntes[nomes.settings], 'chave_nova_do_boot']
        })).toEqual({});
    });

    it('o marcador termina LOCAL, que e o que o proximo boot le', async () => {
        const { ns } = await semear();

        await bootar();

        expect(await readKey('ebgeo_global', ns.GlobalKey.STORE_ORIGIN))
            .toMatchObject({ kind: 'local' });
    });

    it('o boot escreve UMA linha dizendo por que ignorou o marcador, e nomeia o slot', async () => {
        await semear();

        const { linhas } = await bootar();

        const doOrfao = linhasDoOrfao(linhas);
        expect(doOrfao).toHaveLength(1);
        expect(doOrfao[0]).toContain(ATLAS_ORFAO);
        expect(doOrfao[0]).toContain(NOME_DO_SLOT);
    });

    it('o slot reivindicado continua sendo o montado, com o nome do usuario', async () => {
        const { ns: ns0 } = await semear();

        const { ns } = await bootar();

        expect(ns.getActiveScope().dbSuffix).toBe(ns0.LEGACY_DB_SUFFIX);
        const registro = await readKey('ebgeo_global', ns.localAtlasRegistryKey(SLOT_DESTA_LINHA));
        expect(registro).toMatchObject({ name: NOME_DO_SLOT, dbSuffix: '' });
    });

    it('marcador REMOTE SEM atlasId cai na mesma guarda: ele nomeia namespace nenhum', async () => {
        // O eixo que sairia aprovado por omissao. `purgeReachedAtlas` ja respondia false para um
        // marcador sem id, entao antes desta guarda ele tambem levava o expurgo aos bancos sem
        // sufixo, e a evidencia contra o expurgo aqui e ainda mais fraca: nao ha nem atlas a
        // nomear.
        const { nomes } = await semear({ marcador: { kind: 'remote', atlasId: null } });
        const antes = await inventario(nomes);

        const { linhas } = await bootar();

        expect(await inventario(nomes)).toMatchObject({
            mapas: antes.mapas, feicoes: antes.feicoes, imagens: antes.imagens
        });
        expect(linhasDoOrfao(linhas)).toHaveLength(1);
    });
});

describe('os controles: o que a guarda nova NAO pode ter afrouxado', () => {
    it('(a) mesmo disco SEM registro global (pre-namespace) continua sendo expurgado', async () => {
        // O controle que mais importa, e o que prende o INSTANTE da pergunta: `initLocalAtlases`
        // escreve a entrada de sufixo vazio como efeito colateral, uma linha depois da guarda.
        // Se a pergunta fosse feita ali, esta instalacao responderia "reivindicado" tambem e o
        // expurgo que existe para ela nunca mais rodaria.
        const { nomes } = await semear({ comRegistroGlobal: false });
        const antes = await inventario(nomes);
        const chavesAntes = await chavesPorBanco(nomes);
        expect(antes.mapas).toBe(DECLARADO_2_4.maps);
        expect(antes.feicoes).toBe(DECLARADO_2_4.features);

        const { linhas } = await bootar();

        // Pelo MESMO instrumento do caso principal, e com o sinal invertido: aqui a perda e o
        // desfecho certo, e o numero e o denominador inteiro dos bancos de dado.
        const perdas = perdidasPorBanco(chavesAntes, await chavesPorBanco(nomes));
        expect(perdas[nomes.images]).toHaveLength(DECLARADO_2_4.images);
        expect(perdas[nomes.briefings]).toHaveLength(DECLARADO_2_4.briefings);
        const depois = await inventario(nomes);
        expect(depois.feicoes).toBe(0);
        expect(depois.imagens).toBe(0);
        expect(depois.briefings).toBe(0);
        // Dos 14 mapas restou UM, e vazio: e o mapa em branco que o repositorio semeia depois
        // do expurgo, nao o do usuario. O nome coincide com um dos 14 ("Principal" e o mapa
        // padrao das duas linhas), e por isso a assercao e sobre a CONTAGEM e sobre as feicoes,
        // nunca sobre o nome sobreviver.
        expect(antes.nomesDeMapa).toHaveLength(DECLARADO_2_4.maps);
        expect(depois.nomesDeMapa).toEqual(['Principal']);
        expect(linhasDoOrfao(linhas)).toEqual([]);
    });

    it('(b) marcador REMOTE cujo atlas AINDA esta registrado segue o caminho normal', async () => {
        // `purgeReachedAtlas` responde true (o atlas tem entrada no registro remoto), entao o
        // segundo expurgo ja era pulado por outra razao: a linha nova nao pode aparecer aqui,
        // senao ela deixa de dizer o que diz.
        const { nomes, ns: ns0 } = await semear({
            marcador: { kind: 'remote', atlasId: ATLAS_REGISTRADO },
            remotoRegistrado: ATLAS_REGISTRADO
        });
        const antes = await inventario(nomes);
        const bancoRemoto = ns0.resolveDbName(ns0.StoreName.MAPS, ns0.remoteScope(ATLAS_REGISTRADO));
        expect(await countKeys(bancoRemoto)).toBe(1);

        const { ns, linhas } = await bootar();

        // o namespace do servidor foi destruido, que e o trabalho da PRIMEIRA guarda. O banco
        // pode ter sido DERRUBADO em vez de esvaziado, e `countKeys` devolve null nesse caso:
        // as duas formas contam como zero, e distingui-las nao e assunto deste arquivo.
        expect(await readKey('ebgeo_global', ns.remoteAtlasRegistryKey(ATLAS_REGISTRADO))).toBeNull();
        expect((await countKeys(bancoRemoto)) ?? 0).toBe(0);
        // e o acervo local continua inteiro, sem a linha nova
        expect(await inventario(nomes)).toMatchObject({
            mapas: antes.mapas, feicoes: antes.feicoes, imagens: antes.imagens
        });
        expect(linhasDoOrfao(linhas)).toEqual([]);
    });

    it('(c) marcador LOCAL nao toca em nada, e a guarda nem chega a perguntar', async () => {
        const { nomes } = await semear({ marcador: { kind: 'local', atlasId: null } });
        const antes = await inventario(nomes);

        const { linhas } = await bootar();

        expect(await inventario(nomes)).toMatchObject({
            mapas: antes.mapas,
            nomesDeMapa: antes.nomesDeMapa,
            feicoes: antes.feicoes,
            imagens: antes.imagens
        });
        expect(linhasDoOrfao(linhas)).toEqual([]);
    });

    it('(d) com SESSAO VIVA a guarda inteira nao roda, e o marcador REMOTE fica de pe', async () => {
        // Controle do controle: se a sessao deixasse de ser consultada, os casos acima ficariam
        // verdes por um motivo que nao e o deles.
        const { ns } = await semear({
            marcador: { kind: 'remote', atlasId: ATLAS_REGISTRADO },
            remotoRegistrado: ATLAS_REGISTRADO
        });

        await bootar({ isAuthenticated: true });

        expect(await readKey('ebgeo_global', ns.GlobalKey.STORE_ORIGIN))
            .toMatchObject({ kind: 'remote', atlasId: ATLAS_REGISTRADO });
    });
});

// Path: tests/integration/degrau-3.0-entradas-da-transicao.test.js

/**
 * @fileoverview As QUATRO entradas que chegam ao degrau 3.0, e a que nao devia existir.
 *
 * O esquema desta linha passou de 2.3 para 3.0 em 2026-09-07 porque o numero 2.3 significava
 * DUAS coisas: na outra linha do produto ele criou o balde `coordination_lines`, aqui ele
 * registrou o primeiro atlas local nomeado. A outra linha seguiu para 2.4, numero que esta
 * nunca teve. Como `detectMigrationNeeded` compara NUMERO, um repositorio carimbado 2.3 ou 2.4
 * la respondia "ja esta na versao corrente" aqui, e a adocao nunca corria, sem erro e sem log.
 *
 * Este arquivo mede as entradas de verdade, com os arquivos `.ebgeo` que o app da outra linha
 * produziu, pela SEQUENCIA REAL DO BOOT, e cada caso boota DUAS VEZES:
 *
 *     loadStoreOrigin -> observeLegacyInstallation -> initLocalAtlases -> initializeRepository
 *
 * O segundo boot e metade da regua, nao um capricho. O jeito barato de "subir para 3.0" e mexer
 * so na constante, e ele passa em qualquer teste de um boot so: o disco fica em 2.4, o detector
 * pede migracao, nenhum degrau corre, `safelyMigrate` loga "Migration completed successfully" e
 * o boot seguinte pede tudo de novo, para sempre. Medido assim em 2026-09-07. So a CONVERGENCIA
 * reprova esse desenho.
 *
 * O QUE CADA ENTRADA TEM DE FORMA, e por que o ramo se decide pelo REGISTRO GLOBAL:
 *
 *   | entrada                | settings | registro de atlas | entrada com dbSuffix '' |
 *   |------------------------|----------|-------------------|-------------------------|
 *   | 2.2 da outra linha     | '2.2'    | '2.2'             | ausente                 |
 *   | 2.3 da outra linha     | '2.3'    | '2.3'             | ausente                 |
 *   | 2.4 da outra linha     | '2.4'    | '2.4'             | ausente                 |
 *   | 2.3 DESTA linha        | '2.3'    | '2.3'             | PRESENTE                |
 *   | banco misturado        | '2.4'    | '2.4'             | PRESENTE                |
 *
 * As duas linhas do meio sao indistinguiveis pelo numero, e a ultima e o pior caso: o estado que
 * a propria transicao produz se o usuario 2.4 entrar aqui com o build de hoje e a versao subir
 * depois. Ela tem de sair SO CARIMBADA, sem adocao nova e sem slot novo.
 *
 * E A ENTRADA QUE NAO DEVIA EXISTIR e o "1.7": o "Limpar Todos os Dados" da outra linha carimba
 * a constante LEGADA dela no settings e NAO limpa o registro de atlas, entao o par que chega
 * aqui e settings '1.7' com registro '2.4'. Lido ao pe da letra isso reinicia a cadeia no
 * `migrateToV2`, que renumera toda feicao; `ebgeo_images` e chaveado pelo id da feicao e nada
 * naquele degrau reescreve o banco de imagens. Medido antes do conserto, sobre a fixture de
 * producao: 805 feicoes preservadas, 0 ids sobreviventes, 146 blobs alcancaveis virando 0.
 *
 * LEITURA DUPLA, como no arquivo irmao `migracao-22-para-23-fixture-real.test.js`: o que
 * sobreviveu e contado no banco CRU, por nome absoluto, e o que a tela leria vem do registro de
 * slots. Uma contagem que so se compara consigo mesma passa com o banco vazio.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
    countKeys,
    listDatabases,
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
import { ATLAS_SCHEMA_VERSION } from '@store/atlas/atlas.entity.js';

/**
 * O que a fixture de producao declara. Escrito, nunca derivado, para que uma fixture trocada
 * apareca aqui em vez de redefinir em silencio o que "sobreviveu" quer dizer.
 */
const DECLARADO_2_4 = Object.freeze({
    schemaVersion: '2.4',
    maps: 14,
    features: 805,
    layers: 21,
    groups: 3,
    briefings: 2,
    slides: 7,
    customIcons: 3,
    images: 149
});

/** Ids de feicao alcancaveis por algum blob, medidos na propria fixture. */
const BLOBS_ALCANCAVEIS = 146;

/** Nome que o usuario deu ao atlas dele, diferente do padrao de fabrica. */
const NOME_DO_USUARIO = 'Atlas do Chefe';

/**
 * O arquivo `.ebgeo` ja aberto, por nome.
 *
 * A fixture 2.4 tem 1,2 MB e cada abertura desmascara o XOR e descompacta o ZIP inteiro; sao
 * mais de vinte casos aqui, e o custo disso NAO fica so neste arquivo: medido, ele empurrou um
 * vizinho que boota a fachada da store (`boot-escopo-de-atlas.test.js`) para alem do limite de
 * 5 s do vitest, uma vez em dez execucoes da pasta inteira. Nada muta o objeto guardado, e a
 * semeadura clona na escrita (localforage), entao o cache nao acopla um caso ao seguinte.
 * @type {Map<string, Promise<{data: Object, images: Map<string, Uint8Array>}>>}
 */
const arquivosAbertos = new Map();

/**
 * @param {string} nome - Arquivo em `tests/fixtures/ebgeo-2.2/`.
 * @returns {Promise<{data: Object, images: Map<string, Uint8Array>}>}
 */
function abrirFixture(nome) {
    if (!arquivosAbertos.has(nome)) arquivosAbertos.set(nome, loadEbgeoFixture(nome));
    return arquivosAbertos.get(nome);
}

/**
 * Nomes absolutos dos bancos pre-namespace, conferidos a cada uso.
 *
 * A premissa ("estes sao os bancos sem sufixo") e CHECADA em cada cenario em vez de lembrada:
 * o cenario que nao a checava so ficou vermelho pela assercao de resultado quando outro agente
 * mexeu em `atlas-namespace.js`, sem nada dizendo que o instrumento tinha se mudado.
 * @param {Object} ns - Modulo `atlas-namespace.js` recem-importado.
 * @returns {Object<string, string>}
 */
function nomesLegados(ns) {
    const nomes = {};
    for (const id of Object.values(ns.StoreName)) {
        if (id === ns.StoreName.GLOBAL || id === ns.StoreName.OPERATION_QUEUE) continue;
        nomes[id] = ns.resolveDbName(id, ns.localScope('legacy-workspace', ns.LEGACY_DB_SUFFIX));
    }
    expect(nomes.maps).toBe('ebgeo_maps');
    expect(nomes.settings).toBe('ebgeo_app_settings');
    expect(nomes.atlas).toBe('ebgeo_atlas');
    return nomes;
}

/**
 * Escreve no disco uma instalacao com a forma exata de uma das entradas.
 *
 * @param {Object} ns - Modulo `atlas-namespace.js`.
 * @param {Object} opcoes
 * @param {string} opcoes.settings - Carimbo do `ebgeo_app_settings`.
 * @param {string} opcoes.registro - Carimbo do registro de atlas (`current_atlas`).
 * @param {string} [opcoes.nome] - Nome do atlas no registro de atlas.
 * @param {string} [opcoes.arquivo] - Fixture `.ebgeo` a semear.
 * @param {boolean} [opcoes.comRegistroGlobal] - Se o banco global ja reivindica os bancos sem
 *   sufixo, que e a forma de uma instalacao DESTA linha.
 * @param {Object<string, Object>} [opcoes.fila] - Operacoes na fila pre-namespace.
 * @returns {Promise<Object<string, string>>} Nomes absolutos dos bancos legados.
 */
async function semearEntrada(ns, {
    settings,
    registro,
    nome = NOME_DO_USUARIO,
    arquivo = '03-completo-2.4.ebgeo',
    comRegistroGlobal = false,
    fila = null
}) {
    const nomes = nomesLegados(ns);
    const entradas = buildLegacyEntries(await abrirFixture(arquivo), {
        schemaVersion: registro,
        atlasName: nome
    });
    entradas.settings.schemaVersion = settings;
    for (const id of LEGACY_STORE_IDS) await seedDatabase(nomes[id], entradas[id]);

    if (comRegistroGlobal) {
        await seedDatabase('ebgeo_global', {
            'local_atlas:slot-desta-linha': {
                name: nome, dbSuffix: '', createdAt: 1, updatedAt: 1
            },
            current_local_atlas: 'slot-desta-linha'
        });
    }
    if (fila) await seedDatabase('ebgeo', fila, { storeName: 'operation_queue' });
    return nomes;
}

/**
 * O prefixo do boot real que carrega a migracao, com os modulos reimportados.
 *
 * As quatro chamadas sao as de `initializeWithLastActiveMap` (`src/js/store/store.js`), na ordem
 * dela. `observeLegacyInstallation` esta entre a leitura da origem e `initLocalAtlases` porque e
 * o unico instante em que a pergunta do ramo tem resposta: uma linha depois o bootstrap de
 * `initLocalAtlases` ja escreveu a entrada de `dbSuffix` vazio que a pergunta procura. Que o
 * espelho aqui e o codigo la nao divirjam esta preso pelo caso "o boot de verdade toma a mesma
 * leitura", no fim deste arquivo.
 *
 * `migracoes` conta quantas vezes `safelyMigrate` DECIDIU migrar, porque o estado final sozinho
 * nao separa "nao re-rodou" de "re-rodou sem efeito".
 *
 * @param {Object} [options]
 * @param {boolean} [options.isAuthenticated=false] - Se ha sessao viva.
 * @returns {Promise<{ns: Object, migracoes: string[], rodouV2: boolean, linhaDoBoot: string|null,
 *   ramo: string|null}>}
 */
async function bootar({ isAuthenticated = false } = {}) {
    const origin = await import('@store/store-origin.js');
    const adocao = await import('@store/migration/boot-legacy-adoption.js');
    const localAtlas = await import('@store/local-atlas.api.js');
    const repository = await import('@store/repository.js');
    const ns = await import('@store/atlas-namespace.js');

    const linhas = [];
    const registra = (...args) => { if (typeof args[0] === 'string') linhas.push(args[0]); };
    const spyLog = vi.spyOn(console, 'log').mockImplementation(registra);
    const spyInfo = vi.spyOn(console, 'info').mockImplementation(registra);

    let linhaDoBoot = null;
    try {
        await origin.loadStoreOrigin();
        const origem = origin.getStoreOriginSync();
        const observado = await adocao.observeLegacyInstallation(origem);
        await localAtlas.initLocalAtlases({
            origin: origem,
            isAuthenticated,
            preferTabMountPointer: true,
            bootstrapName: observado.bootstrapName
        });
        await repository.initializeRepository();
        linhaDoBoot = await adocao.reportBootAtlasScope();
    } finally {
        spyLog.mockRestore();
        spyInfo.mockRestore();
    }

    const ramo = linhaDoBoot?.match(/degrau ([a-z-]+)/)?.[1] ?? null;
    return {
        ns,
        migracoes: linhas.filter(l => l.startsWith('Migration needed:')),
        rodouV2: linhas.some(l => l.startsWith('Starting migration to v2.0')),
        linhaDoBoot,
        ramo
    };
}

/**
 * Tudo o que decide se a entrada sobreviveu, lido CRU por nome absoluto de banco.
 * @param {Object<string, string>} nomes - Nomes absolutos.
 * @returns {Promise<Object>}
 */
async function inventario(nomes) {
    const mapas = (await readDatabase(nomes.maps)) ?? {};
    const idsDeFeicao = new Set();
    let feicoes = 0;
    for (const registro of Object.values(mapas)) {
        for (const lista of Object.values(registro?.features ?? {})) {
            if (!Array.isArray(lista)) continue;
            for (const f of lista) {
                feicoes += 1;
                if (f?.properties?.id) idsDeFeicao.add(f.properties.id);
            }
        }
    }
    const idsDeBlob = Object.keys((await readDatabase(nomes.images)) ?? {});
    const registroDeAtlas = await readKey(nomes.atlas, 'current_atlas');

    return {
        mapas: Object.keys(mapas).length,
        feicoes,
        idsDeFeicao: [...idsDeFeicao],
        blobs: idsDeBlob.length,
        blobsAlcancaveis: idsDeBlob.filter(id => idsDeFeicao.has(id)).length,
        nomeDoAtlas: registroDeAtlas?.name ?? null,
        carimboDoRegistroDeAtlas: registroDeAtlas?.schemaVersion ?? null,
        carimboDoSettings: await readKey(nomes.settings, 'schemaVersion')
    };
}

/**
 * O registro de slots, que e o que a aba Mapas le para nomear o atlas montado
 * (`sidebar/tabs/maps.tab.js`). Montado das chaves `local_atlas:<id>` (E4: uma chave por slot).
 * @param {Object} ns - Modulo `atlas-namespace.js`.
 * @returns {Promise<Array<Object>>}
 */
async function registroDeSlots(ns) {
    const store = ns.getGlobalStore();
    const saida = [];
    for (const chave of await store.keys()) {
        if (!ns.isLocalAtlasRegistryKey(chave)) continue;
        saida.push({ ...(await store.getItem(chave)), id: ns.atlasIdFromLocalRegistryKey(chave) });
    }
    return saida.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
}

beforeEach(async () => {
    vi.resetModules();
    await resetIndexedDB();
});

afterEach(async () => {
    vi.restoreAllMocks();
    await resetIndexedDB();
});

// ============================================================================================
// A fixture, antes de qualquer conclusao sobre ela
// ============================================================================================

describe('a fixture 2.4 da outra linha declara o que este arquivo assume', () => {
    it('14 mapas, 805 feicoes, 149 PNG, e o carimbo 2.4 no proprio arquivo', async () => {
        const contado = countFixture(await abrirFixture('03-completo-2.4.ebgeo'));
        expect(contado).toMatchObject(DECLARADO_2_4);
        expect(contado.mapNames).toHaveLength(DECLARADO_2_4.maps);
    });

    it('146 dos 149 blobs sao alcancaveis por alguma feicao (a medida que a entrada 1.7 destroi)', async () => {
        const entradas = buildLegacyEntries(await abrirFixture('03-completo-2.4.ebgeo'), {
            schemaVersion: '2.4'
        });
        const ids = new Set();
        for (const registro of Object.values(entradas.maps)) {
            for (const lista of Object.values(registro.features ?? {})) {
                if (Array.isArray(lista)) for (const f of lista) ids.add(f?.properties?.id);
            }
        }
        expect(Object.keys(entradas.images).filter(id => ids.has(id))).toHaveLength(BLOBS_ALCANCAVEIS);
    });
});

// ============================================================================================
// (b) CONVERGENCIA: as quatro entradas, cada uma bootada duas vezes
// ============================================================================================

describe('convergencia: toda entrada alcanca 3.0 e o SEGUNDO boot nao pede nada', () => {
    const ENTRADAS = [
        { rotulo: '2.2 da outra linha', settings: '2.2', registro: '2.2', arquivo: '02-minimo.ebgeo', nome: 'Meu Atlas' },
        { rotulo: '2.3 da outra linha', settings: '2.3', registro: '2.3' },
        { rotulo: '2.4 da outra linha', settings: '2.4', registro: '2.4' },
        { rotulo: '2.3 desta linha', settings: '2.3', registro: '2.3', comRegistroGlobal: true }
    ];

    for (const entrada of ENTRADAS) {
        it(`${entrada.rotulo}: primeiro boot carimba 3.0 nos dois lugares, segundo boot nao migra`, async () => {
            const ns0 = await import('@store/atlas-namespace.js');
            const nomes = await semearEntrada(ns0, entrada);

            vi.resetModules();
            const primeiro = await bootar();
            const depoisDoPrimeiro = await inventario(nomes);

            expect(primeiro.migracoes).toHaveLength(1);
            expect(primeiro.migracoes[0]).toContain(`-> ${ATLAS_SCHEMA_VERSION}`);
            expect(depoisDoPrimeiro.carimboDoSettings).toBe('3.0');
            expect(depoisDoPrimeiro.carimboDoRegistroDeAtlas).toBe('3.0');
            expect(ATLAS_SCHEMA_VERSION).toBe('3.0');

            vi.resetModules();
            const segundo = await bootar();
            const depoisDoSegundo = await inventario(nomes);

            // A METADE QUE REPROVA O "so trocar a constante": nenhuma migracao pedida.
            expect(segundo.migracoes).toEqual([]);
            expect(segundo.ramo).toBe('nenhum');
            expect(depoisDoSegundo.carimboDoSettings).toBe('3.0');
            expect(depoisDoSegundo.carimboDoRegistroDeAtlas).toBe('3.0');

            // Idempotente ate no conteudo: o segundo boot nao mexeu num byte alem do carimbo.
            expect(depoisDoSegundo).toEqual(depoisDoPrimeiro);
        });
    }

    it('a entrada DESTA linha e a da outra tomam ramos DIFERENTES, com o mesmo numero no disco', async () => {
        // O par que prova que o discriminador nao e o numero: as duas entradas abaixo carregam
        // '2.3' no settings e no registro de atlas, e so a forma do registro global as separa.
        const ns0 = await import('@store/atlas-namespace.js');
        await semearEntrada(ns0, { settings: '2.3', registro: '2.3', comRegistroGlobal: true });
        vi.resetModules();
        expect((await bootar()).ramo).toBe('ja-adotado');

        await resetIndexedDB();
        vi.resetModules();
        const ns1 = await import('@store/atlas-namespace.js');
        await semearEntrada(ns1, { settings: '2.3', registro: '2.3', comRegistroGlobal: false });
        vi.resetModules();
        expect((await bootar()).ramo).toBe('adocao-do-legado');
    });
});

// ============================================================================================
// (a) O PIOR CASO: banco misturado, forma desta linha com numero da outra
// ============================================================================================

describe('banco misturado: registro global presente E settings 2.4', () => {
    it('sai SO CARIMBADO, sem adocao nova, sem slot novo e sem banco sufixado', async () => {
        const ns0 = await import('@store/atlas-namespace.js');
        const nomes = await semearEntrada(ns0, {
            settings: '2.4', registro: '2.4', comRegistroGlobal: true
        });
        const antes = await inventario(nomes);
        expect(antes.feicoes).toBe(DECLARADO_2_4.features);

        vi.resetModules();
        const boot = await bootar();
        const { ns } = boot;
        const depois = await inventario(nomes);
        const slots = await registroDeSlots(ns);

        // O ramo foi decidido pelo REGISTRO, nao pelo numero: com '2.4' no settings, um
        // discriminador por numero teria concluido "veio da outra linha" e adotado de novo.
        expect(boot.ramo).toBe('ja-adotado');

        // UM slot, o mesmo de antes, com o mesmo endereco.
        expect(slots).toHaveLength(1);
        expect(slots[0].id).toBe('slot-desta-linha');
        expect(slots[0].dbSuffix).toBe('');

        // Nenhum banco por atlas sufixado nasceu (a adocao e zero-copia; um slot novo criaria).
        const sufixados = (await listDatabases()).filter(n => n.includes('__'));
        expect(sufixados).toEqual([]);

        // E o acervo esta inteiro, com o carimbo movido.
        expect(depois.feicoes).toBe(antes.feicoes);
        expect(depois.idsDeFeicao).toEqual(antes.idsDeFeicao);
        expect(depois.blobsAlcancaveis).toBe(BLOBS_ALCANCAVEIS);
        expect(depois.carimboDoSettings).toBe('3.0');
        expect(depois.carimboDoRegistroDeAtlas).toBe('3.0');
    });
});

// ============================================================================================
// (c) O NOME DO ATLAS DO USUARIO
// ============================================================================================

describe('o nome do atlas sobrevive nas duas casas', () => {
    for (const carimbo of ['2.3', '2.4']) {
        it(`entrada ${carimbo} da outra linha: o nome fica no registro de slots E no record`, async () => {
            const ns0 = await import('@store/atlas-namespace.js');
            const nomes = await semearEntrada(ns0, { settings: carimbo, registro: carimbo });

            vi.resetModules();
            const { ns } = await bootar();

            // A ABA MAPAS LE O REGISTRO DE SLOTS (`maps.tab.js`, `getLocalAtlas(id)?.name`), e e
            // exatamente onde o nome se perdia: o bootstrap batizava o slot de "Meu Atlas" antes
            // de qualquer degrau, e o degrau alinhava o RECORD ao registro, apagando a unica
            // copia do nome do usuario.
            const slots = await registroDeSlots(ns);
            expect(slots).toHaveLength(1);
            expect(slots[0].name).toBe(NOME_DO_USUARIO);

            // E o record continua com ele: o alinhamento agora vai do record para o registro.
            expect((await inventario(nomes)).nomeDoAtlas).toBe(NOME_DO_USUARIO);
        });
    }

    it('uma entrada que JA atravessou com o build antigo tem o nome RECUPERADO pelo degrau', async () => {
        // O estado que o build de hoje deixa no disco: registro de slots dizendo "Meu Atlas",
        // record ainda com o nome verdadeiro. E o unico ponto do desenho em que dado perdido
        // volta, e por isso ele e medido separado da prevencao acima.
        const ns0 = await import('@store/atlas-namespace.js');
        const nomes = await semearEntrada(ns0, { settings: '2.4', registro: '2.4' });
        await seedDatabase('ebgeo_global', {
            'local_atlas:slot-ja-adotado': {
                name: 'Meu Atlas', dbSuffix: '', createdAt: 1, updatedAt: 1
            },
            current_local_atlas: 'slot-ja-adotado'
        });

        vi.resetModules();
        const { ns, linhaDoBoot } = await bootar();

        const slots = await registroDeSlots(ns);
        expect(slots).toHaveLength(1);
        expect(slots[0].name).toBe(NOME_DO_USUARIO);
        expect((await inventario(nomes)).nomeDoAtlas).toBe(NOME_DO_USUARIO);
        expect(linhaDoBoot).toContain(`nome recuperado: "${NOME_DO_USUARIO}"`);
    });

    it('com origem REMOTE o slot novo NAO herda o nome do atlas de servidor residual', async () => {
        // O outro sentido do mesmo erro, e ele nasceu deste conserto: se o boot oferecesse o
        // nome lido do registro de atlas SEM olhar a origem, um boot autenticado sobre residuo
        // de servidor batizaria um slot local NOVO e VAZIO com o nome do projeto de outra gente.
        // Com origem REMOTE o bootstrap nao adota os bancos sem sufixo, entao o nome deles nao
        // tem nada a ver com o slot criado.
        const ns0 = await import('@store/atlas-namespace.js');
        await semearEntrada(ns0, { settings: '2.4', registro: '2.4', nome: '2a Bda C Mec - Cerrado' });
        await seedDatabase('ebgeo_global', {
            __store_origin__: { kind: 'remote', atlasId: 'atlas-do-servidor' }
        });

        vi.resetModules();
        const { ns } = await bootar({ isAuthenticated: true });

        const slots = await registroDeSlots(ns);
        expect(slots).toHaveLength(1);
        expect(slots[0].name).toBe('Meu Atlas');
        expect(slots[0].dbSuffix).not.toBe('');
    });

    it('um atlas que ja se chama "Meu Atlas" nao e renomeado nem duplicado', async () => {
        const ns0 = await import('@store/atlas-namespace.js');
        const nomes = await semearEntrada(ns0, { settings: '2.4', registro: '2.4', nome: 'Meu Atlas' });

        vi.resetModules();
        const { ns, linhaDoBoot } = await bootar();

        expect((await registroDeSlots(ns)).map(s => s.name)).toEqual(['Meu Atlas']);
        expect((await inventario(nomes)).nomeDoAtlas).toBe('Meu Atlas');
        // Controle: sem discordancia nao ha recuperacao, e a linha do boot nao inventa uma.
        expect(linhaDoBoot).not.toContain('nome recuperado');
    });
});

// ============================================================================================
// (d) A ENTRADA 1.7, com os blobs
// ============================================================================================

describe('entrada 1.7: settings de v1 sobre um registro de atlas 2.x', () => {
    it('nao roda o degrau v1, e os 805 ids e os 146 blobs alcancaveis saem intactos', async () => {
        const ns0 = await import('@store/atlas-namespace.js');
        const nomes = await semearEntrada(ns0, { settings: '1.7', registro: '2.4' });

        const antes = await inventario(nomes);
        expect(antes.idsDeFeicao).toHaveLength(DECLARADO_2_4.features);
        expect(antes.blobsAlcancaveis).toBe(BLOBS_ALCANCAVEIS);

        vi.resetModules();
        const boot = await bootar();
        const depois = await inventario(nomes);

        // O DEGRAU QUE RENUMERA NAO CORREU. Sem esta linha as tres abaixo passariam por
        // acidente num repositorio vazio.
        expect(boot.rodouV2).toBe(false);
        expect(depois.idsDeFeicao).toEqual(antes.idsDeFeicao);
        expect(depois.blobs).toBe(DECLARADO_2_4.images);
        expect(depois.blobsAlcancaveis).toBe(BLOBS_ALCANCAVEIS);
        expect(depois.nomeDoAtlas).toBe(NOME_DO_USUARIO);
        expect(depois.carimboDoSettings).toBe('3.0');
    });

    it('a versao efetiva e a do registro de atlas, e o detector diz isso em voz alta', async () => {
        const ns0 = await import('@store/atlas-namespace.js');
        await semearEntrada(ns0, { settings: '1.7', registro: '2.4' });

        vi.resetModules();
        const migration = await import('@store/migration/migration.service.js');
        const detectado = await migration.detectMigrationNeeded();

        expect(detectado.needed).toBe(true);
        expect(detectado.currentVersion).toBe('2.4');
        expect(detectado.targetVersion).toBe('3.0');
        // E ela NAO e "a maior das duas": um registro criado pelo proprio degrau v1 declara 2.0
        // enquanto o settings ainda diz 1.3, e a cadeia tem de retomar em 2.0, nao pular.
        expect((await migration.detectMigrationNeeded()).currentVersion).not.toBe('1.7');
    });

    it('o degrau v1 RECUSA correr sobre um registro 2.x mesmo chamado direto', async () => {
        // A guarda do outro lado: `effectiveVersion` mantem a cadeia longe do degrau, e o degrau
        // se recusa. Uma regra vigiada num lugar so e uma regra que o proximo chamador contorna.
        const ns0 = await import('@store/atlas-namespace.js');
        const nomes = await semearEntrada(ns0, { settings: '1.7', registro: '2.4' });
        const antes = await inventario(nomes);

        vi.resetModules();
        const { migrateToV2 } = await import('@store/migration/v1-to-v2.migration.js');
        const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const resultado = await migrateToV2();
        aviso.mockRestore();

        expect(resultado).toEqual({ success: true, skipped: true });
        expect((await inventario(nomes)).idsDeFeicao).toEqual(antes.idsDeFeicao);
    });

    it('CONTROLE: um repositorio v1 de verdade continua migrando', async () => {
        // Sem este caso a guarda acima poderia ser "nunca roda", que reprova o pior caso pelo
        // motivo errado.
        const ns0 = await import('@store/atlas-namespace.js');
        const nomes = nomesLegados(ns0);
        await seedDatabase(nomes.maps, {
            Cidade: {
                features: {
                    points: [{
                        type: 'Feature',
                        geometry: { type: 'Point', coordinates: [0, 0] },
                        properties: { id: 'f1', layerId: 'default' }
                    }]
                }
            }
        });
        await seedDatabase(nomes.settings, { schemaVersion: '1.3' });

        vi.resetModules();
        const boot = await bootar();

        expect(boot.rodouV2).toBe(true);
        expect(await readKey(nomes.settings, 'schemaVersion')).toBe('3.0');
        const mapa = await readKey(nomes.maps, 'Cidade');
        expect(mapa.features.points[0].properties.id).not.toBe('f1');
    });
});

// ============================================================================================
// A FILA LEGADA (achado L4)
// ============================================================================================

describe('a fila de operacoes que a outra linha deixa cheia', () => {
    const FILA = {
        'op-1': { id: 'op-1', type: 'feature.create', data: { nome: 'Ponto' } },
        'op-2': { id: 'op-2', type: 'feature.update', data: { nome: 'Ponto' } },
        'op-3': { id: 'op-3', type: 'map.create', data: { nome: 'Mapa' } }
    };

    it('e descartada na entrada vinda da outra linha, e o boot diz quantas', async () => {
        const ns0 = await import('@store/atlas-namespace.js');
        await semearEntrada(ns0, { settings: '2.4', registro: '2.4', fila: FILA });
        expect(await countKeys('ebgeo', { storeName: 'operation_queue' })).toBe(3);

        vi.resetModules();
        const { linhaDoBoot } = await bootar();

        expect(await readDatabase('ebgeo', { storeName: 'operation_queue' })).toEqual({});
        expect(linhaDoBoot).toContain('3 operacao(oes) legada(s) descartada(s)');
    });

    it('NAO e tocada numa instalacao desta linha, que pode ter trabalho pendente de verdade', async () => {
        // A regua que separa o descarte de um `clear()` indiscriminado. Aqui a fila descreve
        // trabalho que o proprio app enfileirou e que ainda pode subir.
        const ns0 = await import('@store/atlas-namespace.js');
        await semearEntrada(ns0, {
            settings: '2.3', registro: '2.3', comRegistroGlobal: true, fila: FILA
        });

        vi.resetModules();
        const { linhaDoBoot } = await bootar();

        expect(Object.keys(await readDatabase('ebgeo', { storeName: 'operation_queue' }))).toEqual(
            ['op-1', 'op-2', 'op-3']
        );
        expect(linhaDoBoot).not.toContain('descartada');
    });
});

// ============================================================================================
// A LINHA DO BOOT (achado P3)
// ============================================================================================

describe('a linha de log do boot', () => {
    it('nomeia o ramo, a procedencia dos bancos e a contagem de mapas do escopo', async () => {
        const ns0 = await import('@store/atlas-namespace.js');
        await semearEntrada(ns0, { settings: '2.4', registro: '2.4' });

        vi.resetModules();
        const { linhaDoBoot } = await bootar();

        expect(linhaDoBoot).toContain('escopo pre-namespace');
        expect(linhaDoBoot).toContain(`${DECLARADO_2_4.maps} mapa(s)`);
        expect(linhaDoBoot).toContain('degrau adocao-do-legado');
        expect(linhaDoBoot).toContain('bancos sem sufixo vindos do main');
    });

    it('existe TAMBEM quando nao ha degrau nenhum a rodar, que e o boot do dia seguinte', async () => {
        const ns0 = await import('@store/atlas-namespace.js');
        await semearEntrada(ns0, { settings: '3.0', registro: '3.0', comRegistroGlobal: true });

        vi.resetModules();
        const { linhaDoBoot, migracoes } = await bootar();

        expect(migracoes).toEqual([]);
        expect(linhaDoBoot).toContain('degrau nenhum');
        expect(linhaDoBoot).toContain(`${DECLARADO_2_4.maps} mapa(s)`);
    });
});

// ============================================================================================
// O ESPELHO: este arquivo boota como `store.js` boota
// ============================================================================================

describe('o boot de verdade toma a mesma leitura que este arquivo espelha', () => {
    /** @returns {string} O texto de `src/js/store/store.js`. */
    function fonteDoStore() {
        const aqui = dirname(fileURLToPath(import.meta.url));
        return readFileSync(join(aqui, '..', '..', 'src', 'js', 'store', 'store.js'), 'utf8');
    }

    it('`activateBootAtlasScope` observa a instalacao ANTES de `initLocalAtlases` e passa o nome', () => {
        const fonte = fonteDoStore();
        const corpo = fonte.slice(fonte.indexOf('async function activateBootAtlasScope'));
        const trecho = corpo.slice(0, corpo.indexOf('\n}'));

        // Cobertura vazia: se o recorte falhasse, todo `toContain` abaixo passaria em string
        // vazia? Nao, mas o inverso sim, entao o recorte e afirmado primeiro.
        expect(trecho).toContain('initLocalAtlases');

        expect(trecho).toContain('observeLegacyInstallation');
        expect(trecho).toContain('bootstrapName');
        // ORDEM, nao so presenca: depois do bootstrap a pergunta do ramo ja tem outra resposta.
        expect(trecho.indexOf('observeLegacyInstallation')).toBeLessThan(trecho.indexOf('initLocalAtlases'));
    });

    it('`initializeWithLastActiveMap` escreve a linha do boot DEPOIS de `initializeRepository`', () => {
        const fonte = fonteDoStore();
        const corpo = fonte.slice(fonte.indexOf('export async function initializeWithLastActiveMap'));

        expect(corpo).toContain('reportBootAtlasScope');
        expect(corpo.indexOf('initializeRepository')).toBeLessThan(corpo.indexOf('reportBootAtlasScope'));
    });
});

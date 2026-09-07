// Path: tests/store/reparo-do-nome-de-mapa-no-degrau.test.js
//
// O CAMPO `name` ENVENENADO QUE A OUTRA LINHA GRAVOU, e o degrau 3.0 que passa a consertá-lo.
//
// Na `main`, `createMapCompat` (`src/js/store/repositories/index.js`) preenchia o nome ausente
// com o nome pedido, mas `getEmptyMapData()` já devolve o marcador 'Novo Mapa': a guarda nunca
// disparava, e todo mapa criado pela tela foi para o disco com a CHAVE certa e o CAMPO errado.
// Medido no acervo real da travessia, em 2026-09-07: 13 de 14 registros de `ebgeo_maps` com
// `data.name = 'Novo Mapa'`, a chave certa em todos os 14.
//
// A `main` ganhou o reparo no boot dela (`repairPlaceholderMapNames`, `store/repository.js`), e
// isso não alcança quem atravessa: quem sai de uma `main` de produção que ainda não tem aquele
// commit chega aqui com o campo envenenado, e nunca mais abre a `main` para consertá-lo. O
// leitor do envio já prefere a CHAVE, então o campo é inerte para todo consumidor conhecido
// desta linha; ele volta a morder no primeiro que preferir o campo, que foi exatamente o
// defeito medido do outro lado (2 mapas e 33 feições chegando ao servidor de 14 e 805).
//
// O QUE ESTE ARQUIVO PRENDE:
//
//   1. o PIOR CASO, que é a população: 14 registros com a chave certa, 13 com o marcador no
//      campo, 'Principal' já certo. Sai do degrau com ZERO envenenados e os 14 campos iguais
//      às chaves, e a contagem aparece no log do boot;
//   2. os três controles do que NÃO se toca: chave que é id gerado (UUID ou legado), que é o
//      atlas sincronizado e onde a chave não é nome; mapa cuja chave É 'Novo Mapa', que é
//      alguém que quis mesmo esse nome; e mapa com nome escolhido pelo usuário;
//   3. IDEMPOTÊNCIA por construção, medida byte a byte: depois do reparo o campo já não é o
//      marcador, então uma segunda passada não acha o que reescrever. Os registros do segundo
//      boot são comparados INTEIROS com os do primeiro, e não só pelo campo;
//   4. o reparo não passa por `saveMap`: `sync` fica byte a byte igual e a fila não ganha
//      operação nenhuma. Treze operações fantasma seriam a diferença entre um reparo e uma
//      edição de treze mapas;
//   5. o ramo que NÃO repara: uma instalação DESTA linha que já atravessou (registro global
//      reivindicando os bancos sem sufixo, carimbo já em 3.0) sai do degrau com o disco
//      exatamente como entrou;
//   6. e o ramo `ja-adotado` que AINDA DEVE a adoção, que é a corrida medida em navegador na
//      bancada L (`atlas.html` chega ao bootstrap antes do mapa, em 5 de 8 repetições): a
//      entrada tem `adoptedLegacy` e os bancos não estão carimbados 3.0, e essa é a MESMA
//      população da adoção. Repara. É o mesmo predicado que decide o descarte da fila legada.
//
// O INSTRUMENTO é o IndexedDB de verdade (`fake-indexeddb` pelo setup), semeado por nome
// ABSOLUTO de banco e relido pelo mesmo caminho, como no irmão
// `tests/integration/degrau-3.0-entradas-da-transicao.test.js`. O dublê de `localforage` que os
// vizinhos usam serviria, mas ele vem acompanhado do mock de `utilities/uuid.js` que devolve
// `isValidId: () => true`, e é justamente `isValidId` que separa a chave-nome da chave-id: com
// o mock, o controle da chave UUID passaria por omissão.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    readDatabase,
    readKey,
    resetIndexedDB,
    seedDatabase
} from '../helpers/idb-helpers.js';

/** O marcador que `getEmptyMapData()` da outra linha grava em todo mapa novo. */
const MARCADOR = 'Novo Mapa';

/**
 * Os 14 nomes do acervo da travessia, na ordem em que a bancada os leu. 'Principal' é o único
 * que a outra linha gravou certo (ele nasceu pelo caminho do mapa padrão, não pela tela).
 */
const NOMES_DA_POPULACAO = Object.freeze([
    'Principal',
    '02 Estilos',
    '03 Atributos',
    '04 Imagens',
    '05 Simbologia',
    '06 Medidas',
    '07 Taticas',
    '08 Temporal',
    '09 Temporal relativo',
    '10 Camadas',
    '11 Grupos',
    '12 Lote',
    '13 3D e 360',
    '14 Bordas'
]);

/** Quantos da população chegam com o campo envenenado. Escrito, nunca derivado. */
const ENVENENADOS_NA_POPULACAO = 13;

/** Uma chave de mapa que é id gerado, e não nome: o atlas sincronizado chaveia assim. */
const CHAVE_UUID = '7f3b2c10-4d5e-4a6b-8c9d-0123456789ab';

/** A outra forma de id gerado que `isValidId` reconhece (timestamp-random). */
const CHAVE_ID_LEGADO = '1706123456789-abc45xy90';

/**
 * Uma feição, para que os registros tenham corpo: um reparo que reescreve o registro inteiro
 * em vez do campo apareceria aqui.
 * @param {string} id - Id da feição.
 * @returns {Object} Feição GeoJSON no formato do repositório.
 */
function ponto(id) {
    return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [-43.17, -22.90] },
        properties: {
            id,
            source: 'point',
            nome: `Ponto ${id}`,
            layerId: 'default',
            attributes: {},
            images: [],
            sync: { createdAt: 1, updatedAt: 1, version: 1 }
        }
    };
}

/**
 * Um registro de `ebgeo_maps` no formato que a outra linha grava.
 * @param {string} chave - Chave do registro, que é o nome de verdade do mapa.
 * @param {string} campo - O que vai em `name`.
 * @param {number} indice - Posição, para dar ids e datas distintas.
 * @returns {Object} Registro de mapa.
 */
function registroDeMapa(chave, campo, indice) {
    return {
        id: `mapa-${String(indice).padStart(2, '0')}`,
        name: campo,
        baseLayer: 'carta-topografica',
        features: {
            points: [ponto(`p-${indice}-1`), ponto(`p-${indice}-2`)],
            lines: [],
            polygons: [],
            military_symbols: []
        },
        zoom: 12,
        center_lat: -22.9,
        center_long: -43.17,
        sync: {
            createdAt: 1000 + indice,
            updatedAt: 2000 + indice,
            version: 3,
            ownerId: null,
            dirty: true,
            deleted: false
        }
    };
}

/**
 * Os nomes absolutos dos bancos pré-namespace, conferidos a cada uso em vez de lembrados.
 * @param {Object} ns - Módulo `atlas-namespace.js` recém-importado.
 * @returns {{maps: string, settings: string, atlas: string}}
 */
function nomesLegados(ns) {
    const escopo = ns.localScope('legacy-workspace', ns.LEGACY_DB_SUFFIX);
    const nomes = {
        maps: ns.resolveDbName(ns.StoreName.MAPS, escopo),
        settings: ns.resolveDbName(ns.StoreName.SETTINGS, escopo),
        atlas: ns.resolveDbName(ns.StoreName.ATLAS, escopo)
    };
    expect(nomes.maps).toBe('ebgeo_maps');
    expect(nomes.settings).toBe('ebgeo_app_settings');
    expect(nomes.atlas).toBe('ebgeo_atlas');
    return nomes;
}

/**
 * Escreve no disco a instalação que chega ao degrau.
 *
 * @param {Object} ns - Módulo `atlas-namespace.js`.
 * @param {Object} [opcoes]
 * @param {string} [opcoes.carimbo] - Versão no settings e no registro de atlas.
 * @param {Object<string, Object>} [opcoes.mapasExtras] - Registros a acrescentar aos 14.
 * @param {Object|null} [opcoes.registroGlobal] - Entrada de slot a semear no `ebgeo_global`.
 * @param {Object<string, Object>} [opcoes.fila] - Operações na fila pré-namespace.
 * @returns {Promise<{maps: string, settings: string, atlas: string}>} Nomes absolutos.
 */
async function semearPopulacao(ns, {
    carimbo = '2.3',
    mapasExtras = {},
    registroGlobal = null,
    fila = null
} = {}) {
    const nomes = nomesLegados(ns);

    const mapas = {};
    NOMES_DA_POPULACAO.forEach((nome, indice) => {
        // 'Principal' é o único que a outra linha gravou certo.
        const campo = nome === 'Principal' ? nome : MARCADOR;
        mapas[nome] = registroDeMapa(nome, campo, indice + 1);
    });
    Object.assign(mapas, mapasExtras);
    await seedDatabase(nomes.maps, mapas);

    await seedDatabase(nomes.atlas, {
        current_atlas: {
            id: 'atlas-da-travessia',
            name: 'Atlas do Chefe',
            schemaVersion: carimbo,
            mapOrder: Object.keys(mapas),
            lastActiveMapId: 'Principal',
            settings: { terrainExaggeration: 2.5 },
            sync: { createdAt: 1, updatedAt: 2, version: 3, ownerId: null, dirty: true, deleted: false }
        }
    });

    await seedDatabase(nomes.settings, {
        schemaVersion: carimbo,
        lastActiveMap: 'Principal',
        mapOrder: Object.keys(mapas)
    });

    if (registroGlobal) await seedDatabase('ebgeo_global', registroGlobal);
    if (fila) await seedDatabase('ebgeo', fila, { storeName: 'operation_queue' });

    return nomes;
}

/**
 * A sequência REAL do boot, na ordem de `activateBootAtlasScope` (`src/js/store/store.js`):
 * origem, observação do legado (o único instante em que a pergunta do ramo tem resposta),
 * `initLocalAtlases` e o repositório, que roda a cadeia de migração.
 *
 * @returns {Promise<{ns: Object, linhas: string[], ramo: string|null, linhaDoBoot: string|null}>}
 */
async function bootar() {
    const origin = await import('@store/store-origin.js');
    const adocao = await import('@store/migration/boot-legacy-adoption.js');
    const localAtlas = await import('@store/local-atlas.api.js');
    const repository = await import('@store/repository.js');
    const ns = await import('@store/atlas-namespace.js');

    const linhas = [];
    const registra = (...args) => { if (typeof args[0] === 'string') linhas.push(args[0]); };
    const spyLog = vi.spyOn(console, 'log').mockImplementation(registra);
    const spyInfo = vi.spyOn(console, 'info').mockImplementation(registra);
    const spyWarn = vi.spyOn(console, 'warn').mockImplementation(registra);

    let linhaDoBoot = null;
    try {
        await origin.loadStoreOrigin();
        const origem = origin.getStoreOriginSync();
        const observado = await adocao.observeLegacyInstallation(origem);
        await localAtlas.initLocalAtlases({
            origin: origem,
            isAuthenticated: false,
            preferTabMountPointer: true,
            bootstrapName: observado.bootstrapName
        });
        await repository.initializeRepository();
        linhaDoBoot = await adocao.reportBootAtlasScope();
    } finally {
        spyLog.mockRestore();
        spyInfo.mockRestore();
        spyWarn.mockRestore();
    }

    return {
        ns,
        linhas,
        linhaDoBoot,
        ramo: linhaDoBoot?.match(/degrau ([a-z0-9-.]+)/)?.[1] ?? null
    };
}

/**
 * O que o disco diz sobre o campo `name`, lido cru.
 * @param {string} dbMapas - Nome absoluto de `ebgeo_maps`.
 * @returns {Promise<{registros: Object, chaves: string[], campos: Object<string, string>,
 *   envenenados: string[]}>}
 */
async function inventarioDeNomes(dbMapas) {
    const registros = (await readDatabase(dbMapas)) ?? {};
    const campos = {};
    const envenenados = [];
    for (const [chave, registro] of Object.entries(registros)) {
        campos[chave] = registro?.name ?? null;
        if (registro?.name === MARCADOR && chave !== MARCADOR) envenenados.push(chave);
    }
    return { registros, chaves: Object.keys(registros).sort(), campos, envenenados };
}

/**
 * O registro inteiro sem o campo `name`, que é o que a idempotência compara.
 * @param {Object<string, Object>} registros - Registros de `ebgeo_maps`.
 * @returns {Object<string, Object>} Os mesmos, sem `name`.
 */
function semOCampoNome(registros) {
    const saida = {};
    for (const [chave, registro] of Object.entries(registros)) {
        const { name: _ignorado, ...resto } = registro;
        saida[chave] = resto;
    }
    return saida;
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
// A semente, antes de qualquer conclusão sobre ela
// ============================================================================================

describe('a população fabricada tem a forma do acervo medido', () => {
    it('14 registros, chave certa em todos, 13 com o marcador no campo', async () => {
        const ns = await import('@store/atlas-namespace.js');
        const nomes = await semearPopulacao(ns);

        const { chaves, envenenados, campos } = await inventarioDeNomes(nomes.maps);
        expect(chaves).toHaveLength(14);
        expect(chaves).toEqual([...NOMES_DA_POPULACAO].sort());
        expect(envenenados).toHaveLength(ENVENENADOS_NA_POPULACAO);
        expect(campos.Principal).toBe('Principal');
    });
});

// ============================================================================================
// (1) O PIOR CASO: o disco da travessia atravessa o degrau
// ============================================================================================

describe('degrau 3.0, ramo da adoção: o campo `name` é reescrito pela chave', () => {
    it('PIOR CASO: 13 de 14 envenenados entram e ZERO sai, com os 14 nomes certos', async () => {
        const ns0 = await import('@store/atlas-namespace.js');
        const nomes = await semearPopulacao(ns0);
        const antes = await inventarioDeNomes(nomes.maps);
        expect(antes.envenenados).toHaveLength(ENVENENADOS_NA_POPULACAO);

        vi.resetModules();
        const boot = await bootar();
        const depois = await inventarioDeNomes(nomes.maps);

        // O ramo é o da adoção: registro global vazio na semeadura.
        expect(boot.ramo).toBe('adocao-do-legado');

        // A medida que decide.
        expect(depois.envenenados).toEqual([]);
        for (const nome of NOMES_DA_POPULACAO) {
            expect(depois.campos[nome]).toBe(nome);
        }

        // Nenhum registro se perdeu nem nasceu no caminho.
        expect(depois.chaves).toEqual(antes.chaves);

        // E o carimbo andou, para que o segundo boot não repita nada.
        expect(await readKey(nomes.settings, 'schemaVersion')).toBe('3.0');
    });

    it('o boot diz quantos reparou, com o número', async () => {
        const ns0 = await import('@store/atlas-namespace.js');
        await semearPopulacao(ns0);

        vi.resetModules();
        const boot = await bootar();

        const linha = boot.linhas.find(l => l.includes('placeholder'));
        expect(linha).toBeDefined();
        expect(linha).toContain(String(ENVENENADOS_NA_POPULACAO));
    });

    it('o reparo não passa por `saveMap`: `sync` intacto e nenhuma operação enfileirada', async () => {
        const ns0 = await import('@store/atlas-namespace.js');
        const nomes = await semearPopulacao(ns0);
        const antes = await inventarioDeNomes(nomes.maps);

        vi.resetModules();
        await bootar();
        const depois = await inventarioDeNomes(nomes.maps);

        // Tudo o que não é `name` fica byte a byte igual, `sync` inclusive: `saveMap` teria
        // mexido em `sync.updatedAt` e em `sync.version`.
        expect(semOCampoNome(depois.registros)).toEqual(semOCampoNome(antes.registros));

        // E a fila não ganhou treze operações fantasma.
        const fila = (await readDatabase('ebgeo', { storeName: 'operation_queue' })) ?? {};
        expect(Object.keys(fila)).toEqual([]);
    });
});

// ============================================================================================
// (2) O QUE O REPARO NÃO TOCA
// ============================================================================================

describe('os controles: o que o reparo deixa como está', () => {
    it('chave que é id gerado (UUID ou legado) não é reescrita, nem com o marcador no campo', async () => {
        // O pior caso do controle não é a chave UUID com nome próprio, é a chave UUID COM o
        // marcador: ali um reparo cego batizaria o mapa com o próprio UUID, que é dano novo.
        const ns0 = await import('@store/atlas-namespace.js');
        const nomes = await semearPopulacao(ns0, {
            mapasExtras: {
                [CHAVE_UUID]: registroDeMapa(CHAVE_UUID, MARCADOR, 20),
                [CHAVE_ID_LEGADO]: registroDeMapa(CHAVE_ID_LEGADO, 'Sincronizado', 21)
            }
        });

        vi.resetModules();
        await bootar();
        const depois = await inventarioDeNomes(nomes.maps);

        expect(depois.campos[CHAVE_UUID]).toBe(MARCADOR);
        expect(depois.campos[CHAVE_ID_LEGADO]).toBe('Sincronizado');

        // E os 13 da população foram reparados assim mesmo.
        expect(depois.campos['02 Estilos']).toBe('02 Estilos');
    });

    it('o mapa que se chama mesmo "Novo Mapa" fica como está', async () => {
        const ns0 = await import('@store/atlas-namespace.js');
        const nomes = await semearPopulacao(ns0, {
            mapasExtras: { [MARCADOR]: registroDeMapa(MARCADOR, MARCADOR, 30) }
        });
        const antes = await inventarioDeNomes(nomes.maps);

        vi.resetModules();
        await bootar();
        const depois = await inventarioDeNomes(nomes.maps);

        expect(depois.campos[MARCADOR]).toBe(MARCADOR);
        expect(depois.registros[MARCADOR]).toEqual(antes.registros[MARCADOR]);
    });

    it('nome escolhido pelo usuário nunca é tocado', async () => {
        const ns0 = await import('@store/atlas-namespace.js');
        const nomes = await semearPopulacao(ns0, {
            mapasExtras: { 'Eixo Sul': registroDeMapa('Eixo Sul', 'Eixo Sul - rascunho', 40) }
        });

        vi.resetModules();
        await bootar();
        const depois = await inventarioDeNomes(nomes.maps);

        expect(depois.campos['Eixo Sul']).toBe('Eixo Sul - rascunho');
    });
});

// ============================================================================================
// (3) IDEMPOTÊNCIA
// ============================================================================================

describe('idempotência: a segunda passada não acha o que reescrever', () => {
    it('o segundo boot deixa os 14 registros byte a byte iguais aos do primeiro', async () => {
        const ns0 = await import('@store/atlas-namespace.js');
        const nomes = await semearPopulacao(ns0);

        vi.resetModules();
        await bootar();
        const depoisDoPrimeiro = await inventarioDeNomes(nomes.maps);

        vi.resetModules();
        const segundo = await bootar();
        const depoisDoSegundo = await inventarioDeNomes(nomes.maps);

        expect(segundo.ramo).toBe('nenhum');
        expect(depoisDoSegundo.registros).toEqual(depoisDoPrimeiro.registros);
        expect(depoisDoSegundo.envenenados).toEqual([]);
    });

    it('mesmo forçado a rodar de novo, o degrau não reescreve nada (o marcador já não está lá)', async () => {
        // A idempotência por CONSTRUÇÃO, sem depender da guarda do ramo: o carimbo é apagado à
        // mão para forçar o degrau a correr uma segunda vez sobre o mesmo disco.
        const ns0 = await import('@store/atlas-namespace.js');
        const nomes = await semearPopulacao(ns0);

        vi.resetModules();
        await bootar();
        const depoisDoPrimeiro = await inventarioDeNomes(nomes.maps);

        vi.resetModules();
        const ns1 = await import('@store/atlas-namespace.js');
        const escopo = ns1.localScope('legacy-workspace', ns1.LEGACY_DB_SUFFIX);
        await ns1.getStoreFor(ns1.StoreName.SETTINGS, escopo).setItem('schemaVersion', '2.4');
        const atlasStore = ns1.getStoreFor(ns1.StoreName.ATLAS, escopo);
        const atlas = await atlasStore.getItem('current_atlas');
        await atlasStore.setItem('current_atlas', { ...atlas, schemaVersion: '2.4' });

        vi.resetModules();
        const migracao = await import('@store/migration/v2.x-to-v3.0.migration.js');
        const linhas = [];
        const spyLog = vi.spyOn(console, 'log').mockImplementation((...a) => {
            if (typeof a[0] === 'string') linhas.push(a[0]);
        });
        try {
            await migracao.migrateToV3_0();
        } finally {
            spyLog.mockRestore();
        }

        const depoisDoSegundo = await inventarioDeNomes(nomes.maps);
        expect(depoisDoSegundo.registros).toEqual(depoisDoPrimeiro.registros);
        expect(linhas.filter(l => l.includes('placeholder'))).toEqual([]);
    });
});

// ============================================================================================
// (4) O RAMO QUE NÃO REPARA, e o que ainda deve a adoção
// ============================================================================================

describe('o ramo `ja-adotado`: quem já atravessou fica como está', () => {
    it('instalação DESTA linha já carimbada 3.0 não tem o disco reescrito', async () => {
        // Uma instalação desta linha não produz o marcador (a guarda de `createMapCompat` aqui
        // já é `!mapData || !newMapData.name`), então um registro assim é dado que veio de
        // import, de cópia ou de um estado que este degrau não escreveu. O degrau não é o dono
        // dele: já atravessou, e o reparo é da TRAVESSIA.
        const ns0 = await import('@store/atlas-namespace.js');
        const nomes = await semearPopulacao(ns0, {
            carimbo: '3.0',
            registroGlobal: {
                'local_atlas:slot-desta-linha': {
                    name: 'Atlas do Chefe', dbSuffix: '', createdAt: 1, updatedAt: 1
                },
                current_local_atlas: 'slot-desta-linha'
            }
        });
        const antes = await inventarioDeNomes(nomes.maps);

        vi.resetModules();
        const migracao = await import('@store/migration/v2.x-to-v3.0.migration.js');
        const resultado = await migracao.migrateToV3_0();
        const depois = await inventarioDeNomes(nomes.maps);

        expect(resultado.branch).toBe('ja-adotado');
        expect(depois.envenenados).toHaveLength(ENVENENADOS_NA_POPULACAO);
        expect(depois.registros).toEqual(antes.registros);
    });

    it('entrada sem a marca `adoptedLegacy` (build anterior desta linha) também não é reparada', async () => {
        const ns0 = await import('@store/atlas-namespace.js');
        const nomes = await semearPopulacao(ns0, {
            carimbo: '2.3',
            registroGlobal: {
                'local_atlas:slot-antigo': {
                    name: 'Atlas do Chefe', dbSuffix: '', createdAt: 1, updatedAt: 1
                },
                current_local_atlas: 'slot-antigo'
            }
        });
        const antes = await inventarioDeNomes(nomes.maps);

        vi.resetModules();
        const migracao = await import('@store/migration/v2.x-to-v3.0.migration.js');
        const resultado = await migracao.migrateToV3_0();
        const depois = await inventarioDeNomes(nomes.maps);

        expect(resultado.branch).toBe('ja-adotado');
        expect(depois.envenenados).toHaveLength(ENVENENADOS_NA_POPULACAO);
        expect(depois.registros).toEqual(antes.registros);
    });

    it('`ja-adotado` que AINDA DEVE a adoção (a corrida do atlas.html) É reparado', async () => {
        // A corrida medida em navegador na bancada L: `atlas.html` chega ao `bootstrapEntry`
        // antes do mapa, adota os bancos sem sufixo e grava `adoptedLegacy: true`; quando o
        // degrau finalmente corre, o ramo responde `ja-adotado` sobre bancos ainda não
        // carimbados 3.0. É a MESMA população da adoção, e é o mesmo predicado que já decide o
        // descarte da fila legada (B4-2). Reparar aqui e não ali deixaria de fora 5 das 8
        // repetições que a bancada mediu.
        const ns0 = await import('@store/atlas-namespace.js');
        const nomes = await semearPopulacao(ns0, {
            carimbo: '2.4',
            registroGlobal: {
                'local_atlas:slot-do-bootstrap': {
                    name: 'Atlas do Chefe',
                    dbSuffix: '',
                    createdAt: 1,
                    updatedAt: 1,
                    adoptedLegacy: true
                },
                current_local_atlas: 'slot-do-bootstrap'
            }
        });

        vi.resetModules();
        const migracao = await import('@store/migration/v2.x-to-v3.0.migration.js');
        const resultado = await migracao.migrateToV3_0();
        const depois = await inventarioDeNomes(nomes.maps);

        expect(resultado.branch).toBe('ja-adotado');
        expect(depois.envenenados).toEqual([]);
        for (const nome of NOMES_DA_POPULACAO) {
            expect(depois.campos[nome]).toBe(nome);
        }
    });
});

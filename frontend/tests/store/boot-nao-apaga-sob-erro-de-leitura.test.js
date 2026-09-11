// Path: tests/store/boot-nao-apaga-sob-erro-de-leitura.test.js
//
// O boot NUNCA pode responder a um erro de LEITURA apagando o acervo do usuário.
//
// `checkAndCleanLegacyData` (`src/js/store/repository.js`) lê `schemaVersion` do escopo ativo e
// decide se o repositório é velho demais para migrar. O `catch` dessa leitura chama
// `clearLegacyStores()`, que esvazia CINCO bancos (mapas, imagens, configurações, grupos,
// camadas) e carimba a versão corrente. Ou seja: qualquer erro transitório do IndexedDB
// (InvalidStateError depois de um `versionchange`, UnknownError de disco, cota, perfil
// corrompido) é lido como "dado velho demais" e responde com destruição.
//
// A régua é a mesma dos vizinhos deste diretório: o insumo degenerado é construído ANTES de
// medir, e o caso de CONTROLE (leitura que funciona, com carimbo `'2.4'` da outra linha) fica
// ao lado, porque um teste que só vê o caminho de erro não distingue "o boot preserva" de "o
// boot não faz nada".
//
// Os três casos e o que cada um prende:
//
//   1. LEITURA QUE FALHA: 14 mapas, 149 imagens, camadas e grupos continuam no disco depois de
//      um `getItem` que rejeita. Hoje sobra zero;
//   2. LIMPEZA PARCIAL: com um `clear()` rejeitando no meio do `Promise.allSettled`, os outros
//      quatro bancos JÁ FORAM esvaziados e o carimbo final não é a versão corrente e sim o
//      literal LEGADO `'1.7'`, escrito por `runLegacyMigrations(null)`. É a mesma "entrada 1.7"
//      que a decisão de 2026-09-07 construiu `effectiveVersion` para defender, fabricada aqui
//      dentro;
//   3. ESCOPO COM DADO E SEM CARIMBO: a ausência do marcador é tratada como "instalação
//      anterior ao marcador" e apaga. O `seedAtlasRecord` de `local-atlas.api.js` já descreve
//      esse mecanismo no próprio comentário; o que falta é a guarda.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Fake do localforage por nome de banco, no mesmo formato de
// `tests/store/store-schema-migration-v3.0.test.js`: uma instância por banco e clone
// estruturado nas duas pontas, para que um round-trip não passe por identidade de referência.
// ============================================================================

const { databases, instances, makeStore, resetFake } = vi.hoisted(() => {
    const databases = new Map();
    const instances = new Map();

    const clone = (v) => (v === undefined ? v : structuredClone(v));

    function makeStore({ name, storeName = null }) {
        const key = storeName ? `${name}::${storeName}` : name;
        if (instances.has(key)) return instances.get(key);

        const backing = databases.get(key) ?? new Map();
        databases.set(key, backing);

        const instance = {
            __dbName: key,
            __backing: backing,
            setItem: vi.fn(async (k, v) => { backing.set(k, clone(v)); return v; }),
            getItem: vi.fn(async (k) => (backing.has(k) ? clone(backing.get(k)) : null)),
            removeItem: vi.fn(async (k) => { backing.delete(k); }),
            keys: vi.fn(async () => [...backing.keys()]),
            clear: vi.fn(async () => { backing.clear(); }),
            iterate: vi.fn(async (cb) => { for (const [k, v] of backing) cb(clone(v), k); })
        };
        instances.set(key, instance);
        return instance;
    }

    return {
        databases,
        instances,
        makeStore,
        resetFake: () => { databases.clear(); instances.clear(); }
    };
});

vi.mock('localforage', () => ({
    default: {
        createInstance: vi.fn((options) => makeStore(options)),
        dropInstance: vi.fn(async ({ name }) => { databases.delete(name); instances.delete(name); })
    }
}));

const { uuidCounter } = vi.hoisted(() => ({ uuidCounter: { value: 0 } }));

vi.mock('../../src/js/utilities/uuid.js', () => ({
    generateUUID: vi.fn(() => {
        uuidCounter.value += 1;
        return `00000000-0000-4000-8000-${String(uuidCounter.value).padStart(12, '0')}`;
    }),
    isValidUUID: vi.fn((v) => typeof v === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)),
    isLegacyId: vi.fn(() => false),
    isValidId: vi.fn(() => true)
}));

// ============================================================================
// Insumo: uma instalação da outra linha do produto, carimbada '2.4', com dado nos bancos que
// `clearLegacyStores` alcança. Os números são os da bancada (14 mapas, 149 imagens).
// ============================================================================

const MAPAS = 14;
const IMAGENS = 149;

/** Escreve direto no fake, sem passar pelo código sob teste. */
function raw(dbName) {
    return makeStore({ name: dbName });
}

/**
 * @param {string|null} carimbo - Valor de `schemaVersion` no settings, ou null para não gravar.
 * @returns {Promise<void>}
 */
async function semearInstalacaoDaOutraLinha(carimbo = '2.4') {
    await raw('ebgeo_atlas').setItem('current_atlas', {
        id: 'atlas-do-chefe',
        name: 'Atlas do Chefe',
        sync: { createdAt: 1, updatedAt: 2, version: 26 },
        schemaVersion: '2.4',
        mapOrder: Array.from({ length: MAPAS }, (_, i) => `Mapa ${i + 1}`),
        lastActiveMapId: 'Mapa 1'
    });

    for (let i = 1; i <= MAPAS; i++) {
        await raw('ebgeo_maps').setItem(`Mapa ${i}`, {
            id: `mapa-${i}`,
            name: `Mapa ${i}`,
            features: {
                points: [{
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [-43.17, -22.90] },
                    properties: { id: `p-${i}`, source: 'point', layerId: 'default' }
                }],
                lines: [],
                military_symbols: [],
                polygons: []
            }
        });
    }

    for (let i = 1; i <= IMAGENS; i++) {
        await raw('ebgeo_images').setItem(`img-${i}`, new Blob([`imagem-${i}`], { type: 'image/png' }));
    }

    await raw('ebgeo_layers').setItem('layers_Mapa 1', [{ id: 'default', nome: 'Camada Padrão' }]);
    await raw('ebgeo_groups').setItem('Mapa 1', { 'g-1': { id: 'g-1', nome: 'Pelotão Alfa' } });

    const app = raw('ebgeo_app_settings');
    if (carimbo !== null) await app.setItem('schemaVersion', carimbo);
    await app.setItem('lastActiveMap', 'Mapa 1');
}

/** Carrega a cadeia num grafo de módulos NOVO (a fábrica tem estado de módulo). */
async function loadModules() {
    vi.resetModules();
    // IMPORTACOES SEQUENCIAIS, E ISSO NAO E ESTILO. Com `Promise.all` logo depois de
    // `vi.resetModules()`, as resolucoes correm contra o re-registro do mock de
    // `localforage` no grafo novo, e de vez em quando um modulo pega o localforage REAL.
    // Como o setup global instala `fake-indexeddb`, esse caminho nao falha: ele funciona
    // contra um banco de verdade que SOBREVIVE entre os testes do arquivo, e o teste passa
    // a medir o que um teste anterior deixou. Diagnosticado em 2026-09-11 no
    // `store-schema-migration-v3.0.test.js`, que reprovava em 2 de 3 rodadas da suite e
    // passava sempre isolado; a prova foi a loja em uso nao ter o `__backing` do duplo.
    const repository = await import('../../src/js/store/repository.js');
    const namespace = await import('../../src/js/store/atlas-namespace.js');
    return { repository, namespace };
}

/**
 * O que sobrou nos bancos que `clearLegacyStores` alcança, contado pelas CHAVES relidas do
 * fake. Contar pelo retorno da função sob teste seria o eco dela mesma.
 * @returns {Promise<{maps: number, images: number, layers: number, groups: number}>}
 */
async function sobrouNoDisco() {
    return {
        maps: (await raw('ebgeo_maps').keys()).length,
        images: (await raw('ebgeo_images').keys()).length,
        layers: (await raw('ebgeo_layers').keys()).length,
        groups: (await raw('ebgeo_groups').keys()).length
    };
}

/**
 * Insumo degenerado 1: a PRIMEIRA leitura do carimbo rejeita, como um IndexedDB que acabou de
 * receber `versionchange` de outra aba. As leituras seguintes funcionam, porque o erro que estes
 * casos descrevem é TRANSITÓRIO: se ele fosse permanente, nem o conserto salvaria o dado.
 * @param {{getItem: Function}} app - Instância do fake de `ebgeo_app_settings`.
 * @param {string} [nome='InvalidStateError'] - Nome do erro do DOM a simular.
 * @returns {void}
 */
function quebrarLeituraDoCarimbo(app, nome = 'InvalidStateError') {
    const realGet = app.getItem.getMockImplementation();
    let primeira = true;
    app.getItem.mockImplementation(async (chave) => {
        if (chave === 'schemaVersion' && primeira) {
            primeira = false;
            const erro = new Error('Failed to execute transaction on IDBDatabase');
            erro.name = nome;
            throw erro;
        }
        return realGet(chave);
    });
}

/**
 * Insumo degenerado 2: a limpeza do banco de imagens rejeita. O `Promise.allSettled` de
 * `clearLegacyStores` termina as outras QUATRO e só então relança, então este erro chega depois
 * do apagamento e não no lugar dele.
 * @returns {void}
 */
function quebrarLimpezaDeImagens() {
    raw('ebgeo_images').clear.mockImplementation(async () => {
        const erro = new Error('Quota exceeded');
        erro.name = 'QuotaExceededError';
        throw erro;
    });
}

beforeEach(() => {
    resetFake();
    uuidCounter.value = 0;
    vi.restoreAllMocks();
});

// ============================================================================
// B4-1: erro de leitura não é autorização para apagar
// ============================================================================

describe('B4-1: o boot sob erro de leitura do carimbo', () => {
    it('CONTROLE: com a leitura funcionando, os 14 mapas e as 149 imagens ficam', async () => {
        // Sem este caso o vermelho do seguinte não distingue "apagou" de "nunca semeou".
        await semearInstalacaoDaOutraLinha('2.4');
        const mods = await loadModules();

        await mods.repository.initializeRepository();

        expect(await sobrouNoDisco()).toEqual({ maps: MAPAS, images: IMAGENS, layers: 1, groups: 1 });
    });

    it('um getItem que rejeita NÃO pode apagar os cinco bancos do usuário', async () => {
        await semearInstalacaoDaOutraLinha('2.4');
        const mods = await loadModules();

        quebrarLeituraDoCarimbo(raw('ebgeo_app_settings'));

        await mods.repository.initializeRepository();

        expect(await sobrouNoDisco()).toEqual({ maps: MAPAS, images: IMAGENS, layers: 1, groups: 1 });
    });

    it('e o registro de atlas continua descrevendo o acervo, não um repositório novo', async () => {
        // O `ebgeo_atlas` NÃO está na lista dos cinco, então ele sobrevive ao apagamento e
        // passa a descrever 14 mapas que já não existem. É esse par (registro cheio, bancos
        // vazios) que faz o boot seguinte achar que está tudo bem.
        await semearInstalacaoDaOutraLinha('2.4');
        const mods = await loadModules();

        quebrarLeituraDoCarimbo(raw('ebgeo_app_settings'), 'UnknownError');

        await mods.repository.initializeRepository();

        const atlas = await raw('ebgeo_atlas').getItem('current_atlas');
        expect(atlas.mapOrder).toHaveLength(MAPAS);
        expect((await raw('ebgeo_maps').keys()).length).toBe(atlas.mapOrder.length);
    });
});

// ============================================================================
// B4-1b: a limpeza PARCIAL, e o carimbo '1.7' que o próprio boot escreve
// ============================================================================

describe('B4-1b: clearLegacyStores parcial deixa a instalação em 1.7', () => {
    it('um clear() que rejeita não pode deixar os outros quatro bancos vazios', async () => {
        await semearInstalacaoDaOutraLinha('2.4');
        const mods = await loadModules();

        // Leitura do carimbo rejeita (entra em `clearLegacyStores`) e a limpeza de imagens
        // rejeita (o `allSettled` termina as outras quatro e só então relança).
        quebrarLeituraDoCarimbo(raw('ebgeo_app_settings'));
        quebrarLimpezaDeImagens();

        await mods.repository.initializeRepository();

        expect(await sobrouNoDisco()).toEqual({ maps: MAPAS, images: IMAGENS, layers: 1, groups: 1 });
    });

    it('o boot NÃO pode escrever o literal LEGADO 1.7 no carimbo', async () => {
        // `clearLegacyStores` esvazia e só DEPOIS carimba; com a limpeza relançando, o carimbo
        // não acontece. `initializeRepository` relê `schemaVersion`, encontra null, e
        // `runLegacyMigrations(null)` grava `SCHEMA_VERSION`, que é o legado '1.7'
        // (`repository.utils.js`), e não `ATLAS_SCHEMA_VERSION`. É a MESMA fórmula que a
        // decisão de 2026-09-07 nomeia como a entrada mais cara da outra linha, viva aqui.
        await semearInstalacaoDaOutraLinha('2.4');
        const mods = await loadModules();
        const app = raw('ebgeo_app_settings');

        quebrarLeituraDoCarimbo(app);
        quebrarLimpezaDeImagens();

        await mods.repository.initializeRepository();

        const carimbosEscritos = app.setItem.mock.calls
            .filter(([chave]) => chave === 'schemaVersion')
            .map(([, valor]) => valor);
        expect(carimbosEscritos).not.toContain('1.7');
    });

    it('e numa instalação DESTA linha esse 1.7 FICA no disco', async () => {
        // O `effectiveVersion` de `migration.service.js` desarma o 1.7 lendo o registro de
        // atlas, então o degrau 3.0 não corre e nada reescreve o carimbo. O marcador do
        // settings passa a mentir para todo leitor que não tenha esse desvio.
        await semearInstalacaoDaOutraLinha('3.0');
        const atlas = await raw('ebgeo_atlas').getItem('current_atlas');
        await raw('ebgeo_atlas').setItem('current_atlas', { ...atlas, schemaVersion: '3.0' });
        await raw('ebgeo_global').setItem('local_atlas:slot-1', {
            version: 1, id: 'slot-1', name: 'Atlas do Chefe', dbSuffix: '', createdAt: 1, updatedAt: 1
        });

        const mods = await loadModules();
        const app = raw('ebgeo_app_settings');
        quebrarLeituraDoCarimbo(app);
        quebrarLimpezaDeImagens();

        await mods.repository.initializeRepository();

        expect(await raw('ebgeo_app_settings').getItem('schemaVersion')).not.toBe('1.7');
    });
});

// ============================================================================
// B4-6: escopo com dado e sem carimbo
// ============================================================================

describe('B4-6: ausência do carimbo não é prova de que o dado é velho', () => {
    it('um escopo com 14 mapas e sem schemaVersion não pode ser esvaziado', async () => {
        // A ausência do marcador significa DUAS coisas indistinguíveis: instalação anterior ao
        // marcador (vazia) e escopo cujo carimbo se perdeu (cheio). O predicado responde a
        // segunda como se fosse a primeira. O próprio `seedAtlasRecord`
        // (`local-atlas.api.js`) descreve o mecanismo; o que falta é a guarda por CONTEÚDO.
        await semearInstalacaoDaOutraLinha(null);
        const mods = await loadModules();

        await mods.repository.initializeRepository();

        expect(await sobrouNoDisco()).toEqual({ maps: MAPAS, images: IMAGENS, layers: 1, groups: 1 });
    });

    it('CONTROLE: um escopo VAZIO e sem carimbo continua sendo limpo e carimbado', async () => {
        // A guarda proposta é por CONTEÚDO, então ela não pode desligar o caminho de instalação
        // nova: sem dado, `clearLegacyStores` continua correndo e o carimbo sai na versão
        // corrente. Sem este caso, "não apaga nunca" passaria.
        const mods = await loadModules();

        await mods.repository.initializeRepository();

        expect(await raw('ebgeo_app_settings').getItem('schemaVersion')).toBe('3.0');
    });
});

// ============================================================================
// R1: carimbo VELHO DEMAIS para migrar (abaixo de MIN_SCHEMA_VERSION) sobre um escopo COM dado
// ============================================================================
//
// É a ressalva que o orquestrador levantou sobre o `conserto-B4-1.diff` e que a decisão de
// 2026-09-07 fechou. Até aqui um carimbo abaixo de '1.3' autorizava `clearLegacyStores()` sem
// olhar o conteúdo, e é o gesto do B4-1 entrando pela outra porta. O comportamento nomeado é
// PRESERVAR: o boot relata a recusa dizendo o carimbo e QUANTAS chaves ele se recusou a destruir,
// a cadeia legada não roda sobre um carimbo em que não se pode confiar, e o boot segue. A
// população é anterior a 2026 e quase nula; o custo de errar é a área de trabalho inteira de
// alguém.

describe('R1: carimbo abaixo do mínimo sobre um escopo COM dado', () => {
    /** O total de chaves que a medida do escopo conta: mapas, imagens, grupos e camadas. */
    const CHAVES = MAPAS + IMAGENS + 1 + 1;

    it('não apaga nada, e o erro do console diz o carimbo, quantas chaves e que nada foi apagado', async () => {
        await semearInstalacaoDaOutraLinha('1.2');
        const mods = await loadModules();
        const erros = [];
        vi.spyOn(console, 'error').mockImplementation((...args) => {
            if (typeof args[0] === 'string') erros.push(args[0]);
        });

        await mods.repository.initializeRepository();

        const linha = erros.find(texto => texto.includes('ESCOPO PRESERVADO'));
        expect(await sobrouNoDisco()).toEqual({ maps: MAPAS, images: IMAGENS, layers: 1, groups: 1 });
        expect(linha).toBeDefined();
        expect(linha).toContain('1.2');
        expect(linha).toContain(String(CHAVES));
        expect(linha).toContain('NADA foi apagado');
    });

    it('a cadeia legada NÃO roda sobre esse carimbo, e o boot segue para um mapa que existe', async () => {
        // As duas metades do "segue": nada de `runLegacyMigrations`, que sobre carimbo ausente
        // grava o literal LEGADO '1.7' (`SCHEMA_VERSION`), e uma entrada que é um dos 14 mapas do
        // acervo, e não um mapa padrão que ele não tem.
        await semearInstalacaoDaOutraLinha('1.2');
        const mods = await loadModules();
        const app = raw('ebgeo_app_settings');

        const entrada = await mods.repository.initializeRepository();

        const carimbosEscritos = app.setItem.mock.calls
            .filter(([chave]) => chave === 'schemaVersion')
            .map(([, valor]) => valor);
        expect(carimbosEscritos).not.toContain('1.7');
        // Um dos 14 mapas do ACERVO, e não o mapa em branco que a semeadura cria depois de uma
        // limpeza: sem esta segunda metade o caso passaria com o escopo apagado, porque o mapa
        // padrão semeado também "existe" no disco que sobrou.
        expect(entrada).toMatch(/^Mapa \d+$/);
        expect(await raw('ebgeo_maps').keys()).toContain(entrada);
    });

    it('CONTROLE: o mesmo carimbo velho sobre um escopo VAZIO continua sendo limpo e carimbado', async () => {
        // Sem este caso, "nunca apaga por carimbo velho" passaria, e o caminho da instalação
        // antiga e vazia, que é o que a limpeza existe para servir, morreria em silêncio.
        await raw('ebgeo_app_settings').setItem('schemaVersion', '1.2');
        const mods = await loadModules();

        await mods.repository.initializeRepository();

        expect(await raw('ebgeo_app_settings').getItem('schemaVersion')).toBe('3.0');
    });
});

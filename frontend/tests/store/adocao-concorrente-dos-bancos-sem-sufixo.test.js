// Path: tests/store/adocao-concorrente-dos-bancos-sem-sufixo.test.js
//
// A ADOÇÃO DOS BANCOS SEM SUFIXO NÃO É ARBITRADA POR NADA, e o dia da implantação é justamente
// quando duas páginas do EBGeo abrem sobre a mesma instalação da outra linha do produto.
//
// `bootstrapEntry` (`src/js/store/local-atlas.api.js`) cria a entrada de `dbSuffix` vazio quando,
// e só quando, o registro global está VAZIO. Não há Web Lock, transação nem verificação de
// releitura entre o `keys()` que responde "vazio" e o `setItem` que reivindica: são duas idas ao
// IndexedDB, e o intervalo entre elas é onde cabe a segunda página. As duas páginas que fazem
// isso hoje são `index.html` (o mapa, por `activateBootAtlasScope` em `store.js`) e `atlas.html`
// (a tela "Seus atlas", por `projects-page.js`), e nenhuma delas sabe da outra.
//
// O custo não é cosmético, e é o que o segundo bloco mede: `deleteLocalAtlas` só recusa quando o
// slot é o ÚLTIMO do registro. Com DOIS slots reivindicando o mesmo sufixo vazio, excluir
// qualquer um dos dois derruba os onze bancos sem sufixo, ou seja, o acervo inteiro que o outro
// cartão continua anunciando na tela.
//
// O terceiro bloco mede o outro lado da mesma porta: a tela "Seus atlas" reivindica os bancos
// SEM rodar o degrau 3.0 (ela boota sem store, de propósito). Quando o mapa abre depois, o
// discriminador de ramo responde "ja-adotado", e o descarte da fila legada, que a decisão de
// 2026-09-07 comprou como guarda, nunca corre.
//
// O quarto bloco cobre as formas degeneradas do registro que o brief pediu, com o caso que
// CONVERGE ao lado dos que não convergem, porque um bloco só de vermelhos não separa "o registro
// é frágil" de "o registro nunca se repara".

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { localSlotsOnDisk, localAtlasDiskKey } from '../helpers/atlas-registry-disk.js';

// ============================================================================
// Fake do localforage por nome de banco, no formato dos vizinhos.
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
        dropInstance: vi.fn(async ({ name }) => {
            for (const chave of [...databases.keys()]) {
                if (chave === name || chave.startsWith(`${name}::`)) {
                    databases.delete(chave);
                    instances.delete(chave);
                }
            }
        })
    }
}));

// O aviso de teardown abriria um BroadcastChannel e esperaria por abas que não existem aqui.
// Só ele é interceptado; `TeardownReason` continua vindo do módulo real.
vi.mock('@utils/tab-lock.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        announceTabLockTeardown: vi.fn(async (addresses, options) => ({
            addresses, peers: 0, acked: 0, frozen: 0, timedOut: false, degraded: false, options
        }))
    };
});

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
// Insumo e ajudantes
// ============================================================================

const MAPAS = 14;
const ORIGEM_LOCAL = { kind: 'local', atlasId: null };

/** Escreve direto no fake, sem passar pelo código sob teste. */
function raw(dbName) {
    return makeStore({ name: dbName });
}

/**
 * Uma instalação da outra linha do produto: bancos sem sufixo com dado, carimbo '2.4', e NENHUMA
 * entrada no registro global (é isso que a define, e é o discriminador do degrau 3.0).
 * @returns {Promise<void>}
 */
async function semearInstalacaoDaOutraLinha() {
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
            features: { points: [], lines: [], military_symbols: [], polygons: [] }
        });
    }
    await raw('ebgeo_app_settings').setItem('schemaVersion', '2.4');
    await raw('ebgeo_app_settings').setItem('lastActiveMap', 'Mapa 1');
}

/** Um grafo de módulos NOVO: o registro e a fábrica de namespace têm estado de módulo. */
async function carregarPagina() {
    vi.resetModules();
    // IMPORTAÇÕES SEQUENCIAIS, E ISSO NÃO É ESTILO. Com `Promise.all` logo depois de
    // `vi.resetModules()`, as resoluções correm contra o re-registro do mock de
    // `localforage` no grafo novo, e de vez em quando um módulo pega o localforage REAL.
    // Como o setup global instala `fake-indexeddb`, esse caminho não falha: ele funciona
    // contra um banco de verdade que SOBREVIVE entre os testes do arquivo, e o teste passa
    // a medir o que um teste anterior deixou. Diagnosticado em 2026-09-11 no
    // `store-schema-migration-v3.0.test.js`, que reprovava em 2 de 3 rodadas da suíte e
    // passava sempre isolado; a prova foi a loja em uso não ter o `__backing` do duplo.
    const localAtlas = await import('@store/local-atlas.api.js');
    const adocao = await import('@store/migration/boot-legacy-adoption.js');
    const repository = await import('@store/repository.js');
    const ns = await import('@store/atlas-namespace.js');
    const origin = await import('@store/store-origin.js');
    return { localAtlas, adocao, repository, ns, origin };
}

/**
 * O prefixo do boot do MAPA, nas mesmas chamadas e na mesma ordem de
 * `initializeWithLastActiveMap` (`src/js/store/store.js`), sem as partes que exigem o
 * `eventBus` e o gerente de mapas.
 * @param {Object} pagina - Um grafo devolvido por `carregarPagina`.
 * @returns {Promise<{linhaDoBoot: string|null, ramo: string|null}>}
 */
async function bootarOMapa(pagina) {
    const linhas = [];
    const registra = (...args) => { if (typeof args[0] === 'string') linhas.push(args[0]); };
    const spyLog = vi.spyOn(console, 'log').mockImplementation(registra);
    const spyInfo = vi.spyOn(console, 'info').mockImplementation(registra);
    let linhaDoBoot = null;
    try {
        await pagina.origin.loadStoreOrigin();
        const origem = pagina.origin.getStoreOriginSync();
        const observado = await pagina.adocao.observeLegacyInstallation(origem);
        await pagina.localAtlas.initLocalAtlases({
            origin: origem,
            isAuthenticated: false,
            preferTabMountPointer: true,
            bootstrapName: observado.bootstrapName
        });
        await pagina.repository.initializeRepository();
        linhaDoBoot = await pagina.adocao.reportBootAtlasScope();
    } finally {
        spyLog.mockRestore();
        spyInfo.mockRestore();
    }
    return { linhaDoBoot, ramo: linhaDoBoot?.match(/degrau ([a-z-]+)/)?.[1] ?? null };
}

/**
 * O corpo da tela "Seus atlas" (`src/js/projects/projects-page.js`), que é UMA chamada e não
 * passa por `initializeRepository`: `atlas.html` boota sem a store, por decisão.
 * @param {Object} pagina - Um grafo devolvido por `carregarPagina`.
 * @returns {Promise<void>}
 */
async function abrirSeusAtlas(pagina) {
    await pagina.localAtlas.initLocalAtlases({ origin: ORIGEM_LOCAL, isAuthenticated: false });
}

/** @returns {Promise<Map<string, *>>} O banco global lido cru, chave a chave. */
async function discoGlobal() {
    const store = raw('ebgeo_global');
    const saida = new Map();
    for (const chave of await store.keys()) saida.set(chave, await store.getItem(chave));
    return saida;
}

/** @returns {Promise<Array<object>>} Os slots que reivindicam os bancos SEM sufixo. */
async function slotsQueReivindicamOsBancosSemSufixo() {
    return localSlotsOnDisk(await discoGlobal()).filter(e => e.dbSuffix === '');
}

/** @returns {{promessa: Promise<void>, abrir: () => void}} Uma porta que o teste abre na hora. */
function criarPorta() {
    let abrir;
    const promessa = new Promise(resolve => { abrir = resolve; });
    return { promessa, abrir };
}

beforeEach(() => {
    resetFake();
    uuidCounter.value = 0;
    vi.restoreAllMocks();
});

// ============================================================================
// B4-3: duas páginas reivindicando os mesmos bancos
// ============================================================================

describe('B4-3: duas páginas abrindo ao mesmo tempo sobre a instalação da outra linha', () => {
    /**
     * Encena o intervalo REAL entre a leitura e a escrita do registro: a página A chega à
     * primeira escrita do banco global e para ali; a página B lê o registro AINDA vazio e
     * reivindica também; então A conclui. É determinístico de propósito, porque a alternativa
     * (rodar as duas e torcer) é a medição única de algo probabilístico que a casa proíbe.
     * @returns {Promise<void>}
     */
    async function encenarAsDuasPaginas() {
        const paginaA = await carregarPagina();
        const paginaB = await carregarPagina();

        const global = raw('ebgeo_global');
        const escritaReal = global.setItem.getMockImplementation();
        const porta = criarPorta();
        let avisarQueChegou;
        const chegou = new Promise(resolve => { avisarQueChegou = resolve; });

        global.setItem.mockImplementationOnce(async (chave, valor) => {
            avisarQueChegou();
            await porta.promessa;
            return escritaReal(chave, valor);
        });

        const bootA = bootarOMapa(paginaA);
        await chegou;
        await abrirSeusAtlas(paginaB);
        porta.abrir();
        await bootA;
    }

    it('CONTROLE: uma página sozinha reivindica os bancos sem sufixo UMA vez', async () => {
        await semearInstalacaoDaOutraLinha();
        await bootarOMapa(await carregarPagina());

        expect(await slotsQueReivindicamOsBancosSemSufixo()).toHaveLength(1);
    });

    it('duas páginas não podem produzir DOIS slots com o mesmo sufixo vazio', async () => {
        await semearInstalacaoDaOutraLinha();
        await encenarAsDuasPaginas();

        const donos = await slotsQueReivindicamOsBancosSemSufixo();
        expect(donos.map(e => e.name)).toHaveLength(1);
    });

    it('e excluir um deles derruba os bancos que o OUTRO ainda anuncia', async () => {
        // `deleteLocalAtlas` só recusa o ÚLTIMO slot do registro. Com dois donos do mesmo
        // endereço, o segundo cartão autoriza a destruição do primeiro, e `dropAtlasDatabases`
        // resolve o escopo pelo `dbSuffix`, que nos dois é a string vazia.
        await semearInstalacaoDaOutraLinha();
        await encenarAsDuasPaginas();

        const pagina = await carregarPagina();
        await pagina.localAtlas.initLocalAtlases({ origin: ORIGEM_LOCAL, isAuthenticated: false });
        const registrados = pagina.localAtlas.listLocalAtlases();
        await pagina.localAtlas.deleteLocalAtlas(registrados[0].id);

        // A asserção NÃO diz qual conserto: sobra pelo menos um cartão e o acervo continua de
        // pé. Recusar a exclusão e impedir o segundo dono são duas saídas aceitáveis, e prender
        // uma delas aqui reprovaria a outra.
        const mapasNoDisco = databases.get('ebgeo_maps')?.size ?? 0;
        expect({
            cartoesRestantes: pagina.localAtlas.listLocalAtlases().length,
            mapasNoDisco
        }).toEqual({ cartoesRestantes: 1, mapasNoDisco: MAPAS });
    });
});

// ============================================================================
// C1: o desempate é DETERMINÍSTICO, pelo menor id, e não "quem vir um rival recua"
// ============================================================================
//
// O primeiro conserto fazia cada página RECUAR ao ver um rival, o que é simétrico: duas páginas
// que se leem recuam JUNTAS e a instalação fica sem dono para os bancos que acabou de
// reivindicar. Com uma ordem total sobre os ids, qualquer página que leia o disco chega ao MESMO
// vencedor, em qualquer intercalação, sem perguntar nada à outra. `navigator.locks` não serve de
// arbitragem: em HTTP puro a API não existe (`atlas-namespace.js`, Decisão 5), que é exatamente a
// implantação que esta transição tem de atravessar.
//
// Os dois casos são as duas ORDENS de leitura, porque cada uma exercita um ramo diferente: com o
// vencedor lendo por último é ele que PODA a entrada duplicada; com o perdedor lendo por último é
// ele que RECUA e adota o vencedor. Um conserto que só cobrisse um dos ramos passaria em metade
// das intercalações e deixaria dois donos na outra metade.

describe('C1: duas páginas reivindicando o mesmo sufixo terminam numa entrada só', () => {
    const PREFIXO_DE_SLOT = 'local_atlas:';

    /**
     * Encena as duas páginas com portas, e devolve os ids que chegaram a ser escritos no disco.
     *
     * A página A (o mapa) para DENTRO da primeira escrita de slot, antes de aplicá-la, e é isso
     * que faz a página B (a tela "Seus atlas") ler o registro ainda vazio e reivindicar também.
     * `seguraReleituraDoSegundo` decide a ORDEM das releituras: com ele, B também para, na
     * releitura que vem logo depois da própria escrita, e só relê depois de A ter resolvido.
     *
     * @param {boolean} seguraReleituraDoSegundo - Segurar a releitura da segunda página.
     * @returns {Promise<{paginaA: Object, paginaB: Object, reivindicados: string[]}>}
     */
    async function encenar(seguraReleituraDoSegundo) {
        const paginaA = await carregarPagina();
        const paginaB = await carregarPagina();

        const global = raw('ebgeo_global');
        const escritaReal = global.setItem.getMockImplementation();
        const leituraReal = global.keys.getMockImplementation();
        const reivindicados = [];
        const portaDaEscrita = criarPorta();
        const portaDaReleitura = criarPorta();
        let avisarEscrita;
        const chegouNaEscrita = new Promise(resolve => { avisarEscrita = resolve; });
        let avisarReleitura;
        const chegouNaReleitura = new Promise(resolve => { avisarReleitura = resolve; });
        let escritasDeSlot = 0;
        let segurarProximaLeitura = false;

        global.setItem.mockImplementation(async (chave, valor) => {
            if (!chave.startsWith(PREFIXO_DE_SLOT)) return escritaReal(chave, valor);
            // A ordem da PRÓPRIA escrita, presa numa variável local: o contador é compartilhado
            // pelas duas páginas, e lê-lo depois do `await` daria à página A o número da B.
            escritasDeSlot += 1;
            const minhaOrdem = escritasDeSlot;
            reivindicados.push(chave.slice(PREFIXO_DE_SLOT.length));
            if (minhaOrdem === 1) {
                avisarEscrita();
                await portaDaEscrita.promessa;
            }
            const saida = await escritaReal(chave, valor);
            if (minhaOrdem === 2 && seguraReleituraDoSegundo) segurarProximaLeitura = true;
            return saida;
        });
        global.keys.mockImplementation(async () => {
            if (segurarProximaLeitura) {
                segurarProximaLeitura = false;
                avisarReleitura();
                await portaDaReleitura.promessa;
            }
            return leituraReal();
        });

        const bootA = bootarOMapa(paginaA);
        await chegouNaEscrita;
        const abriuB = abrirSeusAtlas(paginaB);
        if (seguraReleituraDoSegundo) {
            await chegouNaReleitura;
        } else {
            await abriuB;
        }
        portaDaEscrita.abrir();
        await bootA;
        portaDaReleitura.abrir();
        await abriuB;

        return { paginaA, paginaB, reivindicados };
    }

    /**
     * @param {string[]} reivindicados - Ids escritos no disco durante a encenação.
     * @returns {string} O menor deles, que é o vencedor por definição da regra.
     */
    function menorId(reivindicados) {
        return [...new Set(reivindicados)].sort()[0];
    }

    it('o vencedor lendo por último PODA a entrada duplicada, e sobra a de menor id', async () => {
        await semearInstalacaoDaOutraLinha();
        const { paginaA, reivindicados } = await encenar(false);

        const vencedor = menorId(reivindicados);
        const disco = await discoGlobal();
        expect(reivindicados.length).toBeGreaterThanOrEqual(2);
        expect((await slotsQueReivindicamOsBancosSemSufixo()).map(e => e.id)).toEqual([vencedor]);
        expect(disco.get('current_local_atlas')).toBe(vencedor);
        expect(paginaA.localAtlas.listLocalAtlases().map(e => e.id)).toEqual([vencedor]);
        expect((await raw('ebgeo_maps').keys()).length).toBe(MAPAS);
    });

    it('CONTROLE: a página podada continua montada nos MESMOS bancos, e nada se perde nela', async () => {
        // A perdedora desta ordem terminou antes de a rival existir no disco, então o espelho em
        // memória dela ainda diz o próprio id. Isso é cosmético e converge no boot seguinte: o
        // `dbSuffix` das duas é a string vazia, ou seja, os mesmos onze bancos, e é por isso que
        // podar a entrada não é podar dado.
        await semearInstalacaoDaOutraLinha();
        const { paginaB } = await encenar(false);

        expect(paginaB.ns.getActiveScope().dbSuffix).toBe('');
    });

    it('o perdedor lendo por último RECUA e adota o vencedor, com os dois espelhos nele', async () => {
        await semearInstalacaoDaOutraLinha();
        const { paginaA, paginaB, reivindicados } = await encenar(true);

        const vencedor = menorId(reivindicados);
        const disco = await discoGlobal();
        expect((await slotsQueReivindicamOsBancosSemSufixo()).map(e => e.id)).toEqual([vencedor]);
        expect(disco.get('current_local_atlas')).toBe(vencedor);
        expect({
            espelhoDoMapa: paginaA.localAtlas.listLocalAtlases().map(e => e.id),
            espelhoDaTela: paginaB.localAtlas.listLocalAtlases().map(e => e.id),
            correnteNoMapa: paginaA.localAtlas.getCurrentLocalAtlasId(),
            correnteNaTela: paginaB.localAtlas.getCurrentLocalAtlasId(),
            mapas: (await raw('ebgeo_maps').keys()).length
        }).toEqual({
            espelhoDoMapa: [vencedor],
            espelhoDaTela: [vencedor],
            correnteNoMapa: vencedor,
            correnteNaTela: vencedor,
            mapas: MAPAS
        });
    });
});

// ============================================================================
// C2: excluir um slot NÃO derruba bancos que outra entrada ainda referencia
// ============================================================================
//
// `dropAtlasDatabases` resolve o alvo pelo `dbSuffix`, e o registro não garante uma entrada por
// sufixo: a corrida do C1 produz duas, e um registro escrito por fora pode produzir qualquer
// coisa. A recusa por contagem (`entries.length === 1`) não cobre isso, porque com dois cartões
// excluir qualquer um passa. A guarda relê o disco na hora e, achando outro dono do mesmo
// endereço, tira a ENTRADA e deixa os BANCOS.

describe('C2: a exclusão relê o registro antes de derrubar banco', () => {
    /**
     * Escreve DUAS entradas de registro sobre o mesmo `dbSuffix` vazio, direto no disco, que é o
     * estado que a corrida do B4-3 produzia antes do C1.
     * @returns {Promise<void>}
     */
    async function semearDoisDonosDoMesmoSufixo() {
        await raw('ebgeo_global').setItem(localAtlasDiskKey('slot-1'), {
            version: 1, id: 'slot-1', name: 'Atlas do Chefe', dbSuffix: '', createdAt: 1, updatedAt: 1
        });
        await raw('ebgeo_global').setItem(localAtlasDiskKey('slot-2'), {
            version: 1, id: 'slot-2', name: 'Meu Atlas', dbSuffix: '', createdAt: 2, updatedAt: 2
        });
        await raw('ebgeo_global').setItem('current_local_atlas', 'slot-1');
    }

    it('com dois donos do sufixo vazio, excluir um tira a entrada e NÃO derruba os 14 mapas', async () => {
        await semearInstalacaoDaOutraLinha();
        await semearDoisDonosDoMesmoSufixo();

        const pagina = await carregarPagina();
        await pagina.localAtlas.initLocalAtlases({ origin: ORIGEM_LOCAL, isAuthenticated: false });
        const resultado = await pagina.localAtlas.deleteLocalAtlas('slot-2');

        expect({
            ok: resultado.ok,
            derrubados: resultado.droppedDatabases,
            porque: resultado.keptDatabases,
            cartoes: pagina.localAtlas.listLocalAtlases().map(e => e.id),
            mapas: (await raw('ebgeo_maps').keys()).length,
            registroDeAtlas: (await raw('ebgeo_atlas').getItem('current_atlas'))?.mapOrder?.length
        }).toEqual({
            ok: true,
            derrubados: [],
            porque: pagina.localAtlas.LocalAtlasKept.SHARED_DB_SUFFIX,
            cartoes: ['slot-1'],
            mapas: MAPAS,
            registroDeAtlas: MAPAS
        });
    });

    it('CONTROLE: com sufixos DIFERENTES a exclusão continua derrubando os bancos do slot', async () => {
        // Sem este caso, "nunca derruba" passaria, e a exclusão de atlas local deixaria dez
        // bancos órfãos por gesto do usuário, que é o defeito oposto e mais caro.
        await semearInstalacaoDaOutraLinha();
        await raw('ebgeo_global').setItem(localAtlasDiskKey('slot-1'), {
            version: 1, id: 'slot-1', name: 'Atlas do Chefe', dbSuffix: '', createdAt: 1, updatedAt: 1
        });
        await raw('ebgeo_global').setItem(localAtlasDiskKey('slot-2'), {
            version: 1, id: 'slot-2', name: 'Bravo', dbSuffix: 'slot-2', createdAt: 2, updatedAt: 2
        });
        await raw('ebgeo_global').setItem('current_local_atlas', 'slot-1');
        await makeStore({ name: 'ebgeo_maps__slot-2' }).setItem('Mapa do Bravo', { id: 'b-1' });

        const pagina = await carregarPagina();
        await pagina.localAtlas.initLocalAtlases({ origin: ORIGEM_LOCAL, isAuthenticated: false });
        const resultado = await pagina.localAtlas.deleteLocalAtlas('slot-2');

        expect({
            porque: resultado.keptDatabases,
            derrubouAlgum: (resultado.droppedDatabases ?? []).length > 0,
            bancoDoBravo: databases.has('ebgeo_maps__slot-2'),
            mapasDoSlotUm: (await raw('ebgeo_maps').keys()).length
        }).toEqual({
            porque: undefined,
            derrubouAlgum: true,
            bancoDoBravo: false,
            mapasDoSlotUm: MAPAS
        });
    });
});

// ============================================================================
// B4-2: a reivindicação sem degrau, e a guarda da fila que deixa de correr
// ============================================================================

describe('B4-2: "Seus atlas" reivindica os bancos antes de o degrau 3.0 correr', () => {
    it('CONTROLE: abrindo o MAPA primeiro, o ramo é a adoção e a fila legada é descartada', async () => {
        await semearInstalacaoDaOutraLinha();
        const fila = makeStore({ name: 'ebgeo', storeName: 'operation_queue' });
        for (let i = 1; i <= 446; i++) {
            await fila.setItem(`op_${i}_x`, { id: `op-${i}`, type: 'feature.create', data: {} });
        }

        const { ramo } = await bootarOMapa(await carregarPagina());

        expect({ ramo, naFila: (await fila.keys()).length })
            .toEqual({ ramo: 'adocao-do-legado', naFila: 0 });
    });

    it('abrindo "Seus atlas" primeiro, a fila legada da outra linha SOBREVIVE ao degrau', async () => {
        // A tela "Seus atlas" escreve a entrada de sufixo vazio e não roda migração nenhuma
        // (`atlas.html` boota sem a store). O boot do mapa em seguida lê o registro, encontra
        // os bancos JÁ reivindicados e toma o ramo "ja-adotado", que por desenho não descarta
        // a fila. As 446 operações que a outra linha enfileirou ficam.
        await semearInstalacaoDaOutraLinha();
        const fila = makeStore({ name: 'ebgeo', storeName: 'operation_queue' });
        for (let i = 1; i <= 446; i++) {
            await fila.setItem(`op_${i}_x`, { id: `op-${i}`, type: 'feature.create', data: {} });
        }

        await abrirSeusAtlas(await carregarPagina());
        await bootarOMapa(await carregarPagina());

        // A asserção é sobre a FILA, não sobre o nome do ramo: um conserto pode manter o ramo
        // "ja-adotado" e ainda assim descartar, e prender o rótulo aqui reprovaria esse conserto.
        expect({ naFila: (await fila.keys()).length, mapas: (await raw('ebgeo_maps').keys()).length })
            .toEqual({ naFila: 0, mapas: MAPAS });
    });

    it('e os 14 mapas continuam de pé nos dois caminhos', async () => {
        // O controle positivo do bloco: o que muda entre as duas ordens é a FILA, nunca o
        // acervo. Sem ele, um vermelho acima se leria como perda de mapa.
        await semearInstalacaoDaOutraLinha();
        await abrirSeusAtlas(await carregarPagina());
        await bootarOMapa(await carregarPagina());

        expect((await raw('ebgeo_maps').keys()).length).toBe(MAPAS);
    });

    it('CONTROLE: uma instalação DESTA linha que já atravessou não tem a fila mexida', async () => {
        // A guarda é DELIBERADAMENTE ESTREITA, e este caso é o que a mantém estreita. A marca
        // `adoptedLegacy` nasce com o conserto, então uma entrada escrita por um build ANTERIOR
        // não a tem, e é assim que se reconhece a instalação desta linha que já atravessou: ela
        // pode ter trabalho pendente com um servidor de verdade para alcançar, e descartar essa
        // fila seria trocar uma guarda por outra, que não é conserto. O carimbo do settings fica
        // deliberadamente FORA de 3.0, para que o que decida seja a AUSÊNCIA da marca e não o
        // carimbo já estar na versão do degrau.
        await semearInstalacaoDaOutraLinha();
        await raw('ebgeo_global').setItem(localAtlasDiskKey('slot-1'), {
            version: 1, id: 'slot-1', name: 'Atlas do Chefe', dbSuffix: '', createdAt: 1, updatedAt: 1
        });
        await raw('ebgeo_global').setItem('current_local_atlas', 'slot-1');
        const fila = makeStore({ name: 'ebgeo', storeName: 'operation_queue' });
        for (let i = 1; i <= 12; i++) {
            await fila.setItem(`op_${i}_x`, { id: `op-${i}`, type: 'feature.create', data: {} });
        }

        await bootarOMapa(await carregarPagina());

        expect({ naFila: (await fila.keys()).length, mapas: (await raw('ebgeo_maps').keys()).length })
            .toEqual({ naFila: 12, mapas: MAPAS });
    });
});

// ============================================================================
// B4-5: as formas degeneradas do registro global
// ============================================================================

describe('B4-5: registro global parcial ou corrompido', () => {
    it('CONVERGE: entrada de sufixo vazio sem o ponteiro current_local_atlas', async () => {
        // A escrita de `persistRegistry` é entrada(s) e DEPOIS o ponteiro, então este é o estado
        // que uma aba morta no meio deixa. O boot repara o ponteiro e não duplica nada.
        await semearInstalacaoDaOutraLinha();
        await raw('ebgeo_global').setItem(localAtlasDiskKey('slot-1'), {
            version: 1, id: 'slot-1', name: 'Atlas do Chefe', dbSuffix: '', createdAt: 1, updatedAt: 1
        });

        await bootarOMapa(await carregarPagina());

        const disco = await discoGlobal();
        expect({
            donos: localSlotsOnDisk(disco).filter(e => e.dbSuffix === '').length,
            ponteiro: disco.get('current_local_atlas'),
            mapas: (await raw('ebgeo_maps').keys()).length
        }).toEqual({ donos: 1, ponteiro: 'slot-1', mapas: MAPAS });
    });

    it('CONVERGE: registro presente e ebgeo_atlas ausente', async () => {
        // `stampVersion` sai cedo quando não há registro de atlas, e `nameOfAdoptedAtlas`
        // devolve undefined. Nada é destruído e o carimbo do settings sai na versão corrente.
        await semearInstalacaoDaOutraLinha();
        await raw('ebgeo_atlas').clear();
        await raw('ebgeo_global').setItem(localAtlasDiskKey('slot-1'), {
            version: 1, id: 'slot-1', name: 'Atlas do Chefe', dbSuffix: '', createdAt: 1, updatedAt: 1
        });
        await raw('ebgeo_global').setItem('current_local_atlas', 'slot-1');

        await bootarOMapa(await carregarPagina());

        expect({
            mapas: (await raw('ebgeo_maps').keys()).length,
            carimbo: await raw('ebgeo_app_settings').getItem('schemaVersion')
        }).toEqual({ mapas: MAPAS, carimbo: '3.0' });
    });

    it('um slot cujo VALOR não se lê some do registro, e o boot reivindica os bancos de novo', async () => {
        // `loadRegistry` (`local-atlas.api.js`) descarta a entrada cujo valor não é objeto, e o
        // comentário logo acima do `continue` promete o CONTRÁRIO ("a value that failed to parse
        // still yields an enumerable slot"), promessa que o instrumento de teste da casa
        // (`tests/helpers/atlas-registry-disk.js`) repete. Com o slot fora da lista o registro
        // fica VAZIO, `bootstrapEntry` corre, e o disco passa a ter DUAS chaves para os mesmos
        // bancos: a ilegível e a nova.
        await semearInstalacaoDaOutraLinha();
        await raw('ebgeo_global').setItem(localAtlasDiskKey('slot-1'), 'valor-que-nao-e-objeto');
        await raw('ebgeo_global').setItem('current_local_atlas', 'slot-1');

        const pagina = await carregarPagina();
        await bootarOMapa(pagina);

        expect({
            chavesDeSlotNoDisco: localSlotsOnDisk(await discoGlobal()).length,
            slotsQueOAppEnxerga: pagina.localAtlas.listLocalAtlases().length
        }).toEqual({ chavesDeSlotNoDisco: 1, slotsQueOAppEnxerga: 1 });
    });
});

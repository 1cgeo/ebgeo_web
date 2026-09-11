// Path: tests/store/falha-de-migracao-no-boot.test.js
//
// O QUE O BOOT FAZ COM UMA MIGRAÇÃO QUE FALHA, e quem fica sabendo.
//
// O `fileoverview` de `src/js/store/migration/migration.service.js` diz, na segunda linha: "If
// migration fails, an error is thrown and the application aborts". O erro é de fato lançado, e a
// aplicação NÃO aborta: `initializeRepository` (`src/js/store/repository.js`) envolve a cadeia
// inteira num `try` cujo `catch` devolve `DEFAULT_MAP_NAME` e segue. Um `QuotaExceededError` no
// carimbo do degrau 3.0, que é o erro que a cota do navegador produz e o mais provável de todos
// numa instalação com 149 imagens, deixa o usuário dentro de um mapa "Principal" que o acervo
// dele não tem, sem uma palavra na tela.
//
// O bloco de cota fica ao lado do CONTROLE que mostra o disco convergindo no boot seguinte,
// porque é isso que separa "a sessão cai no lugar errado" de "o acervo se perdeu": nenhum byte
// se perde, e a segunda metade dessa frase é o que impede o achado de ser lido como maior do que
// é.
//
// O segundo bloco mede a ordem das escritas de `bootstrapEntry`: ele empurra a entrada para o
// espelho em memória ANTES de persistir. A regra contrária está escrita no próprio arquivo, no
// comentário de `persistRegistryEntry` ("A mirror updated before the disk is a claim the next
// boot cannot honour"), e vale para o vizinho de baixo tanto quanto para ele.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { localSlotsOnDisk } from '../helpers/atlas-registry-disk.js';

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
// Insumo e ajudantes
// ============================================================================

const MAPAS = 14;

/** Escreve direto no fake, sem passar pelo código sob teste. */
function raw(dbName) {
    return makeStore({ name: dbName });
}

/** @returns {Promise<void>} Uma instalação da outra linha, carimbada '2.4', sem registro global. */
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

/** @returns {Promise<Object>} Um grafo de módulos NOVO. */
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
    const origin = await import('@store/store-origin.js');
    return { localAtlas, adocao, repository, origin };
}

/**
 * O prefixo do boot do MAPA, nas chamadas e na ordem de `initializeWithLastActiveMap`
 * (`src/js/store/store.js`), sem as partes que exigem o `eventBus` e o gerente de mapas.
 * @param {Object} pagina - Um grafo devolvido por `carregarPagina`.
 * @returns {Promise<string>} A CHAVE de entrada que `initializeRepository` devolveu.
 */
async function bootarOMapa(pagina) {
    await pagina.origin.loadStoreOrigin();
    const origem = pagina.origin.getStoreOriginSync();
    const observado = await pagina.adocao.observeLegacyInstallation(origem);
    await pagina.localAtlas.initLocalAtlases({
        origin: origem,
        isAuthenticated: false,
        preferTabMountPointer: true,
        bootstrapName: observado.bootstrapName
    });
    return pagina.repository.initializeRepository();
}

/**
 * Faz a escrita do carimbo de esquema estourar a cota, uma vez.
 *
 * É o insumo degenerado do bloco: `QuotaExceededError` é o erro que o navegador levanta quando o
 * grupo de origem enche, e a instalação que atravessa carrega os blobs de 149 imagens.
 * @returns {void}
 */
function estourarCotaNoCarimbo() {
    const app = raw('ebgeo_app_settings');
    const escritaReal = app.setItem.getMockImplementation();
    app.setItem.mockImplementation(async (chave, valor) => {
        if (chave === 'schemaVersion' && valor === '3.0') {
            const erro = new Error('Failed to execute setItem: quota exceeded');
            erro.name = 'QuotaExceededError';
            throw erro;
        }
        return escritaReal(chave, valor);
    });
}

/** @returns {Promise<Map<string, *>>} O banco global lido cru. */
async function discoGlobal() {
    const store = raw('ebgeo_global');
    const saida = new Map();
    for (const chave of await store.keys()) saida.set(chave, await store.getItem(chave));
    return saida;
}

beforeEach(() => {
    resetFake();
    uuidCounter.value = 0;
    vi.restoreAllMocks();
});

// ============================================================================
// B4-4: a cota estoura no degrau, e o boot não conta a ninguém
// ============================================================================

describe('B4-4: QuotaExceededError no carimbo do degrau 3.0', () => {
    it('CONTROLE: sem cota estourada o boot entra no mapa que o usuário deixou aberto', async () => {
        await semearInstalacaoDaOutraLinha();

        const entrada = await bootarOMapa(await carregarPagina());

        expect(entrada).toBe('Mapa 1');
    });

    it('a falha não pode devolver ao boot um mapa que o acervo não tem', async () => {
        // `safelyMigrate` lança, `initializeRepository` engole no `catch` de fora e devolve
        // `DEFAULT_MAP_NAME`. Nenhum dos 14 mapas se chama assim, então o boot segue para um
        // mapa inexistente com o acervo inteiro no disco, sem erro para quem chamou.
        await semearInstalacaoDaOutraLinha();
        estourarCotaNoCarimbo();

        const pagina = await carregarPagina();
        const entrada = await bootarOMapa(pagina);

        const mapasNoDisco = await raw('ebgeo_maps').keys();
        expect(mapasNoDisco).toContain(entrada);
    });

    it('CONTROLE do tamanho do estrago: o disco converge no boot seguinte', async () => {
        // O achado acima é sobre a SESSÃO, não sobre o acervo. Sem este caso ele se leria como
        // perda de dado, e não é: os 14 mapas ficam e o segundo boot carimba 3.0.
        await semearInstalacaoDaOutraLinha();
        estourarCotaNoCarimbo();
        await bootarOMapa(await carregarPagina());

        raw('ebgeo_app_settings').setItem.mockImplementation(async (chave, valor) => {
            raw('ebgeo_app_settings').__backing.set(chave, valor);
            return valor;
        });
        await bootarOMapa(await carregarPagina());

        expect({
            mapas: (await raw('ebgeo_maps').keys()).length,
            carimbo: await raw('ebgeo_app_settings').getItem('schemaVersion')
        }).toEqual({ mapas: MAPAS, carimbo: '3.0' });
    });
});

// ============================================================================
// B4-4b: o espelho em memória vai na frente do disco
// ============================================================================

describe('B4-4b: bootstrapEntry escreve o espelho antes do disco', () => {
    it('uma escrita de registro que falha não pode deixar um slot só na memória', async () => {
        // `bootstrapEntry` faz `_entries.push(entry)` e só depois `persistRegistry()`. Com a
        // escrita do banco global recusada, o `listLocalAtlases()` desta página anuncia um slot
        // que o disco não tem, e é dele que a tela "Seus atlas" e o teto de dez atlas leem. A
        // regra contrária está escrita no comentário de `persistRegistryEntry`, no mesmo arquivo.
        await semearInstalacaoDaOutraLinha();
        const global = raw('ebgeo_global');
        global.setItem.mockImplementation(async () => {
            const erro = new Error('Failed to execute setItem: quota exceeded');
            erro.name = 'QuotaExceededError';
            throw erro;
        });

        const pagina = await carregarPagina();
        await expect(bootarOMapa(pagina)).rejects.toThrow(/quota/i);

        expect({
            naMemoria: pagina.localAtlas.listLocalAtlases().length,
            noDisco: localSlotsOnDisk(await discoGlobal()).length
        }).toEqual({ naMemoria: 0, noDisco: 0 });
    });
});

// ============================================================================
// B4-4c: o descarte do resíduo REMOTO não é atômico nem observado
// ============================================================================

describe('B4-4c: discardRemoteResidue parcial', () => {
    /** Os dez bancos por atlas do escopo sem sufixo, na ordem dos descritores. */
    const BANCOS_POR_ATLAS = [
        'ebgeo_atlas', 'ebgeo_maps', 'ebgeo_images', 'ebgeo_app_settings', 'ebgeo_groups',
        'ebgeo_layers', 'ebgeo_cesium3d', 'ebgeo_streetview360', 'ebgeo_briefings', 'ebgeo_comments'
    ];

    it('uma limpeza que falha no meio não pode abortar a varredura dos demais bancos', async () => {
        // `discardRemoteResidue` (`v2.x-to-v3.0.migration.js`) percorre `listAtlasStores` com um
        // `for` e um `await` dentro, sem `allSettled`: a primeira rejeição interrompe a varredura
        // e os bancos ainda não visitados nem chegam a ser TENTADOS. A invariante que o degrau
        // carrega é que nenhum byte de atlas de servidor sobrevive, e um banco que ninguém tentou
        // esvaziar é a forma mais barata de quebrá-la. A medida é a TENTATIVA, e não o resultado,
        // porque o banco que rejeita continua cheio depois de qualquer conserto.
        //
        // Alcance honesto: pelo boot completo esta função quase não se alcança, porque
        // `enforceLocalStoreWhenLoggedOut` normaliza o marcador para LOCAL antes, e o boot
        // seguinte expurga o que sobrou. Ela é o caminho de quem chama `safelyMigrate()` direto.
        await semearInstalacaoDaOutraLinha();
        await raw('ebgeo_app_settings').setItem('__store_origin__', {
            kind: 'remote', atlasId: 'atlas-de-outra-gente'
        });
        await raw('ebgeo_briefings').setItem('briefing-1', { id: 'briefing-1', slides: [] });
        await raw('ebgeo_comments').setItem('comments_Mapa 1', { 'c-1': { id: 'c-1' } });

        // O SEGUNDO banco da lista rejeita: com o laço, os oito seguintes nem são visitados.
        raw('ebgeo_maps').clear.mockImplementation(async () => {
            const erro = new Error('disco indisponivel');
            erro.name = 'UnknownError';
            throw erro;
        });
        for (const nome of BANCOS_POR_ATLAS) raw(nome).clear.mockClear();

        vi.resetModules();
        const service = await import('@store/migration/migration.service.js');
        await expect(service.safelyMigrate()).rejects.toThrow();

        const tentados = BANCOS_POR_ATLAS.filter(nome => raw(nome).clear.mock.calls.length > 0);
        expect(tentados).toEqual(BANCOS_POR_ATLAS);
    });
});

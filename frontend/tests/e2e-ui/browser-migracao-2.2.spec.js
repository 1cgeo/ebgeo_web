// Path: e2e-ui/browser-migracao-2.2.spec.js

/**
 * @fileoverview O usuário de PRODUÇÃO atualiza sem perder nada, medido em Chromium de verdade.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ESTE ARQUIVO PRECISA EXISTIR, SE A MIGRAÇÃO JÁ TEM 22 CASOS
 * ---------------------------------------------------------------------------
 * Produção hoje é o branch `main`: IndexedDB no schema 2.2, sem backend. A fase de namespace
 * por atlas leva esse usuário para 2.3, e `tests/integration/migracao-22-para-23-fixture-real.test.js`
 * cobre a transição com 22 casos dirigidos pelas MESMAS fixtures que este arquivo usa.
 *
 * Aqueles 22 casos rodam sobre `fake-indexeddb`, e existe uma classe inteira de comportamento
 * que um duplo em processo não tem: `Blob` de verdade (o duplo obriga a guardar bytes crus, e o
 * porquê está medido em `IMAGE_VALUE_FORM`) e duas ABAS disputando os mesmos bancos. Migração é
 * justamente o momento em que isso aparece, porque é quando bancos são abertos, adotados e
 * carimbados.
 *
 * Ou seja: os 22 casos respondem "a lógica da migração está certa"; este arquivo responde "o
 * usuário de produção atualiza sem perder nada". São perguntas diferentes, e a segunda não tinha
 * resposta nenhuma até aqui.
 *
 * ---------------------------------------------------------------------------
 * A SEMEADURA ACONTECE ANTES DO PRIMEIRO BOOT, E ISSO NÃO É DETALHE
 * ---------------------------------------------------------------------------
 * Semear é escrever nove bancos pré-namespace. Se o app bootar antes disso, ele já criou o
 * registro local, adotou o slot #1 e escreveu um mapa em branco, e a fixture cairia EM CIMA de
 * uma instalação 2.3 recém-nascida: o teste mediria uma fusão que nenhum usuário vive. Por isso
 * a semeadura roda numa página EM BRANCO da mesma origem (`page.route` cumpre um HTML mínimo), e
 * o `goto('/')` seguinte é o ATO sob medição, o primeiro boot que aquela instalação já viu.
 *
 * O layout de chaves NÃO é reescrito aqui. `buildLegacyEntries` (em `tests/helpers/ebgeo-fixture.js`)
 * é a fonte única, compartilhada com o harness de nó; os NOMES dos bancos vêm de `resolveDbName`
 * do próprio app, e a escrita passa por `getStoreFor`, que é a fábrica que o app usa. Nada aqui
 * concatena nome de banco nem inventa prefixo de chave: as duas coisas são cópias que derivam e
 * depois certificam a deriva.
 *
 * ---------------------------------------------------------------------------
 * O QUE UM VERDE AQUI NÃO DIZ
 * ---------------------------------------------------------------------------
 * O `.ebgeo` não é um dump de disco. `exportProject` RECONSTRÓI o payload de cada mapa e
 * hardcoda `hillshadeEnabled`/`analysisLayers`; a lista completa do que o exportador inventa,
 * omite ou muda de lugar está no `@fileoverview` de `tests/helpers/ebgeo-fixture.js`. O que se
 * prova é que a migração sobrevive a ESSA forma, com os volumes reais de um projeto de verdade.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { buildLegacyEntries, countFixture, LEGACY_STORE_IDS, loadEbgeoFixture } from '../helpers/ebgeo-fixture.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** Path served as an empty same-origin document, so seeding happens with the app NOT booted. */
const BLANK_PATH = '/__seed-2.2__';

/**
 * Números que o README da fixture declara. Escritos por extenso, não derivados: uma fixture que
 * mude em silêncio precisa ficar VERMELHA aqui, e não redefinir o que "sobreviveu" significa.
 */
const DECLARADO = Object.freeze({
    maps: 11, features: 262, layers: 17, groups: 2,
    briefings: 2, customIcons: 2, images: 5,
});

/**
 * Ids das feições de declinação magnética do arquivo.
 *
 * Cada uma delas ganha uma entrada no banco de imagens quando é desenhada, porque o diagrama é
 * um PNG gerado em runtime e guardado sob o ID DA FEIÇÃO. É o único habitante legítimo daquele
 * banco que não veio do arquivo, e nomeá-lo é o que separa "cache de render" de "chave estranha".
 * @param {{ data: Object }} fixture - Arquivo carregado.
 * @returns {string[]}
 */
function declinationFeatureIds({ data }) {
    const ids = [];
    for (const mapa of Object.values(data.maps ?? {})) {
        for (const feicao of mapa.features?.magnetic_declinations ?? []) {
            if (feicao?.properties?.id) ids.push(feicao.properties.id);
        }
    }
    return ids;
}

/**
 * Abre uma página em branco da MESMA ORIGEM, onde o app não boota.
 *
 * `page.route` intercepta antes da rede, então não importa o que o Vite faria com este caminho.
 * A origem é o que importa: `import('/src/js/...')` é servido e transformado pelo Vite, e o
 * IndexedDB é o mesmo que o app usa.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
async function goToBlankSameOrigin(page) {
    await page.route(`**${BLANK_PATH}`, route => route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><meta charset="utf-8"><title>seed 2.2</title>',
    }));
    await page.goto(BLANK_PATH);
}

/**
 * Escreve, DENTRO do navegador, a instalação 2.2 que um usuário de `main` tem no disco.
 *
 * @param {import('@playwright/test').Page} page - Página em branco da origem do app.
 * @param {Object<string, Object<string, *>>} entries - Saída de `buildLegacyEntries`, com as
 *   imagens já em array de bytes (um `Uint8Array` não sobrevive à travessia para a página).
 * @param {string[]} storeIds - Os nove `StoreName` que `main` cria.
 * @returns {Promise<{dbNames: string[], relidos: Object<string, number>}>}
 */
function seedLegacyInstall(page, entries, storeIds) {
    return page.evaluate(async ({ entries: porStore, storeIds: ids }) => {
        const ns = await import('/src/js/store/atlas-namespace.js');
        // O escopo LEGADO é o de sufixo vazio: `resolveDbName` devolve `ebgeo_maps`, e não
        // `ebgeo_maps__algo`. Construir os nomes na mão aqui seria a segunda implementação da
        // regra de nomes, que é exatamente o que a fábrica existe para impedir.
        const legado = ns.localScope('legacy-workspace', ns.LEGACY_DB_SUFFIX);

        const dbNames = [];
        const relidos = {};
        for (const id of ids) {
            const store = ns.getStoreFor(id, legado);
            dbNames.push(ns.resolveDbName(id, legado));
            for (const [chave, valor] of Object.entries(porStore[id] ?? {})) {
                // Imagem volta a ser BLOB aqui, que é o que `main` guarda de verdade
                // (`local.repository.js`, `saveImage`). O harness de nó não consegue: sem
                // `FileReader`, o localforage cai em `_encodeBlob` e a escrita lança.
                const gravar = id === 'images'
                    ? new Blob([new Uint8Array(valor)], { type: 'image/png' })
                    : valor;
                await store.setItem(chave, gravar);
            }
            relidos[id] = await store.length();
        }

        return { dbNames: dbNames.sort(), relidos };
    }, { entries, storeIds });
}

/**
 * Conta o que sobreviveu ao boot, pelo repositório real do app e pelos nomes de banco no disco.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<Object>}
 */
function readAfterBoot(page) {
    return page.evaluate(async () => {
        const store = await import('/src/js/store/index.js');
        const ns = await import('/src/js/store/atlas-namespace.js');

        const mapNames = await store.getAllMapNamesStore();
        let features = 0;
        const featuresByMap = {};
        for (const nome of mapNames) {
            const porTipo = await store.getCurrentMapFeatures(nome);
            let n = 0;
            for (const lista of Object.values(porTipo ?? {})) {
                if (Array.isArray(lista)) n += lista.length;
            }
            featuresByMap[nome] = n;
            features += n;
        }

        const settings = ns.getStore(ns.StoreName.SETTINGS);
        let layers = 0;
        await ns.getStore(ns.StoreName.LAYERS).iterate((valor, chave) => {
            if (chave.startsWith('layers_') && Array.isArray(valor)) layers += valor.length;
        });
        let groups = 0;
        await ns.getStore(ns.StoreName.GROUPS).iterate((valor) => {
            groups += Object.keys(valor ?? {}).length;
        });

        const imagens = [];
        await ns.getStore(ns.StoreName.IMAGES).iterate((valor, chave) => {
            imagens.push({
                key: chave,
                isBlob: valor instanceof Blob,
                type: valor instanceof Blob ? valor.type : typeof valor,
                size: valor instanceof Blob ? valor.size : (valor?.byteLength ?? valor?.length ?? 0),
            });
        });

        return {
            mapNames: mapNames.slice().sort(),
            features,
            featuresByMap,
            layers,
            groups,
            briefings: await ns.getStore(ns.StoreName.BRIEFINGS).length(),
            customIcons: ((await settings.getItem('custom_icons')) ?? []).length,
            imagens,
            schemaVersion: await settings.getItem('schemaVersion'),
            mapsDbName: ns.resolveDbName(ns.StoreName.MAPS),
            dbs: (await indexedDB.databases()).map(d => d.name).filter(Boolean).sort(),
        };
    });
}

/**
 * Espera o mapa ficar pronto. O boot é fail-fast em `GET /api/config`, e o proxy do Vite já
 * aponta para o backend descartável, então uma página anônima chega ao mapa sem login.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
function waitForMap(page) {
    return page.waitForFunction(
        () => globalThis.__ebgeoMap
            && typeof globalThis.__ebgeoMap.loaded === 'function'
            && globalThis.__ebgeoMap.loaded(),
        { timeout: 60000 });
}

/**
 * Prepara uma instalação 2.2 numa aba nova e devolve a página, ainda sem ter bootado o app.
 * @param {import('@playwright/test').Browser} browser
 * @param {string} fileName - Arquivo em `tests/fixtures/ebgeo-2.2/`.
 * @returns {Promise<Object>}
 */
async function prepareLegacyInstall(browser, fileName) {
    const fixture = await loadEbgeoFixture(fileName);
    const declarado = countFixture(fixture);

    // A fixture é o SUJEITO do teste: vinda vazia, tudo abaixo passaria por vacuidade.
    expect(declarado.schemaVersion, 'a fixture parte de 2.2').toBe('2.2');
    expect(declarado.maps, 'a fixture declara mapas').toBeGreaterThan(0);

    const entries = buildLegacyEntries(fixture, {
        // Um `Uint8Array` vira `{0:…,1:…}` na travessia para a página. Vai como array e volta a
        // ser `Blob` lá dentro, que é a forma que `main` guarda.
        imageValue: bytes => Array.from(bytes),
        now: 1755000000000,
    });

    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await goToBlankSameOrigin(page);
    const semeado = await seedLegacyInstall(page, entries, LEGACY_STORE_IDS);

    return { ctx, page, fixture, declarado, semeado };
}

describeOrSkip('Migração 2.2 para 2.3 em Chromium, com a fixture de produção', () => {
    test('o usuário de `main` atualiza e não perde mapa, feição, camada, briefing nem imagem', async ({ browser }, testInfo) => {
        test.setTimeout(180000);

        const { ctx, page, declarado, semeado, fixture } = await prepareLegacyInstall(browser, '01-completo.ebgeo');
        try {
            expect(declarado, 'a fixture ainda é a que o README descreve').toMatchObject(DECLARADO);

            await testInfo.attach('instalação 2.2 semeada', {
                body: JSON.stringify(semeado, null, 2), contentType: 'application/json',
            });

            // CONTROLE POSITIVO, antes do ato: sem ele, "sobreviveu" e "nunca existiu" são o
            // mesmo verde.
            expect(semeado.relidos.maps, 'os mapas foram escritos no disco').toBe(DECLARADO.maps);
            expect(semeado.relidos.images, 'as imagens foram escritas no disco').toBe(DECLARADO.images);
            expect(semeado.dbNames, 'a instalação semeada é PRÉ-NAMESPACE, sem sufixo')
                .toEqual(expect.arrayContaining(['ebgeo_maps', 'ebgeo_app_settings', 'ebgeo_atlas']));
            expect(semeado.dbNames.filter(n => n.includes('__')), 'nenhum banco sufixado antes do boot')
                .toEqual([]);

            // ---- O ATO: abrir o app. É o boot real que migra. ----
            await page.goto('/');
            await waitForMap(page);

            const depois = await readAfterBoot(page);
            await testInfo.attach('estado depois do boot que migrou', {
                body: JSON.stringify(depois, null, 2), contentType: 'application/json',
            });

            // 1. NENHUM MAPA SE PERDEU, e não só na contagem: por nome.
            expect(depois.mapNames, 'todos os mapas da fixture sobreviveram, um a um')
                .toEqual(declarado.mapNames.slice().sort());

            // 2. NENHUMA FEIÇÃO SE PERDEU, e a distribuição por mapa é a mesma. A contagem
            //    total sozinha aceitaria 262 feições amontoadas num mapa só.
            expect(depois.features, 'as 262 feições sobreviveram').toBe(DECLARADO.features);
            expect(depois.featuresByMap, 'cada mapa manteve as suas feições')
                .toEqual(declarado.featuresByMap);

            // 3. O RESTO DO ACERVO.
            expect(depois.layers, 'as camadas sobreviveram').toBe(DECLARADO.layers);
            expect(depois.groups, 'os grupos sobreviveram').toBe(DECLARADO.groups);
            expect(depois.briefings, 'os briefings sobreviveram').toBe(DECLARADO.briefings);
            expect(depois.customIcons, 'os ícones customizados sobreviveram').toBe(DECLARADO.customIcons);

            // IMAGENS, por CHAVE e não por contagem. Cinco contadas aceitariam uma troca, e uma
            // contagem que não bate não diz QUEM entrou ou saiu.
            //
            // O banco de imagens tem DOIS habitantes, e confundi-los custou uma investigação:
            // as cinco do arquivo (fotos e ícones do usuário) e o CACHE DE RENDER da declinação
            // magnética, que `regenerateIcon` (`military_tools/declination_tool/add_declination_control.js`)
            // regrava a cada desenho, chaveado pelo ID DA FEIÇÃO. Ele nasce do desenho, nunca da
            // migração, e por isso a asserção é assimétrica: nada do arquivo pode faltar, e o que
            // sobrar tem de ser um id de feição de declinação, nunca uma chave qualquer.
            const chaves = depois.imagens.map(i => i.key).sort();
            const doArquivo = [...fixture.images.keys()].sort();
            expect(chaves, 'as cinco imagens do arquivo sobreviveram, uma a uma')
                .toEqual(expect.arrayContaining(doArquivo));
            expect(
                chaves.filter(k => !doArquivo.includes(k)).sort(),
                'apareceu no banco de imagens uma chave que não é do arquivo nem cache de declinação',
            ).toEqual(declinationFeatureIds(fixture).sort());

            // 4. O CARIMBO SUBIU. Sem isto, "nada se perdeu" seria satisfeito por uma migração
            //    que nunca rodou.
            expect(depois.schemaVersion, 'a instalação terminou o boot na versão corrente').toBe('2.3');

            // 5. ZERO CÓPIA: o banco legado VIROU o slot #1, e nenhum banco sufixado nasceu
            //    para receber uma cópia dos dados. É a propriedade que torna a migração barata,
            //    e a única forma de vê-la é olhando os nomes no disco.
            expect(depois.mapsDbName, 'o escopo ativo continua sendo o banco legado adotado')
                .toBe('ebgeo_maps');
            expect(depois.dbs.filter(n => n.startsWith('ebgeo_maps__')),
                'a migração copiou os dados para um namespace novo em vez de adotar o legado')
                .toEqual([]);
        } finally {
            await ctx.close();
        }
    });

    test('as imagens continuam BLOBS depois de migrar, que é o que o harness de nó não pode ver', async ({ browser }) => {
        // O harness de nó guarda bytes crus e DECLARA a limitação (`IMAGE_VALUE_FORM`), porque
        // `fake-indexeddb` mais localforage caem em `_encodeBlob`, que precisa de `FileReader`.
        // O custo declarado lá é este: nada que dependa do `.type` do blob é exercitado. Aqui é.
        test.setTimeout(180000);

        const { ctx, page, fixture } = await prepareLegacyInstall(browser, '01-completo.ebgeo');
        try {
            await page.goto('/');
            await waitForMap(page);

            // Só as do ARQUIVO: o cache de render da declinação nasce como `Blob` no navegador
            // por construção, então incluí-lo aqui seria medir o instrumento.
            const doArquivo = new Set(fixture.images.keys());
            const imagens = (await readAfterBoot(page)).imagens.filter(i => doArquivo.has(i.key));
            expect(imagens.length, 'as cinco imagens do arquivo estão lá').toBe(DECLARADO.images);
            for (const img of imagens) {
                expect(img.isBlob, `a imagem "${img.key}" sobreviveu como Blob, não como bytes soltos`).toBe(true);
                expect(img.type, `a imagem "${img.key}" manteve o MIME`).toBe('image/png');
                expect(img.size, `a imagem "${img.key}" não veio truncada`).toBeGreaterThan(0);
            }
        } finally {
            await ctx.close();
        }
    });

    test('DUAS ABAS abrindo a mesma instalação 2.2 ao mesmo tempo não perdem nem duplicam nada', async ({ browser }) => {
        // A corrida que só o navegador tem. As duas abas encontram um repositório 2.2, e as duas
        // querem adotá-lo como slot #1 e carimbar 2.3. O que não pode acontecer: migração pela
        // metade, mapa duplicado, ou uma aba tomando o dado da outra.
        //
        // É também o tab-lock no PIOR instante: duas abas colidindo no mesmo atlas, quando esse
        // atlas ainda nem tem registro.
        test.setTimeout(180000);

        const { ctx, page: abaA, declarado } = await prepareLegacyInstall(browser, '01-completo.ebgeo');
        try {
            const abaB = await ctx.newPage();

            // Sem `await` entre as duas: a corrida é o sujeito. Uma delas pode perder o tab-lock
            // e ficar em modo degradado, e isso é comportamento correto, não falha.
            await Promise.all([abaA.goto('/'), abaB.goto('/')]);

            // Pelo menos UMA aba precisa chegar ao mapa. Exigir as duas seria exigir que o
            // tab-lock NÃO arbitrasse, que é o contrário do desenho.
            const chegou = await Promise.allSettled([waitForMap(abaA), waitForMap(abaB)]);
            expect(chegou.some(r => r.status === 'fulfilled'),
                'nenhuma das duas abas chegou ao mapa: a corrida travou a migração').toBe(true);
            const vencedora = chegou[0].status === 'fulfilled' ? abaA : abaB;

            const depois = await readAfterBoot(vencedora);

            // NADA SE PERDEU, e nada foi contado duas vezes: dois adotantes do mesmo slot
            // poderiam produzir mapa repetido ou um carimbo pela metade.
            expect(depois.mapNames, 'a corrida não perdeu nem duplicou mapa')
                .toEqual(declarado.mapNames.slice().sort());
            expect(depois.features, 'a corrida não perdeu nem duplicou feição').toBe(DECLARADO.features);
            expect(depois.schemaVersion, 'a migração terminou, e não parou no meio').toBe('2.3');
            expect(depois.dbs.filter(n => n.startsWith('ebgeo_maps__')),
                'a segunda aba criou um namespace paralelo em vez de compartilhar o slot adotado')
                .toEqual([]);
        } finally {
            await ctx.close();
        }
    });
});

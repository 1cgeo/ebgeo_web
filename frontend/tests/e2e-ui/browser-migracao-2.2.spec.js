// Path: e2e-ui/browser-migracao-2.2.spec.js

/**
 * Browser migration and recovery tests using the 2.2 archive fixture and the exact
 * tab-lock code from main commit 8b611113. The fixture is a reconstructed install,
 * not a raw dump produced by every historical build. Both entry paths use real
 * IndexedDB and Blobs; retries are disabled because concurrency is under test.
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { readState } from './state.js';
import { buildLegacyEntries, countFixture, LEGACY_STORE_IDS, loadEbgeoFixture } from '../helpers/ebgeo-fixture.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;
test.describe.configure({ retries: 0 });

/** Path served as an empty same-origin document, so seeding happens with the app NOT booted. */
const BLANK_PATH = '/__seed-2.2__';

async function startMainLock(page) {
    const source = readFileSync(new URL('../fixtures/migration-review/tab-lock-main-8b611113.txt', import.meta.url), 'utf8');
    await page.evaluate(async source => {
        const url = URL.createObjectURL(new Blob([source + '\nwindow.__mainActive = () => isActive;'], { type: 'text/javascript' }));
        const main = await import(/* @vite-ignore */ url);
        main.initTabLock();
        URL.revokeObjectURL(url);
    }, source);
}

async function transitionDisk(page) {
    return page.evaluate(async () => {
        const ns = await import('/src/js/store/atlas-namespace.js');
        const { readLegacyTransition } = await import('/src/js/store/migration/transition-state.js');
        return { transition: await readLegacyTransition(), entries: await ns.readLocalAtlasRegistry() };
    });
}

/**
 * O acervo da versão ANTIGA, pelo endereço sem sufixo, lido de qualquer página da origem.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<Array>} Inventário `[store, key, hash]`.
 */
function legacyInventory(page) {
    return page.evaluate(async () => {
        const ns = await import('/src/js/store/atlas-namespace.js');
        const { inventoryScope } = await import('/src/js/store/migration/legacy-transition.js');
        return inventoryScope(ns.localScope('legacy', ''));
    });
}

/**
 * Um ajuste do atlas ATUALIZADO, pelo endereço dos bancos do destino da transição.
 * @param {import('@playwright/test').Page} page
 * @param {Object} transition - Diário da transição, de `transitionDisk`.
 * @param {string} key - Chave em `StoreName.SETTINGS`.
 * @returns {Promise<*>}
 */
function destinationSetting(page, transition, key) {
    return page.evaluate(async ({ id, suffix, chave }) => {
        const ns = await import('/src/js/store/atlas-namespace.js');
        return ns.getStoreFor(ns.StoreName.SETTINGS, ns.localScope(id, suffix)).getItem(chave);
    }, { id: transition.entry.id, suffix: transition.destination, chave: key });
}

/**
 * Quantas feições de um tipo um mapa tem, num escopo endereçado por id e sufixo.
 * @param {import('@playwright/test').Page} page
 * @param {{id: string, suffix: string}} scope - Endereço dos bancos.
 * @param {string} mapKey - Chave do mapa.
 * @param {string} bucket - Balde de feições (`points`, `lines`...).
 * @returns {Promise<number|null>} `null` quando o mapa não existe naquele escopo.
 */
function featureCount(page, scope, mapKey, bucket) {
    return page.evaluate(async ({ id, suffix, chave, balde }) => {
        const ns = await import('/src/js/store/atlas-namespace.js');
        const doc = await ns.getStoreFor(ns.StoreName.MAPS, ns.localScope(id, suffix)).getItem(chave);
        return doc ? (doc.features?.[balde] ?? []).length : null;
    }, { id: scope.id, suffix: scope.suffix, chave: mapKey, balde: bucket });
}

/**
 * Números que o README da fixture declara. Escritos por extenso, não derivados: uma fixture que
 * mude em silêncio precisa ficar VERMELHA aqui, e não redefinir o que "sobreviveu" significa.
 */
const DECLARADO = Object.freeze({
    maps: 11, features: 262, layers: 17, groups: 2,
    briefings: 2, customIcons: 2, images: 5,
});

/**
 * O mapa em que as duas versões do produto se encontram no caso de conflito. NÃO é o `Principal`:
 * ver o cabeçalho daquele caso.
 */
const MAPA_EM_DISPUTA = '07 Camadas';

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
        const { inventoryScope } = await import('/src/js/store/migration/legacy-transition.js');
        const { readLegacyTransition } = await import('/src/js/store/migration/transition-state.js');
        const transition = await readLegacyTransition();
        const originalUnchanged = JSON.stringify(transition.sourceInventory) === JSON.stringify(
            await inventoryScope(ns.localScope('legacy-workspace', '')));
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
            originalUnchanged,
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
    test('QuotaExceededError na cópia bloqueia o editor, permite exportar e retoma depois da falha', async ({ browser }) => {
        const { ctx, page } = await prepareLegacyInstall(browser, '01-completo.ebgeo');
        try {
            const original = await page.evaluate(async () => {
                const ns = await import('/src/js/store/atlas-namespace.js');
                await ns.getGlobalStore().ready();
                const { inventoryScope } = await import('/src/js/store/migration/legacy-transition.js');
                return inventoryScope(ns.localScope('legacy', ''));
            });
            // Inject at the native IDB write boundary. CDP's quota override reports the limit
            // here but does not reject these writes, so it cannot certify real disk pressure.
            await page.addInitScript(() => {
                const put = IDBObjectStore.prototype.put;
                IDBObjectStore.prototype.put = function (...args) {
                    if (this.transaction.db.name.includes('__upgrade-') && !sessionStorage.getItem('quota-test-disabled')) {
                        throw new DOMException('Quota de teste excedida', 'QuotaExceededError');
                    }
                    return put.apply(this, args);
                };
            });
            await page.goto('/');
            await expect(page.getByTestId('migration-recovery')).toContainText('espaço');
            expect((await transitionDisk(page)).entries).toHaveLength(0);
            // DOIS COMANDOS, e só dois (decisão do dono, 2026-09-22). "Tentar novamente" saiu
            // junto com os reparos que ele existia para repetir; aqui o retomar é recarregar.
            await expect(page.getByTestId('migration-recovery').getByRole('button'))
                .toHaveText(['Baixar meus dados', 'Continuar']);
            const downloadPromise = page.waitForEvent('download');
            await page.getByRole('button', { name: 'Baixar meus dados' }).click();
            const baixado = await downloadPromise;
            // O ACERVO AQUI É UM SÓ (a transição nem chegou a registrar atlas), então o arquivo
            // que a pessoa leva é o que ela mesma reabre.
            expect(baixado.suggestedFilename()).toMatch(/^ebgeo-\d{4}-\d{2}-\d{2}\.ebgeo$/);
            expect(readFileSync(await baixado.path()).length).toBeGreaterThan(1000);
            await expect(page.getByTestId('migration-recovery')).toContainText('Importar atlas');
            await page.evaluate(() => sessionStorage.setItem('quota-test-disabled', 'yes'));
            await page.reload();
            await waitForMap(page);
            expect((await transitionDisk(page)).transition.sourceInventory).toEqual(original);
            expect((await readAfterBoot(page)).originalUnchanged).toBe(true);
        } finally { await ctx.close(); }
    });

    /**
     * O SEGUNDO COMANDO, que é o único que destrói (decisão do dono, 2026-09-22): "Continuar"
     * apaga os bancos desta origem e abre o EBGeo limpo. Ele pergunta UMA vez, e a pergunta nomeia
     * a contagem que o inventário acabou de ler.
     *
     * A QUOTA É SÓ O JEITO DE CHEGAR À TELA com um acervo cheio no disco; ela é desligada ANTES do
     * ato, para que o que se meça depois seja o produto abrindo, e não a mesma falha de novo.
     */
    test('"Continuar" pergunta com o número do disco, apaga o acervo e o EBGeo abre limpo', async ({ browser }) => {
        test.setTimeout(180000);
        const { ctx, page, declarado } = await prepareLegacyInstall(browser, '01-completo.ebgeo');
        try {
            await page.addInitScript(() => {
                const put = IDBObjectStore.prototype.put;
                IDBObjectStore.prototype.put = function (...args) {
                    if (this.transaction.db.name.includes('__upgrade-') && !sessionStorage.getItem('quota-test-disabled')) {
                        throw new DOMException('Quota de teste excedida', 'QuotaExceededError');
                    }
                    return put.apply(this, args);
                };
            });
            await page.goto('/');
            const tela = page.getByTestId('migration-recovery');
            await expect(tela).toContainText('espaço');
            await page.evaluate(() => sessionStorage.setItem('quota-test-disabled', 'yes'));

            // A PERGUNTA, uma só, com o número. O acervo tem 11 mapas, então a contagem é bem
            // maior que os mapas: é o total de registros dos dez bancos.
            await page.getByRole('button', { name: 'Continuar', exact: true }).click();
            await expect(tela).toContainText(/\d+ registros/);
            const contagem = Number(/(\d+) registros/.exec(await tela.locator('.ebgeo-unavailable__msg').innerText())[1]);
            expect(contagem, 'a confirmação nomeia um número do disco, não zero')
                .toBeGreaterThan(declarado.maps);
            // CONTROLE: enquanto a pergunta está na tela, o acervo continua lá.
            expect(await legacyInventory(page), 'perguntar não apaga').toHaveLength(contagem);

            await page.getByRole('button', { name: 'Apagar e abrir o EBGeo' }).click();
            await waitForMap(page);

            // O ACERVO SUMIU: o que a página reabriu é uma instalação nova, com o mapa padrão e
            // nenhuma feição, e nenhum dos mapas do arquivo.
            const depois = await page.evaluate(async () => {
                const store = await import('/src/js/store/index.js');
                const nomes = await store.getAllMapNamesStore();
                let features = 0;
                for (const nome of nomes) {
                    for (const lista of Object.values((await store.getCurrentMapFeatures(nome)) ?? {})) {
                        if (Array.isArray(lista)) features += lista.length;
                    }
                }
                return { nomes, features };
            });
            expect(depois.features, 'nenhuma feição do acervo antigo sobreviveu').toBe(0);
            for (const nome of declarado.mapNames) {
                if (nome === 'Principal') continue;
                expect(depois.nomes, `o mapa "${nome}" do acervo antigo não pode ter sobrevivido`).not.toContain(nome);
            }
        } finally { await ctx.close(); }
    });

    test('mede cópia e verificação de um acervo com 8 MiB de binário incompressível', async ({ browser }, testInfo) => {
        test.setTimeout(120000);
        const { ctx, page } = await prepareLegacyInstall(browser, '01-completo.ebgeo');
        try {
            const measured = await page.evaluate(async () => {
                const ns = await import('/src/js/store/atlas-namespace.js');
                const { inventoryScope, prepareLegacyTransition } = await import('/src/js/store/migration/legacy-transition.js');
                const legacy = ns.localScope('legacy', '');
                const bytes = new Uint8Array(8 * 1024 * 1024);
                let random = 123456789;
                for (let i = 0; i < bytes.length; i++) {
                    random ^= random << 13; random ^= random >>> 17; random ^= random << 5;
                    bytes[i] = random & 255;
                }
                await ns.getStoreFor(ns.StoreName.IMAGES, legacy).setItem('large-original', new Blob([bytes], { type: 'application/octet-stream' }));
                const inventory = await inventoryScope(legacy);
                const before = await navigator.storage.estimate();
                const start = performance.now();
                const { state } = await prepareLegacyTransition();
                const elapsedMs = performance.now() - start;
                const after = await navigator.storage.estimate();
                const originalUnchanged = JSON.stringify(inventory) === JSON.stringify(await inventoryScope(legacy));
                const copied = await ns.getStoreFor(ns.StoreName.IMAGES, ns.localScope(state.entry.id, state.destination)).getItem('large-original');
                return { elapsedMs, beforeBytes: before.usage, afterBytes: after.usage, copiedBytes: copied.size,
                    additionalBytes: after.usage - before.usage, binaryBytes: bytes.length,
                    records: inventory.length, originalUnchanged, status: state.status };
            });
            await testInfo.attach('custo-da-copia.json', { body: JSON.stringify(measured, null, 2), contentType: 'application/json' });
            console.info('Custo medido da atualização:', JSON.stringify(measured));
            expect(measured.status).toBe('committed');
            expect(measured.originalUnchanged).toBe(true);
            // Storage estimates are browser accounting, not an exact sum of Blob sizes.
            expect(measured.additionalBytes).toBeGreaterThan(0);
            expect(measured.copiedBytes).toBe(8 * 1024 * 1024);
        } finally { await ctx.close(); }
    });

    test('main aberta bloqueia a preparação; fechar a antiga permite atualizar', async ({ browser }) => {
        const { ctx, page: old } = await prepareLegacyInstall(browser, '01-completo.ebgeo');
        try {
            await startMainLock(old);
            await expect.poll(() => old.evaluate(() => window.__mainActive())).toBe(true);
            const page = await ctx.newPage();
            await page.goto('/');
            await expect(page.getByTestId('migration-recovery')).toContainText('versão antiga');
            expect((await transitionDisk(page)).transition).toBeNull();
            // A ÚNICA CAUSA EM QUE A TELA NÃO PRECISA DESTRUIR NADA, e a frase diz isso: fechar a
            // outra janela é o que resolve, e recarregar é o que retoma.
            await expect(page.getByTestId('migration-recovery')).toContainText('nada precisa ser apagado');
            await old.close();
            await page.reload();
            await waitForMap(page);
            expect((await readAfterBoot(page)).originalUnchanged).toBe(true);
        } finally { await ctx.close(); }
    });

    /**
     * A REGRA MUDOU EM 2026-09-21, E ESTE CASO MEDIA A ANTIGA. Até aquela data toda gravação da
     * versão anterior feita DEPOIS da transição parava o boot na tela de recuperação, e era isso
     * que este caso exigia. Por decisão do dono (registrada em `docs/decisions/decisions-2026.md`,
     * "o que a versão anterior grava depois da transição entra sozinho"), a gravação tardia que
     * não conflita é incorporada pelo próprio portão, sem tela: o atlas atualizado não tinha nada
     * a perder, e a tela pedia uma decisão que não existia.
     *
     * A METADE QUE NÃO MUDOU continua sendo o sujeito, e é a primeira coisa afirmada aqui: a
     * versão antiga escreve nos bancos SEM sufixo e não alcança o destino da atualização. Sem
     * isso, "entrou sozinha" seria satisfeito por uma escrita que tivesse caído direto no atlas
     * novo, que é o contrário do isolamento.
     */
    test('main reaberta depois da atualização não alcança o destino; a gravação tardia trivial entra sozinha', async ({ browser }) => {
        const { ctx, page, declarado } = await prepareLegacyInstall(browser, '01-completo.ebgeo');
        const avisos = [];
        page.on('console', m => avisos.push(m.text()));
        try {
            await page.goto('/');
            await waitForMap(page);
            const before = await transitionDisk(page);
            const old = await ctx.newPage();
            await goToBlankSameOrigin(old);
            await startMainLock(old);
            await expect(old.locator('.tab-lock-overlay--visible')).toBeVisible();
            expect(await old.evaluate(() => window.__mainActive())).toBe(false);
            await old.getByRole('button', { name: 'Usar aqui' }).click();
            await expect(page.locator('.tab-lock-overlay--visible')).toContainText('versão antiga');
            await old.evaluate(async () => {
                const ns = await import('/src/js/store/atlas-namespace.js');
                await ns.getStoreFor(ns.StoreName.SETTINGS, ns.localScope('legacy', '')).setItem('late_note', 'Trabalho tardio');
            });

            // CONTROLE POSITIVO, antes do ato: a escrita existe do lado ANTIGO e não existe do
            // lado novo. Sem os dois, o "entrou" de baixo não distingue incorporação de escrita
            // que nunca precisou viajar.
            expect(await old.evaluate(async () => {
                const ns = await import('/src/js/store/atlas-namespace.js');
                return ns.getStoreFor(ns.StoreName.SETTINGS, ns.localScope('legacy', '')).getItem('late_note');
            }), 'a versão antiga gravou no acervo antigo').toBe('Trabalho tardio');
            expect(await destinationSetting(old, before.transition, 'late_note'),
                'a versão antiga NÃO alcança os bancos do destino').toBeNull();
            const origemDepoisDaEscrita = await legacyInventory(old);

            await old.close();
            await page.reload();

            // 1. A TELA NÃO APARECE. A espera é pelo PRIMEIRO dos dois desfechos, e não pelo
            //    mapa: esperar só o mapa transforma a regressão (a tela de volta) num estouro de
            //    tempo de 60 s que não nomeia nada, e foi assim que o controle negativo desta
            //    mudança reprovou da primeira vez.
            await page.waitForFunction(
                () => Boolean(document.querySelector('[data-testid="migration-recovery"]'))
                    || Boolean(globalThis.__ebgeoMap?.loaded?.()),
                { timeout: 60000 });
            await expect(page.getByTestId('migration-recovery'),
                'a gravação tardia trivial não pode parar o boot na tela de recuperação').toHaveCount(0);
            await waitForMap(page);

            // 2. A ALTERAÇÃO TARDIA ENTROU, no disco do atlas ATUALIZADO, e o atlas continua o
            //    mesmo: a incorporação é escrita no lugar, nunca uma cópia nova.
            expect(await destinationSetting(page, before.transition, 'late_note'),
                'a gravação tardia foi incorporada ao atlas atualizado').toBe('Trabalho tardio');
            const after = await transitionDisk(page);
            expect(after.transition.destination).toBe(before.transition.destination);
            expect(after.entries, 'nenhum atlas de recuperação foi criado').toHaveLength(1);

            // 3. O DIÁRIO FECHOU A INCORPORAÇÃO: nada em voo, nenhuma recusa lembrada, e as duas
            //    bases avançaram, que é o que impede a próxima junção de ler a edição da versão
            //    nova como mudança da antiga.
            expect(after.transition.late, 'nenhuma incorporação ficou em voo').toBeUndefined();
            expect(after.transition.lateConflict, 'nenhuma recusa foi lembrada').toBeUndefined();
            expect(after.transition.lateBase, 'as duas bases avançaram').toBeTruthy();

            // 4. UM registro, e não o acervo inteiro reescrito por cima. O número vem da fala do
            //    produto, que é um caminho independente do disco lido acima.
            await expect.poll(() => avisos.filter(t => /incorporadas: 1 registro/.test(t)).length,
                { timeout: 15000 }).toBe(1);

            // 5. A ORIGEM NÃO É TOCADA pela incorporação, e o atlas atualizado não perdeu nada.
            expect(await legacyInventory(page), 'a incorporação não escreve no acervo antigo')
                .toEqual(origemDepoisDaEscrita);
            const depois = await readAfterBoot(page);
            expect(depois.mapNames, 'a incorporação não perdeu mapa').toEqual(declarado.mapNames.slice().sort());
            expect(depois.features, 'a incorporação não perdeu feição').toBe(DECLARADO.features);
        } finally { await ctx.close(); }
    });

    /**
     * O OUTRO RAMO DA MESMA REGRA: as duas versões mexeram no MESMO mapa.
     *
     * ELE TAMBÉM DEIXOU DE DESENHAR A TELA, em 2026-09-22, e essa é a segunda metade da decisão do
     * dono. A regra do plano não mudou (`planLateLegacyChanges` continua respondendo CONFLICT, e
     * `prepareLegacyTransition` continua lançando `legacy_changes`); o que mudou é o que o portão
     * faz com a recusa. A saída que a tela oferecia num botão é a única que não perde trabalho,
     * então ela é TOMADA: o que a versão antiga gravou vai para um atlas local novo, o atlas
     * atualizado fica intacto, e a pessoa lê um toast que NOMEIA o atlas criado em vez de uma
     * parede. O que sobra para a tela é o caso em que nem isso deu certo, medido em
     * `tests/integration/transicao-resiliente.test.js` (registro de atlas cheio).
     *
     * O MAPA EM DISPUTA NÃO É O `Principal`, de propósito: `Principal` é o mapa que o boot abre,
     * e abrir um mapa grava sozinho a contagem de cores dele. Escolher um mapa que o boot NÃO
     * abre é o que deixa a causa da recusa sem ambiguidade: ela vem da nota escrita pela versão
     * nova, e não do próprio ato de abrir o atlas, que a regra trata como não-edição.
     *
     * A EDIÇÃO DA VERSÃO NOVA É UMA ESCRITA DE PRODUTO (`setMapNotes`, com o retorno booleano
     * conferido), e não um registro montado à mão: é o que prova que a recusa cobre trabalho de
     * gente. A da versão antiga é escrita direto no acervo sem sufixo, como no caso acima, porque
     * a versão antiga não roda aqui.
     */
    test('main reaberta que grava no MESMO mapa que a versão nova NÃO para na tela: o que ela gravou vai sozinho para outro atlas', async ({ browser }) => {
        test.setTimeout(180000);
        const { ctx, page, declarado } = await prepareLegacyInstall(browser, '01-completo.ebgeo');
        const avisos = [];
        page.on('console', m => avisos.push(m.text()));
        try {
            expect(declarado.mapNames, 'a fixture tem o mapa em disputa').toContain(MAPA_EM_DISPUTA);
            await page.goto('/');
            await waitForMap(page);
            const before = await transitionDisk(page);
            const destino = { id: before.transition.entry.id, suffix: before.transition.destination };
            const pontosAntes = await featureCount(page, destino, MAPA_EM_DISPUTA, 'points');
            expect(pontosAntes, 'o mapa em disputa chegou ao destino com feições').toBeGreaterThan(0);

            // A VERSÃO NOVA FAZ TRABALHO NAQUELE MAPA, pela operação de store de verdade.
            expect(await page.evaluate(async mapa => {
                const store = await import('/src/js/store/index.js');
                return store.setMapNotes(mapa, { title: 'Nota da versão nova', description: 'Escrita depois da atualização' });
            }, MAPA_EM_DISPUTA), 'a versão nova gravou as notas do mapa em disputa').toBe(true);

            const old = await ctx.newPage();
            await goToBlankSameOrigin(old);
            await startMainLock(old);
            await expect(old.locator('.tab-lock-overlay--visible')).toBeVisible();
            await old.getByRole('button', { name: 'Usar aqui' }).click();
            await expect(page.locator('.tab-lock-overlay--visible')).toContainText('versão antiga');

            // E A VERSÃO ANTIGA DESENHA NO MESMO MAPA.
            expect(await old.evaluate(async mapa => {
                const ns = await import('/src/js/store/atlas-namespace.js');
                const loja = ns.getStoreFor(ns.StoreName.MAPS, ns.localScope('legacy', ''));
                const doc = await loja.getItem(mapa);
                const id = '00000000-0000-4000-8000-0000000009a4';
                doc.features.points = [...(doc.features.points ?? []), {
                    type: 'Feature', id,
                    geometry: { type: 'Point', coordinates: [-47.9, -15.8] },
                    properties: { id, nome: 'Ponto tardio', color: '#ff0000', source: 'point', layerId: 'default' },
                }];
                await loja.setItem(mapa, doc);
                return (await loja.getItem(mapa)).features.points.length;
            }, MAPA_EM_DISPUTA), 'a versão antiga desenhou no acervo antigo').toBe(pontosAntes + 1);
            expect(await featureCount(old, destino, MAPA_EM_DISPUTA, 'points'),
                'a versão antiga NÃO alcança os bancos do destino').toBe(pontosAntes);

            await old.close();
            await page.reload();

            // 1. A TELA NÃO APARECE, e a espera é pelo PRIMEIRO dos dois desfechos: esperar só o
            //    toast transformaria a regressão (a tela de volta) num estouro de tempo que não
            //    nomeia nada.
            await page.waitForFunction(
                () => Boolean(document.querySelector('[data-testid="migration-recovery"]'))
                    || Boolean(document.querySelector('.toast')),
                { timeout: 120000 });
            await expect(page.getByTestId('migration-recovery'),
                'o conflito da junção tardia não pode mais parar o boot na tela').toHaveCount(0);

            // 2. A PESSOA É AVISADA, e o aviso NOMEIA o atlas em que o trabalho dela foi parar.
            await expect(page.locator('.toast', { hasText: 'foram guardadas no atlas' })).toBeVisible();
            await expect(page.locator('.toast', { hasText: 'Recuperado' })).toBeVisible();

            // 3. NADA FOI ESCRITO no atlas atualizado: nem o ponto da versão antiga entrou, nem
            //    a nota da versão nova foi substituída.
            expect(await featureCount(page, destino, MAPA_EM_DISPUTA, 'points')).toBe(pontosAntes);
            expect(await destinationSetting(page, before.transition, `map_notes_${MAPA_EM_DISPUTA}`))
                .toMatchObject({ title: 'Nota da versão nova' });

            // 4. E O QUE A VERSÃO ANTIGA GRAVOU ESTÁ NUM SEGUNDO ATLAS DO REGISTRO, com o
            //    desenho dela dentro.
            const after = await transitionDisk(page);
            expect(after.entries).toHaveLength(2);
            expect(after.transition.destination).toBe(before.transition.destination);
            const recuperado = after.entries.find(entry => entry.dbSuffix !== before.transition.destination);
            expect(recuperado.name).toContain('Recuperado');
            expect(await featureCount(page, { id: recuperado.id, suffix: recuperado.dbSuffix }, MAPA_EM_DISPUTA, 'points'),
                'o atlas recuperado tem o que a versão antiga desenhou').toBe(pontosAntes + 1);

            // 5. O PRODUTO DIZ O MESMO PELO CONSOLE, que é um caminho independente do DOM.
            expect(avisos.filter(t => /alterações da versão antiga guardadas em/.test(t)).length).toBe(1);

            // 6. E O BOOT CHEGA AO MAPA, sem gesto nenhum da pessoa.
            await waitForMap(page);

            // 7. NO RECUPERADO (decisão do dono, 2026-09-23): o mapa abre o atlas em que o trabalho
            //    da versão antiga foi parar, e o aviso diz isso. O escopo montado se lê do ponteiro
            //    da aba, e não por `import()` aqui dentro, que pegaria outra instância do módulo.
            const montado = await page.evaluate(() => JSON.parse(sessionStorage.getItem('ebgeo_tab_mount') || 'null'));
            expect(montado?.dbSuffix, 'a aba montou o atlas recuperado').toBe(recuperado.dbSuffix);
            await expect(page.locator('.toast', { hasText: 'que está aberto agora' })).toBeVisible();
        } finally { await ctx.close(); }
    });

    /**
     * A MESMA TELA, PELA OUTRA PORTA: servidor fora do ar. O portão de migração roda ANTES do
     * `GET /api/config` (`index.js`), então aqui a atualização já terminou e o acervo é UM SÓ (o
     * atlas registrado; a origem sem sufixo é a cópia pré-atualização dele, não um segundo
     * acervo). É por isso que este caso mede o ramo do `.ebgeo` com dado de verdade, imagens
     * inclusive, que é o que o harness de nó não pode fazer (sem `FileReader`, nada de Blob).
     *
     * A RESTAURAÇÃO PELA TELA SAIU, e o dono foi avisado do preço: a cópia bruta continua a
     * existir como saída, mas reabri-la deixou de ser auto-serviço. Este caso afirma a ausência,
     * porque um comando que some sem guarda volta sozinho na revisão seguinte.
     */
    test('API indisponível: a tela tem dois comandos e o download é um .ebgeo que o leitor do produto abre', async ({ browser }) => {
        test.setTimeout(180000);
        const { ctx, page, declarado, fixture } = await prepareLegacyInstall(browser, '01-completo.ebgeo');
        try {
            await page.route(/\/config(\?|$)/, route => route.abort('failed'));
            await page.goto('/');
            await page.getByRole('button', { name: 'Recuperar dados deste computador' }).click();

            const tela = page.getByTestId('migration-recovery');
            await expect(tela.getByRole('button')).toHaveText(['Baixar meus dados', 'Continuar']);
            await expect(tela).toContainText('servidor do EBGeo não respondeu');
            expect(await tela.locator('input[type=file]').count(),
                'a restauração pela tela saiu em 2026-09-22').toBe(0);

            const downloadPromise = page.waitForEvent('download');
            await page.getByRole('button', { name: 'Baixar meus dados' }).click();
            const download = await downloadPromise;
            expect(download.suggestedFilename()).toMatch(/^ebgeo-\d{4}-\d{2}-\d{2}\.ebgeo$/);
            await expect(tela).toContainText('Importar atlas');
            const bytes = readFileSync(await download.path());
            expect(bytes.length).toBeGreaterThan(1000);

            // O LEITOR DO PRODUTO, dentro da página: é ele que decide se o arquivo pode ser
            // importado (ele confere o CRC32 de cada entrada e recusa id de imagem ambíguo), e um
            // `.ebgeo` que só este teste soubesse ler não serviria de recuperação.
            const lido = await page.evaluate(async (array) => {
                const gate = await import('/src/js/import_export/ebgeo-file-gate.js');
                const { data, zip } = await gate.readEbgeoArchive(new Blob([new Uint8Array(array)]));
                let features = 0;
                for (const mapa of Object.values(data.maps)) {
                    for (const lista of Object.values(mapa.features || {})) {
                        if (Array.isArray(lista)) features += lista.length;
                    }
                }
                return {
                    version: data.version,
                    mapNames: Object.keys(data.maps).sort(),
                    features,
                    imagens: Object.keys(zip.files).filter(n => n.startsWith('images/') && !zip.files[n].dir).length,
                };
            }, Array.from(bytes));

            expect(lido.version).toBe('3.0');
            expect(lido.mapNames, 'o arquivo leva todos os mapas').toEqual(declarado.mapNames.slice().sort());
            expect(lido.features, 'o arquivo leva todas as feições').toBe(DECLARADO.features);
            // AS IMAGENS VIAJAM, e são pelo menos as do arquivo: o ramo de Blob e a tabela de
            // extensão só existem aqui. O excedente é o cache de render da declinação magnética,
            // pelo mesmo motivo declarado no caso do acervo completo.
            expect(lido.imagens).toBeGreaterThanOrEqual(fixture.images.size);

            expect((await transitionDisk(page)).entries,
                'nada foi restaurado nem criado: baixar não escreve').toHaveLength(1);
        } finally { await ctx.close(); }
    });

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
            // O NÚMERO AQUI ERA '2.3' ATÉ 2026-09-07, e a troca não é manutenção: 2.3 era um
            //    número que a outra linha do produto também usava, para outra coisa, enquanto já
            //    estava em 2.4, de modo que o detector daqui lia um repositório dela como "já
            //    corrente". Literal de propósito neste arquivo, como no par em `tests/integration`.
            expect(depois.schemaVersion, 'a instalação terminou o boot na versão corrente').toBe('3.0');

            // The old build can still write its databases: isolate the new editor and retain
            // an exact inventory of every original, including binary contents.
            expect(depois.originalUnchanged).toBe(true);
            expect(depois.mapsDbName).toMatch(/^ebgeo_maps__upgrade-/);
            expect(depois.dbs.filter(n => n.startsWith('ebgeo_maps__')),
                'a atualização deve produzir um único destino isolado')
                .toEqual([depois.mapsDbName]);
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
            expect(depois.schemaVersion, 'a migração terminou, e não parou no meio').toBe('3.0');
            expect(depois.dbs.filter(n => n.startsWith('ebgeo_maps__')),
                'as duas abas devem compartilhar o mesmo destino isolado')
                .toEqual([depois.mapsDbName]);
            expect(depois.originalUnchanged).toBe(true);
        } finally {
            await ctx.close();
        }
    });
});

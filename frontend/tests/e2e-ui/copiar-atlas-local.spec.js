// Path: e2e-ui/copiar-atlas-local.spec.js

/**
 * @fileoverview "Fazer uma cópia" de um atlas LOCAL: a cópia nasce com o mesmo conteúdo e a origem
 * não é tocada.
 *
 * AS DUAS METADES SÃO A AFIRMAÇÃO. A cópia é banco a banco entre dois namespaces de IndexedDB
 * (`copyAtlasDatabases`), e um erro de direção ali produz dois atlas idênticos — resultado que
 * passaria numa verificação que só olhasse a cópia.
 *
 * PRECISA DE NAVEGADOR: são dois endereços de IndexedDB e ler cada um exige montá-lo, o que um
 * duplo em processo não faz.
 *
 * O DESENHO ANTERIOR ERA OUTRO, e o registro importa para ninguém tentar de novo: a primeira
 * versão copiava por round-trip de `.ebgeo` (exportar em memória, criar o slot, importar). O
 * export estava certo, mas o import arrastava junto o `clearAllDataStore` que deixa um mapa
 * "Principal" vazio ao lado do importado, mais a memória do atlas anterior — a cópia chegava com
 * o mapa e sem as feições, e nenhum erro aparecia em lugar nenhum.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { drawPointUI, readFeatures } from './helpers/collab-helpers.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

const ATLAS_URL = '/atlas.html';

async function esperarMapa(page) {
    await page.waitForFunction(() => globalThis.__ebgeoMap?.loaded?.(), null, { timeout: 30000 });
}

/** O nome do atlas montado, lido do cabeçalho da aba Mapas. */
async function nomeDoAtlasMontado(page) {
    await page.locator('.sidebar-nav-btn[data-tab="mapas"]').click();
    return page.locator('.atlas-header__name').inputValue();
}

/**
 * O cartão de UM atlas local, escolhido pelo nome EXATO.
 *
 * O cartão inteiro carrega nome + "aberto há ..." + chip + nota, então `hasText` sobre ele casa por
 * substring e "Meu Atlas" alcança também "Meu Atlas (cópia)"; uma âncora de linha (`/^Meu Atlas$/`)
 * é pior ainda, porque é comparada contra o texto do cartão INTEIRO e não pode casar nunca. Quem
 * tem o nome exato é o `.local-atlas__name` de dentro, e é por ele que se filtra.
 * @param {import('@playwright/test').Page} page
 * @param {string} nome - Nome exato do atlas.
 * @returns {import('@playwright/test').Locator}
 */
function cartaoPeloNomeExato(page, nome) {
    return page.locator('[data-testid="local-atlas-item"]')
        .filter({ has: page.getByText(nome, { exact: true }) });
}

describeOrSkip('copiar atlas local', () => {
    test('a cópia carrega o conteúdo e a origem continua intacta', async ({ browser }) => {
        test.setTimeout(240000);
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);

        // Conteúdo na origem, desenhado pela ferramenta de verdade.
        await page.goto('/');
        await esperarMapa(page);
        const pontoOriginal = await drawPointUI(page, [-43.2, -22.9]);
        expect(await readFeatures(page, 'points')).toHaveLength(1);

        // Copiar pela tela de atlas. O cartão é pego pelo nome EXATO desde já, ainda que aqui só
        // exista um: `hasText` casa por SUBSTRING, então este mesmo locator passaria a casar dois
        // cartões assim que a cópia existisse, e um seletor ambíguo por construção é o que
        // transforma um passo posterior em falha intermitente longe da causa.
        await page.goto(ATLAS_URL);
        const cartao = cartaoPeloNomeExato(page, 'Meu Atlas');
        await expect(cartao).toBeVisible({ timeout: 20000 });
        await cartao.locator('xpath=following-sibling::*[@data-testid="local-atlas-menu"]').click();
        await page.locator('[data-testid="local-atlas-duplicate"]').click();
        // O nome vem sugerido com "(cópia)"; aceitar é confirmar.
        await expect(page.locator('[data-testid="local-atlas-name-input"]'))
            .toHaveValue('Meu Atlas (cópia)', { timeout: 10000 });
        await page.locator('[data-testid="local-atlas-name-confirm"]').click();

        // A cópia acontece na PRÓPRIA TELA: nada de navegação, e o cartão novo aparece na lista.
        const cartaoDaCopia = cartaoPeloNomeExato(page, 'Meu Atlas (cópia)');
        await expect(cartaoDaCopia).toBeVisible({ timeout: 20000 });

        // METADE 1: entrar na cópia mostra o conteúdo.
        await cartaoDaCopia.click();
        await esperarMapa(page);
        await expect.poll(() => readFeatures(page, 'points').then((f) => f.length), { timeout: 30000 })
            .toBe(1);
        expect(await nomeDoAtlasMontado(page)).toBe('Meu Atlas (cópia)');
        // O id da feição é PRESERVADO: a cópia é banco a banco, com as mesmas chaves. Afirmar isso
        // é o que separa "copiou" de "criou um ponto qualquer no lugar certo".
        expect((await readFeatures(page, 'points'))[0].id).toBe(pontoOriginal);

        // METADE 2: a origem continua lá, com o mesmo conteúdo, e são DOIS slots.
        await page.goto(ATLAS_URL);
        // `allInnerTexts` é uma leitura ÚNICA, sem re-tentativa: a lista é montada depois do boot da
        // página, e ler antes disso devolve `[]`, que reprova dizendo "a cópia sumiu" quando ela só
        // ainda não tinha sido desenhada (1 em 3 execuções). O `toHaveCount` é a espera que falta.
        const itens = page.locator('[data-testid="local-atlas-item"]');
        await expect(itens).toHaveCount(2, { timeout: 20000 });
        const slots = await itens.allInnerTexts();
        expect(slots.some((t) => t.includes('Meu Atlas (cópia)')), 'a cópia sumiu da lista').toBe(true);
        expect(slots.filter((t) => t.includes('Meu Atlas')).length, 'a origem e a cópia deveriam coexistir')
            .toBe(2);

        await cartaoPeloNomeExato(page, 'Meu Atlas').click();
        await esperarMapa(page);
        const naOrigem = await readFeatures(page, 'points');
        expect(naOrigem, 'a origem foi esvaziada pela cópia').toHaveLength(1);
        expect(naOrigem[0].id).toBe(pontoOriginal);
        expect(await nomeDoAtlasMontado(page)).toBe('Meu Atlas');

        await ctx.close();
    });
});

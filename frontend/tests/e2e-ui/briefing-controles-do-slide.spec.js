// Path: e2e-ui/briefing-controles-do-slide.spec.js

/**
 * A APRESENTAÇÃO É UM PALCO LIMPO, no navegador real (regra do dono, 2026-09-20).
 *
 * Os controles do mapa (seletor de mapa base, modelos 3D, imagens 360, terreno, coordenadas,
 * utilitários, busca e o grupo de navegação) ficam ESCONDIDOS ao apresentar, e cada um só volta
 * quando o autor marcou a caixa daquele slide; o padrão de todos é falso. A conta ("Entrar", ou a
 * identidade de quem entrou), o selo com o nome do atlas e o "compartilhar esta vista" somem
 * SEMPRE, em qualquer slide.
 *
 * A lista fechada, o espelho com o servidor e a fiação do CSS estão presos em
 * `tests/unit/controles-do-slide.test.js`. Este arquivo mede o que aquele não alcança: que o
 * elemento de verdade, com o CSS de verdade, está ou não na tela. O sinal é o `display` computado
 * mais a caixa com área, e nunca a classe do `body`, que é só o meio.
 *
 * O EDITOR NÃO É AFETADO, e isso também é asserido: o autor precisa do seletor e dos visualizadores
 * para montar o slide. Roda em atlas LOCAL, anônimo.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

const ALVOS = {
    conta: '.account-control',
    compartilharVista: '.toolbar-standalone-btn[data-tool-id="share-view"]',
    base: '#base-layer-selector',
    modelos3d: '#feature-toggle-models3d',
    terreno: '#feature-toggle-terrain',
    coordenadas: '.coordinates-control',
    utilitarios: '.toolbar-group[data-group-id="utility"]',
    busca: '.search-bar-container',
    navegacao: '.bottom-controls-right',
    seloDoAtlas: '.atlas-name-badge',
};

/** Para cada alvo: true/false se está na tela, ou 'AUSENTE' se o deploy de teste não o monta. */
const naTela = (page) => page.evaluate((alvos) => Object.fromEntries(
    Object.entries(alvos).map(([nome, seletor]) => {
        const el = document.querySelector(seletor);
        if (!el) return [nome, 'AUSENTE'];
        const caixa = el.getBoundingClientRect();
        return [nome, getComputedStyle(el).display !== 'none' && caixa.width > 0 && caixa.height > 0];
    }),
), ALVOS);

async function criarBriefingComPosicao(page) {
    await page.locator('.sidebar-nav-btn[data-tab="briefings"]').click();
    await page.locator('.briefings-create-btn').click();
    await expect(page.locator('#briefing-editor')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.briefing-editor-controls-group')).toBeVisible({ timeout: 10000 });
    // O apresentador recusa slide sem posição salva.
    await page.locator('.briefing-editor-capture-btn').click();
    await expect(page.locator('.briefing-editor-position-set')).toBeVisible({ timeout: 10000 });
}

async function salvarEApresentar(page) {
    await page.locator('.briefing-editor-save-btn').click();
    await page.locator('.briefing-editor-back-btn').click();
    await expect(page.locator('#briefing-editor')).toBeHidden({ timeout: 10000 });
    await page.locator('.briefing-card').first().click();
    await expect(page.locator('body.briefing-presenting')).toBeAttached({ timeout: 15000 });
}

describeOrSkip('controles do slide na apresentação', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await page.waitForFunction(() => globalThis.__ebgeoMap?.getZoom, null, { timeout: 20000 });
        await expect(page.locator('#base-layer-selector')).toBeAttached({ timeout: 20000 });
    });

    test('padrão: nada marcado, e o palco não mostra nenhum dos controles nem a conta', async ({ page }) => {
        await criarBriefingComPosicao(page);

        // PISO: no editor os controles ESTÃO na tela. Sem isto o caso abaixo passaria sobre uma
        // página em que eles nunca existiram.
        const noEditor = await naTela(page);
        expect(noEditor.conta).toBe(true);
        expect(noEditor.base).toBe(true);
        expect(noEditor.coordenadas).toBe(true);
        expect(noEditor.utilitarios).toBe(true);
        expect(noEditor.busca).toBe(true);
        expect(noEditor.navegacao).toBe(true);
        const caixas = page.locator('.briefing-editor-control-check');
        // Uma caixa por controle da lista fechada, e nenhuma marcada.
        expect(await caixas.evaluateAll((els) => els.map((el) => el.dataset.control))).toEqual(
            ['basemap', 'models3d', 'views360', 'terrain', 'coordinates', 'utilities', 'search', 'navigation'],
        );
        expect(await caixas.evaluateAll((els) => els.filter((el) => el.checked).length)).toBe(0);

        // O SELO DO ATLAS NÃO É DESENHADO NUM ATLAS LOCAL (medido: ausente no boot, e com área zero
        // depois), então a asserção sobre ele passaria verde sem provar nada. O spec o põe na tela à
        // força, com estilo inline, que é a forma mais forte de "visível" que existe: se ele some ao
        // apresentar, é a regra da apresentação que o tirou.
        await page.evaluate(() => {
            let selo = document.querySelector('.atlas-name-badge');
            if (!selo) {
                selo = document.createElement('div');
                selo.className = 'atlas-name-badge';
                document.body.appendChild(selo);
            }
            selo.hidden = false;
            selo.textContent = 'Atlas de teste';
            selo.setAttribute('style', 'display:block;position:fixed;top:8px;left:8px;width:160px;height:24px');
        });
        expect((await naTela(page)).seloDoAtlas, 'PISO: o selo está na tela antes de apresentar').toBe(true);

        await salvarEApresentar(page);

        const noPalco = await naTela(page);
        expect(noPalco.seloDoAtlas, 'o selo do atlas não aparece em slide nenhum').toBe(false);
        for (const [nome, visivel] of Object.entries(noPalco)) {
            if (visivel === 'AUSENTE') continue;
            expect(visivel, `${nome} continua na tela ao apresentar`).toBe(false);
        }
    });

    test('o que o autor marcou volta, o resto continua escondido, e a conta não volta nunca', async ({ page }) => {
        await criarBriefingComPosicao(page);
        await page.locator('.briefing-editor-control-check[data-control="basemap"]').check();
        await page.locator('.briefing-editor-control-check[data-control="utilities"]').check();
        await page.locator('.briefing-editor-control-check[data-control="navigation"]').check();

        await salvarEApresentar(page);

        const noPalco = await naTela(page);
        expect(noPalco.base).toBe(true);
        expect(noPalco.utilitarios).toBe(true);
        // UMA caixa traz o grupo inteiro de navegação: zoom, tela cheia e bússola.
        expect(noPalco.navegacao).toBe(true);
        for (const id of ['nav-btn-zoom-in', 'nav-btn-zoom-out', 'nav-btn-fullscreen', 'nav-btn-compass']) {
            await expect(page.locator(`#${id}`)).toBeVisible();
        }
        expect(noPalco.busca, 'a busca não foi marcada').toBe(false);
        expect(noPalco.coordenadas).toBe(false);
        if (noPalco.terreno !== 'AUSENTE') expect(noPalco.terreno).toBe(false);
        if (noPalco.modelos3d !== 'AUSENTE') expect(noPalco.modelos3d).toBe(false);
        expect(noPalco.conta).toBe(false);
        expect(noPalco.compartilharVista).toBe(false);
        if (noPalco.seloDoAtlas !== 'AUSENTE') expect(noPalco.seloDoAtlas).toBe(false);
    });

    test('sair da apresentação devolve todos os controles', async ({ page }) => {
        await criarBriefingComPosicao(page);
        await salvarEApresentar(page);

        await page.locator('.briefing-text-panel__btn--exit').click();
        await expect(page.locator('body.briefing-presenting')).not.toBeAttached({ timeout: 15000 });

        const depois = await naTela(page);
        expect(depois.conta).toBe(true);
        expect(depois.base).toBe(true);
        expect(depois.coordenadas).toBe(true);
        expect(depois.utilitarios).toBe(true);
        expect(depois.busca).toBe(true);
        expect(depois.navegacao).toBe(true);
        expect(await page.evaluate(() => document.body.className)).not.toMatch(/briefing-show-/);
    });
});

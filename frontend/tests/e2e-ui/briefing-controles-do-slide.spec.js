// Path: e2e-ui/briefing-controles-do-slide.spec.js

/**
 * A APRESENTAÇÃO É UM PALCO LIMPO, no navegador real (regra do dono, 2026-09-20).
 *
 * Seis controles do mapa (seletor de mapa base, modelos 3D, imagens 360, terreno, coordenadas e
 * utilitários) ficam ESCONDIDOS ao apresentar, e cada um só volta quando o autor marcou a caixa
 * daquele slide; o padrão de todos é falso. A conta ("Entrar", ou a identidade de quem entrou) e o
 * "compartilhar esta vista" somem SEMPRE, em qualquer slide.
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
        const caixas = page.locator('.briefing-editor-control-check');
        await expect(caixas).toHaveCount(6);
        expect(await caixas.evaluateAll((els) => els.filter((el) => el.checked).length)).toBe(0);

        await salvarEApresentar(page);

        const noPalco = await naTela(page);
        for (const [nome, visivel] of Object.entries(noPalco)) {
            if (visivel === 'AUSENTE') continue;
            expect(visivel, `${nome} continua na tela ao apresentar`).toBe(false);
        }
    });

    test('o que o autor marcou volta, o resto continua escondido, e a conta não volta nunca', async ({ page }) => {
        await criarBriefingComPosicao(page);
        await page.locator('.briefing-editor-control-check[data-control="basemap"]').check();
        await page.locator('.briefing-editor-control-check[data-control="utilities"]').check();

        await salvarEApresentar(page);

        const noPalco = await naTela(page);
        expect(noPalco.base).toBe(true);
        expect(noPalco.utilitarios).toBe(true);
        expect(noPalco.coordenadas).toBe(false);
        if (noPalco.terreno !== 'AUSENTE') expect(noPalco.terreno).toBe(false);
        if (noPalco.modelos3d !== 'AUSENTE') expect(noPalco.modelos3d).toBe(false);
        expect(noPalco.conta).toBe(false);
        expect(noPalco.compartilharVista).toBe(false);
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
        expect(await page.evaluate(() => document.body.className)).not.toMatch(/briefing-show-/);
    });
});

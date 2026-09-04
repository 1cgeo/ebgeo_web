// Path: e2e-ui/secondary-server-notice.spec.js

/**
 * @fileoverview O aviso de servidor secundário, visto no navegador real.
 *
 * O servidor descartável da bancada sobe SEM configurar nada, e desde 2026-09-04 isso já basta: o
 * padrão do backend é DESLIGADO (`resolveAvisoServidorSecundario`), então a sobreposição não senta
 * em cima do primeiro clique de nenhum spec. A linha `AVISO_SERVIDOR_SECUNDARIO=false` que os dois
 * harnesses carregavam saiu junto com a inversão, porque ela passou a dizer o que já era verdade.
 *
 * Aqui a chave é LIGADA por spec, remendando a resposta de GET /api/config a caminho do navegador:
 * é a mesma porta por onde a implantação real a hidrata, e o único ponto do app que a lê. O remendo
 * é DELIBERADAMENTE independente do painel de administração: `admin-aviso-servidor-secundario.spec.js`
 * prova o caminho do administrador, que grava no banco da bancada, e este arquivo continua provando
 * a tela mesmo que aquele mude, falhe ou saia. O que se prova: a tela abre acima do mapa, o botão do
 * servidor principal aponta para a URL que o config publicou, "Continuar" fecha, Escape fecha, e sem
 * a chave nada é desenhado.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

const CONFIG_ROUTE = /\/api\/(v1\/)?config(\?.*)?$/;
const URL_PRINCIPAL = 'https://ebgeo.dsg.eb.mil.br/';

/**
 * Remenda o payload de GET /api/config a caminho do navegador.
 * @param {import('@playwright/test').Page} page
 * @param {Object} app - as chaves a fundir em `app`
 */
async function ligarAviso(page, app) {
    await page.route(CONFIG_ROUTE, async (route) => {
        const resposta = await route.fetch();
        const json = await resposta.json();
        // O controlador responde `{ data }` (config.controller.js), e é dentro de `data` que o
        // cliente lê; remendar o topo do documento não chegaria ao app.
        const alvo = json && typeof json.data === 'object' && json.data ? json.data : json;
        alvo.app = { ...(alvo.app || {}), ...app };
        await route.fulfill({ response: resposta, json });
    });
}

async function abrirMapa(page) {
    await page.goto('/');
    await expect(page.locator('#nav-btn-zoom-in')).toBeAttached({ timeout: 20000 });
}

describeOrSkip('aviso de servidor secundário (Chromium real + backend real)', () => {
    test('com a chave ligada a tela abre acima do mapa e o botão aponta para o servidor principal', async ({ page }) => {
        await ligarAviso(page, { avisoServidorSecundario: true, urlServidorPrincipal: URL_PRINCIPAL });
        await abrirMapa(page);

        const aviso = page.locator('.server-notice');
        await expect(aviso).toBeVisible();
        await expect(aviso).toHaveClass(/server-notice--visible/);
        await expect(page.locator('#server-notice-title')).toContainText('servidor secundário');

        const principal = page.locator('.server-notice__button--primary');
        await expect(principal).toHaveAttribute('href', URL_PRINCIPAL);
        await expect(principal).toContainText('ebgeo.dsg.eb.mil.br');

        // A sobreposição fica ACIMA da tela de carregamento e do mapa: o ponto central da
        // janela pertence a ela, não ao canvas.
        const acimaDoMapa = await page.evaluate(() => {
            const el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
            return Boolean(el && el.closest('.server-notice'));
        });
        expect(acimaDoMapa).toBe(true);

        await page.locator('.server-notice__button--secondary').click();
        await expect(aviso).toHaveCount(0, { timeout: 5000 });
    });

    test('Escape fecha, e sem URL o botão do principal não se desenha', async ({ page }) => {
        await ligarAviso(page, { avisoServidorSecundario: true, urlServidorPrincipal: '' });
        await abrirMapa(page);

        const aviso = page.locator('.server-notice');
        await expect(aviso).toBeVisible();
        await expect(page.locator('.server-notice__button--primary')).toHaveCount(0);
        await expect(page.locator('.server-notice__button--secondary')).toHaveCount(1);

        await page.keyboard.press('Escape');
        await expect(aviso).toHaveCount(0, { timeout: 5000 });
    });

    test('com a chave desligada (o padrão do servidor) nada é desenhado', async ({ page }) => {
        await abrirMapa(page);
        // Espera o boot avançar além da fase 1, onde a tela seria montada.
        await expect(page.locator('.toolbar-tool-btn').first()).toBeAttached({ timeout: 20000 });
        await expect(page.locator('.server-notice')).toHaveCount(0);
    });
});

// Path: e2e-ui/aparencia-do-atlas-persiste.spec.js

/**
 * @fileoverview A aparência escolhida no projeto sobrevive ao F5, no atlas LOCAL e no de SERVIDOR.
 *
 * Os dois casos falharam de formas DIFERENTES, e é por isso que os dois estão aqui. No local, a
 * escrita desistia quando não havia registro de Atlas (`getAtlas()` devolve null num slot que
 * nasceu só com mapas), e o valor nunca chegava ao disco. No remoto ele chegava e ainda assim se
 * perdia: o boot lê a aparência ANTES do snapshot, o wipe de entrada esvazia o namespace, e o
 * snapshot que traz o valor de volta não era aplicado por ninguém — o handler distribuía três
 * chaves de `atlas.settings` e deixava esta de fora, com um comentário dizendo "loaded elsewhere".
 *
 * PRECISA DE NAVEGADOR nos dois: o que se mede é um valor atravessando um reload, e um duplo em
 * processo não recarrega nada.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { loginUI } from './helpers/collab-helpers.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** Abre as configurações do projeto pela engrenagem da aba Mapas. */
async function abrirConfiguracoes(page) {
    await page.locator('.sidebar-nav-btn[data-tab="mapas"]').click();
    await page.locator('.sidebar-settings-btn').click();
    await expect(page.locator('[data-testid="atlas-settings-modal"]')).toBeVisible({ timeout: 15000 });
}

/** O que o app REALMENTE tem depois de um boot: disco + valor efetivo. */
function lerAparencia(page) {
    return page.evaluate(async () => {
        const { getRepository } = await import('/src/js/store/repositories/index.js');
        const svc = await import('/src/js/store/atlas-appearance.service.js');
        const atlas = await getRepository().getAtlas();
        return {
            noDisco: atlas?.settings ?? null,
            efetivoGlobo: svc.currentGlobeProjection(),
        };
    });
}

describeOrSkip('aparência do atlas', () => {
    test('exagero e projeção sobrevivem ao F5, no local e no servidor', async ({ browser }) => {
        test.setTimeout(240000);
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);

        await page.goto('/');
        const creds = await page.evaluate(async (base) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const api = new ApiClient({ baseUrl: `${base}/api/v1` });
            const user = {
                username: `aparencia_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`,
                password: 'Sup3r-Secret-Pw!',
                nome: 'Aparencia',
            };
            await api.register({ ...user });
            await api.login(user.username, user.password);
            await api.createAtlas({ name: 'Projeto com aparência' });
            // OS TOKENS SAEM DAQUI. `login()` os persiste no localStorage, e o boot do mapa manda
            // um visitante COM sessão numa URL nua para `atlas.html` — o reload da metade LOCAL
            // deste caso nunca chegaria ao mapa. A conta continua existindo no servidor, que é
            // tudo o que a segunda metade precisa.
            api.clearTokens();
            return user;
        }, state.baseUrl);

        // ---------- ATLAS LOCAL ----------
        await page.waitForFunction(() => globalThis.__ebgeoMap?.loaded?.(), null, { timeout: 30000 });
        // Premissa asserida: o padrão do produto é GLOBO. Sem isto, "plano depois do F5" poderia
        // ser o estado inicial em vez do valor salvo.
        expect((await lerAparencia(page)).efetivoGlobo).toBe(true);

        await abrirConfiguracoes(page);
        await page.locator('[data-testid="atlas-settings-projection-plano"]').click();
        await page.locator('[data-testid="atlas-settings-exaggeration"]').fill('2.4');
        await page.locator('[data-testid="atlas-settings-exaggeration"]').dispatchEvent('input');
        await page.locator('[data-action="save"]').click();
        await expect(page.locator('[data-testid="atlas-settings-modal"]')).toHaveCount(0, { timeout: 10000 });

        await page.reload();
        await page.waitForFunction(() => globalThis.__ebgeoMap?.loaded?.(), null, { timeout: 30000 });
        const local = await lerAparencia(page);
        expect(local.noDisco?.globeProjection, 'a projeção não chegou ao disco').toBe(false);
        expect(local.noDisco?.terrainExaggeration).toBeCloseTo(2.4, 5);
        expect(local.efetivoGlobo, 'o boot voltou a globo apesar do valor salvo').toBe(false);

        // ---------- ATLAS DE SERVIDOR ----------
        await loginUI(page, creds.username, creds.password);
        await page.locator('[data-testid="project-picker-item"]').first().click();
        await expect(page.locator('[data-testid="sync-status-badge"]'))
            .toHaveAttribute('data-state', 'online', { timeout: 30000 });

        // O atlas do servidor nasce sem escolha: globo, e NÃO o "plano" do slot local — o que
        // também prova que a preferência é por atlas e não por instalação.
        //
        // POLL, NÃO LEITURA ÚNICA, e a razão é a ORDEM em `openRemoteAtlas`
        // (`account/open-atlas.service.js`): `syncEngine.connect()` vem PRIMEIRO, e é ele que acende
        // o badge; `reapplyAtlasAppearance()` só roda depois, atrás de `activateAtlasInitialMap` e
        // da troca de camada base. O badge online, portanto, NÃO significa que a aparência do atlas
        // novo já foi relida, e `currentGlobeProjection()` lê um cache de módulo que até lá ainda
        // guarda a escolha do atlas ANTERIOR. Uma leitura única aqui mede essa janela, não o
        // produto: reprovou duas vezes seguidas numa máquina rápida (~9 s) e passou numa lenta
        // (~15 s), que é a assinatura de corrida, não de defeito.
        //
        // O poll não afrouxa a asserção: se a preferência realmente vazasse entre atlas, o valor
        // nunca viraria `true` e o caso reprovaria igual, só que pelo motivo certo.
        await expect
            .poll(async () => (await lerAparencia(page)).efetivoGlobo, { timeout: 20000 })
            .toBe(true);

        await abrirConfiguracoes(page);
        await page.locator('[data-testid="atlas-settings-projection-plano"]').click();
        await page.locator('[data-testid="atlas-settings-exaggeration"]').fill('1.9');
        await page.locator('[data-testid="atlas-settings-exaggeration"]').dispatchEvent('input');
        await page.locator('[data-action="save"]').click();
        await expect(page.locator('[data-testid="atlas-settings-modal"]')).toHaveCount(0, { timeout: 10000 });
        // A op precisa ter subido antes do reload, senão o que se mede é a fila e não o servidor.
        await page.waitForTimeout(3000);

        await page.reload();
        await expect(page.locator('[data-testid="sync-status-badge"]'))
            .toHaveAttribute('data-state', 'online', { timeout: 30000 });
        await expect
            .poll(async () => (await lerAparencia(page)).noDisco?.globeProjection, { timeout: 20000 })
            .toBe(false);
        const remoto = await lerAparencia(page);
        expect(remoto.noDisco?.terrainExaggeration).toBeCloseTo(1.9, 5);
        expect(remoto.efetivoGlobo, 'o boot remoto voltou a globo apesar do snapshot').toBe(false);

        await ctx.close();
    });
});

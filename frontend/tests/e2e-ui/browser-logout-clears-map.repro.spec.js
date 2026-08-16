// Path: e2e-ui/browser-logout-clears-map.repro.spec.js

/**
 * @fileoverview Regressão: ao sair da conta, o mapa do SERVIDOR não pode continuar desenhado.
 *
 * O QUE O USUÁRIO RELATOU: depois de "Sair", as feições do mapa antigo continuavam na tela. Não
 * era só o store: o bug visível estava nas sources vivas do MapLibre, que ninguém repovoava.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ESTE ARQUIVO FOI REESCRITO EM 2026-08-16
 * ---------------------------------------------------------------------------
 * A versão anterior desenhava no MAPA LOCAL e exigia que, depois do logout, o store voltasse a
 * ZERO feições e a UM único mapa em branco. Ela era fiel ao produto do dia em que foi escrita,
 * porque local e remoto dividiam os mesmos dez bancos: para alcançar o dado do servidor era
 * preciso esvaziar tudo, e o mapa local ia junto por não haver como separar os dois.
 *
 * Com um namespace de IndexedDB por atlas isso deixou de ser verdade, e a decisão de produto
 * (2026-08-16) fechou a questão:
 *
 *   "O uso dos dados locais não depende de estar logado. Deslogado se acessa todos os locais;
 *    estar logado só dá acesso aos remotos. Ao deslogar, tira-se o acesso aos remotos, e não se
 *    sai de repositório local nem se apaga nada local."
 *
 * Manter a asserção antiga seria exigir, em verde, que sair da conta apagasse trabalho local: um
 * `.ebgeo` importado nasce num slot próprio e "Mapa local" é um slot. O caso foi TROCADO, nunca
 * somado, porque um teste que continue exigindo o comportamento anterior faz a correção parecer
 * regressão.
 *
 * ---------------------------------------------------------------------------
 * O QUE ESTE ARQUIVO MEDE AGORA
 * ---------------------------------------------------------------------------
 * Os dois lados da mesma decisão, e o segundo é o controle do primeiro:
 *   1. o que foi desenhado num atlas DE SERVIDOR some do store E das sources vivas depois do
 *      logout (o bug relatado);
 *   2. o que foi desenhado num atlas LOCAL SOBREVIVE ao mesmo gesto.
 *
 * Sem (2), "o logout limpou" seria satisfeito por um wipe que apaga tudo, que é exatamente o
 * comportamento que a decisão removeu. Sem (1), (2) seria satisfeito por um logout que não
 * limpa nada.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { loginUI, goToLocalMapUI, drawPointUI, seedSharedAtlas, openAtlasUI } from './helpers/collab-helpers.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** Lingering-data snapshot: store map names, store feature count, and LIVE source feature count. */
function snapshotTraces(page) {
    return page.evaluate(async () => {
        const store = await import('/src/js/store/index.js');
        const mapNames = await store.getAllMapNamesStore();
        const feats = await store.getCurrentMapFeatures();
        let storeFeatures = 0;
        for (const arr of Object.values(feats || {})) {
            if (Array.isArray(arr)) storeFeatures += arr.length;
        }
        // Live MapLibre sources: sum features across every GeoJSON source (the visual "trace").
        const map = globalThis.__ebgeoMap;
        let sourceFeatures = 0;
        const srcIds = map ? Object.keys(map.getStyle().sources || {}) : [];
        for (const id of srcIds) {
            const s = map.getSource(id);
            if (s && typeof s.getData === 'function') {
                const d = await s.getData();
                if (d && Array.isArray(d.features)) sourceFeatures += d.features.length;
            }
        }
        return { mapNames, storeFeatures, sourceFeatures };
    });
}

/** Sai pela conta de verdade e espera o botão de entrar voltar. */
async function logoutPeloMenu(page) {
    await page.locator('[data-testid="account-control"] .account-control__identity').click();
    await page.locator('[data-testid="account-logout-btn"]').click();
    await expect(page.locator('[data-testid="account-login-btn"]')).toBeVisible({ timeout: 15000 });
}

describeOrSkip('Sair da conta: o mapa do SERVIDOR some, o LOCAL fica', () => {
    test('o que foi desenhado no atlas de SERVIDOR some do store e das sources vivas', async ({ browser }) => {
        test.setTimeout(120000);

        const seed = await seedSharedAtlas(browser, state.baseUrl, { mapName: 'Mapa do Servidor' });
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);
        await page.goto('/');
        await loginUI(page, seed.userA.username, seed.userA.password);
        await openAtlasUI(page, seed.atlasId);

        const pointId = await drawPointUI(page, [-43.21, -22.91]);
        expect(pointId, 'the point tool created a feature in the SERVER atlas').toBeTruthy();
        await page.keyboard.press('Escape');

        // POSITIVE control before the destructive act: without it, "gone" and "never there" are
        // the same green.
        const before = await snapshotTraces(page);
        expect(before.storeFeatures, 'point present in the store before logout').toBeGreaterThan(0);
        expect(before.sourceFeatures, 'point present in the live map source before logout').toBeGreaterThan(0);

        await logoutPeloMenu(page);

        // O BUG RELATADO: o traço visual. O store é a metade fácil; as sources vivas são o que o
        // usuário via na tela.
        await expect.poll(async () => (await snapshotTraces(page)).storeFeatures, { timeout: 15000 }).toBe(0);
        const after = await snapshotTraces(page);
        expect(after.sourceFeatures, 'nenhum traço da feição do servidor nas sources vivas após o logout').toBe(0);

        await ctx.close();
    });

    test('CONTROLE: o que foi desenhado no atlas LOCAL sobrevive ao mesmo logout', async ({ browser }) => {
        // Este é o controle negativo do caso acima E a prova da decisão de produto. Sem ele, o
        // teste anterior seria satisfeito por um wipe que apaga tudo, que é o comportamento que
        // a decisão removeu.
        test.setTimeout(120000);

        const seed = await seedSharedAtlas(browser, state.baseUrl, { mapName: 'Mapa do Servidor' });
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);
        await page.goto('/');
        await loginUI(page, seed.userA.username, seed.userA.password);

        // No MAPA LOCAL, logado: o trabalho é do usuário e não tem relação com a sessão.
        await goToLocalMapUI(page);
        await page.waitForFunction(
            () => globalThis.__ebgeoMap && typeof globalThis.__ebgeoMap.loaded === 'function' && globalThis.__ebgeoMap.loaded(),
            { timeout: 20000 });

        const pointId = await drawPointUI(page, [-43.31, -22.81]);
        expect(pointId, 'the point tool created a feature in the LOCAL atlas').toBeTruthy();
        await page.keyboard.press('Escape');
        expect((await snapshotTraces(page)).storeFeatures, 'ponto presente antes do logout')
            .toBeGreaterThan(0);

        await logoutPeloMenu(page);

        // A DECISÃO: sair da conta tira o acesso ao REMOTO e não toca no local.
        const after = await snapshotTraces(page);
        expect(
            after.storeFeatures,
            'o desenho feito no atlas LOCAL sobreviveu ao logout (deslogado se acessa todos os '
            + 'locais; sair da conta só tira o acesso aos remotos)',
        ).toBeGreaterThan(0);

        await ctx.close();
    });
});

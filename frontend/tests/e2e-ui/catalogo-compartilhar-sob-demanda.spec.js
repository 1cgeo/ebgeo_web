// Path: e2e-ui/catalogo-compartilhar-sob-demanda.spec.js

/**
 * THE CATALOG CARD'S "Compartilhar", in real Chromium against the real backend, after the resource
 * share dialog left the map's boot (commit `0d2f40f3`: `catalog/catalog.modal.js` opens it through
 * `catalog/resource-share-launcher.js`, a door over `carregarSobDemanda`).
 *
 * WHY THIS FILE EXISTS. No spec clicked `catalog-card-share` before it. The dialog was covered only
 * from the base layer selector (`resource-share-criar-grupo.spec.js`), whose button already loaded
 * it by `import()`. The catalog path was the one that changed, so it is the one measured here.
 *
 * TWO CASES, for the two outcomes of the door:
 *   1. the chunk arrives: the card's button opens the dialog and a grant goes through, with the
 *      grantee row in the list (the server answered, not only the screen);
 *   2. the chunk does not arrive: the request is aborted in the browser, the door retries once and
 *      then the non-modal notice with "Recarregar" appears, and no dialog opens. Waiting on the
 *      notice's computed opacity, not on `toBeVisible()`, because it may fade in.
 *
 * THE SUBJECT IS A PRIVATE TILESET seen by an administrator: `canShareResource` is true for
 * anyone with global data access, and the card draws the action only on a private item. A public
 * tileset is seeded too, so the catalog chip exists whatever the private sum does at boot.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { closeDb } from './helpers/db.js';
import { createVerifiedUser } from './helpers/accounts.js';
import { seedTileset } from './helpers/catalog-seed.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** The module the door fetches, as the dev server serves it. */
const MODULO_DO_MODAL = '**/src/js/catalog/resource-share.modal.js*';

/** Boots anonymous, logs in through the UI and lands on the local map. */
async function entrarNoMapa(page, creds) {
    await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);
    await page.goto('/');
    await page.evaluate(() => { try { localStorage.clear(); } catch { /* ignore */ } });
    await page.goto('/');
    await expect(page.locator('[data-testid="account-control"]')).toBeAttached({ timeout: 20000 });
    await page.locator('[data-testid="account-login-btn"]').click();
    await page.locator('[data-testid="login-username"]').fill(creds.username);
    await page.locator('[data-testid="login-password"]').fill(creds.password);
    await page.locator('[data-testid="login-submit"]').click();
    await page.waitForURL('**/atlas.html', { timeout: 20000 });
    await page.locator('[data-testid="projects-local-map"]').click();
    await expect(page.locator('[data-testid="account-control"]')).toBeAttached({ timeout: 20000 });
}

/** Opens the catalog and returns the card of the named item, with its share button drawn. */
async function cartaoCompartilhavel(page, nome) {
    const chip = page.locator('#chip-catalog');
    await expect(chip).toBeVisible({ timeout: 20000 });
    await chip.click();
    const overlay = page.locator('#catalog-modal-overlay');
    await expect(overlay).toHaveAttribute('data-visible', 'true', { timeout: 10000 });
    const cartao = overlay.locator('.catalog-card', { hasText: nome });
    await expect(cartao).toBeVisible({ timeout: 15000 });
    // The share action is drawn only once the private sum arrived (`isPrivateResource`).
    await expect(cartao.locator('[data-testid="catalog-card-share"]')).toBeVisible({ timeout: 15000 });
    return cartao;
}

describeOrSkip('Catálogo: "Compartilhar" do cartão abre o modal carregado sob demanda', () => {
    test.describe.configure({ retries: 0 });
    test.afterAll(async () => { await closeDb(); });

    test('o botão do cartão abre o modal, e conceder a um grupo chega ao servidor', async ({ page }) => {
        const admin = await createVerifiedUser({ prefix: 'catshr', nome: 'Catalogo Admin', role: 'admin' });
        await seedTileset(state.dbName, { name: 'Modelo publico do catalogo' });
        const nome = `Modelo privado ${Math.random().toString(36).slice(2, 8)}`;
        await seedTileset(state.dbName, { name: nome, accessLevel: 'private' });

        // The door's module travels on the click, and only then: recorded to prove it.
        const pedidosDoModal = [];
        page.on('request', (req) => {
            if (req.url().includes('/src/js/catalog/resource-share.modal.js')) pedidosDoModal.push(req.url());
        });

        await entrarNoMapa(page, admin);
        const cartao = await cartaoCompartilhavel(page, nome);
        expect(pedidosDoModal, 'o modal foi buscado antes do clique').toEqual([]);

        await cartao.locator('[data-testid="catalog-card-share"]').click();
        await expect(page.locator('[data-testid="resource-share-modal"]')).toBeVisible({ timeout: 15000 });
        await expect(page.locator('[data-testid="resource-share-loading"]')).toHaveCount(0, { timeout: 15000 });
        expect(pedidosDoModal.length, 'o modal não foi buscado no clique').toBeGreaterThan(0);

        const nomeGrupo = `Celula ${Math.random().toString(36).slice(2, 8)}`;
        await page.locator('[data-testid="resource-share-new-group"]').click();
        const campo = page.locator('[data-testid="resource-share-new-group-name"]');
        await expect(campo).toBeVisible({ timeout: 5000 });
        await campo.fill(nomeGrupo);
        await page.locator('[data-testid="resource-share-create-group"]').click();
        await expect(page.locator('.toast--success', { hasText: `Grupo "${nomeGrupo}" criado.` }))
            .toBeVisible({ timeout: 15000 });
        await expect(page.locator('[data-testid="resource-share-grant-group"]')).toBeEnabled();

        const concessao = page.waitForResponse(
            (r) => r.request().method() === 'POST'
                && /\/resource-access\/[^/]+\/[^/]+\/grants$/.test(new URL(r.url()).pathname),
            { timeout: 15000 },
        );
        await page.locator('[data-testid="resource-share-grant-group"]').click();
        const resposta = await concessao;
        expect(resposta.status(), 'o servidor recusou a concessão').toBeLessThan(300);
        await expect(page.locator('.toast--success', { hasText: 'Acesso concedido ao grupo.' }))
            .toBeVisible({ timeout: 15000 });
        const linha = page.locator('[data-testid="resource-share-grant"][data-grantee-kind="grupo"]',
            { hasText: nomeGrupo });
        await expect(linha).toBeVisible({ timeout: 15000 });
    });

    test('o chunk que não chega mostra o aviso com "Recarregar", e nenhum modal abre', async ({ page }) => {
        const admin = await createVerifiedUser({ prefix: 'catshr', nome: 'Catalogo Admin', role: 'admin' });
        await seedTileset(state.dbName, { name: 'Modelo publico do catalogo' });
        const nome = `Modelo privado ${Math.random().toString(36).slice(2, 8)}`;
        await seedTileset(state.dbName, { name: nome, accessLevel: 'private' });

        await entrarNoMapa(page, admin);
        const cartao = await cartaoCompartilhavel(page, nome);

        // Installed AFTER the boot, so only the click's fetch can hit it.
        let abortados = 0;
        await page.route(MODULO_DO_MODAL, (route) => {
            abortados += 1;
            return route.abort('failed');
        });

        await cartao.locator('[data-testid="catalog-card-share"]').click();

        const aviso = page.locator('.aviso-de-carga');
        await expect(aviso).toBeAttached({ timeout: 15000 });
        await expect.poll(
            () => aviso.evaluate((el) => Number(getComputedStyle(el).opacity)),
            { timeout: 10000 },
        ).toBeGreaterThan(0.9);
        const texto = await aviso.locator('.aviso-de-carga__texto').innerText();
        console.log(`[aviso de carga] "${texto}" (pedidos abortados: ${abortados})`);
        expect(texto).toBe('Não foi possível carregar esta função. Recarregue a página para continuar.');
        await expect(aviso.locator('.aviso-de-carga__recarregar')).toHaveText('Recarregar');

        expect(abortados, 'o clique não pediu o módulo do modal').toBeGreaterThan(0);
        await expect(page.locator('[data-testid="resource-share-modal"]')).toHaveCount(0);
        // The catalog stays open: the failed share did not take the person out of it.
        await expect(page.locator('#catalog-modal-overlay')).toHaveAttribute('data-visible', 'true');
    });
});

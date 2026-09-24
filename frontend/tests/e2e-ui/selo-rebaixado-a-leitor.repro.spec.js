// Path: e2e-ui/selo-rebaixado-a-leitor.repro.spec.js

/**
 * @fileoverview QUEM É REBAIXADO A LEITOR COM TRABALHO NA FILA NÃO VÊ "ENVIANDO" PARA SEMPRE.
 *
 * O envio de lote exige o nível `comment` (`backend/src/modules/sync/sync.routes.js`), então um
 * Leitor recebe 403 em TODO envio. O laço de envio avisa uma vez por toast, e o selo de
 * sincronização, que só conhecia a fila e a conexão, dizia "Enviando 1…" enquanto a aba vivesse:
 * uma promessa de envio que o servidor recusa a cada tentativa. O selo passa a dizer que as
 * alterações não podem ser enviadas com o nível atual (`describeSyncWork`,
 * `account/sync-phrases.js`, com a última falha do envio lida de `sync-flush.js`).
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { createVerifiedUser } from './helpers/accounts.js';
import { currentMapKeyIsUuid } from './helpers/collab-helpers.js';
import { realPointFeature } from '../helpers/real-fixtures.js';
import { clienteNaPagina } from './helpers/cliente-de-teste.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

const SELO = '[data-testid="sync-status-badge"]';

describeOrSkip('o selo de sincronização de quem foi rebaixado a Leitor', () => {
    test.describe.configure({ retries: 0 });

    test('com uma alteração na fila, o selo diz que o nível atual não permite enviar', async ({ page }) => {
        test.setTimeout(240000);
        const dono = await createVerifiedUser({ prefix: 'rebaixa-dono', nome: 'Dono' });
        const editor = await createVerifiedUser({ prefix: 'rebaixa-editor', nome: 'Editor rebaixado' });
        await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);
        await page.goto('/atlas.html');
        const atlasId = await page.evaluate(async ({ api, outro }) => {
            const atlas = await api.createAtlas({ name: 'Atlas com rebaixamento' });
            await api.addShare(atlas.id, outro, 'write');
            return atlas.id;
        }, { api: await clienteNaPagina(page, dono), outro: editor.id });

        await page.locator('[data-testid="projects-login"]').click();
        await page.locator('[data-testid="login-username"]').fill(editor.username);
        await page.locator('[data-testid="login-password"]').fill(editor.password);
        await page.locator('[data-testid="login-submit"]').click();
        await expect(page.locator('[data-testid="app-bar-logout"]')).toBeVisible({ timeout: 30000 });
        await page.goto(`/?atlas=${atlasId}`);
        await expect(page.locator(SELO)).toHaveAttribute('data-state', 'online', { timeout: 60000 });
        await expect.poll(() => currentMapKeyIsUuid(page), { timeout: 30000 }).toBe(true);

        // Uma alteração que fica na fila: o envio é cortado enquanto o nível muda.
        await page.route('**/atlas/*/sync', (route) => (route.request().method() === 'POST'
            ? route.abort('connectionfailed') : route.continue()));
        await page.evaluate(async (f) => {
            const store = await import('/src/js/store/index.js');
            await store.addFeature('points', f);
        }, realPointFeature({ nome: 'ANTES DO REBAIXAMENTO' }));
        await page.evaluate(async ({ api, id, outro }) => api.updateShare(id, outro, 'read'),
            { api: await clienteNaPagina(page, dono), id: atlasId, outro: editor.id });
        await page.unroute('**/atlas/*/sync');

        // O envio volta e é recusado (403) a cada tentativa. O selo não pode seguir prometendo envio.
        const envioRecusado = page.waitForResponse((r) => /\/atlas\/[^/]+\/sync$/.test(r.url())
            && r.request().method() === 'POST' && r.status() === 403, { timeout: 60000 });
        await envioRecusado;
        await expect.poll(() => page.locator(SELO).getAttribute('data-work'), { timeout: 20000 })
            .toBe('sem-permissao');
        const rotulo = (await page.locator(SELO).innerText()).replace(/\s+/g, ' ');
        const titulo = await page.locator(SELO).getAttribute('aria-label');
        process.stdout.write(`[selo-leitor] ${JSON.stringify({ rotulo, titulo })}\n`);
        expect(rotulo).not.toMatch(/Enviando/);
    });
});

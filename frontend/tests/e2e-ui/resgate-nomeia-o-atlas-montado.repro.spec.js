// Path: e2e-ui/resgate-nomeia-o-atlas-montado.repro.spec.js

/**
 * @fileoverview REPRO: O TRABALHO RESGATADO DO ATLAS MONTADO NASCIA SEM O NOME DELE.
 *
 * Medido em 2026-09-24, com a figura de `imagem-resgate-de-sessao.spec.js`: a sessão cai sem gesto,
 * o resgate adota o atlas aberto como atlas LOCAL, e o cartão aparece em `atlas.html` como
 * "Trabalho recuperado em 24/09/2026", não com o nome do atlas. O nome do atlas montado vinha só de
 * `AccountControl._atlasCache`, e esse cache é preenchido por `_renderAtlasName`, que só roda ao
 * ABRIR O MENU DA CONTA. Quem abriu o atlas pelo endereço (ou pelo cartão) e nunca abriu o menu
 * perdia o nome, enquanto os OUTROS atlas da mesma saída (`preserveUnsyncedWorkOfOtherAtlases`) o
 * liam do disco e saíam nomeados. Com dois resgates, a pessoa não sabe qual é qual.
 *
 * O GESTO: atlas aberto pelo endereço, o envio cortado, um ponto na fila, a sessão cai
 * (`handleSessionLost`, o caminho da inatividade). O veredito é o nome do slot que reivindica o
 * namespace do atlas, lido do registro local.
 *
 * Rodar isolado:
 *   cd frontend && npx playwright test resgate-nomeia-o-atlas-montado --retries=0 --workers=1
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { createVerifiedUser } from './helpers/accounts.js';
import { currentMapKeyIsUuid } from './helpers/collab-helpers.js';
import { clienteNaPagina } from './helpers/cliente-de-teste.js';
import { realPointFeature } from '../helpers/real-fixtures.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;
const NOME = 'Reconhecimento da ponte norte';

describeOrSkip('o resgate do atlas montado leva o nome dele', () => {
    test.describe.configure({ retries: 0 });

    test('sem abrir o menu da conta, o slot resgatado se chama como o atlas', async ({ page }) => {
        test.setTimeout(180000);
        const creds = await createVerifiedUser({ prefix: 'resgnome', nome: 'Resgate Nome' });
        await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);
        await page.goto('/atlas.html');
        await page.locator('[data-testid="projects-login"]').click();
        await page.locator('[data-testid="login-username"]').fill(creds.username);
        await page.locator('[data-testid="login-password"]').fill(creds.password);
        await page.locator('[data-testid="login-submit"]').click();
        await expect(page.locator('[data-testid="app-bar-logout"]')).toBeVisible({ timeout: 30000 });
        const atlas = await page.evaluate(async ({ api, nome }) => api.createAtlas({ name: nome }),
            { api: await clienteNaPagina(page, creds), nome: NOME });

        await page.goto(`/?atlas=${atlas.id}`);
        await expect(page.locator('[data-testid="sync-status-badge"]')).toHaveAttribute('data-state', 'online', { timeout: 60000 });
        await expect.poll(() => currentMapKeyIsUuid(page), { timeout: 30000 }).toBe(true);
        await page.route(`**/atlas/${atlas.id}/sync`, (route) => (route.request().method() === 'POST'
            ? route.abort('connectionfailed') : route.continue()));
        await page.evaluate(async (f) => {
            const store = await import('/src/js/store/index.js');
            await store.addFeature('points', f);
        }, realPointFeature({ nome: 'Ponto na fila' }));

        await page.evaluate(async () => {
            const store = await import('/src/js/store/index.js');
            await store.getControl('account').handleSessionLost('Sua sessão expirou por inatividade.');
        });

        const slot = await page.evaluate(async (atlasId) => {
            const local = await import('/src/js/store/local-atlas.api.js');
            const entrada = await local.localAtlasAdoptingRemote(atlasId);
            return entrada ? { id: entrada.id, name: entrada.name } : null;
        }, atlas.id);
        console.log(`[resgate] slot: ${JSON.stringify(slot)}`);
        expect(slot, 'o trabalho pendente não foi resgatado').not.toBeNull();
        expect(slot.name, 'o atlas resgatado perdeu o nome do atlas de onde veio').toBe(NOME);
    });
});

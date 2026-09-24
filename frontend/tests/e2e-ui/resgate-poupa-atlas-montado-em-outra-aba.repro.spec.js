// Path: e2e-ui/resgate-poupa-atlas-montado-em-outra-aba.repro.spec.js

/**
 * @fileoverview O RESGATE DOS ATLAS DEIXADOS NÃO ADOTA O ATLAS QUE OUTRA ABA VIVA TEM MONTADO.
 *
 * DUAS ABAS DO MESMO PERFIL: a aba 2 trabalha no atlas A com a rede ruim (a edição fica na fila); a
 * aba 1 está no atlas B e perde a sessão sem gesto (o relógio de inatividade é POR ABA). O resgate de
 * `preserveUnsyncedWorkOfOtherAtlases` via o namespace de A com pendência e o adotava como atlas
 * local, sob os pés da aba 2: a aba 2 seguia drenando a fila de A (e o aviso mandava "Enviar ao
 * servidor", que duplica o atlas no servidor), e quando a sessão DELA caísse o esvaziamento do
 * atlas montado apagaria o que agora era o atlas local. O árbitro é o mesmo da varredura: o lock de
 * montagem. A aba que tem o atlas montado é quem o resgata na própria saída.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { createVerifiedUser } from './helpers/accounts.js';
import { currentMapKeyIsUuid } from './helpers/collab-helpers.js';
import { realPointFeature } from '../helpers/real-fixtures.js';
import { clienteNaPagina } from './helpers/cliente-de-teste.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

async function entrarPelaInterface(page, creds) {
    await page.locator('[data-testid="projects-login"]').click();
    await page.locator('[data-testid="login-username"]').fill(creds.username);
    await page.locator('[data-testid="login-password"]').fill(creds.password);
    await page.locator('[data-testid="login-submit"]').click();
    await expect(page.locator('[data-testid="app-bar-logout"]')).toBeVisible({ timeout: 30000 });
}

async function abrirOnline(page, atlasId) {
    await page.goto(`/?atlas=${atlasId}`);
    await expect(page.locator('[data-testid="sync-status-badge"]'))
        .toHaveAttribute('data-state', 'online', { timeout: 60000 });
    await expect.poll(() => currentMapKeyIsUuid(page), { timeout: 30000 }).toBe(true);
}

describeOrSkip('o resgate e o atlas montado em outra aba', () => {
    test.describe.configure({ retries: 0 });

    test('a queda da sessão na aba 1 não adota o atlas que a aba 2 tem montado', async ({ browser }) => {
        test.setTimeout(300000);
        const contexto = await browser.newContext();
        await contexto.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);
        try {
            const aba1 = await contexto.newPage();
            const creds = await createVerifiedUser({ prefix: 'resgate-duas-abas', nome: 'Resgate duas abas' });
            await aba1.goto('/atlas.html');
            await entrarPelaInterface(aba1, creds);
            const { a, b } = await aba1.evaluate(async ({ api }) => ({
                a: (await api.createAtlas({ name: 'Atlas A na aba 2' })).id,
                b: (await api.createAtlas({ name: 'Atlas B na aba 1' })).id,
            }), { api: await clienteNaPagina(aba1, creds) });

            const aba2 = await contexto.newPage();
            await abrirOnline(aba2, a);
            await aba2.route('**/atlas/*/sync', (route) => (route.request().method() === 'POST'
                ? route.abort('connectionfailed') : route.continue()));
            await aba2.evaluate(async (f) => {
                const store = await import('/src/js/store/index.js');
                await store.addFeature('points', f);
            }, realPointFeature({ nome: 'PENDENTE NA ABA 2' }));

            await abrirOnline(aba1, b);
            await aba1.evaluate(async () => {
                const store = await import('/src/js/store/index.js');
                await store.getControl('account').handleSessionLost('Sua sessão expirou por inatividade.');
            });

            const adotado = await aba1.evaluate(async (id) => {
                const local = await import('/src/js/store/local-atlas.api.js');
                return (await local.localAtlasAdoptingRemote(id))?.name ?? null;
            }, a);
            const escopoDaAba2 = await aba2.evaluate(async () => {
                const ns = await import('/src/js/store/atlas-namespace.js');
                const e = ns.getActiveScope();
                return `${e?.kind}:${e?.atlasId}`;
            });
            process.stdout.write(`[duas-abas] ${JSON.stringify({ adotado, escopoDaAba2 })}\n`);
            expect(adotado, 'a aba 1 adotou como local o atlas que a aba 2 tem montado').toBeNull();
            expect(escopoDaAba2, 'a aba 2 continua no atlas de servidor').toBe(`remote:${a}`);
        } finally {
            await contexto.close();
        }
    });
});

// Path: e2e-ui/sessao-adiada-outra-conta-nao-herda-fila.repro.spec.js

/**
 * @fileoverview NA SESSÃO ADIADA, OUTRA CONTA QUE ENTRA NÃO ENVIA A FILA DA CONTA ANTERIOR.
 *
 * A SEQUÊNCIA: a conta 1 edita o atlas A com a rede ruim (a edição fica na fila) e recarrega num
 * instante em que o `/auth/me` responde 503. A restauração é ADIADA: o par de tokens fica no disco e
 * a varredura não roda (`enforceLocalStoreWhenLoggedOut`), o que é certo para a MESMA conta voltar.
 * O modal de login está aberto, e a conta 2 (que também edita A) entra por ele. A fila não carrega
 * identidade nenhuma, e a abertura de A pela conta 2 a enviava com o token da conta 2: a edição da
 * conta 1 chegava ao servidor assinada pela conta 2.
 *
 * O CONSERTO dá à conta anterior a saída que ela não teve (`endPreviousAccountIfReplaced`): o
 * trabalho não enviado dela é resgatado como atlas local e os namespaces de servidor restantes são
 * varridos, antes de a conta nova montar qualquer coisa.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { createVerifiedUser } from './helpers/accounts.js';
import { currentMapKeyIsUuid } from './helpers/collab-helpers.js';
import { realPointFeature } from '../helpers/real-fixtures.js';
import { clienteNaPagina } from './helpers/cliente-de-teste.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

async function preencherLogin(page, creds) {
    await page.locator('[data-testid="login-username"]').fill(creds.username);
    await page.locator('[data-testid="login-password"]').fill(creds.password);
    await page.locator('[data-testid="login-submit"]').click();
}

async function abrirOnline(page, atlasId) {
    await page.goto(`/?atlas=${atlasId}`);
    await expect(page.locator('[data-testid="sync-status-badge"]'))
        .toHaveAttribute('data-state', 'online', { timeout: 60000 });
    await expect.poll(() => currentMapKeyIsUuid(page), { timeout: 30000 }).toBe(true);
}

describeOrSkip('a sessão adiada e outra conta entrando', () => {
    test.describe.configure({ retries: 0 });

    test('a edição pendente da conta 1 não sobe com o token da conta 2', async ({ page }) => {
        test.setTimeout(300000);
        const conta1 = await createVerifiedUser({ prefix: 'adiada-conta1', nome: 'Conta um' });
        const conta2 = await createVerifiedUser({ prefix: 'adiada-conta2', nome: 'Conta dois' });
        await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);
        await page.goto('/atlas.html');
        await page.locator('[data-testid="projects-login"]').click();
        await preencherLogin(page, conta1);
        await expect(page.locator('[data-testid="app-bar-logout"]')).toBeVisible({ timeout: 30000 });
        const atlasId = await page.evaluate(async ({ api, outro }) => {
            const atlas = await api.createAtlas({ name: 'Atlas das duas contas' });
            await api.addShare(atlas.id, outro, 'write');
            return atlas.id;
        }, { api: await clienteNaPagina(page, conta1), outro: conta2.id });

        await abrirOnline(page, atlasId);
        await page.route('**/atlas/*/sync', (route) => (route.request().method() === 'POST'
            ? route.abort('connectionfailed') : route.continue()));
        const feicao = realPointFeature({ nome: 'EDICAO DA CONTA UM' });
        await page.evaluate(async (f) => {
            const store = await import('/src/js/store/index.js');
            await store.addFeature('points', f);
        }, feicao);

        // A RESTAURAÇÃO ADIADA: um 503 no /auth/me.
        await page.route('**/auth/me', (route) => route.fulfill({
            status: 503, contentType: 'application/json',
            body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'Indisponível' } }),
        }));
        await page.goto(`/?atlas=${atlasId}`);
        await expect(page.locator('[data-testid="login-username"]')).toBeVisible({ timeout: 60000 });

        // O servidor volta, o envio volta, e a CONTA 2 entra pelo modal.
        await page.unroute('**/auth/me');
        await page.unroute('**/atlas/*/sync');
        await preencherLogin(page, conta2);

        // A abertura retomada pode perguntar pelo resgate; quem responde aqui não decide o que se
        // mede, então a pergunta é recusada se aparecer.
        const pergunta = page.locator('.confirm-modal-container', { hasText: 'trabalho guardado' });
        if (await pergunta.waitFor({ state: 'visible', timeout: 15000 }).then(() => true, () => false)) {
            await pergunta.getByRole('button', { name: 'Cancelar' }).click();
        }
        // Tempo para qualquer envio que fosse sair: o laço de envio roda a cada 1,5 s.
        await page.waitForTimeout(6000);

        const noServidor = await page.evaluate(async ({ api, id }) => JSON.stringify(await api.pullSync(id, 0)),
            { api: await clienteNaPagina(page, conta1), id: atlasId });
        const resgate = await page.evaluate(async (id) => {
            const local = await import('/src/js/store/local-atlas.api.js');
            return (await local.localAtlasAdoptingRemote(id))?.name ?? null;
        }, atlasId);
        const chegou = noServidor.includes(feicao.properties.id);
        process.stdout.write(`[adiada-outra-conta] ${JSON.stringify({ chegou, resgate })}\n`);
        expect(chegou, 'a edição da conta 1 subiu com o token da conta 2').toBe(false);
        expect(resgate, 'a edição da conta 1 foi guardada como atlas local').not.toBeNull();
    });
});

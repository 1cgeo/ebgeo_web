// Path: e2e-ui/boot-com-sessao-adiada-preserva-fila.repro.spec.js

/**
 * @fileoverview UM SOLUÇO DO SERVIDOR NO BOOT NÃO APAGA A FILA DE UM ATLAS DE SERVIDOR.
 *
 * A SEQUÊNCIA: a pessoa edita o atlas A com a rede ruim (a edição fica na fila) e recarrega a
 * página, ou reabre o navegador, num instante em que o servidor responde 503 ao `GET /auth/me`.
 * `restoreSessionFromStorage` (`src/js/index.js`) trata isso como falha TRANSITÓRIA: guarda o par de
 * tokens e avisa que a sessão será retomada. Mas a guarda de boot deslogado
 * (`enforceLocalStoreWhenLoggedOut`, `src/js/store/store.js`) lia "sem sessão" como "a sessão
 * acabou" e varria todo namespace de servidor da máquina, a fila de A inclusive. O recarregamento
 * seguinte, com o servidor de volta, restaurava a mesma sessão, e a edição já não existia.
 *
 * O INSTRUMENTO LÊ O DISCO CRU e, no fim, o SERVIDOR: a pergunta não é só se a fila sobreviveu ao
 * boot, é se a edição chega ao atlas certo quando o servidor volta.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { createVerifiedUser } from './helpers/accounts.js';
import { currentMapKeyIsUuid } from './helpers/collab-helpers.js';
import { realPointFeature } from '../helpers/real-fixtures.js';
import { clienteNaPagina } from './helpers/cliente-de-teste.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** Entra pela interface de `atlas.html`, que recarrega a página já com a sessão do app. */
async function entrarPelaInterface(page, creds) {
    await page.locator('[data-testid="projects-login"]').click();
    await page.locator('[data-testid="login-username"]').fill(creds.username);
    await page.locator('[data-testid="login-password"]').fill(creds.password);
    await page.locator('[data-testid="login-submit"]').click();
    await expect(page.locator('[data-testid="app-bar-logout"]')).toBeVisible({ timeout: 30000 });
}

/** Abre o atlas pelo deep link e espera a sincronia de pé e o mapa DO ATLAS ativo. */
async function abrirOnline(page, atlasId) {
    await page.goto(`/?atlas=${atlasId}`);
    await expect(page.locator('[data-testid="sync-status-badge"]'))
        .toHaveAttribute('data-state', 'online', { timeout: 60000 });
    await expect.poll(() => currentMapKeyIsUuid(page), { timeout: 30000 }).toBe(true);
}

/** Quantas operações (`op_`) o banco de fila daquele atlas guarda, lido cru. */
function contarFila(page, atlasId) {
    return page.evaluate(async (nome) => {
        const bancos = await indexedDB.databases();
        if (!bancos.some((b) => b.name === nome)) return { existe: false, ops: 0 };
        return new Promise((resolve, reject) => {
            const pedido = indexedDB.open(nome);
            pedido.onerror = () => reject(pedido.error);
            pedido.onsuccess = () => {
                const db = pedido.result;
                if (!db.objectStoreNames.contains('operation_queue')) {
                    db.close();
                    resolve({ existe: true, ops: 0 });
                    return;
                }
                const chaves = db.transaction('operation_queue', 'readonly')
                    .objectStore('operation_queue').getAllKeys();
                chaves.onerror = () => { db.close(); reject(chaves.error); };
                chaves.onsuccess = () => {
                    const todas = chaves.result.map(String);
                    db.close();
                    resolve({ existe: true, ops: todas.filter((k) => k.startsWith('op_')).length });
                };
            };
        });
    }, `ebgeo__remote-${atlasId}`);
}

describeOrSkip('o boot com a sessão não verificada', () => {
    test.describe.configure({ retries: 0 });

    test('um 503 no /auth/me não apaga a fila, e a edição chega ao servidor quando ele volta', async ({ page }) => {
        test.setTimeout(300000);
        const creds = await createVerifiedUser({ prefix: 'sessao-adiada', nome: 'Sessão adiada' });
        await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);
        await page.goto('/atlas.html');
        await entrarPelaInterface(page, creds);
        const atlasId = await page.evaluate(
            async ({ api }) => (await api.createAtlas({ name: 'Atlas da sessão adiada' })).id,
            { api: await clienteNaPagina(page, creds) }
        );

        await abrirOnline(page, atlasId);
        await page.route('**/atlas/*/sync', (route) => (route.request().method() === 'POST'
            ? route.abort('connectionfailed') : route.continue()));
        const feicao = realPointFeature({ nome: 'PENDENTE NA SESSAO ADIADA' });
        await page.evaluate(async (f) => {
            const store = await import('/src/js/store/index.js');
            await store.addFeature('points', f);
        }, feicao);
        const antes = await contarFila(page, atlasId);
        expect(antes.ops, 'a edição ficou na fila').toBeGreaterThan(0);

        // O SOLUÇO: o servidor recusa só a verificação da sessão, com um 503, que é transitório.
        // A credencial continua boa.
        await page.route('**/auth/me', (route) => route.fulfill({
            status: 503, contentType: 'application/json',
            body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'Indisponível' } }),
        }));
        await page.goto(`/?atlas=${atlasId}`);
        await page.waitForFunction(() => Boolean(globalThis.__ebgeoMap?.loaded?.()), null, { timeout: 60000 });
        await page.locator('.loading-background').waitFor({ state: 'hidden', timeout: 60000 });

        const depois = await contarFila(page, atlasId);
        const tokens = await page.evaluate(() => Boolean(localStorage.getItem('ebgeo_auth')));
        const resgatado = await page.evaluate(async (id) => {
            const local = await import('/src/js/store/local-atlas.api.js');
            return Boolean(await local.localAtlasAdoptingRemote(id));
        }, atlasId);
        process.stdout.write(`[sessao-adiada] ${JSON.stringify({ antes, depois, tokens, resgatado })}\n`);
        // CONTROLE: o boot tratou o 503 como adiamento, e não como sessão morta.
        expect(tokens, 'o par de tokens continua guardado').toBe(true);
        expect(depois.ops, 'o boot com a sessão adiada apagou a fila do atlas').toBe(antes.ops);
        expect(resgatado, 'a fila não foi desviada para um atlas local').toBe(false);

        // A PÁGINA NÃO PODE MENTIR SOBRE O QUE MONTOU (revisão de 2026-09-23): sem sessão o boot
        // monta um slot LOCAL, então o marcador tem de dizer local, o mapa não pode ficar somente
        // leitura, e desenhar tem de gravar no slot. Com o marcador REMOTE a página inteira lia
        // "servidor" sobre um atlas local.
        const tela = await page.evaluate(async () => {
            const { isRemoteStoreSync } = await import('/src/js/store/store-origin.js');
            const { mapLockController } = await import('/src/js/locking/map-lock.controller.js');
            const ns = await import('/src/js/store/atlas-namespace.js');
            const store = await import('/src/js/store/index.js');
            const nome = 'DESENHO NO SLOT LOCAL';
            let gravou = false;
            try {
                await store.addFeature('points', {
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [-43.3, -22.8] },
                    properties: { id: crypto.randomUUID(), source: 'point', nome },
                });
                const nomes = [];
                await ns.getStore(ns.StoreName.MAPS).iterate((mapa) => {
                    for (const p of mapa?.features?.points ?? []) nomes.push(p?.properties?.nome);
                });
                gravou = nomes.includes(nome);
            } catch { /* recusada */ }
            return {
                escopo: ns.getActiveScope()?.kind,
                remoto: isRemoteStoreSync(),
                somenteLeitura: mapLockController.isReadOnly(),
                gravou,
            };
        });
        process.stdout.write(`[sessao-adiada] tela ${JSON.stringify(tela)}\n`);
        expect(tela, 'o marcador, a trava e a escrita concordam com o slot local montado').toEqual({
            escopo: 'local', remoto: false, somenteLeitura: false, gravou: true,
        });

        // O SERVIDOR VOLTA: o recarregamento restaura a MESMA sessão e a edição chega a A.
        await page.unroute('**/auth/me');
        await page.unroute('**/atlas/*/sync');
        await abrirOnline(page, atlasId);
        const transporte = await clienteNaPagina(page, creds);
        await expect.poll(() => page.evaluate(
            async ({ api, id }) => JSON.stringify(await api.pullSync(id, 0)),
            { api: transporte, id: atlasId }
        ), { timeout: 30000 }).toContain(feicao.properties.id);
    });
});

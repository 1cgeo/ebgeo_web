// Path: e2e-ui/imagem-resgate-de-sessao.spec.js

/**
 * @fileoverview A FIGURA QUE AINDA SUBIA QUANDO A SESSÃO CAIU: o resgate a guarda com os bytes, e o
 * "Enviar ao servidor" do atlas resgatado a leva inteira.
 *
 * O resgate (`preserveUnsyncedWorkAsLocal`, `session/unsynced-work-exit.js`) adota o namespace do
 * atlas de servidor como atlas LOCAL sem mover byte nenhum, e só dispara quando há trabalho na fila.
 * Uma figura cuja subida está em curso deixa na fila só a op da feição, e ela nasce PREPARADA
 * (retida atrás dos bytes): se o censo do resgate contasse só o que o flush pode enviar agora, a
 * figura seria a única edição pendente que a queda da sessão apagaria. Os testes que existiam
 * mediam o resgate com ponto comum (`sessao-perdida-poupa-fila-de-outro-atlas.repro.spec.js`) e o
 * banco de imagens com um valor marcador (`resgate-trabalho-nao-sincronizado.repro`), nunca a
 * figura de verdade com a subida segurada.
 *
 * O gesto: login pela tela, atlas de servidor aberto, a rota bulk SEGURADA pelo teste, figura pela
 * ferramenta, a sessão cai sem gesto (`handleSessionLost`, o mesmo caminho da inatividade). O
 * veredito, sempre pelo SHA-256 do blob e pelo desenho no mapa:
 *
 *   1. o atlas resgatado existe em `atlas.html`, abre, e desenha a figura com os bytes de antes;
 *   2. logado de novo, "Enviar ao servidor" no cartão do atlas resgatado cria um atlas no servidor
 *      com a feição de imagem e a linha de bytes sob o id dela, e OUTRA sessão lê o mesmo SHA.
 *
 * Rodar isolado:
 *   cd frontend && npx playwright test imagem-resgate-de-sessao --retries=0 --workers=1
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { createVerifiedUser } from './helpers/accounts.js';
import { createDb, closeDb } from './helpers/db.js';
import { clienteNaPagina, sessaoDoApp } from './helpers/cliente-de-teste.js';
import { currentMapKeyIsUuid } from './helpers/collab-helpers.js';
import {
    figuraSolida, porImagemPelaFerramenta, impressaoDoBlob, esperarDesenho, linhaDeImagem,
} from './helpers/imagem-bytes.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;
const COR = [30, 140, 220];
const NOME_DO_ATLAS = 'Atlas da figura que subia';

/** Entra pela interface de `atlas.html`, que recarrega a página já com a sessão do app. */
async function entrarPelaInterface(page, creds) {
    await page.locator('[data-testid="projects-login"]').click();
    await page.locator('[data-testid="login-username"]').fill(creds.username);
    await page.locator('[data-testid="login-password"]').fill(creds.password);
    await page.locator('[data-testid="login-submit"]').click();
    await expect(page.locator('[data-testid="app-bar-logout"]')).toBeVisible({ timeout: 30000 });
}

describeOrSkip('Resgate de sessão com uma figura ainda subindo', () => {
    test.describe.configure({ retries: 0 });
    let db;
    test.beforeAll(() => { db = createDb(state.dbName); });
    test.afterAll(async () => { await closeDb(db); });

    test('o resgate guarda a figura com os bytes, e "Enviar ao servidor" a leva inteira', async ({ browser }) => {
        test.setTimeout(300000);
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);
        const creds = await createVerifiedUser({ prefix: 'resgfig', nome: 'Resgate Figura' });
        await page.goto('/atlas.html');
        await entrarPelaInterface(page, creds);
        const atlas = await page.evaluate(async ({ api, nome }) => api.createAtlas({ name: nome }),
            { api: await clienteNaPagina(page, creds), nome: NOME_DO_ATLAS });
        await page.goto(`/?atlas=${atlas.id}`);
        await expect(page.locator('[data-testid="sync-status-badge"]')).toHaveAttribute('data-state', 'online', { timeout: 60000 });
        await expect.poll(() => currentMapKeyIsUuid(page), { timeout: 30000 }).toBe(true);
        await page.waitForFunction(() => globalThis.__ebgeoMap?.loaded?.(), null, { timeout: 30000 });

        // A SUBIDA FICA SEGURADA: a figura existe só neste computador.
        const presas = [];
        await page.route('**/atlas/*/images/bulk', (route) => { presas.push(route); });
        const png = await figuraSolida(page, COR);
        const id = await porImagemPelaFerramenta(page, { name: 'subindo.png', mimeType: 'image/png', buffer: png });
        await page.keyboard.press('Escape');
        const antes = await impressaoDoBlob(page, id);
        await page.waitForTimeout(3500);
        expect(await linhaDeImagem(db, id), 'os bytes chegaram apesar da rota segura').toBeNull();
        expect(await db.queryFeatureRow(id), 'a feição chegou antes dos bytes').toBeNull();
        const censo = await page.evaluate(async () => {
            const { operationQueue } = await import('/src/js/store/sync/operation-queue.js');
            return operationQueue.countByState();
        });
        console.log(`[resgate] fila antes da queda: ${JSON.stringify(censo)}`);

        // A SESSÃO CAI SEM GESTO.
        await page.evaluate(async () => {
            const store = await import('/src/js/store/index.js');
            await store.getControl('account').handleSessionLost('Sua sessão expirou por inatividade.');
        });
        // O SLOT do resgate, pelo id: o nome dele é assunto de outro teste.
        const slot = await page.evaluate(async (atlasId) => {
            const local = await import('/src/js/store/local-atlas.api.js');
            const entrada = await local.localAtlasAdoptingRemote(atlasId);
            return entrada ? { id: entrada.id, name: entrada.name } : null;
        }, atlas.id);
        console.log(`[resgate] slot: ${JSON.stringify(slot)}`);
        expect(slot, 'a figura que subia não virou atlas local no resgate').not.toBeNull();
        for (const r of presas.splice(0)) await r.abort('connectionfailed').catch(() => {});
        await page.unroute('**/atlas/*/images/bulk');

        // 1. O ATLAS RESGATADO, aberto de `atlas.html`, desenha a figura com os mesmos bytes.
        await page.goto('/atlas.html');
        const cartao = page.locator(`[data-testid="local-atlas-item"][data-local-atlas-id="${slot.id}"]`);
        await expect(cartao).toBeVisible({ timeout: 30000 });
        await cartao.click();
        await page.waitForFunction(() => globalThis.__ebgeoMap?.loaded?.(), null, { timeout: 30000 });
        await expect.poll(async () => (await impressaoDoBlob(page, id))?.sha ?? null, { timeout: 30000,
            message: 'o atlas resgatado perdeu os bytes da figura' }).toBe(antes.sha);
        await esperarDesenho(page, id, COR, { rotulo: 'atlas resgatado:' });

        // 2. LOGADO DE NOVO, "Enviar ao servidor" no cartão do atlas resgatado.
        await page.goto('/atlas.html');
        await entrarPelaInterface(page, creds);
        const doResgate = page.locator(`[data-testid="local-atlas-item"][data-local-atlas-id="${slot.id}"]`);
        await expect(doResgate).toBeVisible({ timeout: 30000 });
        await doResgate.locator('xpath=following-sibling::*[@data-testid="local-atlas-menu"]').click();
        await page.locator('[data-testid="local-atlas-send-to-server"]').click();
        await page.locator('[data-testid="local-atlas-name-input"]').fill('Figura enviada depois do resgate');
        await page.locator('[data-testid="local-atlas-name-confirm"]').click();
        await page.waitForURL(/[?&]atlas=/, { timeout: 120000 });
        const novo = new URL(page.url()).searchParams.get('atlas');
        expect(novo).not.toBe(atlas.id);

        const noServidor = await db.raw.any(
            `SELECT f.id FROM features f JOIN maps m ON m.id = f.map_id
             WHERE m.atlas_id = $1 AND f.feature_type = 'image' AND f.deleted_at IS NULL`, [novo]);
        expect(noServidor, 'o atlas enviado tem a feição de imagem').toHaveLength(1);
        const idNovo = noServidor[0].id;
        expect(await linhaDeImagem(db, idNovo), 'os bytes da figura estão no atlas enviado')
            .toMatchObject({ id: idNovo, atlas_id: novo, size_bytes: antes.size });

        const ctx2 = await browser.newContext();
        const outra = await ctx2.newPage();
        await outra.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);
        await sessaoDoApp(outra, creds, `/?atlas=${novo}`);
        await expect(outra.locator('[data-testid="sync-status-badge"]')).toHaveAttribute('data-state', 'online', { timeout: 60000 });
        await expect.poll(async () => (await impressaoDoBlob(outra, idNovo))?.sha ?? null, { timeout: 30000,
            message: 'a outra sessão não lê os bytes da figura enviada' }).toBe(antes.sha);
        await esperarDesenho(outra, idNovo, COR, { rotulo: 'outra sessão:' });
        await ctx2.close();
        await ctx.close();
    });
});

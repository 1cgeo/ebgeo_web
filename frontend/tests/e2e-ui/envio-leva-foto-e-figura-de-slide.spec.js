// Path: e2e-ui/envio-leva-foto-e-figura-de-slide.spec.js

/**
 * @fileoverview "ENVIAR AO SERVIDOR" LEVA A FOTO ANEXA E A FIGURA DO SLIDE com os mesmos bytes.
 *
 * O irmão `envio-leva-figura.spec.js` mede a feição de imagem; `envio-com-fotos-anexas.repro.spec.js`
 * mede fotos pesadas por COMPRIMENTO do data URL, num acervo semeado. Nenhum teste punha uma foto
 * pela galeria e uma figura colada num slide num atlas local, enviava pela tela e perguntava a OUTRA
 * sessão pelos bytes. O veredito é o SHA-256 das duas: no autor antes do envio, no Postgres (a foto
 * dentro das propriedades da feição, a figura dentro do HTML do slide) e na outra sessão, lidas em
 * qualquer formato (a foto pode virar referência na fase 2 das fotos).
 *
 * Rodar isolado:
 *   cd frontend && npx playwright test envio-leva-foto-e-figura-de-slide --retries=0 --workers=1
 */

import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readState } from './state.js';
import { loginUI, goToLocalMapUI, drawPointUI, selectFeatureUI } from './helpers/collab-helpers.js';
import { createVerifiedUser } from './helpers/accounts.js';
import { createDb, closeDb } from './helpers/db.js';
import { figuraSolida } from './helpers/imagem-bytes.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;
const sha = (b) => createHash('sha256').update(b).digest('hex');
const NOME_DO_PONTO = 'Ponto com foto do envio';

/** SHA-256 da foto do ponto (data URL ou referência) e da figura do primeiro slide, no atlas aberto. */
function impressoes(page) {
    return page.evaluate(async (nome) => {
        const store = await import('/src/js/store/index.js');
        const hex = async (blob) => {
            const d = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
            return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
        };
        const ponto = ((await store.getCurrentMapFeatures()).points ?? []).find((f) => f.properties?.nome === nome);
        const foto = ponto?.properties?.images?.[0] ?? null;
        let blobFoto = null;
        if (typeof foto?.data === 'string' && foto.data.startsWith('data:')) blobFoto = await (await fetch(foto.data)).blob();
        else if (foto?.id) blobFoto = await store.getImage(foto.id);
        const briefings = await store.getAllBriefings();
        const lista = briefings instanceof Map ? [...briefings.values()] : (briefings ?? []);
        const html = lista[0]?.slides?.[0]?.content ?? '';
        const src = (html.match(/<img\b[^>]*\bsrc="([^"]+)"/) || [])[1] ?? null;
        return {
            foto: blobFoto ? await hex(blobFoto) : null,
            slide: src ? await hex(await (await fetch(src)).blob()) : null,
        };
    }, NOME_DO_PONTO);
}

describeOrSkip('Enviar ao servidor leva a foto anexa e a figura do slide', () => {
    test.describe.configure({ retries: 0 });
    let db;
    test.beforeAll(() => { db = createDb(state.dbName); });
    test.afterAll(async () => { await closeDb(db); });

    test('a outra sessão lê a foto e a figura do slide com os mesmos bytes', async ({ browser }) => {
        test.setTimeout(240000);
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);
        await page.goto('/');
        const creds = await createVerifiedUser({ prefix: 'envfoto', nome: 'Envio Foto' });
        await loginUI(page, creds.username, creds.password);
        await goToLocalMapUI(page);
        await page.waitForFunction(() => globalThis.__ebgeoMap?.loaded?.(), null, { timeout: 20000 });

        // A FOTO, pela galeria.
        const idPonto = await drawPointUI(page, [-43.2, -22.9]);
        await page.keyboard.press('Escape');
        await page.evaluate(async ({ id, nome }) => {
            const store = await import('/src/js/store/index.js');
            const f = ((await store.getCurrentMapFeatures()).points ?? []).find((x) => x.properties?.id === id);
            await store.updateFeature('points', { ...f, properties: { ...f.properties, nome } });
        }, { id: idPonto, nome: NOME_DO_PONTO });
        await selectFeatureUI(page, idPonto);
        await page.locator('.feature-photo-gallery__file-input').setInputFiles({ name: 'foto.jpg', mimeType: 'image/jpeg', buffer: await figuraSolida(page, [0, 150, 140], { tipo: 'image/jpeg', lado: 64 }) });
        await expect(page.locator('.feature-photo-gallery-grid img').first()).toBeVisible({ timeout: 10000 });
        await page.keyboard.press('Escape');

        // A FIGURA, colada num slide.
        if (!(await page.locator('.briefings-create-btn').isVisible())) await page.locator('.sidebar-nav-btn[data-tab="briefings"]').click();
        await page.locator('.briefings-create-btn').click();
        await expect(page.locator('.briefing-editor-slide-editor .ql-editor')).toBeVisible({ timeout: 10000 });
        const png = await figuraSolida(page, [180, 90, 20], { lado: 120 });
        await page.evaluate((conteudo) => {
            const editor = document.querySelector('.briefing-editor-slide-editor .ql-editor');
            editor.focus();
            const dt = new DataTransfer();
            dt.setData('text/html', conteudo);
            dt.setData('text/plain', 'x');
            const paste = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
            Object.defineProperty(paste, 'clipboardData', { value: dt });
            editor.dispatchEvent(paste);
        }, `<p>Figura</p><img src="data:image/png;base64,${png.toString('base64')}">`);

        let antes = null;
        await expect.poll(async () => {
            antes = await impressoes(page);
            return Boolean(antes.foto && antes.slide);
        }, { timeout: 20000, message: 'a foto e a figura não estão no atlas local' }).toBe(true);

        // ENVIAR AO SERVIDOR, pelo menu da conta.
        await page.locator('[data-testid="account-control"] .account-control__identity').click();
        await page.locator('[data-testid="account-save-server-btn"]').click();
        await expect(page.locator('[data-testid="create-atlas-name"]')).toBeVisible();
        await page.locator('[data-testid="create-atlas-name"]').fill('Atlas com foto e slide');
        await page.locator('[data-testid="create-atlas-confirm"]').click();
        await expect(page.locator('[data-testid="sync-status-badge"]')).toHaveAttribute('data-state', 'online', { timeout: 60000 });
        await page.waitForURL(/[?&]atlas=/, { timeout: 20000 });
        const atlasId = new URL(page.url()).searchParams.get('atlas');

        // O SERVIDOR: a foto dentro da feição (texto) e a figura dentro do slide.
        const slide = await db.raw.oneOrNone(
            `SELECT s.content FROM slides s JOIN briefings b ON b.id = s.briefing_id
             WHERE b.atlas_id = $1 AND s.deleted_at IS NULL LIMIT 1`, [atlasId]);
        const src = (String(slide?.content ?? '').match(/<img\b[^>]*\bsrc="([^"]+)"/) || [])[1] ?? null;
        expect(src, 'o slide chegou ao servidor sem a figura').not.toBeNull();
        expect(sha(globalThis.Buffer.from(src.split(',')[1], 'base64')), 'a figura do slide mudou no servidor').toBe(antes.slide);
        const ponto = await db.raw.oneOrNone(
            `SELECT f.properties FROM features f JOIN maps m ON m.id = f.map_id
             WHERE m.atlas_id = $1 AND f.properties->>'nome' = $2 AND f.deleted_at IS NULL`, [atlasId, NOME_DO_PONTO]);
        expect(ponto?.properties?.images?.length, 'o ponto chegou ao servidor sem a foto').toBe(1);

        // OUTRA SESSÃO.
        const ctx2 = await browser.newContext();
        const outra = await ctx2.newPage();
        await outra.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);
        await outra.goto('/');
        await loginUI(outra, creds.username, creds.password);
        await outra.goto(`/?atlas=${atlasId}`);
        await expect(outra.locator('[data-testid="sync-status-badge"]')).toHaveAttribute('data-state', 'online', { timeout: 60000 });
        await expect.poll(() => impressoes(outra), { timeout: 30000, message: 'a outra sessão não lê a foto e a figura' }).toEqual(antes);
        await ctx2.close();
        await ctx.close();
    });
});

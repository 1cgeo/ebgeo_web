// Path: e2e-ui/envio-leva-figura.spec.js

/**
 * @fileoverview "ENVIAR AO SERVIDOR" LEVA A FIGURA DA FERRAMENTA DE IMAGEM, com os bytes.
 *
 * A preparação do envio de um atlas local (`import_export/local-atlas-to-server.js` e o import
 * atômico) tem teste unitário para a figura e um teste de contrato contra o backend real
 * (`tests/e2e/bulk-image-preserve-id`), mas o único caso de NAVEGADOR (`browser-save-local-to-server`)
 * leva só um ícone SVG; as fotos anexas têm o dela (`envio-com-fotos-anexas.repro.spec.js`). Nenhum
 * teste punha uma figura pela ferramenta num atlas local, enviava pela tela e depois perguntava ao
 * servidor e a OUTRA sessão pelos bytes.
 *
 * O gesto: login pela tela, mapa local, figura magenta pela ferramenta, menu da conta, "Enviar ao
 * servidor". O veredito: no Postgres, a feição de imagem do atlas novo e a linha de bytes sob o id
 * dela; no autor, a figura desenhada depois de o app passar a viver no atlas novo; e numa SEGUNDA
 * sessão (outro contexto, a mesma conta), os bytes por `getImage` com o SHA-256 do blob local.
 *
 * Rodar isolado:
 *   cd frontend && npx playwright test envio-leva-figura --retries=0 --workers=1
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { loginUI, goToLocalMapUI } from './helpers/collab-helpers.js';
import { createVerifiedUser } from './helpers/accounts.js';
import { createDb, closeDb } from './helpers/db.js';
import { figuraSolida, porImagemPelaFerramenta, impressaoDoBlob, esperarDesenho, linhaDeImagem } from './helpers/imagem-bytes.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;
const MAGENTA = [255, 0, 255];

describeOrSkip('Enviar ao servidor leva a figura com os bytes', () => {
    test.describe.configure({ retries: 0 });
    let db;
    test.beforeAll(() => { db = createDb(state.dbName); });
    test.afterAll(async () => { await closeDb(db); });

    test('a figura do atlas local chega ao servidor e a outra sessão lê os mesmos bytes', async ({ browser }) => {
        test.setTimeout(180000);
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);
        await page.goto('/');
        const creds = await createVerifiedUser({ prefix: 'envfig', nome: 'Envio Figura' });
        await loginUI(page, creds.username, creds.password);
        await goToLocalMapUI(page);
        await page.waitForFunction(() => globalThis.__ebgeoMap?.loaded?.(), null, { timeout: 20000 });

        const png = await figuraSolida(page, MAGENTA);
        const idLocal = await porImagemPelaFerramenta(page, { name: 'magenta.png', mimeType: 'image/png', buffer: png });
        await page.keyboard.press('Escape');
        const local = await impressaoDoBlob(page, idLocal);
        expect(local?.local, 'a figura nasceu com o blob guardado neste computador').toBe(true);

        await page.locator('[data-testid="account-control"] .account-control__identity').click();
        await page.locator('[data-testid="account-save-server-btn"]').click();
        await expect(page.locator('[data-testid="create-atlas-name"]')).toBeVisible();
        await page.locator('[data-testid="create-atlas-name"]').fill('Atlas com figura');
        await page.locator('[data-testid="create-atlas-confirm"]').click();
        await expect(page.locator('[data-testid="sync-status-badge"]')).toHaveAttribute('data-state', 'online', { timeout: 30000 });
        await page.waitForURL(/[?&]atlas=/, { timeout: 20000 });
        const atlasId = new URL(page.url()).searchParams.get('atlas');

        // O SERVIDOR: uma feição de imagem no atlas novo, e os bytes sob o id dela.
        const noServidor = await db.raw.any(
            `SELECT f.id, f.properties->>'id' AS prop_id FROM features f JOIN maps m ON m.id = f.map_id
             WHERE m.atlas_id = $1 AND f.feature_type = 'image' AND f.deleted_at IS NULL`, [atlasId]);
        expect(noServidor, 'o atlas enviado tem UMA feição de imagem').toHaveLength(1);
        const id = noServidor[0].id;
        expect(noServidor[0].prop_id).toBe(id);
        expect(await linhaDeImagem(db, id), 'os bytes da figura estão no servidor, sob o id da feição')
            .toMatchObject({ id, atlas_id: atlasId, mime_type: local.type, size_bytes: local.size });
        test.info().annotations.push({ type: 'id-preservado', description: String(id === idLocal) });

        // O AUTOR, já vivendo no atlas novo: a figura continua desenhada.
        await esperarDesenho(page, id, MAGENTA, { rotulo: 'autor, no atlas enviado:' });

        // OUTRA SESSÃO, a mesma conta, sem nada no disco: os bytes vêm do servidor.
        const ctx2 = await browser.newContext();
        const page2 = await ctx2.newPage();
        await page2.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);
        await page2.goto('/');
        await loginUI(page2, creds.username, creds.password);
        await page2.goto(`/?atlas=${atlasId}`);
        await expect(page2.locator('[data-testid="sync-status-badge"]')).toHaveAttribute('data-state', 'online', { timeout: 30000 });
        let remoto = null;
        await expect.poll(async () => {
            remoto = await impressaoDoBlob(page2, id);
            return remoto?.sha ?? null;
        }, { timeout: 30000, message: 'a outra sessão não lê os bytes da figura' }).toBe(local.sha);
        await esperarDesenho(page2, id, MAGENTA, { rotulo: 'outra sessão:' });

        await ctx2.close();
        await ctx.close();
    });
});

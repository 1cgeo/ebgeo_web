// Path: e2e-ui/browser-envio-local-com-visada.repro.spec.js

/**
 * @fileoverview ENVIAR AO SERVIDOR um atlas local que tem uma visada, e abrir o atlas enviado com um
 * segundo usuário.
 *
 * O DEFEITO (achado pela frente de migração em 2026-09-23, com o acervo real do main). O envio
 * (`buildServerImportPayload`, `import_export/local-atlas-to-server.js`) re-cunhava o id não-UUID
 * da saída da análise (`<visada>-visible`) num UUID ALEATÓRIO. A saída subia, mas perdia o vínculo
 * por prefixo com a entrada (`findRelatedProcessedFeatures`, `processedIdsOf`): no atlas enviado,
 * apagar, mover ou recalcular a visada deixava o resultado velho órfão na tela, sem seleção
 * possível. Desde 2026-09-23 a saída é derivada por cliente e o envio NÃO a sobe
 * (`store/analysis-output.js`).
 *
 * O CASO, pela tela: um usuário logado traça a visada no MAPA LOCAL (ferramenta real, terreno
 * sintético), envia pelo menu da conta; o Postgres não guarda linha de saída nenhuma; um segundo
 * usuário abre o atlas e vê a visada com as duas metades derivadas; apagar a visada no primeiro
 * tira as metades do segundo.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { loginUI, goToLocalMapUI, addSharedUser, openClient, deleteFeatureUI } from './helpers/collab-helpers.js';
import { createVerifiedUser } from './helpers/accounts.js';
import { createDb, closeDb } from './helpers/db.js';
import { prepararTerreno, desocupar, tracarVisada, balde } from './helpers/analise-terreno.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

describeOrSkip('envio de atlas local com visada', () => {
    test.describe.configure({ retries: 0 });
    test.afterAll(async () => { await closeDb(); });

    test('a saida nao sobe, o par a deriva, e apagar a visada a tira do par', async ({ browser }) => {
        test.setTimeout(300000);
        const baseUrl = state.baseUrl;
        const db = createDb(state.dbName);

        const ctxA = await browser.newContext();
        const A = await ctxA.newPage();
        await A.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${baseUrl}/api/v1`);
        await A.goto('/');
        const dono = await createVerifiedUser({ prefix: 'envio', nome: 'Envio Visada' });
        await loginUI(A, dono.username, dono.password);
        await goToLocalMapUI(A);
        await A.waitForFunction(() => globalThis.__ebgeoMap?.loaded?.(), null, { timeout: 20000 });

        // A visada nasce no atlas LOCAL, com as duas metades de id `<visada>-visible|obstructed`.
        await prepararTerreno(A);
        const losId = await tracarVisada(A);
        await desocupar(A);
        await expect.poll(async () => (await balde(A, 'processed_los')).map((f) => f.id).sort(), { timeout: 20000 })
            .toEqual([`${losId}-obstructed`, `${losId}-visible`]);

        // Enviar ao servidor, pelo menu da conta.
        await A.locator('[data-testid="account-control"] .account-control__identity').click();
        await A.locator('[data-testid="account-save-server-btn"]').click();
        await A.locator('[data-testid="create-atlas-name"]').fill('Atlas com Visada');
        await A.locator('[data-testid="create-atlas-confirm"]').click();
        await expect(A.locator('[data-testid="sync-status-badge"]')).toHaveAttribute('data-state', 'online', { timeout: 30000 });
        await A.waitForURL(/[?&]atlas=/, { timeout: 20000 });
        const atlasId = new URL(A.url()).searchParams.get('atlas');

        // O POSTGRES: a entrada subiu, a saída não.
        const tipos = async () => (await db.raw.any(
            `SELECT f.feature_type, f.id FROM features f JOIN maps m ON m.id = f.map_id
             WHERE m.atlas_id = $1 AND f.deleted_at IS NULL ORDER BY f.feature_type`, [atlasId],
        ));
        await expect.poll(async () => (await tipos()).map((r) => r.feature_type), { timeout: 20000 })
            .toEqual(['los']);
        expect((await tipos())[0].id, 'a visada sobe com o id dela').toBe(losId);

        // O autor, agora no atlas de servidor, continua com as metades (derivadas do retrato).
        await expect.poll(async () => (await balde(A, 'processed_los')).map((f) => f.id).sort(), { timeout: 20000 })
            .toEqual([`${losId}-obstructed`, `${losId}-visible`]);

        // O segundo usuário abre o atlas enviado e VÊ a visada: as metades, derivadas, na fonte.
        const par = await addSharedUser(A, baseUrl, dono, atlasId, { permission: 'write', label: 'par' });
        const B = await openClient(browser, baseUrl, atlasId, par);
        await expect.poll(async () => (await balde(B, 'processed_los')).map((f) => f.id).sort(), {
            timeout: 30000, message: 'o par nao ve as metades da visada enviada',
        }).toEqual([`${losId}-obstructed`, `${losId}-visible`]);
        await expect.poll(() => B.evaluate(async () => {
            const src = globalThis.__ebgeoMap.getSource('processed-los');
            return ((await src?.getData())?.features ?? []).map((f) => f.properties?.id).sort();
        }), { timeout: 15000, message: 'a fonte do par nao desenha a visada' })
            .toEqual([`${losId}-obstructed`, `${losId}-visible`]);

        // Apagar a visada no autor tira as metades do par: o vínculo por prefixo continua inteiro.
        await deleteFeatureUI(A, losId);
        await expect.poll(async () => (await balde(B, 'processed_los')).length, {
            timeout: 30000, message: 'apagar a visada deixou metades orfas no par',
        }).toBe(0);
        await expect.poll(async () => (await tipos()).length, { timeout: 20000 }).toBe(0);

        await B.context().close();
        await ctxA.close();
    });
});

// Path: e2e-ui/desfazer-nao-atravessa-trava.repro.spec.js

/**
 * REPRO: Ctrl+Z crossed a client lock and wrote into a locked layer, on the server.
 *
 * The feature, layer and group locks are conventions of the client, and the undo engine writes
 * through store executors that ask none of them. Measured with two browsers before the fix: the
 * editor drew a point, the owner locked the layer, and the editor's Ctrl+Z removed the point on
 * the server (`deleted_at` set), with no warning.
 *
 * The fix (`refuseUndoRedoAcrossLock`, `store/store.js`) asks the entry's features BEFORE it
 * leaves the stack: the refusal names the lock, and the entry is still there once the lock is
 * lifted, which is the second half of this case.
 */

import { collabTest, expect, drawPointUI, openLayersTab } from './helpers/collab.fixtures.js';

collabTest.describe.configure({ retries: 0 });

async function avisoLegivel(page, texto) {
    const toast = page.locator('.toast', { hasText: texto }).last();
    await expect(toast).toBeVisible({ timeout: 15000 });
    await expect.poll(() => toast.evaluate((el) => Number(getComputedStyle(el).opacity)), { timeout: 5000 })
        .toBeGreaterThan(0.9);
    return (await toast.innerText()).trim();
}

async function ctrlZ(page) {
    await page.keyboard.press('Escape');
    await page.locator('#map-sig .maplibregl-canvas').press('Control+z');
}

async function alternarTravaDaCamada(A, B, layerId, travada) {
    await openLayersTab(A);
    await A.locator(`.layer-container[data-layer-id="${layerId}"] .layer-header .lock-toggle`).first().evaluate((el) => el.click());
    await expect.poll(() => B.evaluate(async (l) => {
        const store = await import('/src/js/store/index.js');
        return (store.getLayers() || []).find((x) => x.id === l)?.locked;
    }, layerId), { timeout: 20000 }).toBe(travada);
}

collabTest('desfazer do Editor com a camada travada pelo Dono: recusa nomeando a camada, e destravada desfaz', async ({ collab }) => {
    collabTest.setTimeout(180000);
    const A = collab.author;
    const B = collab.peers[0];
    const base = await drawPointUI(A, [-43.2, -22.9]);
    await expect.poll(async () => Boolean(await collab.db.queryFeatureRow(base)), { timeout: 20000 }).toBe(true);
    const layerId = await A.evaluate(async () => (await import('/src/js/store/index.js')).getActiveLayerIdSync());

    const t = await drawPointUI(B, [-43.22, -22.92]);
    await expect.poll(async () => Boolean(await collab.db.queryFeatureRow(t)), { timeout: 20000 }).toBe(true);
    await alternarTravaDaCamada(A, B, layerId, true);
    // A trava que chega derruba a selecao do ponto recem-desenhado, e esse aviso, com a MESMA
    // frase, fala antes: o caso so aperta Ctrl+Z depois de ele sumir, para que o aviso lido a
    // seguir seja o do desfazer e nao o dele. (O balde de repeticao do aviso e de 3 s.)
    await expect(B.locator('.toast', { hasText: 'Camada bloqueada' })).toHaveCount(0, { timeout: 15000 });
    await B.waitForTimeout(3000);

    await ctrlZ(B);
    const texto = await avisoLegivel(B, 'Camada bloqueada');
    console.log(`AVISO_DO_DESFAZER ${texto}`);
    await B.waitForTimeout(3000);
    expect((await collab.db.queryFeatureRow(t))?.deleted_at ?? null, 'o ponto continua vivo no servidor').toBeNull();

    // CONTROLE, e a prova de que a entrada ficou na pilha: destravada, o MESMO Ctrl+Z desfaz.
    await alternarTravaDaCamada(A, B, layerId, false);
    await ctrlZ(B);
    await expect.poll(async () => (await collab.db.queryFeatureRow(t))?.deleted_at ?? null, { timeout: 20000 }).not.toBeNull();
});

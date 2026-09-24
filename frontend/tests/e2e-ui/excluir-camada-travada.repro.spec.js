// Path: e2e-ui/excluir-camada-travada.repro.spec.js

/**
 * REPRO: a LOCKED layer was deleted, with all its features, by whoever clicked its delete button.
 *
 * A layer's `locked` is a client convention (the server stores it and never asks), and the delete
 * of the layers tree asked nothing: it confirmed and deleted the layer and every feature in it,
 * the server cascading the features. The layer's own menu already refused to MOVE a locked layer.
 * Owner's decision (2026-09-24): deleting a locked layer refuses naming the state; the button is
 * drawn with `aria-disabled` (never `disabled`), the click carries the reason, and the store's
 * `deleteLayer` refuses the lock that lands between the confirmation and the write. The tree also
 * used to remove the layer's drawing from the map BEFORE the store answered, so a refusal there
 * left the features gone from the screen and kept in the store; it now paints after the answer.
 */

import { collabTest, expect, drawPointUI, openLayersTab } from './helpers/collab.fixtures.js';

collabTest.describe.configure({ retries: 0 });

const FRASE = 'Esta camada está bloqueada. Desbloqueie-a para excluí-la.';

async function avisoLegivel(page, texto) {
    const toast = page.locator('.toast', { hasText: texto }).last();
    await expect(toast).toBeVisible({ timeout: 15000 });
    await expect.poll(() => toast.evaluate((el) => Number(getComputedStyle(el).opacity)), { timeout: 5000 })
        .toBeGreaterThan(0.9);
    return (await toast.innerText()).trim();
}

async function alternarTrava(A, B, layerId, travada) {
    await openLayersTab(A);
    await A.locator(`.layer-container[data-layer-id="${layerId}"] .layer-header .lock-toggle`).first().evaluate((el) => el.click());
    await expect.poll(() => B.evaluate(async (l) => {
        const store = await import('/src/js/store/index.js');
        return (store.getLayers() || []).find((x) => x.id === l)?.locked;
    }, layerId), { timeout: 20000 }).toBe(travada);
}

function desenhada(page, id) {
    return page.evaluate((alvo) => globalThis.__ebgeoMap.queryRenderedFeatures()
        .some((f) => f.properties?.id === alvo), id);
}

/** Two layers on the owner's map: the first holds `ponto`, the second exists so neither is the last. */
async function montar(collab) {
    const A = collab.author;
    const B = collab.peers[0];
    const ponto = await drawPointUI(A, [-43.2, -22.9]);
    await expect.poll(async () => Boolean(await collab.db.queryFeatureRow(ponto)), { timeout: 20000 }).toBe(true);
    const row = await collab.db.queryFeatureRow(ponto);
    const layerId = row.layer_id ?? row.properties?.layerId;
    const outra = await A.evaluate(async () => (await (await import('/src/js/store/index.js')).createLayer('Outra')).id);
    await expect.poll(async () => Boolean(await collab.db.queryEntityRow('layers', outra)), { timeout: 20000 }).toBe(true);
    await expect.poll(() => B.evaluate(async (ids) => {
        const store = await import('/src/js/store/index.js');
        const f = await store.getCurrentMapFeatures();
        return f.points.some((p) => p.properties.id === ids[0]) && (store.getLayers() || []).some((l) => l.id === ids[1]);
    }, [ponto, outra]), { timeout: 20000 }).toBe(true);
    return { A, B, ponto, layerId };
}

collabTest('camada travada pelo Dono: o botao de excluir continua desenhado, recusa nomeando o estado, e nada sai', async ({ collab }) => {
    collabTest.setTimeout(180000);
    const { A, B, ponto, layerId } = await montar(collab);
    await alternarTrava(A, B, layerId, true);

    await openLayersTab(B);
    const botao = B.locator(`.layer-container[data-layer-id="${layerId}"] .layer-header .layer-delete-btn`).first();
    await expect(botao, 'o comando continua desenhado').toBeVisible({ timeout: 10000 });
    await expect(botao).toHaveAttribute('aria-disabled', 'true');
    expect(await botao.evaluate((el) => el.disabled), 'nunca a propriedade disabled').toBe(false);
    await botao.dispatchEvent('click');
    const texto = await avisoLegivel(B, FRASE);
    console.log(`AVISO_EXCLUIR_CAMADA ${texto}`);
    await expect(B.locator('.confirm-modal-btn-confirm'), 'nenhuma confirmacao e pedida').toHaveCount(0);
    await B.waitForTimeout(3000);
    expect((await collab.db.queryEntityRow('layers', layerId))?.deleted_at ?? null, 'a camada continua viva').toBeNull();
    expect((await collab.db.queryFeatureRow(ponto))?.deleted_at ?? null, 'a feicao continua viva').toBeNull();

    // CONTROLE: destravada, o mesmo botao pede confirmacao e exclui.
    await alternarTrava(A, B, layerId, false);
    await expect(botao).not.toHaveAttribute('aria-disabled', 'true');
    await botao.dispatchEvent('click');
    await B.locator('.confirm-modal-btn-confirm').click();
    await expect.poll(async () => (await collab.db.queryEntityRow('layers', layerId))?.deleted_at ?? null, { timeout: 20000 })
        .not.toBeNull();
});

collabTest('a trava que chega ENTRE a confirmacao e a escrita: a store recusa e o desenho fica na tela', async ({ collab }) => {
    collabTest.setTimeout(180000);
    const { A, B, ponto, layerId } = await montar(collab);
    await B.evaluate(() => globalThis.__ebgeoMap.jumpTo({ center: [-43.2, -22.9], zoom: 12 }));
    await expect.poll(() => desenhada(B, ponto), { timeout: 15000, message: 'premissa: o Editor desenha o ponto' }).toBe(true);

    await openLayersTab(B);
    await B.locator(`.layer-container[data-layer-id="${layerId}"] .layer-header .layer-delete-btn`).first().dispatchEvent('click');
    const confirmar = B.locator('.confirm-modal-btn-confirm');
    await expect(confirmar, 'destravada, a confirmacao e pedida').toBeVisible({ timeout: 10000 });

    await alternarTrava(A, B, layerId, true);
    await confirmar.click();
    const texto = await avisoLegivel(B, FRASE);
    console.log(`AVISO_EXCLUIR_NA_CORRIDA ${texto}`);
    await B.waitForTimeout(3000);
    expect((await collab.db.queryEntityRow('layers', layerId))?.deleted_at ?? null, 'a camada continua viva').toBeNull();
    expect((await collab.db.queryFeatureRow(ponto))?.deleted_at ?? null, 'a feicao continua viva').toBeNull();
    expect(await desenhada(B, ponto), 'e continua DESENHADA: o mapa nao apagou o que a store guardou').toBe(true);
});

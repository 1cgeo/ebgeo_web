// Path: e2e-ui/trava-chega-com-feicao-selecionada.repro.spec.js

/**
 * REPRO: a lock that ARRIVES while the feature is already selected left the selection editable.
 *
 * The client conventions (layer `locked`, group `locked`, feature `bloqueado`) were asked only at
 * SELECTION time. Measured with two browsers before the fix: the editor selected a feature (panel
 * open), the owner locked its layer, the lock reached the editor's store, and the editor's panel
 * stayed open with the feature selected; Delete plus confirm removed it on the server
 * (`deleted_at` set), because the store deletes whatever is selected and the server never asks
 * about these locks. The layers tab's own lock and eye buttons tried to deselect through a method
 * that does not exist, so they were silent no-ops too.
 *
 * The fix: `SelectionManager.watchEffectiveLocks` drops the selection when a lock lands on it
 * (LAYERS_CHANGED, GROUPS_CHANGED, FEATURE_MODIFIED), discarding the pending panel edits and naming
 * the lock; and `deleteSelectedFeatures` refuses a locked feature whatever put it in the selection.
 */

import { collabTest, expect, drawPointUI, openLayersTab, selectFeatureUI } from './helpers/collab.fixtures.js';

collabTest.describe.configure({ retries: 0 });

async function avisoLegivel(page, texto) {
    const toast = page.locator('.toast--warning', { hasText: texto }).last();
    await expect(toast).toBeVisible({ timeout: 15000 });
    await expect.poll(() => toast.evaluate((el) => Number(getComputedStyle(el).opacity)), { timeout: 5000 })
        .toBeGreaterThan(0.9);
    return (await toast.innerText()).trim();
}

function selecionada(page, id) {
    return page.evaluate(async (f) => {
        const { getStateManager } = await import('/src/js/store/services.js');
        return getStateManager().getSelectedFeatures().some((x) => String(x?.id) === f || x?.feature?.properties?.id === f);
    }, id);
}

async function feicaoChegou(page, id) {
    await expect.poll(() => page.evaluate(async (f) => {
        const store = await import('/src/js/store/index.js');
        return Boolean((await store.getCurrentMapFeatures()).points.find((p) => p.properties.id === f));
    }, id), { timeout: 20000 }).toBe(true);
}

/** Presses Delete and confirms if asked; returns whether a confirmation was asked. */
async function apertarDelete(page) {
    await page.keyboard.press('Delete');
    const confirmar = page.locator('.confirm-modal-btn-confirm');
    await confirmar.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
    const pediu = await confirmar.isVisible().catch(() => false);
    if (pediu) await confirmar.click();
    return pediu;
}

async function expandir(page) {
    await openLayersTab(page);
    for (const icon of await page.locator('.layer-expand-icon.collapsed, .group-expand-icon.collapsed').all()) {
        await icon.click().catch(() => {});
    }
}

collabTest('camada travada pelo Dono com a feicao JA selecionada no Editor: a selecao cai, nomeando a camada, e Delete nao apaga', async ({ collab }) => {
    collabTest.setTimeout(180000);
    const A = collab.author;
    const B = collab.peers[0];
    const id = await drawPointUI(A, [-43.2, -22.9]);
    await expect.poll(async () => Boolean(await collab.db.queryFeatureRow(id)), { timeout: 20000 }).toBe(true);
    await feicaoChegou(B, id);
    await selectFeatureUI(B, id);
    expect(await selecionada(B, id), 'premissa: o Editor tem a feicao selecionada').toBe(true);

    await openLayersTab(A);
    const camada = A.locator('.layer-container.layer-active').first();
    const layerId = await camada.getAttribute('data-layer-id');
    await camada.locator('.layer-header .lock-toggle').first().evaluate((el) => el.click());
    await expect.poll(async () => (await collab.db.queryEntityRow('layers', layerId))?.locked, { timeout: 20000 }).toBe(true);

    const texto = await avisoLegivel(B, 'Camada bloqueada');
    console.log(`AVISO_DA_TRAVA_QUE_CHEGA ${texto}`);
    await expect(B.locator('.feature-panel[data-expanded="true"]'), 'o painel de edicao fecha').toHaveCount(0, { timeout: 10000 });
    expect(await selecionada(B, id), 'a feicao deixa de estar selecionada').toBe(false);

    await apertarDelete(B);
    await B.waitForTimeout(4000);
    expect((await collab.db.queryFeatureRow(id))?.deleted_at ?? null, 'a feicao continua viva no servidor').toBeNull();

    // CONTROLE: destravada, a mesma sequencia apaga.
    await camada.locator('.layer-header .lock-toggle').first().evaluate((el) => el.click());
    await expect.poll(async () => (await collab.db.queryEntityRow('layers', layerId))?.locked, { timeout: 20000 }).toBe(false);
    await expect.poll(() => B.evaluate(async (l) => {
        const store = await import('/src/js/store/index.js');
        return (store.getLayers() || []).find((x) => x.id === l)?.locked;
    }, layerId), { timeout: 20000 }).toBe(false);
    await selectFeatureUI(B, id);
    expect(await apertarDelete(B), 'destravada, o Delete pede confirmacao').toBe(true);
    await expect.poll(async () => (await collab.db.queryFeatureRow(id))?.deleted_at ?? null, { timeout: 20000 }).not.toBeNull();
});

collabTest('grupo travado pelo Dono com o grupo JA selecionado no Editor: a selecao cai e nenhum membro e apagado', async ({ collab }) => {
    collabTest.setTimeout(180000);
    const A = collab.author;
    const B = collab.peers[0];
    const id1 = await drawPointUI(A, [-43.2, -22.9]);
    const id2 = await drawPointUI(A, [-43.21, -22.91]);
    const gid = await A.evaluate(async ([a, b]) => {
        const { getGroupManager } = await import('/src/js/store/services.js');
        const store = await import('/src/js/store/index.js');
        const f = await store.getCurrentMapFeatures();
        return (await getGroupManager().createGroup(f.points.filter((p) => [a, b].includes(p.properties.id)))).id;
    }, [id1, id2]);
    await expect.poll(async () => Boolean(await collab.db.queryEntityRow('groups', gid)), { timeout: 20000 }).toBe(true);
    await feicaoChegou(B, id2);
    await expect.poll(() => B.evaluate(async (g) => {
        const store = await import('/src/js/store/index.js');
        return Boolean(store.getMapGroups(store.getCurrentMapNameSync())?.[g]);
    }, gid), { timeout: 20000 }).toBe(true);

    await expandir(B);
    await B.locator(`.group-feature-item[data-feature-id="${id1}"] .group-feature-main`).first().evaluate((el) => el.click());
    await expect(B.locator('.feature-panel[data-expanded="true"]')).toBeVisible({ timeout: 10000 });
    expect(await selecionada(B, id1), 'premissa: o membro esta selecionado').toBe(true);

    await expandir(A);
    await A.locator(`.group-container[data-group-id="${gid}"] .group-header .lock-toggle`).first().evaluate((el) => el.click());
    await expect.poll(async () => (await collab.db.queryEntityRow('groups', gid))?.locked, { timeout: 20000 }).toBe(true);

    const texto = await avisoLegivel(B, 'Grupo bloqueado');
    console.log(`AVISO_DO_GRUPO_QUE_CHEGA ${texto}`);
    expect(await selecionada(B, id1)).toBe(false);
    expect(await selecionada(B, id2)).toBe(false);
    await apertarDelete(B);
    await B.waitForTimeout(4000);
    expect((await collab.db.queryFeatureRow(id1))?.deleted_at ?? null).toBeNull();
    expect((await collab.db.queryFeatureRow(id2))?.deleted_at ?? null).toBeNull();
});

collabTest('feicao bloqueada pelo Dono com ela JA selecionada no Editor: a selecao cai nomeando a feicao', async ({ collab }) => {
    collabTest.setTimeout(180000);
    const A = collab.author;
    const B = collab.peers[0];
    const id = await drawPointUI(A, [-43.2, -22.9]);
    await expect.poll(async () => Boolean(await collab.db.queryFeatureRow(id)), { timeout: 20000 }).toBe(true);
    await feicaoChegou(B, id);
    await selectFeatureUI(B, id);

    await expandir(A);
    await A.locator(`.feature-item[data-feature-id="${id}"] .lock-toggle`).first().evaluate((el) => el.click());
    await expect.poll(async () => (await collab.db.queryFeatureRow(id))?.properties?.bloqueado, { timeout: 20000 }).toBe(true);

    const texto = await avisoLegivel(B, 'Feição bloqueada');
    console.log(`AVISO_DA_FEICAO_QUE_CHEGA ${texto}`);
    expect(await selecionada(B, id)).toBe(false);
    await apertarDelete(B);
    await B.waitForTimeout(4000);
    expect((await collab.db.queryFeatureRow(id))?.deleted_at ?? null).toBeNull();
});

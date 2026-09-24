// Path: e2e-ui/trava-de-camada-e-grupo-pela-arvore-e-tabela.repro.spec.js

/**
 * REPRO: a feature held by a lock that is a CLIENT CONVENTION (its layer's `locked`, its group's
 * `locked`, its own `bloqueado`) was edited and deleted through two entry points that did not ask.
 *
 * Only the MAP lock is enforced by the server. The other three are stored and never checked there,
 * and the store (`updateFeature`, `removeFeature`, `deleteSelectedFeatures`) writes whatever is
 * selected, so the convention lives in the entry points. The map click and the box selection asked;
 * the LAYERS TAB asked only the feature's own `bloqueado` (and, for a group member, only the group's
 * lock), and the ATTRIBUTE TABLE asked nothing. Measured with two browsers before the fix: the owner
 * locked the layer, and the editor
 *   - clicked the feature in the layers tab: panel open, Delete removed it on the server;
 *   - clicked a member of a group in that layer: both members removed on the server;
 *   - double-clicked the name cell in the attribute table: the new name was written.
 *
 * The fix is in the funnel every entry point goes through (`SelectionManager.selectFeature`,
 * `toggleFeatureSelection`, `_selectGroup` refuse an effectively locked feature) and in the table
 * cell, which stays drawn and refuses naming WHICH lock holds the feature ("o ESTADO recusa o
 * clique").
 */

import { collabTest, expect, drawPointUI, openLayersTab } from './helpers/collab.fixtures.js';

collabTest.describe.configure({ retries: 0 });

/** Locks the ACTIVE layer of `page` through the real lock button and returns its id. */
async function travarCamadaAtiva(page) {
    await openLayersTab(page);
    const camada = page.locator('.layer-container.layer-active').first();
    const id = await camada.getAttribute('data-layer-id');
    await camada.locator('.layer-header .lock-toggle').first().evaluate((el) => el.click());
    await expect(page.locator(`.layer-container[data-layer-id="${id}"].layer-locked`)).toHaveCount(1, { timeout: 10000 });
    return id;
}

/** Unlocks the layer `layerId` of `page` through the real lock button. */
async function destravarCamada(page, layerId) {
    await openLayersTab(page);
    const camada = page.locator(`.layer-container[data-layer-id="${layerId}"]`);
    await camada.locator('.layer-header .lock-toggle').first().evaluate((el) => el.click());
    await expect(page.locator(`.layer-container[data-layer-id="${layerId}"].layer-locked`)).toHaveCount(0, { timeout: 10000 });
}

async function expandirArvore(page) {
    await openLayersTab(page);
    for (const icon of await page.locator('.layer-expand-icon.collapsed, .group-expand-icon.collapsed').all()) {
        await icon.click().catch(() => {});
    }
}

/** Waits for the warning toast with `texto` to be actually readable (opacity), and returns it. */
async function avisoLegivel(page, texto) {
    const toast = page.locator('.toast--warning', { hasText: texto }).last();
    await expect(toast).toBeVisible({ timeout: 10000 });
    await expect.poll(() => toast.evaluate((el) => Number(getComputedStyle(el).opacity)), { timeout: 5000 })
        .toBeGreaterThan(0.9);
    return (await toast.innerText()).trim();
}

/** Clicks a tree row, presses Delete, confirms if asked. */
async function clicarNaArvoreEApagar(page, seletor) {
    const row = page.locator(seletor).first();
    await expect(row).toBeVisible({ timeout: 10000 });
    await row.evaluate((el) => el.click());
    // The panel opens only for a selected feature; give it the time a real selection takes.
    await page.waitForTimeout(1000);
    const painelAberto = await page.locator('.feature-panel[data-expanded="true"]').count();
    await page.keyboard.press('Delete');
    const confirmar = page.locator('.confirm-modal-btn-confirm');
    if (await confirmar.isVisible().catch(() => false)) await confirmar.click();
    return painelAberto;
}

async function aguardarCamadaTravadaNoPar(collab, page, layerId) {
    await expect.poll(async () => (await collab.db.queryEntityRow('layers', layerId))?.locked, { timeout: 20000 }).toBe(true);
    await openLayersTab(page);
    await expect(page.locator(`.layer-container[data-layer-id="${layerId}"].layer-locked`)).toHaveCount(1, { timeout: 20000 });
}

collabTest('camada travada pelo Dono: o Editor nao seleciona nem apaga a feicao pela aba de camadas', async ({ collab }) => {
    const A = collab.author;
    const B = collab.peers[0];
    const id = await drawPointUI(A, [-43.2, -22.9]);
    await expect.poll(async () => Boolean(await collab.db.queryFeatureRow(id)), { timeout: 20000 }).toBe(true);
    const layerId = await travarCamadaAtiva(A);
    await aguardarCamadaTravadaNoPar(collab, B, layerId);

    await expandirArvore(B);
    const painel = await clicarNaArvoreEApagar(B, `.feature-item[data-feature-id="${id}"] .feature-main`);
    expect(painel, 'nenhum painel de edicao abre para a feicao da camada travada').toBe(0);
    // Tempo para uma exclusao indevida chegar ao servidor (o envio sai a cada 1,5 s).
    await B.waitForTimeout(4000);
    expect((await collab.db.queryFeatureRow(id))?.deleted_at ?? null, 'a feicao continua viva no servidor').toBeNull();

    // CONTROLE: destravada, a mesma porta seleciona.
    await destravarCamada(A, layerId);
    await expect.poll(async () => (await collab.db.queryEntityRow('layers', layerId))?.locked, { timeout: 20000 }).toBe(false);
    await expect(B.locator(`.layer-container[data-layer-id="${layerId}"].layer-locked`)).toHaveCount(0, { timeout: 20000 });
    await expandirArvore(B);
    await B.locator(`.feature-item[data-feature-id="${id}"] .feature-main`).first().evaluate((el) => el.click());
    await expect(B.locator('.feature-panel[data-expanded="true"]')).toBeVisible({ timeout: 10000 });
});

collabTest('grupo em camada travada: clicar o membro na arvore nao seleciona o grupo nem deixa apagar', async ({ collab }) => {
    const A = collab.author;
    const B = collab.peers[0];
    const id1 = await drawPointUI(A, [-43.2, -22.9]);
    const id2 = await drawPointUI(A, [-43.21, -22.91]);
    const gid = await A.evaluate(async ([a, b]) => {
        const { getGroupManager } = await import('/src/js/store/services.js');
        const store = await import('/src/js/store/index.js');
        const f = await store.getCurrentMapFeatures();
        const pts = f.points.filter((p) => [a, b].includes(p.properties.id));
        return (await getGroupManager().createGroup(pts)).id;
    }, [id1, id2]);
    await expect.poll(async () => Boolean(await collab.db.queryEntityRow('groups', gid)), { timeout: 20000 }).toBe(true);
    const layerId = await travarCamadaAtiva(A);
    await aguardarCamadaTravadaNoPar(collab, B, layerId);

    await expandirArvore(B);
    const painel = await clicarNaArvoreEApagar(B, `.group-feature-item[data-feature-id="${id1}"] .group-feature-main`);
    expect(painel).toBe(0);
    await B.waitForTimeout(4000);
    expect((await collab.db.queryFeatureRow(id1))?.deleted_at ?? null).toBeNull();
    expect((await collab.db.queryFeatureRow(id2))?.deleted_at ?? null).toBeNull();
});

collabTest('tabela de atributos: a celula da feicao em camada travada recusa nomeando a camada, e destravada edita', async ({ collab }) => {
    const A = collab.author;
    const B = collab.peers[0];
    const id = await drawPointUI(A, [-43.2, -22.9]);
    await expect.poll(async () => Boolean(await collab.db.queryFeatureRow(id)), { timeout: 20000 }).toBe(true);
    const nomeAntes = (await collab.db.queryFeatureRow(id)).properties.nome;
    const layerId = await travarCamadaAtiva(A);
    await aguardarCamadaTravadaNoPar(collab, B, layerId);

    const cabecalho = B.locator(`.layer-container[data-layer-id="${layerId}"]`);
    await cabecalho.locator('.layer-header .table-toggle').first().evaluate((el) => el.click());
    const celula = B.locator('td.attribute-table-cell-name').first();
    await expect(celula, 'a celula continua desenhada: o estado recusa o clique').toBeVisible({ timeout: 10000 });
    await celula.dispatchEvent('dblclick');
    const texto = await avisoLegivel(B, 'Camada bloqueada');
    console.log(`AVISO_DA_TABELA ${texto}`);
    expect(texto).toMatch(/Desbloqueie-a/);
    await expect(B.locator('input.attribute-table-cell-input')).toHaveCount(0);
    await B.waitForTimeout(2000);
    expect((await collab.db.queryFeatureRow(id)).properties.nome).toBe(nomeAntes);

    // CONTROLE: destravada, a mesma celula edita e grava.
    await destravarCamada(A, layerId);
    await expect(B.locator(`.layer-container[data-layer-id="${layerId}"].layer-locked`)).toHaveCount(0, { timeout: 20000 });
    await celula.dispatchEvent('dblclick');
    const entrada = B.locator('input.attribute-table-cell-input').first();
    await expect(entrada).toBeVisible({ timeout: 5000 });
    await entrada.fill('Nome pela tabela');
    await entrada.press('Enter');
    await expect.poll(async () => (await collab.db.queryFeatureRow(id)).properties.nome, { timeout: 20000 })
        .toBe('Nome pela tabela');
});

// Path: e2e-ui/arrasto-na-arvore-respeita-trava.repro.spec.js

/**
 * REPRO: dragging a row of the layers tree moved a feature INTO and OUT OF a locked layer.
 *
 * A layer's `locked` is a client convention (the server stores it and never asks). The context
 * menu filtered locked destinations on its own; the tree's drag and drop (`initFeatureSortable`,
 * `features_tab/sortable.handler.js`) asked nothing, and neither did the store's
 * `moveFeaturesToLayer`. Measured with two browsers and a real mouse drag before the fix: with the
 * owner's lock on the first layer, the editor's drag put a feature of the second layer INTO it, on
 * the server.
 *
 * THE INSTRUMENT. A real mouse drag of Sortable.js was measured unreliable in this harness (the
 * control drag between two unlocked layers did not move in one of two runs), so the cases below
 * finish the drag the way Sortable does: they move the row into the target list and call the
 * `onEnd` that `initFeatureSortable` registered, read off the element's own Sortable instance.
 * Everything after the drop is the product's code (the tab's handler, the store, the tree
 * refresh), and the control case proves the instrument moves a feature when nothing is locked.
 */

import { collabTest, expect, drawPointUI, openLayersTab } from './helpers/collab.fixtures.js';

collabTest.describe.configure({ retries: 0 });

async function expandir(page) {
    await openLayersTab(page);
    for (const icon of await page.locator('.layer-expand-icon.collapsed').all()) await icon.click().catch(() => {});
}

async function camadaDaFeicao(collab, id) {
    const row = await collab.db.queryFeatureRow(id);
    return row?.layer_id ?? row?.properties?.layerId ?? null;
}

async function avisoLegivel(page, texto) {
    const toast = page.locator('.toast', { hasText: texto }).last();
    await expect(toast).toBeVisible({ timeout: 15000 });
    await expect.poll(() => toast.evaluate((el) => Number(getComputedStyle(el).opacity)), { timeout: 5000 })
        .toBeGreaterThan(0.9);
    return (await toast.innerText()).trim();
}

/** Drops the feature row into the target layer's list the way Sortable does, then calls its onEnd. */
async function soltarNaCamada(page, featureId, layerId) {
    await expandir(page);
    await expect(page.locator(`.feature-item[data-feature-id="${featureId}"]`).first()).toBeVisible({ timeout: 10000 });
    return page.evaluate(async ([fid, lid]) => {
        const item = document.querySelector(`.feature-item[data-feature-id="${fid}"]`);
        const from = item?.closest('.layer-content');
        const to = document.querySelector(`.layer-container[data-layer-id="${lid}"] .layer-content`);
        if (!item || !from || !to) return 'sem elemento';
        const chave = Object.keys(from).find((k) => k.startsWith('Sortable'));
        const sortable = chave ? from[chave] : null;
        if (!sortable?.options?.onEnd) return 'sem Sortable';
        to.appendChild(item);
        await sortable.options.onEnd({ from, to, item });
        return 'ok';
    }, [featureId, layerId]);
}

collabTest('arrastar na arvore: nem PARA nem DE camada travada, e destravada move (controle)', async ({ collab }) => {
    collabTest.setTimeout(240000);
    const A = collab.author;
    const B = collab.peers[0];
    const p1 = await drawPointUI(A, [-43.2, -22.9]);
    await expect.poll(async () => Boolean(await collab.db.queryFeatureRow(p1)), { timeout: 20000 }).toBe(true);
    const primeira = await camadaDaFeicao(collab, p1);
    const segunda = await A.evaluate(async () => (await (await import('/src/js/store/index.js')).createLayer('Segunda')).id);
    await expect.poll(async () => Boolean(await collab.db.queryEntityRow('layers', segunda)), { timeout: 20000 }).toBe(true);
    await A.evaluate(async (l) => (await import('/src/js/store/index.js')).setActiveLayer(l), segunda);
    const p2 = await drawPointUI(A, [-43.21, -22.91]);
    const p3 = await drawPointUI(A, [-43.22, -22.92]);
    await expect.poll(() => camadaDaFeicao(collab, p3), { timeout: 20000 }).toBe(segunda);
    await expect.poll(() => B.evaluate(async (ids) => {
        const f = await (await import('/src/js/store/index.js')).getCurrentMapFeatures();
        return ids.every((i) => f.points.some((p) => p.properties.id === i));
    }, [p1, p2, p3]), { timeout: 20000 }).toBe(true);

    // CONTROLE do instrumento e do produto: destravadas, o Editor move p3 para a primeira.
    expect(await soltarNaCamada(B, p3, primeira)).toBe('ok');
    await expect.poll(() => camadaDaFeicao(collab, p3), { timeout: 20000, message: 'destravada, o arrasto move' }).toBe(primeira);

    // Dono trava a primeira camada; a trava chega ao Editor.
    await expandir(A);
    await A.locator(`.layer-container[data-layer-id="${primeira}"] .layer-header .lock-toggle`).first().evaluate((el) => el.click());
    await expect.poll(() => B.evaluate(async (l) => {
        const store = await import('/src/js/store/index.js');
        return (store.getLayers() || []).find((x) => x.id === l)?.locked;
    }, primeira), { timeout: 20000 }).toBe(true);

    // DE camada travada.
    expect(await soltarNaCamada(B, p1, segunda)).toBe('ok');
    const de = await avisoLegivel(B, 'Camada bloqueada');
    console.log(`AVISO_DE_TRAVADA ${de}`);
    // A arvore e refeita da store: a linha volta para a camada dela.
    await expect(B.locator(`.layer-container[data-layer-id="${primeira}"] .feature-item[data-feature-id="${p1}"]`))
        .toHaveCount(1, { timeout: 10000 });

    // PARA camada travada.
    expect(await soltarNaCamada(B, p2, primeira)).toBe('ok');
    const para = await avisoLegivel(B, 'A camada de destino está bloqueada');
    console.log(`AVISO_PARA_TRAVADA ${para}`);
    await expect(B.locator(`.layer-container[data-layer-id="${segunda}"] .feature-item[data-feature-id="${p2}"]`))
        .toHaveCount(1, { timeout: 10000 });

    await B.waitForTimeout(4000);
    expect(await camadaDaFeicao(collab, p1), 'p1 continua na camada travada, no servidor').toBe(primeira);
    expect(await camadaDaFeicao(collab, p2), 'p2 nao entrou na camada travada, no servidor').toBe(segunda);
});

// Path: e2e-ui/camada-ativa-travada-nao-recebe-desenho.repro.spec.js

/**
 * REPRO: a LOCKED ACTIVE layer received new drawings, from its owner and from the editor alike.
 *
 * A layer's `locked` is a client convention (the server stores it and never asks), and nothing on
 * the creation path asked: `activateLayer` refused to MAKE a locked layer active, but locking the
 * layer that already was active left every drawing tool writing into it. Measured with two
 * browsers before the fix: the owner locked the active layer, and a point drawn by the owner and a
 * point drawn by the editor both reached the server with that layer's id, with no warning.
 *
 * The fix has two halves, and each case below holds one of them:
 *   1. the CLICK: `ToolManager.setActiveTool` asks `lockedActiveLayerRefusal`, the tool stays
 *      drawn and the activation refuses naming the state ("o ESTADO recusa o clique");
 *   2. the COMMIT: `addFeature`/`addFeatures` refuse a local creation into a locked layer of the
 *      current map (`refuseCreationInLockedLayer`), which is what catches the lock that lands in
 *      the MIDDLE of a drawing; the tools paint only what the store returned, so nothing is drawn.
 */

import { test } from '@playwright/test';
import { collabTest, expect, drawPointUI, openLayersTab } from './helpers/collab.fixtures.js';
import { readState } from './state.js';

collabTest.describe.configure({ retries: 0 });
const state = readState();

async function avisoLegivel(page, texto) {
    const toast = page.locator('.toast', { hasText: texto }).last();
    await expect(toast).toBeVisible({ timeout: 15000 });
    await expect.poll(() => toast.evaluate((el) => Number(getComputedStyle(el).opacity)), { timeout: 5000 })
        .toBeGreaterThan(0.9);
    return (await toast.innerText()).trim();
}

/** Clicks the REAL point button of the toolbar. */
async function clicarNoPonto(page) {
    const grupo = page.locator('.toolbar-group[data-group-id="draw"] .toolbar-group-btn');
    const botao = page.locator('[data-tool-id="point"]');
    if (!(await botao.isVisible().catch(() => false))) await grupo.click();
    await expect(botao, 'a ferramenta continua desenhada').toBeVisible({ timeout: 10000 });
    await botao.click();
    return botao;
}

/** Live features the server holds in `layerId`. */
async function feicoesNaCamada(collab, layerId) {
    const r = await collab.db.raw.one('SELECT count(*)::int AS n FROM features WHERE deleted_at IS NULL AND layer_id = $1', [layerId]);
    return r.n;
}

collabTest('camada ativa travada pelo Dono: a ferramenta de ponto recusa nomeando a camada, no Dono e no Editor', async ({ collab }) => {
    collabTest.setTimeout(180000);
    const A = collab.author;
    const B = collab.peers[0];
    const primeiro = await drawPointUI(A, [-43.2, -22.9]);
    await expect.poll(async () => Boolean(await collab.db.queryFeatureRow(primeiro)), { timeout: 20000 }).toBe(true);

    await openLayersTab(A);
    const camada = A.locator('.layer-container.layer-active').first();
    const layerId = await camada.getAttribute('data-layer-id');
    await camada.locator('.layer-header .lock-toggle').first().evaluate((el) => el.click());
    await expect.poll(async () => (await collab.db.queryEntityRow('layers', layerId))?.locked, { timeout: 20000 }).toBe(true);
    await expect.poll(() => B.evaluate(async (l) => {
        const store = await import('/src/js/store/index.js');
        return (store.getLayers() || []).find((x) => x.id === l)?.locked === true && store.getActiveLayerIdSync() === l;
    }, layerId), { timeout: 20000, message: 'premissa: a camada travada e a ATIVA do Editor' }).toBe(true);

    const antes = await feicoesNaCamada(collab, layerId);
    expect(antes, 'premissa: o primeiro ponto esta nessa camada').toBe(1);
    for (const [nome, page] of [['Dono', A], ['Editor', B]]) {
        const botao = await clicarNoPonto(page);

        const texto = await avisoLegivel(page, 'Camada ativa bloqueada');
        console.log(`AVISO_${nome} ${texto}`);
        await expect(botao, `${nome}: a ferramenta nao ativa`).not.toHaveAttribute('data-active', 'true');
        // Um clique no mapa com a ferramenta recusada nao desenha nada.
        await page.mouse.click(600, 350);
    }
    await B.waitForTimeout(3000);
    expect(await feicoesNaCamada(collab, layerId), 'nenhuma feicao nova na camada travada').toBe(antes);

    // CONTROLE: destravada, o Editor desenha, e o ponto cai nessa camada.
    await camada.locator('.layer-header .lock-toggle').first().evaluate((el) => el.click());
    await expect.poll(() => B.evaluate(async (l) => {
        const store = await import('/src/js/store/index.js');
        return (store.getLayers() || []).find((x) => x.id === l)?.locked;
    }, layerId), { timeout: 20000 }).toBe(false);
    const novo = await drawPointUI(B, [-43.19, -22.89]);
    await expect.poll(async () => {
        const row = await collab.db.queryFeatureRow(novo);
        return row?.layer_id ?? row?.properties?.layerId ?? null;
    }, { timeout: 20000 }).toBe(layerId);
});

for (const [tool, storage, controlKey, createMethod] of [
    ['point', 'points', 'AddPointControl', 'createPointAtCoordinates'],
    ['line', 'lines', 'AddLineControl', 'createFeature'],
]) {
    test(`a trava da camada ativa que chega no MEIO do desenho de ${tool} recusa no commit, sem gravar nem pintar`, async ({ page }) => {
        test.skip(state.skip, state.reason);
        await page.goto('/');
        await expect(page.locator('#nav-btn-zoom-in')).toBeVisible();
        await expect.poll(() => page.evaluate(async () =>
            (await import('/src/js/store/index.js')).getCurrentMapNameSync())).toEqual(expect.any(String));
        await expect(page.locator('#initial-loader')).toHaveCount(0);
        await page.locator('.toolbar-group[data-group-id="draw"] .toolbar-group-btn').click();
        await page.locator(`[data-tool-id="${tool}"]`).click();
        await expect(page.locator(`[data-tool-id="${tool}"]`)).toHaveAttribute('data-active', 'true');
        await page.evaluate(async ({ controlKey, createMethod }) => {
            const store = await import('/src/js/store/index.js');
            const control = store.getControl(controlKey);
            const create = control[createMethod];
            control[createMethod] = async (...args) => {
                try { return await create(...args); } finally { globalThis.drawingFinished = true; }
            };
            const { IDUtils } = await import('/src/js/utilities/index.js');
            const name = IDUtils.generateFeatureName;
            IDUtils.generateFeatureName = async function (...args) {
                IDUtils.generateFeatureName = name;
                await new Promise((resolve) => { globalThis.releaseDrawingName = resolve; });
                return name.apply(this, args);
            };
        }, { controlKey, createMethod });
        await page.mouse.click(520, 300);
        if (tool !== 'point') await page.mouse.click(650, 430);
        if (tool === 'line') await page.mouse.click(790, 300, { button: 'right' });
        await page.waitForFunction(() => typeof globalThis.releaseDrawingName === 'function');
        // A trava chega no meio: a camada ATIVA e travada antes de o desenho gravar.
        expect(await page.evaluate(async () => {
            const store = await import('/src/js/store/index.js');
            const id = store.getActiveLayerIdSync();
            await store.setLayerLocked(id, true);
            return (store.getLayers() || []).find((l) => l.id === id)?.locked;
        })).toBe(true);
        await page.evaluate(() => globalThis.releaseDrawingName());
        await page.waitForFunction(() => globalThis.drawingFinished === true);
        const texto = await avisoLegivel(page, 'Camada ativa bloqueada');
        console.log(`AVISO_NO_COMMIT_${tool} ${texto}`);
        const result = await page.evaluate(async (s) => {
            const store = await import('/src/js/store/index.js');
            return {
                persisted: (await store.getCurrentMapFeatures())[s].length,
                drawn: (await globalThis.__ebgeoMap.getSource(s).getData()).features.length,
            };
        }, storage);
        expect(result).toEqual({ persisted: 0, drawn: 0 });
    });
}

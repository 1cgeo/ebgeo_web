// Path: e2e-ui/browser-collab-three-client-flow.spec.js

/**
 * THREE-CLIENT FLOW — three real browsers + real backend, on the full-chain harness. A
 * multi-phase session so roster/membership and convergence are exercised under changing
 * state, not just one broadcast:
 *
 *   1. all three create a feature        → each traverses the chain to the other two.
 *   2. C edits A's feature               → the edit traverses the chain to A and B.
 *   3. three-way conflict on ONE feature → all three converge to one value.
 *   4. a late joiner (C reconnects)      → A's offline-window write reaches B (full chain),
 *                                          and C catches up via snapshot (convergence check).
 *   5. C deletes a feature               → the delete traverses the chain to A and B.
 *
 * Run headed:  npx playwright test browser-collab-three-client-flow --headed
 */

import { collabTest, expect, readFeatures, drawLineUI } from './helpers/collab.fixtures.js';

const lineColor = async (page, id) => (await readFeatures(page, 'lines')).find((x) => x.id === id)?.props?.lineColor;

const COORDS_A = [[-43.2, -22.9], [-43.15, -22.85], [-43.1, -22.8]];
const COORDS_B = [[-43.3, -23.0], [-43.25, -22.95], [-43.2, -22.9]];
const COORDS_C = [[-43.1, -22.7], [-43.05, -22.65], [-43.0, -22.6]];
const COORDS_LATE = [[-43.4, -23.1], [-43.35, -23.05], [-43.3, -23.0]];

// ── Inline UI drivers (hardened for the late-join client, whose live source can lag) ──

async function openLayersTab(page) {
    if ((await page.locator('.layer-container').count()) === 0) {
        await page.locator('.sidebar-nav-btn[data-tab="camadas"]').click();
    }
    await expect(page.locator('.layer-container').first()).toBeVisible({ timeout: 10000 });
}

async function dismissFeaturePanel(page) {
    if ((await page.locator('.feature-panel[data-expanded="true"]').count()) === 0) return;
    await page.keyboard.press('Escape');
    await expect(page.locator('.feature-panel[data-expanded="true"]')).toHaveCount(0, { timeout: 5000 });
    await page.waitForTimeout(350);
}

function lineInMapSource(page, featureId) {
    return page.evaluate(async (id) => {
        const src = globalThis.__ebgeoMap?.getSource('lines');
        if (!src || typeof src.getData !== 'function') return false;
        const data = await src.getData();
        return ((data && data.features) || []).some((f) => f.properties?.id === id);
    }, featureId);
}

function nudgeLayersRefresh(page) {
    return page.evaluate(async () => {
        const store = await import('/src/js/store/index.js');
        store.getEventBus().emit('layers:changed', { mapName: store.getCurrentMapNameSync() });
    });
}

async function selectFeatureUI(page, featureId) {
    await dismissFeaturePanel(page);
    await openLayersTab(page);
    await expect.poll(() => lineInMapSource(page, featureId), { timeout: 20000 }).toBe(true);
    const row = page.locator(`.feature-item[data-feature-id="${featureId}"] .feature-main`).first();
    await expect
        .poll(async () => {
            await nudgeLayersRefresh(page);
            for (const icon of await page.locator('.layer-expand-icon.collapsed').all()) {
                await icon.click().catch(() => {});
            }
            return row.count();
        }, { timeout: 30000 })
        .toBeGreaterThan(0);
    await expect(row).toBeVisible({ timeout: 10000 });
    await row.evaluate((el) => el.click());
    await expect(page.locator('.feature-panel[data-expanded="true"]')).toBeVisible({ timeout: 10000 });
}

async function recolorViaPanelUI(page, hex) {
    const panel = page.locator('.feature-panel[data-expanded="true"]');
    const native = panel.locator('.color-picker-native-hidden').first();
    await expect(native).toBeAttached({ timeout: 5000 });
    await native.evaluate((el, value) => {
        el.value = value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }, hex);
    await page.waitForFunction(
        async (h) => {
            const src = globalThis.__ebgeoMap?.getSource('lines');
            if (!src || typeof src.getData !== 'function') return false;
            const data = await src.getData();
            return ((data && data.features) || []).some((f) => String(f.properties?.lineColor).toLowerCase() === h.toLowerCase());
        },
        hex,
        { timeout: 5000 },
    );
    const saveBtn = panel.locator('.attr-modern-btn-save');
    await expect(saveBtn).toBeVisible({ timeout: 5000 });
    await saveBtn.click();
}

async function selectAndRecolorUI(page, featureId, hex) {
    await selectFeatureUI(page, featureId);
    await recolorViaPanelUI(page, hex);
}

async function deleteFeatureUI(page, featureId) {
    await selectFeatureUI(page, featureId);
    await page.keyboard.press('Delete');
    const confirmBtn = page.locator('.confirm-modal-btn-confirm');
    await expect(confirmBtn).toBeVisible({ timeout: 5000 });
    await confirmBtn.click();
}

collabTest.describe('Three-client flow — multi-phase session with three collaborators', () => {
    collabTest.use({ collabOptions: { peers: 2, permission: 'write', mapName: 'Mapa Tático' } });

    collabTest('create-all → cross-edit → 3-way conflict → late-join catch-up → delete', async ({ collab }) => {
        collabTest.setTimeout(180000);
        const A = collab.author;
        const B = collab.peers[0];
        let C = collab.peers[1];

        // 1. CREATE-ALL — each client draws a line; each traverses the chain to the other two.
        const fa = await drawLineUI(A, COORDS_A);
        await collab.expectFullSync({ entityId: fa, type: 'lines', operationType: 'create' });
        const fb = await drawLineUI(B, COORDS_B);
        await collab.expectFullSyncFrom(B, { entityId: fb, type: 'lines', operationType: 'create' });
        const fc = await drawLineUI(C, COORDS_C);
        await collab.expectFullSyncFrom(C, { entityId: fc, type: 'lines', operationType: 'create' });

        // 2. CROSS-EDIT — C recolors A's feature; the edit traverses the chain to A and B.
        await collab.clearTraces();
        await selectAndRecolorUI(C, fa, '#22aa22');
        await collab.expectFullSyncFrom(C, { entityId: fa, type: 'lines', operationType: 'update' });

        // 3. THREE-WAY CONFLICT — all three recolor fb at once → converge to one value.
        await Promise.all([
            selectAndRecolorUI(A, fb, '#ff0000'),
            selectAndRecolorUI(B, fb, '#0000ff'),
            selectAndRecolorUI(C, fb, '#00ff00'),
        ]);
        await expect
            .poll(async () => {
                const [ca, cb, cc] = [await lineColor(A, fb), await lineColor(B, fb), await lineColor(C, fb)];
                return ca && ca === cb && cb === cc ? ca : null;
            }, { timeout: 30000 })
            .toMatch(/^#(ff0000|0000ff|00ff00)$/i);

        // 4. LATE JOIN — C disconnects (full session close). A's offline-window write reaches B
        //    through the whole chain; C reconnects (fresh session) and catches up via snapshot.
        await C.context().close();
        const fLate = await drawLineUI(A, COORDS_LATE);
        await collab.expectFullSyncTo([B], { entityId: fLate, type: 'lines', operationType: 'create' });
        C = await collab.reopenPeer(1);
        await expect.poll(async () => (await readFeatures(C, 'lines')).some((x) => x.id === fLate), { timeout: 35000 }).toBe(true);
        await expect.poll(async () => (await readFeatures(C, 'lines')).some((x) => x.id === fa), { timeout: 35000 }).toBe(true);

        // 5. DELETE — C removes a feature; the delete traverses the chain to A and B.
        await deleteFeatureUI(C, fc);
        await collab.expectFullSyncDeleteFrom(C, { entityId: fc, type: 'lines', operationType: 'delete' });
    });
});

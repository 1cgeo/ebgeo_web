// Path: e2e-ui/browser-collab-three-client-flow.spec.js

/**
 * THREE-CLIENT FLOW — three real browsers + real backend. Beyond the simple fan-out
 * (browser-collab-scale), this drives a MULTI-PHASE session with three collaborators so
 * roster/membership and convergence are exercised under changing state, not just one
 * broadcast:
 *
 *   1. all three create a feature        → every client ends with all three.
 *   2. C edits A's feature               → A and B both see the edit.
 *   3. three-way conflict on ONE feature → all three converge to one value.
 *   4. a late joiner (C reconnects)      → catches up to the full state.
 *   5. C deletes a feature               → A and B both lose it.
 *
 * UI-first: every gesture is driven through the real UI — each feature is drawn with the
 * real line tool, every recolor goes through the attribute panel's color picker, and the
 * delete uses the Delete key + confirm modal. Only the late-join disconnect/reconnect
 * (no UI) stays programmatic. The convergence ASSERTIONS are unchanged.
 *
 * Run headed:  npx playwright test browser-collab-three-client-flow --headed
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import {
    seedSharedAtlas,
    openClient,
    readFeatures,
    drawLineUI,
    pollPeerFeature,
    pollPeerFeatureWhere,
    pollPeerFeatureGone,
    addSharedUser,
    assertLedgerClean,
} from './helpers/collab-helpers.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

const lineColor = async (page, id) => (await readFeatures(page, 'lines')).find((x) => x.id === id)?.props?.lineColor;

// Distinct line coordinates per author so the three create-all lines don't overlap.
const COORDS_A = [[-43.2, -22.9], [-43.15, -22.85], [-43.1, -22.8]];
const COORDS_B = [[-43.3, -23.0], [-43.25, -22.95], [-43.2, -22.9]];
const COORDS_C = [[-43.1, -22.7], [-43.05, -22.65], [-43.0, -22.6]];
const COORDS_LATE = [[-43.4, -23.1], [-43.35, -23.05], [-43.3, -23.0]];

// ── Inline UI drivers (panel/sidebar gestures with no shared helper) ──────────
// Learned from the clean sibling specs: layers-tree select from
// browser-collab-shared-atlas.spec.js, the color picker's custom-color native input from
// tool_manager/helpers/color-picker.helpers.js, and the Delete-key + confirm-modal delete
// from keyboard-shortcuts.spec.js + modals/confirm.modal.js.

/** Opens the layers ("camadas") tab (idempotent — never toggles it closed). */
async function openLayersTab(page) {
    if ((await page.locator('.layer-container').count()) === 0) {
        await page.locator('.sidebar-nav-btn[data-tab="camadas"]').click();
    }
    await expect(page.locator('.layer-container').first()).toBeVisible({ timeout: 10000 });
}

/**
 * Dismisses an open feature panel before a tree gesture. After any auto-select the
 * 400px left-overlay `.feature-panel` covers the canvas AND sits over the sidebar's
 * layers tree, so a leftover panel can hide the tree row we want to click. Press Escape
 * and wait for the panel to collapse (it settles ~56px off-screen but its
 * `[data-expanded="true"]` attribute clears — assert on COUNT, not boundingBox).
 */
async function dismissFeaturePanel(page) {
    if ((await page.locator('.feature-panel[data-expanded="true"]').count()) === 0) return;
    await page.keyboard.press('Escape');
    await expect(page.locator('.feature-panel[data-expanded="true"]')).toHaveCount(0, { timeout: 5000 });
    await page.waitForTimeout(350); // let the panel-close transition settle
}

/** Reads whether the live `lines` MAP SOURCE (what the tree renders from) has `featureId`. */
function lineInMapSource(page, featureId) {
    return page.evaluate(async (id) => {
        const src = globalThis.__ebgeoMap?.getSource('lines');
        if (!src || typeof src.getData !== 'function') return false;
        const data = await src.getData();
        return ((data && data.features) || []).some((f) => f.properties?.id === id);
    }, featureId);
}

/** Nudges the (visible) layers tab to re-render from the now-current map sources. */
function nudgeLayersRefresh(page) {
    return page.evaluate(async () => {
        const store = await import('/src/js/store/index.js');
        store.getEventBus().emit('layers:changed', { mapName: store.getCurrentMapNameSync() });
    });
}

/**
 * Selects a feature by id through the REAL layers tree → expands the sidebar feature panel.
 *
 * Hardened for the late-join client: after a reconnect the synced feature lands in the STORE
 * (the pollPeer* store-polls pass) but the live `lines` MAP SOURCE that the tree renders from
 * can lag, and the features tab refreshes only on `sourcedata`/`LAYERS_CHANGED` WHILE visible
 * (features_tab.js `_handleSourceData`/`_scheduleRefresh` early-return when hidden) — so the
 * one-shot `loadFeatures()` on tab-open could read the empty source and the row never appears
 * ("Padrão (0)" / "Sem feições"). We therefore (1) dismiss any panel overlaying the tree,
 * (2) wait for the feature to reach the MAP SOURCE, then (3) poll the row open while nudging a
 * tab refresh + re-expanding nodes each tick (the tree re-renders, collapsing/replacing rows).
 */
async function selectFeatureUI(page, featureId) {
    await dismissFeaturePanel(page);
    await openLayersTab(page);

    // The tree reads the MAP SOURCE, not the store — wait until the feature is actually there.
    await expect.poll(() => lineInMapSource(page, featureId), { timeout: 20000 }).toBe(true);

    const row = page.locator(`.feature-item[data-feature-id="${featureId}"] .feature-main`).first();
    await expect
        .poll(async () => {
            // Force the visible tab to re-render from the now-populated source, then expand any
            // collapsed layer node so the row is in the (visible) layout before we look for it.
            await nudgeLayersRefresh(page);
            for (const icon of await page.locator('.layer-expand-icon.collapsed').all()) {
                await icon.click().catch(() => {});
            }
            return row.count();
        }, { timeout: 30000 })
        .toBeGreaterThan(0);

    await expect(row).toBeVisible({ timeout: 10000 });
    await row.evaluate((el) => el.click()); // raw DOM click — actionability can hang on overlapped rows
    await expect(page.locator('.feature-panel[data-expanded="true"]')).toBeVisible({ timeout: 10000 });
}

/**
 * Recolors the currently-selected feature via the panel color picker's custom-color native
 * input, then COMMITS through the panel's "Salvar" button. The color picker's onChange only
 * writes the live map SOURCE (control.updateFeaturesProperty) — it does NOT persist to the
 * store or sync; persistence happens on save (control.saveFeatures → updateFeature → sync).
 * So a user recolor is "set color" + "Salvar"; without the save click the new color never
 * reaches the store/peer and the feature stays at its default color.
 */
async function recolorViaPanelUI(page, hex) {
    const panel = page.locator('.feature-panel[data-expanded="true"]');
    const native = panel.locator('.color-picker-native-hidden').first();
    await expect(native).toBeAttached({ timeout: 5000 });
    await native.evaluate((el, value) => {
        el.value = value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }, hex);
    // The picker's onChange writes the new color into the live `lines` source asynchronously
    // (updateFeaturesProperty getData/setData). Wait for it to land before saving, so the
    // save reads the new color and not the pre-change source — deterministic, no fixed sleep.
    await page.waitForFunction(
        async (h) => {
            const src = globalThis.__ebgeoMap?.getSource('lines');
            if (!src || typeof src.getData !== 'function') return false;
            const data = await src.getData();
            const feats = (data && data.features) || [];
            return feats.some((f) => String(f.properties?.lineColor).toLowerCase() === h.toLowerCase());
        },
        hex,
        { timeout: 5000 },
    );
    // Commit the edit exactly like a user: "Salvar" persists + syncs and closes the panel.
    const saveBtn = panel.locator('.attr-modern-btn-save');
    await expect(saveBtn).toBeVisible({ timeout: 5000 });
    await saveBtn.click();
}

/** Selects a feature in the layers tree, then recolors it through the panel (one gesture). */
async function selectAndRecolorUI(page, featureId, hex) {
    await selectFeatureUI(page, featureId);
    await recolorViaPanelUI(page, hex);
}

/** Deletes a feature through the REAL UI: select in the layers tree, press Delete, confirm. */
async function deleteFeatureUI(page, featureId) {
    await selectFeatureUI(page, featureId);
    await page.keyboard.press('Delete');
    const confirmBtn = page.locator('.confirm-modal-btn-confirm');
    await expect(confirmBtn).toBeVisible({ timeout: 5000 });
    await confirmBtn.click();
}

describeOrSkip('Three-client flow — multi-phase session with three collaborators', () => {
    test('create-all → cross-edit → 3-way conflict → late-join catch-up → delete', async ({ browser }, testInfo) => {
        // THREE live browsers + a late-join reconnect — give it headroom over the 60s
        // default so full-suite load can't tip it into a timeout.
        test.setTimeout(180000);
        const seed = await seedSharedAtlas(browser, state.baseUrl);
        const seedPage = await browser.newPage();
        await seedPage.goto('/');
        const userC = await addSharedUser(seedPage, state.baseUrl, seed.userA, seed.atlasId, { label: 'charlie' });
        await seedPage.close();

        const A = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA);
        const B = await openClient(browser, state.baseUrl, seed.atlasId, seed.userB);
        let C = await openClient(browser, state.baseUrl, seed.atlasId, userC);
        try {
            // 1. CREATE-ALL — each client draws a line with the real tool; all three converge
            //    on all three. The tool generates each id, which drawLineUI reads back.
            const fa = await drawLineUI(A, COORDS_A);
            const fb = await drawLineUI(B, COORDS_B);
            const fc = await drawLineUI(C, COORDS_C);
            expect(fa && fb && fc, 'each client drew a line').toBeTruthy();
            for (const [page, id] of [[B, fa], [C, fa], [A, fb], [C, fb], [A, fc], [B, fc]]) {
                await pollPeerFeature(page, 'lines', id);
            }

            // 2. CROSS-EDIT — C recolors A's feature through the panel; A and B both see it.
            await selectAndRecolorUI(C, fa, '#22aa22');
            await pollPeerFeatureWhere(A, 'lines', fa, (p) => /^#22aa22$/i.test(p.lineColor));
            await pollPeerFeatureWhere(B, 'lines', fa, (p) => /^#22aa22$/i.test(p.lineColor));

            // 3. THREE-WAY CONFLICT — all three recolor the SAME feature at once (one panel
            //    gesture per browser, fired in parallel) → converge. The picker normalizes the
            //    hex to UPPERCASE (color-picker.helpers.js), so match case-insensitively.
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

            // 4. LATE JOIN — C disconnects, the room edits, C reconnects and catches up.
            // no-UI: closing/reopening a browser context (disconnect/reconnect) has no in-app
            // UI — it is the test harness simulating a client dropping and rejoining.
            await C.context().close();
            const fLate = await drawLineUI(A, COORDS_LATE);
            expect(fLate, 'A drew the late-join line').toBeTruthy();
            await pollPeerFeature(B, 'lines', fLate);
            C = await openClient(browser, state.baseUrl, seed.atlasId, userC);
            await pollPeerFeature(C, 'lines', fLate, 35000);
            await pollPeerFeature(C, 'lines', fa); // and the earlier state too

            // 5. DELETE — C removes a feature through the real UI (Delete key + confirm); A and
            //    B both lose it.
            await deleteFeatureUI(C, fc);
            await pollPeerFeatureGone(A, 'lines', fc);
            await pollPeerFeatureGone(B, 'lines', fc);

            // SyncLedger oracle: no op was acked-but-no-effect across the 3-client session.
            await assertLedgerClean(testInfo, [A, B, C], state.baseUrl, seed.userA, seed.atlasId);
        } finally {
            await A.context().close();
            await B.context().close();
            await C.context().close();
        }
    });
});

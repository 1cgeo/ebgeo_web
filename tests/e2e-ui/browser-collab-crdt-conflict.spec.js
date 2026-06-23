// Path: e2e-ui/browser-collab-crdt-conflict.spec.js

/**
 * CRDT CONFLICT / CONVERGENCE — TWO real browsers + real backend. The core CRDT
 * guarantee the suite never exercised end-to-end: when two clients edit the SAME entity
 * "at the same time", conflict resolves by LWW-by-ARRIVAL (NOT timestamp; per
 * CLAUDE.md), and BOTH clients must CONVERGE to one agreed value — no permanent
 * divergence. We assert convergence (the clients AGREE), not which side wins (that's
 * arrival-order dependent and non-deterministic).
 *
 * UI-first: the line is drawn with the real line tool and the concurrent recolors / the
 * concurrent delete are driven through the real attribute panel + Delete key. The two
 * gestures are still fired concurrently (one per browser, in parallel) so they race before
 * cross-sync settles. The concurrent GEOMETRY move stays programmatic — there is no
 * single-gesture UI to set a line's geometry to EXACT coordinates (no-UI, flagged inline) —
 * and the convergence ASSERTIONS are unchanged.
 *
 * Covered:
 *   1. concurrent recolor of the same line        → A and B converge to ONE color.
 *   2. concurrent move (geometry) of the same line → A and B converge to ONE geometry.
 *   3. concurrent UPDATE on A vs DELETE on B       → A and B converge (same presence).
 *
 * Run headed:  npx playwright test browser-collab-crdt-conflict --headed
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { seedSharedAtlas, openClient, readFeatures, drawLineUI, pollPeerFeature } from './helpers/collab-helpers.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** Drives a store op on `page` through the app's REAL store facade (no-UI escapes only). */
function applyStoreOp(page, opName, args) {
    return page.evaluate(async ({ name, a }) => {
        const store = await import('/src/js/store/index.js');
        return store[name](...a);
    }, { name: opName, a: args });
}

const lineProp = async (page, id, prop) => {
    const f = (await readFeatures(page, 'lines')).find((x) => x.id === id);
    return f?.props?.[prop];
};

const lineGeomKey = (page, id) => page.evaluate(async (i) => {
    const store = await import('/src/js/store/index.js');
    const f = (await store.getCurrentMapFeatures()).lines.find((x) => x.properties?.id === i);
    return f ? JSON.stringify(f.geometry?.coordinates) : null;
}, id);

const hasLine = async (page, id) => (await readFeatures(page, 'lines')).some((x) => x.id === id);

// The coordinates the real line tool draws (also where the camera is fit before the clicks).
const LINE_COORDS = [[-43.2, -22.9], [-43.15, -22.85], [-43.1, -22.8]];

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

/** Selects a feature by id through the REAL layers tree → expands the sidebar feature panel. */
async function selectFeatureUI(page, featureId) {
    await openLayersTab(page);
    for (const icon of await page.locator('.layer-expand-icon.collapsed').all()) {
        await icon.click().catch(() => {});
    }
    const row = page.locator(`.feature-item[data-feature-id="${featureId}"] .feature-main`).first();
    await expect(row).toBeVisible({ timeout: 10000 });
    await row.evaluate((el) => el.click());
    await expect(page.locator('.feature-panel[data-expanded="true"]')).toBeVisible({ timeout: 10000 });
}

/**
 * Commits the open panel's pending edits the way a user does — clicking "Salvar".
 * The panel's style controls (color picker, etc.) call `updateFeaturesProperty`, which
 * only mutates the live map source; persistence + sync happen on save
 * (`control.saveFeatures` → `updateFeature`). Without this the edit never reaches the
 * store/peer (the convergence poll reads `getCurrentMapFeatures`, i.e. the store).
 */
async function savePanelUI(page) {
    const saveBtn = page.locator('.feature-panel[data-expanded="true"] .attr-modern-btn-save').first();
    await expect(saveBtn).toBeVisible({ timeout: 5000 });
    await saveBtn.click();
}

/** Recolors the currently-selected feature via the panel color picker's custom-color native input, then saves. */
async function recolorViaPanelUI(page, hex) {
    const native = page.locator('.feature-panel[data-expanded="true"] .color-picker-native-hidden').first();
    await expect(native).toBeAttached({ timeout: 5000 });
    await native.evaluate((el, value) => {
        el.value = value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }, hex);
    await savePanelUI(page);
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

describeOrSkip('CRDT conflict — concurrent edits converge (LWW by arrival)', () => {
    test('concurrent recolor of the SAME line → both clients converge to one color', async ({ browser }) => {
        const seed = await seedSharedAtlas(browser, state.baseUrl);
        const A = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA);
        const B = await openClient(browser, state.baseUrl, seed.atlasId, seed.userB);
        try {
            // A draws the line with the real tool; B receives it before the concurrent edit.
            const id = await drawLineUI(A, LINE_COORDS);
            expect(id, 'the line tool created a feature on A').toBeTruthy();
            await pollPeerFeature(B, 'lines', id);

            // Both recolor the same line "simultaneously" through their own panels — fire in
            // parallel (one gesture per browser) without awaiting cross-sync between them.
            await Promise.all([
                selectAndRecolorUI(A, id, '#ff0000'),
                selectAndRecolorUI(B, id, '#0000ff'),
            ]);

            // Convergence: A and B must end on the SAME color, and it must be one of the two.
            // The panel color picker normalizes the hex to UPPERCASE (color-picker.helpers.js),
            // so the converged value is '#FF0000'/'#0000FF' — matched case-insensitively.
            await expect
                .poll(async () => {
                    const ca = await lineProp(A, id, 'lineColor');
                    const cb = await lineProp(B, id, 'lineColor');
                    return ca && cb && ca === cb ? ca : null;
                }, { timeout: 25000 })
                .toMatch(/^#(ff0000|0000ff)$/i);
        } finally {
            await A.context().close();
            await B.context().close();
        }
    });

    test('concurrent geometry move of the SAME line → both clients converge to one geometry', async ({ browser }) => {
        const seed = await seedSharedAtlas(browser, state.baseUrl);
        const A = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA);
        const B = await openClient(browser, state.baseUrl, seed.atlasId, seed.userB);
        try {
            // A draws the line with the real tool; B receives it before the concurrent move.
            const id = await drawLineUI(A, LINE_COORDS);
            expect(id, 'the line tool created a feature on A').toBeTruthy();
            await pollPeerFeature(B, 'lines', id);

            // no-UI: setting a line's geometry to EXACT coordinates has no single-gesture UI
            // (a canvas drag is non-deterministic and WebGL hit-testing of a thin line is
            // unreliable headless), and the convergence assertion compares exact coordinate
            // keys — so the concurrent move stays programmatic. Each side rewrites the SAME
            // line's geometry, reusing the drawn feature's properties.
            const propsA = (await readFeatures(A, 'lines')).find((x) => x.id === id)?.props;
            const propsB = (await readFeatures(B, 'lines')).find((x) => x.id === id)?.props;
            const geomA = { type: 'LineString', coordinates: [[-43.0, -22.7], [-42.9, -22.6]] };
            const geomB = { type: 'LineString', coordinates: [[-44.0, -23.7], [-43.9, -23.6]] };
            await Promise.all([
                applyStoreOp(A, 'updateFeature', ['lines', { type: 'Feature', properties: propsA, geometry: geomA }]),
                applyStoreOp(B, 'updateFeature', ['lines', { type: 'Feature', properties: propsB, geometry: geomB }]),
            ]);

            const ka = JSON.stringify(geomA.coordinates);
            const kb = JSON.stringify(geomB.coordinates);
            await expect
                .poll(async () => {
                    const a = await lineGeomKey(A, id);
                    const b = await lineGeomKey(B, id);
                    return a && b && a === b ? a : null;
                }, { timeout: 25000 })
                .toMatch(new RegExp(`^(${ka.replace(/[[\]]/g, '\\$&')}|${kb.replace(/[[\]]/g, '\\$&')})$`));
        } finally {
            await A.context().close();
            await B.context().close();
        }
    });

    test('concurrent UPDATE (A) vs DELETE (B) of the SAME line → both clients converge', async ({ browser }) => {
        const seed = await seedSharedAtlas(browser, state.baseUrl);
        const A = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA);
        const B = await openClient(browser, state.baseUrl, seed.atlasId, seed.userB);
        try {
            // A draws the line with the real tool; B receives it before the concurrent edit.
            const id = await drawLineUI(A, LINE_COORDS);
            expect(id, 'the line tool created a feature on A').toBeTruthy();
            await pollPeerFeature(B, 'lines', id);

            // A recolors it through the panel while B deletes it (Delete key + confirm), in
            // parallel — a real concurrent update-vs-delete from two users.
            await Promise.all([
                selectAndRecolorUI(A, id, '#ff0000'),
                deleteFeatureUI(B, id),
            ]);

            // Convergence: A and B must agree on the feature's PRESENCE (both gone, or both
            // present) — never one client showing it and the other not.
            await expect
                .poll(async () => {
                    const a = await hasLine(A, id);
                    const b = await hasLine(B, id);
                    return a === b ? `agree:${a}` : null;
                }, { timeout: 25000 })
                .toMatch(/^agree:(true|false)$/);
        } finally {
            await A.context().close();
            await B.context().close();
        }
    });
});

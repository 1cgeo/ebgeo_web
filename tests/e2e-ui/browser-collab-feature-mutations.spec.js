// Path: e2e-ui/browser-collab-feature-mutations.spec.js

/**
 * FEATURE MUTATIONS synced cross-client — TWO real browsers + real backend. Client A
 * drives the app's REAL UI (draw a line / military symbol with the toolbar tools, rename
 * + recolor through the attribute panel, delete with the Delete key) and client B asserts
 * NATIVE sync carried each mutation through, with no workarounds.
 *
 * Covered, in order, on a LINE then a MILITARY SYMBOL:
 *   1. create a line (line tool)              → B sees the feature
 *   2. rename it (panel name field)           → B sees the new name
 *   3. set a description                      → B sees the description (no-UI: see below)
 *   4. recolor it (panel color picker)        → B sees the new color
 *   5. move its geometry                      → B sees the new coordinates (no-UI: see below)
 *   6. create a military symbol (military tool) + change SIDC → B sees the symbol, then SIDC
 *   7. delete the line (Delete key)           → B no longer has it
 *
 * UI-first: every gesture a user can perform is driven through the real UI. The handful of
 * actions with no single-gesture UI (a line's free-text `descricao`, setting a line's
 * geometry to EXACT coordinates, and an arbitrary exact SIDC string) stay programmatic and
 * are flagged inline with `// no-UI:`; the ASSERTIONS are unchanged.
 *
 * The seed/login/open plumbing, the draw helpers and the poll helpers come from
 * ./helpers/collab-helpers.js; structure mirrors browser-collab-shared-atlas.spec.js.
 *
 * Run headed:  npx playwright test browser-collab-feature-mutations --headed
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import {
    seedSharedAtlas,
    openClient,
    readFeatures,
    drawLineUI,
    drawPointUI,
    pollPeerFeature,
    pollPeerFeatureWhere,
    pollPeerFeatureGone,
    assertLedgerClean,
} from './helpers/collab-helpers.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** Drives a store op on `page` through the app's REAL store facade (setup / no-UI escapes only). */
function applyStoreOp(page, opName, args) {
    return page.evaluate(async ({ name, a }) => {
        const store = await import('/src/js/store/index.js');
        return store[name](...a);
    }, { name: opName, a: args });
}

/** Reads the peer's stored geometry for a feature of `type`/`id` (or null). */
function readPeerGeometry(page, type, id) {
    return page.evaluate(async ({ t, i }) => {
        const store = await import('/src/js/store/index.js');
        const f = await store.getCurrentMapFeatures();
        const hit = (f[t] || []).find((x) => x.properties?.id === i);
        return hit ? hit.geometry : null;
    }, { t: type, i: id });
}

/** Polls until the peer's stored geometry for `type`/`id` satisfies `pred(geometry)`. */
async function pollPeerGeometryWhere(page, type, id, pred, timeout = 20000) {
    await expect
        .poll(async () => {
            const geom = await readPeerGeometry(page, type, id);
            return geom ? !!pred(geom) : false;
        }, { timeout })
        .toBe(true);
}

// ── Inline UI drivers (panel/sidebar gestures with no shared helper) ──────────
// Learned from the clean sibling specs: layers-tree select from
// browser-collab-shared-atlas.spec.js, the panel name field from
// tool_manager/helpers/feature-header.helpers.js, the color picker's custom-color
// native input from tool_manager/helpers/color-picker.helpers.js, and the Delete-key +
// confirm-modal delete from keyboard-shortcuts.spec.js + modals/confirm.modal.js.

/** Opens the layers ("camadas") tab (idempotent — never toggles it closed). */
async function openLayersTab(page) {
    if ((await page.locator('.layer-container').count()) === 0) {
        await page.locator('.sidebar-nav-btn[data-tab="camadas"]').click();
    }
    await expect(page.locator('.layer-container').first()).toBeVisible({ timeout: 10000 });
}

/**
 * Selects a feature by id through the REAL layers tree (expand all nodes, click its row).
 * The row click runs handleFeatureClick → selection, which expands the sidebar feature
 * panel — so callers can then edit it through the panel. Uses a raw DOM click because
 * actionability can hang on overlapped tree rows (same rationale as the shared-atlas spec).
 */
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
 * The panel's name/style controls call `updateFeaturesProperty`, which only mutates the
 * live map source; persistence + sync happen on save (`control.saveFeatures` →
 * `updateFeature`). Without this the edit never reaches the store/peer (the peer polls
 * read `getCurrentMapFeatures`, i.e. the store, not the editing client's map source).
 */
async function savePanelUI(page) {
    const saveBtn = page.locator('.feature-panel[data-expanded="true"] .attr-modern-btn-save').first();
    await expect(saveBtn).toBeVisible({ timeout: 5000 });
    await saveBtn.click();
}

/**
 * Renames the currently-selected feature through the sidebar panel's editable name field:
 * click the display to enter edit mode (createFeatureIdentification reveals the hidden
 * input by toggling the `--hidden` modifier), type the new name, commit with Enter, then
 * save. (onNameChange fires only when the name actually changed; the change rides the live
 * map source until "Salvar" persists + syncs it.)
 */
async function renameViaPanelUI(page, newName) {
    const panel = page.locator('.feature-panel[data-expanded="true"]');
    await panel.locator('.feature-identification-name').click();
    const input = panel.locator('.feature-identification-name-input:not(.feature-identification-name-input--hidden)');
    await expect(input).toBeVisible({ timeout: 5000 });
    await input.fill(newName);
    await input.press('Enter');
    await savePanelUI(page);
}

/**
 * Recolors the currently-selected feature through the panel color picker's "custom color"
 * native input. The hidden <input type="color"> fires its `change` listener →
 * onSelect(normalizeColor(value)) → the tool's updateFeaturesProperty, exactly like a user
 * picking a custom swatch. Driving the native input (vs. clicking a frequent-color circle)
 * lets us set an EXACT hex, which the assertion checks. The picked color rides the live map
 * source until "Salvar" persists + syncs it (see savePanelUI).
 */
async function recolorViaPanelUI(page, hex) {
    const native = page.locator('.feature-panel[data-expanded="true"] .color-picker-native-hidden').first();
    await expect(native).toBeAttached({ timeout: 5000 });
    await native.evaluate((el, value) => {
        el.value = value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }, hex);
    await savePanelUI(page);
}

/**
 * Deletes a feature through the REAL UI: select it in the layers tree, press Delete, then
 * confirm in the destructive confirm modal (keyboard-shortcuts → _confirmAndDeleteSelectedFeatures
 * → showConfirm → selectionManager.deleteSelectedFeatures).
 */
async function deleteFeatureUI(page, featureId) {
    await selectFeatureUI(page, featureId);
    await page.keyboard.press('Delete');
    const confirmBtn = page.locator('.confirm-modal-btn-confirm');
    await expect(confirmBtn).toBeVisible({ timeout: 5000 });
    await confirmBtn.click();
}

/** Places a MILITARY SYMBOL with the real tool: activate → single click (default SIDC). @returns {Promise<string>} new id. */
async function drawMilitarySymbolUI(page, lngLat) {
    const before = new Set((await readFeatures(page, 'military_symbols')).map((f) => f.id));

    await page.evaluate((c) => globalThis.__ebgeoMap.jumpTo({ center: c, zoom: 14 }), lngLat);
    await page.waitForTimeout(300); // let the camera settle before projecting

    await page.locator('.toolbar-group[data-group-id="military"] .toolbar-group-btn').click();
    await expect(page.locator('.toolbar-group[data-group-id="military"] .toolbar-popup'))
        .toHaveAttribute('data-visible', 'true', { timeout: 5000 });
    await page.locator('.toolbar-group[data-group-id="military"] .toolbar-tool-btn[data-tool-id="militarySymbol"]').click();

    const pt = await page.evaluate((c) => {
        const map = globalThis.__ebgeoMap;
        const rect = map.getCanvas().getBoundingClientRect();
        const p = map.project(c);
        return { x: Math.round(rect.left + p.x), y: Math.round(rect.top + p.y) };
    }, lngLat);
    await page.mouse.click(pt.x, pt.y);

    let id = null;
    await expect.poll(async () => {
        const fresh = (await readFeatures(page, 'military_symbols')).find((f) => !before.has(f.id));
        id = fresh?.id ?? null;
        return id;
    }, { timeout: 10000 }).toBeTruthy();
    return id;
}

describeOrSkip('Feature mutations sync cross-client (two real browsers, real UI gestures)', () => {
    test('create → rename → describe → recolor → move → military symbol + SIDC → delete', async ({ browser }, testInfo) => {
        const seed = await seedSharedAtlas(browser, state.baseUrl);
        const A = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA);
        const B = await openClient(browser, state.baseUrl, seed.atlasId, seed.userB);

        try {
            // 1. A creates a LINE with the real line tool (toolbar activate + vertex clicks +
            //    right-click finish); the tool generates the id, which the helper reads back →
            //    B receives it (native sync).
            const lineId = await drawLineUI(A, [[-43.2, -22.9], [-43.15, -22.85], [-43.1, -22.8]]);
            expect(lineId, 'the line tool created a feature on A').toBeTruthy();
            await pollPeerFeature(B, 'lines', lineId);

            // 2. A renames the line through the panel name field → B sees the new name.
            await selectFeatureUI(A, lineId);
            await renameViaPanelUI(A, 'Eixo Azul');
            await pollPeerFeatureWhere(B, 'lines', lineId, (p) => p.nome === 'Eixo Azul');

            // 3. A sets a description → B sees it.
            // no-UI: the line attribute panel has no free-text `descricao` field (it exposes
            // per-segment "Observações por Perna", not a feature description); setting an
            // arbitrary HTML description has no single-gesture UI, so it stays programmatic.
            await applyStoreOp(A, 'updateFeatureProperty', ['lines', lineId, 'descricao', '<p>nota</p>']);
            await pollPeerFeatureWhere(B, 'lines', lineId, (p) => p.descricao === '<p>nota</p>');

            // 4. A recolors the line through the panel color picker (custom-color native input,
            //    lineColor) → B sees the new color. The picker normalizes the hex to UPPERCASE
            //    (color-picker.helpers.js normalizeColor), so the synced value is '#EE1111' —
            //    we compare case-insensitively (same color, the UI's canonical casing).
            await selectFeatureUI(A, lineId);
            await recolorViaPanelUI(A, '#ee1111');
            await pollPeerFeatureWhere(B, 'lines', lineId, (p) => /^#ee1111$/i.test(p.lineColor));

            // 5. A moves the geometry → B sees the move.
            // no-UI: there is no single-gesture UI to set a line's geometry to EXACT
            // coordinates — a canvas drag is non-deterministic and WebGL hit-testing of a thin
            // line is unreliable headless — and the assertion checks an exact coordinate, so
            // the move stays programmatic (read current feature, update with new coordinates).
            const lineOnA = (await readFeatures(A, 'lines')).find((x) => x.id === lineId);
            expect(lineOnA, "A's line is in its own store before the move").toBeTruthy();
            const movedLine = {
                type: 'Feature',
                properties: lineOnA.props,
                geometry: {
                    type: 'LineString',
                    coordinates: [[-43.0, -22.7], [-42.9, -22.6]],
                },
            };
            await applyStoreOp(A, 'updateFeature', ['lines', movedLine]);
            await pollPeerGeometryWhere(
                B,
                'lines',
                lineId,
                (geom) => geom.type === 'LineString' && geom.coordinates?.[0]?.[0] === -43.0,
            );

            // 6. A creates a MILITARY SYMBOL with the real military tool (single click, default
            //    SIDC) → B receives it; then A changes the SIDC → B sees the change.
            const symbolId = await drawMilitarySymbolUI(A, [-43.2, -22.9]);
            expect(symbolId, 'the military tool created a symbol on A').toBeTruthy();
            await pollPeerFeature(B, 'military_symbols', symbolId);

            // no-UI: the SIDC editor is a multi-combobox modal that composes a 30-char
            // MIL-STD-2525D SIDC from building blocks — it cannot deterministically yield an
            // arbitrary exact SIDC string — so the SIDC edit (a symbol-property mutation) is
            // applied programmatically. We flip the symbol's SIDC to a new value and assert it
            // synced, preserving the "a symbol property edit reaches B" intent.
            const symOnA = (await readFeatures(A, 'military_symbols')).find((x) => x.id === symbolId);
            const newSidc = symOnA?.props?.sidc === 'SHGPUCI-----' ? 'SFGPUCI-----' : 'SHGPUCI-----';
            await applyStoreOp(A, 'updateFeatureProperty', ['military_symbols', symbolId, 'sidc', newSidc]);
            await pollPeerFeatureWhere(B, 'military_symbols', symbolId, (p) => p.sidc === newSidc);

            // 7a. ISOLATED delete (bisect a rapid-sequence race vs a real delete bug): a fresh
            //     point drawn with the real point tool, confirmed on B, then deleted through the
            //     real UI (Delete key + confirm) → B must lose it.
            const delId = await drawPointUI(A, [-43.1, -22.8]);
            expect(delId, 'the point tool created a point on A').toBeTruthy();
            await pollPeerFeature(B, 'points', delId);
            await deleteFeatureUI(A, delId);
            await pollPeerFeatureGone(B, 'points', delId);

            // 7b. Delete the line edited earlier through the real UI → B no longer has it.
            await deleteFeatureUI(A, lineId);
            await pollPeerFeatureGone(B, 'lines', lineId);

            // SyncLedger oracle: no op was acked-but-no-effect; ledger attached.
            await assertLedgerClean(testInfo, [A, B], state.baseUrl, seed.userA, seed.atlasId);
        } finally {
            await A.context().close();
            await B.context().close();
        }
    });
});

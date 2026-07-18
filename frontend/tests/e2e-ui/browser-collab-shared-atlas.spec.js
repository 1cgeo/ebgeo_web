// Path: e2e-ui/browser-collab-shared-atlas.spec.js

/**
 * FAITHFUL 9-step collaboration flow on a SHARED atlas — TWO real browsers, real backend,
 * on the full-chain harness. Drives the app's OWN UI + NATIVE sync, with NO workarounds.
 *
 * Steps: two browsers (fixture) → both open the shared atlas (fixture) → same view →
 * remote cursors (native presence) → each draws a feature with the REAL tools → each
 * feature traverses the WHOLE chain to the other (expectFullSync) → shows in the OTHER's
 * layers tree → each selects the OTHER's feature (the map flies to it).
 *
 * Run headed:  npx playwright test browser-collab-shared-atlas --headed
 */

import { collabTest, expect, currentMapName, drawLineUI, drawMilitarySymbolUI } from './helpers/collab.fixtures.js';

const SHARED_MAP = 'Mapa Tático';
const CENTER = { lng: -43.2, lat: -22.9 };
const ZOOM = 13;

const canvasBox = (page) => page.locator('.maplibregl-canvas').boundingBox();

/** Moves the mouse across the live canvas so the app broadcasts the local cursor. */
async function moveCursorOverCanvas(page) {
    const box = await canvasBox(page);
    for (let i = 0; i < 8; i++) {
        await page.mouse.move(box.x + box.width * (0.35 + i * 0.03), box.y + box.height * (0.40 + i * 0.02));
        await page.waitForTimeout(90); // > the 80ms presence throttle
    }
}

/** Opens the layers tab (idempotent — never toggles it closed). */
async function openLayersTab(page) {
    if ((await page.locator('.layer-container').count()) === 0) {
        await page.locator('.sidebar-nav-btn[data-tab="camadas"]').click();
    }
    await expect(page.locator('.layer-container').first()).toBeVisible({ timeout: 10000 });
}

/** Selects a feature by id in the layers tree; asserts the map flew toward it. */
async function selectFeatureById(page, featureId) {
    await openLayersTab(page);
    for (const icon of await page.locator('.layer-expand-icon.collapsed').all()) {
        await icon.click().catch(() => {});
    }
    const before = await page.evaluate(() => {
        globalThis.__ebgeoMap.jumpTo({ center: [-30, -10], zoom: 4 });
        return globalThis.__ebgeoMap.getZoom();
    });
    const row = page.locator(`.feature-item[data-feature-id="${featureId}"] .feature-main`).first();
    await expect(row).toBeVisible({ timeout: 10000 });
    await row.evaluate((el) => el.click());
    await expect.poll(() => page.evaluate(() => globalThis.__ebgeoMap.getZoom()), { timeout: 8000 }).toBeGreaterThan(before + 3);
}

collabTest.describe('Faithful 9-step shared-atlas collaboration (two real browsers, no workarounds)', () => {
    collabTest('same view → cursors → draw → full chain → see in layers → select, both ways', async ({ collab }) => {
        const A = collab.author;
        const B = collab.peers[0];

        // Both landed on the ATLAS map (not the local "Principal").
        expect(await currentMapName(A)).toBe(SHARED_MAP);
        expect(await currentMapName(B)).toBe(SHARED_MAP);

        // Both zoom to the SAME place.
        for (const page of [A, B]) {
            await page.evaluate(({ c, z }) => globalThis.__ebgeoMap.jumpTo({ center: [c.lng, c.lat], zoom: z }), { c: CENTER, z: ZOOM });
        }

        // Each moves its mouse → the OTHER sees the remote cursor (native presence).
        await moveCursorOverCanvas(A);
        await expect(B.locator('[data-testid="remote-cursor"]')).toHaveCount(1, { timeout: 8000 });
        await moveCursorOverCanvas(B);
        await expect(A.locator('[data-testid="remote-cursor"]')).toHaveCount(1, { timeout: 8000 });

        // Each creates a feature with the REAL tools; each traverses the WHOLE chain to the other.
        const lineId = await drawLineUI(A, [
            [CENTER.lng - 0.02, CENTER.lat - 0.01],
            [CENTER.lng + 0.01, CENTER.lat + 0.005],
            [CENTER.lng + 0.03, CENTER.lat - 0.008],
        ]);
        expect(lineId, 'Alfa\'s line was created by the line tool').toBeTruthy();
        await collab.expectFullSync({ entityId: lineId, type: 'lines', operationType: 'create' });

        const symbolId = await drawMilitarySymbolUI(B, [CENTER.lng, CENTER.lat]);
        expect(symbolId, 'Bravo\'s symbol was created by the military tool').toBeTruthy();
        await collab.expectFullSyncFrom(B, { entityId: symbolId, type: 'military_symbols', operationType: 'create', skipRender: true });

        // The OTHER's feature shows in each user's layers tree.
        await openLayersTab(A);
        await expect(A.locator(`.feature-item[data-feature-id="${symbolId}"]`)).toBeVisible({ timeout: 12000 }); // Bravo's symbol on Alfa
        await expect(A.locator(`.feature-item[data-feature-id="${lineId}"]`)).toBeVisible({ timeout: 12000 });   // Alfa's own line
        await openLayersTab(B);
        await expect(B.locator(`.feature-item[data-feature-id="${lineId}"]`)).toBeVisible({ timeout: 12000 });   // Alfa's line on Bravo
        await expect(B.locator(`.feature-item[data-feature-id="${symbolId}"]`)).toBeVisible({ timeout: 12000 }); // Bravo's own symbol

        // Each selects the OTHER's feature (map flies to it).
        await selectFeatureById(A, symbolId); // Alfa selects Bravo's symbol
        await selectFeatureById(B, lineId);    // Bravo selects Alfa's line
    });
});

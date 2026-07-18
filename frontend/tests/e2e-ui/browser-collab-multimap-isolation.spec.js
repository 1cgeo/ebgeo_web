// Path: e2e-ui/browser-collab-multimap-isolation.spec.js

/**
 * MULTI-MAP ISOLATION — TWO real browsers + real backend. Each feature op is scoped to a
 * map; a real bug class is leakage across maps. This pins:
 *
 *   - A on map 1 and B on map 2: A's edit on map 1 does NOT appear in B's CURRENT view
 *     (map 2), yet it IS stored against map 1 (so it's there when B switches);
 *   - when B switches to map 1 it sees A's feature; switching back to map 2 it sees map 2's;
 *   - symmetric: B's edit on map 2 lands on map 2, not map 1.
 *
 * Run headed:  npx playwright test browser-collab-multimap-isolation --headed
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import {
    seedSharedAtlas,
    openClient,
    readFeatures,
    currentMapName,
    drawLineUI,
} from './helpers/collab-helpers.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

const MAP1 = 'Mapa Tático';
const MAP2 = 'Mapa Secundário';

/** Spread-out line coords so each draw is unambiguous on the canvas. */
const lineCoords = () => [[-43.2, -22.9], [-43.15, -22.85], [-43.1, -22.8]];

const hasLineCurrent = async (page, id) => (await readFeatures(page, 'lines')).some((x) => x.id === id);

/** Opens the Maps sidebar tab (idempotent) and waits for the current-map card to render. */
async function openMapsTab(page) {
    if ((await page.locator('.maps-tab #current-map-name-input').count()) === 0) {
        await page.locator('.sidebar-nav-btn[data-tab="mapas"]').click();
    }
    await expect(page.locator('.maps-tab #current-map-name-input')).toBeVisible({ timeout: 10000 });
}

/**
 * Creates a new map through the real Maps-tab UI (header "Novo mapa" → prompt → confirm).
 * createMap makes the new map the ACTIVE map on the creating client (same as the real
 * product behaviour), so callers that must stay on another map switch back explicitly.
 */
async function createMapUI(page, name) {
    await openMapsTab(page);
    await page.locator('[data-testid="maps-new-map"]').click();
    const input = page.locator('.prompt-modal-input');
    await expect(input).toBeVisible({ timeout: 5000 });
    await input.fill(name);
    await page.locator('.prompt-modal-btn-confirm').click();
    await expect(input).toBeHidden({ timeout: 5000 });
    await expect(page.locator(`.maps-tab .map-list-item[data-map-name="${name}"]`)).toBeVisible({ timeout: 5000 });
}

/** Switches the active map by clicking its card in the real Maps-tab list. */
async function switchMapUI(page, name) {
    await openMapsTab(page);
    const card = page.locator(`.maps-tab .map-list-item[data-map-name="${name}"]`);
    await expect(card).toBeVisible({ timeout: 10000 });
    await card.click();
    await expect.poll(async () => currentMapName(page), { timeout: 10000 }).toBe(name);
}

/** Reads a specific map's stored line ids directly from the repo (independent of current view). */
const repoMapHasLine = (page, mapName, id) => page.evaluate(async ({ mn, i }) => {
    const { getRepository } = await import('/src/js/store/repositories/index.js');
    const m = await getRepository().getMap(mn);
    return ((m && m.features && m.features.lines) || []).some((l) => l.properties?.id === i);
}, { mn: mapName, i: id });

describeOrSkip('Multi-map isolation cross-client', () => {
    test('edits are scoped to their map; switching maps shows the right state', async ({ browser }) => {
        const seed = await seedSharedAtlas(browser, state.baseUrl, { mapName: MAP1 });
        const A = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA);
        const B = await openClient(browser, state.baseUrl, seed.atlasId, seed.userB);
        try {
            // A creates the second map through the real Maps-tab UI. createMap makes MAP2 the
            // active map on A, so A switches BACK to MAP1 (also via the real Maps-tab card)
            // to restore the test's premise (A authoring on MAP1 while B views MAP2).
            await createMapUI(A, MAP2);
            await switchMapUI(A, MAP1);

            // Wait until B's repo knows MAP2, then B switches to it via the real Maps-tab card.
            await expect
                .poll(async () => B.evaluate(async () => {
                    const { getRepository } = await import('/src/js/store/repositories/index.js');
                    const all = await getRepository().getAllMaps();
                    return Array.from(all instanceof Map ? all.values() : Object.values(all || {})).map((m) => m && m.name);
                }), { timeout: 20000 })
                .toContain(MAP2);
            await switchMapUI(B, MAP2);
            expect(await currentMapName(B)).toBe(MAP2);
            expect(await currentMapName(A)).toBe(MAP1);

            // A (on MAP1) DRAWS a line through the real tool. B is viewing MAP2.
            const onMap1 = await drawLineUI(A, lineCoords());

            // It must be stored against MAP1 on B's repo (synced), but NOT in B's CURRENT view (MAP2).
            await expect.poll(async () => repoMapHasLine(B, MAP1, onMap1), { timeout: 20000 }).toBe(true);
            expect(await hasLineCurrent(B, onMap1), 'MAP1 edit does not leak into B\'s MAP2 view').toBe(false);
            await expect.poll(async () => repoMapHasLine(B, MAP2, onMap1), { timeout: 5000 }).toBe(false);

            // B switches to MAP1 (real Maps-tab card) → now it sees A's feature.
            await switchMapUI(B, MAP1);
            await expect.poll(async () => hasLineCurrent(B, onMap1), { timeout: 10000 }).toBe(true);

            // Symmetric: B (now on MAP1) DRAWS; A sees it on MAP1; it is NOT on MAP2.
            const onMap1ByB = await drawLineUI(B, lineCoords());
            await expect.poll(async () => hasLineCurrent(A, onMap1ByB), { timeout: 20000 }).toBe(true);
            expect(await repoMapHasLine(A, MAP2, onMap1ByB), 'B\'s MAP1 edit is not on MAP2').toBe(false);
        } finally {
            await A.context().close();
            await B.context().close();
        }
    });
});

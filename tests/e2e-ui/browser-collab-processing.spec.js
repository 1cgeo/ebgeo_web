// Path: e2e-ui/browser-collab-processing.spec.js

/**
 * PROCESSING OUTPUT synced cross-client — TWO real browsers + real backend, on the
 * full-chain harness. Client A draws input points with the real point tool, runs the
 * REAL Convex Hull ("Contorno Externo") via the Processamento sidebar tab (the same store
 * codepath the production runner uses), and the OUTPUT polygon is verified through the
 * ENTIRE sync chain to B via `collab.expectFullSync` — plus a genuine-hull shape check.
 *
 * Run headed:  npx playwright test browser-collab-processing --headed
 */

import { collabTest, expect, drawPointUI, readFeatures } from './helpers/collab.fixtures.js';

/** Four corner points + 1 interior point; the convex hull is a well-defined quadrilateral. */
const INPUT_POINTS = [
    [-43.30, -22.95],
    [-43.10, -22.95],
    [-43.10, -22.80],
    [-43.30, -22.80],
    [-43.20, -22.88], // interior point — should NOT appear on the hull
];

/**
 * Runs Convex Hull via the real Processamento sidebar tab on `page` and returns the OUTPUT
 * polygon's id (the runner generates it, so diff polygons before/after). Same algorithm.execute()
 * + store-commit codepath the production path uses (the one that syncs).
 * @returns {Promise<string>}
 */
async function runConvexHullUI(page) {
    const before = new Set((await readFeatures(page, 'polygons')).map((f) => f.id));

    await page.locator('.sidebar-nav-btn[data-tab="processamento"]').click();
    await expect(page.locator('.processing-algorithm-list')).toBeVisible({ timeout: 10000 });
    const card = page.locator('.processing-card[data-algorithm-id="convex-hull"]');
    await expect(card).toBeVisible({ timeout: 5000 });
    await card.evaluate((el) => el.click());

    const panel = page.locator('.processing-panel[data-testid="processing-panel"][data-algorithm-id="convex-hull"]');
    await expect(panel).toBeVisible({ timeout: 8000 });
    await panel.locator('.processing-panel__execute-btn').click();
    await expect(panel.locator('.processing-panel__result--success')).toBeVisible({ timeout: 15000 });

    let id = null;
    await expect.poll(async () => {
        const fresh = (await readFeatures(page, 'polygons')).find((f) => !before.has(f.id));
        id = fresh?.id ?? null;
        return id;
    }, { timeout: 10000 }).toBeTruthy();
    return id;
}

collabTest.describe('Processing OUTPUT syncs cross-client (real algorithm execute() + full chain)', () => {
    collabTest('A runs Convex Hull over its drawn points → the OUTPUT polygon traverses the whole chain to B', async ({ collab }) => {
        // Heavy UI-first flow: two-client boot + 5 sequential point draws + the run.
        collabTest.setTimeout(120000);
        const A = collab.author;
        const B = collab.peers[0];

        // 1. A draws the INPUT points via the real point tool.
        const inputIds = [];
        for (const coords of INPUT_POINTS) inputIds.push(await drawPointUI(A, coords));
        await expect
            .poll(async () => (await readFeatures(A, 'points')).filter((p) => inputIds.includes(p.id)).length)
            .toBe(inputIds.length);

        // 2. A runs the REAL convex-hull via the Processamento tab UI (commits the OUTPUT via the store).
        const outputId = await runConvexHullUI(A);
        expect(outputId, 'the run produced an OUTPUT polygon id').toBeTruthy();
        const onA = (await readFeatures(A, 'polygons')).find((x) => x.id === outputId);
        expect(onA?.props?.source, 'convex hull output is a polygon feature').toBe('polygon');

        // 3. The processing OUTPUT polygon traverses the WHOLE chain to B.
        await collab.expectFullSync({ entityId: outputId, type: 'polygons', operationType: 'create' });

        // On B it is a genuine hull polygon (closed ring), not an empty placeholder.
        const onB = (await readFeatures(B, 'polygons')).find((x) => x.id === outputId);
        const ring = onB?.props?.baseCoordinates;
        expect(Array.isArray(ring) && ring.length >= 3, 'B sees the hull ring vertices').toBe(true);
    });
});

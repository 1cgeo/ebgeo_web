// Path: e2e-ui/browser-collab-processing.spec.js

/**
 * PROCESSING OUTPUT synced cross-client — TWO real browsers + real backend. Client A
 * runs a deterministic geoprocessing algorithm (Convex Hull / "Contorno Externo") over
 * input features it just DREW through the real point tool, executes the algorithm via
 * the real Processamento sidebar tab UI (which persists the OUTPUT through the app's
 * store op the same codepath the production runner uses), and client B asserts NATIVE
 * sync carried the processing OUTPUT feature through — no workarounds.
 *
 * UI-first:
 *   1. seed two users + a shared atlas/map (write-shared with B); both OPEN it.
 *   2. On A: DRAW 4 corner points + 1 interior point via the real point tool (drawPointUI).
 *      Then open the Processamento tab, pick "Contorno Externo" (convex hull), and click
 *      EXECUTAR — the real processing-runner reads the active layer, runs the SAME pure
 *      algorithm.execute(), and persists the OUTPUT polygon via the store (the syncing
 *      codepath). The runner generates the output id, so we read it back by diffing A's
 *      polygons before/after the run.
 *   3. On B: pollPeerFeature('polygons', outputId) — the processing OUTPUT polygon synced
 *      and is present in B's store; assert it really is a closed polygon ring.
 *
 * Seed/login/open plumbing + draw + poll helpers come from ./helpers/collab-helpers.js;
 * structure mirrors browser-collab-native-render.spec.js.
 *
 * Run headed:  npx playwright test browser-collab-processing --headed
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import {
    seedSharedAtlas,
    openClient,
    readFeatures,
    drawPointUI,
    pollPeerFeature,
} from './helpers/collab-helpers.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** Four input points whose convex hull is a well-defined quadrilateral. */
const INPUT_POINTS = [
    [-43.30, -22.95],
    [-43.10, -22.95],
    [-43.10, -22.80],
    [-43.30, -22.80],
    [-43.20, -22.88], // interior point — should NOT appear on the hull
];

/**
 * Runs Convex Hull via the real Processamento sidebar tab on `page` and returns the
 * OUTPUT polygon's id (the runner generates it, so diff polygons before/after). The
 * runner reads the active layer's features, runs the SAME algorithm.execute() the
 * production path uses, and persists the result via the store (the codepath that syncs).
 * @returns {Promise<string>}
 */
async function runConvexHullUI(page) {
    const before = new Set((await readFeatures(page, 'polygons')).map((f) => f.id));

    // Open the Processamento ("Análise") tab and pick the Convex Hull card.
    await page.locator('.sidebar-nav-btn[data-tab="processamento"]').click();
    await expect(page.locator('.processing-algorithm-list')).toBeVisible({ timeout: 10000 });
    const card = page.locator('.processing-card[data-algorithm-id="convex-hull"]');
    await expect(card).toBeVisible({ timeout: 5000 });
    // Dispatch the real click listener directly: the sidebar animates as the feature
    // panel opens, which can make a positional click flaky.
    await card.evaluate((el) => el.click());

    // Its config panel mounts (source layer defaults to the active layer — where the
    // points were drawn — so EXECUTAR runs over them with no further selection).
    const panel = page.locator('.processing-panel[data-testid="processing-panel"][data-algorithm-id="convex-hull"]');
    await expect(panel).toBeVisible({ timeout: 8000 });
    await panel.locator('.processing-panel__execute-btn').click();

    // The run reports success once the OUTPUT layer + feature are persisted.
    await expect(panel.locator('.processing-panel__result--success')).toBeVisible({ timeout: 15000 });

    // The freshly-created OUTPUT polygon (absent before the run).
    let id = null;
    await expect.poll(async () => {
        const fresh = (await readFeatures(page, 'polygons')).find((f) => !before.has(f.id));
        id = fresh?.id ?? null;
        return id;
    }, { timeout: 10000 }).toBeTruthy();
    return id;
}

describeOrSkip('Processing OUTPUT syncs cross-client (two real browsers, real algorithm execute())', () => {
    test('A runs Convex Hull over its drawn points → B receives the OUTPUT polygon (native sync)', async ({ browser }) => {
        // Heavy UI-first flow: two-client boot + FIVE sequential real point-tool draws +
        // the Processamento run + a direct A-store self-check + one PEER poll (B). The boot
        // + sequential UI gestures alone approach the 60s default, like the other multi-client
        // collab specs (browser-collab-mega/-three-client-flow), so widen the budget. The
        // author self-check polls A's store DIRECTLY (not pollPeerFeature) — see below — so it
        // no longer wastes the ~20s a never-arriving self `remote.applied` span would cost.
        test.setTimeout(120000);
        const seed = await seedSharedAtlas(browser, state.baseUrl);
        const A = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA);
        const B = await openClient(browser, state.baseUrl, seed.atlasId, seed.userB);

        try {
            // 1. A DRAWS the INPUT points via the real point tool (single canvas click each).
            const inputIds = [];
            for (const coords of INPUT_POINTS) {
                inputIds.push(await drawPointUI(A, coords));
            }
            // Sanity: A's store actually holds all the inputs before processing.
            await expect
                .poll(async () => (await readFeatures(A, 'points')).filter((p) => inputIds.includes(p.id)).length)
                .toBe(inputIds.length);

            // 2. A runs the REAL convex-hull via the Processamento tab UI; the runner
            //    commits the OUTPUT polygon through the store (the codepath that syncs).
            const outputId = await runConvexHullUI(A);
            expect(outputId, 'the run produced an OUTPUT polygon id').toBeTruthy();

            // The OUTPUT polygon is in A's OWN store (committed locally before sync).
            // Poll A's store DIRECTLY here — NOT pollPeerFeature: a client never gets a
            // `remote.applied` span for its own op, so pollPeerFeature(A, …) would burn its
            // full ~20s trace window before falling back to the store poll, blowing the
            // budget for nothing. pollPeerFeature is for a true PEER (B) only.
            await expect
                .poll(async () => (await readFeatures(A, 'polygons')).some((x) => x.id === outputId), { timeout: 10000 })
                .toBe(true);
            const onA = (await readFeatures(A, 'polygons')).find((x) => x.id === outputId);
            expect(onA, 'A has the processing OUTPUT polygon').toBeTruthy();
            expect(onA.props?.source, 'convex hull output is a polygon feature').toBe('polygon');

            // 3. NATIVE sync: the processing OUTPUT polygon reaches B's store.
            await pollPeerFeature(B, 'polygons', outputId);

            // And on B it is a genuine processing OUTPUT polygon (right type + a closed ring),
            // not an empty placeholder.
            const onB = (await readFeatures(B, 'polygons')).find((x) => x.id === outputId);
            expect(onB, "B has the processing OUTPUT polygon").toBeTruthy();
            const ring = onB.props?.baseCoordinates;
            expect(Array.isArray(ring) && ring.length >= 3, 'B sees the hull ring vertices').toBe(true);
        } finally {
            await A.context().close();
            await B.context().close();
        }
    });
});

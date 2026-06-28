// Path: e2e-ui/browser-collab-permissions.spec.js

/**
 * PERMISSIONS — dynamic share control across TWO real browsers + real backend. The
 * permission gate was a real bug (the atlas role was ignored on connect), so the
 * DYNAMICS deserve a faithful end-to-end guard:
 *
 *   1. read-only peer: B (read) CANNOT write (guardWrite blocks locally; the owner never
 *      sees the attempt), yet B DOES see the owner's writes.
 *   2. upgrade: the owner promotes B read→write; after B reconnects it CAN edit and the
 *      owner sees it.
 *   3. revoke: the owner removes B's share; B then loses access to the atlas (HTTP denied).
 *
 * Sharing is a backend route (no UI); the seed + setSharePermission drive it via the API.
 *
 * Run headed:  npx playwright test browser-collab-permissions --headed
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import {
    seedSharedAtlas,
    openClient,
    readFeatures,
    pollPeerFeature,
    setSharePermission,
    drawLineUI,
    attemptStoreWriteBlocked,
} from './helpers/collab-helpers.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

const hasLine = async (page, id) => (await readFeatures(page, 'lines')).some((x) => x.id === id);

/** Spread-out line coords so each draw is unambiguous on the canvas. */
const lineCoords = () => [[-43.2, -22.9], [-43.15, -22.85], [-43.1, -22.8]];

/**
 * Performs the REAL line-draw gesture (toolbar activate → vertex clicks → right-click
 * finish) WITHOUT asserting a feature was created — used to drive a read-only peer's
 * BLOCKED authoring attempt, where the write is denied locally (guardWrite) so no feature
 * appears. Mirrors the click choreography of the shared drawLineUI helper. Returns nothing;
 * the caller asserts the write was blocked. Each blocked attempt carries no known id, so
 * the caller diffs the line set before/after to prove NOTHING was created.
 */
async function attemptDrawLineBlockedUI(page, coords) {
    // A no-edit role's draw toolbar is hidden entirely in the safe view (Frente 8 / D1), so the UI
    // authoring path is gone. To keep the "no new line" assertion meaningful (not vacuous), still
    // exercise the store-level guardWrite directly with a raw addFeature — it must be blocked for a
    // no-edit role, so nothing lands and nothing propagates to the owner.
    const drawGroup = page.locator('.toolbar-group[data-group-id="draw"] .toolbar-group-btn');
    if (!(await drawGroup.isVisible().catch(() => false))) {
        await attemptStoreWriteBlocked(page, coords);
        return;
    }

    await page.evaluate((cs) => {
        const map = globalThis.__ebgeoMap;
        const lngs = cs.map((c) => c[0]); const lats = cs.map((c) => c[1]);
        map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: 100, duration: 0 });
    }, coords);
    await page.waitForTimeout(300);

    await drawGroup.click();
    const btn = page.locator('.toolbar-group[data-group-id="draw"] .toolbar-tool-btn[data-tool-id="line"]');
    await btn.click();
    // If the tool still activates (a locked map rather than the safe view), the WRITE is what gets gated.
    await page.waitForTimeout(200);

    const pts = await page.evaluate((cs) => {
        const map = globalThis.__ebgeoMap;
        const rect = map.getCanvas().getBoundingClientRect();
        return cs.map(([lng, lat]) => {
            const p = map.project([lng, lat]);
            return { x: Math.round(rect.left + p.x), y: Math.round(rect.top + p.y) };
        });
    }, coords);
    for (let i = 0; i < pts.length - 1; i++) {
        await page.mouse.click(pts[i].x, pts[i].y);
        await page.waitForTimeout(120);
    }
    await page.mouse.click(pts[pts.length - 1].x, pts[pts.length - 1].y, { button: 'right' }); // finish
    await page.keyboard.press('Escape'); // ensure the tool is dismissed afterwards
}

describeOrSkip('Permissions — dynamic share control cross-client', () => {
    test('read-only peer cannot write, but sees the owner writes', async ({ browser }) => {
        const seed = await seedSharedAtlas(browser, state.baseUrl, { permission: 'read' });
        const A = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA);
        const B = await openClient(browser, state.baseUrl, seed.atlasId, seed.userB);
        try {
            // Owner DRAWS a line through the real tool → read-only B receives it.
            const idA = await drawLineUI(A, lineCoords());
            await pollPeerFeature(B, 'lines', idA);

            // Read-only B tries to DRAW a line through the real tool → blocked on B itself
            // (guardWrite) so no feature lands locally, and nothing reaches A. We snapshot the
            // line ids before/after to prove the blocked gesture conjured nothing new.
            const beforeB = new Set((await readFeatures(B, 'lines')).map((x) => x.id));
            const beforeA = new Set((await readFeatures(A, 'lines')).map((x) => x.id));
            await attemptDrawLineBlockedUI(B, lineCoords());
            await B.waitForTimeout(4000);
            const newOnB = (await readFeatures(B, 'lines')).filter((x) => !beforeB.has(x.id));
            const newOnA = (await readFeatures(A, 'lines')).filter((x) => !beforeA.has(x.id));
            expect(newOnB, 'read-only write is blocked locally on B (no new line)').toHaveLength(0);
            expect(newOnA, 'read-only write never reached the owner (no new line)').toHaveLength(0);
        } finally {
            await A.context().close();
            await B.context().close();
        }
    });

    test('owner upgrades a read-only peer to write → after reconnect B can edit', async ({ browser }) => {
        const seed = await seedSharedAtlas(browser, state.baseUrl, { permission: 'read' });
        const A = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA);
        let B = await openClient(browser, state.baseUrl, seed.atlasId, seed.userB);
        try {
            // Read-only: B's real draw gesture is blocked → no feature lands locally.
            const beforeBlocked = new Set((await readFeatures(B, 'lines')).map((x) => x.id));
            await attemptDrawLineBlockedUI(B, lineCoords());
            await B.waitForTimeout(1500);
            const blockedNew = (await readFeatures(B, 'lines')).filter((x) => !beforeBlocked.has(x.id));
            expect(blockedNew, 'still read-only — write blocked (no new line)').toHaveLength(0);

            // Owner promotes B to write.
            const status = await setSharePermission(A, state.baseUrl, seed.userA, seed.atlasId, seed.userB.id, 'write');
            expect(status, 'PUT share permission succeeded').toBeLessThan(300);

            // B reconnects (fresh session picks up the new atlas role).
            await B.context().close();
            B = await openClient(browser, state.baseUrl, seed.atlasId, seed.userB);

            // Now B can DRAW through the real tool → the owner sees it.
            const idB = await drawLineUI(B, lineCoords());
            expect(await hasLine(B, idB), 'B can write after upgrade').toBe(true);
            await pollPeerFeature(A, 'lines', idB);
        } finally {
            await A.context().close();
            await B.context().close();
        }
    });

    test('owner revokes a peer → B loses access to the atlas (HTTP denied)', async ({ browser }) => {
        const seed = await seedSharedAtlas(browser, state.baseUrl, { permission: 'write' });
        const A = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA);
        const B = await openClient(browser, state.baseUrl, seed.atlasId, seed.userB);
        try {
            // Sanity: while shared, B can read the atlas over HTTP.
            const before = await B.evaluate(async ({ base, c, id }) => {
                const { ApiClient } = await import('/src/js/store/sync/api-client.js');
                const api = new ApiClient({ baseUrl: `${base}/api/v1` });
                await api.login(c.username, c.password);
                const res = await fetch(`${base}/api/v1/atlas/${id}`, { headers: { Authorization: `Bearer ${api.getAccessToken()}` } });
                return res.status;
            }, { base: state.baseUrl, c: seed.userB, id: seed.atlasId });
            expect(before, 'shared peer can GET the atlas').toBeLessThan(300);

            // Owner revokes B's share.
            const status = await setSharePermission(A, state.baseUrl, seed.userA, seed.atlasId, seed.userB.id, null);
            expect(status, 'DELETE share succeeded').toBeLessThan(300);

            // B is now denied at the HTTP layer (defense in depth, independent of the live WS).
            const after = await B.evaluate(async ({ base, c, id }) => {
                const { ApiClient } = await import('/src/js/store/sync/api-client.js');
                const api = new ApiClient({ baseUrl: `${base}/api/v1` });
                await api.login(c.username, c.password);
                const res = await fetch(`${base}/api/v1/atlas/${id}`, { headers: { Authorization: `Bearer ${api.getAccessToken()}` } });
                return res.status;
            }, { base: state.baseUrl, c: seed.userB, id: seed.atlasId });
            expect(after, 'revoked peer is denied').toBeGreaterThanOrEqual(400);
        } finally {
            await A.context().close();
            await B.context().close();
        }
    });
});

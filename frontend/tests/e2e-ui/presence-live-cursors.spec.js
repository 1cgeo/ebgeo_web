// Path: e2e-ui/presence-live-cursors.spec.js

/**
 * SHOWCASE: live two-way collaboration on the REAL map across TWO real browsers, driven
 * entirely through the app's OWN UI + NATIVE sync (no manual WsClient / hand-drawn layers).
 *
 * Two independent Chromium contexts log in through the real account UI and OPEN the SAME
 * shared atlas over the REAL backend collab gateway (different sessions). Then, in real time
 * and watchable headed:
 *
 *   - BOTH move their mouse over the live 2D canvas; each window renders the OTHER's
 *     labelled cursor via the REAL presence pipeline (wire → presenceStore →
 *     RemoteCursorsLayer marker → [data-testid="remote-cursor"]).
 *   - Window A draws a LINE with the real line tool; window B plants a MILITARY SYMBOL with
 *     the real military tool. Each is authored by the app, fans out over the collab
 *     WebSocket via NATIVE sync, and is rendered on the PEER's real map — so both windows end
 *     up holding the line, the NATO symbol (in the real layers tree), and the other player's
 *     cursor.
 *   - Each peer also appears in the app's real online-users roster.
 *
 * Run it headed to watch both windows mirror each other:
 *   npx playwright test presence-live-cursors --headed
 *
 * This exercises, end to end and in BOTH directions: the cursor awareness pipeline AND the
 * feature op fan-out (author → app push → WS broadcast → peer renders it on the real map),
 * all through the real UI.
 *
 * Seeds a shared atlas (owner + a write-shared second user) via the backend API (sharing is
 * a backend-only route with no UI).
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import {
    seedSharedAtlas, openClient, drawLineUI, readFeatures, pollPeerFeature,
} from './helpers/collab-helpers.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** Shared map view both windows frame, so each sees the other's activity. */
const CENTER = { lng: -43.2, lat: -22.9 };
const ZOOM = 13;

const canvasBox = (page) => page.locator('#map-sig .maplibregl-canvas').boundingBox();

/** Moves the mouse across the live canvas so the app broadcasts the local cursor (real presence). */
async function moveCursorOverCanvas(page) {
    const box = await canvasBox(page);
    for (let i = 0; i < 8; i++) {
        await page.mouse.move(box.x + box.width * (0.35 + i * 0.03), box.y + box.height * (0.40 + i * 0.02));
        await page.waitForTimeout(90); // > the presence throttle
    }
}

/**
 * Places a MILITARY SYMBOL with the real military tool: open the military group, activate the
 * symbol tool, single-click the canvas (default SIDC). Returns the new feature id.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<string>}
 */
async function drawMilitarySymbolUI(page) {
    const before = new Set((await readFeatures(page, 'military_symbols')).map((f) => f.id));
    await page.locator('.toolbar-group[data-group-id="military"] .toolbar-group-btn').click();
    await expect(page.locator('.toolbar-group[data-group-id="military"] .toolbar-popup'))
        .toHaveAttribute('data-visible', 'true', { timeout: 5000 });
    await page.locator('.toolbar-group[data-group-id="military"] .toolbar-tool-btn[data-tool-id="militarySymbol"]').click();

    const box = await canvasBox(page);
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);

    let id = null;
    await expect.poll(async () => {
        const fresh = (await readFeatures(page, 'military_symbols')).find((f) => !before.has(f.id));
        id = fresh?.id ?? null;
        return id;
    }, { timeout: 10000 }).toBeTruthy();
    return id;
}

/** Opens the layers tab (idempotent — never toggles it closed). */
async function openLayersTab(page) {
    if ((await page.locator('.layer-container').count()) === 0) {
        await page.locator('.sidebar-nav-btn[data-tab="camadas"]').click();
    }
    await expect(page.locator('.layer-container').first()).toBeVisible({ timeout: 10000 });
}

/** Expands the real online-users roster so its named rows are visible for assertions. */
async function expandRoster(page) {
    const toggle = page.locator('[data-testid="online-users"] [data-testid="online-users-toggle"]');
    await expect(toggle).toBeVisible({ timeout: 10000 });
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
        await toggle.click();
    }
}

describeOrSkip('Live two-way collaboration on the real map (two real browsers + real backend)', () => {
    test('cursors, a line from A and a military symbol from B all appear on BOTH live maps', async ({ browser }) => {
        // 1. Seed a shared atlas (owner A + write-shared B) via the backend API (no sharing UI).
        const seed = await seedSharedAtlas(browser, state.baseUrl);

        // 2. Two real app windows log in and OPEN the shared atlas (app auto-activates its map).
        const pageA = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA);
        const pageB = await openClient(browser, state.baseUrl, seed.atlasId, seed.userB);

        try {
            // 3. Both windows JUMP TO THE SAME PLACE so each sees the other's activity.
            for (const page of [pageA, pageB]) {
                await page.evaluate(({ c, z }) => globalThis.__ebgeoMap.jumpTo({ center: [c.lng, c.lat], zoom: z }), { c: CENTER, z: ZOOM });
            }

            // 4. Each moves its mouse → the OTHER window renders the remote cursor (with its
            //    name label) through the REAL presence pipeline (native, both directions).
            await moveCursorOverCanvas(pageA);
            await expect(pageB.locator('[data-testid="remote-cursor"]')).toHaveCount(1, { timeout: 8000 });
            await expect(pageB.locator('[data-testid="remote-cursor"] .remote-cursor__label')).not.toBeEmpty();
            await moveCursorOverCanvas(pageB);
            await expect(pageA.locator('[data-testid="remote-cursor"]')).toHaveCount(1, { timeout: 8000 });
            await expect(pageA.locator('[data-testid="remote-cursor"] .remote-cursor__label')).not.toBeEmpty();

            // 5. A draws a LINE with the real line tool; B plants a MILITARY SYMBOL with the real
            //    military tool. Each is authored by the app and fans out over the WS via NATIVE sync.
            const lineId = await drawLineUI(pageA, [
                [CENTER.lng - 0.012, CENTER.lat - 0.006],
                [CENTER.lng + 0.004, CENTER.lat + 0.009],
                [CENTER.lng + 0.013, CENTER.lat - 0.002],
            ]);
            expect(lineId, "A's line was created by the line tool").toBeTruthy();
            const symbolId = await drawMilitarySymbolUI(pageB);
            expect(symbolId, "B's symbol was created by the military tool").toBeTruthy();

            // 6. NATIVE sync carries each feature to the PEER's store (the cross-client render path).
            //
            // Deliberately still `pollPeerFeature` and not the full-chain `expectFullSync`: here
            // feature arrival is a PRECONDITION for step 7, not this spec's claim (the subject is
            // presence — cursors and roster). `pollPeerFeature` is itself SyncLedger-gated (it
            // waits on `remote.applied` before polling the store), so the wait is already
            // deterministic; migrating would only add Postgres/IndexedDB ground truth to a setup
            // step that other specs already prove end to end.
            await pollPeerFeature(pageB, 'lines', lineId);
            await pollPeerFeature(pageA, 'military_symbols', symbolId);

            // 7. Assert BOTH windows end up showing: the other player's cursor, the line, the
            //    military symbol (each in the real layers tree), and the peer in the real roster.
            await openLayersTab(pageA);
            await expect(pageA.locator(`.feature-item[data-feature-id="${lineId}"]`)).toBeVisible({ timeout: 12000 });   // A's own line
            await expect(pageA.locator(`.feature-item[data-feature-id="${symbolId}"]`)).toBeVisible({ timeout: 12000 }); // B's symbol on A
            await openLayersTab(pageB);
            await expect(pageB.locator(`.feature-item[data-feature-id="${lineId}"]`)).toBeVisible({ timeout: 12000 });   // A's line on B
            await expect(pageB.locator(`.feature-item[data-feature-id="${symbolId}"]`)).toBeVisible({ timeout: 12000 }); // B's own symbol

            // The line is rendered on BOTH real maps (the live MapLibre source carries it cross-client).
            for (const page of [pageA, pageB]) {
                const hasLine = await page.evaluate(async (id) => {
                    const src = globalThis.__ebgeoMap.getSource('lines');
                    if (!src || typeof src.getData !== 'function') return false;
                    const data = await src.getData();
                    return !!data && (data.features || []).some((f) => f.properties?.id === id);
                }, lineId);
                expect(hasLine, 'the line is on the live source').toBe(true);
                await expandRoster(page);
                await expect(page.locator('[data-testid="online-users"] [data-testid="online-user-item"]'))
                    .toHaveCount(1, { timeout: 8000 }); // the peer (self is excluded from the roster)
            }
        } finally {
            await pageA.context().close();
            await pageB.context().close();
        }
    });
});

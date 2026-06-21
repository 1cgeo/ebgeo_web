// Path: e2e-ui/browser-collab-shared-atlas.spec.js

/**
 * FAITHFUL 9-step collaboration flow on a SHARED atlas — TWO real browsers, real
 * backend, driving the app's OWN UI + NATIVE sync, with NO workarounds. This is the
 * harness that surfaced bugs b/c/d/e/f/g (now fixed); it must pass end to end purely
 * through the app's real behaviour.
 *
 * Steps (as requested):
 *   1. Two browsers.
 *   2. Each logs in (real account UI).
 *   3. One user creates an atlas and shares it with the second; both OPEN it.
 *      (Sharing has NO UI in the app — it is a backend-only route — so the atlas/map/
 *      share SETUP is done via the API. Opening + everything below is real UI.)
 *   4. Both zoom to the same place.
 *   5. Each moves its mouse; the cursor shows on the OTHER user's screen (native presence).
 *   6. Each creates a feature with the REAL tools (Alfa a line, Bravo a military symbol).
 *   7+8. The feature shows in the OTHER user's layers tab (native sync renders it live).
 *   9. Each selects the OTHER's feature (the map flies to it).
 *
 * No grantEditRole / clearQueue / setCurrentMap / base-layer-switch crutches: the
 * app now activates the atlas map on open (b), reflects the atlas role (c), keeps the
 * sync queue clean (d), renders remote features live (e), dedupes (f) and shows only
 * other users' cursors (g).
 *
 * Run headed:  npx playwright test browser-collab-shared-atlas --headed
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

const SHARED_MAP = 'Mapa Tático';
const CENTER = { lng: -43.2, lat: -22.9 };
const ZOOM = 13;

/** Logs in through the real account UI and waits for the project-picker. */
async function loginUI(page, username, password) {
    await expect(page.locator('[data-testid="account-control"]')).toBeAttached({ timeout: 20000 });
    await page.locator('[data-testid="account-login-btn"]').click();
    await expect(page.locator('[data-testid="login-modal"]')).toBeVisible({ timeout: 5000 });
    await page.locator('[data-testid="login-username"]').fill(username);
    await page.locator('[data-testid="login-password"]').fill(password);
    await page.locator('[data-testid="login-submit"]').click();
    await expect(page.locator('[data-testid="project-picker-modal"]')).toBeVisible({ timeout: 10000 });
}

/** Picks an atlas by id; waits for online sync + the live map. */
async function openAtlasUI(page, atlasId) {
    await page.locator(`[data-testid="project-picker-item"][data-atlas-id="${atlasId}"]`).click();
    await expect(page.locator('[data-testid="sync-status-badge"]')).toHaveAttribute('data-state', 'online', { timeout: 20000 });
    await page.waitForFunction(
        () => globalThis.__ebgeoMap && typeof globalThis.__ebgeoMap.getZoom === 'function' && globalThis.__ebgeoMap.loaded(),
        { timeout: 20000 },
    );
}

const currentMapName = (page) =>
    page.evaluate(async () => (await import('/src/js/store/index.js')).getCurrentMapNameSync());

/** Reads the current map's line + military-symbol features from the app store. */
const readFeatures = (page) =>
    page.evaluate(async () => {
        const store = await import('/src/js/store/index.js');
        const f = await store.getCurrentMapFeatures();
        const pick = (arr) => (Array.isArray(arr) ? arr : []).map((x) => ({ id: x.properties?.id, nome: x.properties?.nome }));
        return { lines: pick(f.lines), military: pick(f.military_symbols) };
    });

const canvasBox = (page) => page.locator('.maplibregl-canvas').boundingBox();

/** Moves the mouse across the live canvas so the app broadcasts the local cursor. */
async function moveCursorOverCanvas(page) {
    const box = await canvasBox(page);
    for (let i = 0; i < 8; i++) {
        await page.mouse.move(box.x + box.width * (0.35 + i * 0.03), box.y + box.height * (0.40 + i * 0.02));
        await page.waitForTimeout(90); // > the 80ms presence throttle
    }
}

/** Draws a LINE with the real line tool: activate → click, click, right-click to commit. */
async function drawLine(page) {
    await page.locator('.toolbar-group[data-group-id="draw"] .toolbar-group-btn').click();
    await expect(page.locator('.toolbar-group[data-group-id="draw"] .toolbar-popup')).toHaveAttribute('data-visible', 'true', { timeout: 5000 });
    await page.locator('.toolbar-group[data-group-id="draw"] .toolbar-tool-btn[data-tool-id="line"]').click();
    await expect(page.locator('.toolbar-group[data-group-id="draw"] .toolbar-group-btn')).toHaveAttribute('data-active', 'true', { timeout: 5000 });

    const box = await canvasBox(page);
    await page.mouse.click(box.x + box.width * 0.40, box.y + box.height * 0.45);
    await page.waitForTimeout(150);
    await page.mouse.click(box.x + box.width * 0.58, box.y + box.height * 0.52);
    await page.waitForTimeout(150);
    await page.mouse.click(box.x + box.width * 0.50, box.y + box.height * 0.64, { button: 'right' }); // commit
    await page.waitForTimeout(400);
}

/** Places a MILITARY SYMBOL with the real tool: activate → single click (default SIDC). */
async function drawMilitarySymbol(page) {
    await page.locator('.toolbar-group[data-group-id="military"] .toolbar-group-btn').click();
    await expect(page.locator('.toolbar-group[data-group-id="military"] .toolbar-popup')).toHaveAttribute('data-visible', 'true', { timeout: 5000 });
    await page.locator('.toolbar-group[data-group-id="military"] .toolbar-tool-btn[data-tool-id="militarySymbol"]').click();

    const box = await canvasBox(page);
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await page.waitForTimeout(400);
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
    await row.evaluate((el) => el.click()); // raw DOM click — actionability can hang on overlapped rows
    await expect.poll(() => page.evaluate(() => globalThis.__ebgeoMap.getZoom()), { timeout: 8000 }).toBeGreaterThan(before + 3);
}

describeOrSkip('Faithful 9-step shared-atlas collaboration (two real browsers, no workarounds)', () => {
    test('login → share+open → same view → cursors → draw → see in layers → select, both ways', async ({ browser }) => {
        // STEP 1+3a. SETUP via API: Alfa owns atlas + map, shares write with Bravo (no sharing UI).
        const seedPage = await browser.newPage();
        await seedPage.goto('/');
        const seed = await seedPage.evaluate(async ({ base, mapName }) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');
            const password = 'Sup3r-Secret-Pw!';
            const mk = (n) => `${n}_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;

            const apiA = new ApiClient({ baseUrl: `${base}/api/v1` });
            const userA = { username: mk('alfa'), password, nome: 'Alfa' };
            await apiA.register({ ...userA });
            await apiA.login(userA.username, userA.password);

            const apiB = new ApiClient({ baseUrl: `${base}/api/v1` });
            const userB = { username: mk('bravo'), password, nome: 'Bravo' };
            const b = await apiB.register({ ...userB });

            const atlas = await apiA.createAtlas({ name: 'Atlas Tático Compartilhado' });
            const mapId = crypto.randomUUID();
            await apiA.pushOperations(atlas.id, [createOperation('map', 'create', mapId, null, { name: mapName })]);
            await fetch(`${base}/api/v1/atlas/${atlas.id}/sharing/users`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiA.getAccessToken()}` },
                body: JSON.stringify({ userId: b && (b.id || b.user?.id), permission: 'write' }),
            });
            return { userA, userB, atlasId: atlas.id };
        }, { base: state.baseUrl, mapName: SHARED_MAP });
        await seedPage.close();

        // STEP 1. Two browsers.
        const ctxA = await browser.newContext();
        const pageA = await ctxA.newPage();
        const ctxB = await browser.newContext();
        const pageB = await ctxB.newPage();
        for (const page of [pageA, pageB]) {
            await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);
            await page.goto('/');
        }

        // STEP 2+3b+4. Both LOG IN and OPEN the shared atlas (the app auto-activates the atlas map).
        await loginUI(pageA, seed.userA.username, seed.userA.password);
        await openAtlasUI(pageA, seed.atlasId);
        await loginUI(pageB, seed.userB.username, seed.userB.password);
        await openAtlasUI(pageB, seed.atlasId);

        // STEP 3 check (bug b): both landed on the ATLAS map, not the local "Principal".
        expect(await currentMapName(pageA)).toBe(SHARED_MAP);
        expect(await currentMapName(pageB)).toBe(SHARED_MAP);

        // STEP 4. Both zoom to the SAME place.
        for (const page of [pageA, pageB]) {
            await page.evaluate(({ c, z }) => globalThis.__ebgeoMap.jumpTo({ center: [c.lng, c.lat], zoom: z }), { c: CENTER, z: ZOOM });
        }

        // STEP 5. Each moves its mouse → the OTHER sees the remote cursor (native presence, bug g).
        await moveCursorOverCanvas(pageA);
        await expect(pageB.locator('[data-testid="remote-cursor"]')).toHaveCount(1, { timeout: 8000 });
        await moveCursorOverCanvas(pageB);
        await expect(pageA.locator('[data-testid="remote-cursor"]')).toHaveCount(1, { timeout: 8000 });

        // STEP 6. Each creates a feature with the REAL tools (bug c → editing works).
        await drawLine(pageA);
        await drawMilitarySymbol(pageB);

        const lineId = (await readFeatures(pageA)).lines.at(-1)?.id;
        const symbolId = (await readFeatures(pageB)).military.at(-1)?.id;
        expect(lineId, 'Alfa\'s line was created by the line tool').toBeTruthy();
        expect(symbolId, 'Bravo\'s symbol was created by the military tool').toBeTruthy();

        // STEP 7. NATIVE sync (bug d → flush works): each feature reaches the PEER's store.
        await expect.poll(async () => (await readFeatures(pageB)).lines.some((l) => l.id === lineId), { timeout: 20000 }).toBe(true);
        await expect.poll(async () => (await readFeatures(pageA)).military.some((m) => m.id === symbolId), { timeout: 20000 }).toBe(true);

        // STEP 8. The OTHER's feature shows in each user's layers tab (bug e → live render).
        await openLayersTab(pageA);
        await expect(pageA.locator(`.feature-item[data-feature-id="${symbolId}"]`)).toBeVisible({ timeout: 12000 }); // Bravo's symbol on Alfa
        await expect(pageA.locator(`.feature-item[data-feature-id="${lineId}"]`)).toBeVisible({ timeout: 12000 });   // Alfa's own line
        await openLayersTab(pageB);
        await expect(pageB.locator(`.feature-item[data-feature-id="${lineId}"]`)).toBeVisible({ timeout: 12000 });   // Alfa's line on Bravo
        await expect(pageB.locator(`.feature-item[data-feature-id="${symbolId}"]`)).toBeVisible({ timeout: 12000 }); // Bravo's own symbol

        // STEP 9. Each selects the OTHER's feature (map flies to it).
        await selectFeatureById(pageA, symbolId); // Alfa selects Bravo's symbol
        await selectFeatureById(pageB, lineId);    // Bravo selects Alfa's line

        await ctxA.close();
        await ctxB.close();
    });
});

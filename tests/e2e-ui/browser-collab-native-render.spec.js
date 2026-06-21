// Path: e2e-ui/browser-collab-native-render.spec.js

/**
 * NATIVE remote-render assertion — TWO real browsers, real backend, no workarounds.
 *
 * The existing two-client/broadcast tests prove a peer's op reaches the receiver's
 * raw WS frame and the backend snapshot. That is NOT the same as the app actually
 * RENDERING the peer's feature: a render/dedup bug can leave the frame intact while
 * the receiver's map SOURCE or layers TREE never updates, or shows the feature
 * TWICE (the author-echo duplicate). This spec closes that verification gap.
 *
 * It seeds two users + a shared atlas + map via the API (sharing has no UI), opens
 * the atlas in two real browsers (the app auto-activates the atlas map), then on
 * client A creates a feature through the app's OWN store op `addFeature('lines', f)`
 * with a KNOWN uuid — the same path the real line tool uses. On client B it asserts,
 * with NO base-layer/map-switch crutch, that the app NATIVELY:
 *   1. put the feature into B's map SOURCE (`__ebgeoMap.getSource('lines').getData()`);
 *   2. shows it in B's layers TREE (`.feature-item[data-feature-id]` visible);
 *   3. has EXACTLY ONE copy in B's source AND store (no author-echo duplicate),
 *      and stays deduped after the broadcast has had time to settle.
 *
 * If the native source/tree does NOT update live, that is a REAL render/sync bug —
 * this spec is meant to FAIL on it, not to paper over it.
 *
 * Run headed:  npx playwright test browser-collab-native-render --headed
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

/** Opens the layers tab (idempotent — never toggles it closed). */
async function openLayersTab(page) {
    if ((await page.locator('.layer-container').count()) === 0) {
        await page.locator('.sidebar-nav-btn[data-tab="camadas"]').click();
    }
    await expect(page.locator('.layer-container').first()).toBeVisible({ timeout: 10000 });
}

/**
 * Builds a LineString feature shaped exactly like the real line tool produces
 * (AddLineControl.DEFAULT_PROPERTIES + the runtime fields), carrying a KNOWN id so
 * the receiver can be polled for that exact feature.
 */
function makeLineFeature(id, coordinates) {
    return {
        type: 'Feature',
        properties: {
            id,
            source: 'line',
            layerId: 'default',
            nome: `Linha ${id.slice(0, 6)}`,
            lineColor: '#3f4fb5',
            lineWidth: 5,
            opacity: 0.7,
            lineStyle: 'solid',
            measure: false,
            profile: false,
            profileData: null,
            descricao: '',
            visivel: true,
            bloqueado: false,
            observations: [],
            baseCoordinates: coordinates,
        },
        geometry: { type: 'LineString', coordinates },
    };
}

/**
 * Counts, on `page`, how many features with `id` live in the map SOURCE `sourceName`
 * AND how many in the store's current-map `storeType` array. Returns both so the
 * caller can assert presence (>=1) or exact dedup (===1).
 */
function countFeature(page, { sourceName, storeType, id }) {
    return page.evaluate(async ({ sourceName, storeType, id }) => {
        const s = await import('/src/js/store/index.js');
        const map = globalThis.__ebgeoMap;
        const src = map && map.getSource(sourceName);
        let inSource = 0;
        if (src && typeof src.getData === 'function') {
            const data = await src.getData();
            const feats = (data && data.features) || [];
            inSource = feats.filter((f) => f && f.properties && f.properties.id === id).length;
        }
        const f = await s.getCurrentMapFeatures();
        const arr = (f && f[storeType]) || [];
        const inStore = arr.filter((x) => x && x.properties && x.properties.id === id).length;
        return { inSource, inStore };
    }, { sourceName, storeType, id });
}

describeOrSkip('Peer feature renders NATIVELY on the receiver — map source + layers tree, no duplicate', () => {
    test('A creates a line via the real store op; B renders it in its source + tree exactly once', async ({ browser }) => {
        // SETUP via API: Alfa owns atlas + map, shares write with Bravo (no sharing UI).
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

            const atlas = await apiA.createAtlas({ name: 'Atlas Native Render' });
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

        // Two browsers, each pointed at the spawned backend.
        const ctxA = await browser.newContext();
        const pageA = await ctxA.newPage();
        const ctxB = await browser.newContext();
        const pageB = await ctxB.newPage();
        for (const page of [pageA, pageB]) {
            await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);
            await page.goto('/');
        }

        // Both LOG IN and OPEN the shared atlas (the app auto-activates the atlas map).
        await loginUI(pageA, seed.userA.username, seed.userA.password);
        await openAtlasUI(pageA, seed.atlasId);
        await loginUI(pageB, seed.userB.username, seed.userB.password);
        await openAtlasUI(pageB, seed.atlasId);

        // Both landed on the ATLAS map (not the local "Principal"), so they share state.
        expect(await currentMapName(pageA)).toBe(SHARED_MAP);
        expect(await currentMapName(pageB)).toBe(SHARED_MAP);

        // Same view, so the rendered feature is in-frame on both (cosmetic but realistic).
        for (const page of [pageA, pageB]) {
            await page.evaluate(({ c, z }) => globalThis.__ebgeoMap.jumpTo({ center: [c.lng, c.lat], zoom: z }), { c: CENTER, z: ZOOM });
        }

        // CLIENT A: create a line through the app's REAL store op, with a KNOWN uuid.
        const lineId = crypto.randomUUID();
        const lineCoords = [
            [CENTER.lng - 0.02, CENTER.lat - 0.01],
            [CENTER.lng + 0.01, CENTER.lat + 0.005],
            [CENTER.lng + 0.03, CENTER.lat - 0.008],
        ];
        const lineFeature = makeLineFeature(lineId, lineCoords);

        await pageA.evaluate(async (f) => {
            const s = await import('/src/js/store/index.js');
            await s.addFeature('lines', f);
        }, lineFeature);

        // Author A itself must hold exactly one copy in its own source + store (sanity:
        // the creating client neither drops nor duplicates its own feature).
        await expect
            .poll(() => countFeature(pageA, { sourceName: 'lines', storeType: 'lines', id: lineId }), { timeout: 15000 })
            .toEqual({ inSource: 1, inStore: 1 });

        // ── ASSERTION 1: B's map SOURCE renders the peer's feature NATIVELY ──────────
        // No base-layer/map-switch workaround: poll the live MapLibre source until the
        // feature with that id appears. This fails on a render bug even when the raw WS
        // frame / backend snapshot already carry the op.
        await expect
            .poll(async () => (await countFeature(pageB, { sourceName: 'lines', storeType: 'lines', id: lineId })).inSource, { timeout: 20000 })
            .toBeGreaterThanOrEqual(1);

        // ── ASSERTION 2: B's layers TREE shows the peer's feature NATIVELY ───────────
        await openLayersTab(pageB);
        await expect(pageB.locator(`.feature-item[data-feature-id="${lineId}"]`)).toBeVisible({ timeout: 15000 });

        // ── ASSERTION 3: NO duplicate — exactly ONE in B's source AND store ──────────
        // Assert it directly, then give the broadcast/author-echo a few seconds to (not)
        // produce a second copy, and re-assert. This catches the author-echo duplicate
        // that a present-but-not-deduped feature would leave behind.
        await expect(pageB.locator(`.feature-item[data-feature-id="${lineId}"]`)).toHaveCount(1);
        expect(await countFeature(pageB, { sourceName: 'lines', storeType: 'lines', id: lineId })).toEqual({ inSource: 1, inStore: 1 });

        await pageB.waitForTimeout(3000); // let any delayed echo arrive

        expect(await countFeature(pageB, { sourceName: 'lines', storeType: 'lines', id: lineId })).toEqual({ inSource: 1, inStore: 1 });
        await expect(pageB.locator(`.feature-item[data-feature-id="${lineId}"]`)).toHaveCount(1);

        await ctxA.close();
        await ctxB.close();
    });
});

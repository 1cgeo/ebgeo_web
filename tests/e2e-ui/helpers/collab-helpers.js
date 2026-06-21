// Path: e2e-ui/helpers/collab-helpers.js

/**
 * Shared helpers for the two-browser collaboration specs. Extracted from
 * browser-collab-shared-atlas.spec.js so each operation-family spec (mutations,
 * delete, all-types, maps/layers, processing) drives the app's REAL store ops and
 * asserts NATIVE cross-client sync, without re-deriving the seed/login/open plumbing.
 *
 * The pattern every spec follows:
 *   const { atlasId, userA, userB } = await seedSharedAtlas(browser, baseUrl);
 *   const A = await openClient(browser, baseUrl, atlasId, userA);
 *   const B = await openClient(browser, baseUrl, atlasId, userB);
 *   await applyStoreOp(A, async (store) => { await store.addFeature('lines', f); });
 *   await pollPeerFeature(B, 'lines', id);   // native sync carried it to B
 */

import { expect } from '@playwright/test';

/**
 * Seeds two users + an atlas with one map "Mapa Tático", shared WRITE with user B.
 * Sharing is a backend-only route (no UI), so setup goes through the API.
 * @returns {Promise<{ atlasId: string, mapId: string, mapName: string,
 *   userA: {username,password}, userB: {username,password} }>}
 */
export async function seedSharedAtlas(browser, baseUrl, { mapName = 'Mapa Tático', permission = 'write' } = {}) {
    const seedPage = await browser.newPage();
    await seedPage.goto('/');
    const seed = await seedPage.evaluate(async ({ base, mn, perm }) => {
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
        const userBId = b && (b.id || b.user?.id);

        const atlas = await apiA.createAtlas({ name: 'Atlas Colaborativo' });
        const mapId = crypto.randomUUID();
        await apiA.pushOperations(atlas.id, [createOperation('map', 'create', mapId, null, { name: mn })]);
        await fetch(`${base}/api/v1/atlas/${atlas.id}/sharing/users`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiA.getAccessToken()}` },
            body: JSON.stringify({ userId: userBId, permission: perm }),
        });
        return { atlasId: atlas.id, mapId, mapName: mn, userA, userB: { ...userB, id: userBId } };
    }, { base: baseUrl, mn: mapName, perm: permission });
    await seedPage.close();
    return seed;
}

/**
 * Changes (PUT) or revokes (DELETE) user B's share permission, as the owner. Uses the
 * owner's own authenticated session via a fresh ApiClient. `permission` of null revokes.
 */
export async function setSharePermission(page, baseUrl, ownerCreds, atlasId, userId, permission) {
    return page.evaluate(async ({ base, c, id, uid, perm }) => {
        const { ApiClient } = await import('/src/js/store/sync/api-client.js');
        const api = new ApiClient({ baseUrl: `${base}/api/v1` });
        await api.login(c.username, c.password);
        const url = `${base}/api/v1/atlas/${id}/sharing/users/${uid}`;
        const res = perm === null
            ? await fetch(url, { method: 'DELETE', headers: { Authorization: `Bearer ${api.getAccessToken()}` } })
            : await fetch(url, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${api.getAccessToken()}` },
                body: JSON.stringify({ permission: perm }),
            });
        return res.status;
    }, { base: baseUrl, c: ownerCreds, id: atlasId, uid: userId, perm: permission });
}

/**
 * Registers a brand-new user and shares the atlas with it (as the owner), returning the
 * new user's credentials (incl. id). For multi-client (3+) scale scenarios.
 */
export async function addSharedUser(page, baseUrl, ownerCreds, atlasId, { permission = 'write', label = 'charlie' } = {}) {
    return page.evaluate(async ({ base, c, id, perm, lbl }) => {
        const { ApiClient } = await import('/src/js/store/sync/api-client.js');
        const owner = new ApiClient({ baseUrl: `${base}/api/v1` });
        await owner.login(c.username, c.password);
        const password = 'Sup3r-Secret-Pw!';
        const mk = (n) => `${n}_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
        const u = { username: mk(lbl), password, nome: lbl };
        const api = new ApiClient({ baseUrl: `${base}/api/v1` });
        const r = await api.register({ ...u });
        const uid = r && (r.id || r.user?.id);
        await fetch(`${base}/api/v1/atlas/${id}/sharing/users`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${owner.getAccessToken()}` },
            body: JSON.stringify({ userId: uid, permission: perm }),
        });
        return { ...u, id: uid };
    }, { base: baseUrl, c: ownerCreds, id: atlasId, perm: permission, lbl: label });
}

/** Logs in through the real account UI and waits for the project-picker. */
export async function loginUI(page, username, password) {
    await expect(page.locator('[data-testid="account-control"]')).toBeAttached({ timeout: 20000 });
    await page.locator('[data-testid="account-login-btn"]').click();
    await expect(page.locator('[data-testid="login-modal"]')).toBeVisible({ timeout: 5000 });
    await page.locator('[data-testid="login-username"]').fill(username);
    await page.locator('[data-testid="login-password"]').fill(password);
    await page.locator('[data-testid="login-submit"]').click();
    await expect(page.locator('[data-testid="project-picker-modal"]')).toBeVisible({ timeout: 10000 });
}

/** Picks the atlas by id and waits for online + the live map. */
export async function openAtlasUI(page, atlasId) {
    await page.locator(`[data-testid="project-picker-item"][data-atlas-id="${atlasId}"]`).click();
    await expect(page.locator('[data-testid="sync-status-badge"]')).toHaveAttribute('data-state', 'online', { timeout: 20000 });
    await page.waitForFunction(
        () => globalThis.__ebgeoMap && typeof globalThis.__ebgeoMap.getZoom === 'function' && globalThis.__ebgeoMap.loaded(),
        { timeout: 20000 },
    );
}

/**
 * Opens a fresh browser context, logs in via the UI, opens the shared atlas (the app
 * auto-activates the atlas map). Returns the Page (its context is page.context()).
 */
export async function openClient(browser, baseUrl, atlasId, creds) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${baseUrl}/api/v1`);
    await page.goto('/');
    await loginUI(page, creds.username, creds.password);
    await openAtlasUI(page, atlasId);
    return page;
}

/** Reads the current map's features (per storage type) from the app store. */
export function readFeatures(page, type) {
    return page.evaluate(async (t) => {
        const store = await import('/src/js/store/index.js');
        const f = await store.getCurrentMapFeatures();
        const arr = (f[t] || []);
        return arr.map((x) => ({ id: x.properties?.id, nome: x.properties?.nome, props: x.properties }));
    }, type);
}

export const currentMapName = (page) =>
    page.evaluate(async () => (await import('/src/js/store/index.js')).getCurrentMapNameSync());

/** Polls until the peer's store has a feature of `type` with `id`. */
export async function pollPeerFeature(page, type, id, timeout = 20000) {
    await expect
        .poll(async () => (await readFeatures(page, type)).some((x) => x.id === id), { timeout })
        .toBe(true);
}

/** Polls until the peer's feature of `type`/`id` satisfies `pred(props)`. */
export async function pollPeerFeatureWhere(page, type, id, pred, timeout = 20000) {
    await expect
        .poll(async () => {
            const hit = (await readFeatures(page, type)).find((x) => x.id === id);
            return hit ? !!pred(hit.props) : false;
        }, { timeout })
        .toBe(true);
}

/** Polls until the peer's store NO LONGER has the feature (delete sync). */
export async function pollPeerFeatureGone(page, type, id, timeout = 20000) {
    await expect
        .poll(async () => (await readFeatures(page, type)).some((x) => x.id === id), { timeout })
        .toBe(false);
}

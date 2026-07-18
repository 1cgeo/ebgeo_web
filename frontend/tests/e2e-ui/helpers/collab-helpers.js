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
import { waitForRemoteEntity } from './trace-helpers.js';
import { collectLedger, reduceLedger, renderReport } from './ledger.js';
import { ApiClient } from '../../../src/js/store/sync/api-client.js';

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
export async function openClient(browser, baseUrl, atlasId, creds, { expectMapName } = {}) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${baseUrl}/api/v1`);
    // Enable the SyncLedger tracer before app boot so every collab spec gets the in-page
    // ring (window.__ebgeoSyncTrace) the deterministic waits + ledger collection read.
    // Escape hatch: set EBGEO_E2E_NO_TRACE=1 to run the collab specs with the tracer fully
    // inert (the pollPeer* helpers fall back to their store poll), e.g. to isolate whether
    // a failure is tracer-related.
    if (process.env.EBGEO_E2E_NO_TRACE !== '1') {
        await page.addInitScript(() => { window.__EBGEO_TRACE__ = true; });
    }
    await page.goto('/');
    await loginUI(page, creds.username, creds.password);
    await openAtlasUI(page, atlasId);

    // Readiness, not decoration: `openAtlasUI` returns once the atlas is opened, but the
    // app activates the atlas map ASYNCHRONOUSLY, so the client can still be sitting on the
    // local default map when this returns. Under full-suite load that window is wide enough
    // to be observed: browser-collab-maps-layers.spec.js:145 flaked in two consecutive full
    // runs on a SETUP assertion, reading "Principal" (the local map) where it expected the
    // shared one — before the test had done anything. Waiting here fixes the class for every
    // collab spec instead of patching each one's first assertion.
    if (expectMapName) {
        await expect
            .poll(() => currentMapName(page), {
                timeout: 20000,
                message: `o cliente ativou o mapa do atlas ("${expectMapName}") apos abrir`,
            })
            .toBe(expectMapName);
    }
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

/**
 * @private Shared draw driver, exactly like a user: fit the map to the coords, activate the tool
 * from the draw toolbar, click the canvas at each vertex (multi-vertex tools finish on a
 * right-click of the last point), and return the freshly-created feature's id (the tool generates
 * it; we diff `storage` before/after to find it).
 * @returns {Promise<string|null>}
 */
async function drawViaToolUI(page, { toolId, storage, coords, multi }) {
    const before = new Set((await readFeatures(page, storage)).map((f) => f.id));

    // Fit/center the map so every vertex is guaranteed in-frame for the clicks.
    await page.evaluate((cs) => {
        const map = globalThis.__ebgeoMap;
        if (cs.length === 1) { map.jumpTo({ center: cs[0], zoom: 14 }); return; }
        const lngs = cs.map((c) => c[0]); const lats = cs.map((c) => c[1]);
        map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: 100, duration: 0 });
    }, coords);
    await page.waitForTimeout(300); // let the camera settle before projecting

    await page.locator('.toolbar-group[data-group-id="draw"] .toolbar-group-btn').click();
    const btn = page.locator(`.toolbar-group[data-group-id="draw"] .toolbar-tool-btn[data-tool-id="${toolId}"]`);
    await btn.click();
    await expect(btn).toHaveAttribute('data-active', 'true', { timeout: 5000 });
    // The button flips data-active immediately, but the tool CONTROL's activate() (which wires its
    // map 'click' handler) lags — in a back-to-back draw loop the first vertex clicks can fire
    // before the handler is attached, so only some register and the draw never finishes. Wait for
    // the control to actually report active before clicking.
    await page.waitForFunction(async (id) => {
        const s = await import('/src/js/store/index.js');
        return s.getControl?.(id)?.isActive === true;
    }, toolId, { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(150);

    // Project each lng/lat to a viewport pixel (map projection + canvas offset).
    const pts = await page.evaluate((cs) => {
        const map = globalThis.__ebgeoMap;
        const rect = map.getCanvas().getBoundingClientRect();
        return cs.map(([lng, lat]) => {
            const p = map.project([lng, lat]);
            return { x: Math.round(rect.left + p.x), y: Math.round(rect.top + p.y) };
        });
    }, coords);

    if (!multi) {
        await page.mouse.click(pts[0].x, pts[0].y); // single click places a point
    } else {
        for (let i = 0; i < pts.length - 1; i++) {
            await page.mouse.click(pts[i].x, pts[i].y);
            await page.waitForTimeout(120);
        }
        await page.mouse.click(pts[pts.length - 1].x, pts[pts.length - 1].y, { button: 'right' }); // finish
    }

    // Return the freshly-created feature id (the one absent before the draw).
    let id = null;
    await expect.poll(async () => {
        const fresh = (await readFeatures(page, storage)).find((f) => !before.has(f.id));
        id = fresh?.id ?? null;
        return id;
    }, { timeout: 10000 }).toBeTruthy();
    return id;
}

/** Draws a LINE via the real line tool (vertex clicks + right-click finish). @returns {Promise<string>} new id. */
export const drawLineUI = (page, coords) => drawViaToolUI(page, { toolId: 'line', storage: 'lines', coords, multi: true });

/** Draws a POLYGON via the real polygon tool (vertex clicks + right-click finish). @returns {Promise<string>} new id. */
export const drawPolygonUI = (page, coords) => drawViaToolUI(page, { toolId: 'polygon', storage: 'polygons', coords, multi: true });

/** Places a POINT via the real point tool (single canvas click). @returns {Promise<string>} new id. */
export const drawPointUI = (page, lngLat) => drawViaToolUI(page, { toolId: 'point', storage: 'points', coords: [lngLat], multi: false });

/**
 * Attempts a RAW store write (addFeature of a line) via page.evaluate — bypassing the UI — so a
 * no-edit role's store-level guardWrite is exercised directly. The write MUST be blocked (guardWrite
 * returns without persisting), so the caller's before/after diff proves nothing was created. Used by
 * the permission specs now that the safe view (D1) hides the draw toolbar, leaving no UI gesture to drive.
 * @param {import('@playwright/test').Page} page
 * @param {Array<[number, number]>} coords
 */
export async function attemptStoreWriteBlocked(page, coords) {
    await page.evaluate(async (cs) => {
        const store = await import('/src/js/store/index.js');
        const { generateUUID } = await import('/src/js/utilities/uuid.js');
        const id = generateUUID();
        const feature = {
            type: 'Feature',
            id,
            geometry: { type: 'LineString', coordinates: cs },
            properties: { id, nome: 'blocked-attempt', tipo: 'line', visivel: true },
        };
        try {
            await store.addFeature('lines', feature);
        } catch {
            // guardWrite denies a read-only write (returns or throws) → no feature; either is "blocked".
        }
    }, coords);
}

// ── Real attribute-panel / layers-tree gestures (shared UI drivers) ───────────
// Extracted so the round-trip / conflict specs drive edits as a USER does, not via
// store ops. Selectors: layers-tree select (browser-collab-shared-atlas.spec.js), the
// color picker's native input (tool_manager/helpers/color-picker.helpers.js), the
// Delete-key + confirm-modal delete (keyboard-shortcuts.spec.js + confirm.modal.js).

/** Opens the layers ("camadas") tab (idempotent — never toggles it closed). */
export async function openLayersTab(page) {
    if ((await page.locator('.layer-container').count()) === 0) {
        await page.locator('.sidebar-nav-btn[data-tab="camadas"]').click();
    }
    await expect(page.locator('.layer-container').first()).toBeVisible({ timeout: 10000 });
}

/** Selects a feature by id through the REAL layers tree → expands the sidebar feature panel. */
export async function selectFeatureUI(page, featureId) {
    await openLayersTab(page);
    for (const icon of await page.locator('.layer-expand-icon.collapsed').all()) {
        await icon.click().catch(() => {});
    }
    const row = page.locator(`.feature-item[data-feature-id="${featureId}"] .feature-main`).first();
    await expect(row).toBeVisible({ timeout: 10000 });
    await row.evaluate((el) => el.click());
    await expect(page.locator('.feature-panel[data-expanded="true"]')).toBeVisible({ timeout: 10000 });
}

/** Commits the open panel's pending edits the way a user does — clicking "Salvar". */
export async function savePanelUI(page) {
    const saveBtn = page.locator('.feature-panel[data-expanded="true"] .attr-modern-btn-save').first();
    await expect(saveBtn).toBeVisible({ timeout: 5000 });
    await saveBtn.click();
}

/** Recolors the currently-selected feature via the panel color picker's native input, then saves. */
export async function recolorViaPanelUI(page, hex) {
    const native = page.locator('.feature-panel[data-expanded="true"] .color-picker-native-hidden').first();
    await expect(native).toBeAttached({ timeout: 5000 });
    await native.evaluate((el, value) => {
        el.value = value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }, hex);
    await savePanelUI(page);
}

/** Selects a feature in the layers tree, then recolors it through the panel (one gesture). */
export async function selectAndRecolorUI(page, featureId, hex) {
    await selectFeatureUI(page, featureId);
    await recolorViaPanelUI(page, hex);
}

/** Deletes a feature through the REAL UI: select in the layers tree, press Delete, confirm. */
export async function deleteFeatureUI(page, featureId) {
    await selectFeatureUI(page, featureId);
    await page.keyboard.press('Delete');
    const confirmBtn = page.locator('.confirm-modal-btn-confirm');
    await expect(confirmBtn).toBeVisible({ timeout: 5000 });
    await confirmBtn.click();
}

/**
 * Renames the currently-selected feature through the sidebar panel's editable name field:
 * click the display to enter edit mode, type the new name, commit with Enter, then save.
 */
export async function renameViaPanelUI(page, newName) {
    const panel = page.locator('.feature-panel[data-expanded="true"]');
    await panel.locator('.feature-identification-name').click();
    const input = panel.locator('.feature-identification-name-input:not(.feature-identification-name-input--hidden)');
    await expect(input).toBeVisible({ timeout: 5000 });
    await input.fill(newName);
    await input.press('Enter');
    await savePanelUI(page);
}

/** Selects a feature in the layers tree, then renames it through the panel (one gesture). */
export async function selectAndRenameUI(page, featureId, newName) {
    await selectFeatureUI(page, featureId);
    await renameViaPanelUI(page, newName);
}

/** Places a MILITARY SYMBOL with the real tool (activate → single click, default SIDC). @returns {Promise<string>} new id. */
export async function drawMilitarySymbolUI(page, lngLat) {
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

/**
 * Waits until the peer's store has a feature of `type` with `id`. SyncLedger-gated:
 * first waits deterministically for the peer's `remote.applied` span (the op was applied
 * + lifecycle event emitted), then asserts the store. Falls back to a store poll if the
 * trace never fires, so the assertion stays honest. Replaces the old blind 20s poll.
 */
export async function pollPeerFeature(page, type, id, timeout = 20000) {
    let traced = false;
    try {
        traced = await waitForRemoteEntity(page, id, { timeout });
    } catch {
        // Trace was active but the signal never came → genuine miss; a short store poll confirms.
        traced = true;
    }
    await expect
        .poll(async () => (await readFeatures(page, type)).some((x) => x.id === id), { timeout: traced ? 5000 : timeout })
        .toBe(true);
}

/** Waits until the peer's feature of `type`/`id` satisfies `pred(props)` (SyncLedger-gated). */
export async function pollPeerFeatureWhere(page, type, id, pred, timeout = 20000) {
    let traced = false;
    try {
        traced = await waitForRemoteEntity(page, id, { timeout });
    } catch {
        traced = true;
    }
    await expect
        .poll(async () => {
            const hit = (await readFeatures(page, type)).find((x) => x.id === id);
            return hit ? !!pred(hit.props) : false;
        }, { timeout: traced ? 8000 : timeout })
        .toBe(true);
}

/** Waits until the peer's store NO LONGER has the feature (delete sync; SyncLedger-gated). */
export async function pollPeerFeatureGone(page, type, id, timeout = 20000) {
    let traced = false;
    try {
        traced = await waitForRemoteEntity(page, id, { operationType: 'delete', timeout });
    } catch {
        traced = true;
    }
    await expect
        .poll(async () => (await readFeatures(page, type)).some((x) => x.id === id), { timeout: traced ? 5000 : timeout })
        .toBe(false);
}

/**
 * Collects the UNIFIED SyncLedger (each client's ring + the server ring) at the end of a
 * collaboration scenario, attaches the merged ledger.jsonl + the human/AI report to the
 * Playwright report, and asserts the session was correct: NO op was acked-but-no-effect
 * (invariant I2 — the flagship "wrote 0 rows" guard). The server ring is best-effort (the
 * /debug/trace endpoint is mounted only under NODE_ENV=test). Use ONLY for well-behaved
 * convergence flows — not for permission/lock edge-case specs where a 0-row outcome may be
 * the intended behaviour.
 *
 * @param {import('@playwright/test').TestInfo} testInfo
 * @param {import('@playwright/test').Page[]} pages
 * @param {string} baseUrl
 * @param {{ username: string, password: string }} ownerCreds
 * @param {string} atlasId
 * @param {{ allowNoEffects?: boolean }} [opts] - allowNoEffects: skip the I2 assertion for specs
 *   that exercise undo→redo (re-creating a soft-deleted feature is a BY-DESIGN server no-op — a
 *   tombstone — per the backend "Sync CRDT — confirmed gaps"; it is not a violation).
 * @returns {Promise<Object>} The reduced report.
 */
export async function assertLedgerClean(testInfo, pages, baseUrl, ownerCreds, atlasId, { allowNoEffects = false } = {}) {
    let token;
    try {
        const owner = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
        await owner.login(ownerCreds.username, ownerCreds.password);
        token = owner.getAccessToken();
    } catch {
        // Server-side ledger is optional enrichment; the client rings carry the core signal.
    }
    const spans = await collectLedger(pages, { baseUrl, token, atlasId });
    const report = reduceLedger(spans);
    await testInfo.attach('syncledger.report.md', { body: renderReport(report), contentType: 'text/markdown' });
    await testInfo.attach('syncledger.jsonl', {
        body: spans.map((s) => JSON.stringify(s)).join('\n'),
        contentType: 'application/x-ndjson',
    });
    if (!allowNoEffects) {
        expect(report.summary.noEffects, `acked-but-no-effect ops: ${JSON.stringify(report.noEffects)}`).toBe(0);
    }
    return report;
}

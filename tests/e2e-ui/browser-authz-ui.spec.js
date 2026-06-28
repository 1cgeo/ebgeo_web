// Path: e2e-ui/browser-authz-ui.spec.js

/**
 * AUTHORIZATION — UI-level proof across real browsers + real backend, for the role/link paths
 * that had NO end-to-end coverage:
 *
 *   1. Comentarista (comment tier): can connect, but a real draw gesture is BLOCKED locally
 *      (guardWrite) — a commenter never authors features, only comments.
 *   2. Public viewer LINK (?atlasPublico=<link>): an ANONYMOUS visitor opens read-only (no login),
 *      `isVisitor()` is true, and a real draw gesture is BLOCKED — the public link cannot edit.
 *   3. Visualizador (read tier): the server WITHHOLDS comments from a read connection. A comment
 *      that provably reached Postgres is NOT delivered to a read-only viewer's store.
 *
 * Sharing / public-link / the seed comment are backend routes (no UI) → driven via the API, per
 * the suite's UI-first philosophy (real UI for user gestures, page.evaluate only for setup + reads).
 *
 * Run headed:  npx playwright test browser-authz-ui --headed
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { seedSharedAtlas, openClient, readFeatures, attemptStoreWriteBlocked } from './helpers/collab-helpers.js';
import { createDb, closeDb } from './helpers/db.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** Spread-out line coords so each draw is unambiguous on the canvas. */
const lineCoords = () => [[-43.2, -22.9], [-43.15, -22.85], [-43.1, -22.8]];
const lineIds = async (page) => new Set((await readFeatures(page, 'lines')).map((x) => x.id));

/**
 * Performs the REAL line-draw gesture (toolbar activate → vertex clicks → right-click finish)
 * WITHOUT asserting creation — used to drive a read-only session's blocked authoring attempt,
 * where the write is denied locally (guardWrite) so no feature appears. Mirrors drawLineUI's
 * click choreography.
 */
async function attemptDrawLineBlocked(page, coords) {
    // A no-edit role (Comentarista / read-only / public visitor) gets the safe view (Frente 8 / D1),
    // which hides the draw toolbar entirely — so the UI authoring path is gone. To keep the "no new
    // line" assertion meaningful, exercise the store-level guardWrite directly with a raw addFeature;
    // it must be blocked for a no-edit role, so nothing lands.
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
    await page.locator('.toolbar-group[data-group-id="draw"] .toolbar-tool-btn[data-tool-id="line"]').click();
    await page.waitForTimeout(200); // if the tool still activates (not the safe view), the WRITE is gated

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
    await page.keyboard.press('Escape');
}

/** Enables the public link as the owner (backend route, no UI) → returns the link string. */
async function enablePublicLink(browser, baseUrl, ownerCreds, atlasId) {
    const p = await browser.newPage();
    await p.goto('/');
    const link = await p.evaluate(async ({ base, c, id }) => {
        const { ApiClient } = await import('/src/js/store/sync/api-client.js');
        const api = new ApiClient({ baseUrl: `${base}/api/v1` });
        await api.login(c.username, c.password);
        const res = await api.enablePublicSharing(id);
        return res.publicLink || res.public_link;
    }, { base: baseUrl, c: ownerCreds, id: atlasId });
    await p.close();
    return link;
}

/** Opens a fresh ANONYMOUS context on the public viewer link (?atlasPublico=…) — no login. */
async function openPublicVisitor(browser, baseUrl, publicLink) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${baseUrl}/api/v1`);
    await page.goto(`/?atlasPublico=${publicLink}`);
    await page.waitForFunction(
        () => globalThis.__ebgeoMap && typeof globalThis.__ebgeoMap.loaded === 'function' && globalThis.__ebgeoMap.loaded(),
        { timeout: 30000 },
    );
    // The public-link boot path set an anonymous, read-only VISITOR session.
    await expect.poll(
        () => page.evaluate(async () => {
            const { sessionContext } = await import('/src/js/store/sync/session-context.js');
            return sessionContext.isVisitor();
        }),
        { timeout: 15000 },
    ).toBe(true);
    return page;
}

describeOrSkip('Authorization (UI) — role + public-link gating', () => {
    test.afterAll(async () => {
        await closeDb();
    });

    test('a Comentarista connects but cannot author a feature (draw blocked)', async ({ browser }) => {
        const seed = await seedSharedAtlas(browser, state.baseUrl, { permission: 'comment' });
        const commenter = await openClient(browser, state.baseUrl, seed.atlasId, seed.userB);
        try {
            const before = await lineIds(commenter);
            await attemptDrawLineBlocked(commenter, lineCoords());
            await commenter.waitForTimeout(4000);
            const fresh = (await readFeatures(commenter, 'lines')).filter((x) => !before.has(x.id));
            expect(fresh, 'a commenter cannot draw a feature (write gated locally)').toHaveLength(0);
        } finally {
            await commenter.context().close();
        }
    });

    test('a public viewer link opens read-only and cannot author a feature', async ({ browser }) => {
        const seed = await seedSharedAtlas(browser, state.baseUrl, { permission: 'read' });
        const link = await enablePublicLink(browser, state.baseUrl, seed.userA, seed.atlasId);
        expect(link, 'owner minted a public link').toBeTruthy();

        const visitor = await openPublicVisitor(browser, state.baseUrl, link);
        try {
            const before = await lineIds(visitor);
            await attemptDrawLineBlocked(visitor, lineCoords());
            await visitor.waitForTimeout(4000);
            const fresh = (await readFeatures(visitor, 'lines')).filter((x) => !before.has(x.id));
            expect(fresh, 'a public-link visitor cannot draw a feature (read-only)').toHaveLength(0);
        } finally {
            await visitor.context().close();
        }
    });

    test('a read-only viewer receives NO comments (server visibility filter)', async ({ browser }) => {
        const seed = await seedSharedAtlas(browser, state.baseUrl, { permission: 'read' });
        const db = createDb(state.dbName);

        // Owner connects and authors a spatial comment (setup) → it syncs to the backend.
        const owner = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA);
        let viewer;
        try {
            const commentId = await owner.evaluate(async () => {
                const store = await import('/src/js/store/index.js');
                const c = globalThis.__ebgeoMap.getCenter();
                const cm = await store.addComment({ lng: c.lng, lat: c.lat, text: 'Setor sob observação', authorInitials: 'OW', authorColor: '#2563eb' });
                return cm.id;
            });

            // Ground truth: the comment provably reached Postgres (not just the local store).
            await expect.poll(() => db.queryEntityRow('comments', commentId), { timeout: 15000 }).not.toBeNull();

            // A read-only viewer connects AFTER it is on the server → the snapshot must exclude it.
            viewer = await openClient(browser, state.baseUrl, seed.atlasId, seed.userB);
            await viewer.waitForTimeout(4000); // allow any (buggy) delivery a chance to land

            const viewerComments = await viewer.evaluate(async () => {
                const store = await import('/src/js/store/index.js');
                return Object.keys(await store.getComments());
            });
            expect(viewerComments, 'a read-only viewer must receive no comments from the server').toHaveLength(0);

            // Sanity: the owner (full tier) DOES have the comment it authored.
            const ownerComments = await owner.evaluate(async () => {
                const store = await import('/src/js/store/index.js');
                return Object.keys(await store.getComments());
            });
            expect(ownerComments, 'the owner keeps its own comment').toContain(commentId);
        } finally {
            await owner.context().close();
            if (viewer) await viewer.context().close();
        }
    });
});

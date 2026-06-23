// Path: e2e-ui/browser-collab-reconnect.spec.js

/**
 * RECONNECTION / offline-first replay — TWO real browsers + real backend. Drops B's
 * network mid-session (Playwright context.setOffline) and asserts the offline-first
 * contract holds in BOTH directions:
 *
 *   1. RECEIVE catch-up: while B is offline the owner edits; when B reconnects it catches
 *      up to everything it missed (new feature + an update to an existing one).
 *   2. SEND replay: while B is offline it keeps editing (offline = full local perms); the
 *      queued ops flush to the owner on reconnect — nothing is lost.
 *
 * Run headed:  npx playwright test browser-collab-reconnect --headed
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import {
    seedSharedAtlas,
    openClient,
    readFeatures,
    pollPeerFeature,
    pollPeerFeatureWhere,
    drawLineUI,
} from './helpers/collab-helpers.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/**
 * Drives a real store op on `page`. Used ONLY for the recolor mutation below, which has no
 * single-gesture UI to a SPECIFIC hex (the panel color picker opens the OS-native color
 * dialog, not drivable to an exact value in Playwright). Feature CREATES go through the
 * real draw tool (drawLineUI); the recolor stays a store op so the asserted hex is exact.
 */
function applyStoreOp(page, opName, args) {
    return page.evaluate(async ({ name, a }) => {
        const store = await import('/src/js/store/index.js');
        return store[name](...a);
    }, { name: opName, a: args });
}

/** Spread-out line coords so each draw is unambiguous on the canvas. */
const lineCoords = () => [[-43.2, -22.9], [-43.15, -22.85], [-43.1, -22.8]];

describeOrSkip('Reconnection — offline-first replay cross-client', () => {
    test('B catches up on everything the owner did while it was offline', async ({ browser }) => {
        const seed = await seedSharedAtlas(browser, state.baseUrl);
        const A = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA);
        const B = await openClient(browser, state.baseUrl, seed.atlasId, seed.userB);
        try {
            // Baseline: live sync works. A DRAWS the line through the real tool.
            const f1 = await drawLineUI(A, lineCoords());
            await pollPeerFeature(B, 'lines', f1);

            // B drops off the network.
            await B.context().setOffline(true);
            await B.waitForTimeout(1500);

            // Owner keeps working while B is away: a new feature (drawn via the real tool) +
            // an edit to the old one. The recolor stays a store op — see applyStoreOp note:
            // // no-UI: panel color picker opens the OS-native color dialog, not drivable to
            // an exact hex in Playwright; the assertion below pins the exact #ff0000 value.
            const f2 = await drawLineUI(A, lineCoords());
            await applyStoreOp(A, 'updateFeatureProperty', ['lines', f1, 'lineColor', '#ff0000']);
            await A.waitForTimeout(1500);

            // B comes back → it must catch up to BOTH the missed create and the missed update.
            await B.context().setOffline(false);
            await pollPeerFeature(B, 'lines', f2, 35000);
            await pollPeerFeatureWhere(B, 'lines', f1, (p) => p.lineColor === '#ff0000', 35000);
        } finally {
            await A.context().close();
            await B.context().close();
        }
    });

    test('B edits while offline; the queued ops flush to the owner on reconnect', async ({ browser }) => {
        const seed = await seedSharedAtlas(browser, state.baseUrl);
        const A = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA);
        const B = await openClient(browser, state.baseUrl, seed.atlasId, seed.userB);
        try {
            // Confirm B is genuinely connected first (a write that reaches A live). B DRAWS it.
            const warm = await drawLineUI(B, lineCoords());
            await pollPeerFeature(A, 'lines', warm);

            // B goes offline and keeps drawing through the REAL line tool (offline = full
            // local perms; the ops queue locally).
            await B.context().setOffline(true);
            await B.waitForTimeout(1500);
            const off1 = await drawLineUI(B, lineCoords());
            const off2 = await drawLineUI(B, lineCoords());
            // They exist locally on B even while offline.
            expect((await readFeatures(B, 'lines')).some((x) => x.id === off1)).toBe(true);

            // Reconnect → the queued offline edits replay to the owner.
            await B.context().setOffline(false);
            await pollPeerFeature(A, 'lines', off1, 35000);
            await pollPeerFeature(A, 'lines', off2, 35000);
        } finally {
            await A.context().close();
            await B.context().close();
        }
    });
});

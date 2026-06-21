// Path: e2e-ui/browser-collab-three-client-flow.spec.js

/**
 * THREE-CLIENT FLOW — three real browsers + real backend. Beyond the simple fan-out
 * (browser-collab-scale), this drives a MULTI-PHASE session with three collaborators so
 * roster/membership and convergence are exercised under changing state, not just one
 * broadcast:
 *
 *   1. all three create a feature        → every client ends with all three.
 *   2. C edits A's feature               → A and B both see the edit.
 *   3. three-way conflict on ONE feature → all three converge to one value.
 *   4. a late joiner (C reconnects)      → catches up to the full state.
 *   5. C deletes a feature               → A and B both lose it.
 *
 * Run headed:  npx playwright test browser-collab-three-client-flow --headed
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import {
    seedSharedAtlas,
    openClient,
    readFeatures,
    pollPeerFeature,
    pollPeerFeatureWhere,
    pollPeerFeatureGone,
    addSharedUser,
} from './helpers/collab-helpers.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

function applyStoreOp(page, opName, args) {
    return page.evaluate(async ({ name, a }) => {
        const store = await import('/src/js/store/index.js');
        return store[name](...a);
    }, { name: opName, a: args });
}

const lineColor = async (page, id) => (await readFeatures(page, 'lines')).find((x) => x.id === id)?.props?.lineColor;

const newLine = (id) => ({
    type: 'Feature',
    properties: { id, source: 'line', layerId: 'default', lineColor: '#000000', lineWidth: 4 },
    geometry: { type: 'LineString', coordinates: [[-43.2, -22.9], [-43.1, -22.8]] },
});

describeOrSkip('Three-client flow — multi-phase session with three collaborators', () => {
    test('create-all → cross-edit → 3-way conflict → late-join catch-up → delete', async ({ browser }) => {
        // THREE live browsers + a late-join reconnect — give it headroom over the 60s
        // default so full-suite load can't tip it into a timeout.
        test.setTimeout(180000);
        const seed = await seedSharedAtlas(browser, state.baseUrl);
        const seedPage = await browser.newPage();
        await seedPage.goto('/');
        const userC = await addSharedUser(seedPage, state.baseUrl, seed.userA, seed.atlasId, { label: 'charlie' });
        await seedPage.close();

        const A = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA);
        const B = await openClient(browser, state.baseUrl, seed.atlasId, seed.userB);
        let C = await openClient(browser, state.baseUrl, seed.atlasId, userC);
        try {
            // 1. CREATE-ALL — each client makes a feature; all three converge on all three.
            const fa = crypto.randomUUID();
            const fb = crypto.randomUUID();
            const fc = crypto.randomUUID();
            await applyStoreOp(A, 'addFeature', ['lines', newLine(fa)]);
            await applyStoreOp(B, 'addFeature', ['lines', newLine(fb)]);
            await applyStoreOp(C, 'addFeature', ['lines', newLine(fc)]);
            for (const [page, id] of [[B, fa], [C, fa], [A, fb], [C, fb], [A, fc], [B, fc]]) {
                await pollPeerFeature(page, 'lines', id);
            }

            // 2. CROSS-EDIT — C edits A's feature; A and B both see it.
            await applyStoreOp(C, 'updateFeatureProperty', ['lines', fa, 'lineColor', '#22aa22']);
            await pollPeerFeatureWhere(A, 'lines', fa, (p) => p.lineColor === '#22aa22');
            await pollPeerFeatureWhere(B, 'lines', fa, (p) => p.lineColor === '#22aa22');

            // 3. THREE-WAY CONFLICT — all three recolor the SAME feature at once → converge.
            await Promise.all([
                applyStoreOp(A, 'updateFeatureProperty', ['lines', fb, 'lineColor', '#ff0000']),
                applyStoreOp(B, 'updateFeatureProperty', ['lines', fb, 'lineColor', '#0000ff']),
                applyStoreOp(C, 'updateFeatureProperty', ['lines', fb, 'lineColor', '#00ff00']),
            ]);
            await expect
                .poll(async () => {
                    const [ca, cb, cc] = [await lineColor(A, fb), await lineColor(B, fb), await lineColor(C, fb)];
                    return ca && ca === cb && cb === cc ? ca : null;
                }, { timeout: 30000 })
                .toMatch(/^#(ff0000|0000ff|00ff00)$/);

            // 4. LATE JOIN — C disconnects, the room edits, C reconnects and catches up.
            await C.context().close();
            const fLate = crypto.randomUUID();
            await applyStoreOp(A, 'addFeature', ['lines', newLine(fLate)]);
            await pollPeerFeature(B, 'lines', fLate);
            C = await openClient(browser, state.baseUrl, seed.atlasId, userC);
            await pollPeerFeature(C, 'lines', fLate, 35000);
            await pollPeerFeature(C, 'lines', fa); // and the earlier state too

            // 5. DELETE — C removes a feature; A and B both lose it.
            await applyStoreOp(C, 'removeFeature', ['lines', fc]);
            await pollPeerFeatureGone(A, 'lines', fc);
            await pollPeerFeatureGone(B, 'lines', fc);
        } finally {
            await A.context().close();
            await B.context().close();
            await C.context().close();
        }
    });
});

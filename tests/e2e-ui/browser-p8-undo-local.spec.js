// Path: e2e-ui/browser-p8-undo-local.spec.js

/**
 * @fileoverview Browser E2E for P8 (undo/redo is LOCAL per user — never includes a remote op).
 *
 * Two real Chromium clients on one shared atlas:
 *   1. A creates a feature (records an entry in A's OWN undo stack; syncs to B as a REMOTE op).
 *   2. B receives it. B presses Ctrl+Z — B's undo stack is EMPTY (a received remote op is never
 *      recorded for undo), so A's feature must SURVIVE on both clients.
 *   3. A presses Ctrl+Z — undoes A's OWN action; the feature is removed and the inverse delete
 *      syncs to B.
 * This proves undo is strictly local-per-session and never reaches across the collaboration boundary.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { seedSharedAtlas, openClient, pollPeerFeature, readFeatures, pollPeerFeatureGone } from './helpers/collab-helpers.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

const hasFeature = async (page, id) => (await readFeatures(page, 'points')).some((x) => x.id === id);

describeOrSkip('P8 undo is local per user (two clients, real Chromium)', () => {
    test("B's Ctrl+Z does not undo A's remote feature; A's Ctrl+Z undoes its own", async ({ browser }) => {
        const seed = await seedSharedAtlas(browser, state.baseUrl);
        const A = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA);
        const B = await openClient(browser, state.baseUrl, seed.atlasId, seed.userB);
        try {
            // 1. A creates a feature (records undo in A's stack; syncs to B).
            const featureId = await A.evaluate(async () => {
                const store = await import('/src/js/store/index.js');
                const id = crypto.randomUUID();
                await store.addFeature('points', {
                    type: 'Feature', geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
                    properties: { id, source: 'point', nome: 'Alfa' },
                });
                return id;
            });
            await pollPeerFeature(B, 'points', featureId); // B received the remote op

            // 2. B undoes (the exact call Ctrl+Z makes). B's undo stack is EMPTY — a received remote
            //    op is never recorded — so this returns nothing and A's feature must remain on BOTH.
            const bUndo = await B.evaluate(async () => {
                const store = await import('/src/js/store/index.js');
                return (await store.undoLastAction()) || null;
            });
            expect(bUndo, "B's undo stack must be empty (no remote op recorded)").toBeNull();
            await B.waitForTimeout(800); // allow any (erroneous) delete to propagate
            expect(await hasFeature(B, featureId), "B's undo must NOT remove A's feature").toBe(true);
            expect(await hasFeature(A, featureId), "A's feature must be untouched by B's undo").toBe(true);

            // 3. A undoes — reverts A's OWN action. The feature is removed locally and the inverse
            //    delete syncs to B.
            const aUndo = await A.evaluate(async () => {
                const store = await import('/src/js/store/index.js');
                return (await store.undoLastAction()) || null;
            });
            expect(aUndo, "A's undo must return its own recorded action").toBeTruthy();
            await expect.poll(async () => hasFeature(A, featureId), { timeout: 10000 }).toBe(false);
            await pollPeerFeatureGone(B, 'points', featureId);
        } finally {
            await A.context().close();
            await B.context().close();
        }
    });
});

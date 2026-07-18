// Path: e2e-ui/browser-p8-undo-local.spec.js

/**
 * @fileoverview Browser E2E for P8 (undo/redo is LOCAL per user — never includes a remote op).
 *
 * Two real Chromium clients on one shared atlas:
 *   1. A creates a feature with the REAL point tool (records an entry in A's OWN undo stack;
 *      syncs to B as a REMOTE op).
 *   2. B receives it. B presses Ctrl+Z — B's undo stack is EMPTY (a received remote op is never
 *      recorded for undo), so A's feature must SURVIVE on both clients (the undo toast says
 *      "Nada para desfazer").
 *   3. A presses Ctrl+Z — undoes A's OWN action; the feature is removed and the inverse delete
 *      syncs to B (the undo toast confirms an action was reverted).
 * This proves undo is strictly local-per-session and never reaches across the collaboration boundary.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { seedSharedAtlas, openClient, pollPeerFeature, readFeatures, pollPeerFeatureGone, drawPointUI } from './helpers/collab-helpers.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

const hasFeature = async (page, id) => (await readFeatures(page, 'points')).some((x) => x.id === id);

/** Reads the current text of the undo/redo toast channel (the visible `.toast` content). */
const undoToastText = (page) =>
    page.locator('.toast .toast__content span').last().innerText();

describeOrSkip('P8 undo is local per user (two clients, real Chromium)', () => {
    test("B's Ctrl+Z does not undo A's remote feature; A's Ctrl+Z undoes its own", async ({ browser }) => {
        const seed = await seedSharedAtlas(browser, state.baseUrl);
        const A = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA);
        const B = await openClient(browser, state.baseUrl, seed.atlasId, seed.userB);
        try {
            // 1. A creates a feature with the REAL point tool (records undo in A's stack; syncs to B).
            const featureId = await drawPointUI(A, [-43.2, -22.9]);
            expect(featureId, "A's point was created by the point tool").toBeTruthy();
            await A.keyboard.press('Escape'); // deactivate the still-active point tool (no stray points)
            await pollPeerFeature(B, 'points', featureId); // B received the remote op

            // 2. B presses Ctrl+Z (the real undo gesture; the document-level shortcut handler runs it).
            //    B's undo stack is EMPTY — a received remote op is never recorded — so the undo toast
            //    says "Nada para desfazer" and A's feature must remain on BOTH clients.
            await B.keyboard.press('Control+z');
            await expect.poll(() => undoToastText(B), { timeout: 5000 }).toBe('Nada para desfazer');
            await B.waitForTimeout(800); // allow any (erroneous) delete to propagate
            expect(await hasFeature(B, featureId), "B's undo must NOT remove A's feature").toBe(true);
            expect(await hasFeature(A, featureId), "A's feature must be untouched by B's undo").toBe(true);

            // 3. A presses Ctrl+Z — reverts A's OWN action. The undo toast names the reverted action
            //    (NOT "Nada para desfazer"); the feature is removed locally and the inverse delete
            //    syncs to B.
            await A.keyboard.press('Control+z');
            await expect.poll(() => undoToastText(A), { timeout: 5000 }).not.toBe('Nada para desfazer');
            await expect.poll(async () => hasFeature(A, featureId), { timeout: 10000 }).toBe(false);
            await pollPeerFeatureGone(B, 'points', featureId);
        } finally {
            await A.context().close();
            await B.context().close();
        }
    });
});

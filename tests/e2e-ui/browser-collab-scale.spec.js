// Path: e2e-ui/browser-collab-scale.spec.js

/**
 * SCALE — THREE real browsers + real backend. The suite only ever exercised two clients;
 * this proves the broadcast FANS OUT to every peer in the room, in all directions: each
 * of three collaborators creates a feature and BOTH of the others receive it. Catches
 * room-membership / self-echo / broadcast-target regressions that two clients can hide.
 *
 * Run headed:  npx playwright test browser-collab-scale --headed
 */

import { test } from '@playwright/test';
import { readState } from './state.js';
import {
    seedSharedAtlas,
    openClient,
    pollPeerFeature,
    addSharedUser,
    drawLineUI,
} from './helpers/collab-helpers.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

describeOrSkip('Scale — three-client broadcast fan-out', () => {
    test('each of three collaborators creates a feature → both others receive it', async ({ browser }) => {
        const seed = await seedSharedAtlas(browser, state.baseUrl);
        // A is the owner; B is shared (write) by the seed; add C as a third writer.
        const seedPage = await browser.newPage();
        await seedPage.goto('/');
        const userC = await addSharedUser(seedPage, state.baseUrl, seed.userA, seed.atlasId, { label: 'charlie' });
        await seedPage.close();

        const A = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA);
        const B = await openClient(browser, state.baseUrl, seed.atlasId, seed.userB);
        const C = await openClient(browser, state.baseUrl, seed.atlasId, userC);
        try {
            // A draws a line via the real line tool → B and C both receive it.
            const fa = await drawLineUI(A, [[-43.20, -22.90], [-43.10, -22.80]]);
            await pollPeerFeature(B, 'lines', fa);
            await pollPeerFeature(C, 'lines', fa);

            // B draws → A and C both receive.
            const fb = await drawLineUI(B, [[-43.25, -22.95], [-43.15, -22.85]]);
            await pollPeerFeature(A, 'lines', fb);
            await pollPeerFeature(C, 'lines', fb);

            // C draws → A and B both receive.
            const fc = await drawLineUI(C, [[-43.30, -23.00], [-43.20, -22.90]]);
            await pollPeerFeature(A, 'lines', fc);
            await pollPeerFeature(B, 'lines', fc);
        } finally {
            await A.context().close();
            await B.context().close();
            await C.context().close();
        }
    });
});

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
} from './helpers/collab-helpers.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

function applyStoreOp(page, opName, args) {
    return page.evaluate(async ({ name, a }) => {
        const store = await import('/src/js/store/index.js');
        return store[name](...a);
    }, { name: opName, a: args });
}

const newLine = (id) => ({
    type: 'Feature',
    properties: { id, source: 'line', layerId: 'default', lineColor: '#3f4fb5', lineWidth: 4 },
    geometry: { type: 'LineString', coordinates: [[-43.2, -22.9], [-43.1, -22.8]] },
});

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
            // A creates → B and C both receive.
            const fa = crypto.randomUUID();
            await applyStoreOp(A, 'addFeature', ['lines', newLine(fa)]);
            await pollPeerFeature(B, 'lines', fa);
            await pollPeerFeature(C, 'lines', fa);

            // B creates → A and C both receive.
            const fb = crypto.randomUUID();
            await applyStoreOp(B, 'addFeature', ['lines', newLine(fb)]);
            await pollPeerFeature(A, 'lines', fb);
            await pollPeerFeature(C, 'lines', fb);

            // C creates → A and B both receive.
            const fc = crypto.randomUUID();
            await applyStoreOp(C, 'addFeature', ['lines', newLine(fc)]);
            await pollPeerFeature(A, 'lines', fc);
            await pollPeerFeature(B, 'lines', fc);
        } finally {
            await A.context().close();
            await B.context().close();
            await C.context().close();
        }
    });
});

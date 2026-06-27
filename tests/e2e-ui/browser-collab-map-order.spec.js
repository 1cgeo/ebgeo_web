// Path: e2e-ui/browser-collab-map-order.spec.js

/**
 * MAPS-LIST ORDERING convergence across TWO real browsers + real backend.
 *
 * The user can drag-reorder the maps list (maps.tab → Sortable `onEnd` → setMapOrder). That order
 * is an atlas-level app preference — an array of map NAMES — synced as a `setting` op into
 * atlas.settings.mapOrder, the SAME path mapBadgeColors / terrainExaggeration use. The single-client
 * e2e (tests/e2e/map-order-sync.e2e.test.js) proves the op persists server-side; the integration
 * test (remote-operation-handler › "mapOrder") proves the inbound apply. Neither proves the actual
 * point — "sync the order BETWEEN users" — so here a SECOND connected peer's local maps-list order
 * must converge after A reorders, live over a real WebSocket.
 *
 * A reorders through the REAL store op (setMapOrder — the exact call maps.tab makes onEnd); B (a
 * separate browser) must converge: getMapOrder() (the synced setting) AND the user-visible
 * getAllMapNamesStore() (what the maps tab renders) reflect A's new order.
 *
 * Run headed:  npx playwright test browser-collab-map-order --headed
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { seedSharedAtlas, openClient } from './helpers/collab-helpers.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** Reads a peer's synced maps-list order setting (the value setMapOrder writes + syncs). */
function peerMapOrder(page) {
    return page.evaluate(async () => {
        const maps = await import('/src/js/store/map.operations.js');
        return maps.getMapOrder();
    });
}

/** Reads a peer's user-visible ordered map-name list (what the maps tab actually renders). */
function peerOrderedMapNames(page) {
    return page.evaluate(async () => {
        const maps = await import('/src/js/store/map.operations.js');
        return maps.getAllMapNamesStore();
    });
}

describeOrSkip('Maps-list ordering — a peer converges on a remote reorder', () => {
    test('A reordering the maps list propagates to peer B', async ({ browser }) => {
        const seed = await seedSharedAtlas(browser, state.baseUrl, { permission: 'write' });
        const A = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA);
        const B = await openClient(browser, state.baseUrl, seed.atlasId, seed.userB);
        try {
            // A adds a second map so there is a non-trivial order to sync (the realistic case:
            // create maps, then drag to reorder). The create syncs to B as a map op.
            await A.evaluate(async () => {
                const maps = await import('/src/js/store/map.operations.js');
                await maps.addMap('Mapa Bravo');
            });

            // B must first converge on the new map — its name has to exist before the order
            // references it (and ops apply in arrival order, so the map lands before the reorder).
            await expect.poll(() => peerOrderedMapNames(B), { timeout: 20000 }).toContain('Mapa Bravo');

            // A reorders: Bravo first, then the seeded map — exactly what maps.tab's Sortable
            // onEnd does (setMapOrder with the dragged-name array).
            const newOrder = ['Mapa Bravo', seed.mapName];
            await A.evaluate(async (o) => {
                const maps = await import('/src/js/store/map.operations.js');
                await maps.setMapOrder(o);
            }, newOrder);

            // B converges on the synced order setting...
            await expect.poll(() => peerMapOrder(B), { timeout: 20000 }).toEqual(newOrder);

            // ...and the user-visible maps list renders in that order (Bravo before the seeded map).
            await expect
                .poll(async () => {
                    const names = await peerOrderedMapNames(B);
                    return names.indexOf('Mapa Bravo') !== -1 && names.indexOf('Mapa Bravo') < names.indexOf(seed.mapName);
                }, { timeout: 20000 })
                .toBe(true);
        } finally {
            await A.context().close();
            await B.context().close();
        }
    });
});

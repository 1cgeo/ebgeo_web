// Path: e2e-ui/browser-collab-reconnect.spec.js

/**
 * RECONNECTION / offline-first replay — TWO real browsers + real backend, on the
 * full-chain harness. Drops B's network mid-session (Playwright context.setOffline) and
 * asserts the offline-first contract in BOTH directions:
 *
 *   1. RECEIVE catch-up: while B is offline the owner edits; on reconnect B converges to
 *      everything it missed. The catch-up arrives via snapshot/replay (no per-op live
 *      spans guaranteed), so it is verified by convergence + B's IndexedDB ground-truth.
 *   2. SEND replay: while B is offline it keeps drawing (offline = full local perms); on
 *      reconnect the queued ops flush and traverse the WHOLE chain to the owner
 *      (expectFullSyncFrom — the offline-authored ops resume the full pipeline).
 *
 * Run headed:  npx playwright test browser-collab-reconnect --headed
 */

import { collabTest, expect, readFeatures, drawLineUI } from './helpers/collab.fixtures.js';
import { readIdbEntity } from './helpers/idb.js';

/** Drives a store op (recolor to an EXACT hex has no single-gesture UI here). */
function applyStoreOp(page, opName, args) {
    return page.evaluate(async ({ name, a }) => {
        const store = await import('/src/js/store/index.js');
        return store[name](...a);
    }, { name: opName, a: args });
}

const lineCoords = () => [[-43.2, -22.9], [-43.15, -22.85], [-43.1, -22.8]];

collabTest.describe('Reconnection — offline-first replay cross-client (full chain on resume)', () => {
    collabTest('B catches up on everything the owner did while it was offline', async ({ collab }) => {
        const A = collab.author;
        const B = collab.peers[0];

        // Baseline: live sync works (full chain).
        const f1 = await drawLineUI(A, lineCoords());
        await collab.expectFullSync({ entityId: f1, type: 'lines', operationType: 'create' });

        // B drops off the network.
        await B.context().setOffline(true);
        await B.waitForTimeout(1500);

        // Owner keeps working while B is away: a new feature + an edit to the old one.
        const f2 = await drawLineUI(A, lineCoords());
        await applyStoreOp(A, 'updateFeatureProperty', ['lines', f1, 'lineColor', '#ff0000']);
        await A.waitForTimeout(1500);

        // B comes back → it converges to BOTH the missed create and the missed update (the
        // catch-up rides the snapshot/replay path, so verify state + IndexedDB, not live spans).
        await B.context().setOffline(false);
        await expect
            .poll(async () => (await readFeatures(B, 'lines')).some((x) => x.id === f2), { timeout: 35000 })
            .toBe(true);
        await expect
            .poll(async () => (await readFeatures(B, 'lines')).find((x) => x.id === f1)?.props?.lineColor, { timeout: 35000 })
            .toBe('#ff0000');
        // Ground-truth: the caught-up state is durable in B's IndexedDB.
        expect((await readIdbEntity(B, { entityId: f2, entityType: 'feature', mapId: collab.mapId, storage: 'lines' })).found).toBe(true);
    });

    collabTest('B edits while offline; the queued ops flush to the owner on reconnect (full chain)', async ({ collab }) => {
        const B = collab.peers[0];

        // Confirm B is genuinely connected first (a write that reaches A through the chain).
        const warm = await drawLineUI(B, lineCoords());
        await collab.expectFullSyncFrom(B, { entityId: warm, type: 'lines', operationType: 'create' });

        // B goes offline and keeps drawing (offline = full local perms; ops queue locally).
        await B.context().setOffline(true);
        await B.waitForTimeout(1500);
        const off1 = await drawLineUI(B, lineCoords());
        const off2 = await drawLineUI(B, lineCoords());
        expect((await readFeatures(B, 'lines')).some((x) => x.id === off1)).toBe(true);

        // Reconnect → the queued offline ops flush and traverse the WHOLE chain to the owner.
        await B.context().setOffline(false);
        await collab.expectFullSyncFrom(B, { entityId: off1, type: 'lines', operationType: 'create', timeout: 35000 });
        await collab.expectFullSyncFrom(B, { entityId: off2, type: 'lines', operationType: 'create', timeout: 35000 });
    });
});

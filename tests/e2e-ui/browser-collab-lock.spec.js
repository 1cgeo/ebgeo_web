// Path: e2e-ui/browser-collab-lock.spec.js

/**
 * MAP LOCK — TWO real browsers + real backend. A map lock makes a map read-only. This
 * spec pins the OBSERVABLE contract of toggleMapLock:
 *
 *   - locking a map blocks writes on the client that holds the lock (local enforcement),
 *   - unlocking restores writes,
 *   - a locked map does NOT corrupt collaboration: the OTHER client (whose own view is
 *     not locked) keeps editing and both stay consistent.
 *
 * NOTE on scope (verified against the code, not assumed):
 *  - map lock is OWNER/ADMIN-only (canLockMaps); an editor's toggleMapLock is denied
 *    (returns null) — so the OWNER A drives the lock here.
 *  - lock is enforced LOCALLY per client (toggleMapLock writes a per-client app setting +
 *    emits MAP_LOCK_CHANGED; it does NOT broadcast a lock op). So A locking blocks A's own
 *    authoring; the editor B (independent view) keeps editing. This asserts exactly that
 *    contract, not a cross-client lock (the product does not currently sync locks).
 *
 * Run headed:  npx playwright test browser-collab-lock --headed
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { seedSharedAtlas, openClient, readFeatures, pollPeerFeature } from './helpers/collab-helpers.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

function applyStoreOp(page, opName, args) {
    return page.evaluate(async ({ name, a }) => {
        const store = await import('/src/js/store/index.js');
        return store[name](...a);
    }, { name: opName, a: args });
}

const hasLine = async (page, id) => (await readFeatures(page, 'lines')).some((x) => x.id === id);

const newLine = (id) => ({
    type: 'Feature',
    properties: { id, source: 'line', layerId: 'default', lineColor: '#3f4fb5', lineWidth: 4 },
    geometry: { type: 'LineString', coordinates: [[-43.2, -22.9], [-43.1, -22.8]] },
});

describeOrSkip('Map lock — owner-only, local read-only enforcement, collaboration stays consistent', () => {
    test('an editor cannot lock; the owner can; owner-lock blocks the owner, editor keeps editing', async ({ browser }) => {
        const seed = await seedSharedAtlas(browser, state.baseUrl);
        const A = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA); // owner
        const B = await openClient(browser, state.baseUrl, seed.atlasId, seed.userB); // editor
        try {
            // Baseline: B (editor) can write and A sees it.
            const warm = crypto.randomUUID();
            await applyStoreOp(B, 'addFeature', ['lines', newLine(warm)]);
            await pollPeerFeature(A, 'lines', warm);

            // The editor B is NOT allowed to lock (canLockMaps is owner/admin-only).
            const editorTry = await applyStoreOp(B, 'toggleMapLock', [seed.mapName]);
            expect(editorTry, 'editor cannot lock (permission denied → null)').toBeNull();

            // The owner A locks its current map → A's own authoring is blocked locally.
            const locked = await applyStoreOp(A, 'toggleMapLock', [seed.mapName]);
            expect(locked, 'owner toggleMapLock returned locked=true').toBe(true);
            const blockedId = crypto.randomUUID();
            await applyStoreOp(A, 'addFeature', ['lines', newLine(blockedId)]);
            await A.waitForTimeout(2500);
            expect(await hasLine(A, blockedId), 'owner write blocked while it holds the lock').toBe(false);

            // The editor B (independent view, not locked) keeps editing → A still RECEIVES it
            // (lock blocks local authoring, not inbound sync).
            const fromB = crypto.randomUUID();
            await applyStoreOp(B, 'addFeature', ['lines', newLine(fromB)]);
            await pollPeerFeature(A, 'lines', fromB);

            // Owner unlocks → its writes work again, B sees them.
            const unlocked = await applyStoreOp(A, 'toggleMapLock', [seed.mapName]);
            expect(unlocked, 'second toggle unlocks').toBe(false);
            const afterUnlock = crypto.randomUUID();
            await applyStoreOp(A, 'addFeature', ['lines', newLine(afterUnlock)]);
            expect(await hasLine(A, afterUnlock), 'owner writes again after unlock').toBe(true);
            await pollPeerFeature(B, 'lines', afterUnlock);
        } finally {
            await A.context().close();
            await B.context().close();
        }
    });
});

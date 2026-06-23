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
import { seedSharedAtlas, openClient, readFeatures, pollPeerFeature, drawLineUI } from './helpers/collab-helpers.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/**
 * Drives a real store op on `page`. Used ONLY for toggleMapLock, which has no single-gesture
 * collab UI in this product (lock is an owner/admin-only per-client app setting toggled from
 * the maps tab and gated by role; this spec asserts that role gate + the local read-only
 * enforcement against a deterministic toggle).
 * // no-UI: map lock is a per-client app setting whose return value (locked true/false / null
 * when permission-denied) is the asserted contract; the toggle is exercised directly.
 */
function applyStoreOp(page, opName, args) {
    return page.evaluate(async ({ name, a }) => {
        const store = await import('/src/js/store/index.js');
        return store[name](...a);
    }, { name: opName, a: args });
}

const hasLine = async (page, id) => (await readFeatures(page, 'lines')).some((x) => x.id === id);

/** Spread-out line coords so each draw is unambiguous on the canvas. */
const lineCoords = () => [[-43.2, -22.9], [-43.15, -22.85], [-43.1, -22.8]];

describeOrSkip('Map lock — owner-only, local read-only enforcement, collaboration stays consistent', () => {
    test('an editor cannot lock; the owner can; owner-lock blocks the owner, editor keeps editing', async ({ browser }) => {
        const seed = await seedSharedAtlas(browser, state.baseUrl);
        const A = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA); // owner
        const B = await openClient(browser, state.baseUrl, seed.atlasId, seed.userB); // editor
        try {
            // Baseline: B (editor) DRAWS a line through the real tool and A sees it.
            const warm = await drawLineUI(B, lineCoords());
            await pollPeerFeature(A, 'lines', warm);

            // The editor B is NOT allowed to lock (canLockMaps is owner/admin-only).
            const editorTry = await applyStoreOp(B, 'toggleMapLock', [seed.mapName]);
            expect(editorTry, 'editor cannot lock (permission denied → null)').toBeNull();

            // The owner A locks its current map → A's own authoring is blocked locally.
            const locked = await applyStoreOp(A, 'toggleMapLock', [seed.mapName]);
            expect(locked, 'owner toggleMapLock returned locked=true').toBe(true);
            // Real UI enforcement: locking HIDES the authoring toolbar groups (draw/military/
            // analysis) — the user has no way to draw. Assert the draw group is hidden, then
            // try the line-tool keyboard shortcut ('l'), which the keyboard handler gates on the
            // lock, and confirm A's real click on the canvas lands NOTHING.
            await expect(A.locator('.toolbar-group[data-group-id="draw"]')).toBeHidden({ timeout: 5000 });
            const beforeA = new Set((await readFeatures(A, 'lines')).map((x) => x.id));
            await A.locator('.maplibregl-canvas').first().press('l'); // line shortcut — gated while locked
            const box = await A.locator('.maplibregl-canvas').first().boundingBox();
            await A.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.45);
            await A.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.55, { button: 'right' });
            await A.waitForTimeout(2500);
            const newOnA = (await readFeatures(A, 'lines')).filter((x) => !beforeA.has(x.id));
            expect(newOnA, 'owner write blocked while it holds the lock (no new line)').toHaveLength(0);

            // The editor B (independent view, not locked) keeps DRAWING → A still RECEIVES it
            // (lock blocks local authoring, not inbound sync).
            const fromB = await drawLineUI(B, lineCoords());
            await pollPeerFeature(A, 'lines', fromB);

            // Owner unlocks → its writes work again, B sees them.
            const unlocked = await applyStoreOp(A, 'toggleMapLock', [seed.mapName]);
            expect(unlocked, 'second toggle unlocks').toBe(false);
            const afterUnlock = await drawLineUI(A, lineCoords());
            expect(await hasLine(A, afterUnlock), 'owner writes again after unlock').toBe(true);
            await pollPeerFeature(B, 'lines', afterUnlock);
        } finally {
            await A.context().close();
            await B.context().close();
        }
    });
});

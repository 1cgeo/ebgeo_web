// Path: e2e-ui/browser-collab-lock.spec.js

/**
 * MAP LOCK — TWO real browsers + real backend, on the full-chain harness. A map lock makes
 * a map read-only LOCALLY (owner/admin-only, not broadcast). This pins toggleMapLock's
 * observable contract, with the cross-client propagation parts verified end-to-end:
 *
 *   - an editor cannot lock (permission-denied → null);
 *   - the owner can; while the owner holds the lock its OWN authoring is blocked (toolbar
 *     hidden, real canvas gesture lands nothing);
 *   - the lock does NOT corrupt collaboration: the editor (independent view) keeps editing
 *     and its features still traverse the WHOLE chain back to the owner (expectFullSyncFrom);
 *   - unlocking restores the owner's writes, which traverse the chain to the editor.
 *
 * Run headed:  npx playwright test browser-collab-lock --headed
 */

import { collabTest, expect, readFeatures, drawLineUI } from './helpers/collab.fixtures.js';

/** Drives a store op (toggleMapLock has no single-gesture collab UI; its return value is the contract). */
function applyStoreOp(page, opName, args) {
    return page.evaluate(async ({ name, a }) => {
        const store = await import('/src/js/store/index.js');
        return store[name](...a);
    }, { name: opName, a: args });
}

const lineCoords = () => [[-43.2, -22.9], [-43.15, -22.85], [-43.1, -22.8]];

collabTest.describe('Map lock — owner-only, local read-only enforcement, collaboration stays consistent', () => {
    collabTest('an editor cannot lock; the owner can; owner-lock blocks the owner, editor keeps editing', async ({ collab }) => {
        const A = collab.author; // owner
        const B = collab.peers[0]; // editor
        const mapName = collab.mapName;

        // Baseline: B (editor) draws a line; it reaches the owner A through the whole chain.
        const warm = await drawLineUI(B, lineCoords());
        await collab.expectFullSyncFrom(B, { entityId: warm, type: 'lines', operationType: 'create' });

        // The editor B is NOT allowed to lock (canLockMaps is owner/admin-only).
        const editorTry = await applyStoreOp(B, 'toggleMapLock', [mapName]);
        expect(editorTry, 'editor cannot lock (permission denied → null)').toBeNull();

        // The owner A locks its current map → A's own authoring is blocked locally.
        const locked = await applyStoreOp(A, 'toggleMapLock', [mapName]);
        expect(locked, 'owner toggleMapLock returned locked=true').toBe(true);

        // Real UI enforcement: locking HIDES the authoring toolbar groups; the line shortcut is
        // gated and a real canvas gesture lands NOTHING on A.
        await expect(A.locator('.toolbar-group[data-group-id="draw"]')).toBeHidden({ timeout: 5000 });
        const beforeA = new Set((await readFeatures(A, 'lines')).map((x) => x.id));
        await A.locator('.maplibregl-canvas').first().press('l');
        const box = await A.locator('.maplibregl-canvas').first().boundingBox();
        await A.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.45);
        await A.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.55, { button: 'right' });
        await A.waitForTimeout(2500);
        const newOnA = (await readFeatures(A, 'lines')).filter((x) => !beforeA.has(x.id));
        expect(newOnA, 'owner write blocked while it holds the lock (no new line)').toHaveLength(0);

        // The editor B (independent view, not locked) keeps drawing → it still traverses the
        // WHOLE chain to A (lock blocks local authoring, not inbound sync).
        const fromB = await drawLineUI(B, lineCoords());
        await collab.expectFullSyncFrom(B, { entityId: fromB, type: 'lines', operationType: 'create' });

        // Owner unlocks → its writes work again and traverse the chain to B.
        const unlocked = await applyStoreOp(A, 'toggleMapLock', [mapName]);
        expect(unlocked, 'second toggle unlocks').toBe(false);
        const afterUnlock = await drawLineUI(A, lineCoords());
        await collab.expectFullSync({ entityId: afterUnlock, type: 'lines', operationType: 'create' });
    });
});

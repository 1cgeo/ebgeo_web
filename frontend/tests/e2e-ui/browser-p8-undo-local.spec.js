// Path: e2e-ui/browser-p8-undo-local.spec.js

/**
 * @fileoverview Browser E2E for P8 (undo/redo is LOCAL per user — never includes a remote op).
 *
 * Two real Chromium clients on one shared atlas (via the `collab` fixture):
 *   1. A creates a feature with the REAL point tool (records an entry in A's OWN undo stack;
 *      syncs to B as a REMOTE op) — verified through the FULL chain, not just "it showed up".
 *   2. B receives it. B presses Ctrl+Z — B's undo stack is EMPTY (a received remote op is never
 *      recorded for undo), so A's feature must SURVIVE on both clients (the undo toast says
 *      "Nada para desfazer").
 *   3. A presses Ctrl+Z — undoes A's OWN action; the feature is removed and the inverse delete
 *      syncs to B, again through the full delete chain (gone from both IndexedDBs, tombstoned
 *      in Postgres).
 * This proves undo is strictly local-per-session and never reaches across the collaboration boundary.
 *
 * Step 2 stays a positive-presence assertion on purpose: the negative DSL (`expectNotSynced`)
 * asserts an entity is ABSENT from the peers, which is the exact opposite of what step 2 claims
 * (B's no-op undo must leave the feature intact everywhere). Using it here would invert the test.
 */

import { collabTest, expect, readFeatures, drawPointUI } from './helpers/collab.fixtures.js';
import { readIdbEntity } from './helpers/idb.js';

const hasFeature = async (page, id) => (await readFeatures(page, 'points')).some((x) => x.id === id);

/** Reads the current text of the undo/redo toast channel (the visible `.toast` content). */
const undoToastText = (page) =>
    page.locator('.toast .toast__content span').last().innerText();

collabTest.describe('P8 undo is local per user (two clients, real Chromium)', () => {
    collabTest("B's Ctrl+Z does not undo A's remote feature; A's Ctrl+Z undoes its own", async ({ collab }) => {
        const A = collab.author;
        const B = collab.peers[0];

        // 1. A creates a feature with the REAL point tool (records undo in A's stack; syncs to B).
        const featureId = await drawPointUI(A, [-43.2, -22.9]);
        expect(featureId, "A's point was created by the point tool").toBeTruthy();
        await A.keyboard.press('Escape'); // deactivate the still-active point tool (no stray points)
        await collab.expectFullSync({ entityId: featureId, type: 'points', operationType: 'create' });

        // 2. B presses Ctrl+Z (the real undo gesture; the document-level shortcut handler runs it).
        //    B's undo stack is EMPTY — a received remote op is never recorded — so the undo toast
        //    says "Nada para desfazer" and A's feature must remain on BOTH clients.
        await B.keyboard.press('Control+z');
        await expect.poll(() => undoToastText(B), { timeout: 5000 }).toBe('Nada para desfazer');
        await B.waitForTimeout(800); // allow any (erroneous) delete to propagate
        expect(await hasFeature(B, featureId), "B's undo must NOT remove A's feature").toBe(true);
        expect(await hasFeature(A, featureId), "A's feature must be untouched by B's undo").toBe(true);
        // Ground-truth beyond the in-memory store: an erroneous undo would have persisted a
        // delete, so the feature must still be DURABLY there on both sides (repo, not memoryStore).
        for (const [page, quem] of [[A, 'A'], [B, 'B']]) {
            const row = await readIdbEntity(page, { entityId: featureId, entityType: 'feature', mapId: collab.mapId, storage: 'points' });
            expect(row.found, `${quem} ainda tem a feição no IndexedDB depois do Ctrl+Z de B`).toBe(true);
        }

        // 3. A presses Ctrl+Z — reverts A's OWN action. The undo toast names the reverted action
        //    (NOT "Nada para desfazer"); the feature is removed locally and the inverse delete
        //    traverses the whole chain to B.
        await A.keyboard.press('Control+z');
        await expect.poll(() => undoToastText(A), { timeout: 5000 }).not.toBe('Nada para desfazer');
        await expect.poll(async () => hasFeature(A, featureId), { timeout: 10000 }).toBe(false);
        await collab.expectFullSyncDelete({ entityId: featureId, type: 'points', operationType: 'delete' });
    });
});

// Path: e2e-ui/browser-collab-roundtrip-edit.spec.js

/**
 * ROUND-TRIP EDIT — TWO real browsers + real backend. The bidirectional case the user
 * cares about: one user CREATES a feature, the OTHER user EDITS it, and the change must
 * come BACK to the original user.
 *
 * This exercises the full chain in BOTH directions:
 *   - A creates → the line reaches B through all six links (`expectFullSync`).
 *   - B edits (real attribute panel) → the change travels B → backend → BACK to A through
 *     all six links (`expectFullSyncFrom(B, …)` — author is now B, the verified peer is A).
 *
 * Then it proves the edit actually landed on the ORIGINAL user A, three independent ways:
 * A's live store, A's IndexedDB (via the repository), and the backend Postgres row.
 *
 * Run: npx playwright test browser-collab-roundtrip-edit
 */

import { collabTest, expect, drawLineUI, readFeatures, selectAndRecolorUI, deleteFeatureUI } from './helpers/collab.fixtures.js';
import { readIdbEntity } from './helpers/idb.js';

const LINE_COORDS = [[-43.2, -22.9], [-43.15, -22.85], [-43.1, -22.8]];
const NEW_COLOR = '#0000ff';

collabTest.describe('Round-trip edit — A creates, B edits, A must see the change', () => {
    collabTest('B recolors A’s line → the new color round-trips back to A through the whole chain', async ({ collab }) => {
        const A = collab.author;
        const B = collab.peers[0];

        // A creates the line; it reaches B through all six links.
        const id = await drawLineUI(A, LINE_COORDS);
        expect(id, 'A created the line').toBeTruthy();
        await collab.expectFullSync({ entityId: id, type: 'lines', operationType: 'create' });

        // B edits it through the REAL attribute panel (recolor) — an UPDATE op authored by B.
        await selectAndRecolorUI(B, id, NEW_COLOR);

        // The edit travels B → backend → BACK to A through every link (author=B, peer=A).
        await collab.expectFullSyncFrom(B, { entityId: id, type: 'lines', operationType: 'update' });

        // It is visible on the ORIGINAL user A — live store, IndexedDB, and the backend row all agree.
        await expect
            .poll(async () => (await readFeatures(A, 'lines')).find((x) => x.id === id)?.props?.lineColor, { timeout: 10000 })
            .toMatch(new RegExp(NEW_COLOR, 'i'));

        const idbA = await readIdbEntity(A, { entityId: id, entityType: 'feature', mapId: collab.mapId, storage: 'lines' });
        expect(idbA.found, 'edited line present in A’s IndexedDB').toBe(true);
        expect(String(idbA.props.lineColor).toLowerCase()).toBe(NEW_COLOR.toLowerCase());

        const frow = await collab.db.queryFeatureRow(id);
        expect(String(frow?.properties?.lineColor).toLowerCase()).toBe(NEW_COLOR.toLowerCase());
    });

    collabTest('B deletes A’s line → the delete round-trips back to A (gone everywhere)', async ({ collab }) => {
        const A = collab.author;
        const B = collab.peers[0];

        const id = await drawLineUI(A, LINE_COORDS);
        expect(id, 'A created the line').toBeTruthy();
        await collab.expectFullSync({ entityId: id, type: 'lines', operationType: 'create' });

        // B deletes it via the real UI (Delete key + confirm) — a DELETE op authored by B.
        await deleteFeatureUI(B, id);

        // The delete travels B → backend → BACK to A: gone from both IDBs, tombstoned in Postgres.
        await collab.expectFullSyncDeleteFrom(B, { entityId: id, type: 'lines', operationType: 'delete' });

        // And it is gone from the ORIGINAL user A's live store.
        expect((await readFeatures(A, 'lines')).some((x) => x.id === id)).toBe(false);
    });
});

// Path: e2e-ui/browser-collab-permissions.spec.js

/**
 * PERMISSIONS — dynamic share control across TWO real browsers + real backend. The
 * permission gate was a real bug (the atlas role was ignored on connect), so the
 * DYNAMICS deserve a faithful end-to-end guard:
 *
 *   1. read-only peer: B (read) CANNOT write (guardWrite blocks locally; the owner never
 *      sees the attempt), yet B DOES see the owner's writes.
 *   2. upgrade: the owner promotes B read→write; after B reconnects it CAN edit and the
 *      owner sees it.
 *   3. revoke: the owner removes B's share; B then loses access to the atlas (HTTP denied).
 *
 * NEGATIVE-PATH SPEC — read this before touching an assertion. Cases 1 and 2 assert a write
 * must NOT propagate, so they use `expectNotSynced` (the negative DSL), never `expectFullSync`.
 * Swapping one for the other would leave the test green while proving the OPPOSITE of its
 * name: that a read-only peer's write does reach the owner.
 *
 * Direction matters too. The fixture's `collab.expectNotSynced` reads `ctx.author`/`ctx.peers`
 * as seeded (author = the OWNER, peer = the read-only user), but here the blocked writer is the
 * PEER and the client that must stay clean is the OWNER. There is no `expectNotSyncedFrom` on
 * the fixture (only `expectFullSyncFrom`), so these cases call the exported `expectNotSynced`
 * with an explicitly reversed ctx — the same composition `expectFullSyncFrom` does internally.
 *
 * `expectDrop`/`expectBlockedAt` is deliberately NOT used: `DropReason` (diag/trace-stages.js)
 * has no permission-denied code, because guardWrite blocks inside the store BEFORE any op is
 * dispatched — there is no `preflush.drop` span to match. Asserting a reason that cannot exist
 * would fail for the wrong cause. The absence of the op IS the evidence, and it is checked
 * three ways: no feature on the writer, no `remote.applied` on the owner, nothing in the
 * owner's IndexedDB.
 *
 * Sharing is a backend route (no UI); the seed + setSharePermission drive it via the API.
 *
 * Run headed:  npx playwright test browser-collab-permissions --headed
 */

import { randomUUID } from 'node:crypto';
import {
    collabTest, expect, readFeatures, drawLineUI,
} from './helpers/collab.fixtures.js';
import { setSharePermission } from './helpers/collab-helpers.js';
import { expectNotSynced } from './helpers/full-chain.js';
import { readIdbEntity } from './helpers/idb.js';

const hasLine = async (page, id) => (await readFeatures(page, 'lines')).some((x) => x.id === id);

/** Spread-out line coords so each draw is unambiguous on the canvas. */
const lineCoords = () => [[-43.2, -22.9], [-43.15, -22.85], [-43.1, -22.8]];

/**
 * Drives a no-edit role's BLOCKED authoring attempt with a caller-chosen feature id, so the
 * negative assertions can name the exact entity that must exist NOWHERE (the shared
 * `attemptStoreWriteBlocked` helper mints its own id internally and returns nothing, which
 * only supports a set-diff).
 *
 * Two paths, because the app hides the draw toolbar entirely for a no-edit role (safe view,
 * Frente 8 / D1): when the toolbar is gone there is no UI gesture left to drive, so we exercise
 * the store-level guardWrite directly with a raw addFeature — otherwise the "no new line"
 * assertion would be vacuous (nothing was attempted, so of course nothing appeared). When the
 * toolbar IS present (a locked map rather than the safe view), the real draw gesture runs and
 * the WRITE is what gets gated.
 *
 * @returns {Promise<string|null>} the attempted id, or null when the UI path ran (the tool
 *   mints its own id, unknowable to the caller — those runs rely on the set-diff alone).
 */
async function attemptDrawLineBlockedUI(page, coords, attemptedId) {
    const drawGroup = page.locator('.toolbar-group[data-group-id="draw"] .toolbar-group-btn');
    if (!(await drawGroup.isVisible().catch(() => false))) {
        await page.evaluate(async ({ cs, id }) => {
            const store = await import('/src/js/store/index.js');
            const feature = {
                type: 'Feature',
                id,
                geometry: { type: 'LineString', coordinates: cs },
                properties: { id, nome: 'blocked-attempt', tipo: 'line', visivel: true },
            };
            try {
                await store.addFeature('lines', feature);
            } catch {
                // guardWrite denies a read-only write (returns or throws) → no feature; either is "blocked".
            }
        }, { cs: coords, id: attemptedId });
        return attemptedId;
    }

    await page.evaluate((cs) => {
        const map = globalThis.__ebgeoMap;
        const lngs = cs.map((c) => c[0]); const lats = cs.map((c) => c[1]);
        map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: 100, duration: 0 });
    }, coords);
    await page.waitForTimeout(300);

    await drawGroup.click();
    const btn = page.locator('.toolbar-group[data-group-id="draw"] .toolbar-tool-btn[data-tool-id="line"]');
    await btn.click();
    await page.waitForTimeout(200);

    const pts = await page.evaluate((cs) => {
        const map = globalThis.__ebgeoMap;
        const rect = map.getCanvas().getBoundingClientRect();
        return cs.map(([lng, lat]) => {
            const p = map.project([lng, lat]);
            return { x: Math.round(rect.left + p.x), y: Math.round(rect.top + p.y) };
        });
    }, coords);
    for (let i = 0; i < pts.length - 1; i++) {
        await page.mouse.click(pts[i].x, pts[i].y);
        await page.waitForTimeout(120);
    }
    await page.mouse.click(pts[pts.length - 1].x, pts[pts.length - 1].y, { button: 'right' }); // finish
    await page.keyboard.press('Escape'); // ensure the tool is dismissed afterwards
    return null;
}

/**
 * Asserts a no-edit peer's write attempt died where it was made: nothing new in the writer's
 * own store, nothing new on the owner, and — when the attempted id is known — the full negative
 * chain from the writer to the owner (no remote.applied, absent from the owner's IndexedDB).
 *
 * `before*` are the line-id sets snapshotted BEFORE the attempt; the diff keeps the assertion
 * honest even on the UI path, where the attempted id is unknowable.
 */
async function expectWriteBlocked(collab, { writer, owner, attemptedId, beforeWriter, beforeOwner }) {
    if (attemptedId) {
        // Reversed ctx: the blocked writer is the author of the (non-)op, the owner is the peer
        // that must never see it. `settle` matches the original spec's 4s propagation window.
        await expectNotSynced(
            { ...collab, author: writer, peers: [owner] },
            { entityId: attemptedId, type: 'lines', operationType: 'create' },
            { settle: 4000 },
        );
        // The writer itself must not have persisted it either — guardWrite blocks BEFORE the
        // IndexedDB write, so a local-only survivor would still be a permission failure.
        const own = await readIdbEntity(writer, { entityId: attemptedId, entityType: 'feature', mapId: collab.mapId, storage: 'lines' });
        expect(own.found, 'blocked write must not land in the writer own IndexedDB').toBe(false);
    } else {
        await writer.waitForTimeout(4000);
    }

    const newOnWriter = (await readFeatures(writer, 'lines')).filter((x) => !beforeWriter.has(x.id));
    expect(newOnWriter, 'read-only write is blocked locally (no new line)').toHaveLength(0);
    if (beforeOwner) {
        const newOnOwner = (await readFeatures(owner, 'lines')).filter((x) => !beforeOwner.has(x.id));
        expect(newOnOwner, 'read-only write never reached the owner (no new line)').toHaveLength(0);
    }
}

collabTest.describe('Permissions — peer somente leitura', () => {
    collabTest.use({ collabOptions: { peers: 1, permission: 'read', mapName: 'Mapa Tático' } });

    collabTest('read-only peer cannot write, but sees the owner writes', async ({ collab }) => {
        const A = collab.author;
        const B = collab.peers[0];

        // Owner DRAWS a line through the real tool → read-only B receives it through the WHOLE
        // chain (positive path: a read role still reads, all six links).
        const idA = await drawLineUI(A, lineCoords());
        expect(idA, 'the line tool created a feature on the owner').toBeTruthy();
        await collab.expectFullSync({ entityId: idA, type: 'lines', operationType: 'create' });

        // Read-only B tries to author a line → blocked on B itself (guardWrite), so nothing
        // lands locally and nothing reaches A.
        const beforeB = new Set((await readFeatures(B, 'lines')).map((x) => x.id));
        const beforeA = new Set((await readFeatures(A, 'lines')).map((x) => x.id));
        const attemptedId = await attemptDrawLineBlockedUI(B, lineCoords(), randomUUID());
        await expectWriteBlocked(collab, { writer: B, owner: A, attemptedId, beforeWriter: beforeB, beforeOwner: beforeA });
    });

    collabTest('owner upgrades a read-only peer to write → after reconnect B can edit', async ({ collab }) => {
        const A = collab.author;

        // Read-only: B's authoring attempt is blocked → nothing lands, nothing propagates.
        const beforeB = new Set((await readFeatures(collab.peers[0], 'lines')).map((x) => x.id));
        const attemptedId = await attemptDrawLineBlockedUI(collab.peers[0], lineCoords(), randomUUID());
        await expectWriteBlocked(collab, { writer: collab.peers[0], owner: A, attemptedId, beforeWriter: beforeB });

        // Owner promotes B to write.
        const status = await setSharePermission(A, collab.baseUrl, collab.userA, collab.atlasId, collab.userB.id, 'write');
        expect(status, 'PUT share permission succeeded').toBeLessThan(300);

        // B reconnects (a fresh session picks up the new atlas role); `reopenPeer` swaps the
        // page in place, so `expectFullSyncFrom` below resolves the NEW page.
        const B = await collab.reopenPeer(0);

        // Now B can DRAW through the real tool → the write traverses the whole chain to the owner.
        const idB = await drawLineUI(B, lineCoords());
        expect(await hasLine(B, idB), 'B can write after upgrade').toBe(true);
        await collab.expectFullSyncFrom(B, { entityId: idB, type: 'lines', operationType: 'create' });
    });
});

collabTest.describe('Permissions — revogação de compartilhamento', () => {
    collabTest.use({ collabOptions: { peers: 1, permission: 'write', mapName: 'Mapa Tático' } });

    collabTest('owner revokes a peer → B loses access to the atlas (HTTP denied)', async ({ collab }) => {
        const A = collab.author;
        const B = collab.peers[0];

        // No sync assertion here by design: the claim is an HTTP-layer denial (defense in depth,
        // independent of the live WS), so it is read straight from the atlas route.
        const getAtlasStatus = () => B.evaluate(async ({ base, c, id }) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const api = new ApiClient({ baseUrl: `${base}/api/v1` });
            await api.login(c.username, c.password);
            const res = await fetch(`${base}/api/v1/atlas/${id}`, { headers: { Authorization: `Bearer ${api.getAccessToken()}` } });
            return res.status;
        }, { base: collab.baseUrl, c: collab.userB, id: collab.atlasId });

        // Sanity: while shared, B can read the atlas over HTTP.
        expect(await getAtlasStatus(), 'shared peer can GET the atlas').toBeLessThan(300);

        // Owner revokes B's share.
        const status = await setSharePermission(A, collab.baseUrl, collab.userA, collab.atlasId, collab.userB.id, null);
        expect(status, 'DELETE share succeeded').toBeLessThan(300);

        expect(await getAtlasStatus(), 'revoked peer is denied').toBeGreaterThanOrEqual(400);
    });
});

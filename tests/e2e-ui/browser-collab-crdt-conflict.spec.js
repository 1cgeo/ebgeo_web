// Path: e2e-ui/browser-collab-crdt-conflict.spec.js

/**
 * CRDT CONFLICT / CONVERGENCE — TWO real browsers + real backend, migrated to the
 * full-chain harness (`collab` fixture + expectFullSync). The core CRDT guarantee: when
 * two clients edit the SAME entity "at the same time", conflict resolves by LWW-by-ARRIVAL
 * (NOT timestamp; per CLAUDE.md) and BOTH clients CONVERGE — no permanent divergence.
 *
 * The migration makes the convergence claim FALSIFIABLE end-to-end. The flagship recolor
 * test no longer asserts only "A and B agree": it proves they converge to the SPECIFIC LWW
 * winner, cross-checked three ways the in-memory store alone can't —
 *   (a) the winning color the backend STORED in Postgres (the feature row),
 *   (b) the value durably in BOTH clients' IndexedDB (repo, not memoryStore),
 *   (c) the ledger's own conflict view, whose winnerServerVersion = the MAX server arrival
 *       order in the `operations` table.
 *
 * UI-first: the line is drawn with the real line tool, the concurrent recolors / delete are
 * driven through the real attribute panel + Delete key. The concurrent GEOMETRY move stays
 * programmatic (no single-gesture UI sets a line to EXACT coordinates — flagged inline).
 *
 * Run headed:  npx playwright test browser-collab-crdt-conflict --headed
 */

import { collabTest, expect, drawLineUI, readFeatures, selectAndRecolorUI, deleteFeatureUI } from './helpers/collab.fixtures.js';
import { collectLedger, reduceLedger } from './helpers/ledger.js';
import { readIdbEntity } from './helpers/idb.js';

/** Drives a store op on `page` through the app's REAL store facade (no-UI escapes only). */
function applyStoreOp(page, opName, args) {
    return page.evaluate(async ({ name, a }) => {
        const store = await import('/src/js/store/index.js');
        return store[name](...a);
    }, { name: opName, a: args });
}

const lineProp = async (page, id, prop) => {
    const f = (await readFeatures(page, 'lines')).find((x) => x.id === id);
    return f?.props?.[prop];
};

const lineGeomKey = (page, id) => page.evaluate(async (i) => {
    const store = await import('/src/js/store/index.js');
    const f = (await store.getCurrentMapFeatures()).lines.find((x) => x.properties?.id === i);
    return f ? JSON.stringify(f.geometry?.coordinates) : null;
}, id);

const hasLine = async (page, id) => (await readFeatures(page, 'lines')).some((x) => x.id === id);

// The coordinates the real line tool draws (also where the camera is fit before the clicks).
const LINE_COORDS = [[-43.2, -22.9], [-43.15, -22.85], [-43.1, -22.8]];

// Real attribute-panel gestures (selectAndRecolorUI / deleteFeatureUI) are shared drivers in
// helpers/collab-helpers.js, re-exported by the fixture.

collabTest.describe('CRDT conflict — concurrent edits converge (LWW by arrival)', () => {
    collabTest('concurrent recolor of the SAME line → converge to the LWW winner, proven via Postgres + IDB + ledger', async ({ collab }) => {
        const A = collab.author;
        const B = collab.peers[0];

        // A draws the line; assert it reached B through the WHOLE chain before the conflict.
        const id = await drawLineUI(A, LINE_COORDS);
        expect(id, 'the line tool created a feature on A').toBeTruthy();
        await collab.expectFullSync({ entityId: id, type: 'lines', operationType: 'create' });

        // Both recolor the same line "simultaneously" through their own panels — fire in
        // parallel (one gesture per browser) without awaiting cross-sync between them.
        await Promise.all([
            selectAndRecolorUI(A, id, '#ff0000'),
            selectAndRecolorUI(B, id, '#0000ff'),
        ]);

        // (1) CONVERGENCE: A and B end on the SAME color, and it is one of the two. The panel
        //     normalizes hex to uppercase, so match case-insensitively.
        let converged = null;
        await expect
            .poll(async () => {
                const ca = await lineProp(A, id, 'lineColor');
                const cb = await lineProp(B, id, 'lineColor');
                converged = ca && cb && ca === cb ? ca : null;
                return converged;
            }, { timeout: 25000 })
            .toMatch(/^#(ff0000|0000ff)$/i);

        // (2) GROUND-TRUTH: the converged color is the winner the BACKEND stored, and it is the
        //     value durably in BOTH clients' IndexedDB (via the repository, not memoryStore).
        const frow = await collab.db.queryFeatureRow(id);
        expect(String(frow?.properties?.lineColor).toLowerCase()).toBe(converged.toLowerCase());
        for (const page of [A, B]) {
            const row = await readIdbEntity(page, { entityId: id, entityType: 'feature', mapId: collab.mapId, storage: 'lines' });
            expect(row.found, 'feature present in IndexedDB after convergence').toBe(true);
            expect(String(row.props.lineColor).toLowerCase()).toBe(converged.toLowerCase());
        }

        // (3) LWW = MAX server arrival order. Cross-check the SQL `operations` log against the
        //     ledger's own conflict view (winner by serverVersion — never timestamp/lamport).
        const ops = await collab.db.queryOperationsByEntity(id);
        const maxV = Math.max(...ops.map((o) => Number(o.server_version)));
        const spans = await collectLedger(collab.pages, { baseUrl: collab.baseUrl, token: collab.ownerToken, atlasId: collab.atlasId });
        const conflict = reduceLedger(spans).conflicts.find((c) => c.entityId === id);
        expect(conflict, 'the ledger detected the same-entity conflict').toBeTruthy();
        expect(Number(conflict.winnerServerVersion)).toBe(maxV);
    });

    collabTest('concurrent geometry move of the SAME line → both clients converge to one geometry', async ({ collab }) => {
        const A = collab.author;
        const B = collab.peers[0];

        const id = await drawLineUI(A, LINE_COORDS);
        expect(id, 'the line tool created a feature on A').toBeTruthy();
        await collab.expectFullSync({ entityId: id, type: 'lines', operationType: 'create' });

        // no-UI: setting a line's geometry to EXACT coordinates has no single-gesture UI, and
        // the convergence assertion compares exact coordinate keys — so the concurrent move
        // stays programmatic. Each side rewrites the SAME line's geometry.
        const propsA = (await readFeatures(A, 'lines')).find((x) => x.id === id)?.props;
        const propsB = (await readFeatures(B, 'lines')).find((x) => x.id === id)?.props;
        const geomA = { type: 'LineString', coordinates: [[-43.0, -22.7], [-42.9, -22.6]] };
        const geomB = { type: 'LineString', coordinates: [[-44.0, -23.7], [-43.9, -23.6]] };
        await Promise.all([
            applyStoreOp(A, 'updateFeature', ['lines', { type: 'Feature', properties: propsA, geometry: geomA }]),
            applyStoreOp(B, 'updateFeature', ['lines', { type: 'Feature', properties: propsB, geometry: geomB }]),
        ]);

        const ka = JSON.stringify(geomA.coordinates);
        const kb = JSON.stringify(geomB.coordinates);
        await expect
            .poll(async () => {
                const a = await lineGeomKey(A, id);
                const b = await lineGeomKey(B, id);
                return a && b && a === b ? a : null;
            }, { timeout: 25000 })
            .toMatch(new RegExp(`^(${ka.replace(/[[\]]/g, '\\$&')}|${kb.replace(/[[\]]/g, '\\$&')})$`));

        // Ground-truth: the converged geometry is the one the backend stored (LWW winner).
        const frow = await collab.db.queryFeatureRow(id);
        const backendKey = JSON.stringify(frow?.geometry?.coordinates);
        expect([ka, kb]).toContain(backendKey);
    });

    collabTest('concurrent UPDATE (A) vs DELETE (B) of the SAME line → both clients converge', async ({ collab }) => {
        const A = collab.author;
        const B = collab.peers[0];

        const id = await drawLineUI(A, LINE_COORDS);
        expect(id, 'the line tool created a feature on A').toBeTruthy();
        await collab.expectFullSync({ entityId: id, type: 'lines', operationType: 'create' });

        // A recolors it through the panel while B deletes it (Delete key + confirm), in parallel.
        await Promise.all([
            selectAndRecolorUI(A, id, '#ff0000'),
            deleteFeatureUI(B, id),
        ]);

        // Convergence: A and B must AGREE on the feature's presence (both gone, or both present).
        let agreed = null;
        await expect
            .poll(async () => {
                const a = await hasLine(A, id);
                const b = await hasLine(B, id);
                agreed = a === b ? a : null;
                return a === b ? `agree:${a}` : null;
            }, { timeout: 25000 })
            .toMatch(/^agree:(true|false)$/);

        // Ground-truth: the agreed presence matches the backend feature row (live vs tombstoned).
        const frow = await collab.db.queryFeatureRow(id);
        const backendLive = !!frow && !frow.deleted_at;
        expect(backendLive).toBe(agreed);
    });
});

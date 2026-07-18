// Path: e2e-ui/browser-collab-full-chain.spec.js

/**
 * CANONICAL full-chain spec — the reference template for robust multi-user tests.
 *
 * Every assertion here drives the REAL app (real backend, real Postgres, real browsers)
 * and verifies, for ONE operation, the ENTIRE sync chain end-to-end via `collab.expectFullSync`:
 *
 *   1. wrote to the AUTHOR's IndexedDB           (apply.persist + repo.getMap)
 *   2. transport carried it to the backend       (push.ack)
 *   3. the backend STORED it                      (server.inserted/applied + SQL row)
 *   4. the signal was relayed to the peers        (server.broadcast + ws.inbound)
 *   5. it synced into the PEERS' IndexedDB        (apply.persist + repo.getMap)
 *   6. it appeared in the PEERS' browser          (remote.applied + render.source)
 *
 * On any break, the error names the EXACT link and dumps each actor's stage trail.
 *
 * Copy this file to start a new collab spec: import { collabTest, drawXUI } from the
 * fixture, drive the UI, call expectFullSync/expectFullSyncDelete. Scale to N peers with
 * `collabTest.use({ collabOptions: { peers: 2 } })`.
 *
 * Run: npx playwright test browser-collab-full-chain
 */

import { collabTest, expect, drawLineUI, drawPointUI } from './helpers/collab.fixtures.js';
import { readIdbEntity } from './helpers/idb.js';

const CENTER = { lng: -43.2, lat: -22.9 };

/** Renames a feature via the app's real store op (no-UI escape hatch → an UPDATE op). */
function renameFeature(page, type, id, nome) {
    return page.evaluate(async (q) => {
        const store = await import('/src/js/store/index.js');
        const f = await store.getFeatureById(q.type, q.id);
        if (!f) return false;
        f.properties = { ...f.properties, nome: q.nome };
        await store.updateFeature(q.type, f);
        return true;
    }, { type, id, nome });
}

/** Deletes a feature via the app's real store op → a DELETE op. */
function deleteFeature(page, type, id) {
    return page.evaluate(async (q) => {
        const store = await import('/src/js/store/index.js');
        await store.removeFeature(q.type, q.id);
    }, { type, id });
}

collabTest.describe('Full chain — create / update / delete across the whole pipeline', () => {
    collabTest('a line CREATE traverses all six links to the peer', async ({ collab }) => {
        const coords = [
            [CENTER.lng - 0.02, CENTER.lat - 0.01],
            [CENTER.lng + 0.01, CENTER.lat + 0.005],
            [CENTER.lng + 0.03, CENTER.lat - 0.008],
        ];
        const id = await drawLineUI(collab.author, coords);
        expect(id, 'the line tool created a feature').toBeTruthy();

        await collab.expectFullSync({ entityId: id, type: 'lines', operationType: 'create' });
    });

    collabTest('an UPDATE (rename) traverses the chain and the new value lands in the peer IDB', async ({ collab }) => {
        const coords = [
            [CENTER.lng - 0.02, CENTER.lat],
            [CENTER.lng + 0.02, CENTER.lat + 0.01],
        ];
        const id = await drawLineUI(collab.author, coords);
        await collab.expectFullSync({ entityId: id, type: 'lines', operationType: 'create' });

        const ok = await renameFeature(collab.author, 'lines', id, 'Renomeada via chain');
        expect(ok).toBe(true);
        await collab.expectFullSync({ entityId: id, type: 'lines', operationType: 'update' });

        // Ground-truth: the renamed value is the one durably in the peer's IndexedDB.
        const peerRow = await readIdbEntity(collab.peers[0], { entityId: id, entityType: 'feature', mapId: collab.mapId, storage: 'lines' });
        expect(peerRow.found).toBe(true);
        expect(peerRow.props.nome).toBe('Renomeada via chain');
    });

    collabTest('a DELETE traverses the chain — gone from both IDBs, tombstoned in Postgres', async ({ collab }) => {
        const id = await drawPointUI(collab.author, [CENTER.lng, CENTER.lat]);
        await collab.expectFullSync({ entityId: id, type: 'points', operationType: 'create' });

        await deleteFeature(collab.author, 'points', id);
        await collab.expectFullSyncDelete({ entityId: id, type: 'points', operationType: 'delete' });
    });
});

collabTest.describe('Full chain — three-client fan-out', () => {
    // author + 2 peers: expectFullSync verifies EVERY peer received the op.
    collabTest.use({ collabOptions: { peers: 2, permission: 'write', mapName: 'Mapa Tático' } });

    collabTest('a point CREATE reaches BOTH peers through the whole chain', async ({ collab }) => {
        expect(collab.peers).toHaveLength(2);
        const id = await drawPointUI(collab.author, [CENTER.lng + 0.01, CENTER.lat - 0.01]);
        await collab.expectFullSync({ entityId: id, type: 'points', operationType: 'create' });

        // Session-wide net: no IndexedDB write the pipeline claimed went unconfirmed
        // (author apply.persist for every enqueue; peer apply.persist for every remote apply).
        await collab.assertChainClean();
    });
});

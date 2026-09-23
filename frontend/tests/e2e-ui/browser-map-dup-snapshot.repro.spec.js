// Path: e2e-ui/browser-map-dup-snapshot.repro.spec.js

/**
 * REGRESSION — a map created LOCALLY while connected to a remote atlas must NOT duplicate
 * when a snapshot is re-applied (reconnect sync_request / resync after a peer's
 * import-merge-rename / a snapshot-bearing pull).
 *
 * Root cause (fixed): createMapCompat generated a sync UUID but `saveMap(name)` stored the
 * map NAME-keyed (overwriting the UUID with the name key), while the op + resolver carried
 * the UUID. A later `applyRemoteSnapshot` did `saveMap(UUID)` → `_resolveMapKey(UUID)`
 * returns the UUID as-is → a SECOND entry under the UUID key for the same logical map. Fix:
 * when sync is active, addMap stores the map UUID-keyed from the start, so the snapshot
 * `saveMap(UUID)` updates the SAME entry. (Found via the full-chain harness's author IDB
 * ground-truth read.)
 *
 * Run:  npx playwright test browser-map-dup-snapshot.repro
 */

import { collabTest, expect } from './helpers/collab.fixtures.js';
import { clienteNaPagina } from './helpers/cliente-de-teste.js';

/**
 * Waits until the author's outbound queue is EMPTY, i.e. every op of the gesture was acked.
 *
 * WHY THE WAIT EXISTS. The snapshot re-applied below has to be taken AFTER the server confirmed the
 * gesture: `applyRemoteSnapshot` refuses a snapshot older than an ack the client already holds
 * ("O retrato recebido é anterior a uma alteração já confirmada"), and a snapshot without the new
 * map does not exercise the duplicate at all. Until 2026-09-23 the in-page `login()` that preceded
 * the pull was an implicit wait (a bcrypt round trip); with the client coming ready from
 * `clienteNaPagina`, the pull raced the flush and the addMap case failed 5 of 6 in Firefox (the
 * version with the login passed 6 of 6). Waiting for the acks is the condition the case always
 * needed, now written down instead of borrowed from a login.
 * @param {import('@playwright/test').Page} page
 */
async function esperarFilaVazia(page) {
    await expect.poll(() => page.evaluate(async () =>
        (await import('/src/js/session/unsynced-work-exit.js')).countPendingOperations()), {
        timeout: 30000,
        message: 'the gesture ops were acked by the server before the snapshot pull',
    }).toBe(0);
}

collabTest.describe('Regression — local map does not duplicate on snapshot re-apply', () => {
    collabTest('addMap (connected) + applyRemoteSnapshot → exactly ONE map entry, UUID-keyed', async ({ collab }) => {
        const A = collab.author;
        const criado = await A.evaluate(async () => {
            const store = await import('/src/js/store/index.js');
            const NAME = 'Mapa Repro ' + crypto.randomUUID().slice(0, 6);
            const created = await store.addMap(NAME);
            return { NAME, uuid: created.id };
        });
        await esperarFilaVazia(A);
        const result = await A.evaluate(async ({ api, atlasId, NAME, uuid }) => {
            const { applyRemoteSnapshot } = await import('/src/js/store/sync/remote-operation-handler.js');
            const { getRepository } = await import('/src/js/store/repositories/index.js');

            // Re-apply the backend snapshot (simulates a reconnect/resync re-pull) while the
            // just-created map is present locally — the exact trigger of the duplicate.
            const snap = await api.pullSync(atlasId, 0);
            await applyRemoteSnapshot(snap.snapshot || snap);

            const all = await getRepository().getAllMaps();
            const entries = Array.from(all.entries()).map(([key, m]) => ({ key, name: m && m.name }));
            return {
                uuid,
                NAME,
                snapshotHasMap: ((snap.snapshot || snap).maps || []).some((m) => m.id === uuid),
                withName: entries.filter((e) => e.name === NAME),
                getMapByName: !!(await getRepository().getMap(NAME)),
                getMapByUuid: !!(await getRepository().getMap(uuid)),
            };
        }, { api: await clienteNaPagina(A, collab.userA), atlasId: collab.atlasId, ...criado });

        // The re-applied snapshot CARRIES the new map: without it the case would not reach the
        // duplicate at all, and the assertions below would pass on a snapshot that never saw it.
        expect(result.snapshotHasMap, 'the re-applied snapshot carries the new map').toBe(true);
        // No duplicate: exactly ONE entry for the logical map, keyed by its sync UUID.
        expect(
            result.withName,
            `expected exactly one map entry named "${result.NAME}", got: ${JSON.stringify(result.withName)}`,
        ).toHaveLength(1);
        expect(result.withName[0].key, 'the surviving entry is UUID-keyed').toBe(result.uuid);
        // It resolves both by name (app-facing) and by UUID (sync-facing) — to the same single entry.
        expect(result.getMapByName).toBe(true);
        expect(result.getMapByUuid).toBe(true);
    });

    // The duplicate-map flow (mapManager.copyMap → regenerateMapIds sets id=null → addMap) and the
    // .ebgeo import flow (no id supplied → addMap) BOTH route through the same fixed addMap path, so
    // they inherit the UUID-keying. This pins the duplicate entry point end-to-end.
    collabTest('copyMap (duplicate, connected) + applyRemoteSnapshot → exactly ONE entry, UUID-keyed', async ({ collab }) => {
        const A = collab.author;
        const copia = await A.evaluate(async ({ srcMap }) => {
            const store = await import('/src/js/store/index.js');
            const { getRepository } = await import('/src/js/store/repositories/index.js');

            const NAME = 'Cópia ' + crypto.randomUUID().slice(0, 6);
            const mgr = store.getControl('MapManager');
            const res = await mgr.copyMap(srcMap, NAME);

            // Resolve the duplicated map's storage key (UUID with the fix).
            const all0 = await getRepository().getAllMaps();
            const entry0 = Array.from(all0.entries()).find(([, m]) => m && m.name === NAME);
            return { copyOk: res?.success, NAME, uuid: entry0 ? entry0[0] : null };
        }, { srcMap: collab.mapName });
        await esperarFilaVazia(A);
        const result = await A.evaluate(async ({ api, atlasId, copyOk, NAME, uuid }) => {
            const { applyRemoteSnapshot } = await import('/src/js/store/sync/remote-operation-handler.js');
            const { getRepository } = await import('/src/js/store/repositories/index.js');

            // Re-apply the backend snapshot (simulates reconnect/resync — note: a peer's duplicate
            // is exactly what triggers resync() in the wild).
            const snap = await api.pullSync(atlasId, 0);
            await applyRemoteSnapshot(snap.snapshot || snap);

            const all = await getRepository().getAllMaps();
            const withName = Array.from(all.entries())
                .map(([key, m]) => ({ key, name: m && m.name }))
                .filter((e) => e.name === NAME);
            const snapshotHasMap = ((snap.snapshot || snap).maps || []).some((m) => m.id === uuid);
            return { copyOk, NAME, uuid, withName, snapshotHasMap };
        }, { api: await clienteNaPagina(A, collab.userA), atlasId: collab.atlasId, ...copia });

        expect(result.copyOk, 'copyMap succeeded').toBe(true);
        expect(result.snapshotHasMap, 'the re-applied snapshot carries the copied map').toBe(true);
        expect(
            result.withName,
            `expected exactly one map entry named "${result.NAME}", got: ${JSON.stringify(result.withName)}`,
        ).toHaveLength(1);
        expect(result.withName[0].key, 'the duplicated entry is UUID-keyed').toBe(result.uuid);
    });
});

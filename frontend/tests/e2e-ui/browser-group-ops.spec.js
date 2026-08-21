// Path: e2e-ui/browser-group-ops.spec.js

/**
 * Group lifecycle + group_feature membership.
 *
 * Test 1 (group create → update → delete) is driven UI-FIRST: two member features are
 * drawn with the REAL point/line tools, then the group is created / renamed-hidden /
 * removed through the app's REAL store facade (the same ops "Criar Grupo" / the group
 * toggles / "Desagrupar" invoke), and every assertion reads the live app store
 * (getMapGroups + getCurrentMapFeatures).
 *
 * Test 2 (group_feature link/unlink + EXISTS edge) stays a backend transport probe:
 * `group_feature` is a SERVER-ONLY join with NO client EntityType / factory and NO UI
 * gesture (linking a phantom id has no UI at all), so its wire envelope is hand-built and
 * asserted against the persisted `pullSync` snapshot. See the no-UI note on that test.
 *
 * The atlas/map/share SETUP is API-only (sharing has no UI); login + open + the test-1
 * gestures are real UI.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { seedSharedAtlas, openClient, drawPointUI, drawLineUI } from './helpers/collab-helpers.js';
import { createVerifiedUser } from './helpers/accounts.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** Drives a store op on `page` through the app's REAL store facade. */
function applyStoreOp(page, opName, args) {
    return page.evaluate(async ({ name, a }) => {
        const store = await import('/src/js/store/index.js');
        return store[name](...a);
    }, { name: opName, a: args });
}

/**
 * Reads the live app store's ACTIVE group by id (or null). getMapGroups returns an
 * object keyed by id and includes soft-deleted groups, so we drop deleted ones
 * (sync.deleted) — mirroring getGroupById, which is not on the facade barrel.
 */
function readGroup(page, groupId) {
    return page.evaluate(async (gid) => {
        const store = await import('/src/js/store/index.js');
        const g = (store.getMapGroups() || {})[gid];
        return g && !g.sync?.deleted
            ? { id: g.id, name: g.name, visible: g.visible, members: (g.features || []).map((f) => f.id) }
            : null;
    }, groupId);
}

describeOrSkip('Group ops + group_feature membership (real Chromium + real backend)', () => {
    test('group create → update → delete round-trips through the live store', async ({ browser }) => {
        const seed = await seedSharedAtlas(browser, state.baseUrl);
        const page = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA);

        try {
            // Two real member features (the group needs >= 2), drawn through the real tools.
            const pointId = await drawPointUI(page, [-43.2, -22.9]);
            const lineId = await drawLineUI(page, [[-43.2, -22.9], [-43.1, -22.8]]);
            expect(pointId).toBeTruthy();
            expect(lineId).toBeTruthy();

            // 1. CREATE the group over the two drawn features (the "Criar Grupo" store op;
            //    canvas multi-select is unreliable headless — see layers-tab-local.spec.js).
            const created = await page.evaluate(async ({ pid, lid }) => {
                const store = await import('/src/js/store/index.js');
                const f = await store.getCurrentMapFeatures();
                const pt = (f.points || []).find((x) => x.properties?.id === pid);
                const ln = (f.lines || []).find((x) => x.properties?.id === lid);
                const g = store.createGroup([pt, ln]);
                return g ? { id: g.id } : null;
            }, { pid: pointId, lid: lineId });
            expect(created?.id).toBeTruthy();
            const groupId = created.id;
            const afterCreate = await readGroup(page, groupId);

            // 2. UPDATE — rename + hide via the real group-property store op.
            await applyStoreOp(page, 'updateGroupProperty', [groupId, 'name', 'Alpha-Renamed']);
            await applyStoreOp(page, 'updateGroupProperty', [groupId, 'visible', false]);
            const afterUpdate = await readGroup(page, groupId);

            // 3. DELETE (ungroup) — the group must vanish from the store while its members
            //    survive (the real "Desagrupar" store op).
            await applyStoreOp(page, 'ungroupFeatures', [groupId, seed.mapName]);
            const afterDelete = await readGroup(page, groupId);

            // CREATE materialised the group with both members; defaults visible.
            expect(afterCreate).toBeTruthy();
            expect(afterCreate.visible).toBe(true);
            expect(afterCreate.members).toEqual(expect.arrayContaining([pointId, lineId]));
            // UPDATE merged the rename + visibility patch.
            expect(afterUpdate.name).toBe('Alpha-Renamed');
            expect(afterUpdate.visible).toBe(false);
            // DELETE removed it from the store.
            expect(afterDelete).toBeNull();

            // Members survive ungrouping as loose features.
            const survivors = await page.evaluate(async ({ pid, lid }) => {
                const store = await import('/src/js/store/index.js');
                const f = await store.getCurrentMapFeatures();
                return {
                    point: (f.points || []).some((x) => x.properties?.id === pid),
                    line: (f.lines || []).some((x) => x.properties?.id === lid),
                };
            }, { pid: pointId, lid: lineId });
            expect(survivors.point).toBe(true);
            expect(survivors.line).toBe(true);
        } finally {
            await page.context().close();
        }
    });

    test('group_feature link then unlink: membership appears, then is removed (group + feature survive)', async ({
        page,
    }) => {
        // no-UI: `group_feature` is a SERVER-ONLY join table with no frontend EntityType,
        // no client factory and no UI gesture (and linking a non-existent feature, the
        // EXISTS-guard edge, has no UI at all). This test asserts the raw wire-envelope
        // contract + EXISTS guard against the persisted snapshot, so it stays a pure
        // transport probe driven via page.evaluate against the backend.
        const user = await createVerifiedUser({ prefix: 'gf', nome: 'GroupFeature User' });
        await page.goto('/');

        const result = await page.evaluate(async ({ baseUrl, u }) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

            const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
            await api.login(u.username, u.password);

            const atlas = await api.createAtlas({ name: 'GroupFeature Atlas' });
            const mapId = crypto.randomUUID();
            await api.pushOperations(atlas.id, [createOperation('map', 'create', mapId, null, { name: 'M1' })]);

            // A real feature to link.
            const featureId = crypto.randomUUID();
            await api.pushOperations(atlas.id, [
                createOperation('feature', 'create', featureId, mapId, {
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
                    properties: { id: featureId, source: 'point', nome: 'Member Point' },
                }),
            ]);

            // The group that will own it.
            const groupId = crypto.randomUUID();
            await api.pushOperations(atlas.id, [
                createOperation('group', 'create', groupId, mapId, { name: 'Bravo', visible: true }),
            ]);

            // `group_feature` has no client factory (not in EntityType); hand-build the
            // wire-shape op the backend accepts. The backend reads data.group_id /
            // data.feature_id; entityId is a filler the apply path ignores for this target.
            const linkOp = (opType, fid) => ({
                id: crypto.randomUUID(),
                entityType: 'group_feature',
                operationType: opType,
                // The operations log stores entity_id as a UUID; the real association
                // travels in data.{group_id,feature_id}, so the link op carries its own uuid.
                entityId: crypto.randomUUID(),
                mapId,
                data: { group_id: groupId, feature_id: fid },
                timestamp: Date.now(),
                lamportTimestamp: 1,
                clientId: 'gf-driver',
            });

            // Reads the current membership refs for the group, plus survival flags.
            const readState = async () => {
                const pulled = await api.pullSync(atlas.id, 0);
                const map = pulled.snapshot?.maps?.find((m) => m.id === mapId);
                const group = (map?.groups || []).find((g) => g.id === groupId) || null;
                const featureAlive = (map?.features?.points || []).some(
                    (p) => p.properties.id === featureId,
                );
                return {
                    groupAlive: group !== null,
                    refs: group?.features || [],
                    featureAlive,
                };
            };

            // 1. LINK.
            await api.pushOperations(atlas.id, [linkOp('create', featureId)]);
            const afterLink = await readState();

            // 2. NEGATIVE/EDGE: link a feature that does NOT exist in the atlas. The
            //    backend EXISTS guard drops it silently (ack, no membership ref added).
            const ghostFeatureId = crypto.randomUUID();
            await api.pushOperations(atlas.id, [linkOp('create', ghostFeatureId)]);
            const afterGhost = await readState();

            // 3. UNLINK the real feature.
            await api.pushOperations(atlas.id, [linkOp('delete', featureId)]);
            const afterUnlink = await readState();

            return {
                linkRefIds: afterLink.refs.map((r) => r.id),
                linkRefHasType: afterLink.refs.every((r) => r.type !== null && r.type !== undefined),
                ghostRefIds: afterGhost.refs.map((r) => r.id),
                ghostFeatureId,
                unlinkRefIds: afterUnlink.refs.map((r) => r.id),
                groupSurvived: afterUnlink.groupAlive,
                featureSurvived: afterUnlink.featureAlive,
                featureId,
            };
        }, { baseUrl: state.baseUrl, u: user });

        // LINK: the group's features[] gains exactly the linked feature, with a resolved type.
        expect(result.linkRefIds).toContain(result.featureId);
        expect(result.linkRefHasType).toBe(true);

        // NEGATIVE/EDGE: the dangling link to a non-existent feature is NOT persisted —
        // membership still contains only the real feature, never the ghost.
        expect(result.ghostRefIds).toContain(result.featureId);
        expect(result.ghostRefIds).not.toContain(result.ghostFeatureId);

        // UNLINK: the membership ref is gone...
        expect(result.unlinkRefIds).not.toContain(result.featureId);
        // ...but BOTH the group and the feature themselves survive the unlink.
        expect(result.groupSurvived).toBe(true);
        expect(result.featureSurvived).toBe(true);
    });
});

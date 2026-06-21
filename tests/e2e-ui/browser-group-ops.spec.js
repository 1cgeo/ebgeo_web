// Path: e2e-ui/browser-group-ops.spec.js

/**
 * Browser-level group lifecycle + group_feature membership test. Drives the REAL
 * frontend transport (api-client / operation-factory) imported live from the Vite
 * dev server inside real Chromium, against the REAL spawned backend. Single client;
 * each test mints its OWN user + atlas + map for full isolation, and every assertion
 * is read back from the persisted snapshot via a REAL HTTP `pullSync` round-trip.
 *
 * Proves three frozen sync contracts end to end, with REAL HTTP round-trips:
 *   1. Group create/update/delete — a `group` `create` op materialises a group in the
 *      snapshot's `map.groups`; a `group` `update` op merges `name`/`visible` changes;
 *      a `group` `delete` op soft-deletes it so it disappears from the snapshot.
 *   2. group_feature link/unlink — a `group_feature` `create` op links a feature into a
 *      group (the group's `features[]` array gains a `{ type, id }` ref); a
 *      `group_feature` `delete` op unlinks it (the ref disappears) while BOTH the group
 *      and the feature themselves survive.
 *   3. Membership reflection — `map.groups[].features` reflects exactly the current set
 *      of links: present after linking, absent after unlinking.
 *
 * `group_feature` is NOT in the frozen frontend `EntityType` enum (it has no
 * client-side factory), so its op is hand-built in the wire shape the backend's
 * `normalizeOperation` accepts: `{ id, entityType, operationType, entityId, mapId,
 * data: { group_id, feature_id } }`. The backend reads `data.group_id`/`data.feature_id`
 * directly and ignores `entityId` for that target.
 *
 * Negative/edge: a `group_feature` link whose `feature_id` does NOT exist in the atlas
 * is gated out by the backend's EXISTS guard — it ack's without error but produces NO
 * membership ref, so the dangling link never appears in the snapshot.
 *
 * No UI clicks: the transport is exercised purely via `page.evaluate`, so there are no
 * data-testid selectors. Backend feature shape is GeoJSON with the type in
 * `properties.source`.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

describeOrSkip('Group ops + group_feature membership (real Chromium + real backend)', () => {
    test('group create → update → delete round-trips through the snapshot', async ({ page }) => {
        await page.goto('/');

        const result = await page.evaluate(async (baseUrl) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

            const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
            const username = `grp_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
            const password = 'Sup3r-Secret-Pw!';
            await api.register({ username, password, nome: 'Group User' });
            await api.login(username, password);

            const atlas = await api.createAtlas({ name: 'Group Atlas' });
            const mapId = crypto.randomUUID();
            await api.pushOperations(atlas.id, [createOperation('map', 'create', mapId, null, { name: 'M1' })]);

            // Find a group by id inside the freshly pulled snapshot.
            const readGroup = async (gid) => {
                const pulled = await api.pullSync(atlas.id, 0);
                const map = pulled.snapshot?.maps?.find((m) => m.id === mapId);
                const groups = map?.groups || [];
                return groups.find((g) => g.id === gid) || null;
            };

            const groupId = crypto.randomUUID();
            // 1. CREATE.
            await api.pushOperations(atlas.id, [
                createOperation('group', 'create', groupId, mapId, {
                    name: 'Alpha', visible: true,
                }),
            ]);
            const afterCreate = await readGroup(groupId);

            // 2. UPDATE — rename + hide. The frontend factory puts the patch in `data`;
            //    the backend's update path reads it as `changes`.
            await api.pushOperations(atlas.id, [
                createOperation('group', 'update', groupId, mapId, {
                    name: 'Alpha-Renamed', visible: false,
                }),
            ]);
            const afterUpdate = await readGroup(groupId);

            // 3. DELETE (soft) — must vanish from the snapshot's groups.
            await api.pushOperations(atlas.id, [
                createOperation('group', 'delete', groupId, mapId, null),
            ]);
            const afterDelete = await readGroup(groupId);

            return {
                createdName: afterCreate?.name ?? null,
                createdVisible: afterCreate?.visible ?? null,
                updatedName: afterUpdate?.name ?? null,
                updatedVisible: afterUpdate?.visible ?? null,
                deletedPresent: afterDelete !== null,
            };
        }, state.baseUrl);

        // CREATE materialised the group with its initial fields.
        expect(result.createdName).toBe('Alpha');
        expect(result.createdVisible).toBe(true);
        // UPDATE merged the rename + visibility patch.
        expect(result.updatedName).toBe('Alpha-Renamed');
        expect(result.updatedVisible).toBe(false);
        // DELETE soft-removed it from the snapshot.
        expect(result.deletedPresent).toBe(false);
    });

    test('group_feature link then unlink: membership appears, then is removed (group + feature survive)', async ({
        page,
    }) => {
        await page.goto('/');

        const result = await page.evaluate(async (baseUrl) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

            const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
            const username = `gf_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
            const password = 'Sup3r-Secret-Pw!';
            await api.register({ username, password, nome: 'GroupFeature User' });
            await api.login(username, password);

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
        }, state.baseUrl);

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

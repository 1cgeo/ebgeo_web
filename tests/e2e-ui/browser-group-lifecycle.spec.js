// Path: e2e-ui/browser-group-lifecycle.spec.js

/**
 * Browser-level group lifecycle transport test. Drives the REAL frontend transport
 * (api-client / operation-factory) imported live from the Vite dev server inside real
 * Chromium, against the REAL spawned backend. Every assertion is grounded in the
 * persisted `pullSync` snapshot's `map.groups[]` (with its server-built `features[]`
 * membership array) or `map.features.*` buckets — never a vacuous truthy check.
 *
 * Covers docs/acoes-interface-multiusuario.md §14.3-5 + §2.26-27,30:
 *   - §14.3 create group (`group create`), with two features and `group_feature`
 *     links combining them into the group;
 *   - §2.26 group visibility toggle (`group update {visible}`) and §2.27 group lock
 *     (`group update {locked}`), both reflected on the snapshot group flags;
 *   - §14.4 combine style update (`group update {style}`);
 *   - §2.30 "drag group to another layer": a group has NO `layer_id` column (the
 *     UPDATE whitelist is name/visible/locked/style/parent_id), so the move is the
 *     member FEATURES changing `properties.layerId` (`feature update`), which the
 *     backend persists as the `layer_id` column. A `layerId` smuggled on a GROUP
 *     update is silently ignored (negative/whitelist assertion);
 *   - §14.5 ungroup: unlink every `group_feature` + soft-delete the `group` in one
 *     atomic push; the group vanishes from the snapshot while its member features
 *     SURVIVE as loose features (the core "members survive" guarantee);
 *   - edge: linking a non-existent feature id inserts no phantom member (EXISTS gate).
 *
 * Op shapes mirror the passing headless twins tests/e2e/group-ops.e2e.test.js and
 * tests/e2e/group-combine-ungroup.e2e.test.js and the backend sync.service.js
 * (UPDATE_FIELDS.group whitelist, group_feature INSERT/DELETE EXISTS gates). The
 * `group_feature` join is server-only (NOT a frontend EntityType — createOperation
 * would reject it), so its push envelope is hand-built exactly as the backend's
 * normalizeOperation consumes it: { entityType:'group_feature', operationType,
 * entityId:<uuid>, data:{group_id,feature_id} }.
 *
 * Each test self-provisions its own user + atlas + map for isolation.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

describeOrSkip('Group lifecycle (real Chromium + real backend, transport via page.evaluate)', () => {
    test('create+combine group, visibility/lock flags, move members to a layer, ungroup (members survive)', async ({
        page,
    }) => {
        await page.goto('/');

        const result = await page.evaluate(async (baseUrl) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

            const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
            const username = `grp_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
            const password = 'Sup3r-Secret-Pw!';
            await api.register({ username, password, nome: 'Group Lifecycle User' });
            await api.login(username, password);

            const atlas = await api.createAtlas({ name: 'Group Lifecycle Atlas' });
            const mapId = crypto.randomUUID();
            await api.pushOperations(atlas.id, [
                createOperation('map', 'create', mapId, null, { name: 'M1' }),
            ]);

            // group_feature is NOT a frontend EntityType: hand-build the raw envelope
            // exactly as the backend normalizeOperation consumes it. The association
            // travels in data.{group_id,feature_id}; entityId is its own UUID.
            const groupFeatureOp = (operationType, groupId, featureId) => ({
                id: crypto.randomUUID(),
                entityType: 'group_feature',
                operationType,
                entityId: crypto.randomUUID(),
                mapId,
                data: { group_id: groupId, feature_id: featureId },
                previousData: null,
                timestamp: Date.now(),
                lamportTimestamp: 1,
                clientId: `grp-${crypto.randomUUID().slice(0, 8)}`,
            });
            const makeFeature = (id, source, geometry, extraProps = {}) => ({
                type: 'Feature',
                geometry,
                properties: { id, source, ...extraProps },
            });
            const pullMap = async () => {
                const pulled = await api.pullSync(atlas.id, 0);
                return {
                    isSnapshot: pulled.isSnapshot,
                    map: pulled.snapshot?.maps?.find((m) => m.id === mapId),
                };
            };
            const findGroup = (map, id) => (map?.groups || []).find((g) => g.id === id);
            const featureLayerId = (map, bucket, id) =>
                (map?.features?.[bucket] || []).find((f) => f.properties.id === id)?.properties.layerId;

            // ---- §14.3 CREATE group + two features + combine links (one atomic push) --
            const groupId = crypto.randomUUID();
            const pointId = crypto.randomUUID();
            const lineId = crypto.randomUUID();

            await api.pushOperations(atlas.id, [
                createOperation('feature', 'create', pointId, mapId,
                    makeFeature(pointId, 'point', { type: 'Point', coordinates: [-43.2, -22.9] })),
                createOperation('feature', 'create', lineId, mapId,
                    makeFeature(lineId, 'line', {
                        type: 'LineString',
                        coordinates: [[-43.2, -22.9], [-43.1, -22.8]],
                    })),
                createOperation('group', 'create', groupId, mapId, {
                    name: 'Alfa',
                    visible: true,
                    locked: false,
                    style: { combine: false, color: '#ff0000' },
                }),
                groupFeatureOp('create', groupId, pointId),
                groupFeatureOp('create', groupId, lineId),
            ]);

            const s1 = await pullMap();
            const g1 = findGroup(s1.map, groupId);
            const created = {
                isSnapshot: s1.isSnapshot,
                exists: Boolean(g1),
                name: g1?.name,
                visible: g1?.visible,
                locked: g1?.locked,
                style: g1?.style,
                memberCount: (g1?.features || []).length,
                membersById: Object.fromEntries((g1?.features || []).map((f) => [f.id, f.type])),
            };

            // ---- EDGE: linking a non-existent feature inserts no phantom member -------
            const ghostId = crypto.randomUUID();
            await api.pushOperations(atlas.id, [groupFeatureOp('create', groupId, ghostId)]);
            const sGhost = await pullMap();
            const gGhost = findGroup(sGhost.map, groupId);
            const edgeGhost = {
                memberCount: (gGhost?.features || []).length,
                ghostPresent: (gGhost?.features || []).some((f) => f.id === ghostId),
            };

            // ---- §2.26 visibility + §2.27 lock + §14.4 combine style (group update) ---
            await api.pushOperations(atlas.id, [
                createOperation('group', 'update', groupId, mapId, {
                    name: 'Bravo',
                    visible: false,
                    locked: true,
                    style: { combine: true, color: '#00ff00' },
                }),
            ]);
            const s2 = await pullMap();
            const g2 = findGroup(s2.map, groupId);
            const updated = {
                name: g2?.name,
                visible: g2?.visible,
                locked: g2?.locked,
                styleCombine: g2?.style?.combine,
                // Membership is untouched by a metadata update.
                memberCount: (g2?.features || []).length,
            };

            // ---- §2.30 "drag group to another layer" ---------------------------------
            // A GROUP has no layer_id column (whitelist: name/visible/locked/style/
            // parent_id). Smuggling layerId onto a group update must be IGNORED, while
            // moving the group = updating each MEMBER feature's properties.layerId,
            // which the backend persists as the feature `layer_id` column.
            const targetLayerId = crypto.randomUUID();
            await api.pushOperations(atlas.id, [
                // (a) negative: layerId on the group update is not whitelisted → no-op.
                createOperation('group', 'update', groupId, mapId, { layerId: targetLayerId }),
                // (b) the real move: re-emit each member feature with the new layerId.
                createOperation('feature', 'update', pointId, mapId,
                    makeFeature(pointId, 'point', { type: 'Point', coordinates: [-43.2, -22.9] },
                        { layerId: targetLayerId })),
                createOperation('feature', 'update', lineId, mapId,
                    makeFeature(lineId, 'line', {
                        type: 'LineString',
                        coordinates: [[-43.2, -22.9], [-43.1, -22.8]],
                    }, { layerId: targetLayerId })),
            ]);
            const s3 = await pullMap();
            const g3 = findGroup(s3.map, groupId);
            const moved = {
                // Group itself gained NO layer_id field (whitelist dropped it).
                groupHasNoLayerId: g3 ? g3.layer_id === undefined && g3.layerId === undefined : false,
                pointLayerId: featureLayerId(s3.map, 'points', pointId),
                lineLayerId: featureLayerId(s3.map, 'lines', lineId),
                // Membership is preserved by the move.
                memberCount: (g3?.features || []).length,
            };

            // ---- §14.5 UNGROUP: unlink every group_feature + soft-delete the group ----
            await api.pushOperations(atlas.id, [
                groupFeatureOp('delete', groupId, pointId),
                groupFeatureOp('delete', groupId, lineId),
                createOperation('group', 'delete', groupId, mapId, null),
            ]);
            const s4 = await pullMap();
            const g4 = findGroup(s4.map, groupId);
            const pointIds = (s4.map?.features?.points || []).map((f) => f.properties.id);
            const lineIds = (s4.map?.features?.lines || []).map((f) => f.properties.id);
            const ungrouped = {
                groupGone: g4 === undefined,
                // The core guarantee: members survive ungrouping as LOOSE features.
                pointSurvives: pointIds.includes(pointId),
                lineSurvives: lineIds.includes(lineId),
            };

            return {
                hasToken: Boolean(api.getAccessToken()),
                created,
                edgeGhost,
                updated,
                moved,
                ungrouped,
                ids: { groupId, pointId, lineId, targetLayerId },
            };
        }, state.baseUrl);

        // ---- §14.3 CREATE + combine: group present with both members, flags default --
        expect(result.hasToken).toBe(true);
        expect(result.created.isSnapshot).toBe(true);
        expect(result.created.exists).toBe(true);
        expect(result.created.name).toBe('Alfa');
        expect(result.created.visible).toBe(true);
        expect(result.created.locked).toBe(false);
        expect(result.created.style).toMatchObject({ combine: false });
        expect(result.created.memberCount).toBe(2);
        expect(result.created.membersById[result.ids.pointId]).toBe('point');
        expect(result.created.membersById[result.ids.lineId]).toBe('line');

        // ---- EDGE: phantom link rejected, membership stays at 2 -----------------------
        expect(result.edgeGhost.memberCount).toBe(2);
        expect(result.edgeGhost.ghostPresent).toBe(false);

        // ---- §2.26 visibility + §2.27 lock + §14.4 combine: flags flipped, members kept
        expect(result.updated.name).toBe('Bravo');
        expect(result.updated.visible).toBe(false);
        expect(result.updated.locked).toBe(true);
        expect(result.updated.styleCombine).toBe(true);
        expect(result.updated.memberCount).toBe(2);

        // ---- §2.30 move: group keeps no layer_id; members carry the new layerId -------
        expect(result.moved.groupHasNoLayerId).toBe(true);
        expect(result.moved.pointLayerId).toBe(result.ids.targetLayerId);
        expect(result.moved.lineLayerId).toBe(result.ids.targetLayerId);
        expect(result.moved.memberCount).toBe(2);

        // ---- §14.5 ungroup: group gone, members survive as loose features -------------
        expect(result.ungrouped.groupGone).toBe(true);
        expect(result.ungrouped.pointSurvives).toBe(true);
        expect(result.ungrouped.lineSurvives).toBe(true);
    });
});

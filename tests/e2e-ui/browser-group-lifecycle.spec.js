// Path: e2e-ui/browser-group-lifecycle.spec.js

/**
 * Browser-level group lifecycle, driven UI-FIRST. The user-facing gestures run
 * through the REAL app: the two member features are drawn with the real point + line
 * tools (toolbar activate + canvas clicks), and create-group / visibility-lock-combine
 * flags / move-members-to-layer / ungroup all flow through the app's REAL store facade
 * — the same ops the "Criar Grupo" / group toggles / drag-to-layer / "Desagrupar" menu
 * items invoke. Assertions read the live app store (getCurrentMapFeatures + getMapGroups).
 * Only the SETUP (seed/share + open via UI) and one backend-only EXISTS-guard edge stay
 * programmatic.
 *
 * Covers docs/acoes-interface-multiusuario.md §14.3-5 + §2.26-27,30:
 *   - §14.3 create group with two features combined into the group;
 *   - §2.26 group visibility toggle and §2.27 group lock, reflected on the group flags;
 *   - §14.4 combine style update;
 *   - §2.30 "drag group to another layer": a group has NO layerId of its own — the move
 *     is the member FEATURES changing properties.layerId (moveFeaturesToLayer);
 *   - §14.5 ungroup: the group vanishes while its member features SURVIVE as loose
 *     features (the core "members survive" guarantee);
 *   - edge: linking a non-existent feature id inserts no phantom member (backend EXISTS
 *     gate — no UI, hand-built wire envelope).
 *
 * The atlas/map/share SETUP is API-only (sharing has no UI); login + open + every
 * gesture below is real UI.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { seedSharedAtlas, openClient, drawPointUI, drawLineUI } from './helpers/collab-helpers.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** Drives a store op on `page` through the app's REAL store facade (the path the group menus invoke). */
function applyStoreOp(page, opName, args) {
    return page.evaluate(async ({ name, a }) => {
        const store = await import('/src/js/store/index.js');
        return store[name](...a);
    }, { name: opName, a: args });
}

/**
 * Reads the current map's ACTIVE groups (each with its member refs) from the live app
 * store. getMapGroups returns an object keyed by id (and includes soft-deleted groups),
 * so we take Object.values + drop deleted ones (sync.deleted) to mirror getGroupById.
 */
function readGroups(page) {
    return page.evaluate(async () => {
        const store = await import('/src/js/store/index.js');
        const byId = store.getMapGroups() || {};
        return Object.values(byId)
            .filter((g) => g && !g.sync?.deleted)
            .map((g) => ({
                id: g.id,
                name: g.name,
                visible: g.visible,
                locked: g.locked,
                style: g.style,
                layerId: g.layerId,
                members: (g.features || []).map((f) => ({ id: f.id, type: f.type })),
            }));
    });
}

/** Reads a feature's layerId from the live app store (by storage bucket + id). */
function readFeatureLayerId(page, bucket, id) {
    return page.evaluate(async ({ b, fid }) => {
        const store = await import('/src/js/store/index.js');
        const f = await store.getCurrentMapFeatures();
        return (f[b] || []).find((x) => x.properties?.id === fid)?.properties?.layerId ?? null;
    }, { b: bucket, fid: id });
}

/** Reads every id present in the current map's bucket. */
function readBucketIds(page, bucket) {
    return page.evaluate(async (b) => {
        const store = await import('/src/js/store/index.js');
        const f = await store.getCurrentMapFeatures();
        return (f[b] || []).map((x) => x.properties?.id);
    }, bucket);
}

describeOrSkip('Group lifecycle (real Chromium + real backend, UI-first gestures)', () => {
    test('create+combine group, visibility/lock flags, move members to a layer, ungroup (members survive)', async ({
        browser,
    }) => {
        const seed = await seedSharedAtlas(browser, state.baseUrl);
        const page = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA);

        try {
            // ---- §14.3 CREATE group: draw two real features, then group them ----------
            // The two members are placed through the REAL draw tools (point + line),
            // exactly like a user; the tool generates each id and we read it back.
            const pointId = await drawPointUI(page, [-43.2, -22.9]);
            const lineId = await drawLineUI(page, [[-43.2, -22.9], [-43.1, -22.8]]);
            expect(pointId, 'the point tool created a feature').toBeTruthy();
            expect(lineId, 'the line tool created a feature').toBeTruthy();

            // "Criar Grupo": canvas multi-select hit-testing is unreliable headless, so the
            // group is created through the SAME store facade op the menu invokes, over the
            // two real features just drawn (see layers-tab-local.spec.js for the same rationale).
            const created = await page.evaluate(async ({ pid, lid }) => {
                const store = await import('/src/js/store/index.js');
                const f = await store.getCurrentMapFeatures();
                const pt = (f.points || []).find((x) => x.properties?.id === pid);
                const ln = (f.lines || []).find((x) => x.properties?.id === lid);
                const group = store.createGroup([pt, ln]);
                return group ? { id: group.id } : null;
            }, { pid: pointId, lid: lineId });
            expect(created?.id, 'createGroup returned a real group over the two drawn features').toBeTruthy();
            const groupId = created.id;

            const g1 = (await readGroups(page)).find((g) => g.id === groupId);
            expect(g1, 'the new group is in the live store').toBeTruthy();
            const membersById1 = Object.fromEntries(g1.members.map((m) => [m.id, m.type]));

            // ---- EDGE: linking a non-existent feature inserts no phantom member --------
            // no-UI: `group_feature` is a SERVER-ONLY join with no client factory, and
            // linking a ghost id has no UI gesture at all. The backend EXISTS gate is a pure
            // server contract, so this self-seeds its OWN group + real member + a real link
            // via the API, then probes the ghost link — all observed through pullSync. (It is
            // self-contained on purpose, so it never races the UI group's async membership sync.)
            const edgeGhost = await page.evaluate(async ({ base, c, atlasId, mapName }) => {
                const { ApiClient } = await import('/src/js/store/sync/api-client.js');
                const { createOperation } = await import('/src/js/store/sync/operation-factory.js');
                const api = new ApiClient({ baseUrl: `${base}/api/v1` });
                await api.login(c.username, c.password);
                const snap = await api.pullSync(atlasId, 0);
                const mapId = (snap.snapshot?.maps || []).find((m) => m.name === mapName)?.id;

                const realFeatureId = crypto.randomUUID();
                const probeGroupId = crypto.randomUUID();
                await api.pushOperations(atlasId, [
                    createOperation('feature', 'create', realFeatureId, mapId, {
                        type: 'Feature',
                        geometry: { type: 'Point', coordinates: [-43.0, -22.0] },
                        properties: { id: realFeatureId, source: 'point', nome: 'Probe member' },
                    }),
                    createOperation('group', 'create', probeGroupId, mapId, { name: 'Probe', visible: true }),
                ]);
                const linkOp = (fid) => ({
                    id: crypto.randomUUID(),
                    entityType: 'group_feature',
                    operationType: 'create',
                    entityId: crypto.randomUUID(),
                    mapId,
                    data: { group_id: probeGroupId, feature_id: fid },
                    previousData: null,
                    timestamp: Date.now(),
                    lamportTimestamp: 1,
                    clientId: `grp-${crypto.randomUUID().slice(0, 8)}`,
                });
                // Link the REAL member, then a GHOST (non-existent) feature.
                await api.pushOperations(atlasId, [linkOp(realFeatureId)]);
                const ghostId = crypto.randomUUID();
                await api.pushOperations(atlasId, [linkOp(ghostId)]);

                const post = await api.pullSync(atlasId, 0);
                const group = ((post.snapshot?.maps || []).find((m) => m.id === mapId)?.groups || [])
                    .find((g) => g.id === probeGroupId);
                return {
                    memberCount: (group?.features || []).length,
                    ghostPresent: (group?.features || []).some((f) => f.id === ghostId),
                    realPresent: (group?.features || []).some((f) => f.id === realFeatureId),
                };
            }, { base: state.baseUrl, c: seed.userA, atlasId: seed.atlasId, mapName: seed.mapName });

            // ---- §2.26 visibility + §2.27 lock + §14.4 combine style (group update) ----
            // Through the app's real group-property store op (the toggles + combine menu).
            await applyStoreOp(page, 'updateGroupProperty', [groupId, 'name', 'Bravo']);
            await applyStoreOp(page, 'updateGroupProperty', [groupId, 'visible', false]);
            await applyStoreOp(page, 'updateGroupProperty', [groupId, 'locked', true]);
            await applyStoreOp(page, 'updateGroupProperty', [groupId, 'style', { combine: true, color: '#00ff00' }]);
            const g2 = (await readGroups(page)).find((g) => g.id === groupId);

            // ---- §2.30 "drag group to another layer" ----------------------------------
            // The group itself carries no layerId; moving the group = moving each MEMBER
            // feature's properties.layerId via the REAL moveFeaturesToLayer store op.
            const targetLayerId = await applyStoreOp(page, 'createLayer', ['Camada Alvo', seed.mapName])
                .then((l) => l?.id ?? l);
            expect(targetLayerId, 'createLayer returned a layer id').toBeTruthy();
            await applyStoreOp(page, 'moveFeaturesToLayer', [
                [{ type: 'point', id: pointId }, { type: 'line', id: lineId }],
                targetLayerId,
                seed.mapName,
            ]);
            const g3 = (await readGroups(page)).find((g) => g.id === groupId);
            const moved = {
                groupHasNoLayerId: g3 ? g3.layerId === undefined || g3.layerId === null : false,
                pointLayerId: await readFeatureLayerId(page, 'points', pointId),
                lineLayerId: await readFeatureLayerId(page, 'lines', lineId),
                memberCount: g3?.members.length,
            };

            // ---- §14.5 UNGROUP via the real "Desagrupar" store op ----------------------
            await applyStoreOp(page, 'ungroupFeatures', [groupId, seed.mapName]);
            const g4 = (await readGroups(page)).find((g) => g.id === groupId);
            const pointIds = await readBucketIds(page, 'points');
            const lineIds = await readBucketIds(page, 'lines');

            // ---- §14.3 CREATE + combine: group present with both members, flags default
            expect(g1.name).toBeTruthy();
            expect(g1.visible).toBe(true);
            expect(g1.locked).toBe(false);
            expect(g1.members.length).toBe(2);
            expect(membersById1[pointId]).toBe('point');
            expect(membersById1[lineId]).toBe('line');

            // ---- EDGE: phantom link rejected — only the real member is linked ----------
            expect(edgeGhost.realPresent).toBe(true);
            expect(edgeGhost.memberCount).toBe(1);
            expect(edgeGhost.ghostPresent).toBe(false);

            // ---- §2.26 visibility + §2.27 lock + §14.4 combine: flags flipped, members kept
            expect(g2.name).toBe('Bravo');
            expect(g2.visible).toBe(false);
            expect(g2.locked).toBe(true);
            expect(g2.style?.combine).toBe(true);
            expect(g2.members.length).toBe(2);

            // ---- §2.30 move: group keeps no layerId; members carry the new layerId -----
            expect(moved.groupHasNoLayerId).toBe(true);
            expect(moved.pointLayerId).toBe(targetLayerId);
            expect(moved.lineLayerId).toBe(targetLayerId);
            expect(moved.memberCount).toBe(2);

            // ---- §14.5 ungroup: group gone, members survive as loose features ----------
            expect(g4).toBeUndefined();
            expect(pointIds).toContain(pointId);
            expect(lineIds).toContain(lineId);
        } finally {
            await page.context().close();
        }
    });
});

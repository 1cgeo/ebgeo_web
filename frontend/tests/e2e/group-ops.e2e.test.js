// Path: tests/e2e/group-ops.e2e.test.js

/**
 * @fileoverview E2E: group lifecycle (create/update/delete) and group<->feature
 * membership (group_feature create/delete) against the live backend. Drives the
 * server only through ApiClient/WsClient + createOperation; asserts observable
 * state via the pullSync snapshot and a real WS broadcast round-trip.
 *
 * Snapshot contract (from backend sync.service.getAtlasSnapshot):
 *   { atlas, maps:[{ id, groups:[{ id, name, visible, locked, features:[{type,id}] }],
 *     features:{ points:[...], lines:[...], ... } }], briefings, currentVersion }
 *   group.features holds { type: feature_type, id: feature_id } and silently DROPS
 *   refs whose feature no longer exists (orphan filter).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
    makeApi,
    registerAndLogin,
    createAtlas,
    createMap,
    makeWs,
    newClientId,
    waitFor,
    E2E_SKIP,
} from './helpers/harness.js';
import { createOperation } from '../../src/js/store/sync/operation-factory.js';
import { generateUUID } from '../../src/js/utilities/uuid.js';

/**
 * Pulls a full snapshot and returns the group with the given id from the map.
 * @param {import('../../src/js/store/sync/api-client.js').ApiClient} api
 * @param {string} atlasId
 * @param {string} mapId
 * @param {string} groupId
 * @returns {Promise<Object|undefined>}
 */
async function pullGroup(api, atlasId, mapId, groupId) {
    const res = await api.pullSync(atlasId, 0);
    expect(res.isSnapshot).toBe(true);
    const map = res.snapshot.maps.find((m) => m.id === mapId);
    expect(map, 'map present in snapshot').toBeTruthy();
    return (map.groups || []).find((g) => g.id === groupId);
}

/**
 * Builds a group_feature link/unlink op envelope. `group_feature` is NOT a frontend
 * EntityType (createOperation would throw), so the envelope is hand-built to match the
 * exact shape the backend's normalizeOperation consumes ({ entityType, operationType,
 * data:{group_id,feature_id} }).
 * @param {string} opType - 'create' | 'delete'
 * @param {string} groupId
 * @param {string} featureId
 * @param {string} clientId
 * @returns {Object}
 */
function groupFeatureOp(opType, groupId, featureId, clientId) {
    return {
        id: generateUUID(),
        entityType: 'group_feature',
        operationType: opType,
        // The operations log stores entity_id as a UUID; the real association
        // travels in data.{group_id,feature_id}, so the link op carries its own uuid.
        entityId: generateUUID(),
        mapId: null,
        data: { group_id: groupId, feature_id: featureId },
        previousData: null,
        timestamp: Date.now(),
        lamportTimestamp: 1,
        clientId,
    };
}

describe.skipIf(E2E_SKIP)('e2e: group ops + group_feature membership', () => {
    let api;
    let atlasId;
    let mapId;
    const clientId = newClientId();

    beforeAll(async () => {
        api = makeApi();
        await registerAndLogin(api, { nome: 'Group Ops User' });
        const atlas = await createAtlas(api, { name: 'Group Ops Atlas' });
        atlasId = atlas.id;
        mapId = await createMap(api, atlasId, { name: 'Mapa Grupos' });
    });

    it('creates, updates and deletes a group; snapshot reflects each step', async () => {
        const groupId = generateUUID();

        // CREATE
        await api.pushOperations(atlasId, [
            createOperation('group', 'create', groupId, mapId, {
                name: 'Esquadra A',
                visible: true,
                locked: false,
                style: { color: '#ff0000' },
            }),
        ]);

        let group = await pullGroup(api, atlasId, mapId, groupId);
        expect(group, 'group created').toBeTruthy();
        expect(group.name).toBe('Esquadra A');
        expect(group.visible).toBe(true);
        expect(group.locked).toBe(false);
        expect(group.style).toEqual({ color: '#ff0000' });
        expect(Array.isArray(group.features)).toBe(true);
        expect(group.features).toHaveLength(0);

        // UPDATE (factory puts payload in `data`; backend falls it back to `changes`)
        await api.pushOperations(atlasId, [
            createOperation('group', 'update', groupId, mapId, {
                name: 'Esquadra Alfa',
                locked: true,
            }),
        ]);

        group = await pullGroup(api, atlasId, mapId, groupId);
        expect(group.name).toBe('Esquadra Alfa');
        expect(group.locked).toBe(true);
        // Untouched field is preserved by the dynamic UPDATE (whitelist columns only).
        expect(group.visible).toBe(true);

        // DELETE (soft-delete -> absent from snapshot)
        await api.pushOperations(atlasId, [
            createOperation('group', 'delete', groupId, mapId, null),
        ]);

        group = await pullGroup(api, atlasId, mapId, groupId);
        expect(group, 'group soft-deleted -> not in snapshot').toBeUndefined();
    });

    it('links and unlinks a feature via group_feature; snapshot membership tracks it', async () => {
        const groupId = generateUUID();
        const featureId = generateUUID();
        const otherFeatureId = generateUUID();

        // Group + two point features in one push.
        await api.pushOperations(atlasId, [
            createOperation('group', 'create', groupId, mapId, { name: 'Pelotao 1', visible: true }),
            createOperation('feature', 'create', featureId, mapId, {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
                properties: { source: 'point', id: featureId },
            }),
            createOperation('feature', 'create', otherFeatureId, mapId, {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [-43.1, -22.8] },
                properties: { source: 'point', id: otherFeatureId },
            }),
        ]);

        let group = await pullGroup(api, atlasId, mapId, groupId);
        expect(group).toBeTruthy();
        expect(group.features).toHaveLength(0);

        // LINK featureId only.
        await api.pushOperations(atlasId, [groupFeatureOp('create', groupId, featureId, clientId)]);

        group = await pullGroup(api, atlasId, mapId, groupId);
        expect(group.features).toHaveLength(1);
        expect(group.features[0]).toEqual({ type: 'point', id: featureId });
        // Negative: the un-linked feature is NOT a member.
        expect(group.features.some((f) => f.id === otherFeatureId)).toBe(false);

        // Idempotency: re-linking the same pair (ON CONFLICT DO NOTHING) is a no-op.
        await api.pushOperations(atlasId, [groupFeatureOp('create', groupId, featureId, clientId)]);
        group = await pullGroup(api, atlasId, mapId, groupId);
        expect(group.features).toHaveLength(1);

        // UNLINK -> membership empty again (hard delete on the join table).
        await api.pushOperations(atlasId, [groupFeatureOp('delete', groupId, featureId, clientId)]);
        group = await pullGroup(api, atlasId, mapId, groupId);
        expect(group.features).toHaveLength(0);

        // Edge: linking a feature that does not exist inserts nothing (EXISTS gate).
        await api.pushOperations(atlasId, [
            groupFeatureOp('create', groupId, generateUUID(), clientId),
        ]);
        group = await pullGroup(api, atlasId, mapId, groupId);
        expect(group.features).toHaveLength(0);
    });

    it('broadcasts a group create op to a connected WS peer (different clientId)', async () => {
        // A second WS connection (distinct clientId) reusing the owner's token, so
        // the peer is authorized on the same atlas but is NOT the op author.
        const peerApi = makeApi();
        peerApi.setTokens({ accessToken: api.getAccessToken() });

        const peerClientId = newClientId();
        const ws = makeWs(peerApi, { clientId: peerClientId });
        const received = [];
        ws.on('operation', (op) => received.push(op));

        await ws.connect(atlasId, { lastVersion: 0 });

        const groupId = generateUUID();
        const writerClientId = newClientId();
        // Push from a DIFFERENT clientId so the peer does not filter it as its own echo.
        await api.pushOperations(atlasId, [
            {
                ...createOperation('group', 'create', groupId, mapId, { name: 'Broadcast Grupo' }),
                clientId: writerClientId,
            },
        ]);

        const match = await waitFor(
            () => received.find((op) => op.entityId === groupId) || false,
            { timeout: 4000 },
        );

        expect(match.entityType).toBe('group');
        expect(match.operationType).toBe('create');
        expect(match.mapId).toBe(mapId);
        expect(match.clientId).toBe(writerClientId);
        expect(match.data).toMatchObject({ name: 'Broadcast Grupo' });

        ws.disconnect();
    });
});

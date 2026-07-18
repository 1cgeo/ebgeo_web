// Path: tests/e2e/group-combine-ungroup.e2e.test.js

/**
 * @fileoverview REAL-backend E2E for the group lifecycle (spec §14.3-5): create a
 * group plus two features and link them through `group_feature` associations,
 * update the group (rename / combine style) and observe the change, then "ungroup"
 * by deleting the group_feature links and soft-deleting the group itself.
 *
 * Every assertion is made against observable backend state pulled back over real
 * HTTP via `api.pullSync(...)` — specifically the snapshot's `map.groups[]` entries
 * and their server-populated `features` membership array (built from the
 * `group_features` join table, with orphaned refs filtered out by the backend).
 *
 * The frontend never models a `group_feature` entity type (it is a server-side join
 * driven by the grouping UI), so `createOperation` would reject it. We therefore
 * hand-build those raw push operations here while using the shared factory for the
 * `group` and `feature` entities the frontend does emit.
 */

import { describe, it, beforeAll, expect } from 'vitest';
import {
    E2E_SKIP,
    makeApi,
    registerAndLogin,
    createAtlas,
    createMap,
    newClientId,
} from './helpers/harness.js';
import { createOperation } from '../../src/js/store/sync/operation-factory.js';
import { generateUUID } from '../../src/js/utilities/uuid.js';

/**
 * Builds a raw `group_feature` push operation. This join entity is server-only
 * (not in the frontend EntityType enum), so it bypasses the validating factory.
 * @param {'create'|'delete'} operationType - Link (create) or unlink (delete).
 * @param {string} mapId - Owning map id (lock/atlas scoping context).
 * @param {string} groupId - Group side of the association.
 * @param {string} featureId - Feature side of the association.
 * @returns {Object} A push-ready operation envelope.
 */
function groupFeatureOp(operationType, mapId, groupId, featureId) {
    return {
        id: generateUUID(),
        entityType: 'group_feature',
        operationType,
        entityId: groupId,
        mapId,
        data: { group_id: groupId, feature_id: featureId },
        previousData: null,
        timestamp: Date.now(),
        lamportTimestamp: 1,
        clientId: newClientId(),
    };
}

/**
 * Builds a minimal GeoJSON Feature create op. The backend derives `feature_type`
 * from `properties.source` and `layer_id` from `properties.layerId`.
 * @param {string} mapId - Owning map id.
 * @param {string} featureId - Feature id (UUID).
 * @param {string} source - Backend feature_type (e.g. 'point', 'line').
 * @param {Array<number>|Array<Array<number>>} coordinates - GeoJSON coordinates.
 * @param {string} geomType - GeoJSON geometry type ('Point' | 'LineString').
 * @returns {Object} A push-ready feature create operation.
 */
function featureOp(mapId, featureId, source, coordinates, geomType) {
    return createOperation('feature', 'create', featureId, mapId, {
        type: 'Feature',
        geometry: { type: geomType, coordinates },
        properties: { source, name: `feat-${source}` },
    });
}

/**
 * Pulls a fresh full snapshot and returns the named group, or undefined.
 * @param {import('../../src/js/store/sync/api-client.js').ApiClient} api - Client.
 * @param {string} atlasId - Atlas id.
 * @param {string} mapId - Map id whose groups to inspect.
 * @param {string} groupId - Group id to find.
 * @returns {Promise<Object|undefined>} The snapshot group object or undefined.
 */
async function pullGroup(api, atlasId, mapId, groupId) {
    const { snapshot, isSnapshot } = await api.pullSync(atlasId, 0);
    expect(isSnapshot).toBe(true);
    const map = snapshot.maps.find((m) => m.id === mapId);
    expect(map).toBeDefined();
    return map.groups.find((g) => g.id === groupId);
}

describe.skipIf(E2E_SKIP)('group create / combine / ungroup (real backend)', () => {
    /** @type {import('../../src/js/store/sync/api-client.js').ApiClient} */
    let api;
    /** @type {string} */
    let atlasId;
    /** @type {string} */
    let mapId;
    /** @type {string} */
    let groupId;
    /** @type {string} */
    let pointId;
    /** @type {string} */
    let lineId;

    beforeAll(async () => {
        api = makeApi();
        await registerAndLogin(api, { nome: 'Group Owner' });
        const atlas = await createAtlas(api, { name: 'Group E2E Atlas' });
        atlasId = atlas.id;
        mapId = await createMap(api, atlasId, { name: 'Group Map' });

        pointId = generateUUID();
        lineId = generateUUID();
        groupId = generateUUID();

        // §14.3-5: create a group, two features, and link both to the group. One
        // atomic push (one server transaction) carries the whole grouping action.
        await api.pushOperations(atlasId, [
            featureOp(mapId, pointId, 'point', [-43.2, -22.9], 'Point'),
            featureOp(mapId, lineId, 'line', [[-43.2, -22.9], [-43.1, -22.8]], 'LineString'),
            createOperation('group', 'create', groupId, mapId, {
                name: 'Alfa', visible: true, locked: false, style: { combine: false },
            }),
            groupFeatureOp('create', mapId, groupId, pointId),
            groupFeatureOp('create', mapId, groupId, lineId),
        ]);
    });

    it('snapshot reflects the group and its two-feature membership', async () => {
        const group = await pullGroup(api, atlasId, mapId, groupId);
        expect(group).toBeDefined();
        expect(group.name).toBe('Alfa');

        // group.features is the server-built ref list ({type,id}) from group_features.
        expect(Array.isArray(group.features)).toBe(true);
        expect(group.features).toHaveLength(2);

        const byId = Object.fromEntries(group.features.map((f) => [f.id, f.type]));
        expect(byId[pointId]).toBe('point');
        expect(byId[lineId]).toBe('line');
    });

    it('ignores a cross-feature link to a feature that does not exist (no phantom member)', async () => {
        // Edge/negative: linking a non-existent feature id must NOT create a member —
        // the backend's EXISTS gate inserts zero rows and the ref is filtered out.
        const ghostFeatureId = generateUUID();
        await api.pushOperations(atlasId, [
            groupFeatureOp('create', mapId, groupId, ghostFeatureId),
        ]);

        const group = await pullGroup(api, atlasId, mapId, groupId);
        expect(group.features).toHaveLength(2);
        expect(group.features.some((f) => f.id === ghostFeatureId)).toBe(false);
    });

    it('group update (rename + combine) is reflected in the snapshot', async () => {
        // §14.4: modify the group — rename and flip the "combine" style flag.
        await api.pushOperations(atlasId, [
            createOperation('group', 'update', groupId, mapId, {
                name: 'Bravo', style: { combine: true },
            }),
        ]);

        const group = await pullGroup(api, atlasId, mapId, groupId);
        expect(group.name).toBe('Bravo');
        expect(group.style).toMatchObject({ combine: true });
        // Membership is unchanged by a metadata update.
        expect(group.features).toHaveLength(2);
    });

    it('ungroup = unlink group_features + delete group; membership and group disappear', async () => {
        // §14.5: ungroup unlinks every group_feature and soft-deletes the group, all
        // in one atomic push.
        await api.pushOperations(atlasId, [
            groupFeatureOp('delete', mapId, groupId, pointId),
            groupFeatureOp('delete', mapId, groupId, lineId),
            createOperation('group', 'delete', groupId, mapId, null),
        ]);

        // The soft-deleted group is no longer surfaced in the snapshot at all.
        const group = await pullGroup(api, atlasId, mapId, groupId);
        expect(group).toBeUndefined();

        // The two features themselves survive ungrouping (only the links/group went).
        const { snapshot } = await api.pullSync(atlasId, 0);
        const map = snapshot.maps.find((m) => m.id === mapId);
        const survivingIds = new Set([
            ...map.features.points.map((f) => f.properties.id),
            ...map.features.lines.map((f) => f.properties.id),
        ]);
        expect(survivingIds.has(pointId)).toBe(true);
        expect(survivingIds.has(lineId)).toBe(true);
    });
});

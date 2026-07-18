// Path: tests/e2e/undo-redo.e2e.test.js

/**
 * @fileoverview E2E proof (§16.1-4) that undo/redo travel as ordinary sync ops
 * against the live backend. A feature `create` op makes the entity present; its
 * INVERSE — a `delete` op on the SAME entityId — acts as undo and removes it.
 *
 * The backend's CRDT contract is id-idempotent create (`ON CONFLICT (id) DO
 * NOTHING`) plus soft-delete-always: once an entity id is soft-deleted it is a
 * permanent tombstone, so re-issuing a `create` op on the SAME id can NEVER
 * resurrect it. Redo of a deleted feature therefore re-creates the logical
 * feature under a FRESH entity id (exactly how the frontend re-adds it). This
 * test pins both halves: the same-id re-create is an observable no-op, and the
 * new-id re-create brings the content back.
 *
 * Every step is a real HTTP round-trip; presence/absence is asserted only via the
 * pullSync snapshot bucket (no DB access). Includes a negative assertion that the
 * undone feature is absent before redo, and that replaying the undo op.id is a
 * no-op (idempotent) so it cannot resurrect or re-delete out of band.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
    E2E_SKIP,
    makeApi,
    registerAndLogin,
    createAtlas,
    createMap,
} from './helpers/harness.js';
import { createOperation } from '../../src/js/store/sync/operation-factory.js';
import { generateUUID } from '../../src/js/utilities/uuid.js';

/** GeoJSON Point geometry used for the round-tripped feature. */
const POINT_GEOM = { type: 'Point', coordinates: [-43.18, -22.95] };

/**
 * Builds a feature `create` op carrying a raw GeoJSON Point whose feature type
 * lives in `properties.source` (frozen frontend contract).
 * @param {string} featureId
 * @param {string} mapId
 * @returns {Object} sync operation
 */
function pointCreateOp(featureId, mapId) {
    return createOperation('feature', 'create', featureId, mapId, {
        type: 'Feature',
        geometry: POINT_GEOM,
        properties: { source: 'point', layerId: null, nome: 'Undo/Redo Ponto' },
    });
}

/** Pulls a fresh snapshot and returns the map object matching `mapId`. */
async function pullMap(api, atlasId, mapId) {
    const r = await api.pullSync(atlasId, 0);
    expect(r.isSnapshot).toBe(true);
    expect(r.snapshot).toBeTruthy();
    const map = r.snapshot.maps.find((m) => m.id === mapId);
    expect(map, 'map present in snapshot').toBeTruthy();
    return map;
}

/** True iff a point feature with `featureId` is present in the snapshot bucket. */
function pointPresent(map, featureId) {
    return map.features.points.some((f) => f.properties.id === featureId);
}

describe.skipIf(E2E_SKIP)('E2E undo-redo (create<->delete inverse round-trips)', () => {
    let api;
    let atlasId;
    let mapId;

    const featureId = generateUUID();

    beforeAll(async () => {
        api = makeApi();
        await registerAndLogin(api);
        const atlas = await createAtlas(api, { name: 'Undo/Redo Atlas' });
        atlasId = atlas.id;
        mapId = await createMap(api, atlasId, { name: 'Mapa Undo/Redo' });
    });

    it('create -> undo (inverse delete) -> redo (re-create) round-trips presence', async () => {
        // ---- create: feature becomes present ----
        const createRes = await api.pushOperations(atlasId, [pointCreateOp(featureId, mapId)]);
        expect(createRes.results[0].success).toBe(true);

        let map = await pullMap(api, atlasId, mapId);
        expect(pointPresent(map, featureId), 'present after create').toBe(true);
        const createdVersion = map.features.points.find((f) => f.properties.id === featureId)
            .properties.version;
        expect(createdVersion).toBeGreaterThan(0);

        // ---- undo: the INVERSE op (delete on same entityId) removes it ----
        const undoOp = createOperation('feature', 'delete', featureId, mapId, null);
        const undoRes = await api.pushOperations(atlasId, [undoOp]);
        expect(undoRes.results[0].success).toBe(true);

        map = await pullMap(api, atlasId, mapId);
        // Negative assertion: the undone (soft-deleted) feature is gone before redo.
        expect(pointPresent(map, featureId), 'absent after undo').toBe(false);

        // Replaying the undo op.id is a pure no-op (idempotent) — it must not
        // double-delete nor resurrect the entity out of band.
        const undoReplay = await api.pushOperations(atlasId, [undoOp]);
        expect(undoReplay.results[0].idempotent).toBe(true);
        map = await pullMap(api, atlasId, mapId);
        expect(pointPresent(map, featureId), 'still absent after undo replay').toBe(false);

        // ---- same-id re-create is a tombstone no-op ----
        // Re-issuing `create` on the soft-deleted id (a fresh op.id, so it is NOT
        // op-id-idempotent and really runs) still inserts zero rows because of
        // `ON CONFLICT (id) DO NOTHING`: the op acks success, but the snapshot
        // proves the tombstoned id stays gone. A delete is permanent by id.
        const sameIdRes = await api.pushOperations(atlasId, [pointCreateOp(featureId, mapId)]);
        expect(sameIdRes.results[0].success).toBe(true);
        expect(sameIdRes.results[0].idempotent).toBe(false);
        map = await pullMap(api, atlasId, mapId);
        expect(pointPresent(map, featureId), 'same-id re-create cannot resurrect').toBe(false);

        // ---- redo: re-create the logical feature under a FRESH id brings it back ----
        const redoId = generateUUID();
        const redoRes = await api.pushOperations(atlasId, [pointCreateOp(redoId, mapId)]);
        expect(redoRes.results[0].success).toBe(true);

        map = await pullMap(api, atlasId, mapId);
        expect(pointPresent(map, redoId), 'present again after redo').toBe(true);
        // The old (tombstoned) id is still absent — redo did not touch it.
        expect(pointPresent(map, featureId), 'tombstoned id remains absent').toBe(false);

        const revived = map.features.points.find((f) => f.properties.id === redoId);
        expect(revived.geometry).toEqual(POINT_GEOM);
        expect(revived.properties.source).toBe('point');
        // Exactly one live row for the redone entity — redo re-created, not duplicated.
        expect(map.features.points.filter((f) => f.properties.id === redoId)).toHaveLength(1);
        // A real write: the redone feature carries a positive version.
        expect(revived.properties.version).toBeGreaterThan(0);
    });
});

// Path: tests/e2e/undo-redo.e2e.test.js

/**
 * @fileoverview E2E proof (§16.1-4) that undo/redo travel as ordinary sync ops
 * against the live backend. A feature `create` op makes the entity present; its
 * INVERSE — a `delete` op on the SAME entityId — acts as undo and removes it.
 *
 * CONTRACT CHANGE — RESURRECT-ON-CREATE (backend decision of 2026-07-19,
 * `backend/src/modules/sync/sync.service.js:1981-2009`). This file used to pin the
 * opposite rule: `ON CONFLICT (id) DO NOTHING`, i.e. a soft-deleted id was a
 * permanent tombstone and a same-id re-create was an acked no-op. That rule was
 * removed because it destroyed data in the most common gesture of the product:
 * the frontend's undo of a delete replays the ORIGINAL entity keeping its ORIGINAL
 * id (`store-state-manager.js`, `case 'remove': addFeature(action.feature)`), so a
 * Ctrl+Z after a delete arrives as a create whose targetId is a tombstone. Under
 * DO NOTHING the server silently kept it dead, acked success, and the next
 * snapshot killed it on the client too.
 *
 * The clause is now `ON CONFLICT (id) DO UPDATE ... WHERE deleted_at IS NOT NULL`,
 * which yields exactly two behaviors, and this test pins BOTH because the guard is
 * what keeps the change safe:
 *  - target is a TOMBSTONE  -> revived, content refreshed, `version` bumped;
 *  - target is ALIVE        -> zero rows, a pure no-op, so a replayed or stale
 *                              create can never clobber newer data on a live row.
 *
 * Every step is a real HTTP round-trip; presence/absence is asserted only via the
 * pullSync snapshot bucket (no DB access). Includes the negative assertion that the
 * undone feature is absent before redo, and that replaying the undo op.id is a
 * no-op (idempotent) so it cannot re-delete out of band.
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
 * @param {Object} [overrides] - Extra/overriding feature properties.
 * @param {Object} [geometry] - Geometry to send (defaults to POINT_GEOM).
 * @returns {Object} sync operation
 */
function pointCreateOp(featureId, mapId, overrides = {}, geometry = POINT_GEOM) {
    return createOperation('feature', 'create', featureId, mapId, {
        type: 'Feature',
        geometry,
        properties: { source: 'point', layerId: null, nome: 'Undo/Redo Ponto', ...overrides },
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

/** Returns the point feature with `featureId` from the snapshot bucket, or undefined. */
function findPoint(map, featureId) {
    return map.features.points.find((f) => f.properties.id === featureId);
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

    it('create -> undo (inverse delete) -> redo (same-id re-create) round-trips presence', async () => {
        // ---- create: feature becomes present ----
        const createRes = await api.pushOperations(atlasId, [pointCreateOp(featureId, mapId)]);
        expect(createRes.results[0].success).toBe(true);

        let map = await pullMap(api, atlasId, mapId);
        expect(pointPresent(map, featureId), 'present after create').toBe(true);
        const createdVersion = findPoint(map, featureId).properties.version;
        expect(createdVersion).toBeGreaterThan(0);

        // ---- undo: the INVERSE op (delete on same entityId) removes it ----
        const undoOp = createOperation('feature', 'delete', featureId, mapId, null);
        const undoRes = await api.pushOperations(atlasId, [undoOp]);
        expect(undoRes.results[0].success).toBe(true);

        map = await pullMap(api, atlasId, mapId);
        // Negative assertion: the undone (soft-deleted) feature is gone before redo.
        expect(pointPresent(map, featureId), 'absent after undo').toBe(false);

        // Replaying the undo op.id is a pure no-op (idempotent) — it must not
        // double-delete nor otherwise act out of band.
        const undoReplay = await api.pushOperations(atlasId, [undoOp]);
        expect(undoReplay.results[0].idempotent).toBe(true);
        map = await pullMap(api, atlasId, mapId);
        expect(pointPresent(map, featureId), 'still absent after undo replay').toBe(false);

        // ---- redo: the same-id re-create REVIVES the tombstone ----
        // This is how the frontend's Ctrl+Z-after-delete actually travels: the
        // original entity, original id, fresh op.id (so it is not op-id-idempotent
        // and really runs). The DO UPDATE branch fires because the row is a
        // tombstone: content is refreshed from the op and `version` is bumped.
        const redoGeom = { type: 'Point', coordinates: [-43.19, -22.96] };
        const redoRes = await api.pushOperations(atlasId, [
            pointCreateOp(featureId, mapId, { nome: 'Ressuscitado' }, redoGeom),
        ]);
        expect(redoRes.results[0].success).toBe(true);
        expect(redoRes.results[0].idempotent).toBe(false);

        map = await pullMap(api, atlasId, mapId);
        const revived = findPoint(map, featureId);
        expect(revived, 'same-id re-create revives the tombstone').toBeTruthy();
        // Exactly one live row — the revive updated in place, it did not duplicate.
        expect(map.features.points.filter((f) => f.properties.id === featureId)).toHaveLength(1);
        // Content came from the redo op, not from the pre-delete row.
        expect(revived.geometry).toEqual(redoGeom);
        expect(revived.properties.nome).toBe('Ressuscitado');
        expect(revived.properties.source).toBe('point');
        // A real write: the revive bumped the version past the delete's own bump.
        expect(revived.properties.version).toBeGreaterThan(createdVersion);
    });

    it('a create landing on an ALIVE row is a no-op — a stale replay cannot clobber it', async () => {
        // The `WHERE deleted_at IS NOT NULL` half of the clause. Without it, any
        // late/duplicated create would overwrite whatever the row has become.
        const before = findPoint(await pullMap(api, atlasId, mapId), featureId);
        expect(before, 'row is alive from the previous test').toBeTruthy();

        const staleRes = await api.pushOperations(atlasId, [
            pointCreateOp(featureId, mapId, { nome: 'Conteudo Obsoleto' }, POINT_GEOM),
        ]);
        // Acked as success (nothing failed), but it affected zero rows.
        expect(staleRes.results[0].success).toBe(true);
        expect(staleRes.results[0].idempotent).toBe(false);

        const after = findPoint(await pullMap(api, atlasId, mapId), featureId);
        expect(after.properties.nome, 'live row not clobbered by a stale create').toBe(before.properties.nome);
        expect(after.geometry).toEqual(before.geometry);
        expect(after.properties.version).toBe(before.properties.version);
    });

    it('re-creating the logical feature under a FRESH id yields an independent row', async () => {
        const freshId = generateUUID();
        const res = await api.pushOperations(atlasId, [
            pointCreateOp(freshId, mapId, { nome: 'Copia Nova' }),
        ]);
        expect(res.results[0].success).toBe(true);

        const map = await pullMap(api, atlasId, mapId);
        const fresh = findPoint(map, freshId);
        expect(fresh, 'fresh-id create present').toBeTruthy();
        expect(map.features.points.filter((f) => f.properties.id === freshId)).toHaveLength(1);
        expect(fresh.geometry).toEqual(POINT_GEOM);
        expect(fresh.properties.source).toBe('point');
        expect(fresh.properties.version).toBeGreaterThan(0);
        // The revived original is untouched by it.
        expect(findPoint(map, featureId).properties.nome).toBe('Ressuscitado');
    });
});

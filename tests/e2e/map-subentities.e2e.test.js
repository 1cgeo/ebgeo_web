// Path: tests/e2e/map-subentities.e2e.test.js

/**
 * @fileoverview E2E: map sub-entity update operations against the live backend.
 *
 * Map "sub-entities" (mapPosition / baseLayer / mapNotes / gridStyle) are not
 * standalone rows: they are UPDATE operations that patch specific columns of the
 * parent `maps` row. The backend's sync handler routes them by entityType to the
 * `map` target and normalizes the frontend payload (e.g. {title,description} ->
 * notes_title/notes_description, {format,visible} -> grid_style jsonb).
 *
 * Each test performs a real HTTP push and then re-pulls a full snapshot (sinceVersion=0)
 * to assert the parent map row reflects the mutation. A negative assertion guards the
 * cross-atlas IDOR rule: a sub-entity update carrying a foreign mapId must NOT take effect.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
    makeApi,
    registerAndLogin,
    createAtlas,
    createMap,
    waitFor,
    E2E_SKIP,
} from './helpers/harness.js';
import { createOperation } from '../../src/js/store/sync/operation-factory.js';

/**
 * Pulls a fresh snapshot and returns the map row for `mapId`.
 * @param {import('../../src/js/store/sync/api-client.js').ApiClient} api
 * @param {string} atlasId
 * @param {string} mapId
 * @returns {Promise<Object>} The snapshot map row (DB-shaped: base_layer, center_lat, ...).
 */
async function pullMap(api, atlasId, mapId) {
    const res = await api.pullSync(atlasId, 0);
    expect(res.isSnapshot).toBe(true);
    const map = res.snapshot.maps.find((m) => m.id === mapId);
    expect(map, `map ${mapId} present in snapshot`).toBeTruthy();
    return map;
}

describe.skipIf(E2E_SKIP)('e2e: map sub-entities', () => {
    let api;
    let atlasId;
    let mapId;

    beforeAll(async () => {
        api = makeApi();
        await registerAndLogin(api, { nome: 'Map Subentity User' });
        const atlas = await createAtlas(api, { name: 'Sub-entity Atlas' });
        atlasId = atlas.id;
        mapId = await createMap(api, atlasId, { name: 'Mapa Sub' });
        expect(atlasId).toBeTruthy();
        expect(mapId).toBeTruthy();
    }, 30000);

    it('applies a mapPosition update (center_lat/center_long/zoom)', async () => {
        const data = { center_lat: -22.9068, center_long: -43.1729, zoom: 12 };
        const op = createOperation('mapPosition', 'update', mapId, mapId, data);
        await api.pushOperations(atlasId, [op]);

        const map = await pullMap(api, atlasId, mapId);
        // center_lat/center_long are numeric/decimal columns; compare with tolerance.
        expect(Number(map.center_lat)).toBeCloseTo(-22.9068, 4);
        expect(Number(map.center_long)).toBeCloseTo(-43.1729, 4);
        expect(Number(map.zoom)).toBe(12);
    });

    it('applies a baseLayer update', async () => {
        const op = createOperation('baseLayer', 'update', mapId, mapId, {
            baseLayer: 'ortofoto',
        });
        await api.pushOperations(atlasId, [op]);

        const map = await pullMap(api, atlasId, mapId);
        expect(map.base_layer).toBe('ortofoto');
    });

    it('applies a mapNotes update (title/description -> notes_*)', async () => {
        const op = createOperation('mapNotes', 'update', mapId, mapId, {
            title: 'Plano de Manobra',
            description: 'Eixo principal a oeste do rio.',
        });
        await api.pushOperations(atlasId, [op]);

        const map = await pullMap(api, atlasId, mapId);
        expect(map.notes_title).toBe('Plano de Manobra');
        expect(map.notes_description).toBe('Eixo principal a oeste do rio.');
    });

    it('applies a gridStyle update ({format,visible} -> grid_style jsonb)', async () => {
        const op = createOperation('gridStyle', 'update', mapId, mapId, {
            format: 'MGRS',
            visible: true,
        });
        await api.pushOperations(atlasId, [op]);

        const map = await pullMap(api, atlasId, mapId);
        expect(map.grid_style).toMatchObject({ format: 'MGRS', visible: true });
    });

    it('reflects the cumulative state of all sub-entity updates in one snapshot', async () => {
        // After the prior pushes, a single snapshot must carry every mutation at once.
        const map = await waitFor(async () => {
            const res = await api.pullSync(atlasId, 0);
            const m = res.snapshot?.maps?.find((x) => x.id === mapId);
            return m && m.base_layer === 'ortofoto' ? m : false;
        });
        expect(map.base_layer).toBe('ortofoto');
        expect(map.notes_title).toBe('Plano de Manobra');
        expect(map.grid_style).toMatchObject({ format: 'MGRS' });
        expect(Number(map.zoom)).toBe(12);
    });

    it('does NOT mutate a map belonging to a DIFFERENT atlas (cross-atlas IDOR guard)', async () => {
        // Build a second, isolated atlas owned by a different user, with its own map.
        const otherApi = makeApi();
        await registerAndLogin(otherApi, { nome: 'Other Owner' });
        const otherAtlas = await createAtlas(otherApi, { name: 'Other Atlas' });
        const otherMapId = await createMap(otherApi, otherAtlas.id, { name: 'Outro Mapa' });

        // Snapshot the victim map's base_layer BEFORE the attack.
        const before = await pullMap(otherApi, otherAtlas.id, otherMapId);
        const baselineBaseLayer = before.base_layer;

        // Attacker pushes a baseLayer update to its OWN atlas route but targets the
        // foreign mapId. The backend's EXISTS(atlas_id) clause must reject the write.
        const evilOp = createOperation('baseLayer', 'update', otherMapId, otherMapId, {
            baseLayer: 'pwned',
        });
        await api.pushOperations(atlasId, [evilOp]);

        // The victim map must be untouched.
        const after = await pullMap(otherApi, otherAtlas.id, otherMapId);
        expect(after.base_layer).toBe(baselineBaseLayer);
        expect(after.base_layer).not.toBe('pwned');
    });
});

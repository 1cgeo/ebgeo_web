// Path: tests/e2e/duplicate-map.e2e.test.js

/**
 * @fileoverview Real-backend E2E for the map-duplicate flow (§1.10).
 *
 * Scenario: an owner creates a map holding a single point feature (pushed as CRDT
 * ops), then calls `POST /api/v1/atlas/:id/maps/:mapId/duplicate`. The duplicated
 * map must surface in a FRESH snapshot with a NEW id, the "(cópia)" name suffix,
 * and copied feature content carrying its OWN new feature id (deep clone, not a
 * shared reference). A negative case asserts duplicating an unknown map id 404s.
 *
 * Every assertion is an observable backend round-trip (REST + pullSync snapshot);
 * no DB access. The test owns its user/atlas/map for isolation.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
    E2E_SKIP,
    makeApi,
    registerAndLogin,
    createAtlas,
} from './helpers/harness.js';
import { createOperation } from '../../src/js/store/sync/operation-factory.js';
import { generateUUID } from '../../src/js/utilities/uuid.js';

describe.skipIf(E2E_SKIP)('§1.10 duplicate map (real backend)', () => {
    /** @type {import('../../src/js/store/sync/api-client.js').ApiClient} */
    let api;
    /** @type {string} */
    let atlasId;
    /** @type {string} */
    let sourceMapId;
    /** @type {string} */
    let featureId;

    const FEATURE_GEOMETRY = { type: 'Point', coordinates: [-43.18, -22.9] };
    const FEATURE_LABEL = 'cota-302';

    beforeAll(async () => {
        api = makeApi();
        await registerAndLogin(api, { nome: 'Duplicate Owner' });
        const atlas = await createAtlas(api, { name: 'Duplicate E2E Atlas' });
        atlasId = atlas.id;

        // Create a map and attach one point feature, all in a single push (one tx).
        sourceMapId = generateUUID();
        featureId = generateUUID();
        const mapOp = createOperation('map', 'create', sourceMapId, null, {
            name: 'Mapa Origem',
        });
        const featureOp = createOperation('feature', 'create', featureId, sourceMapId, {
            type: 'Feature',
            geometry: FEATURE_GEOMETRY,
            properties: { source: 'point', label: FEATURE_LABEL },
        });
        await api.pushOperations(atlasId, [mapOp, featureOp]);
    });

    /**
     * Pulls a fresh full snapshot of the test atlas.
     * @returns {Promise<{ atlas: Object, maps: Object[] }>}
     */
    async function freshSnapshot() {
        const pull = await api.pullSync(atlasId, 0);
        expect(pull.isSnapshot).toBe(true);
        return pull.snapshot;
    }

    it('seeds the source map with its point feature', async () => {
        const snap = await freshSnapshot();
        const source = snap.maps.find((m) => m.id === sourceMapId);
        expect(source).toBeTruthy();
        expect(source.features.points).toHaveLength(1);
        const pt = source.features.points[0];
        expect(pt.properties.id).toBe(featureId);
        expect(pt.properties.label).toBe(FEATURE_LABEL);
        expect(pt.geometry).toEqual(FEATURE_GEOMETRY);
    });

    it('duplicates the map into a NEW map with copied content', async () => {
        // `_request` already unwraps the `{ data }` envelope, returning the new map.
        const newMap = await api._request(
            'POST',
            `/atlas/${atlasId}/maps/${sourceMapId}/duplicate`,
        );
        expect(newMap.id).toBeTruthy();
        // The duplicate is a brand-new entity, not the source.
        expect(newMap.id).not.toBe(sourceMapId);

        const snap = await freshSnapshot();

        // Both the source and the duplicate now coexist in the atlas.
        const source = snap.maps.find((m) => m.id === sourceMapId);
        const duplicate = snap.maps.find((m) => m.id === newMap.id);
        expect(source).toBeTruthy();
        expect(duplicate).toBeTruthy();

        // The duplicate carries the "(cópia)" suffix on the source name.
        expect(duplicate.name).toBe('Mapa Origem (cópia)');

        // The feature content is copied verbatim...
        expect(duplicate.features.points).toHaveLength(1);
        const dupPt = duplicate.features.points[0];
        expect(dupPt.properties.label).toBe(FEATURE_LABEL);
        expect(dupPt.geometry).toEqual(FEATURE_GEOMETRY);

        // ...but the duplicated feature gets its OWN new id (deep clone, not shared).
        expect(dupPt.properties.id).toBeTruthy();
        expect(dupPt.properties.id).not.toBe(featureId);

        // The source map is left untouched by the duplicate.
        expect(source.features.points[0].properties.id).toBe(featureId);

        // The duplicate endpoint appends the NEW map id to the atlas map order
        // (`array_append`). map_order is otherwise frontend-managed (via PUT
        // /atlas/:id) — a map created purely via a sync op, like the source here,
        // is intentionally NOT auto-added to map_order, so only the duplicate's id
        // appears. Membership in `snap.maps` is independent of map_order.
        expect(snap.atlas.mapOrder).toContain(newMap.id);
    });

    it('404s when duplicating a non-existent map id', async () => {
        // The STATUS is the claim, so assert the status (like combine-maps does):
        // a bare `rejects.toThrow()` would also pass on a 500, on a network error
        // or on a parse failure — i.e. on the backend being broken.
        await expect(
            api._request(
                'POST',
                `/atlas/${atlasId}/maps/${generateUUID()}/duplicate`,
            ),
        ).rejects.toMatchObject({ status: 404 });
    });
});

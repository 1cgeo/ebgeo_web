// Path: tests/e2e/feature-geojson-shape.e2e.test.js

/**
 * @fileoverview E2E: pushing a feature whose `data` is a raw GeoJSON Feature
 * carrying ONLY `properties.source` and `properties.layerId` (no top-level
 * `feature_type` / `layer_id`). Proves the backend derives the flat
 * `feature_type` column from `properties.source`, since the snapshot returns
 * the feature under the type-keyed collection with `properties.source` set.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
    makeApi,
    registerAndLogin,
    createAtlas,
    createMap,
    newClientId,
    E2E_SKIP,
} from './helpers/harness.js';
import { createOperation } from '../../src/js/store/sync/operation-factory.js';
import { generateUUID } from '../../src/js/utilities/uuid.js';

describe.skipIf(E2E_SKIP)('e2e: feature-geojson-shape', () => {
    let api;
    let atlasId;
    let mapId;

    beforeAll(async () => {
        api = makeApi();
        await registerAndLogin(api, { nome: 'GeoJSON Shape User' });
        const atlas = await createAtlas(api, { name: 'GeoJSON Shape Atlas' });
        atlasId = atlas.id;
        mapId = await createMap(api, atlasId, { name: 'Mapa GeoJSON' });
    });

    afterAll(async () => {
        if (api) await api.logout().catch(() => {});
    });

    it('derives feature_type from properties.source for a raw GeoJSON feature', async () => {
        const featureId = generateUUID();
        const layerId = generateUUID();

        // Raw GeoJSON Feature: NO top-level feature_type / layer_id. The type and
        // layer live ONLY inside properties (source / layerId).
        const rawGeoJson = {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
            properties: {
                id: featureId,
                source: 'point',
                layerId,
                label: 'Marco Zero',
            },
        };

        const op = createOperation('feature', 'create', featureId, mapId, rawGeoJson);
        // Sanity: the envelope we send genuinely lacks the flat columns.
        expect(op.data.feature_type).toBeUndefined();
        expect(op.data.layer_id).toBeUndefined();
        expect(op.data.properties.source).toBe('point');

        const pushRes = await api.pushOperations(atlasId, [op]);
        expect(pushRes.serverVersion).toBeGreaterThan(0);

        const pull = await api.pullSync(atlasId, 0);
        expect(pull.isSnapshot).toBe(true);
        expect(pull.snapshot).toBeTruthy();

        const map = pull.snapshot.maps.find((m) => m.id === mapId);
        expect(map).toBeTruthy();

        // Backend transformFeaturesToFrontend buckets `point` features under
        // `features.points` — which only happens if feature_type was derived as
        // 'point' from properties.source.
        const points = map.features.points;
        expect(Array.isArray(points)).toBe(true);

        const stored = points.find((f) => f.properties.id === featureId);
        expect(stored).toBeTruthy();

        // Core assertion: backend round-trips source === derived feature_type.
        expect(stored.properties.source).toBe('point');
        expect(stored.type).toBe('Feature');
        expect(stored.geometry).toEqual({ type: 'Point', coordinates: [-43.2, -22.9] });
        expect(stored.properties.label).toBe('Marco Zero');

        // Negative/edge: the feature must NOT have leaked into another collection
        // (proves it was bucketed by the derived type, not duplicated everywhere).
        expect((map.features.lines || []).some((f) => f.properties.id === featureId)).toBe(false);
        expect((map.features.polygons || []).some((f) => f.properties.id === featureId)).toBe(false);
        expect((map.features.images || []).some((f) => f.properties.id === featureId)).toBe(false);
    });

    it('keeps a distinct client id available for collaborative ops', () => {
        // newClientId is part of the harness contract this suite depends on.
        expect(typeof newClientId()).toBe('string');
        expect(newClientId()).not.toBe(newClientId());
    });
});

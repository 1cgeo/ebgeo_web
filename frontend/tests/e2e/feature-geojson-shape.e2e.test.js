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

    it('round-trips the boundary zoom anchor and its derived sizes', async () => {
        // The boundary tool stores SEVEN properties nothing on the server knows
        // about: the anchor pair (`createdAtZoom` / `zoomCorrectionEnabled`), the
        // label axis (`text_north_facing`) and the four `calculated*` caches the
        // zoom pass writes. `properties` is a free JSONB column with no per-key
        // rule, so the contract is that they come back byte for byte; the client
        // recomputes the caches on the first zoom, but a peer that receives a
        // TRUNCATED payload draws the boundary at the wrong scale and nothing
        // reports it. This case is what makes "the server does not touch them" a
        // measurement instead of a reading of the schema.
        const featureId = generateUUID();
        const layerId = generateUUID();

        const boundary = {
            type: 'Feature',
            geometry: {
                // A boundary is a MultiLineString: the spine minus the echelon
                // gaps, plus one pair of strokes per 'X'.
                type: 'MultiLineString',
                coordinates: [
                    [[-47.0, -15.0], [-46.95, -15.025]],
                    [[-46.94, -15.03], [-46.9, -15.05]],
                    [[-46.9455, -15.0261], [-46.9345, -15.0239]],
                ],
            },
            properties: {
                id: featureId,
                source: 'boundary',
                layerId,
                nome: 'Limite 1',
                baseCoordinates: [[-47.0, -15.0], [-46.9, -15.05]],
                echelon: 'XXX',
                symbol_instances: [{ ratio: 0.5, showLabels: true }],
                symbol_size: 1,
                lineWidth: 4,
                text_size: 35,
                text_top: 'CIA A',
                text_bottom: 'CIA B',
                text_distance_ratio: 0.9,
                // The seven under test.
                createdAtZoom: 13.2,
                zoomCorrectionEnabled: false,
                text_north_facing: true,
                calculatedLineWidth: 4,
                calculatedTextSize: 35,
                calculatedStrokeWidth: 2,
                calculatedSymbolSize: 7.5,
            },
        };

        const op = createOperation('feature', 'create', featureId, mapId, boundary);
        const pushRes = await api.pushOperations(atlasId, [op]);
        expect(pushRes.serverVersion).toBeGreaterThan(0);

        const pull = await api.pullSync(atlasId, 0);
        const map = pull.snapshot.maps.find((m) => m.id === mapId);
        const stored = (map.features.boundarys || []).find((f) => f.properties.id === featureId);
        expect(stored, 'a divisa nao voltou no balde `boundarys`').toBeTruthy();

        // The anchor pair, and the `false` in particular: a boolean dropped to
        // `undefined` reads as "correction on", which is the OPPOSITE regime.
        expect(stored.properties.createdAtZoom).toBe(13.2);
        expect(stored.properties.zoomCorrectionEnabled).toBe(false);
        expect(stored.properties.text_north_facing).toBe(true);

        // The four caches, including the one that only exists while the feature is
        // pinned to the screen.
        expect(stored.properties.calculatedLineWidth).toBe(4);
        expect(stored.properties.calculatedTextSize).toBe(35);
        expect(stored.properties.calculatedStrokeWidth).toBe(2);
        expect(stored.properties.calculatedSymbolSize).toBe(7.5);

        // The authored inputs the model reads, and the spine the geometry is
        // rebuilt from: without it, a redraw at another zoom has nothing to draw.
        expect(stored.properties.symbol_size).toBe(1);
        expect(stored.properties.echelon).toBe('XXX');
        expect(stored.properties.text_size).toBe(35);
        expect(stored.properties.baseCoordinates).toEqual([[-47.0, -15.0], [-46.9, -15.05]]);
        expect(stored.properties.symbol_instances).toEqual([{ ratio: 0.5, showLabels: true }]);

        // The MultiLineString survives whole: the server has no per-type geometry
        // validation, and the gaps are what make a boundary look like one.
        expect(stored.geometry).toEqual(boundary.geometry);

        // NEGATIVE: nothing was invented either. `properties` is a free field, so a
        // key the client never wrote must not appear (the five the snapshot
        // deliberately overwrites from columns are excluded by name).
        const overwrittenByColumns = ['id', 'source', 'createdAt', 'updatedAt', 'version'];
        const unexpected = Object.keys(stored.properties)
            .filter((key) => !(key in boundary.properties))
            .filter((key) => !overwrittenByColumns.includes(key));
        expect(unexpected, 'o servidor acrescentou chave nenhuma ferramenta escreveu').toEqual([]);
    });

    it('keeps a distinct client id available for collaborative ops', () => {
        // newClientId is part of the harness contract this suite depends on.
        expect(typeof newClientId()).toBe('string');
        expect(newClientId()).not.toBe(newClientId());
    });
});

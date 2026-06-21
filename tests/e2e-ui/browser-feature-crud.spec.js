// Path: e2e-ui/browser-feature-crud.spec.js

/**
 * Browser-level feature CRUD: drives the REAL frontend transport modules
 * (api-client / operation-factory), imported live from the Vite dev server INSIDE
 * real Chromium, against the REAL spawned backend. Every assertion is grounded in
 * observable backend state read back through `api.pullSync` — no mocks, real HTTP.
 *
 * The atlas feature model is GeoJSON: the feature TYPE is carried in
 * `properties.source` (`point` / `line` / `polygon`), which the backend persists as
 * the `feature_type` column and which `pullSync` then sorts into the snapshot buckets
 * `map.features.{points,lines,polygons}`. Writes are CRDT operations pushed via
 * `api.pushOperations` (there are NO REST write routes for features).
 *
 * Coverage:
 *   - create one point + one line + one polygon, assert each lands in its OWN bucket;
 *   - update the polygon (move a vertex + rename), assert the snapshot reflects it;
 *   - delete the line, assert it disappears from the `lines` bucket while the
 *     point/polygon survive;
 *   - edge: a feature created under a NON-EXISTENT map id never appears in any bucket
 *     (the backend gates feature inserts on the map belonging to the atlas).
 *
 * Each test self-provisions its own user + atlas + map for isolation.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

describeOrSkip('Feature CRUD (real Chromium + real backend, transport via page.evaluate)', () => {
    test('create point/line/polygon → update polygon → delete line, all verified via pullSync buckets', async ({
        page,
    }) => {
        await page.goto('/');

        const result = await page.evaluate(async (baseUrl) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

            const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
            const username = `crud_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
            const password = 'Sup3r-Secret-Pw!';
            await api.register({ username, password, nome: 'CRUD User' });
            await api.login(username, password);

            const atlas = await api.createAtlas({ name: 'CRUD Atlas' });
            const mapId = crypto.randomUUID();
            await api.pushOperations(atlas.id, [
                createOperation('map', 'create', mapId, null, { name: 'M1' }),
            ]);

            // ---- helpers --------------------------------------------------
            const makeFeature = (id, source, geometry, extraProps = {}) => ({
                type: 'Feature',
                geometry,
                properties: { id, source, ...extraProps },
            });
            const pullMap = async () => {
                const pulled = await api.pullSync(atlas.id, 0);
                return pulled.snapshot?.maps?.find((m) => m.id === mapId);
            };
            const bucketIds = (map, bucket) =>
                (map?.features?.[bucket] || []).map((f) => f.properties.id);

            // ---- CREATE one of each geometry kind -------------------------
            const pointId = crypto.randomUUID();
            const lineId = crypto.randomUUID();
            const polygonId = crypto.randomUUID();

            const point = makeFeature(pointId, 'point', {
                type: 'Point',
                coordinates: [-43.2, -22.9],
            }, { nome: 'Ponto' });
            const line = makeFeature(lineId, 'line', {
                type: 'LineString',
                coordinates: [
                    [-43.2, -22.9],
                    [-43.1, -22.8],
                ],
            }, { nome: 'Linha' });
            const polygon = makeFeature(polygonId, 'polygon', {
                type: 'Polygon',
                coordinates: [
                    [
                        [-43.2, -22.9],
                        [-43.1, -22.9],
                        [-43.1, -22.8],
                        [-43.2, -22.9],
                    ],
                ],
            }, { nome: 'Poligono' });

            await api.pushOperations(atlas.id, [
                createOperation('feature', 'create', pointId, mapId, point),
                createOperation('feature', 'create', lineId, mapId, line),
                createOperation('feature', 'create', polygonId, mapId, polygon),
            ]);

            const afterCreate = await pullMap();
            const created = {
                isSnapshot: true,
                pointInPoints: bucketIds(afterCreate, 'points').includes(pointId),
                lineInLines: bucketIds(afterCreate, 'lines').includes(lineId),
                polygonInPolygons: bucketIds(afterCreate, 'polygons').includes(polygonId),
                // cross-bucket isolation: a point must NOT leak into lines/polygons.
                pointNotInLines: !bucketIds(afterCreate, 'lines').includes(pointId),
                pointNotInPolygons: !bucketIds(afterCreate, 'polygons').includes(pointId),
                // the persisted source must match the bucket the backend chose.
                polygonSource: (afterCreate?.features?.polygons || []).find(
                    (f) => f.properties.id === polygonId,
                )?.properties.source,
            };

            // ---- UPDATE the polygon (move a vertex + rename) --------------
            const updatedPolygon = makeFeature(polygonId, 'polygon', {
                type: 'Polygon',
                coordinates: [
                    [
                        [-43.25, -22.95],
                        [-43.05, -22.95],
                        [-43.05, -22.75],
                        [-43.25, -22.95],
                    ],
                ],
            }, { nome: 'Poligono Editado' });
            await api.pushOperations(atlas.id, [
                createOperation('feature', 'update', polygonId, mapId, updatedPolygon),
            ]);

            const afterUpdate = await pullMap();
            const updatedFeature = (afterUpdate?.features?.polygons || []).find(
                (f) => f.properties.id === polygonId,
            );
            const updated = {
                stillInPolygons: bucketIds(afterUpdate, 'polygons').includes(polygonId),
                renamed: updatedFeature?.properties.nome === 'Poligono Editado',
                vertexMoved:
                    updatedFeature?.geometry?.coordinates?.[0]?.[0]?.[0] === -43.25,
                // count must stay 1 — update is not a second create.
                polygonCount: (afterUpdate?.features?.polygons || []).filter(
                    (f) => f.properties.id === polygonId,
                ).length,
            };

            // ---- DELETE the line ------------------------------------------
            await api.pushOperations(atlas.id, [
                createOperation('feature', 'delete', lineId, mapId, null),
            ]);

            const afterDelete = await pullMap();
            const deleted = {
                lineGone: !bucketIds(afterDelete, 'lines').includes(lineId),
                pointSurvives: bucketIds(afterDelete, 'points').includes(pointId),
                polygonSurvives: bucketIds(afterDelete, 'polygons').includes(polygonId),
            };

            // ---- EDGE: feature under a non-existent map is rejected --------
            const orphanMapId = crypto.randomUUID();
            const orphanId = crypto.randomUUID();
            await api.pushOperations(atlas.id, [
                createOperation(
                    'feature',
                    'create',
                    orphanId,
                    orphanMapId,
                    makeFeature(orphanId, 'point', { type: 'Point', coordinates: [0, 0] }),
                ),
            ]);
            const afterOrphan = await api.pullSync(atlas.id, 0);
            const orphanLandedSomewhere = (afterOrphan.snapshot?.maps || []).some((m) =>
                Object.values(m.features || {}).some(
                    (bucket) =>
                        Array.isArray(bucket) &&
                        bucket.some((f) => f.properties?.id === orphanId),
                ),
            );

            return {
                hasToken: Boolean(api.getAccessToken()),
                created,
                updated,
                deleted,
                edge: { orphanLandedSomewhere },
            };
        }, state.baseUrl);

        // ---- CREATE assertions: each geometry in its own bucket, isolated ----
        expect(result.hasToken).toBe(true);
        expect(result.created.pointInPoints).toBe(true);
        expect(result.created.lineInLines).toBe(true);
        expect(result.created.polygonInPolygons).toBe(true);
        expect(result.created.pointNotInLines).toBe(true);
        expect(result.created.pointNotInPolygons).toBe(true);
        expect(result.created.polygonSource).toBe('polygon');

        // ---- UPDATE assertions: in place, single instance, content changed ----
        expect(result.updated.stillInPolygons).toBe(true);
        expect(result.updated.renamed).toBe(true);
        expect(result.updated.vertexMoved).toBe(true);
        expect(result.updated.polygonCount).toBe(1);

        // ---- DELETE assertions: line gone, siblings survive ----
        expect(result.deleted.lineGone).toBe(true);
        expect(result.deleted.pointSurvives).toBe(true);
        expect(result.deleted.polygonSurvives).toBe(true);

        // ---- EDGE assertion: orphan feature never surfaces in any bucket ----
        expect(result.edge.orphanLandedSomewhere).toBe(false);
    });
});

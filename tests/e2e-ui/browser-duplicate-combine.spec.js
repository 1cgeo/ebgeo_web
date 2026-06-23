// Path: e2e-ui/browser-duplicate-combine.spec.js

/**
 * @fileoverview Browser-level map duplicate + merge test. Drives the REAL frontend
 * transport (api-client / operation-factory) imported live from the Vite dev server
 * INSIDE real Chromium, against the REAL backend, and exercises the backend's
 * structural REST routes via authenticated `fetch` (using the live access token from
 * `api.getAccessToken()`) — these routes have no api-client helper, so they are
 * driven with raw `fetch` from inside the page.
 *
 * Proves, with real HTTP round-trips in the browser, the structural-op contracts:
 *   1. DUPLICATE — `POST /atlas/:id/maps/:mapId/duplicate` clones a map plus all its
 *      sub-entities into a brand-new map (201, `name` suffixed with " (cópia)", a
 *      fresh id). The pulled snapshot then exposes BOTH maps, and the duplicate carries
 *      a COPY of the source feature (new feature id, same coordinates/source). Mutating
 *      the original afterwards does not bleed into the copy (independent rows).
 *      (negative edge) duplicating a non-existent map id → 404.
 *   2. MERGE — `POST /atlas/:id/maps/:mapId/merge` with `{ sourceMapIds }` moves the
 *      source maps' sub-entities into the destination map in one transaction. After the
 *      merge the destination feature list contains BOTH features, and the source map is
 *      emptied (its sub-entities moved, not copied). (negative edge) a `sourceMapIds`
 *      that names a map from a DIFFERENT atlas → 404 and nothing is moved.
 *
 * Each test seeds its own user + atlas + maps for isolation. No app UI is clicked
 * (no data-testid needed): the specs drive the transport in `page.evaluate`.
 *
 * no-UI: these two tests target the BACKEND's structural REST routes
 * (POST .../maps/:id/duplicate and .../merge) and assert their server contract — status
 * codes (201/200/404), the " (cópia)" name suffix, the `moved.features` count and the
 * cross-atlas 404 tenancy gate. The app's own "Duplicar" / "Puxar outros mapas" map-menu
 * items run a DIFFERENT, LOCAL store path (mapManager.copyMap / combineMapGroups) that
 * never calls these routes, so there is no UI gesture that exercises this server contract.
 * They therefore stay transport probes driven via raw authenticated `fetch`.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

const PASSWORD = 'Sup3r-Secret-Pw!';

describeOrSkip('Map duplicate + merge structural routes (real Chromium + real backend)', () => {
    test('duplicate clones a map and its feature into a new map; missing source 404s', async ({
        page,
    }) => {
        await page.goto('/');

        const result = await page.evaluate(
            async ({ baseUrl, password }) => {
                const { ApiClient } = await import('/src/js/store/sync/api-client.js');
                const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

                const apiBase = `${baseUrl}/api/v1`;
                const api = new ApiClient({ baseUrl: apiBase });
                const username = `dup_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
                await api.register({ username, password, nome: 'Duplicate Owner' });
                await api.login(username, password);

                // --- Seed atlas + one map carrying one point feature. ---
                const atlas = await api.createAtlas({ name: 'Duplicate Atlas' });
                const srcMapId = crypto.randomUUID();
                await api.pushOperations(atlas.id, [
                    createOperation('map', 'create', srcMapId, null, { name: 'Source Map' }),
                ]);
                const srcFeatureId = crypto.randomUUID();
                const coords = [-43.21, -22.91];
                await api.pushOperations(atlas.id, [
                    createOperation('feature', 'create', srcFeatureId, srcMapId, {
                        type: 'Feature',
                        geometry: { type: 'Point', coordinates: coords },
                        properties: { id: srcFeatureId, source: 'point', nome: 'orig point' },
                    }),
                ]);

                /** POSTs the duplicate route with the live owner token. */
                const duplicate = async (mapId) => {
                    const res = await fetch(
                        `${apiBase}/atlas/${atlas.id}/maps/${mapId}/duplicate`,
                        {
                            method: 'POST',
                            headers: { Authorization: `Bearer ${api.getAccessToken()}` },
                        },
                    );
                    let body = null;
                    try {
                        body = await res.json();
                    } catch {
                        body = null;
                    }
                    return { status: res.status, body };
                };

                // --- Duplicate the seeded map. ---
                const dup = await duplicate(srcMapId);
                const newMapId = dup.body?.data?.id;
                const newMapName = dup.body?.data?.name;

                // Mutate the ORIGINAL feature AFTER the copy, to prove independence.
                await api.pushOperations(atlas.id, [
                    createOperation('feature', 'update', srcFeatureId, srcMapId, {
                        type: 'Feature',
                        geometry: { type: 'Point', coordinates: coords },
                        properties: { id: srcFeatureId, source: 'point', nome: 'MUTATED orig' },
                    }),
                ]);

                // --- Read back: both maps present; the copy has its own feature. ---
                const pulled = await api.pullSync(atlas.id, 0);
                const maps = pulled.snapshot?.maps || [];
                const srcMap = maps.find((m) => m.id === srcMapId);
                const newMap = maps.find((m) => m.id === newMapId);
                const srcPoints = srcMap?.features?.points || [];
                const newPoints = newMap?.features?.points || [];
                const copiedPoint = newPoints[0] || null;

                // (negative edge) duplicating an unknown map id must 404.
                const missing = await duplicate(crypto.randomUUID());

                return {
                    dupStatus: dup.status,
                    newMapId,
                    newMapName,
                    bothMapsPresent: Boolean(srcMap) && Boolean(newMap),
                    newMapIsDistinct: Boolean(newMapId) && newMapId !== srcMapId,
                    srcPointCount: srcPoints.length,
                    newPointCount: newPoints.length,
                    copyHasNewFeatureId:
                        Boolean(copiedPoint) && copiedPoint.properties.id !== srcFeatureId,
                    copyHasSameCoords:
                        Boolean(copiedPoint) &&
                        JSON.stringify(copiedPoint.geometry?.coordinates) ===
                            JSON.stringify(coords),
                    copyUntouchedByMutation:
                        Boolean(copiedPoint) && copiedPoint.properties.nome === 'orig point',
                    missingStatus: missing.status,
                };
            },
            { baseUrl: state.baseUrl, password: PASSWORD },
        );

        // Duplicate succeeded with a 201 and a fresh, suffixed map.
        expect(result.dupStatus).toBe(201);
        expect(result.newMapIsDistinct).toBe(true);
        expect(result.newMapName).toMatch(/\(cópia\)/);

        // Both the original and the copy are in the snapshot, each with one point.
        expect(result.bothMapsPresent).toBe(true);
        expect(result.srcPointCount).toBe(1);
        expect(result.newPointCount).toBe(1);

        // The copy is an independent row: new feature id, same coords, NOT mutated.
        expect(result.copyHasNewFeatureId).toBe(true);
        expect(result.copyHasSameCoords).toBe(true);
        expect(result.copyUntouchedByMutation).toBe(true);

        // (negative edge) duplicating a non-existent map → 404.
        expect(result.missingStatus).toBe(404);
    });

    test('merge moves source-map features into the dest map; cross-atlas source 404s', async ({
        page,
    }) => {
        await page.goto('/');

        const result = await page.evaluate(
            async ({ baseUrl, password }) => {
                const { ApiClient } = await import('/src/js/store/sync/api-client.js');
                const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

                const apiBase = `${baseUrl}/api/v1`;
                const api = new ApiClient({ baseUrl: apiBase });
                const username = `mrg_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
                await api.register({ username, password, nome: 'Merge Owner' });
                await api.login(username, password);

                /** Creates a map under `atlasId` carrying one named point feature. */
                const seedMapWithPoint = async (atlasId, mapName, nome, coords) => {
                    const mapId = crypto.randomUUID();
                    await api.pushOperations(atlasId, [
                        createOperation('map', 'create', mapId, null, { name: mapName }),
                    ]);
                    const featureId = crypto.randomUUID();
                    await api.pushOperations(atlasId, [
                        createOperation('feature', 'create', featureId, mapId, {
                            type: 'Feature',
                            geometry: { type: 'Point', coordinates: coords },
                            properties: { id: featureId, source: 'point', nome },
                        }),
                    ]);
                    return { mapId, featureId };
                };

                /** POSTs the merge route with the live owner token. */
                const merge = async (atlasId, destMapId, sourceMapIds) => {
                    const res = await fetch(
                        `${apiBase}/atlas/${atlasId}/maps/${destMapId}/merge`,
                        {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                Authorization: `Bearer ${api.getAccessToken()}`,
                            },
                            body: JSON.stringify({ sourceMapIds }),
                        },
                    );
                    let body = null;
                    try {
                        body = await res.json();
                    } catch {
                        body = null;
                    }
                    return { status: res.status, body };
                };

                // --- Seed ONE atlas with a dest map and a source map, each with a point. ---
                const atlas = await api.createAtlas({ name: 'Merge Atlas' });
                const dest = await seedMapWithPoint(atlas.id, 'Dest Map', 'dest point', [-43.1, -22.1]);
                const src = await seedMapWithPoint(atlas.id, 'Source Map', 'src point', [-43.2, -22.2]);

                // --- Merge the source map's contents into the dest map. ---
                const merged = await merge(atlas.id, dest.mapId, [src.mapId]);
                const movedFeatures = merged.body?.data?.moved?.features;

                // Read back: dest now holds BOTH points; source is emptied.
                const pulled = await api.pullSync(atlas.id, 0);
                const maps = pulled.snapshot?.maps || [];
                const destMap = maps.find((m) => m.id === dest.mapId);
                const srcMap = maps.find((m) => m.id === src.mapId);
                const destPoints = destMap?.features?.points || [];
                const srcPoints = srcMap?.features?.points || [];
                const destHasDest = destPoints.some((p) => p.properties.id === dest.featureId);
                const destHasSrc = destPoints.some((p) => p.properties.id === src.featureId);

                // --- (negative edge) a source map from a DIFFERENT atlas must 404. ---
                const otherAtlas = await api.createAtlas({ name: 'Other Atlas' });
                const foreign = await seedMapWithPoint(
                    otherAtlas.id,
                    'Foreign Map',
                    'foreign point',
                    [0, 0],
                );
                // dest2 lives in the FIRST atlas; we try to pull in a foreign-atlas map.
                const dest2 = await seedMapWithPoint(atlas.id, 'Dest2 Map', 'dest2 point', [1, 1]);
                const crossAtlas = await merge(atlas.id, dest2.mapId, [foreign.mapId]);

                // The cross-atlas merge moved nothing: dest2 still holds only its own point.
                const pulled2 = await api.pullSync(atlas.id, 0);
                const dest2Map = (pulled2.snapshot?.maps || []).find((m) => m.id === dest2.mapId);
                const dest2Points = dest2Map?.features?.points || [];
                const dest2Untouched =
                    dest2Points.length === 1 &&
                    dest2Points[0].properties.id === dest2.featureId;
                // And the foreign source still has its feature (was not moved).
                const pulledOther = await api.pullSync(otherAtlas.id, 0);
                const foreignMap = (pulledOther.snapshot?.maps || []).find(
                    (m) => m.id === foreign.mapId,
                );
                const foreignPoints = foreignMap?.features?.points || [];
                const foreignIntact = foreignPoints.some(
                    (p) => p.properties.id === foreign.featureId,
                );

                return {
                    mergeStatus: merged.status,
                    movedFeatures,
                    destMapId: merged.body?.data?.destMapId,
                    destHasBoth: destHasDest && destHasSrc,
                    destPointCount: destPoints.length,
                    srcEmptied: srcPoints.length === 0,
                    crossAtlasStatus: crossAtlas.status,
                    dest2Untouched,
                    foreignIntact,
                };
            },
            { baseUrl: state.baseUrl, password: PASSWORD },
        );

        // Merge succeeded (200) and reported one feature moved into the dest map.
        expect(result.mergeStatus).toBe(200);
        expect(result.movedFeatures).toBe(1);
        expect(result.destMapId).toBeTruthy();

        // Dest map now holds BOTH points; the source map is emptied (moved, not copied).
        expect(result.destHasBoth).toBe(true);
        expect(result.destPointCount).toBe(2);
        expect(result.srcEmptied).toBe(true);

        // (negative edge) a cross-atlas source → 404, with nothing moved on either side.
        expect(result.crossAtlasStatus).toBe(404);
        expect(result.dest2Untouched).toBe(true);
        expect(result.foreignIntact).toBe(true);
    });
});

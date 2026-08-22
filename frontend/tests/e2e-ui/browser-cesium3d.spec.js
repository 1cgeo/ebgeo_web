// Path: e2e-ui/browser-cesium3d.spec.js

/**
 * Browser-level Cesium-3D transport test. Drives the REAL frontend transport
 * (api-client / operation-factory) imported live from the Vite dev server inside
 * real Chromium, against the REAL spawned backend.
 *
 * Proves the FLAT camelCase 3D entity pipeline round-trips end to end:
 *   - `marker3d` / `measurement3d` / `viewshed3d` / `cameraPosition3d` `create`
 *     ops (each a flat camelCase payload `{ id, tilesetId, ...rest }`) are pushed
 *     over HTTP and reappear in the persisted snapshot under the hierarchical
 *     `map.cesium3d` structure (`markers[]` / `measurements[]` / `viewsheds[]`
 *     arrays + `cameraPositions{}` keyed by `tilesetId`), with `tilesetId`
 *     preserved on every entry;
 *   - an `update` op (payload carried in `data`, the only shape the real factory
 *     emits) merges into the entity's JSONB `data` in the snapshot;
 *   - a `delete` op soft-deletes the entity so it vanishes from the snapshot
 *     (negative/edge assertion);
 *   - LWW-by-arrival: a `create` followed by an `update` on the SAME id keeps ONE
 *     entry whose payload reflects the LAST arrival (last-writer-wins);
 *   - create idempotency: a REPEATED `create` for a still-live id is a no-op
 *     (`INSERT ... ON CONFLICT (id) DO NOTHING`), so the FIRST payload survives and a
 *     replayed/stale create can never clobber live data.
 *
 * Each test seeds its OWN user + atlas + map for full isolation.
 *
 * UI-first note: marker3d / measurement3d / viewshed3d / cameraPosition3d are
 * VIEWER-ONLY entities — they exist only inside the Cesium 3D viewer and are placed by
 * picking a rendered 3D-Tiles scene, NOT by a single-gesture click on the 2D MapLibre
 * map. The viewer needs a live WebGL Cesium context + a served tileset, which self-skip
 * headless (see viewer-3d-open.spec.js §20.13-19). So this transport-shape spec drives
 * the real api-client / operation-factory directly via `page.evaluate`; every assertion
 * still reads observable backend `pullSync` state. The 2D-map UI that DOES exist (the
 * #feature-toggle-models3d marker viewer + opening the Cesium viewer) is covered by the
 * dedicated UI spec viewer-3d-open.spec.js.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { createVerifiedUser } from './helpers/accounts.js';
import { seedTileset } from './helpers/catalog-seed.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/**
 * Seeds a fresh atlas + map for a VERIFIED user and returns a handle stashed on
 * `window.__c3d` (so later `page.evaluate` calls can reuse the same ApiClient), plus
 * the ids the Node side needs. The ACCOUNT is created on the Node side by
 * `createVerifiedUser` (confirming the e-mail needs Postgres); the page only logs in.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} baseUrl - backend origin (without the `/api/v1` suffix)
 * @param {string} prefix - username prefix, for readable test isolation
 * @returns {Promise<{ atlasId: string, mapId: string }>}
 */
async function seed(page, baseUrl, prefix) {
    const user = await createVerifiedUser({ prefix, nome: 'Cesium3D E2E' });
    return page.evaluate(
        async ({ baseUrl: url, u }) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

            const api = new ApiClient({ baseUrl: `${url}/api/v1` });
            await api.login(u.username, u.password);

            const atlas = await api.createAtlas({ name: 'Cesium3D Atlas' });
            const mapId = crypto.randomUUID();
            await api.pushOperations(atlas.id, [createOperation('map', 'create', mapId, null, { name: 'M1' })]);

            window.__c3d = { api, createOperation };
            return { atlasId: atlas.id, mapId };
        },
        { baseUrl, u: user },
    );
}

describeOrSkip('Cesium-3D transport (real Chromium + real backend)', () => {
    test('create marker3d/measurement3d/viewshed3d/cameraPosition3d → snapshot map.cesium3d structure', async ({
        page,
    }) => {
        await page.goto('/');
        const { atlasId, mapId } = await seed(page, state.baseUrl, 'c3d_create');
        const tilesetId = await seedTileset(state.dbName);

        const result = await page.evaluate(
            async ({ atlasId: aid, mapId: mid, tilesetId }) => {
                const { api, createOperation } = window.__c3d;

                // FLAT camelCase entities, exactly the shape the real frontend emits:
                // ids + tilesetId at the top level, the rest is opaque `data`.
                const markerId = crypto.randomUUID();
                const measurementId = crypto.randomUUID();
                const viewshedId = crypto.randomUUID();
                const cameraId = crypto.randomUUID();

                const marker = {
                    id: markerId,
                    tilesetId,
                    position: { lng: -43.2, lat: -22.9, height: 12 },
                    properties: { label: 'M3D' },
                };
                const measurement = {
                    id: measurementId,
                    tilesetId,
                    points: [
                        { lng: -43.2, lat: -22.9 },
                        { lng: -43.1, lat: -22.8 },
                    ],
                    distance: 1234.5,
                };
                const viewshed = {
                    id: viewshedId,
                    tilesetId,
                    observer: { lng: -43.2, lat: -22.9, height: 30 },
                    radius: 500,
                };
                // cameraPositions are keyed by tilesetId in the snapshot. The entity id
                // is a real UUID (the DB id column is a UUID); the snapshot bucket key is
                // the tilesetId, so the entry is retrieved via cameraPositions[tilesetId].
                const cameraPosition = {
                    id: cameraId,
                    tilesetId,
                    heading: 90,
                    pitch: -45,
                    roll: 0,
                };

                // no-UI: marker3d/measurement3d/viewshed3d/cameraPosition3d are
                // viewer-only (placed by picking a rendered 3D-Tiles scene in the Cesium
                // viewer, which self-skips headless) — driven on the real transport.
                await api.pushOperations(aid, [
                    createOperation('marker3d', 'create', markerId, mid, marker),
                    createOperation('measurement3d', 'create', measurementId, mid, measurement),
                    createOperation('viewshed3d', 'create', viewshedId, mid, viewshed),
                    createOperation('cameraPosition3d', 'create', cameraId, mid, cameraPosition),
                ]);

                const pulled = await api.pullSync(aid, 0);
                const map = pulled.snapshot?.maps?.find((m) => m.id === mid);
                return { isSnapshot: pulled.isSnapshot, cesium3d: map?.cesium3d, ids: { markerId, measurementId, viewshedId, tilesetId, cameraId } };
            },
            { atlasId, mapId, tilesetId },
        );

        expect(result.isSnapshot).toBe(true);

        const c3d = result.cesium3d;
        // The hierarchical structure must exist with the four canonical buckets.
        expect(c3d).toBeTruthy();
        expect(Array.isArray(c3d.markers)).toBe(true);
        expect(Array.isArray(c3d.measurements)).toBe(true);
        expect(Array.isArray(c3d.viewsheds)).toBe(true);
        expect(typeof c3d.cameraPositions).toBe('object');
        expect(Array.isArray(c3d.cameraPositions)).toBe(false);

        // `tilesetId` NAO sai daqui: ele e o do seed, criado no Node antes do evaluate.
        const { markerId, measurementId, viewshedId, cameraId } = result.ids;

        const marker = c3d.markers.find((m) => m.id === markerId);
        expect(marker).toBeTruthy();
        expect(marker.tilesetId).toBe(tilesetId); // tilesetId preserved on the entry
        expect(marker.position).toEqual({ lng: -43.2, lat: -22.9, height: 12 });

        const measurement = c3d.measurements.find((m) => m.id === measurementId);
        expect(measurement).toBeTruthy();
        expect(measurement.tilesetId).toBe(tilesetId);
        expect(measurement.distance).toBe(1234.5);

        const viewshed = c3d.viewsheds.find((v) => v.id === viewshedId);
        expect(viewshed).toBeTruthy();
        expect(viewshed.tilesetId).toBe(tilesetId);
        expect(viewshed.radius).toBe(500);

        // cameraPositions is a map keyed by tilesetId, NOT an array.
        const camera = c3d.cameraPositions[tilesetId];
        expect(camera).toBeTruthy();
        expect(camera.id).toBe(cameraId);
        expect(camera.tilesetId).toBe(tilesetId);
        expect(camera.heading).toBe(90);
    });

    test('update merges into the entity JSONB; delete soft-removes it from the snapshot', async ({ page }) => {
        await page.goto('/');
        const { atlasId, mapId } = await seed(page, state.baseUrl, 'c3d_mutate');
        const tilesetId = await seedTileset(state.dbName);

        const result = await page.evaluate(
            async ({ atlasId: aid, mapId: mid, tilesetId }) => {
                const { api, createOperation } = window.__c3d;
                const keepId = crypto.randomUUID();
                const dropId = crypto.randomUUID();

                // no-UI: viewer-only marker3d (Cesium viewer self-skips headless) — the
                // create/update/delete lifecycle is exercised on the real transport.
                // Two markers under the same tileset: one we'll update, one we'll delete.
                await api.pushOperations(aid, [
                    createOperation('marker3d', 'create', keepId, mid, {
                        id: keepId,
                        tilesetId,
                        properties: { label: 'before' },
                    }),
                    createOperation('marker3d', 'create', dropId, mid, {
                        id: dropId,
                        tilesetId,
                        properties: { label: 'doomed' },
                    }),
                ]);

                // Update the keeper (the real factory carries the payload in `data`;
                // the backend falls back `changes <- data` so the merge is not a no-op).
                await api.pushOperations(aid, [
                    createOperation('marker3d', 'update', keepId, mid, {
                        id: keepId,
                        tilesetId,
                        properties: { label: 'after' },
                    }),
                ]);

                // Delete the doomed one (deletes carry null data → soft-delete).
                await api.pushOperations(aid, [createOperation('marker3d', 'delete', dropId, mid, null)]);

                const pulled = await api.pullSync(aid, 0);
                const map = pulled.snapshot?.maps?.find((m) => m.id === mid);
                const markers = map?.cesium3d?.markers || [];
                return {
                    keep: markers.find((m) => m.id === keepId) || null,
                    dropPresent: markers.some((m) => m.id === dropId),
                    count: markers.length,
                    keepId,
                    tilesetId,
                };
            },
            { atlasId, mapId, tilesetId },
        );

        // Update took effect (merged into the JSONB data).
        expect(result.keep).toBeTruthy();
        expect(result.keep.tilesetId).toBe(result.tilesetId);
        expect(result.keep.properties.label).toBe('after');

        // Negative/edge: the deleted marker must NOT appear in the snapshot.
        expect(result.dropPresent).toBe(false);
        expect(result.count).toBe(1);
    });

    test('LWW by arrival: create then update on the SAME id keeps ONE entry with the last payload', async ({ page }) => {
        await page.goto('/');
        const { atlasId, mapId } = await seed(page, state.baseUrl, 'c3d_lww');
        const tilesetId = await seedTileset(state.dbName);

        const result = await page.evaluate(
            async ({ atlasId: aid, mapId: mid, tilesetId }) => {
                const { api, createOperation } = window.__c3d;
                const id = crypto.randomUUID();

                // no-UI: viewer-only viewshed3d (Cesium viewer self-skips headless) —
                // LWW is exercised on the real transport.
                // Same entity id, two arrivals: a create then an update. The update is the
                // LAST arrival and is the survivor; the entity is never duplicated (the id
                // is the PK, so the update merges into the row the create made).
                // (Duplicate CREATE idempotency is a different rule and has its own test
                // below — this one never sends two creates.)
                await api.pushOperations(aid, [
                    createOperation('viewshed3d', 'create', id, mid, { id, tilesetId, radius: 100 }),
                ]);
                await api.pushOperations(aid, [
                    createOperation('viewshed3d', 'update', id, mid, { id, tilesetId, radius: 999 }),
                ]);

                const pulled = await api.pullSync(aid, 0);
                const map = pulled.snapshot?.maps?.find((m) => m.id === mid);
                const viewsheds = (map?.cesium3d?.viewsheds || []).filter((v) => v.id === id);
                return { matches: viewsheds.length, radius: viewsheds[0]?.radius, tilesetId, viewshedTileset: viewsheds[0]?.tilesetId };
            },
            { atlasId, mapId, tilesetId },
        );

        // Exactly one entry for the id (no duplication), reflecting the last arrival.
        expect(result.matches).toBe(1);
        expect(result.radius).toBe(999);
        expect(result.viewshedTileset).toBe(result.tilesetId);
    });

    test('idempotency: a REPEATED create for a live id is a no-op (the FIRST payload survives)', async ({ page }) => {
        await page.goto('/');
        const { atlasId, mapId } = await seed(page, state.baseUrl, 'c3d_idem');
        const tilesetId = await seedTileset(state.dbName);

        const result = await page.evaluate(
            async ({ atlasId: aid, mapId: mid, tilesetId }) => {
                const { api, createOperation } = window.__c3d;
                const id = crypto.randomUUID();

                // no-UI: viewer-only viewshed3d (Cesium viewer self-skips headless) —
                // create idempotency is exercised on the real transport.
                // TWO real creates, same entity id, DIFFERENT payloads: the replay of a
                // queued op after a reconnect. The insert is `ON CONFLICT (id) DO NOTHING`
                // while the row is alive, so the second create must be a no-op — one entry,
                // still carrying the FIRST payload. If that ever became a plain upsert, a
                // stale replayed create would silently clobber newer data.
                await api.pushOperations(aid, [
                    createOperation('viewshed3d', 'create', id, mid, { id, tilesetId, radius: 100 }),
                ]);
                await api.pushOperations(aid, [
                    createOperation('viewshed3d', 'create', id, mid, { id, tilesetId, radius: 999 }),
                ]);

                const pulled = await api.pullSync(aid, 0);
                const map = pulled.snapshot?.maps?.find((m) => m.id === mid);
                const viewsheds = map?.cesium3d?.viewsheds || [];
                return {
                    matches: viewsheds.filter((v) => v.id === id).length,
                    // the map is freshly seeded and holds this viewshed only, so a second
                    // row under ANY id (e.g. the replay inserting a sibling) shows up here.
                    total: viewsheds.length,
                    radius: viewsheds.find((v) => v.id === id)?.radius,
                };
            },
            { atlasId, mapId, tilesetId },
        );

        expect(result.matches).toBe(1);
        expect(result.total).toBe(1);
        // The duplicate create did NOT overwrite the live row: radius is still the first one.
        expect(result.radius).toBe(100);
    });
});

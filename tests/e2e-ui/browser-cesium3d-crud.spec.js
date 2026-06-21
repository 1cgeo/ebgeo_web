// Path: e2e-ui/browser-cesium3d-crud.spec.js

/**
 * Browser-level Cesium-3D FULL CRUD transport test (beyond bare create). Drives the
 * REAL frontend transport modules (`api-client` / `operation-factory`) imported live
 * from the Vite dev server INSIDE real Chromium, against the REAL spawned backend.
 * Every assertion is grounded in the persisted `pullSync` snapshot — no mocks, real
 * HTTP round-trips, never a vacuous truthy check.
 *
 * Covers docs/acoes-interface-multiusuario.md §20.3-12, §21-24 (the 3D actions the
 * bare-create spec does NOT exercise):
 *   - marker3d UPDATE (rename + description + style color/size) then DELETE — the
 *     flat camelCase entity round-trips through the backend `{data_type, tileset_id,
 *     data}` envelope and the snapshot `map.cesium3d.markers[]` reflects each step;
 *   - measurement3d create + delete (vanishes from `measurements[]`);
 *   - viewshed3d create + config UPDATE (height/radius/horizontal+vertical angles)
 *     + delete (`viewsheds[]`);
 *   - cameraPosition3d save (keyed by tilesetId in `cameraPositions{}`) + clear
 *     (delete removes the key);
 *   - marker3d temporal validity (`temporalInicio`/`temporalFim`) survives a save
 *     and a partial-field update;
 *   - negative/edge (IDOR): a marker3d update carrying a FOREIGN atlas's mapId does
 *     NOT mutate the foreign atlas's entity — the cross-atlas EXISTS gate rejects it.
 *
 * Shape facts mirrored from the passing headless twin (tests/e2e/cesium3d.e2e.test.js)
 * and the backend sync.service.js:
 *   - 3D entities are FLAT camelCase: `createOperation('marker3d','create', id, mapId,
 *     { id, tilesetId, position, properties, style, ... })`; the backend reshapes the
 *     flat payload into `{ data_type, tileset_id, data:{...rest} }` and the snapshot OUT
 *     transform spreads `...item.data`, so flat fields reappear at the entry top level.
 *   - An UPDATE op carries its payload in `data` (the only shape the real factory emits);
 *     the backend falls back `changes <- data`, reshapes it, and REPLACES the JSONB
 *     `data` column — so an update payload must carry the FULL post-state, not a patch.
 *   - cameraPositions is an OBJECT keyed by tilesetId (NOT an array); deleting the
 *     entity removes the key.
 *   - tilesetId is preserved on every entry (top-level `tilesetId`).
 *
 * Each test self-provisions its own user + atlas + map for isolation. No UI clicks —
 * the transport is driven entirely through `page.evaluate`.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/**
 * Seeds a fresh user + atlas + map inside the page and stashes the live ApiClient +
 * factory on `window.__c3dCrud` so later `page.evaluate` calls reuse them. Runs
 * entirely in the browser against the real backend.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} baseUrl - backend origin (without the `/api/v1` suffix)
 * @param {string} prefix - username prefix, for readable test isolation
 * @returns {Promise<{ atlasId: string, mapId: string }>}
 */
function seed(page, baseUrl, prefix) {
    return page.evaluate(
        async ({ baseUrl: url, prefix: pfx }) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

            const api = new ApiClient({ baseUrl: `${url}/api/v1` });
            const username = `${pfx}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
            const password = 'Sup3r-Secret-Pw!';
            await api.register({ username, password, nome: 'Cesium3D CRUD E2E' });
            await api.login(username, password);

            const atlas = await api.createAtlas({ name: 'Cesium3D CRUD Atlas' });
            const mapId = crypto.randomUUID();
            await api.pushOperations(atlas.id, [createOperation('map', 'create', mapId, null, { name: 'M1' })]);

            window.__c3dCrud = { api, createOperation };
            return { atlasId: atlas.id, mapId };
        },
        { baseUrl, prefix },
    );
}

describeOrSkip('Cesium-3D full CRUD transport (real Chromium + real backend)', () => {
    test('marker3d update (name/desc/style) + temporal validity, then delete', async ({ page }) => {
        await page.goto('/');
        const { atlasId, mapId } = await seed(page, state.baseUrl, 'c3d_marker_crud');

        const result = await page.evaluate(
            async ({ atlasId: aid, mapId: mid }) => {
                const { api, createOperation } = window.__c3dCrud;
                const tilesetId = `tileset-${crypto.randomUUID().slice(0, 8)}`;
                const markerId = crypto.randomUUID();

                const pullMarker = async (id) => {
                    const pulled = await api.pullSync(aid, 0);
                    const map = pulled.snapshot?.maps?.find((m) => m.id === mid);
                    return (map?.cesium3d?.markers || []).find((m) => m.id === id) || null;
                };
                const countMarkers = async (id) => {
                    const pulled = await api.pullSync(aid, 0);
                    const map = pulled.snapshot?.maps?.find((m) => m.id === mid);
                    return (map?.cesium3d?.markers || []).filter((m) => m.id === id).length;
                };

                // CREATE — flat camelCase marker3d with initial name, no style yet, plus
                // temporal validity window (temporalInicio/temporalFim).
                await api.pushOperations(aid, [
                    createOperation('marker3d', 'create', markerId, mid, {
                        id: markerId,
                        tilesetId,
                        position: { lng: -43.2, lat: -22.9, height: 12 },
                        properties: { name: 'Posto', description: 'inicial' },
                        temporalInicio: '2026-01-01T00:00:00Z',
                        temporalFim: '2026-12-31T23:59:59Z',
                    }),
                ]);
                const afterCreate = await pullMarker(markerId);

                // UPDATE — rename + new description + add a style (color + size). The real
                // factory carries the FULL post-state in `data`; the backend REPLACES the
                // JSONB data blob, so we resend the temporal window to keep it.
                await api.pushOperations(aid, [
                    createOperation('marker3d', 'update', markerId, mid, {
                        id: markerId,
                        tilesetId,
                        position: { lng: -43.2, lat: -22.9, height: 12 },
                        properties: { name: 'Posto Avancado', description: 'editado' },
                        style: { color: '#00ff88', size: 3 },
                        temporalInicio: '2026-01-01T00:00:00Z',
                        temporalFim: '2026-12-31T23:59:59Z',
                    }),
                ]);
                const afterUpdate = await pullMarker(markerId);
                const updateCount = await countMarkers(markerId);

                // DELETE — soft-delete removes it from the snapshot bucket.
                await api.pushOperations(aid, [createOperation('marker3d', 'delete', markerId, mid, null)]);
                const afterDelete = await pullMarker(markerId);

                return { tilesetId, markerId, afterCreate, afterUpdate, updateCount, afterDelete };
            },
            { atlasId, mapId },
        );

        // CREATE assertions: flat fields + temporal window present, tilesetId preserved.
        expect(result.afterCreate).toBeTruthy();
        expect(result.afterCreate.tilesetId).toBe(result.tilesetId);
        expect(result.afterCreate.properties.name).toBe('Posto');
        expect(result.afterCreate.properties.description).toBe('inicial');
        expect(result.afterCreate.style).toBeUndefined();
        expect(result.afterCreate.temporalInicio).toBe('2026-01-01T00:00:00Z');
        expect(result.afterCreate.temporalFim).toBe('2026-12-31T23:59:59Z');

        // UPDATE assertions: renamed, re-described, styled (color + size), single instance,
        // tilesetId + temporal window survive the JSONB replacement.
        expect(result.afterUpdate).toBeTruthy();
        expect(result.afterUpdate.tilesetId).toBe(result.tilesetId);
        expect(result.afterUpdate.properties.name).toBe('Posto Avancado');
        expect(result.afterUpdate.properties.description).toBe('editado');
        expect(result.afterUpdate.style).toEqual({ color: '#00ff88', size: 3 });
        expect(result.afterUpdate.temporalInicio).toBe('2026-01-01T00:00:00Z');
        expect(result.afterUpdate.temporalFim).toBe('2026-12-31T23:59:59Z');
        expect(result.updateCount).toBe(1); // update is not a second create

        // DELETE assertion: gone from the snapshot.
        expect(result.afterDelete).toBeNull();
    });

    test('measurement3d create then delete vanishes from measurements bucket', async ({ page }) => {
        await page.goto('/');
        const { atlasId, mapId } = await seed(page, state.baseUrl, 'c3d_measure_crud');

        const result = await page.evaluate(
            async ({ atlasId: aid, mapId: mid }) => {
                const { api, createOperation } = window.__c3dCrud;
                const tilesetId = `tileset-${crypto.randomUUID().slice(0, 8)}`;
                const measurementId = crypto.randomUUID();

                const pullMeasurement = async () => {
                    const pulled = await api.pullSync(aid, 0);
                    const map = pulled.snapshot?.maps?.find((m) => m.id === mid);
                    return (map?.cesium3d?.measurements || []).find((m) => m.id === measurementId) || null;
                };

                await api.pushOperations(aid, [
                    createOperation('measurement3d', 'create', measurementId, mid, {
                        id: measurementId,
                        tilesetId,
                        positions: [
                            { lng: -43.2, lat: -22.9 },
                            { lng: -43.1, lat: -22.8 },
                        ],
                        distance: 1523.7,
                    }),
                ]);
                const afterCreate = await pullMeasurement();

                await api.pushOperations(aid, [createOperation('measurement3d', 'delete', measurementId, mid, null)]);
                const afterDelete = await pullMeasurement();

                return { tilesetId, afterCreate, afterDelete };
            },
            { atlasId, mapId },
        );

        expect(result.afterCreate).toBeTruthy();
        expect(result.afterCreate.tilesetId).toBe(result.tilesetId);
        expect(result.afterCreate.distance).toBe(1523.7);
        expect(result.afterCreate.positions).toHaveLength(2);

        // Negative/edge: the deleted measurement must NOT appear in the snapshot.
        expect(result.afterDelete).toBeNull();
    });

    test('viewshed3d create + config update (height/radius/angles) + delete', async ({ page }) => {
        await page.goto('/');
        const { atlasId, mapId } = await seed(page, state.baseUrl, 'c3d_viewshed_crud');

        const result = await page.evaluate(
            async ({ atlasId: aid, mapId: mid }) => {
                const { api, createOperation } = window.__c3dCrud;
                const tilesetId = `tileset-${crypto.randomUUID().slice(0, 8)}`;
                const viewshedId = crypto.randomUUID();

                const pullViewshed = async () => {
                    const pulled = await api.pullSync(aid, 0);
                    const map = pulled.snapshot?.maps?.find((m) => m.id === mid);
                    const all = (map?.cesium3d?.viewsheds || []).filter((v) => v.id === viewshedId);
                    return { entry: all[0] || null, count: all.length };
                };

                await api.pushOperations(aid, [
                    createOperation('viewshed3d', 'create', viewshedId, mid, {
                        id: viewshedId,
                        tilesetId,
                        position: { lng: -43.2, lat: -22.9, height: 30 },
                        radius: 500,
                        horizontalAngle: 120,
                        verticalAngle: 60,
                    }),
                ]);
                const afterCreate = await pullViewshed();

                // UPDATE the analysis config — full post-state (JSONB replace) with new
                // observer height, radius and both angles.
                await api.pushOperations(aid, [
                    createOperation('viewshed3d', 'update', viewshedId, mid, {
                        id: viewshedId,
                        tilesetId,
                        position: { lng: -43.2, lat: -22.9, height: 85 },
                        radius: 1200,
                        horizontalAngle: 200,
                        verticalAngle: 90,
                    }),
                ]);
                const afterUpdate = await pullViewshed();

                await api.pushOperations(aid, [createOperation('viewshed3d', 'delete', viewshedId, mid, null)]);
                const afterDelete = await pullViewshed();

                return { tilesetId, afterCreate, afterUpdate, afterDelete };
            },
            { atlasId, mapId },
        );

        // CREATE assertions.
        expect(result.afterCreate.entry).toBeTruthy();
        expect(result.afterCreate.entry.tilesetId).toBe(result.tilesetId);
        expect(result.afterCreate.entry.radius).toBe(500);
        expect(result.afterCreate.entry.horizontalAngle).toBe(120);
        expect(result.afterCreate.entry.verticalAngle).toBe(60);
        expect(result.afterCreate.entry.position.height).toBe(30);

        // UPDATE assertions: config replaced in place, single instance.
        expect(result.afterUpdate.entry).toBeTruthy();
        expect(result.afterUpdate.count).toBe(1);
        expect(result.afterUpdate.entry.tilesetId).toBe(result.tilesetId);
        expect(result.afterUpdate.entry.radius).toBe(1200);
        expect(result.afterUpdate.entry.horizontalAngle).toBe(200);
        expect(result.afterUpdate.entry.verticalAngle).toBe(90);
        expect(result.afterUpdate.entry.position.height).toBe(85);

        // DELETE assertion.
        expect(result.afterDelete.entry).toBeNull();
        expect(result.afterDelete.count).toBe(0);
    });

    test('cameraPosition3d save (keyed by tilesetId) then clear removes the key', async ({ page }) => {
        await page.goto('/');
        const { atlasId, mapId } = await seed(page, state.baseUrl, 'c3d_camera_crud');

        const result = await page.evaluate(
            async ({ atlasId: aid, mapId: mid }) => {
                const { api, createOperation } = window.__c3dCrud;
                const tilesetId = `tileset-${crypto.randomUUID().slice(0, 8)}`;
                const cameraId = crypto.randomUUID();

                const pullCamera = async () => {
                    const pulled = await api.pullSync(aid, 0);
                    const map = pulled.snapshot?.maps?.find((m) => m.id === mid);
                    return map?.cesium3d?.cameraPositions || {};
                };

                // SAVE the saved view — the snapshot keys it by tilesetId.
                await api.pushOperations(aid, [
                    createOperation('cameraPosition3d', 'create', cameraId, mid, {
                        id: cameraId,
                        tilesetId,
                        position: { lng: -43.2, lat: -22.9, height: 800 },
                        heading: 45,
                        pitch: -30,
                        roll: 0,
                    }),
                ]);
                const afterSave = await pullCamera();

                // CLEAR the saved view — deleting the entity drops the tilesetId key.
                await api.pushOperations(aid, [createOperation('cameraPosition3d', 'delete', cameraId, mid, null)]);
                const afterClear = await pullCamera();

                return {
                    tilesetId,
                    cameraId,
                    saved: afterSave[tilesetId] || null,
                    savedIsArray: Array.isArray(afterSave),
                    clearedHasKey: Object.prototype.hasOwnProperty.call(afterClear, tilesetId),
                };
            },
            { atlasId, mapId },
        );

        // SAVE assertions: keyed by tilesetId (object, not array), flat fields preserved.
        expect(result.savedIsArray).toBe(false);
        expect(result.saved).toBeTruthy();
        expect(result.saved.id).toBe(result.cameraId);
        expect(result.saved.tilesetId).toBe(result.tilesetId);
        expect(result.saved.heading).toBe(45);
        expect(result.saved.pitch).toBe(-30);
        expect(result.saved.position.height).toBe(800);

        // CLEAR assertion: the tilesetId key is gone from cameraPositions.
        expect(result.clearedHasKey).toBe(false);
    });

    test('IDOR: marker3d update with a FOREIGN atlas mapId does not mutate the foreign entity', async ({ page }) => {
        await page.goto('/');
        // Two independent owners, each with their own atlas + map.
        const victim = await seed(page, state.baseUrl, 'c3d_idor_victim');

        const result = await page.evaluate(
            async ({ victimAtlasId, victimMapId, baseUrl: url }) => {
                const { ApiClient } = await import('/src/js/store/sync/api-client.js');
                const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

                // The victim (current window.__c3dCrud) plants a marker on their own map.
                const victimApi = window.__c3dCrud.api;
                const victimTileset = `tileset-${crypto.randomUUID().slice(0, 8)}`;
                const markerId = crypto.randomUUID();
                await victimApi.pushOperations(victimAtlasId, [
                    createOperation('marker3d', 'create', markerId, victimMapId, {
                        id: markerId,
                        tilesetId: victimTileset,
                        properties: { name: 'protegido' },
                    }),
                ]);

                // A separate attacker registers, logs in, and creates their OWN atlas.
                const attackerApi = new ApiClient({ baseUrl: `${url}/api/v1` });
                const username = `c3d_idor_attacker_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
                const password = 'Sup3r-Secret-Pw!';
                await attackerApi.register({ username, password, nome: 'Attacker' });
                await attackerApi.login(username, password);
                const attackerAtlas = await attackerApi.createAtlas({ name: 'Attacker Atlas' });

                // The attacker pushes (to THEIR atlas) an update for the SAME markerId but
                // referencing the VICTIM's mapId. The cross-atlas EXISTS gate must reject
                // the write — the victim's map does not belong to the attacker's atlas.
                await attackerApi.pushOperations(attackerAtlas.id, [
                    createOperation('marker3d', 'update', markerId, victimMapId, {
                        id: markerId,
                        tilesetId: victimTileset,
                        properties: { name: 'HACKED' },
                    }),
                ]);

                // Read the victim's snapshot back through the victim's own client.
                const pulled = await victimApi.pullSync(victimAtlasId, 0);
                const map = pulled.snapshot?.maps?.find((m) => m.id === victimMapId);
                const marker = (map?.cesium3d?.markers || []).find((m) => m.id === markerId) || null;
                return { name: marker?.properties?.name, present: Boolean(marker) };
            },
            { victimAtlasId: victim.atlasId, victimMapId: victim.mapId, baseUrl: state.baseUrl },
        );

        // The victim's marker is untouched: still present, name NOT overwritten.
        expect(result.present).toBe(true);
        expect(result.name).toBe('protegido');
    });
});

// Path: e2e-ui/browser-streetview360-crud.spec.js

/**
 * Browser-level Street View 360 annotation transport test. Drives the REAL
 * frontend transport modules (api-client / operation-factory), imported live from
 * the Vite dev server INSIDE real Chromium, against the REAL spawned backend.
 *
 * Covers docs/acoes-interface-multiusuario.md §21.3-7 + §21.15:
 *   - §21.3 add marker360            — flat `marker360` `create` op (`{ id, photoName,
 *     position, properties }`) lands in `map.streetview360.markers[]`;
 *   - §21.4 edit marker360           — `marker360` `update` op (payload carried in
 *     `data`, the only shape the real factory emits) replaces the marker's JSONB,
 *     visible in the snapshot;
 *   - §21.5 delete marker360         — `marker360` `delete` op soft-removes it from
 *     the markers bucket while a sibling marker survives;
 *   - §21.6 save orientation         — flat `orientation360` `create` op lands in
 *     `map.streetview360.orientations` KEYED by `photoName`;
 *   - §21.7 clear orientation        — `orientation360` `delete` op removes that
 *     photoName key from `orientations`;
 *   - §21.15 marker360 temporal window — `temporalInicio`/`temporalFim` ride inside
 *     the marker payload and round-trip; empty fields = permanent marker (edge).
 *
 * The 360 entity types map to the generic backend `streetview360` type with a
 * `data_type` (`marker` / `orientation`); the backend reshapes the FLAT camelCase
 * payload into `{ data_type, photo_name, data:{...rest} }` and the snapshot OUT
 * transform spreads `...item.data`, so the round-trip is symmetric. Orientations are
 * keyed by `photoName`; markers are a flat array. There are NO REST write routes —
 * everything travels as a CRDT op through `api.pushOperations`.
 *
 * Each test self-provisions its own user + atlas + map for isolation. No UI clicks —
 * the transport is driven entirely through `page.evaluate`. Every assertion is
 * grounded in an observable `api.pullSync` snapshot — no mocks, real HTTP.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/**
 * Seeds a fresh user + atlas + map inside the page and stashes a live ApiClient +
 * operation factory on `window.__sv360` (so later `page.evaluate` calls reuse the
 * same authenticated client). Runs entirely in the browser against the real backend.
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
            await api.register({ username, password, nome: 'SV360 E2E' });
            await api.login(username, password);

            const atlas = await api.createAtlas({ name: 'SV360 Atlas' });
            const mapId = crypto.randomUUID();
            await api.pushOperations(atlas.id, [createOperation('map', 'create', mapId, null, { name: 'M1' })]);

            window.__sv360 = { api, createOperation };
            return { atlasId: atlas.id, mapId };
        },
        { baseUrl, prefix },
    );
}

describeOrSkip('Street View 360 annotation transport (real Chromium + real backend)', () => {
    test('§21.3-5 marker360 create → update (LWW) → delete reflected in map.streetview360.markers', async ({
        page,
    }) => {
        await page.goto('/');
        const { atlasId, mapId } = await seed(page, state.baseUrl, 'sv360_marker');

        const result = await page.evaluate(
            async ({ atlasId: aid, mapId: mid }) => {
                const { api, createOperation } = window.__sv360;
                const photoName = `pano_${crypto.randomUUID().slice(0, 8)}.webp`;
                const keepId = crypto.randomUUID();
                const dropId = crypto.randomUUID();

                // §21.3 ADD two flat markers under the same photo: one we'll edit,
                // one we'll delete. Flat camelCase payload, exactly what the real
                // frontend emits — ids + photoName at the top level, rest is opaque.
                await api.pushOperations(aid, [
                    createOperation('marker360', 'create', keepId, mid, {
                        id: keepId,
                        photoName,
                        position: { x: 0.25, y: -0.5, z: 0.8 },
                        properties: { label: 'before', color: '#ff0000' },
                    }),
                    createOperation('marker360', 'create', dropId, mid, {
                        id: dropId,
                        photoName,
                        position: { x: 1, y: 2, z: 3 },
                        properties: { label: 'doomed' },
                    }),
                ]);

                const pullMarkers = async () => {
                    const pulled = await api.pullSync(aid, 0);
                    const map = pulled.snapshot?.maps?.find((m) => m.id === mid);
                    return { sv: map?.streetview360, markers: map?.streetview360?.markers || [] };
                };

                const afterCreate = await pullMarkers();

                // §21.4 EDIT the keeper. The real factory carries the payload in
                // `data`; the backend falls back `changes <- data`, replacing the
                // marker JSONB (not a no-op). Move it + relabel.
                await api.pushOperations(aid, [
                    createOperation('marker360', 'update', keepId, mid, {
                        id: keepId,
                        photoName,
                        position: { x: 0.9, y: 0.1, z: -0.2 },
                        properties: { label: 'after', color: '#00ff00' },
                    }),
                ]);
                const afterUpdate = await pullMarkers();

                // §21.5 DELETE the doomed marker (deletes carry null data → soft-delete).
                await api.pushOperations(aid, [createOperation('marker360', 'delete', dropId, mid, null)]);
                const afterDelete = await pullMarkers();

                const createdKeep = afterCreate.markers.find((m) => m.id === keepId);
                const createdDrop = afterCreate.markers.find((m) => m.id === dropId);
                const updatedKeep = afterUpdate.markers.find((m) => m.id === keepId);

                return {
                    svExists: Boolean(afterCreate.sv),
                    markersIsArray: Array.isArray(afterCreate.markers),
                    // create
                    keepCreated: Boolean(createdKeep),
                    keepPhotoName: createdKeep?.photoName,
                    keepBeforeLabel: createdKeep?.properties?.label,
                    dropCreated: Boolean(createdDrop),
                    // markers are a flat array, NOT keyed by photoName
                    notKeyedByPhoto: !Object.prototype.hasOwnProperty.call(afterCreate.markers, photoName),
                    // update (single instance, content replaced)
                    keepCount: afterUpdate.markers.filter((m) => m.id === keepId).length,
                    updatedLabel: updatedKeep?.properties?.label,
                    updatedColor: updatedKeep?.properties?.color,
                    updatedPosition: updatedKeep?.position,
                    // delete
                    dropPresentAfterDelete: afterDelete.markers.some((m) => m.id === dropId),
                    keepSurvivesDelete: afterDelete.markers.some((m) => m.id === keepId),
                    photoName,
                };
            },
            { atlasId, mapId },
        );

        // structure
        expect(result.svExists).toBe(true);
        expect(result.markersIsArray).toBe(true);

        // §21.3 create — both markers land, photoName preserved on the marker,
        // bucket is a flat array (not keyed by photoName).
        expect(result.keepCreated).toBe(true);
        expect(result.keepPhotoName).toBe(result.photoName);
        expect(result.keepBeforeLabel).toBe('before');
        expect(result.dropCreated).toBe(true);
        expect(result.notKeyedByPhoto).toBe(true);

        // §21.4 update — exactly one instance, JSONB replaced with the new payload.
        expect(result.keepCount).toBe(1);
        expect(result.updatedLabel).toBe('after');
        expect(result.updatedColor).toBe('#00ff00');
        expect(result.updatedPosition).toEqual({ x: 0.9, y: 0.1, z: -0.2 });

        // §21.5 delete — doomed marker gone, sibling survives (negative assertion).
        expect(result.dropPresentAfterDelete).toBe(false);
        expect(result.keepSurvivesDelete).toBe(true);
    });

    test('§21.6-7 orientation360 save (keyed by photoName) then clear removes the key', async ({ page }) => {
        await page.goto('/');
        const { atlasId, mapId } = await seed(page, state.baseUrl, 'sv360_orient');

        const result = await page.evaluate(
            async ({ atlasId: aid, mapId: mid }) => {
                const { api, createOperation } = window.__sv360;
                const photoA = `pano_${crypto.randomUUID().slice(0, 8)}.webp`;
                const photoB = `pano_${crypto.randomUUID().slice(0, 8)}.webp`;
                const idA = crypto.randomUUID();
                const idB = crypto.randomUUID();

                // §21.6 SAVE two orientations under different photos. Flat payload;
                // photoName becomes the orientations map KEY in the snapshot.
                await api.pushOperations(aid, [
                    createOperation('orientation360', 'create', idA, mid, {
                        id: idA,
                        photoName: photoA,
                        lon: -43.123456,
                        lat: -22.987654,
                        fov: 75,
                    }),
                    createOperation('orientation360', 'create', idB, mid, {
                        id: idB,
                        photoName: photoB,
                        lon: -44.5,
                        lat: -23.5,
                        fov: 90,
                    }),
                ]);

                const pullOrient = async () => {
                    const pulled = await api.pullSync(aid, 0);
                    const map = pulled.snapshot?.maps?.find((m) => m.id === mid);
                    return map?.streetview360?.orientations || {};
                };

                const afterSave = await pullOrient();

                // §21.7 CLEAR orientation A (delete op → soft-delete → key removed).
                await api.pushOperations(aid, [createOperation('orientation360', 'delete', idA, mid, null)]);
                const afterClear = await pullOrient();

                const savedA = afterSave[photoA];
                return {
                    // save: keyed by photoName, full payload spread back
                    savedAExists: Boolean(savedA),
                    savedAId: savedA?.id,
                    savedAPhotoName: savedA?.photoName,
                    savedAFov: savedA?.fov,
                    savedALon: savedA?.lon,
                    savedBExists: Boolean(afterSave[photoB]),
                    // negative: a bogus key never materializes
                    bogusKeyAbsent: afterSave['does-not-exist.webp'] === undefined,
                    // clear: photoA key gone, photoB orientation untouched
                    aClearedAfter: afterClear[photoA] === undefined,
                    bSurvivesClear: Boolean(afterClear[photoB]),
                    photoA,
                };
            },
            { atlasId, mapId },
        );

        // §21.6 save — orientation keyed by photoName, payload round-trips.
        expect(result.savedAExists).toBe(true);
        expect(result.savedAPhotoName).toBe(result.photoA);
        expect(result.savedAFov).toBe(75);
        expect(result.savedALon).toBeCloseTo(-43.123456, 6);
        expect(result.savedBExists).toBe(true);
        expect(result.bogusKeyAbsent).toBe(true);

        // §21.7 clear — that photoName key is removed, the other survives.
        expect(result.aClearedAfter).toBe(true);
        expect(result.bSurvivesClear).toBe(true);
    });

    test('§21.15 marker360 temporal validity window round-trips; empty fields = permanent marker', async ({
        page,
    }) => {
        await page.goto('/');
        const { atlasId, mapId } = await seed(page, state.baseUrl, 'sv360_temporal');

        const result = await page.evaluate(
            async ({ atlasId: aid, mapId: mid }) => {
                const { api, createOperation } = window.__sv360;
                const photoName = `pano_${crypto.randomUUID().slice(0, 8)}.webp`;
                const timedId = crypto.randomUUID();
                const permanentId = crypto.randomUUID();

                // §21.15 a marker with a temporal visibility window (início/fim ride
                // inside the marker payload), plus a permanent one (empty fields).
                await api.pushOperations(aid, [
                    createOperation('marker360', 'create', timedId, mid, {
                        id: timedId,
                        photoName,
                        position: { x: 0.1, y: 0.2, z: 0.3 },
                        properties: { label: 'janela' },
                        temporalInicio: '2026-01-01T00:00:00.000Z',
                        temporalFim: '2026-12-31T23:59:59.000Z',
                    }),
                    createOperation('marker360', 'create', permanentId, mid, {
                        id: permanentId,
                        photoName,
                        position: { x: 0.4, y: 0.5, z: 0.6 },
                        properties: { label: 'permanente' },
                        temporalInicio: '',
                        temporalFim: '',
                    }),
                ]);

                const pulled = await api.pullSync(aid, 0);
                const map = pulled.snapshot?.maps?.find((m) => m.id === mid);
                const markers = map?.streetview360?.markers || [];
                const timed = markers.find((m) => m.id === timedId);
                const permanent = markers.find((m) => m.id === permanentId);

                // §21.15 EDIT the window (last-write-wins): widen the start bound.
                await api.pushOperations(aid, [
                    createOperation('marker360', 'update', timedId, mid, {
                        id: timedId,
                        photoName,
                        position: { x: 0.1, y: 0.2, z: 0.3 },
                        properties: { label: 'janela' },
                        temporalInicio: '2025-06-01T00:00:00.000Z',
                        temporalFim: '2026-12-31T23:59:59.000Z',
                    }),
                ]);
                const pulled2 = await api.pullSync(aid, 0);
                const map2 = pulled2.snapshot?.maps?.find((m) => m.id === mid);
                const timed2 = (map2?.streetview360?.markers || []).find((m) => m.id === timedId);

                return {
                    timedExists: Boolean(timed),
                    timedInicio: timed?.temporalInicio,
                    timedFim: timed?.temporalFim,
                    permanentExists: Boolean(permanent),
                    // empty window = permanent marker
                    permanentInicio: permanent?.temporalInicio,
                    permanentFim: permanent?.temporalFim,
                    // LWW edit
                    timedCountAfterEdit: (map2?.streetview360?.markers || []).filter((m) => m.id === timedId).length,
                    editedInicio: timed2?.temporalInicio,
                    editedFim: timed2?.temporalFim,
                };
            },
            { atlasId, mapId },
        );

        // window round-trips on the timed marker
        expect(result.timedExists).toBe(true);
        expect(result.timedInicio).toBe('2026-01-01T00:00:00.000Z');
        expect(result.timedFim).toBe('2026-12-31T23:59:59.000Z');

        // permanent marker keeps its empty window (no fabricated bounds)
        expect(result.permanentExists).toBe(true);
        expect(result.permanentInicio).toBe('');
        expect(result.permanentFim).toBe('');

        // §21.15 LWW edit — single instance, start bound widened.
        expect(result.timedCountAfterEdit).toBe(1);
        expect(result.editedInicio).toBe('2025-06-01T00:00:00.000Z');
        expect(result.editedFim).toBe('2026-12-31T23:59:59.000Z');
    });
});

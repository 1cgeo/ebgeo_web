// Path: e2e-ui/browser-streetview360.spec.js

/**
 * Browser-level streetview360 (FLAT 360) sync test. Drives the REAL frontend
 * transport (api-client / operation-factory) imported live from the Vite dev server
 * INSIDE real Chromium, pushing FLAT `orientation360` / `marker360` entities over
 * REAL HTTP to the REAL backend, then reading them back through the persisted
 * snapshot (`api.pullSync`).
 *
 * The 360 entities ride the sync/CRDT channel as FLAT entities (camelCase fields at
 * the top level, `photoName` included). The backend reshapes them into
 * `streetview360_data` (`photo_name` column + JSONB `data`) and the snapshot OUT
 * transform rebuilds the frontend hierarchy:
 *   map.streetview360 = {
 *     orientations: { [photoName]: { id, photoName, ...data, sync } },
 *     markers: [ { id, photoName, ...data, sync } ],
 *   }
 *
 * Proves, with REAL round-trips:
 *   - a FLAT `orientation360` create lands keyed by its `photoName`, with `id` and
 *     the FLAT payload fields (`yaw`/`pitch`) round-tripped into the snapshot;
 *   - a FLAT `marker360` create lands in `markers[]` with `photoName` preserved;
 *   - a `delete` op (the "clear") soft-removes a marker so it vanishes from the
 *     snapshot while the orientation survives (LWW/soft-delete, scoped by id+mapId);
 *   - EDGE: an `orientation360` create WITHOUT a `photoName` is NOT keyed into
 *     `orientations` (the OUT transform only indexes orientations that carry a
 *     truthy `photo_name`), so it never pollutes the orientations map.
 *
 * Each test seeds its OWN user + atlas + map for isolation. No UI clicks — the
 * transport is exercised entirely via `page.evaluate`, so no `data-testid` is used.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

describeOrSkip('Streetview360 FLAT sync (real Chromium + real backend)', () => {
    test('FLAT orientation360 + marker360 create/clear; snapshot preserves photoName', async ({ page }) => {
        await page.goto('/');

        const result = await page.evaluate(async (baseUrl) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

            const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
            const username = `sv360_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
            const password = 'Sup3r-Secret-Pw!';
            await api.register({ username, password, nome: 'SV360 User' });
            await api.login(username, password);

            const atlas = await api.createAtlas({ name: 'SV360 Atlas' });
            const mapId = crypto.randomUUID();
            await api.pushOperations(atlas.id, [createOperation('map', 'create', mapId, null, { name: 'M1' })]);

            // FLAT orientation360: photoName at the top level, extra fields (yaw/pitch)
            // belong to the JSONB `data` payload after the backend reshape.
            const orientId = crypto.randomUUID();
            const photoName = `pano_${crypto.randomUUID().slice(0, 8)}.jpg`;
            const orientation = { id: orientId, photoName, yaw: 90, pitch: -12, sync: 'pending' };
            await api.pushOperations(atlas.id, [
                createOperation('orientation360', 'create', orientId, mapId, orientation),
            ]);

            // FLAT marker360: a labelled point anchored to the same panorama.
            const markerId = crypto.randomUUID();
            const marker = {
                id: markerId,
                photoName,
                position: { lng: -43.2, lat: -22.9 },
                label: 'North door',
                sync: 'pending',
            };
            await api.pushOperations(atlas.id, [createOperation('marker360', 'create', markerId, mapId, marker)]);

            // EDGE: an orientation WITHOUT photoName must not be keyed into orientations.
            const orphanId = crypto.randomUUID();
            await api.pushOperations(atlas.id, [
                createOperation('orientation360', 'create', orphanId, mapId, { id: orphanId, yaw: 5 }),
            ]);

            const readMap = async () => {
                const pulled = await api.pullSync(atlas.id, 0);
                const maps = pulled.snapshot && pulled.snapshot.maps ? pulled.snapshot.maps : [];
                const list = Array.isArray(maps) ? maps : Object.values(maps);
                return list.find((m) => m && (m.id === mapId || m.mapId === mapId));
            };

            const afterCreate = await readMap();
            const sv = (afterCreate && afterCreate.streetview360) || { orientations: {}, markers: [] };
            const orientEntry = sv.orientations ? sv.orientations[photoName] : undefined;
            const markerEntry = (sv.markers || []).find((m) => m.id === markerId);

            // Clear (delete) the marker; the orientation must survive.
            await api.pushOperations(atlas.id, [createOperation('marker360', 'delete', markerId, mapId, null)]);

            const afterClear = await readMap();
            const svAfter = (afterClear && afterClear.streetview360) || { orientations: {}, markers: [] };

            return {
                isSnapshot: true,
                orientationKeyed: Boolean(orientEntry),
                orientationId: orientEntry ? orientEntry.id : null,
                photoName,
                orientationPhotoName: orientEntry ? orientEntry.photoName : null,
                orientationYaw: orientEntry ? orientEntry.yaw : null,
                orientationPitch: orientEntry ? orientEntry.pitch : null,
                markerPresent: Boolean(markerEntry),
                markerPhotoName: markerEntry ? markerEntry.photoName : null,
                markerLabel: markerEntry ? markerEntry.label : null,
                orphanKeyed: Boolean(svAfter.orientations && svAfter.orientations[orphanId]),
                orphanKeyedByUndefined: Object.prototype.hasOwnProperty.call(
                    svAfter.orientations || {},
                    'undefined',
                ),
                markerClearedFromMarkers: !(svAfter.markers || []).some((m) => m.id === markerId),
                orientationSurvivesClear: Boolean(svAfter.orientations && svAfter.orientations[photoName]),
            };
        }, state.baseUrl);

        // Orientation landed, keyed by photoName, with id + FLAT payload round-tripped.
        expect(result.orientationKeyed).toBe(true);
        expect(result.orientationId).toBeTruthy();
        expect(result.orientationPhotoName).toBe(result.photoName);
        expect(result.orientationYaw).toBe(90);
        expect(result.orientationPitch).toBe(-12);

        // Marker landed in markers[] with photoName + label preserved.
        expect(result.markerPresent).toBe(true);
        expect(result.markerPhotoName).toBe(result.photoName);
        expect(result.markerLabel).toBe('North door');

        // EDGE: the photoName-less orientation never pollutes the orientations map.
        expect(result.orphanKeyed).toBe(false);
        expect(result.orphanKeyedByUndefined).toBe(false);

        // Clear soft-removes the marker but leaves the orientation intact.
        expect(result.markerClearedFromMarkers).toBe(true);
        expect(result.orientationSurvivesClear).toBe(true);
    });
});

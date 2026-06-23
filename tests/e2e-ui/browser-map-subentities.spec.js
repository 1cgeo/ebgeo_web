// Path: e2e-ui/browser-map-subentities.spec.js

/**
 * Browser-level map sub-entity update test. Drives the REAL frontend transport
 * (api-client / operation-factory) imported live from the Vite dev server INSIDE
 * real Chromium, against the REAL backend, doing genuine HTTP round-trips.
 *
 * Proves the four map sub-update ops persist to their dedicated columns and are
 * reflected in the snapshot the frontend reads:
 *   - `mapPosition` -> center_lat / center_long / zoom / bearing / pitch
 *   - `baseLayer`   -> base_layer
 *   - `mapNotes`    -> notes_title / notes_description
 *   - `gridStyle`   -> grid_style (the {format,visible} payload IS the object)
 *
 * Each test creates its OWN user + atlas + map for isolation. Includes a negative
 * assertion proving the per-subtype column whitelist: a sibling column smuggled in
 * a sub-typed op (a `name` riding alongside a `baseLayer` op) must NOT leak through
 * and overwrite unrelated map state.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

describeOrSkip('Map sub-entity updates (real Chromium + real backend)', () => {
    test('mapPosition + baseLayer + mapNotes + gridStyle persist to the snapshot', async ({ page }) => {
        await page.goto('/');

        // no-UI: this is a backend op-contract test (per-sub-type column mapping), not a
        // user gesture. The sub-typed `mapPosition`/`baseLayer`/`mapNotes`/`gridStyle`
        // op SHAPES (entityId == mapId AND the 4th mapId arg, named-field payloads routed
        // to dedicated DB columns) and the raw-snapshot assertions (`api.pullSync`) ARE the
        // contract under test — there is no single in-app UI gesture that emits these exact
        // envelopes, so the transport is driven directly through the real api-client.
        const result = await page.evaluate(async (baseUrl) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

            const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
            const username = `mapsub_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
            const password = 'Sup3r-Secret-Pw!';
            await api.register({ username, password, nome: 'Map Sub-entities' });
            await api.login(username, password);

            // Seed atlas + map (initial position so a later mapPosition op is a real change).
            const atlas = await api.createAtlas({ name: 'Map Sub Atlas' });
            const mapId = crypto.randomUUID();
            await api.pushOperations(atlas.id, [
                createOperation('map', 'create', mapId, null, {
                    name: 'M1',
                    base_layer: 'carta-topografica',
                    center_lat: 0,
                    center_long: 0,
                    zoom: 1,
                }),
            ]);

            // 1. mapPosition: viewport target/zoom/bearing/pitch.
            const position = { center_lat: -22.9068, center_long: -43.1729, zoom: 14.5, bearing: 33, pitch: 45 };
            await api.pushOperations(atlas.id, [
                createOperation('mapPosition', 'update', mapId, mapId, position),
            ]);

            // 2. baseLayer: switch the basemap.
            const baseLayerValue = 'imagem-satelite';
            await api.pushOperations(atlas.id, [
                createOperation('baseLayer', 'update', mapId, mapId, { baseLayer: baseLayerValue }),
            ]);

            // 3. mapNotes: title + description.
            const notesTitle = 'Notas da Operação';
            const notesDescription = 'Descrição detalhada do teatro de operações.';
            await api.pushOperations(atlas.id, [
                createOperation('mapNotes', 'update', mapId, mapId, {
                    title: notesTitle,
                    description: notesDescription,
                }),
            ]);

            // 4. gridStyle: the {format,visible} payload IS the grid_style object.
            const gridFormat = 'MGRS';
            await api.pushOperations(atlas.id, [
                createOperation('gridStyle', 'update', mapId, mapId, { format: gridFormat, visible: true }),
            ]);

            // Read back via the snapshot the frontend consumes.
            const pulled = await api.pullSync(atlas.id, 0);
            const maps = pulled.snapshot ? pulled.snapshot.maps : null;
            const list = Array.isArray(maps) ? maps : maps ? Object.values(maps) : [];
            const map = list.find((m) => m && (m.id === mapId || m.mapId === mapId)) || null;
            const gridStyle = map && map.grid_style ? map.grid_style : {};

            return {
                isSnapshot: pulled.isSnapshot,
                found: Boolean(map),
                expected: { position, baseLayerValue, notesTitle, notesDescription, gridFormat },
                actual: map && {
                    center_lat: map.center_lat,
                    center_long: map.center_long,
                    zoom: map.zoom,
                    bearing: map.bearing,
                    pitch: map.pitch,
                    base_layer: map.base_layer,
                    notes_title: map.notes_title,
                    notes_description: map.notes_description,
                    gridFormat: gridStyle.format,
                    gridVisible: gridStyle.visible,
                },
            };
        }, state.baseUrl);

        expect(result.isSnapshot).toBe(true);
        expect(result.found).toBe(true);

        // mapPosition -> position columns. Coordinates can come back as strings from
        // NUMERIC columns, so compare numerically.
        expect(Number(result.actual.center_lat)).toBeCloseTo(result.expected.position.center_lat, 4);
        expect(Number(result.actual.center_long)).toBeCloseTo(result.expected.position.center_long, 4);
        expect(Number(result.actual.zoom)).toBeCloseTo(result.expected.position.zoom, 4);
        expect(Number(result.actual.bearing)).toBeCloseTo(result.expected.position.bearing, 4);
        expect(Number(result.actual.pitch)).toBeCloseTo(result.expected.position.pitch, 4);

        // baseLayer -> base_layer.
        expect(result.actual.base_layer).toBe(result.expected.baseLayerValue);

        // mapNotes -> notes_title / notes_description.
        expect(result.actual.notes_title).toBe(result.expected.notesTitle);
        expect(result.actual.notes_description).toBe(result.expected.notesDescription);

        // gridStyle -> grid_style {format,visible}.
        expect(result.actual.gridFormat).toBe(result.expected.gridFormat);
        expect(result.actual.gridVisible).toBe(true);
    });

    test('a sub-typed op may ONLY touch its own column: a smuggled sibling does not leak', async ({ page }) => {
        await page.goto('/');

        // no-UI: a NEGATIVE op-contract test (column whitelist). "Smuggling" a sibling
        // `name` field inside a `baseLayer` op is a hand-crafted malicious envelope that
        // no UI gesture can produce — the app's base-layer switch only ever sends the
        // base_layer field. The transport is driven directly so the backend's per-sub-type
        // whitelist (the thing under test) can be probed.
        const result = await page.evaluate(async (baseUrl) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

            const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
            const username = `mapwl_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
            const password = 'Sup3r-Secret-Pw!';
            await api.register({ username, password, nome: 'Map Whitelist' });
            await api.login(username, password);

            const atlas = await api.createAtlas({ name: 'Whitelist Atlas' });
            const mapId = crypto.randomUUID();
            const originalName = 'Original Name';
            await api.pushOperations(atlas.id, [
                createOperation('map', 'create', mapId, null, { name: originalName, base_layer: 'carta-topografica' }),
            ]);

            // A `baseLayer` sub-op carrying a smuggled `name`. The per-subtype column
            // whitelist allows ONLY base_layer through; the `name` must be ignored so a
            // viewport/basemap toggle can never silently rename (or relock) a map.
            const newBaseLayer = 'imagem-satelite';
            const smuggledName = 'HIJACKED NAME';
            await api.pushOperations(atlas.id, [
                createOperation('baseLayer', 'update', mapId, mapId, {
                    baseLayer: newBaseLayer,
                    name: smuggledName,
                }),
            ]);

            const pulled = await api.pullSync(atlas.id, 0);
            const maps = pulled.snapshot ? pulled.snapshot.maps : null;
            const list = Array.isArray(maps) ? maps : maps ? Object.values(maps) : [];
            const map = list.find((m) => m && (m.id === mapId || m.mapId === mapId)) || null;

            return {
                found: Boolean(map),
                name: map ? map.name : null,
                base_layer: map ? map.base_layer : null,
                originalName,
                smuggledName,
                newBaseLayer,
            };
        }, state.baseUrl);

        expect(result.found).toBe(true);
        // The intended column DID change.
        expect(result.base_layer).toBe(result.newBaseLayer);
        // The smuggled sibling did NOT leak: the name is untouched.
        expect(result.name).toBe(result.originalName);
        expect(result.name).not.toBe(result.smuggledName);
    });
});

// Path: e2e-ui/browser-grid-style.spec.js

/**
 * Browser-level gridStyle map sub-type transport test. Drives the REAL frontend
 * transport (api-client / operation-factory) imported live from the Vite dev
 * server inside real Chromium, against the REAL spawned backend. Every assertion
 * is grounded in observable backend state read back through `api.pullSync` — no
 * mocks, real HTTP round-trips.
 *
 * `gridStyle` is a sub-typed MAP update (subType `grid`): the op carries the
 * mapId as BOTH the entityId AND the 4th arg, and the backend reshapes the loose
 * `{ format, visible }` payload into the `grid_style` JSONB column, which the
 * snapshot exposes as `map.grid_style`. A sub-typed map update may ONLY touch its
 * own whitelisted column(s) (MAP_SUBTYPE_FIELDS.grid = grid_style/analysis_layers),
 * so a smuggled sensitive sibling (e.g. `name`) must NOT leak through.
 *
 * Coverage (§26.1-3):
 *   - §26.1 enable a Lat/Long grid -> map.grid_style === { format: 'latlong', visible: true };
 *   - §26.2 switch to UTM -> map.grid_style === { format: 'utm', visible: true };
 *   - §26.3 turn the grid off -> map.grid_style === { format: 'utm', visible: false };
 *   - edge: a gridStyle op that smuggles a `name` sibling cannot rename the map
 *     (sub-type column whitelist drops it) yet the grid fields still apply.
 *
 * Each test self-provisions its own user + atlas + map for full isolation.
 *
 * no-UI: this is a TRANSPORT-LAYER contract test with no app-UI session — its intent
 * (the backend's grid_style JSONB column WHITELIST: a sub-typed grid update may touch
 * ONLY grid_style, and a smuggled `name` sibling must be dropped) has no UI surface. The
 * in-app grid overlay button that would drive §26.1-3 is gated by config.features.grid,
 * which the backend ships FALSE (ebgeo_backend config.static.js FEATURES.grid) so the
 * button does not even render in this environment; and the grid menu offers only
 * latlong/utm/off — it can express neither the `mgrs` format nor the smuggled-`name`
 * security edge that are the actual point of this test. So the grid sub-type ops are
 * authored through the real frontend transport (api-client / operation-factory) and every
 * assertion is grounded in backend state read back through `api.pullSync`.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { createVerifiedUser } from './helpers/accounts.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

describeOrSkip('gridStyle map sub-type transport (real Chromium + real backend)', () => {
    test('enable Lat/Long → switch to UTM → turn off, each verified via map.grid_style; smuggled name dropped', async ({
        page,
    }) => {
        const user = await createVerifiedUser({ prefix: 'grid', nome: 'Grid Style E2E' });
        await page.goto('/');

        const result = await page.evaluate(async ({ baseUrl, u }) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

            const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
            await api.login(u.username, u.password);

            const atlas = await api.createAtlas({ name: 'Grid Style Atlas' });
            const mapId = crypto.randomUUID();
            const originalName = 'Grid Map';
            await api.pushOperations(atlas.id, [
                createOperation('map', 'create', mapId, null, { name: originalName }),
            ]);

            const pullMap = async () => {
                const pulled = await api.pullSync(atlas.id, 0);
                return {
                    isSnapshot: pulled.isSnapshot,
                    map: pulled.snapshot?.maps?.find((m) => m.id === mapId) || null,
                };
            };

            // ---- §26.1 enable a Lat/Long grid -----------------------------
            // gridStyle is a sub-typed map op: mapId is BOTH entityId AND 4th arg.
            await api.pushOperations(atlas.id, [
                createOperation('gridStyle', 'update', mapId, mapId, {
                    format: 'latlong',
                    visible: true,
                }),
            ]);
            const afterEnable = await pullMap();

            // ---- §26.2 switch to UTM --------------------------------------
            await api.pushOperations(atlas.id, [
                createOperation('gridStyle', 'update', mapId, mapId, {
                    format: 'utm',
                    visible: true,
                }),
            ]);
            const afterUtm = await pullMap();

            // ---- §26.3 turn the grid off ----------------------------------
            await api.pushOperations(atlas.id, [
                createOperation('gridStyle', 'update', mapId, mapId, {
                    format: 'utm',
                    visible: false,
                }),
            ]);
            const afterOff = await pullMap();

            // ---- edge: smuggled `name` sibling is dropped (column whitelist)
            // A sub-typed grid update may only touch grid_style; a `name` riding
            // alongside must NOT rename the map.
            await api.pushOperations(atlas.id, [
                createOperation('gridStyle', 'update', mapId, mapId, {
                    format: 'mgrs',
                    visible: true,
                    name: 'HACKED',
                }),
            ]);
            const afterSmuggle = await pullMap();

            return {
                isSnapshot: afterEnable.isSnapshot,
                originalName,
                enableGrid: afterEnable.map?.grid_style,
                utmGrid: afterUtm.map?.grid_style,
                offGrid: afterOff.map?.grid_style,
                smuggleGrid: afterSmuggle.map?.grid_style,
                smuggleName: afterSmuggle.map?.name,
            };
        }, { baseUrl: state.baseUrl, u: user });

        expect(result.isSnapshot).toBe(true);

        // §26.1 — Lat/Long grid enabled.
        expect(result.enableGrid).toEqual({ format: 'latlong', visible: true });

        // §26.2 — switched to UTM, still visible.
        expect(result.utmGrid).toEqual({ format: 'utm', visible: true });

        // §26.3 — grid turned off, format retained, visibility false.
        expect(result.offGrid).toEqual({ format: 'utm', visible: false });

        // Edge — grid fields applied, but the smuggled `name` was dropped:
        // the map keeps its original name (sub-type column whitelist held).
        expect(result.smuggleGrid).toEqual({ format: 'mgrs', visible: true });
        expect(result.smuggleName).toBe(result.originalName);
    });
});

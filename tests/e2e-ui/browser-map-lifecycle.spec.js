// Path: e2e-ui/browser-map-lifecycle.spec.js

/**
 * Browser-level map lifecycle transport test. Drives the REAL frontend transport
 * (api-client / operation-factory) imported live from the Vite dev server inside
 * real Chromium, against the REAL spawned backend. Covers the SYNC (🟡) map actions
 * of docs/acoes-interface-multiusuario.md §1.6–§1.13 — every assertion is grounded
 * in an observable backend snapshot read back through `api.pullSync` (no mocks).
 *
 * Op shapes mirror the passing headless twins (map-lifecycle / map-subentities
 * e2e.test.js) and the backend sync.service.js MAP_SUBTYPE_FIELDS whitelist:
 *
 *   - §1.6 NOTES   — `mapNotes` sub-typed update, mapId as BOTH entityId AND the
 *                    4th arg, data `{ title, description }` → notes_title /
 *                    notes_description columns.
 *   - §1.7 RENAME  — plain `map` update (NOT sub-typed) carrying `{ name }`.
 *   - §1.11 REORDER— atlas map order via the REST `PUT /atlas/:id` route (the only
 *                    write path for `map_order`), sent with an authed fetch using
 *                    `api.getAccessToken()`. Verified via snapshot `atlas.mapOrder`.
 *   - §1.12 SAVE POSITION  — `mapPosition` sub-typed update with
 *                    `{ center_lat, center_long, zoom, bearing, pitch }`.
 *   - §1.13 CLEAR POSITION — a second `mapPosition` update nulling those columns.
 *
 * Negative/edge coverage:
 *   - sub-type whitelist: a `mapNotes` op smuggling a sibling `name` must NOT rename
 *     the map (MAP_SUBTYPE_FIELDS narrows a sub-typed update to its own columns);
 *   - cross-atlas IDOR: a `mapPosition` update targeting a FOREIGN map (pushed on the
 *     attacker's own atlas route) must NOT mutate the victim map;
 *   - reorder IDOR: a `PUT /atlas/:victimId` with the attacker's token (no share) is
 *     rejected (403/404) and leaves the victim's `mapOrder` untouched.
 *
 * Each test self-provisions its own user + atlas + map(s) for full isolation.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/**
 * Seeds a fresh user + atlas + N maps inside the page and stashes the ApiClient on
 * `window.__mlc` so later `page.evaluate` calls reuse it. Runs entirely in the browser
 * against the real backend.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} baseUrl - backend origin (without the `/api/v1` suffix)
 * @param {string} prefix - username prefix, for readable test isolation
 * @param {string[]} mapNames - one map is created per name (UUIDs minted client-side)
 * @returns {Promise<{ atlasId: string, mapIds: string[] }>}
 */
function seed(page, baseUrl, prefix, mapNames) {
    return page.evaluate(
        async ({ baseUrl: url, prefix: pfx, mapNames: names }) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

            const api = new ApiClient({ baseUrl: `${url}/api/v1` });
            const username = `${pfx}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
            const password = 'Sup3r-Secret-Pw!';
            await api.register({ username, password, nome: 'Map Lifecycle E2E' });
            await api.login(username, password);

            const atlas = await api.createAtlas({ name: 'Map Lifecycle Atlas' });
            const mapIds = names.map(() => crypto.randomUUID());
            await api.pushOperations(
                atlas.id,
                names.map((name, i) => createOperation('map', 'create', mapIds[i], null, { name })),
            );

            window.__mlc = { api, createOperation, baseUrl: url };
            return { atlasId: atlas.id, mapIds };
        },
        { baseUrl, prefix, mapNames },
    );
}

describeOrSkip('Map lifecycle SYNC actions (real Chromium + real backend)', () => {
    test('§1.6 notes + §1.7 rename: notes land in notes_* columns; a plain update renames the map', async ({
        page,
    }) => {
        await page.goto('/');
        const { atlasId, mapIds } = await seed(page, state.baseUrl, 'mlc_notes', ['Alpha']);
        const [mapId] = mapIds;

        const result = await page.evaluate(
            async ({ atlasId: aid, mapId: mid }) => {
                const { api, createOperation } = window.__mlc;
                const pullMap = async () => {
                    const pulled = await api.pullSync(aid, 0);
                    return {
                        isSnapshot: pulled.isSnapshot,
                        map: pulled.snapshot?.maps?.find((m) => m.id === mid),
                    };
                };

                // §1.6 NOTES — `mapNotes` sub-typed update: mapId is BOTH entityId AND
                // the 4th (mapId) arg. {title,description} → notes_title/notes_description.
                await api.pushOperations(aid, [
                    createOperation('mapNotes', 'update', mid, mid, {
                        title: 'Plano de Manobra',
                        description: 'Eixo principal a oeste do rio.',
                    }),
                ]);
                const afterNotes = await pullMap();

                // §1.7 RENAME — plain `map` update (NOT sub-typed) carrying {name}.
                await api.pushOperations(aid, [
                    createOperation('map', 'update', mid, null, { name: 'Alpha Renamed' }),
                ]);
                const afterRename = await pullMap();

                // NEGATIVE — sub-type whitelist: a `mapNotes` op smuggling a sibling
                // `name` must NOT rename the map (MAP_SUBTYPE_FIELDS narrows to notes_*).
                await api.pushOperations(aid, [
                    createOperation('mapNotes', 'update', mid, mid, {
                        name: 'Smuggled Name',
                        title: 'Notas Atualizadas',
                    }),
                ]);
                const afterSmuggle = await pullMap();

                return {
                    isSnapshot: afterNotes.isSnapshot,
                    notesTitle: afterNotes.map?.notes_title,
                    notesDescription: afterNotes.map?.notes_description,
                    renamedName: afterRename.map?.name,
                    smuggledName: afterSmuggle.map?.name,
                    smuggledNotesTitle: afterSmuggle.map?.notes_title,
                };
            },
            { atlasId, mapId },
        );

        expect(result.isSnapshot).toBe(true);

        // §1.6 — notes persisted into the dedicated columns.
        expect(result.notesTitle).toBe('Plano de Manobra');
        expect(result.notesDescription).toBe('Eixo principal a oeste do rio.');

        // §1.7 — plain update renamed the map.
        expect(result.renamedName).toBe('Alpha Renamed');

        // NEGATIVE — the smuggled `name` was ignored (still the renamed value), while
        // the legitimate sub-type column (notes_title) DID update.
        expect(result.smuggledName).toBe('Alpha Renamed');
        expect(result.smuggledName).not.toBe('Smuggled Name');
        expect(result.smuggledNotesTitle).toBe('Notas Atualizadas');
    });

    test('§1.12 save position + §1.13 clear position: mapPosition columns set then nulled', async ({
        page,
    }) => {
        await page.goto('/');
        const { atlasId, mapIds } = await seed(page, state.baseUrl, 'mlc_pos', ['Bravo']);
        const [mapId] = mapIds;

        const result = await page.evaluate(
            async ({ atlasId: aid, mapId: mid }) => {
                const { api, createOperation } = window.__mlc;
                const pullMap = async () => {
                    const pulled = await api.pullSync(aid, 0);
                    return pulled.snapshot?.maps?.find((m) => m.id === mid);
                };

                // §1.12 SAVE POSITION — `mapPosition` sub-typed update (center/zoom/...).
                await api.pushOperations(aid, [
                    createOperation('mapPosition', 'update', mid, mid, {
                        center_lat: -22.9068,
                        center_long: -43.1729,
                        zoom: 12,
                        bearing: 45,
                        pitch: 30,
                    }),
                ]);
                const saved = await pullMap();

                // §1.13 CLEAR POSITION — a second `mapPosition` update nulling the cols.
                await api.pushOperations(aid, [
                    createOperation('mapPosition', 'update', mid, mid, {
                        center_lat: null,
                        center_long: null,
                        zoom: null,
                        bearing: 0,
                        pitch: 0,
                    }),
                ]);
                const cleared = await pullMap();

                return {
                    saved: {
                        centerLat: saved?.center_lat == null ? null : Number(saved.center_lat),
                        centerLong: saved?.center_long == null ? null : Number(saved.center_long),
                        zoom: saved?.zoom == null ? null : Number(saved.zoom),
                        bearing: saved?.bearing == null ? null : Number(saved.bearing),
                        pitch: saved?.pitch == null ? null : Number(saved.pitch),
                    },
                    cleared: {
                        centerLat: cleared?.center_lat,
                        centerLong: cleared?.center_long,
                        zoom: cleared?.zoom,
                        bearing: cleared?.bearing == null ? null : Number(cleared.bearing),
                        pitch: cleared?.pitch == null ? null : Number(cleared.pitch),
                    },
                };
            },
            { atlasId, mapId },
        );

        // §1.12 — the saved camera state round-trips through the map columns.
        expect(result.saved.centerLat).toBeCloseTo(-22.9068, 4);
        expect(result.saved.centerLong).toBeCloseTo(-43.1729, 4);
        expect(result.saved.zoom).toBe(12);
        expect(result.saved.bearing).toBe(45);
        expect(result.saved.pitch).toBe(30);

        // §1.13 — the saved position is cleared (center/zoom nulled, angles reset).
        expect(result.cleared.centerLat).toBeNull();
        expect(result.cleared.centerLong).toBeNull();
        expect(result.cleared.zoom).toBeNull();
        expect(result.cleared.bearing).toBe(0);
        expect(result.cleared.pitch).toBe(0);
    });

    test('§1.11 reorder: PUT /atlas/:id rewrites atlas.mapOrder, verified via snapshot', async ({
        page,
    }) => {
        await page.goto('/');
        const { atlasId, mapIds } = await seed(page, state.baseUrl, 'mlc_order', [
            'One',
            'Two',
            'Three',
        ]);

        const result = await page.evaluate(
            async ({ atlasId: aid, mapIds: ids }) => {
                const { api, baseUrl } = window.__mlc;

                // Reorder = reverse the creation order. There is NO sync op for atlas
                // map_order; the only write path is the REST PUT /atlas/:id route, so
                // we send an authed fetch with the real access token (frozen contract:
                // body key is snake_case `map_order`, response is the `{ data }` atlas).
                const reordered = [...ids].reverse();
                const res = await fetch(`${baseUrl}/api/v1/atlas/${aid}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${api.getAccessToken()}`,
                    },
                    body: JSON.stringify({ map_order: reordered }),
                });
                const putStatus = res.status;

                // Ground the assertion in the snapshot: atlas.mapOrder (camelCase OUT).
                const pulled = await api.pullSync(aid, 0);
                return {
                    putStatus,
                    mapOrder: pulled.snapshot?.atlas?.mapOrder ?? null,
                    expected: reordered,
                    original: ids,
                };
            },
            { atlasId, mapIds },
        );

        expect(result.putStatus).toBe(200);
        // The persisted order is exactly the reversed (reordered) list — not the
        // original creation order — proving the reorder took effect end to end.
        expect(result.mapOrder).toEqual(result.expected);
        expect(result.mapOrder).not.toEqual(result.original);
    });

    test('edge: cross-atlas IDOR — a foreign mapPosition op and a foreign reorder PUT are both rejected', async ({
        browser,
    }) => {
        // Victim: its own user + atlas + map, with a known baseline position + order.
        const victimPage = await browser.newPage();
        await victimPage.goto('/');
        const victim = await seed(victimPage, state.baseUrl, 'mlc_victim', ['Victim A', 'Victim B']);
        const baseline = await victimPage.evaluate(
            async ({ atlasId: aid, mapId: mid }) => {
                const { api, createOperation } = window.__mlc;
                // Give the victim map a real saved zoom so a successful attack would be visible.
                await api.pushOperations(aid, [
                    createOperation('mapPosition', 'update', mid, mid, { zoom: 7 }),
                ]);
                const pulled = await api.pullSync(aid, 0);
                const map = pulled.snapshot?.maps?.find((m) => m.id === mid);
                return {
                    zoom: map?.zoom == null ? null : Number(map.zoom),
                    mapOrder: pulled.snapshot?.atlas?.mapOrder ?? null,
                };
            },
            { atlasId: victim.atlasId, mapId: victim.mapIds[0] },
        );
        expect(baseline.zoom).toBe(7);

        // Attacker: a separate user/atlas in its own page (own ApiClient).
        const attackerPage = await browser.newPage();
        await attackerPage.goto('/');
        const attacker = await seed(attackerPage, state.baseUrl, 'mlc_attacker', ['Att']);

        const attack = await attackerPage.evaluate(
            async ({ ownAtlas, victimAtlas, victimMap, victimOrder }) => {
                const { api, createOperation, baseUrl } = window.__mlc;

                // 1. Sub-entity IDOR: push a mapPosition update for the VICTIM's map on
                //    the attacker's OWN atlas route. The backend EXISTS(atlas_id) guard
                //    must drop the write (zero rows). The op acks but has no effect.
                await api.pushOperations(ownAtlas, [
                    createOperation('mapPosition', 'update', victimMap, victimMap, { zoom: 999 }),
                ]);

                // 2. Reorder IDOR: PUT the VICTIM's atlas with the attacker's token (no
                //    share granted). requireAtlasPermission('write') must reject it.
                const res = await fetch(`${baseUrl}/api/v1/atlas/${victimAtlas}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${api.getAccessToken()}`,
                    },
                    body: JSON.stringify({ map_order: [...victimOrder].reverse() }),
                });
                return { reorderStatus: res.status };
            },
            {
                ownAtlas: attacker.atlasId,
                victimAtlas: victim.atlasId,
                victimMap: victim.mapIds[0],
                victimOrder: baseline.mapOrder,
            },
        );

        // The cross-atlas reorder PUT is rejected (no permission on the victim atlas).
        expect([403, 404]).toContain(attack.reorderStatus);

        // The victim atlas is untouched: zoom still 7 (not 999), order unchanged.
        const after = await victimPage.evaluate(
            async ({ atlasId: aid, mapId: mid }) => {
                const pulled = await window.__mlc.api.pullSync(aid, 0);
                const map = pulled.snapshot?.maps?.find((m) => m.id === mid);
                return {
                    zoom: map?.zoom == null ? null : Number(map.zoom),
                    mapOrder: pulled.snapshot?.atlas?.mapOrder ?? null,
                };
            },
            { atlasId: victim.atlasId, mapId: victim.mapIds[0] },
        );
        expect(after.zoom).toBe(7);
        expect(after.zoom).not.toBe(999);
        expect(after.mapOrder).toEqual(baseline.mapOrder);

        await victimPage.close();
        await attackerPage.close();
    });
});

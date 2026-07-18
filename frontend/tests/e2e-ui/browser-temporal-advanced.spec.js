// Path: e2e-ui/browser-temporal-advanced.spec.js

/**
 * Browser-level Temporal-feature transport test (§29.13-20). Drives the REAL
 * frontend transport (api-client / operation-factory) imported live from the Vite
 * dev server inside real Chromium, against the REAL spawned backend. Every assertion
 * is grounded in observable backend state read back through `api.pullSync` — no
 * mocks, real HTTP round-trips only.
 *
 * The atlas feature model is GeoJSON: a feature carries its type in
 * `properties.source` and ALL temporal authoring data rides verbatim inside the
 * opaque JSONB `properties`. The backend never interprets these keys — it persists
 * `properties` as a whole and `pullSync` echoes it back into the snapshot bucket for
 * the feature type. A feature `update` is a FULL JSONB replace of `properties` (not
 * a deep merge), so a key omitted on update disappears. (The `mapTemporal` map-config
 * action itself is covered by browser-temporal — NOT duplicated here.)
 *
 * Coverage (per-action of docs/acoes-interface-multiusuario.md §29):
 *   - §29.13 edit feature temporal validity: set then shift `temporalInicio`/
 *     `temporalFim`; in-blank-clears-to-permanent (full-replace drops the window);
 *   - §29.13+20 `autoDtg` flag persists AND its client-derived `dateTimeGroup`
 *     (military_symbol) rides along verbatim;
 *   - §29.15 trajectory edit: move/insert/remove keypoints — whole-array LWW replace;
 *   - §29.17 clear trajectory: full-replace drops `trajetoria` from the snapshot;
 *   - §29.18/19 `autoDirection`/`autoSpeed` flags persist on a military_symbol;
 *   - §29.20 coordination_measure `autoDtg` derives `gdhIni`/`gdhFim` that round-trip;
 *   - NEGATIVE/edge: a sibling feature with NO temporal data never acquires any of
 *     these keys (cross-feature isolation), and a same-id LWW update wins last.
 *
 * Each test self-provisions its own user + atlas + map for full isolation. No UI
 * clicks — the transport is driven entirely through `page.evaluate`.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/**
 * Seeds a fresh user + atlas + map inside the page and stashes the live ApiClient +
 * factory on `window.__tmp` so later `page.evaluate` calls reuse them. Runs entirely
 * in the browser against the real backend.
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
            await api.register({ username, password, nome: 'Temporal E2E' });
            await api.login(username, password);

            const atlas = await api.createAtlas({ name: 'Temporal Advanced Atlas' });
            const mapId = crypto.randomUUID();
            await api.pushOperations(atlas.id, [createOperation('map', 'create', mapId, null, { name: 'M1' })]);

            window.__tmp = { api, createOperation };
            return { atlasId: atlas.id, mapId };
        },
        { baseUrl, prefix },
    );
}

describeOrSkip('Temporal feature transport (real Chromium + real backend)', () => {
    test('§29.13 edit temporal validity: set → shift → blank-clears; sibling stays untouched', async ({
        page,
    }) => {
        await page.goto('/');
        const { atlasId, mapId } = await seed(page, state.baseUrl, 'tmp_validity');

        const result = await page.evaluate(
            async ({ atlasId: aid, mapId: mid }) => {
                const { api, createOperation } = window.__tmp;

                // §29.13: temporal window is a pair of epoch-ms scalars in properties.
                const inicio = Date.UTC(2024, 0, 1, 12, 0, 0); // 1704110400000
                const fim = Date.UTC(2024, 0, 1, 13, 30, 0); // 1704115800000
                const movingId = crypto.randomUUID();
                const plainId = crypto.randomUUID();

                const featureOp = (id, type, props, coords = [-43.2, -22.9]) =>
                    createOperation('feature', type, id, mid, {
                        type: 'Feature',
                        geometry: { type: 'Point', coordinates: coords },
                        properties: { source: 'point', layerId: null, ...props },
                    });

                // Create a temporal point + a plain sibling (no temporal data).
                await api.pushOperations(aid, [
                    featureOp(movingId, 'create', { nome: 'Unidade Movel', temporalInicio: inicio, temporalFim: fim }),
                    featureOp(plainId, 'create', { nome: 'Marco Fixo' }, [-44.0, -23.5]),
                ]);

                const pull = async () => {
                    const r = await api.pullSync(aid, 0);
                    const map = r.snapshot?.maps?.find((m) => m.id === mid);
                    return (id) => map?.features?.points?.find((f) => f.properties.id === id);
                };

                let find = await pull();
                const created = find(movingId);
                const plainCreated = find(plainId);

                // §29.13: shift the window +1h (datetime edit, LWW). properties is a
                // FULL replace, so carry the whole object including source.
                const newInicio = inicio + 3_600_000;
                const newFim = fim + 3_600_000;
                await api.pushOperations(aid, [
                    featureOp(movingId, 'update', {
                        nome: 'Unidade Movel',
                        temporalInicio: newInicio,
                        temporalFim: newFim,
                    }),
                ]);
                find = await pull();
                const shifted = find(movingId);

                // §29.13: blank = permanent. A full-replace update WITHOUT the temporal
                // keys must DROP them (not a deep merge that retains stale window data).
                await api.pushOperations(aid, [
                    featureOp(movingId, 'update', { nome: 'Unidade Parada' }),
                ]);
                find = await pull();
                const cleared = find(movingId);
                const plainAfter = find(plainId);

                return {
                    created: {
                        present: Boolean(created),
                        inicio: created?.properties.temporalInicio,
                        fim: created?.properties.temporalFim,
                        inicioIsNumber: typeof created?.properties.temporalInicio === 'number',
                    },
                    plainCreated: {
                        present: Boolean(plainCreated),
                        hasInicio: plainCreated?.properties.temporalInicio !== undefined,
                    },
                    shifted: {
                        inicio: shifted?.properties.temporalInicio,
                        fim: shifted?.properties.temporalFim,
                        version: shifted?.properties.version,
                    },
                    cleared: {
                        present: Boolean(cleared),
                        nome: cleared?.properties.nome,
                        hasInicio: cleared?.properties.temporalInicio !== undefined,
                        hasFim: cleared?.properties.temporalFim !== undefined,
                    },
                    plainAfter: {
                        present: Boolean(plainAfter),
                        hasInicio: plainAfter?.properties.temporalInicio !== undefined,
                    },
                    expected: { inicio, fim, newInicio, newFim },
                };
            },
            { atlasId, mapId },
        );

        // Create: window persisted as exact epoch-ms numbers (no string drift).
        expect(result.created.present).toBe(true);
        expect(result.created.inicio).toBe(result.expected.inicio);
        expect(result.created.fim).toBe(result.expected.fim);
        expect(result.created.inicioIsNumber).toBe(true);
        // Sibling never acquired temporal data at create time.
        expect(result.plainCreated.present).toBe(true);
        expect(result.plainCreated.hasInicio).toBe(false);

        // Shift: window moved; version advanced past the initial create (real write).
        expect(result.shifted.inicio).toBe(result.expected.newInicio);
        expect(result.shifted.fim).toBe(result.expected.newFim);
        expect(result.shifted.version).toBeGreaterThan(1);

        // Blank-clears: full-replace dropped the window (negative — not a deep merge).
        expect(result.cleared.present).toBe(true);
        expect(result.cleared.nome).toBe('Unidade Parada');
        expect(result.cleared.hasInicio).toBe(false);
        expect(result.cleared.hasFim).toBe(false);

        // Isolation: the plain sibling still has no temporal data after all edits.
        expect(result.plainAfter.present).toBe(true);
        expect(result.plainAfter.hasInicio).toBe(false);
    });

    test('§29.15/17 trajectory edit → move/insert/remove keypoints (LWW) → clear drops it', async ({
        page,
    }) => {
        await page.goto('/');
        const { atlasId, mapId } = await seed(page, state.baseUrl, 'tmp_traj');

        const result = await page.evaluate(
            async ({ atlasId: aid, mapId: mid }) => {
                const { api, createOperation } = window.__tmp;
                const featureId = crypto.randomUUID();
                const inicio = Date.UTC(2024, 0, 1, 12, 0, 0);
                const fim = Date.UTC(2024, 0, 1, 13, 30, 0);

                // §29.15: trajectory is a sampled keypoint array [{t,lng,lat}].
                const traj0 = [
                    { t: inicio, lng: -43.2, lat: -22.9 },
                    { t: inicio + 1_800_000, lng: -43.15, lat: -22.85 },
                    { t: fim, lng: -43.1, lat: -22.8 },
                ];

                const featureOp = (type, props) =>
                    createOperation('feature', type, featureId, mid, {
                        type: 'Feature',
                        geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
                        properties: { source: 'point', layerId: null, ...props },
                    });

                await api.pushOperations(aid, [
                    featureOp('create', { nome: 'Movel', temporalInicio: inicio, temporalFim: fim, trajetoria: traj0 }),
                ]);

                const pull = async () => {
                    const r = await api.pullSync(aid, 0);
                    const map = r.snapshot?.maps?.find((m) => m.id === mid);
                    return map?.features?.points?.find((f) => f.properties.id === featureId);
                };

                const created = await pull();

                // §29.15/16: edit the whole trajectory (move first kp, insert a 4th kp,
                // remove the last) — the entire array is replaced LWW.
                const traj1 = [
                    { t: inicio, lng: -43.05, lat: -22.75 }, // moved
                    { t: inicio + 900_000, lng: -43.0, lat: -22.7 }, // inserted
                    { t: inicio + 1_800_000, lng: -43.15, lat: -22.85 },
                    // last keypoint of traj0 removed
                ];
                await api.pushOperations(aid, [
                    featureOp('update', { nome: 'Movel', temporalInicio: inicio, temporalFim: fim, trajetoria: traj1 }),
                ]);
                const edited = await pull();

                // §29.17: clear trajectory — full-replace WITHOUT trajetoria drops it,
                // while the temporal window survives (only the path was cleared).
                await api.pushOperations(aid, [
                    featureOp('update', { nome: 'Movel', temporalInicio: inicio, temporalFim: fim }),
                ]);
                const trajCleared = await pull();

                return {
                    created: {
                        traj: created?.properties.trajetoria,
                        len: created?.properties.trajetoria?.length,
                    },
                    edited: {
                        traj: edited?.properties.trajetoria,
                        len: edited?.properties.trajetoria?.length,
                        firstMoved: edited?.properties.trajetoria?.[0],
                        inserted: edited?.properties.trajetoria?.[1],
                    },
                    trajCleared: {
                        present: Boolean(trajCleared),
                        hasTraj: trajCleared?.properties.trajetoria !== undefined,
                        keptInicio: trajCleared?.properties.temporalInicio,
                    },
                    expected: { traj0, traj1, inicio },
                };
            },
            { atlasId, mapId },
        );

        // Create: the full keypoint array round-trips structurally identical.
        expect(result.created.traj).toEqual(result.expected.traj0);
        expect(result.created.len).toBe(3);

        // Edit: whole-array LWW replace — new length, moved first kp, inserted kp.
        expect(result.edited.traj).toEqual(result.expected.traj1);
        expect(result.edited.len).toBe(3);
        expect(result.edited.firstMoved).toEqual({ t: result.expected.inicio, lng: -43.05, lat: -22.75 });
        expect(result.edited.inserted).toEqual({ t: result.expected.inicio + 900_000, lng: -43.0, lat: -22.7 });

        // Clear: trajectory gone (negative — not a deep merge), window preserved.
        expect(result.trajCleared.present).toBe(true);
        expect(result.trajCleared.hasTraj).toBe(false);
        expect(result.trajCleared.keptInicio).toBe(result.expected.inicio);
    });

    test('§29.18/19/20 auto flags persist; autoDtg derives canonical DTG/GDH values', async ({
        page,
    }) => {
        await page.goto('/');
        const { atlasId, mapId } = await seed(page, state.baseUrl, 'tmp_auto');

        const result = await page.evaluate(
            async ({ atlasId: aid, mapId: mid }) => {
                const { api, createOperation } = window.__tmp;
                const inicio = Date.UTC(2024, 0, 1, 12, 0, 0);
                const fim = Date.UTC(2024, 0, 1, 13, 30, 0);
                const symbolId = crypto.randomUUID();
                const measureId = crypto.randomUUID();

                // A military_symbol carries autoDirection/autoSpeed/autoDtg flags. The
                // flags persist; derived direction/speed are LOCAL-display only (never
                // persisted), but the client-derived `dateTimeGroup` (autoDtg) rides
                // along in properties verbatim.
                await api.pushOperations(aid, [
                    createOperation('feature', 'create', symbolId, mid, {
                        type: 'Feature',
                        geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
                        properties: {
                            source: 'military_symbol',
                            layerId: null,
                            sidc: '10031000001211000000',
                            temporalInicio: inicio,
                            temporalFim: fim,
                            autoDirection: true,
                            autoSpeed: true,
                            autoDtg: true,
                            dateTimeGroup: '011200ZJAN24',
                        },
                    }),
                    // §29.20: a coordination_measure with autoDtg derives gdhIni/gdhFim.
                    createOperation('feature', 'create', measureId, mid, {
                        type: 'Feature',
                        geometry: {
                            type: 'Polygon',
                            coordinates: [[[-43.2, -22.9], [-43.1, -22.9], [-43.1, -22.8], [-43.2, -22.9]]],
                        },
                        properties: {
                            source: 'coordination_measure',
                            layerId: null,
                            temporalInicio: inicio,
                            temporalFim: fim,
                            autoDtg: true,
                            gdhIni: '011200ZJAN24',
                            gdhFim: '011330ZJAN24',
                        },
                    }),
                ]);

                const pull = async () => {
                    const r = await api.pullSync(aid, 0);
                    const map = r.snapshot?.maps?.find((m) => m.id === mid);
                    return {
                        symbol: map?.features?.military_symbols?.find((f) => f.properties.id === symbolId),
                        measure: map?.features?.coordination_measures?.find((f) => f.properties.id === measureId),
                    };
                };

                const created = await pull();

                // §29.18/19: toggling autoDirection OFF must persist (LWW full replace).
                await api.pushOperations(aid, [
                    createOperation('feature', 'update', symbolId, mid, {
                        type: 'Feature',
                        geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
                        properties: {
                            source: 'military_symbol',
                            layerId: null,
                            sidc: '10031000001211000000',
                            temporalInicio: inicio,
                            temporalFim: fim,
                            autoDirection: false,
                            autoSpeed: true,
                            autoDtg: true,
                            dateTimeGroup: '011200ZJAN24',
                        },
                    }),
                ]);
                const toggled = await pull();

                return {
                    symbol: {
                        present: Boolean(created.symbol),
                        bucket: 'military_symbols',
                        source: created.symbol?.properties.source,
                        autoDirection: created.symbol?.properties.autoDirection,
                        autoSpeed: created.symbol?.properties.autoSpeed,
                        autoDtg: created.symbol?.properties.autoDtg,
                        dateTimeGroup: created.symbol?.properties.dateTimeGroup,
                    },
                    measure: {
                        present: Boolean(created.measure),
                        source: created.measure?.properties.source,
                        autoDtg: created.measure?.properties.autoDtg,
                        gdhIni: created.measure?.properties.gdhIni,
                        gdhFim: created.measure?.properties.gdhFim,
                    },
                    toggled: {
                        autoDirection: toggled.symbol?.properties.autoDirection,
                        autoSpeed: toggled.symbol?.properties.autoSpeed,
                    },
                };
            },
            { atlasId, mapId },
        );

        // military_symbol landed in its own bucket with flags + derived DTG persisted.
        expect(result.symbol.present).toBe(true);
        expect(result.symbol.source).toBe('military_symbol');
        expect(result.symbol.autoDirection).toBe(true);
        expect(result.symbol.autoSpeed).toBe(true);
        expect(result.symbol.autoDtg).toBe(true);
        expect(result.symbol.dateTimeGroup).toBe('011200ZJAN24');

        // §29.20: coordination_measure autoDtg with derived GDH window round-trips.
        expect(result.measure.present).toBe(true);
        expect(result.measure.source).toBe('coordination_measure');
        expect(result.measure.autoDtg).toBe(true);
        expect(result.measure.gdhIni).toBe('011200ZJAN24');
        expect(result.measure.gdhFim).toBe('011330ZJAN24');

        // §29.18/19: the flag toggle persisted (autoDirection now false, autoSpeed kept).
        expect(result.toggled.autoDirection).toBe(false);
        expect(result.toggled.autoSpeed).toBe(true);
    });
});

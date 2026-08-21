// Path: e2e-ui/browser-temporal.spec.js

/**
 * Browser-level temporal-dimension round-trip: drives the REAL frontend transport
 * modules (api-client / operation-factory), imported live from the Vite dev server
 * INSIDE real Chromium, against the REAL spawned backend. Every assertion below is
 * backed by a genuine HTTP round-trip (register/login/push/pull) made by the
 * browser's own fetch + CORS stack — no mocks, no in-Node shortcuts.
 *
 * Covers the temporal contract:
 *   1. a `mapTemporal` `update` op { ativo, unidade, inicio, fim } is assembled by
 *      the backend into the map's `temporal_config` JSONB and surfaces in the
 *      snapshot;
 *   2. a feature carrying `properties.temporalInicio` / `temporalFim` / `trajetoria`
 *      round-trips verbatim through the snapshot (arbitrary properties are spread
 *      back, the canonical `source` is preserved);
 *   3. NEGATIVE / EDGE: a sub-typed `mapTemporal` op MUST NOT smuggle a sibling
 *      column (e.g. `name`) into the map — the sub-type whitelist isolates
 *      `temporal_config`, so the map name is left untouched.
 *
 * Each test seeds its OWN user + atlas + map for isolation. No app UI is clicked;
 * these specs prove the transport + backend behavior in a real browser context.
 *
 * A CONTA, porém, não nasce aqui dentro: ela vem pronta de `helpers/accounts.js`, no lado
 * Node, porque confirmar o e-mail exige ler `email_verification_tokens` no Postgres, que o
 * contexto do browser não alcança. O `page.evaluate` faz só o `login()`.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { createVerifiedUser } from './helpers/accounts.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

describeOrSkip('Temporal dimension (real Chromium + real backend)', () => {
    test('mapTemporal update { ativo, unidade, inicio, fim } assembles into temporal_config', async ({
        page,
    }) => {
        const user = await createVerifiedUser({ prefix: 'temporal', nome: 'Temporal User' });
        await page.goto('/');

        const temporal = { ativo: true, unidade: 'horas', inicio: '2026-06-20T08:00:00Z', fim: '2026-06-20T20:00:00Z' };

        const result = await page.evaluate(
            async ({ baseUrl, temporal: t, u }) => {
                const { ApiClient } = await import('/src/js/store/sync/api-client.js');
                const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

                const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
                await api.login(u.username, u.password);

                const atlas = await api.createAtlas({ name: 'Temporal Atlas' });
                const mapId = crypto.randomUUID();
                await api.pushOperations(atlas.id, [
                    createOperation('map', 'create', mapId, null, { name: 'M-Temporal' }),
                ]);

                // Drive the temporal config through the sub-typed mapTemporal op. The
                // backend assembles temporal_config from the loose { ativo, unidade,
                // inicio, fim } keys — the frontend never sends a pre-built object.
                await api.pushOperations(atlas.id, [createOperation('mapTemporal', 'update', mapId, mapId, t)]);

                const pulled = await api.pullSync(atlas.id, 0);
                const maps = pulled.snapshot && pulled.snapshot.maps ? pulled.snapshot.maps : [];
                const list = Array.isArray(maps) ? maps : Object.values(maps);
                const map = list.find((m) => m && m.id === mapId);
                return {
                    isSnapshot: pulled.isSnapshot,
                    temporalConfig: map ? (map.temporal_config ?? map.temporalConfig) : undefined,
                };
            },
            { baseUrl: state.baseUrl, temporal, u: user },
        );

        expect(result.isSnapshot).toBe(true);
        expect(result.temporalConfig).toBeTruthy();
        expect(result.temporalConfig.ativo).toBe(true);
        expect(result.temporalConfig.unidade).toBe('horas');
        expect(result.temporalConfig.inicio).toBe(temporal.inicio);
        expect(result.temporalConfig.fim).toBe(temporal.fim);
    });

    test('a feature with temporalInicio/temporalFim/trajetoria round-trips through the snapshot', async ({
        page,
    }) => {
        const user = await createVerifiedUser({ prefix: 'tempfeat', nome: 'Temporal Feature User' });
        await page.goto('/');

        // A moving unit: temporal validity window + a coordinate trajectory. These are
        // arbitrary GeoJSON properties the backend persists verbatim (jsonb) — only
        // `source` is canonicalized into the feature_type collection.
        const trajetoria = [
            { lng: -43.2, lat: -22.9, t: '2026-06-20T08:00:00Z' },
            { lng: -43.1, lat: -22.8, t: '2026-06-20T12:00:00Z' },
            { lng: -43.0, lat: -22.7, t: '2026-06-20T16:00:00Z' },
        ];
        const temporalInicio = '2026-06-20T08:00:00Z';
        const temporalFim = '2026-06-20T16:00:00Z';

        const result = await page.evaluate(
            async ({ baseUrl, trajetoria: traj, temporalInicio: ti, temporalFim: tf, u }) => {
                const { ApiClient } = await import('/src/js/store/sync/api-client.js');
                const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

                const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
                await api.login(u.username, u.password);

                const atlas = await api.createAtlas({ name: 'Temporal Feature Atlas' });
                const mapId = crypto.randomUUID();
                await api.pushOperations(atlas.id, [
                    createOperation('map', 'create', mapId, null, { name: 'M1' }),
                ]);

                const featureId = crypto.randomUUID();
                const feature = {
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [traj[0].lng, traj[0].lat] },
                    properties: {
                        id: featureId,
                        source: 'point',
                        nome: 'Moving Unit',
                        temporalInicio: ti,
                        temporalFim: tf,
                        trajetoria: traj,
                    },
                };
                await api.pushOperations(atlas.id, [
                    createOperation('feature', 'create', featureId, mapId, feature),
                ]);

                const pulled = await api.pullSync(atlas.id, 0);
                const maps = pulled.snapshot && pulled.snapshot.maps ? pulled.snapshot.maps : [];
                const list = Array.isArray(maps) ? maps : Object.values(maps);
                const map = list.find((m) => m && m.id === mapId);
                const points = map && map.features ? map.features.points || [] : [];
                const stored = points.find((p) => p.properties && p.properties.id === featureId);
                return {
                    isSnapshot: pulled.isSnapshot,
                    properties: stored ? stored.properties : null,
                    geometry: stored ? stored.geometry : null,
                };
            },
            { baseUrl: state.baseUrl, trajetoria, temporalInicio, temporalFim, u: user },
        );

        expect(result.isSnapshot).toBe(true);
        expect(result.properties).toBeTruthy();
        expect(result.properties.source).toBe('point');
        expect(result.properties.temporalInicio).toBe(temporalInicio);
        expect(result.properties.temporalFim).toBe(temporalFim);
        // The trajectory array round-trips structurally intact through the jsonb store.
        expect(result.properties.trajetoria).toEqual(trajetoria);
        expect(result.geometry).toEqual({ type: 'Point', coordinates: [trajetoria[0].lng, trajetoria[0].lat] });
    });

    test('EDGE: a mapTemporal sub-typed op does not smuggle a sibling `name` into the map', async ({
        page,
    }) => {
        const user = await createVerifiedUser({ prefix: 'tempedge', nome: 'Temporal Edge User' });
        await page.goto('/');

        const result = await page.evaluate(
            async ({ baseUrl, u }) => {
                const { ApiClient } = await import('/src/js/store/sync/api-client.js');
                const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

                const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
                await api.login(u.username, u.password);

                const atlas = await api.createAtlas({ name: 'Temporal Edge Atlas' });
                const mapId = crypto.randomUUID();
                const originalName = 'Original-Name';
                await api.pushOperations(atlas.id, [
                    createOperation('map', 'create', mapId, null, { name: originalName }),
                ]);

                // Attempt to ride a `name` overwrite alongside the temporal payload. The
                // sub-type whitelist must accept only temporal_config and DROP `name`.
                await api.pushOperations(atlas.id, [
                    createOperation('mapTemporal', 'update', mapId, mapId, {
                        ativo: true,
                        unidade: 'dias',
                        name: 'HIJACKED-Name',
                    }),
                ]);

                const pulled = await api.pullSync(atlas.id, 0);
                const maps = pulled.snapshot && pulled.snapshot.maps ? pulled.snapshot.maps : [];
                const list = Array.isArray(maps) ? maps : Object.values(maps);
                const map = list.find((m) => m && m.id === mapId);
                return {
                    name: map ? map.name : undefined,
                    originalName,
                    temporalConfig: map ? (map.temporal_config ?? map.temporalConfig) : undefined,
                };
            },
            { baseUrl: state.baseUrl, u: user },
        );

        // The temporal payload landed...
        expect(result.temporalConfig).toBeTruthy();
        expect(result.temporalConfig.ativo).toBe(true);
        expect(result.temporalConfig.unidade).toBe('dias');
        // ...but the sibling `name` was rejected by the sub-type whitelist.
        expect(result.name).toBe(result.originalName);
        expect(result.temporalConfig.name).toBeUndefined();
    });
});

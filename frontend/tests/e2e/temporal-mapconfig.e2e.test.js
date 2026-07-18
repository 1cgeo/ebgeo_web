// Path: tests/e2e/temporal-mapconfig.e2e.test.js

/**
 * @fileoverview E2E: a `mapTemporal` update operation must persist on the backend
 * and surface as `map.temporal_config` in the atlas snapshot. Also a real WS peer
 * must receive the broadcast of that same operation. All traffic goes through the
 * public ApiClient / WsClient + createOperation; no direct DB access.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
    makeApi,
    registerAndLogin,
    createAtlas,
    createMap,
    makeWs,
    newClientId,
    waitFor,
    E2E_SKIP,
} from './helpers/harness.js';
import { createOperation } from '../../src/js/store/sync/operation-factory.js';

describe.skipIf(E2E_SKIP)('e2e: temporal map config', () => {
    /** @type {import('../../src/js/store/sync/api-client.js').ApiClient} */
    let api;
    let atlasId;
    let mapId;

    beforeAll(async () => {
        api = makeApi();
        await registerAndLogin(api, { nome: 'Temporal Tester' });
        const atlas = await createAtlas(api, { name: 'Temporal Atlas' });
        atlasId = atlas.id;
        mapId = await createMap(api, atlasId, { name: 'Mapa Temporal' });
    });

    /** Pulls a fresh snapshot and returns the target map row. */
    async function pullMap() {
        const r = await api.pullSync(atlasId, 0);
        expect(r.isSnapshot).toBe(true);
        const map = r.snapshot.maps.find((m) => m.id === mapId);
        expect(map, 'created map present in snapshot').toBeTruthy();
        return map;
    }

    it('starts with no meaningful temporal config', async () => {
        const map = await pullMap();
        // A freshly created map has either null or an empty temporal_config object.
        const cfg = map.temporal_config;
        expect(cfg == null || Object.keys(cfg).length === 0).toBe(true);
    });

    it('persists a mapTemporal update into snapshot map.temporal_config', async () => {
        const payload = {
            ativo: true,
            unidade: 'dia',
            inicio: '2026-01-01',
            fim: '2026-12-31',
            modo: 'cumulativo',
            origem: 'manual',
        };
        const op = createOperation('mapTemporal', 'update', mapId, mapId, payload);
        const res = await api.pushOperations(atlasId, [op]);
        // The op must be acknowledged by the server (not rejected).
        expect(res.serverVersion).toBeGreaterThan(0);

        const map = await pullMap();
        const cfg = map.temporal_config;
        expect(cfg).toBeTruthy();
        expect(cfg.ativo).toBe(true);
        expect(cfg.unidade).toBe('dia');
        expect(cfg.inicio).toBe('2026-01-01');
        expect(cfg.fim).toBe('2026-12-31');
        expect(cfg.modo).toBe('cumulativo');
        expect(cfg.origem).toBe('manual');
    });

    it('ignores keys outside the temporal whitelist (negative)', async () => {
        const op = createOperation('mapTemporal', 'update', mapId, mapId, {
            ativo: false,
            // Not part of {ativo,unidade,inicio,fim,modo,origem}: must NOT be stored.
            bogus: 'should-not-persist',
            name: 'malicious-rename',
        });
        await api.pushOperations(atlasId, [op]);

        const map = await pullMap();
        const cfg = map.temporal_config;
        // The whitelisted field updated...
        expect(cfg.ativo).toBe(false);
        // ...while non-whitelisted keys never leaked into temporal_config. The server
        // assembles temporal_config only from {ativo,unidade,inicio,fim,modo,origem}.
        expect(cfg).not.toHaveProperty('bogus');
        expect(cfg).not.toHaveProperty('name');

        // A sub-typed map update is now narrowed to its own column(s) server-side, so
        // a `name` smuggled alongside the temporal payload is DROPPED — it cannot
        // overwrite the map name (regression: see backend sync-map-subentity-isolation).
        expect(map.name).toBe('Mapa Temporal');
    });

    it('broadcasts the mapTemporal op to a connected WS peer', async () => {
        const peerClientId = newClientId();
        const ws = makeWs(api, { clientId: peerClientId });
        const received = [];
        ws.on('operation', (incoming) => received.push(incoming));

        try {
            await ws.connect(atlasId, { lastVersion: 0 });

            const payload = { ativo: true, unidade: 'hora', origem: 'ws-test' };
            // Push from a DIFFERENT clientId so the peer does not filter it out.
            const op = createOperation('mapTemporal', 'update', mapId, mapId, payload);
            op.clientId = newClientId();
            await api.pushOperations(atlasId, [op]);

            const broadcast = await waitFor(
                () => received.find((o) => o.entityType === 'mapTemporal') || false,
                { timeout: 4000 },
            );
            expect(broadcast.entityId).toBe(mapId);
            expect(broadcast.data).toMatchObject({ unidade: 'hora', origem: 'ws-test' });
        } finally {
            ws.disconnect();
        }
    });
});

// Path: tests/e2e/config-contract.e2e.test.js

/**
 * @fileoverview E2E contract test for GET /api/v1/config. Asserts the live backend
 * returns the frozen top-level config SHAPE the frontend reads at boot. Public route,
 * no auth required, but we still build an isolated ApiClient per file.
 *
 * Shape and invariants, NOT deployment values. This file used to assert that URLs were
 * non-empty and that terrain was enabled, which only held on a fully provisioned host;
 * it was written when those defaults were absolute `http://localhost` URLs that
 * "worked" through the dev proxy. Once the defaults became empty/relative (the correct
 * unconfigured behaviour), the assertions turned into false failures. Where a value
 * matters, assert the invariant that ties it to another field instead.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { makeApi, registerAndLogin, E2E_SKIP } from './helpers/harness.js';

describe.skipIf(E2E_SKIP)('config-contract (e2e)', () => {
    /** @type {import('../../src/js/store/sync/api-client.js').ApiClient} */
    let api;
    /** @type {Object} */
    let cfg;

    beforeAll(async () => {
        api = makeApi();
        // getConfig() is public (auth:false), but registering exercises a real
        // round-trip and keeps this file fully self-contained / isolated.
        await registerAndLogin(api, { nome: 'Config Contract' });
        cfg = await api.getConfig();
    });

    it('returns a plain object (not an array, not null)', () => {
        expect(cfg).toBeTruthy();
        expect(typeof cfg).toBe('object');
        expect(Array.isArray(cfg)).toBe(false);
    });

    it('exposes every frozen top-level key the frontend reads at boot', () => {
        const frozenKeys = [
            'app',
            'features',
            'services',
            'search',
            'basemaps',
            'map2d',
            'map3d',
            'tilesets',
            'streetView360',
        ];
        for (const key of frozenKeys) {
            expect(cfg, `missing top-level config key: ${key}`).toHaveProperty(key);
        }
    });

    it('services carries a string tileServerUrl; search fica no shape, vazio', () => {
        expect(typeof cfg.services).toBe('object');
        // String sempre, possivelmente VAZIA: vazio é o sinal deliberado de "não
        // configurado" (`backend/src/config.js:140`). Exigir comprimento > 0 era
        // exigir um deployment completo de um teste de contrato.
        expect(typeof cfg.services.tileServerUrl).toBe('string');

        // `search` permanece no shape congelado e VAZIO de propósito: o
        // `SEARCH_API_URL` tinha default apontando para um `:3001` que nunca
        // existiu (busca dava connection-refused e não retornava nada, em
        // silêncio), e foi removido junto com o campo. O gazetteer é este mesmo
        // backend. Afirmar a AUSÊNCIA de `apiUrl` prende a correção: se alguém
        // reintroduzir o campo, este teste cai.
        expect(typeof cfg.search).toBe('object');
        expect(cfg.search).not.toHaveProperty('apiUrl');
    });

    it('basemaps is an object keyed by id (not an array), each with a name', () => {
        expect(typeof cfg.basemaps).toBe('object');
        expect(Array.isArray(cfg.basemaps)).toBe(false);
        const ids = Object.keys(cfg.basemaps);
        expect(ids.length).toBeGreaterThan(0);
        for (const id of ids) {
            expect(typeof cfg.basemaps[id]).toBe('object');
            expect(typeof cfg.basemaps[id].name).toBe('string');
        }
    });

    it('tilesets is an array; every entry has id + name from the resource seed', () => {
        expect(Array.isArray(cfg.tilesets)).toBe(true);
        for (const t of cfg.tilesets) {
            expect(typeof t.id).toBe('string');
            expect(typeof t.name).toBe('string');
        }
    });

    it('streetView360 declares the server-rendered MVT vector sources', () => {
        const sv = cfg.streetView360;
        expect(typeof sv).toBe('object');
        expect(typeof sv.serviceUrl).toBe('string');
        expect(sv.pointsSourceLayer).toBe('fotos');
        expect(sv.linesSourceLayer).toBe('fotos_linha');
        expect(sv.pointsSource.type).toBe('vector');
        expect(Array.isArray(sv.pointsSource.tiles)).toBe(true);
        expect(sv.pointsSource.tiles[0]).toContain('/tiles/{z}/{x}/{y}.pbf');
    });

    it('map3d nests viewer + imagery/terrain providers (deep shape, not flat)', () => {
        expect(typeof cfg.map3d).toBe('object');
        expect(typeof cfg.map3d.viewer).toBe('object');
        expect(typeof cfg.map3d.providers).toBe('object');

        const { imagery, terrain } = cfg.map3d.providers;
        expect(imagery.enabled).toBe(true);
        expect(typeof imagery.url).toBe('string');

        // O INVARIANTE, não o valor: o terreno só liga quando há URL configurada
        // (`backend/src/modules/config/config.service.js:208`, `Boolean(map3dTerrainUrl)`),
        // porque sem URL o Cesium usa o elipsoide plano em vez de tentar um
        // provider inexistente. Isto vale em deployment configurado e não
        // configurado. A versão anterior exigia `enabled === true`, herança do
        // tempo em que o default era um `http://localhost` absoluto que só
        // funcionava por acidente do proxy de dev; com o default vazio correto,
        // o teste passou a falhar em qualquer máquina sem terreno instalado.
        expect(typeof terrain.url).toBe('string');
        expect(terrain.enabled).toBe(Boolean(terrain.url));
    });

    it('does NOT wrap the payload in a { data } envelope (getConfig unwraps it)', () => {
        // Negative assertion: the controller returns { data }, but ApiClient.getConfig
        // must hand the frontend the inner object directly.
        expect(cfg).not.toHaveProperty('data');
    });
});

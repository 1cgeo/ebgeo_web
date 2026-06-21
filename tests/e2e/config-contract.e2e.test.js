// Path: tests/e2e/config-contract.e2e.test.js

/**
 * @fileoverview E2E contract test for GET /api/v1/config. Asserts the live backend
 * returns the frozen top-level config shape the frontend reads at boot, with real
 * (non-empty) values from the resource seed. Public route — no auth required, but we
 * still build an isolated ApiClient per file.
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

    it('services + search carry usable string URLs', () => {
        expect(typeof cfg.services).toBe('object');
        expect(typeof cfg.services.tileServerUrl).toBe('string');
        expect(cfg.services.tileServerUrl.length).toBeGreaterThan(0);

        expect(typeof cfg.search).toBe('object');
        expect(typeof cfg.search.apiUrl).toBe('string');
        expect(cfg.search.apiUrl.length).toBeGreaterThan(0);
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
        expect(cfg.map3d.providers.imagery.enabled).toBe(true);
        expect(typeof cfg.map3d.providers.imagery.url).toBe('string');
        expect(cfg.map3d.providers.terrain.enabled).toBe(true);
    });

    it('does NOT wrap the payload in a { data } envelope (getConfig unwraps it)', () => {
        // Negative assertion: the controller returns { data }, but ApiClient.getConfig
        // must hand the frontend the inner object directly.
        expect(cfg).not.toHaveProperty('data');
    });
});

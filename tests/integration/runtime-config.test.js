import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import config from '../../src/js/config.js';
import {
    applyRuntimeConfig,
    resolveBackendBaseUrl,
} from '../../src/js/store/sync/runtime-config.js';

/**
 * Runtime config bridge tests. The backend is mocked via an injected fake
 * `apiClient.getConfig`; these pin the deep-merge-over semantics, the fail-safe
 * (static config left intact on error), and the base-URL override hook.
 *
 * NOTE: the static `config` object is a shared singleton mutated in place. Each
 * test snapshots and restores the keys it touches to stay hermetic.
 */

/** Makes a fake apiClient whose getConfig resolves/rejects with the given value. */
function fakeClient(getConfig) {
    return { getConfig };
}

describe('runtime-config — resolveBackendBaseUrl', () => {
    afterEach(() => {
        delete globalThis.__EBGEO_BACKEND_URL__;
    });

    it('defaults to /api/v1 when no override is set', () => {
        delete globalThis.__EBGEO_BACKEND_URL__;
        expect(resolveBackendBaseUrl()).toBe('/api/v1');
    });

    it('honors the global override', () => {
        globalThis.__EBGEO_BACKEND_URL__ = 'http://api.test/api/v1';
        expect(resolveBackendBaseUrl()).toBe('http://api.test/api/v1');
    });
});

describe('runtime-config — applyRuntimeConfig', () => {
    let snapshot;

    beforeEach(() => {
        // Snapshot the branches the tests mutate so they can be restored.
        snapshot = {
            appTitle: config.app.title,
            featuresGrid: config.features.grid,
            servicesTile: config.services.tileServerUrl,
            search: { ...config.search },
        };
    });

    afterEach(() => {
        config.app.title = snapshot.appTitle;
        config.features.grid = snapshot.featuresGrid;
        config.services.tileServerUrl = snapshot.servicesTile;
        config.search = snapshot.search;
    });

    it('deep-merges backend values over the static config, preserving omitted keys', async () => {
        const originalTutorialUrl = config.app.tutorialUrl;
        const originalMap3d = config.features.map_3d;

        const result = await applyRuntimeConfig({
            apiClient: fakeClient(async () => ({
                app: { title: 'EBGeo Servidor' },
                features: { grid: true },
                services: { tileServerUrl: 'http://10.0.0.5:7800' },
            })),
        });

        expect(result).toEqual({ applied: true });
        // Backend values win.
        expect(config.app.title).toBe('EBGeo Servidor');
        expect(config.features.grid).toBe(true);
        expect(config.services.tileServerUrl).toBe('http://10.0.0.5:7800');
        // Sibling keys the backend omitted are preserved.
        expect(config.app.tutorialUrl).toBe(originalTutorialUrl);
        expect(config.features.map_3d).toBe(originalMap3d);
    });

    it('overwrites array/primitive branches wholesale (no array merge)', async () => {
        const result = await applyRuntimeConfig({
            apiClient: fakeClient(async () => ({
                search: { apiUrl: 'http://backend/busca' },
            })),
        });

        expect(result).toEqual({ applied: true });
        expect(config.search.apiUrl).toBe('http://backend/busca');
    });

    it('is fail-safe: a rejected getConfig leaves the static config intact', async () => {
        const before = config.app.title;
        const err = new Error('offline');

        const result = await applyRuntimeConfig({
            apiClient: fakeClient(async () => { throw err; }),
        });

        expect(result.applied).toBe(false);
        expect(result.error).toBe(err);
        expect(config.app.title).toBe(before);
    });

    it('is fail-safe: a non-object payload is rejected without mutating config', async () => {
        const before = config.app.title;

        const result = await applyRuntimeConfig({
            apiClient: fakeClient(async () => 'not-an-object'),
        });

        expect(result.applied).toBe(false);
        expect(result.error).toBeInstanceOf(Error);
        expect(config.app.title).toBe(before);
    });

    it('never replaces the config binding (same object reference)', async () => {
        const ref = config;
        await applyRuntimeConfig({
            apiClient: fakeClient(async () => ({ app: { title: 'X' } })),
        });
        expect(config).toBe(ref);
    });
});

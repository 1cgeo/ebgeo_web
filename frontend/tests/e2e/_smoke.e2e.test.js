// Path: tests/e2e/_smoke.e2e.test.js

/**
 * @fileoverview E2E smoke test: proves the harness can register+login, create an
 * atlas, and read the runtime config against the live backend. Skips cleanly when
 * Postgres / the backend was unavailable in globalSetup.
 */

import { describe, it, expect } from 'vitest';
import { E2E_SKIP, makeApi, registerAndLogin, createAtlas } from './helpers/harness.js';

describe.skipIf(E2E_SKIP)('E2E smoke', () => {
    it('registers, logs in, creates an atlas, and reads config', async () => {
        const api = makeApi();

        const { user } = await registerAndLogin(api);
        expect(user).toBeTruthy();

        const atlas = await createAtlas(api);
        expect(atlas.id).toBeTruthy();

        const config = await api.getConfig();
        expect(config).toBeTypeOf('object');
        expect(config).toHaveProperty('app');
    });
});

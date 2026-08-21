// Path: e2e-ui/browser-settings-24-8.spec.js

/**
 * §24.8 — atlas-level `setting` op whitelist, driven through the REAL frontend
 * transport (api-client / operation-factory) imported live from the Vite dev
 * server INSIDE real Chromium, against the REAL backend.
 *
 * Proves the backend's whitelist merge for the atlas-level `setting` `update` op:
 *   - a single-client browser push of `setting` `update`
 *     `{ terrainExaggeration: 2.5, malicious: 'x' }` over the real HTTP `/sync`
 *     route persists ONLY the whitelisted key;
 *   - the pulled snapshot reports `atlas.settings.terrainExaggeration === 2.5`;
 *   - the rejected `malicious` key is absent from the persisted settings
 *     (negative assertion — a write user cannot smuggle arbitrary keys into
 *     `atlas.settings` via the JSONB shallow merge).
 *
 * Each test self-provisions its OWN user + atlas + map for isolation; no UI is
 * clicked (the transport is exercised directly via `page.evaluate`).
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { createVerifiedUser } from './helpers/accounts.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

describeOrSkip('§24.8 atlas setting whitelist (real Chromium + real backend)', () => {
    test('setting op persists terrainExaggeration but drops a non-whitelisted key', async ({ page }) => {
        // A conta nasce no NODE, com o e-mail já confirmado pela rota pública: o token de
        // verificação só existe como linha no Postgres, fora do alcance do `page.evaluate`.
        const user = await createVerifiedUser({ prefix: 'set', nome: 'Setting 24.8' });
        await page.goto('/');

        const result = await page.evaluate(async ({ baseUrl, u }) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

            const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
            await api.login(u.username, u.password);

            const atlas = await api.createAtlas({ name: 'Setting Atlas' });
            const mapId = crypto.randomUUID();
            await api.pushOperations(atlas.id, [
                createOperation('map', 'create', mapId, null, { name: 'M1' }),
            ]);

            // Baseline: a freshly created atlas must NOT already expose terrainExaggeration,
            // so the assertion below proves the op (not a default) wrote the value.
            const before = await api.pullSync(atlas.id, 0);
            const settingsBefore = (before.snapshot && before.snapshot.atlas && before.snapshot.atlas.settings) || {};

            // §24.8: push an atlas-level `setting` `update` carrying a whitelisted key
            // (terrainExaggeration) AND a non-whitelisted key (malicious). The op is
            // atlas-scoped, but the factory requires an entityId — give it a UUID.
            const settingId = crypto.randomUUID();
            const op = createOperation('setting', 'update', settingId, null, {
                terrainExaggeration: 2.5,
                malicious: 'x',
            });
            const pushRes = await api.pushOperations(atlas.id, [op]);

            const after = await api.pullSync(atlas.id, 0);
            const settingsAfter = (after.snapshot && after.snapshot.atlas && after.snapshot.atlas.settings) || {};

            return {
                pushAccepted: Boolean(pushRes),
                hadTerrainBefore: Object.prototype.hasOwnProperty.call(settingsBefore, 'terrainExaggeration'),
                terrainAfter: settingsAfter.terrainExaggeration,
                hasMaliciousKey: Object.prototype.hasOwnProperty.call(settingsAfter, 'malicious'),
                settingKeys: Object.keys(settingsAfter),
            };
        }, { baseUrl: state.baseUrl, u: user });

        // The push round-trip succeeded.
        expect(result.pushAccepted).toBe(true);
        // The value was written by the op, not pre-seeded.
        expect(result.hadTerrainBefore).toBe(false);
        // Whitelisted key persisted with the exact pushed value.
        expect(result.terrainAfter).toBe(2.5);
        // Negative assertion: the non-whitelisted key was rejected by the merge.
        expect(result.hasMaliciousKey).toBe(false);
        expect(result.settingKeys).not.toContain('malicious');
    });
});

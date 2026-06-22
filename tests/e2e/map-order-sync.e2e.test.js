// Path: tests/e2e/map-order-sync.e2e.test.js

/**
 * @fileoverview Real-backend E2E for the maps-list ordering preference (`mapOrder`).
 * The frontend persists `mapOrder` (an array of map NAMES) as an atlas-level app
 * setting and syncs it via a `setting` UPDATE op into `atlas.settings.mapOrder`.
 * This is DISTINCT from the `atlas.map_order` UUID column exposed as
 * `snapshot.atlas.mapOrder`.
 *
 * Coverage:
 *  - a `setting` op carrying `{ mapOrder }` lands in `atlas.settings.mapOrder`;
 *  - a later `mapOrder` op replaces the previous order wholesale;
 *  - a sibling object-key write (`mapBadgeColors`) deep-merges WITHOUT dropping the
 *    previously-stored `mapOrder` (shallow-merge preservation) — this also exercises
 *    the atlas-settings sync path (mapBadgeColors/colorUsage/customIcons) end-to-end,
 *    which had no E2E before.
 */

import { describe, it, beforeAll, expect } from 'vitest';
import {
    E2E_SKIP,
    makeApi,
    registerAndLogin,
    createAtlas,
    createMap,
} from './helpers/harness.js';
import { createOperation } from '../../src/js/store/sync/operation-factory.js';

describe.skipIf(E2E_SKIP)('E2E mapOrder atlas-setting sync', () => {
    /** @type {import('../../src/js/store/sync/api-client.js').ApiClient} */
    let api;
    /** @type {string} */
    let atlasId;

    beforeAll(async () => {
        api = makeApi();
        await registerAndLogin(api, { nome: 'MapOrder E2E' });
        const atlas = await createAtlas(api, { name: 'MapOrder Atlas' });
        atlasId = atlas.id;
        await createMap(api, atlasId, { name: 'Mapa A' });
        await createMap(api, atlasId, { name: 'Mapa B' });
    });

    /** Pulls a fresh snapshot and returns the atlas-level settings object. */
    async function pullSettings() {
        const res = await api.pullSync(atlasId, 0);
        expect(res.isSnapshot).toBe(true);
        return res.snapshot.atlas.settings || {};
    }

    it('a setting op with { mapOrder } persists to atlas.settings.mapOrder', async () => {
        const order = ['Mapa B', 'Mapa A'];
        const op = createOperation('setting', 'update', atlasId, null, { mapOrder: order });
        await api.pushOperations(atlasId, [op]);

        const settings = await pullSettings();
        expect(settings.mapOrder).toEqual(order);
    });

    it('a later mapOrder op replaces the previous order wholesale', async () => {
        const order2 = ['Mapa A', 'Mapa B'];
        const op = createOperation('setting', 'update', atlasId, null, { mapOrder: order2 });
        await api.pushOperations(atlasId, [op]);

        const settings = await pullSettings();
        expect(settings.mapOrder).toEqual(order2);
    });

    it('a sibling object-key write preserves mapOrder (shallow merge)', async () => {
        const op = createOperation('setting', 'update', atlasId, null, {
            mapBadgeColors: { 'Mapa A': '#ff0000' },
        });
        await api.pushOperations(atlasId, [op]);

        const settings = await pullSettings();
        // mapOrder from the previous op survives the merge...
        expect(settings.mapOrder).toEqual(['Mapa A', 'Mapa B']);
        // ...and the object key was deep-merged in.
        expect(settings.mapBadgeColors).toEqual({ 'Mapa A': '#ff0000' });
    });
});
